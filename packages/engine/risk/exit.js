/**
 * exitEngineV2.js —— 退出引擎 v2（真钱版）
 *
 * 相对 v1 的升级（v1 是固定 +2%/+4%/-2%，在 meme 币上不是太紧就是太松）：
 *  1. ATR 倍数代替固定百分比：止损 -1×ATR，TP1 +1.5×ATR，TP2 +3×ATR —— 波动大自动放宽
 *  2. 结构止盈止损：优先用 zalien 现成的支撑阻力区间（buildZones），而不是拍脑袋的百分比
 *  3. Chandelier 追踪：最高点 - 2.5×ATR，比 v1 的简单追踪锁住更多利润
 *  4. 保本移动：TP1 成交后，止损移到开单价 + 手续费（这单再也亏不了钱）
 *  5. 信号反转离场：direction_score 强反转 → 直接离场，不等止损被扫
 *  6. 固定风险仓位 sizeForRisk：每笔只冒本金的 1%，仓位按止损距离倒推
 *  7. DayGuard 每日熔断：单日 -3% 停手，连亏 3 笔暂停 —— 保命装置
 */
'use strict';

// ---------- 开仓时生成退出计划 ----------
function planExit({ side, entryPrice, atr, zones, directionScore, now = Date.now() }) {
  const dir = side === 'long' ? 1 : -1;
  const A = atr && atr > 0 ? atr : entryPrice * 0.01;

  // ATR 基准位
  const atrStop = entryPrice - dir * 1.0 * A;
  const atrTp1 = entryPrice + dir * 1.5 * A;
  const atrTp2 = entryPrice + dir * 3.0 * A;

  // 结构位（zalien support_resistance）：支撑做止损锚，阻力做止盈锚
  let stop = atrStop, tp1 = atrTp1, tp2 = atrTp2;
  const used = [];
  try {
    const sup = (zones?.support || []).filter((z) => (side === 'long' ? z.high < entryPrice : z.low > entryPrice));
    const res = (zones?.resistance || []).filter((z) => (side === 'long' ? z.low > entryPrice : z.high < entryPrice));
    if (side === 'long') {
      // 止损：最近支撑下沿，但不放宽超 2×ATR、不收紧超 0.5×ATR
      if (sup[0]) {
        const sStop = sup[0].low - 0.3 * A;
        if (sStop < entryPrice && entryPrice - sStop <= 2 * A && entryPrice - sStop >= 0.5 * A) { stop = sStop; used.push('支撑止损'); }
      }
      if (res[0] && res[0].low - entryPrice <= 8 * A && res[0].low > entryPrice) { tp1 = res[0].low; used.push('阻力TP1'); }
      if (res[1] && res[1].low - entryPrice <= 8 * A && res[1].low > tp1) { tp2 = res[1].low; used.push('阻力TP2'); }
    } else {
      if (sup[0]) { // 做空时下方支撑是止盈目标
        if (entryPrice - sup[0].high <= 8 * A && sup[0].high < entryPrice) { tp1 = sup[0].high; used.push('支撑TP1'); }
      }
      const res0 = (zones?.resistance || []).filter((z) => z.low > entryPrice)[0];
      if (res0) {
        const sStop = res0.high + 0.3 * A;
        if (sStop > entryPrice && sStop - entryPrice <= 2 * A && sStop - entryPrice >= 0.5 * A) { stop = sStop; used.push('阻力止损'); }
      }
    }
  } catch { /* 结构位缺失就用 ATR 基准 */ }

  return {
    side, entryPrice, atr: A, stopLoss: stop, tp1, tp2,
    tp1Done: false, breakevenDone: false,
    extremeHigh: entryPrice, extremeLow: entryPrice, // chandelier 用
    trailMult: 2.5, entryScore: directionScore ?? null,
    openedAt: now, usedLevels: used.length ? used : ['ATR基准'],
  };
}

// ---------- 每个 tick 检查 ----------
function checkExitV2(p, tick, now = Date.now()) {
  const { price, high, low, directionScore } = tick;
  const dir = p.side === 'long' ? 1 : -1;
  const pnlPct = ((price - p.entryPrice) / p.entryPrice) * dir;

  // 7. 硬止损（ATR 倍数）：-1×ATR 无条件砍
  if (pnlPct <= -(p.atr / p.entryPrice)) return { type: 'stop_out', reason: `硬止损 -1×ATR(${(p.atr / p.entryPrice * 100).toFixed(2)}%)` };

  // 5. 信号反转离场：当初看多(+分)开仓，现在分数强反转 → 不等止损
  if (p.entryScore != null && directionScore != null) {
    const wasLong = p.entryScore > 15, wasShort = p.entryScore < -15;
    const nowShort = directionScore < -25, nowLong = directionScore > 25;
    if ((wasLong && nowShort) || (wasShort && nowLong)) {
      return { type: 'stop_out', reason: `信号反转离场（${p.entryScore}→${directionScore}）` };
    }
  }

  // 时间止损：4H 无方向（|pnl| < 0.5×ATR）→ 平
  if (now - p.openedAt > 4 * 3600 * 1000 && Math.abs(pnlPct) < 0.5 * (p.atr / p.entryPrice)) {
    return { type: 'stop_out', reason: '时间止损：4H 无方向' };
  }

  // 分级止盈（结构位 / ATR 倍数位）
  if (!p.tp1Done && dir * (price - p.tp1) >= 0) return { type: 'take_profit_1', closePct: 50 };
  if (p.tp1Done && dir * (price - p.tp2) >= 0) return { type: 'take_profit_2', closePct: 100 };

  // 3+4. Chandelier 追踪 + TP1 后保本
  const hh = Math.max(p.extremeHigh, high ?? price);
  const ll = Math.min(p.extremeLow, low ?? price);
  let newStop = p.stopLoss, note = null;
  if (p.side === 'long') {
    const chand = hh - p.trailMult * p.atr;
    if (chand > newStop) { newStop = chand; note = 'Chandelier'; }
    if (p.tp1Done && !p.breakevenDone) { // 保本：移到开单价上方一点（cover 手续费）
      const be = p.entryPrice * 1.0005;
      if (be > newStop) { newStop = be; note = '保本移动'; }
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
  if (note === '保本移动') upd.breakevenDone = true;
  if (newStop !== p.stopLoss) return { type: 'hold', newStopLoss: newStop, update: upd, note };

  // 跌破止损线
  const hitStop = p.side === 'long' ? price <= p.stopLoss : price >= p.stopLoss;
  if (hitStop) return { type: 'stop_out', reason: '追踪止损触发' };

  return { type: 'hold', update: upd };
}

// ---------- 执行动作（与 v1 同口径） ----------
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

// ---------- 6. 固定风险仓位：每笔只冒 riskPct 本金 ----------
// 止损宽 → 仓位小；止损窄 → 仓位大；每笔亏的钱一样多。另设单笔上限防穿仓。
function sizeForRisk(equity, riskPct, entryPrice, stopPrice, maxPosPct = 0.3) {
  const stopDistPct = Math.abs(entryPrice - stopPrice) / entryPrice;
  if (!stopDistPct || !isFinite(stopDistPct)) return 0;
  const riskUsd = equity * riskPct;
  const byRisk = riskUsd / stopDistPct;
  return Math.min(byRisk, equity * maxPosPct);
}

// ---------- 7. DayGuard 每日熔断 ----------
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
