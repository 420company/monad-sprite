/**
 * exitEngineV2.js — exit engine v2 (real-money edition)
 *
 * Upgrades over v1 (fixed +2%/+4%/-2% was too tight or too loose for meme coins):
 *  1. ATR multiples instead of fixed %: stop -1xATR, TP1 +1.5xATR, TP2 +3xATR — widens automatically in volatility
 *  2. Structural TP/SL: prefers zalien's support/resistance zones (buildZones) over guessed percentages
 *  3. Chandelier trailing: peak - 2.5xATR locks in more profit than v1's simple trail
 *  4. Breakeven move: after TP1 fills, stop moves to entry + fees (trade can't lose anymore)
 *  5. Signal-reversal exit: strong direction_score reversal → exit immediately, don't wait for the stop
 *  6. Fixed-risk sizing (sizeForRisk): risk 1% of equity per trade, size backed out from stop distance
 *  7. DayGuard daily circuit breaker: -3% day stops trading, 3 consecutive losses pause — the survival device
 */
'use strict';

// ---------- build exit plan at entry ----------
function planExit({ side, entryPrice, atr, zones, directionScore, now = Date.now() }) {
  const dir = side === 'long' ? 1 : -1;
  const A = atr && atr > 0 ? atr : entryPrice * 0.01;

  // ATR reference levels
  const atrStop = entryPrice - dir * 1.0 * A;
  const atrTp1 = entryPrice + dir * 1.5 * A;
  const atrTp2 = entryPrice + dir * 3.0 * A;

  // Structural levels (zalien support_resistance): support anchors the stop, resistance anchors profit targets
  let stop = atrStop, tp1 = atrTp1, tp2 = atrTp2;
  const used = [];
  try {
    const sup = (zones?.support || []).filter((z) => (side === 'long' ? z.high < entryPrice : z.low > entryPrice));
    const res = (zones?.resistance || []).filter((z) => (side === 'long' ? z.low > entryPrice : z.high < entryPrice));
    if (side === 'long') {
      // Stop: below nearest support, but never wider than 2xATR or tighter than 0.5xATR
      if (sup[0]) {
        const sStop = sup[0].low - 0.3 * A;
        if (sStop < entryPrice && entryPrice - sStop <= 2 * A && entryPrice - sStop >= 0.5 * A) { stop = sStop; used.push('支撑止损'); }
      }
      if (res[0] && res[0].low - entryPrice <= 8 * A && res[0].low > entryPrice) { tp1 = res[0].low; used.push('阻力TP1'); }
      if (res[1] && res[1].low - entryPrice <= 8 * A && res[1].low > tp1) { tp2 = res[1].low; used.push('阻力TP2'); }
    } else {
      if (sup[0]) { // for shorts, support below is the TP target
        if (entryPrice - sup[0].high <= 8 * A && sup[0].high < entryPrice) { tp1 = sup[0].high; used.push('支撑TP1'); }
      }
      const res0 = (zones?.resistance || []).filter((z) => z.low > entryPrice)[0];
      if (res0) {
        const sStop = res0.high + 0.3 * A;
        if (sStop > entryPrice && sStop - entryPrice <= 2 * A && sStop - entryPrice >= 0.5 * A) { stop = sStop; used.push('阻力止损'); }
      }
    }
  } catch { /* fall back to ATR levels when structural levels are missing */ }

  return {
    side, entryPrice, atr: A, stopLoss: stop, tp1, tp2,
    tp1Done: false, breakevenDone: false,
    extremeHigh: entryPrice, extremeLow: entryPrice, // for chandelier
    trailMult: 2.5, entryScore: directionScore ?? null,
    openedAt: now, usedLevels: used.length ? used : ['ATR-based'],
  };
}

// ---------- per-tick checks ----------
function checkExitV2(p, tick, now = Date.now()) {
  const { price, high, low, directionScore } = tick;
  const dir = p.side === 'long' ? 1 : -1;
  const pnlPct = ((price - p.entryPrice) / p.entryPrice) * dir;

  // 7. Hard stop (ATR multiple): -1xATR cuts unconditionally
  if (pnlPct <= -(p.atr / p.entryPrice)) return { type: 'stop_out', reason: `hard stop -1xATR(${(p.atr / p.entryPrice * 100).toFixed(2)}%)` };

  // 5. Signal-reversal exit: entered long on positive score, now strongly reversed → don't wait for the stop
  if (p.entryScore != null && directionScore != null) {
    const wasLong = p.entryScore > 15, wasShort = p.entryScore < -15;
    const nowShort = directionScore < -25, nowLong = directionScore > 25;
    if ((wasLong && nowShort) || (wasShort && nowLong)) {
      return { type: 'stop_out', reason: `signal reversal exit (${p.entryScore}→${directionScore})` };
    }
  }

  // Time stop: no direction for 4H (|pnl| < 0.5xATR) → flatten
  if (now - p.openedAt > 4 * 3600 * 1000 && Math.abs(pnlPct) < 0.5 * (p.atr / p.entryPrice)) {
    return { type: 'stop_out', reason: 'time stop: no direction for 4H' };
  }

  // Scaled profit-taking (structural / ATR-multiple levels)
  if (!p.tp1Done && dir * (price - p.tp1) >= 0) return { type: 'take_profit_1', closePct: 50 };
  if (p.tp1Done && dir * (price - p.tp2) >= 0) return { type: 'take_profit_2', closePct: 100 };

  // 3+4. Chandelier trailing + breakeven after TP1
  const hh = Math.max(p.extremeHigh, high ?? price);
  const ll = Math.min(p.extremeLow, low ?? price);
  let newStop = p.stopLoss, note = null;
  if (p.side === 'long') {
    const chand = hh - p.trailMult * p.atr;
    if (chand > newStop) { newStop = chand; note = 'Chandelier'; }
    if (p.tp1Done && !p.breakevenDone) { // breakeven: move slightly above entry (cover fees)
      const be = p.entryPrice * 1.0005;
      if (be > newStop) { newStop = be; note = 'breakeven move'; }
    }
  } else {
    const chand = ll + p.trailMult * p.atr;
    if (chand < newStop) { newStop = chand; note = 'Chandelier'; }
    if (p.tp1Done && !p.breakevenDone) {
      const be = p.entryPrice * 0.9995;
      if (be < newStop) { newStop = be; note = '保本移动'; }
    }
  }
  const upd = { extremeHigh: hh, extremeLow: ll };
  if (note === 'breakeven move') upd.breakevenDone = true;
  if (newStop !== p.stopLoss) return { type: 'hold', newStopLoss: newStop, update: upd, note };

  // Stop line broken
  const hitStop = p.side === 'long' ? price <= p.stopLoss : price >= p.stopLoss;
  if (hitStop) return { type: 'stop_out', reason: '追踪止损触发' };

  return { type: 'hold', update: upd };
}

// ---------- actions (same semantics as v1) ----------
function applyExitV2(state, action, price) {
  const p = state.position;
  if (!p) return null;
  const dir = p.side === 'long' ? 1 : -1;
  const closeAt = (usd, px) => usd * (((px - p.entryPrice) / p.entryPrice) * dir);

  if (action.type === 'take_profit_1') {
    const closeUsd = state.remainingUsd * (action.closePct / 100);
    const pnl = closeAt(closeUsd, price);
    state.remainingUsd -= closeUsd; state.realizedUsd += pnl; p.tp1Done = true;
    return { closedUsd: closeUsd, pnl, price, note: `TP1 平${action.closePct}%（${p.usedLevels.join('+')}）` };
  }
  if (action.type === 'take_profit_2') {
    const pnl = closeAt(state.remainingUsd, price);
    state.realizedUsd += pnl; state.remainingUsd = 0; state.position = null;
    return { closedUsd: 0, pnl, price, note: 'TP2 全平' };
  }
  if (action.type === 'stop_out') {
    const fill = p.side === 'long' ? Math.max(p.stopLoss, price) : Math.min(p.stopLoss, price);
    const pnl = closeAt(state.remainingUsd, fill);
    state.realizedUsd += pnl; state.remainingUsd = 0; state.position = null;
    return { closedUsd: 0, pnl, price: fill, note: `止损: ${action.reason}` };
  }
  if (action.type === 'hold') {
    if (action.update) Object.assign(p, action.update);
    if (action.newStopLoss != null) { p.stopLoss = action.newStopLoss; return { note: `${action.note || '追踪'} → 止损 ${action.newStopLoss.toFixed(4)}` }; }
    return { note: '持有' };
  }
  return { note: '持有' };
}

// ---------- 6. Fixed-risk sizing: risk riskPct of equity per trade ----------
// Wide stop → small size; tight stop → large size; same dollar loss per trade. Per-trade cap prevents blowups.
function sizeForRisk(equity, riskPct, entryPrice, stopPrice, maxPosPct = 0.3) {
  const stopDistPct = Math.abs(entryPrice - stopPrice) / entryPrice;
  if (!stopDistPct || !isFinite(stopDistPct)) return 0;
  const riskUsd = equity * riskPct;
  const byRisk = riskUsd / stopDistPct;
  return Math.min(byRisk, equity * maxPosPct);
}

// ---------- 7. DayGuard daily circuit breaker ----------
class DayGuard {
  constructor(equity, maxDayLossPct = 0.03, maxConsecLoss = 3) {
    this.startEquity = equity; this.maxDayLossPct = maxDayLossPct;
    this.maxConsecLoss = maxConsecLoss;
    this.dayPnl = 0; this.consecLoss = 0; this.halted = false; this.pauseReason = null;
  }
  registerTrade(pnlUsd, equityNow) {
    this.dayPnl += pnlUsd;
    this.consecLoss = pnlUsd < 0 ? this.consecLoss + 1 : 0;
    if (-this.dayPnl >= this.startEquity * this.maxDayLossPct) {
      this.halted = true; this.pauseReason = `单日亏损 ${(this.dayPnl / this.startEquity * 100).toFixed(2)}%，熔断停手`;
    } else if (this.consecLoss >= this.maxConsecLoss) {
      this.halted = true; this.pauseReason = `连亏 ${this.consecLoss} 笔，暂停`;
    }
    return { halted: this.halted, reason: this.pauseReason, dayPnl: this.dayPnl };
  }
  canTrade() { return !this.halted; }
}

module.exports = { planExit, checkExitV2, applyExitV2, sizeForRisk, DayGuard };
