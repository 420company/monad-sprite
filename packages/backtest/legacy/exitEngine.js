/**
 * exitEngine.js —— 退出引擎（CommonJS）
 *
 * 退出纪律：
 *  1. 分级止盈：+2% 止一半，+4% 全止
 *  2. 追踪止损：1.5×ATR，盈利后止损线上移（只上移不下移）
 *  3. 时间止损：开仓 4H 无方向（|pnl|<0.5%）→ 平
 *  4. 硬止损：-2% 无条件砍
 *
 * checkExit(position, curPrice, now) → 动作对象
 */
'use strict';

function checkExit(p, curPrice, now) {
  const dir = p.side === 'long' ? 1 : -1;
  const pnlPct = curPrice > 0 ? ((curPrice - p.entryPrice) / p.entryPrice) * dir : 0;

  // 4. 硬止损：-2% 无条件
  if (pnlPct <= -0.02) return { type: 'stop_out', reason: '硬止损 -2%' };

  // 3. 时间止损：4 小时无方向
  if (now - p.openedAt > 4 * 3600 * 1000 && Math.abs(pnlPct) < 0.005) {
    return { type: 'stop_out', reason: '时间止损：4H 无方向' };
  }

  // 1. 分级止盈
  if (!p.tp1Done && pnlPct >= 0.02) return { type: 'take_profit_1', closePct: 50 };
  if (p.tp1Done && pnlPct >= 0.04) return { type: 'take_profit_2', closePct: 100 };

  // 2. 追踪止损：盈利后止损线上移（只上移不下移）
  const trailStop = p.side === 'long' ? curPrice - p.trailAtr : curPrice + p.trailAtr;
  const betterStop =
    p.side === 'long' ? Math.max(p.stopLoss, trailStop) : Math.min(p.stopLoss, trailStop);
  if (betterStop !== p.stopLoss) return { type: 'hold', newStopLoss: betterStop };

  // 跌破（追踪）止损线
  const hitStop = p.side === 'long' ? curPrice <= p.stopLoss : curPrice >= p.stopLoss;
  if (hitStop && pnlPct > -0.02) return { type: 'stop_out', reason: '追踪止损触发' };

  return { type: 'hold' };
}

/**
 * applyExit(state, action, curPrice) —— 把动作执行到仓位状态上
 * state: { remainingUsd, realizedUsd, position }（position 可变）
 * 止损成交按止损价（更贴近实盘），止盈按当前 tick 价
 */
function applyExit(state, action, curPrice) {
  const p = state.position;
  if (!p) return null;
  const dir = p.side === 'long' ? 1 : -1;

  if (action.type === 'take_profit_1') {
    const closeUsd = state.remainingUsd * (action.closePct / 100);
    const pnl = closeUsd * (((curPrice - p.entryPrice) / p.entryPrice) * dir);
    state.remainingUsd -= closeUsd;
    state.realizedUsd += pnl;
    p.tp1Done = true;
    return { closedUsd: closeUsd, pnl, price: curPrice, note: `TP1 +2% 平${action.closePct}%` };
  }
  if (action.type === 'take_profit_2') {
    const closeUsd = state.remainingUsd;
    const pnl = closeUsd * (((curPrice - p.entryPrice) / p.entryPrice) * dir);
    state.remainingUsd = 0;
    state.realizedUsd += pnl;
    state.position = null;
    return { closedUsd: closeUsd, pnl, price: curPrice, note: 'TP2 +4% 全平' };
  }
  if (action.type === 'stop_out') {
    // 止损按止损价成交（long 取 max(stop, tick)，short 取 min）
    const fill = p.side === 'long' ? Math.max(p.stopLoss, curPrice) : Math.min(p.stopLoss, curPrice);
    const closeUsd = state.remainingUsd;
    const pnl = closeUsd * (((fill - p.entryPrice) / p.entryPrice) * dir);
    state.remainingUsd = 0;
    state.realizedUsd += pnl;
    state.position = null;
    return { closedUsd: closeUsd, pnl, price: fill, note: `止损: ${action.reason}` };
  }
  if (action.type === 'hold' && action.newStopLoss != null) {
    p.stopLoss = action.newStopLoss;
    return { note: `追踪止损上移 → ${action.newStopLoss.toFixed(2)}` };
  }
  return { note: '持有' };
}

module.exports = { checkExit, applyExit };
