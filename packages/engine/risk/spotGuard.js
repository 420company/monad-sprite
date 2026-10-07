'use strict';
/**
 * spotGuard.js —— monad小精灵现货总控
 *
 * 实现 docs/RISK-MODEL.md 第 4 章开仓检查清单。
 * 相对 perps-legacy/accountGuard.js 的变化：
 *   删除：杠杆铁律、暴跌表、爆仓线（现货无爆仓）
 *   新增：Radar 分数门禁、滑点预检、单币/单创建者持仓上限
 *   保留：资金分区（$500 交易 / $500 储备，净值≤$500 停火）、DayGuard、1% 单笔风险
 */
const { sizeForRisk, DayGuard } = require('./exit.js');

class SpotGuard {
  constructor({
    equity = 1000,
    tradingPct = 0.5,
    maxRiskPct = 0.01,        // 单笔最多亏本金的 1%
    minRadarScore = 60,       // 开仓最低 Radar 分
    dangerScore = 35,         // 持仓中跌破此分 → 强制离场
    freshTokenMinScore = 70,  // 发射 <30min 的新币更严
    freshTokenSecs = 1800,
    maxSlippagePct = 0.03,    // 滑点上限 3%
    maxTokenPct = 0.20,       // 单币 ≤ 预算 20%
    maxCreatorPct = 0.30,     // 单创建者 ≤ 预算 30%
    minOrderUsd = 5,
  } = {}) {
    this.equity0 = equity;
    this.tradingPct = tradingPct;
    this.reserveLine = equity * (1 - tradingPct);
    this.budget = equity * tradingPct;
    this.maxRiskPct = maxRiskPct;
    this.minRadarScore = minRadarScore;
    this.dangerScore = dangerScore;
    this.freshTokenMinScore = freshTokenMinScore;
    this.freshTokenSecs = freshTokenSecs;
    this.maxSlippagePct = maxSlippagePct;
    this.maxTokenPct = maxTokenPct;
    this.maxCreatorPct = maxCreatorPct;
    this.minOrderUsd = minOrderUsd;
    this.used = 0;                    // 已占用预算
    this.positions = new Map();       // tokenAddress -> { usd, creator }
    this.creatorExposure = new Map(); // creator -> usd
    this.dayGuard = new DayGuard(equity);
    this.halted = false;
  }

  /**
   * 开仓前必调（按 RISK-MODEL.md 第 4 章顺序）。
   * @param {object} o
   *   tokenAddress, creator, entryPrice, stopPrice, equityNow,
   *   radar: { score, level, fatal:boolean, launchedAtSec }（已扫好传进来，保持本模块纯决策）
   *   slippagePct: quoter 预检出的滑点（小数）
   * @returns {{ allowed:boolean, sizeUsd:number, reason:string }}
   */
  requestOpen({ tokenAddress, creator, entryPrice, stopPrice, equityNow, radar, slippagePct }) {
    const deny = (reason) => ({ allowed: false, sizeUsd: 0, reason });

    // 1. 停火线
    if (this.halted || equityNow <= this.reserveLine) {
      this.halted = true;
      return deny(`净值 $${equityNow.toFixed(0)} ≤ 储备线 $${this.reserveLine.toFixed(0)}，停火。储备金不动。`);
    }
    // 2. DayGuard
    if (!this.dayGuard.canTrade()) return deny(`DayGuard 熔断：${this.dayGuard.pauseReason}`);
    // 3. Radar 门禁
    if (!radar || typeof radar.score !== 'number') return deny('无 Radar 评分，不开仓');
    if (radar.fatal) return deny(`Radar 致命信号（${radar.level}），不开仓`);
    const ageSec = radar.launchedAtSec ? (Date.now() / 1000 - radar.launchedAtSec) : Infinity;
    const need = ageSec < this.freshTokenSecs ? this.freshTokenMinScore : this.minRadarScore;
    if (radar.score < need) {
      return deny(`Radar ${radar.score} 分 < 门禁 ${need} 分${ageSec < this.freshTokenSecs ? '（新币加严）' : ''}，不开仓`);
    }
    // 4/5. 单币 & 创建者上限
    const tokenHeld = this.positions.get(tokenAddress)?.usd || 0;
    const creatorHeld = this.creatorExposure.get(creator || 'unknown') || 0;
    // 6. 滑点预检
    if (slippagePct != null && slippagePct > this.maxSlippagePct) {
      return deny(`滑点 ${(slippagePct * 100).toFixed(2)}% > 上限 ${(this.maxSlippagePct * 100).toFixed(0)}%，不追`);
    }
    // 7. 仓位计算：1% 风险倒推，并受单币/创建者/预算三重上限
    const sizeByRisk = sizeForRisk(equityNow, this.maxRiskPct, entryPrice, stopPrice, 1);
    const capToken = this.budget * this.maxTokenPct - tokenHeld;
    const capCreator = this.budget * this.maxCreatorPct - creatorHeld;
    const capBudget = this.budget - this.used;
    const sizeUsd = Math.min(sizeByRisk, capToken, capCreator, capBudget);
    if (capToken <= 0) return deny(`单币持仓已达上限（预算 20%），不开`);
    if (capCreator <= 0) return deny(`该创建者持仓已达上限（预算 30%），不开`);
    if (sizeUsd < this.minOrderUsd) {
      return deny(`批单 $${sizeUsd.toFixed(2)} < 最小 $${this.minOrderUsd}，不开`);
    }
    return {
      allowed: true,
      sizeUsd,
      reason: `开仓通过｜风险仓位$${sizeByRisk.toFixed(2)} 单币剩$${capToken.toFixed(0)} 创建者剩$${capCreator.toFixed(0)} 预算剩$${capBudget.toFixed(0)} → 批 $${sizeUsd.toFixed(2)}｜Radar ${radar.score}分`,
    };
  }

  /** 持仓中 Radar 重扫：跌破 dangerScore → 强制离场信号 */
  radarWatch(tokenAddress, radar) {
    if (!this.positions.has(tokenAddress)) return { dump: false };
    if (radar && (radar.fatal || radar.score < this.dangerScore)) {
      return { dump: true, reason: `Radar 跌破 ${this.dangerScore} 分（现 ${radar.score}），强制离场` };
    }
    return { dump: false };
  }

  onFill({ tokenAddress, creator, usd }) {
    this.used += usd;
    const p = this.positions.get(tokenAddress) || { usd: 0, creator };
    p.usd += usd;
    this.positions.set(tokenAddress, p);
    const c = creator || 'unknown';
    this.creatorExposure.set(c, (this.creatorExposure.get(c) || 0) + usd);
  }

  onClose({ tokenAddress, creator, usd, pnlUsd, equityNow }) {
    this.used = Math.max(0, this.used - usd);
    const p = this.positions.get(tokenAddress);
    if (p) { p.usd = Math.max(0, p.usd - usd); if (p.usd <= 0) this.positions.delete(tokenAddress); }
    const c = creator || 'unknown';
    this.creatorExposure.set(c, Math.max(0, (this.creatorExposure.get(c) || 0) - usd));
    if (typeof pnlUsd === 'number') this.dayGuard.registerTrade(pnlUsd, equityNow);
  }

  status(equityNow) {
    return {
      equity: equityNow, reserveLine: this.reserveLine, budget: this.budget,
      used: +this.used.toFixed(2), budgetLeft: +(this.budget - this.used).toFixed(2),
      openPositions: this.positions.size, halted: this.halted,
      dayPnl: +this.dayGuard.dayPnl.toFixed(2), dayHalted: this.dayGuard.halted,
    };
  }
}

module.exports = { SpotGuard };
