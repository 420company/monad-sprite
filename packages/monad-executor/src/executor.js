'use strict';
/**
 * executor.js — unified executor: paper (default) / live (real money only with explicit --live)
 *
 *   const ex = createExecutor({ mode: 'paper' });
 *   await ex.buy(token, usdIn);   // paper: ledger entry; live: signs and broadcasts buy()
 *   await ex.sell(token, 0.5);    // sell half the position
 *
 * live safeguards:
 *  - mode:'live' must be passed explicitly (CLI: --live)
 *  - quoteBuy computes slippage before buying; orders over maxSlippagePct are rejected
 *  - private key is read from the MONAD_PRIVATE_KEY environment variable only
 */
const { PaperLedger } = require('./paper');
const { quoteBuy, quoteSell, getTokenInfo, buyTx, sellTx, parseEther, formatEther } = require('./launcher');

function createExecutor({ mode = 'paper', chainId = 10143, maxSlippagePct = 0.03, monPriceUsd = 1 } = {}) {
  if (!['paper', 'live'].includes(mode)) throw new Error(`invalid mode: ${mode}`);

  const paper = new PaperLedger({
    getSupply: async (t) => (await getTokenInfo(t, chainId))?.supply ?? 0n,
    monPriceUsd,
  });

  async function slippageBuy(token, monInWei) {
    const tokensOut = await quoteBuy(token, monInWei, chainId);
    const info = await getTokenInfo(token, chainId);
    if (!info || info.price === 0n) throw new Error('token does not exist or has no price');
    // expected: marginal price now; actual: average price from the quote
    const expected = (monInWei * 10n ** 18n) / info.price;
    const slip = expected > 0n ? Number(expected - tokensOut) / Number(expected) : 0;
    return { tokensOut, slippagePct: Math.max(0, slip) };
  }

  return {
    mode, chainId,

    /** Buy the USD-equivalent of usdIn. Returns { tokensOut, slippagePct, tx } (no tx in paper) */
    async buy(token, usdIn) {
      if (mode === 'paper') {
        const t = await paper.buy(token, usdIn);
        return { ...t, tx: null };
      }
      const monInWei = parseEther(String(usdIn / monPriceUsd));
      const { tokensOut, slippagePct } = await slippageBuy(token, monInWei);
      if (slippagePct > maxSlippagePct) {
        throw new Error(`slippage ${(slippagePct * 100).toFixed(2)}% over cap — buy aborted`);
      }
      const { hash } = await buyTx(token, monInWei, chainId);
      return { type: 'buy', token, usdIn, tokensOut: tokensOut.toString(), slippagePct, tx: hash };
    },

    /** Sell a fraction of the position (fraction 0–1) */
    async sell(token, fraction = 1) {
      if (mode === 'paper') {
        const t = await paper.sell(token, fraction);
        return { ...t, tx: null };
      }
      // live: sells fraction of the wallet's full balance (sell needs no approve)
      const { walletClient } = require('./chain');
      const { account } = walletClient(chainId);
      const { tokenBalance } = require('./launcher');
      const bal = await tokenBalance(token, account.address, chainId);
      const amt = (bal * BigInt(Math.floor(fraction * 1e6))) / 1000000n;
      if (amt === 0n) throw new Error('zero balance');
      const { hash } = await sellTx(token, amt, chainId);
      return { type: 'sell', token, tokenWei: amt.toString(), fraction, tx: hash };
    },

    /** Current equity (paper: ledger equity; live: on-chain position valuation, extend as needed) */
    async equityUsd() { return paper.equityUsd(); },
    summary() { return { mode, ...paper.summary() }; },
  };
}

module.exports = { createExecutor };
