'use strict';
/**
 * executor.js —— 统一执行器：paper（默认）/ live（显式 --live 才动真钱）
 *
 *   const ex = createExecutor({ mode: 'paper' });
 *   await ex.buy(token, usdIn);   // paper：记账；live：签名广播 buy()
 *   await ex.sell(token, 0.5);    // 卖一半
 *
 * live 保护：
 *  - 必须显式传 mode:'live'（CLI 里对应 --live）
 *  - 买入前用 quoteBuy 算滑点，超 maxSlippagePct 直接拒单
 *  - 私钥只从 MONAD_PRIVATE_KEY 环境变量读
 */
const { PaperLedger } = require('./paper');
const { quoteBuy, quoteSell, getTokenInfo, buyTx, sellTx, parseEther, formatEther } = require('./launcher');

function createExecutor({ mode = 'paper', chainId = 10143, maxSlippagePct = 0.03, monPriceUsd = 1 } = {}) {
  if (!['paper', 'live'].includes(mode)) throw new Error(`mode 非法: ${mode}`);

  const paper = new PaperLedger({
    getSupply: async (t) => (await getTokenInfo(t, chainId))?.supply ?? 0n,
    monPriceUsd,
  });

  async function slippageBuy(token, monInWei) {
    const tokensOut = await quoteBuy(token, monInWei, chainId);
    const info = await getTokenInfo(token, chainId);
    if (!info || info.price === 0n) throw new Error('代币不存在或无价格');
    // 预期：按当前边际价；实际：quote 出来的平均价
    const expected = (monInWei * 10n ** 18n) / info.price;
    const slip = expected > 0n ? Number(expected - tokensOut) / Number(expected) : 0;
    return { tokensOut, slippagePct: Math.max(0, slip) };
  }

  return {
    mode, chainId,

    /** 买入 usdIn 美元等值。返回 { tokensOut, slippagePct, tx }（paper 无 tx） */
    async buy(token, usdIn) {
      if (mode === 'paper') {
        const t = await paper.buy(token, usdIn);
        return { ...t, tx: null };
      }
      const monInWei = parseEther(String(usdIn / monPriceUsd));
      const { tokensOut, slippagePct } = await slippageBuy(token, monInWei);
      if (slippagePct > maxSlippagePct) {
        throw new Error(`滑点 ${(slippagePct * 100).toFixed(2)}% 超上限，中止买入`);
      }
      const { hash } = await buyTx(token, monInWei, chainId);
      return { type: 'buy', token, usdIn, tokensOut: tokensOut.toString(), slippagePct, tx: hash };
    },

    /** 按持仓比例卖出（fraction 0~1） */
    async sell(token, fraction = 1) {
      if (mode === 'paper') {
        const t = await paper.sell(token, fraction);
        return { ...t, tx: null };
      }
      // live：卖钱包全部余额的 fraction（sell 无需 approve）
      const { walletClient } = require('./chain');
      const { account } = walletClient(chainId);
      const { tokenBalance } = require('./launcher');
      const bal = await tokenBalance(token, account.address, chainId);
      const amt = (bal * BigInt(Math.floor(fraction * 1e6))) / 1000000n;
      if (amt === 0n) throw new Error('余额为零');
      const { hash } = await sellTx(token, amt, chainId);
      return { type: 'sell', token, tokenWei: amt.toString(), fraction, tx: hash };
    },

    /** 当前权益（paper 为账本权益；live 为链上持仓估值，需自行扩展） */
    async equityUsd() { return paper.equityUsd(); },
    summary() { return { mode, ...paper.summary() }; },
  };
}

module.exports = { createExecutor };
