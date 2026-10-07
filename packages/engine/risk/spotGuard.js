'use strict';
/**
 * spotGuard.js — spot master controller
 *
 * Implements the pre-entry checklist from docs/RISK-MODEL.md chapter 4.
 * Changes vs perps-legacy/accountGuard.js:
 *   Removed: leverage rules, crash table, liquidation line (spot can't liquidate)
 *   Added: Radar score gate, slippage pre-check, per-token/per-creator position caps
 *   Kept: capital split ($500 trading / $500 reserve, halt below $500 equity), DayGuard, 1% per-trade risk
 */
const { sizeForRisk, DayGuard } = require('./exit.js');

class SpotGuard {
  constructor({
    equity = 1000,
    tradingPct = 0.5,
    maxRiskPct = 0.01,        // max 1% of equity risked per trade
    minRadarScore = 60,       // min Radar score to open
    dangerScore = 35,         // score below this while holding → forced exit
    freshTokenMinScore = 70,  // stricter for tokens launched <30min ago
    freshTokenSecs = 1800,
    maxSlippagePct = 0.03,    // slippage cap 3%
    maxTokenPct = 0.20,       // per-token ≤ 20% of budget
    maxCreatorPct = 0.30,     // per-creator ≤ 30% of budget
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
    this.used = 0;                    // budget already used
    this.positions = new Map();       // tokenAddress -> { usd, creator }
    this.creatorExposure = new Map(); // creator -> usd
    this.dayGuard = new DayGuard(equity);
    this.halted = false;
  }

  /**
   * Must be called before every entry (in RISK-MODEL.md chapter 4 order).
   * @param {object} o
   *   tokenAddress, creator, entryPrice, stopPrice, equityNow,
   *   radar: { score, level, fatal:boolean, launchedAtSec } (pre-scanned; keeps this module pure decision logic)
   *   slippagePct: pre-checked slippage from the quoter (decimal)
   * @returns {{ allowed:boolean, sizeUsd:number, reason:string }}
   */
  requestOpen({ tokenAddress, creator, entryPrice, stopPrice, equityNow, radar, slippagePct }) {
    const deny = (reason) => ({ allowed: false, sizeUsd: 0, reason });

    // 1. Kill switch
    if (this.halted || equityNow <= this.reserveLine) {
      this.halted = true;
      return deny(`equity $${equityNow.toFixed(0)} ≤ reserve line $${this.reserveLine.toFixed(0)} — halted. Reserve untouched.`);
    }
    // 2. DayGuard
    if (!this.dayGuard.canTrade()) return deny(`DayGuard tripped: ${this.dayGuard.pauseReason}`);
    // 3. Radar gate
    if (!radar || typeof radar.score !== 'number') return deny('no Radar score — no entry');
    if (radar.fatal) return deny(`Radar fatal signal (${radar.level}) — no entry`);
    const ageSec = radar.launchedAtSec ? (Date.now() / 1000 - radar.launchedAtSec) : Infinity;
    const need = ageSec < this.freshTokenSecs ? this.freshTokenMinScore : this.minRadarScore;
    if (radar.score < need) {
      return deny(`Radar ${radar.score} < gate ${need}${ageSec < this.freshTokenSecs ? ' (stricter for fresh tokens)' : ''} — no entry`);
    }
    // 4/5. Per-token & creator caps
    const tokenHeld = this.positions.get(tokenAddress)?.usd || 0;
    const creatorHeld = this.creatorExposure.get(creator || 'unknown') || 0;
    // 6. Slippage pre-check
    if (slippagePct != null && slippagePct > this.maxSlippagePct) {
      return deny(`slippage ${(slippagePct * 100).toFixed(2)}% > cap ${(this.maxSlippagePct * 100).toFixed(0)}% — skip`);
    }
    // 7. Position sizing: backed out from 1% risk, capped by token/creator/budget limits
    const sizeByRisk = sizeForRisk(equityNow, this.maxRiskPct, entryPrice, stopPrice, 1);
    const capToken = this.budget * this.maxTokenPct - tokenHeld;
    const capCreator = this.budget * this.maxCreatorPct - creatorHeld;
    const capBudget = this.budget - this.used;
    const sizeUsd = Math.min(sizeByRisk, capToken, capCreator, capBudget);
    if (capToken <= 0) return deny(`per-token cap reached (20% of budget) — no entry`);
    if (capCreator <= 0) return deny(`per-creator cap reached (30% of budget) — no entry`);
    if (sizeUsd < this.minOrderUsd) {
      return deny(`order $${sizeUsd.toFixed(2)} < min $${this.minOrderUsd} — no entry`);
    }
    return {
      allowed: true,
      sizeUsd,
      reason: `ENTRY OK | risk-sized $${sizeByRisk.toFixed(2)} token-room $${capToken.toFixed(0)} creator-room $${capCreator.toFixed(0)} budget-room $${capBudget.toFixed(0)} → 批 $${sizeUsd.toFixed(2)}｜Radar ${radar.score}分`,
    };
  }

  /** Radar rescan on open positions: score below dangerScore → forced exit signal */
  radarWatch(tokenAddress, radar) {
    if (!this.positions.has(tokenAddress)) return { dump: false };
    if (radar && (radar.fatal || radar.score < this.dangerScore)) {
      return { dump: true, reason: `Radar broke below ${this.dangerScore} (now ${radar.score}) — forced exit` };
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
