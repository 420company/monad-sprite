'use strict';
/**
 * fusion.js —— 双脑融合决策器（CommonJS，对接 zalien 真实接口）
 *
 * 真实接口（2026-10-07 已验证）：
 *   const { impl } = require('./vendor/analyze');
 *   const a = await impl.analyze_market('BTCUSDT');
 *   // a = { symbol, price, direction_score(-100~100), lean('偏多'/'偏空'/'中性'),
 *   //        confidence('高'/'中'/'低'), timeframes:{ daily,h4:{atr14,...},h1 },
 *   //        trade_plan, t144, support_resistance, ... }
 *   const { rankCandidate } = require('./vendor/picks');
 *   const score = rankCandidate(a, { vol_usdt: 1234567 });
 */

const CONF_MAP = { 高: 'high', 中: 'medium', 低: 'low', high: 'high', medium: 'medium', low: 'low' };

/**
 * zalienToSignal(analysis) —— 把 analyze_market 输出转成融合器标准信号
 * 返回 { symbol, score, confidence('high'|'medium'|'low'), atr, price }
 * atr 优先级：timeframes.h4.atr14 → trade_plan 里找 → price*0.01 兜底
 */
function zalienToSignal(analysis) {
  if (!analysis || typeof analysis !== 'object') throw new Error('analysis 为空');
  const h4 = analysis.timeframes && analysis.timeframes.h4;
  let atr = h4 && typeof h4.atr14 === 'number' && h4.atr14 > 0 ? h4.atr14 : null;
  if (atr == null && analysis.trade_plan) {
    // trade_plan 里有时带 atr 字段，宽容查找
    const tp = analysis.trade_plan;
    const cand = tp.atr14 || tp.atr || (tp.stop && tp.stop.atr);
    if (typeof cand === 'number' && cand > 0) atr = cand;
  }
  const price = Number(analysis.price) || 0;
  if (atr == null) atr = price > 0 ? price * 0.01 : 0;
  return {
    symbol: analysis.symbol || 'UNKNOWN',
    score: Number(analysis.direction_score) || 0,
    confidence: CONF_MAP[analysis.confidence] || 'low',
    atr,
    price,
  };
}

/**
 * FlySignal —— 果蝇大脑信号接口（真实字段）
 *
 * 真实果蝇（aster.py）在用户服务器上，测试时用 mockFly()。
 * 真实信号插进来时字段长这样：
 *   { symbol: 'BTCUSDT', direction: 'long'|'short'|'flat', strength: 0~1,
 *     confidence?: 0~1, timestamp?: ms, source: 'stonkfly' }
 */
function mockFly(symbol, direction = 'long', strength = 0.7) {
  return {
    symbol,
    direction, // 'long' | 'short' | 'flat'
    strength, // 0~1
    source: 'mock-fly (真实果蝇接入时替换为 aster.py 输出)',
    timestamp: Date.now(),
  };
}

/**
 * fuse(fly, z, entryPrice) —— 融合决策
 * 规则（按蓝图）：
 *   双信号同向 且 |zalien|>40 → open（仓位按置信度 高3%/中1.5%/低0.5%）
 *   单信号 → watch（观察池）
 *   无信号 → skip
 * 返回含止损止盈价的决策对象，可直接喂给 exitEngine 建仓
 */
function fuse(fly, z, entryPrice) {
  const zalienSide = z.score > 15 ? 'long' : z.score < -15 ? 'short' : 'flat';
  const flyDir = fly && (fly.direction === 'long' || fly.direction === 'short') ? fly.direction : 'flat';
  const aligned = flyDir !== 'flat' && flyDir === zalienSide;
  const strongZalien = Math.abs(z.score) > 40;

  if (aligned && strongZalien) {
    const sizePct = z.confidence === 'high' ? 3 : z.confidence === 'medium' ? 1.5 : 0.5;
    const dir = zalienSide === 'long' ? 1 : -1;
    const trailAtr = 1.5 * (z.atr || 0);
    return {
      action: 'open',
      symbol: z.symbol,
      side: zalienSide,
      sizePct,
      entryPrice,
      stopLoss: entryPrice * (1 - dir * 0.02),
      takeProfit1: entryPrice * (1 + dir * 0.02),
      takeProfit2: entryPrice * (1 + dir * 0.04),
      trailAtrMult: 1.5,
      trailAtr,
      reason: `双脑同向：果蝇${flyDir}(强度${Math.round((fly.strength || 0) * 100)}%) + 量化${z.score}分(置信度${z.confidence})`,
    };
  }
  if (zalienSide !== 'flat' || flyDir !== 'flat') {
    return { action: 'watch', symbol: z.symbol, reason: '单信号，进观察池' };
  }
  return { action: 'skip', symbol: z.symbol, reason: '无信号' };
}

module.exports = { zalienToSignal, mockFly, fuse, CONF_MAP };
