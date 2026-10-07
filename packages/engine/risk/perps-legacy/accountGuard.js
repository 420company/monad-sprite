/** accountGuard.js —— 账户总控：分区 + 三重开仓校验 + 储备线停火
 *
 * 用户规则：
 *  合约账户 $1000 → $500 交易预算（敢死队）+ $500 储备金（预备队，永远不动）
 *  储备金不是救援金：亏损仓位一律不许追加保证金，让它按计划止损/爆掉
 *  净值跌破 $500 → 全部停手
 */
'use strict';
// legacy 注意：本文件为永续合约版留档，现货系统不引用。
// 原依赖 reward.js 已拆分，leverageLadder.js 未开源，在此内联最小桩。
const { leverageGuard } = require('./leverageGuard.js');
const crashSafeSize = (leverage, crashPct) => (1 - crashPct) / leverage; // 原 leverageLadder.js 近似：暴跌后剩余保证金占比

class AccountGuard {
  constructor({ equity = 1000, tradingPct = 0.5, maxRiskPerTrade = 0.01, crashPct = 0.3 } = {}) {
    this.equity0 = equity;
    this.tradingPct = tradingPct;
    this.reserveLine = equity * (1 - tradingPct); // 储备线：$500，碰到就停火
    this.budget = equity * tradingPct;            // 交易预算：$500
    this.usedMargin = 0;                          // 已占用的保证金
    this.maxRiskPerTrade = maxRiskPerTrade;
    this.crashPct = crashPct;
    this.halted = false;
  }

  /** 开仓前必调。返回 { allowed, marginUsd, reason } */
  requestOpen({ leverage, stopDistPct, equityNow }) {
    // 第0关：停火线 —— 净值跌破储备线，全部停手，储备金一分不动
    if (this.halted || equityNow <= this.reserveLine) {
      this.halted = true;
      return { allowed: false, marginUsd: 0, reason: `净值 $${equityNow.toFixed(0)} ≤ 储备线 $${this.reserveLine.toFixed(0)}，停火。$500 储备金不动。` };
    }
    // 第1关：杠杆铁律（止损有效性 + 单笔风险仓位）
    const g = leverageGuard(leverage, stopDistPct, this.maxRiskPerTrade);
    if (!g.allowed) return { allowed: false, marginUsd: 0, reason: g.reason };
    // 第2关：暴跌表（30% 暴跌下本金不死）
    const crashSize = crashSafeSize(leverage, this.crashPct) * equityNow;
    // 第3关：组合预算（已用 + 新仓 ≤ $500）
    const avail = this.budget - this.usedMargin;
    if (avail <= 0) return { allowed: false, marginUsd: 0, reason: `交易预算 $${this.budget.toFixed(0)} 已用完，等仓位平了再开` };
    const margin = Math.min(g.maxSizePct * equityNow, crashSize, avail);
    if (margin < 5) return { allowed: false, marginUsd: 0, reason: `剩余额度 $${avail.toFixed(2)} 太小，不开` };
    return {
      allowed: true,
      marginUsd: margin,
      reason: `三关通过｜杠杆铁律$${(g.maxSizePct * equityNow).toFixed(0)} 暴跌表$${crashSize.toFixed(0)} 预算剩$${avail.toFixed(0)} → 批 $${margin.toFixed(2)}${g.warning ? '｜' + g.warning : ''}`,
    };
  }

  onFill(marginUsd) { this.usedMargin += marginUsd; }   // 开仓成交
  onClose(marginUsd) { this.usedMargin = Math.max(0, this.usedMargin - marginUsd); } // 平仓释放
  status(equityNow) {
    return {
      equity: equityNow,
      reserveLine: this.reserveLine,
      budget: this.budget,
      usedMargin: this.usedMargin,
      budgetLeft: this.budget - this.usedMargin,
      distanceToHalt: equityNow - this.reserveLine,
      halted: this.halted,
    };
  }
}

module.exports = { AccountGuard };
