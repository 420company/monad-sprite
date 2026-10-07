'use strict';
/**
 * paper.js —— 纸交易账本（本地 bonding curve 仿真）
 *
 * 关键：paper 买卖不改变链上 supply，所以账本自己维护"虚拟 supply"，
 * 用与合约完全一致的数学（MemeLauncher._quoteBuy/_quoteSell/_getPrice）在本地算成交。
 * 初始虚拟 supply = 链上真实 supply（getTokenInfo）。
 */
const { formatEther } = require('viem');

const BASE_PRICE = 10n ** 12n;   // 1e12 wei
const SLOPE = 9000000n;          // 9e6
const SUPPLY_SCALE = 10n ** 18n;
const TOKEN_UNIT = 10n ** 18n;

function sqrtBig(n) {
  if (n < 0n) throw new Error('sqrt 负数');
  if (n < 2n) return n;
  let x = n, y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (x + n / x) >> 1n; }
  return x;
}
function quoteBuyJS(supply, monIn) {
  const b = 2n * (SUPPLY_SCALE * BASE_PRICE + SLOPE * supply);
  const disc = b * b + 8n * SLOPE * SUPPLY_SCALE * TOKEN_UNIT * monIn;
  return (sqrtBig(disc) - b) / (2n * SLOPE);
}
function quoteSellJS(supply, amount) {
  const curve = (SLOPE * (supply * amount - (amount * amount) / 2n)) / SUPPLY_SCALE;
  return (BASE_PRICE * amount + curve) / TOKEN_UNIT;
}
function priceJS(supply) {
  return BASE_PRICE + (SLOPE * supply) / SUPPLY_SCALE;
}

class PaperLedger {
  constructor({ getSupply, monPriceUsd = 1 } = {}) {
    this.getSupply = getSupply;   // async (token) => onchain supply (bigint)
    this.monPriceUsd = monPriceUsd;
    this.trades = [];
    this.positions = new Map();   // token -> { tokenWei, usdIn, vSupply }
    this.realizedUsd = 0;
  }

  async _vSupply(token) {
    const p = this.positions.get(token);
    if (p && p.vSupply != null) return p.vSupply;
    const onchain = this.getSupply ? await this.getSupply(token) : 0n;
    return onchain;
  }

  _toUsd(wei) { return Number(formatEther(wei)) * this.monPriceUsd; }

  async buy(token, usdIn) {
    const monInWei = BigInt(Math.floor((usdIn / this.monPriceUsd) * 1e18));
    const vSupply = await this._vSupply(token);
    const tokensOut = quoteBuyJS(vSupply, monInWei);
    if (tokensOut === 0n) throw new Error('买入数量为零');
    const p = this.positions.get(token) || { tokenWei: 0n, usdIn: 0, vSupply };
    p.tokenWei += tokensOut; p.usdIn += usdIn; p.vSupply = vSupply + tokensOut;
    this.positions.set(token, p);
    const avgPx = this._toUsd((monInWei * 10n ** 18n) / tokensOut);
    const t = { type: 'buy', token, usdIn, tokensOut: tokensOut.toString(), avgPriceMon: avgPx, at: Date.now() };
    this.trades.push(t);
    return t;
  }

  async sell(token, fraction = 1) {
    const p = this.positions.get(token);
    if (!p || p.tokenWei === 0n) throw new Error('无持仓');
    const amt = (p.tokenWei * BigInt(Math.floor(fraction * 1e6))) / 1000000n;
    const vSupply = await this._vSupply(token);
    if (amt > vSupply) throw new Error('卖出超过虚拟 supply');
    const payoutWei = quoteSellJS(vSupply, amt);
    const usdOut = this._toUsd(payoutWei);
    const costBasis = p.usdIn * Number(amt) / Number(p.tokenWei);
    const pnl = usdOut - costBasis;
    p.tokenWei -= amt; p.usdIn -= costBasis; p.vSupply = vSupply - amt;
    if (p.tokenWei === 0n) this.positions.delete(token);
    this.realizedUsd += pnl;
    const t = { type: 'sell', token, usdOut: +usdOut.toFixed(4), pnlUsd: +pnl.toFixed(4), fraction, at: Date.now() };
    this.trades.push(t);
    return t;
  }

  /** 权益：已实现 + 持仓按当前虚拟曲线 mark-to-market */
  async equityUsd() {
    let eq = this.realizedUsd;
    for (const [token, p] of this.positions) {
      if (p.tokenWei > 0n) {
        const vSupply = await this._vSupply(token);
        eq += this._toUsd(quoteSellJS(vSupply, p.tokenWei));
      }
    }
    return eq;
  }

  summary() {
    return { trades: this.trades.length, openPositions: this.positions.size, realizedUsd: +this.realizedUsd.toFixed(2) };
  }
}

module.exports = { PaperLedger, quoteBuyJS, quoteSellJS, priceJS };
