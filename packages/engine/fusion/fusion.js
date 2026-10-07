'use strict';
/**
 * fusion.js — dual-brain fusion decider (CommonJS, wired to real zalien interfaces)
 *
 * Real interfaces (verified 2026-10-07):
 *   const { impl } = require('./vendor/analyze');
 *   const a = await impl.analyze_market('BTCUSDT');
 *   // a = { symbol, price, direction_score(-100~100), lean('bullish'/'bearish'/'neutral'),
 *   //        confidence('high'/'medium'/'low'), timeframes:{ daily,h4:{atr14,...},h1 },
 *   //        trade_plan, t144, support_resistance, ... }
 *   const { rankCandidate } = require('./vendor/picks');
 *   const score = rankCandidate(a, { vol_usdt: 1234567 });
 */

const CONF_MAP = { 高: 'high', 中: 'medium', 低: 'low', high: 'high', medium: 'medium', low: 'low' };

/**
 * zalienToSignal(analysis) — converts analyze_market output into the fusion-standard signal
 * Returns { symbol, score, confidence('high'|'medium'|'low'), atr, price }
 * atr priority: timeframes.h4.atr14 → look inside trade_plan → price*0.01 fallback
 */
function zalienToSignal(analysis) {
  if (!analysis || typeof analysis !== 'object') throw new Error('analysis 为空');
  const h4 = analysis.timeframes && analysis.timeframes.h4;
  let atr = h4 && typeof h4.atr14 === 'number' && h4.atr14 > 0 ? h4.atr14 : null;
  if (atr == null && analysis.trade_plan) {
    // trade_plan sometimes carries atr — look it up tolerantly
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
 * FlySignal — fly-brain signal interface (real fields)
 *
 * The real fly (aster.py) runs on the user's server; tests use mockFly().
 * Real signal fields look like this when plugged in:
 *   { symbol: 'BTCUSDT', direction: 'long'|'short'|'flat', strength: 0~1,
 *     confidence?: 0~1, timestamp?: ms, source: 'stonkfly' }
 */
function mockFly(symbol, direction = 'long', strength = 0.7) {
  return {
    symbol,
    direction, // 'long' | 'short' | 'flat'
    strength, // 0~1
    source: 'mock-fly (replaced by aster.py output on real integration)',
    timestamp: Date.now(),
  };
}

/**
 * fuse(fly, z, entryPrice) — fusion decision
 * Rules (per blueprint):
 *   Both brains agree and |zalien|>40 → open (size by confidence: high 3% / medium 1.5% / low 0.5%)
 *   Single signal → watch (watchlist)
 *   No signal → skip
 * Returns a decision object with stop-loss/take-profit prices, feedable straight into exitEngine for entries
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
    return { action: 'watch', symbol: z.symbol, reason: 'single signal — watchlist' };
  }
  return { action: 'skip', symbol: z.symbol, reason: 'no signal' };
}

module.exports = { zalienToSignal, mockFly, fuse, CONF_MAP };
