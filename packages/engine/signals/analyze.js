'use strict';
/**
 * analyze_market — code-driven market analysis engine (GPT/Grok dual-review design, implemented).
 * Core principle: code handles fetching/compute/orchestration/scoring/QC; Gemini only renders structured market_state into prose.
 *
 * One call completes internally:
 *  · Parallel fetch: daily/4H/1H (300 candles each, closed only) + spot ticker + futures history (funding/OI/long-short/taker flow) + 6551 news
 *  · Per timeframe: EMA7/25/99, RSI14, MACD, ATR14, RVOL20, trend (EMA stack), market structure (HH-HL/LH-LL)
 *  · Futures use "change rates" not snapshots: OI 1H/4H/24H deltas, funding current/3d-avg/7d-quantile, long-short current/24h-change/quantile, taker imbalance
 *  · Support/resistance as tooling: Fib + EMA99 + swings + prior highs/lows as candidates, clustered into "zones" by 0.5xATR(4H) (with confluence/touches/strength)
 *  · Direction score (-100~100) separated from confidence (low/med/high), with evidence list; data-quality gates (asOf/completedCandlesOnly/missing/quality)
 * All read-only with timeouts; any non-critical source failure degrades gracefully (only halts if spot price is unavailable).
 */
const OKX = process.env.OKX_BASE || 'https://www.okx.com';
// sixfive (6551 news) lazy-loads optionally: degrades to null without token/file, main flow unaffected
let sixfive = null;
try { sixfive = require('./sixfive'); } catch { sixfive = null; }
const getCoinNews = (s, n) => {
  try {
    if (sixfive && sixfive.impl && typeof sixfive.impl.get_coin_news === 'function') {
      return sixfive.impl.get_coin_news(s, n).catch(() => null);
    }
  } catch { /* degrade */ }
  return Promise.resolve(null);
};

const j = async (u, ms = 8000) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); try { const r = await fetch(u, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); const d = await r.json(); if (d.code && d.code !== '0') throw new Error('OKX ' + d.code); return d; } finally { clearTimeout(t); } };
const sym = (s) => String(s || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
const base = (s) => s.replace(/USDT$/, '');
const spotId = (s) => base(s) + '-USDT';
const swapId = (s) => base(s) + '-USDT-SWAP';
const r2 = (x, n = 2) => (x == null || !isFinite(x)) ? null : +Number(x).toFixed(n);
const pct = (a, b) => (b ? +(((a - b) / b) * 100).toFixed(2) : null);

// ---------- indicators ----------
function emaLast(v, p) { const k = 2 / (p + 1); let e = v[0]; for (let i = 1; i < v.length; i++) e = v[i] * k + e * (1 - k); return e; }
function emaSeries(v, p) { const k = 2 / (p + 1); const out = [v[0]]; for (let i = 1; i < v.length; i++) out.push(v[i] * k + out[i - 1] * (1 - k)); return out; }
function smaSeries(v, p) { let sum = 0; return v.map((x, i) => { sum += x; if (i >= p) sum -= v[i - p]; return i >= p - 1 ? sum / p : null; }); }
function rsi(c, p = 14) { if (c.length < p + 1) return null; let g = 0, l = 0; for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d >= 0 ? g += d : l -= d; } g /= p; l /= p; for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (p - 1) + (d > 0 ? d : 0)) / p; l = (l * (p - 1) + (d < 0 ? -d : 0)) / p; } const rs = l === 0 ? 100 : g / l; return +(100 - 100 / (1 + rs)).toFixed(1); }
function macd(c) { if (c.length < 35) return null; const e = (arr, p) => { const k = 2 / (p + 1); const o = [arr[0]]; for (let i = 1; i < arr.length; i++) o.push(arr[i] * k + o[i - 1] * (1 - k)); return o; }; const e12 = e(c, 12), e26 = e(c, 26); const dif = c.map((_, i) => e12[i] - e26[i]); const dea = e(dif.slice(26), 9); const d = dif[dif.length - 1], s = dea[dea.length - 1]; return { dif: r2(d, 1), dea: r2(s, 1), hist: r2((d - s) * 2, 1) }; }
function atr(h, l, c, p = 14) { if (c.length < p + 1) return null; const tr = []; for (let i = 1; i < c.length; i++) tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))); let a = tr.slice(0, p).reduce((x, y) => x + y, 0) / p; for (let i = p; i < tr.length; i++) a = (a * (p - 1) + tr[i]) / p; return a; }
function rvol(vol, p = 20) { if (vol.length < p + 1) return null; const avg = vol.slice(-p - 1, -1).reduce((x, y) => x + y, 0) / p; return avg ? +(vol[vol.length - 1] / avg).toFixed(2) : null; }
// Swing points (fractal, width w): returns recent high/low sequence (old→new)
function swings(h, l, w = 2) { const hi = [], lo = []; for (let i = w; i < h.length - w; i++) { let ph = true, pl = true; for (let k = 1; k <= w; k++) { if (h[i] <= h[i - k] || h[i] <= h[i + k]) ph = false; if (l[i] >= l[i - k] || l[i] >= l[i + k]) pl = false; } if (ph) hi.push({ i, p: h[i] }); if (pl) lo.push({ i, p: l[i] }); } return { hi, lo }; }
function structureOf(sw) { const H = sw.hi.slice(-2), L = sw.lo.slice(-2); if (H.length < 2 || L.length < 2) return 'range'; const hh = H[1].p > H[0].p, hl = L[1].p > L[0].p, lh = H[1].p < H[0].p, ll = L[1].p < L[0].p; if (hh && hl) return 'up'; if (lh && ll) return 'down'; return 'range'; }

// ---------- single timeframe ----------
async function analyzeTF(s, bar) {
  const d = await j(`${OKX}/api/v5/market/candles?instId=${spotId(s)}&bar=${bar}&limit=300`);
  const raw = (d.data || []).slice().reverse();
  const k = raw.filter((c) => c[8] === '1'); // 只用已收盘
  if (k.length < 40) throw new Error(`${bar}: not enough closed candles`);
  const c = k.map((x) => +x[4]), h = k.map((x) => +x[2]), l = k.map((x) => +x[3]), v = k.map((x) => +x[5]);
  const o = k.map((x) => +x[1]), ts = k.map((x) => +x[0]);
  const e7 = emaLast(c, 7), e25 = emaLast(c, 25), e99 = emaLast(c, 99);
  const last = c[c.length - 1];
  const trend = e7 > e25 && e25 > e99 ? 'up' : e7 < e25 && e25 < e99 ? 'down' : 'mixed';
  const sw = swings(h, l, 2);
  const A = atr(h, l, c, 14);
  return {
    bar, closed: k.length, last_closed: r2(last, 2),
    ema7: r2(e7, 1), ema25: r2(e25, 1), ema99: r2(e99, 1), rsi14: rsi(c), macd: macd(c),
    atr14: r2(A, 2), atr_pct: r2(A / last * 100, 2), rvol20: rvol(v, 20),
    trend, structure: structureOf(sw), above_ema99: last > e99,
    period_high: r2(Math.max(...h), 2), period_low: r2(Math.min(...l), 2),
    _c: c, _h: h, _l: l, _o: o, _v: v, _t: ts, _sw: sw, _atr: A, // internal (not returned to model; stripped by main)
  };
}

// ---------- T-144 4H guardrail (closed candles only, adjusts original direction score by at most 10) ----------
function calculateT144(h4) {
  const c = h4 && h4._c; const h = h4 && h4._h; const l = h4 && h4._l;
  const o = h4 && h4._o; const v = h4 && h4._v; const ts = h4 && h4._t;
  if (!c || c.length < 144 || !h || !l || !o || !v) return { timeframe: '4H', completed_candles_only: true, quality: 'low', missing: ['4h_144_candles'], score_adjustment: 0, signals: [] };
  const e21 = emaSeries(c, 21), m55 = smaSeries(c, 55), m144 = smaSeries(c, 144);
  const i = c.length - 1, prev = i - 1; const close = c[i]; const ma144 = m144[i]; const atr14 = atr(h, l, c, 14);
  const avgVol20 = v.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  const volRatio = avgVol20 ? v[i] / avgVol20 : null;
  const clustered = Array.from({ length: Math.min(10, c.length - 143) }, (_, n) => i - n).some((x) => {
    const lines = [e21[x], m55[x], m144[x]]; const lo = Math.min(...lines), hi = Math.max(...lines);
    return lo > 0 && (hi - lo) / lo < 0.025;
  });
  const bullishAlignment = e21[i] > m55[i] && m55[i] > m144[i];
  const bearishAlignment = e21[i] < m55[i] && m55[i] < m144[i];
  const bullishBreakout = close > e21[i] && close > m55[i] && close > ma144 && e21[i] > e21[prev];
  const bearishBreakdown = close < e21[i] && close < m55[i] && close < ma144 && e21[i] < e21[prev];
  const bullishReclaim = c[prev] <= m144[prev] && close > ma144;
  const bearishReclaim = c[prev] >= m144[prev] && close < ma144;
  const priorLows = l.slice(-11, -1), priorHighs = h.slice(-11, -1);
  const sweptLow = Math.min(...priorLows), sweptHigh = Math.max(...priorHighs);
  const nearMA144 = Math.abs(close - ma144) / ma144 < 0.02;
  const bullish2B = l[i] < sweptLow && close > sweptLow && nearMA144 && close > o[i];
  const bearish2B = h[i] > sweptHigh && close < sweptHigh && nearMA144 && close < o[i];
  const signals = [];
  if (atr14 && Math.abs(close - ma144) > atr14 * 6) signals.push('EXTREME_DEVIATION');
  if (bullishReclaim) signals.push('MA144_BULLISH_RECLAIM');
  if (bearishReclaim) signals.push('MA144_BEARISH_RECLAIM');
  if (clustered && bullishBreakout) signals.push(volRatio > 1.5 ? 'BULLISH_RESONANCE_STRONG' : 'BULLISH_RESONANCE_WEAK');
  if (clustered && bearishBreakdown) signals.push(volRatio > 1.5 ? 'BEARISH_RESONANCE_STRONG' : 'BEARISH_RESONANCE_WEAK');
  if (bullish2B) signals.push('2B_BULLISH_RECLAIM');
  if (bearish2B) signals.push('2B_BEARISH_RECLAIM');
  let adjustment = close > ma144 ? 2 : close < ma144 ? -2 : 0;
  if (bullishAlignment) adjustment += 3; else if (bearishAlignment) adjustment -= 3;
  if (bullishReclaim) adjustment += 2; else if (bearishReclaim) adjustment -= 2;
  if (signals.includes('BULLISH_RESONANCE_STRONG')) adjustment += 3;
  else if (signals.includes('BULLISH_RESONANCE_WEAK')) adjustment += 2;
  else if (signals.includes('BEARISH_RESONANCE_STRONG')) adjustment -= 3;
  else if (signals.includes('BEARISH_RESONANCE_WEAK')) adjustment -= 2;
  if (bullish2B) adjustment += 3; else if (bearish2B) adjustment -= 3;
  adjustment = Math.max(-10, Math.min(10, adjustment));
  const posture = signals.includes('EXTREME_DEVIATION') ? 'WATCH' : close > ma144 && e21[i] > ma144 ? 'ALLOW' : close < ma144 ? 'BLOCK' : 'WATCH';
  return {
    timeframe: '4H', completed_candles_only: true, quality: 'high', candle_time: ts && ts[i] ? new Date(ts[i]).toISOString() : null,
    indicators: { ema21: r2(e21[i], 4), ma55: r2(m55[i], 4), ma144: r2(ma144, 4), atr14: r2(atr14, 4), avg_vol20: r2(avgVol20, 4), vol_ratio: r2(volRatio, 2), pct_from_ma144: r2((close - ma144) / ma144 * 100, 2) },
    above_ma144: close > ma144, bullish_alignment: bullishAlignment, bearish_alignment: bearishAlignment, clustered, near_ma144: nearMA144,
    signals, posture, score_adjustment: adjustment,
  };
}

// ---------- futures history (change rates, not snapshots) ----------
async function futures(s) {
  const inst = swapId(s), ccy = base(s);
  const [fr, oi, ls, tk] = await Promise.allSettled([
    j(`${OKX}/api/v5/public/funding-rate-history?instId=${inst}&limit=21`),        // 7d ≈ 21 points (8h)
    j(`${OKX}/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${ccy}&period=1H`),
    j(`${OKX}/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=1H`),
    j(`${OKX}/api/v5/rubik/stat/taker-volume?ccy=${ccy}&instType=CONTRACTS&period=1H`),
  ]);
  const out = { missing: [] };
  // Funding rate: current / last-3d (9-point) avg / 7d quantile
  if (fr.status === 'fulfilled' && fr.value.data?.length) { const a = fr.value.data.map((x) => +x.fundingRate); out.funding_now = r2(a[0], 6); out.funding_avg3d = r2(a.slice(0, 9).reduce((x, y) => x + y, 0) / Math.min(9, a.length), 6); const sorted = [...a].sort((x, y) => x - y); out.funding_pctile7d = r2(sorted.indexOf(a[0]) / (a.length - 1) * 100, 0); } else out.missing.push('funding');
  // OI (USD): current + 1H/4H/24H change rates (series new→old, index = hours ago)
  if (oi.status === 'fulfilled' && oi.value.data?.length) { const a = oi.value.data.map((x) => +x[1]); const at = (n) => a[n] != null ? pct(a[0], a[n]) : null; out.oi_usd = r2(a[0], 0); out.oi_chg_1h = at(1); out.oi_chg_4h = at(4); out.oi_chg_24h = at(24); } else out.missing.push('oi');
  // Long/short account ratio: current + 24h change + 7d quantile
  if (ls.status === 'fulfilled' && ls.value.data?.length) { const a = ls.value.data.map((x) => +x[1]); out.ls_ratio = r2(a[0], 2); out.ls_chg_24h = a[24] != null ? pct(a[0], a[24]) : null; const sorted = [...a].sort((x, y) => x - y); out.ls_pctile7d = r2(sorted.indexOf(a[0]) / (a.length - 1) * 100, 0); } else out.missing.push('long_short');
  // Taker buy/sell volume (CONTRACTS, [ts,sellVol,buyVol]): 1H/4H imbalance
  if (tk.status === 'fulfilled' && tk.value.data?.length) { const a = tk.value.data; const imb = (n) => { const w = a.slice(0, n); const sell = w.reduce((x, y) => x + +y[1], 0), buy = w.reduce((x, y) => x + +y[2], 0); return buy + sell ? r2((buy - sell) / (buy + sell) * 100, 1) : null; }; out.taker_imb_1h = imb(1); out.taker_imb_4h = imb(4); out.note_ls = 'OKX账户数多空比,非全市场仓位比'; } else out.missing.push('taker');
  return out;
}

// ---------- support/resistance zones (candidates → ATR clustering) ----------
function buildZones(d1, h4, price, atr4) {
  const cand = [];
  const add = (p, tag) => { if (p && isFinite(p)) cand.push({ p, tag }); };
  add(d1.ema99, 'daily EMA99'); add(h4.ema99, '4H EMA99');
  add(d1.period_high, 'daily range high'); add(d1.period_low, 'daily range low');
  h4._sw.hi.slice(-4).forEach((x) => add(x.p, '4H前高')); h4._sw.lo.slice(-4).forEach((x) => add(x.p, '4H前低'));
  // Fib: uses the latest major 4H swing (highest swingHigh and lowest swingLow)
  const His = h4._sw.hi.map((x) => x.p), Los = h4._sw.lo.map((x) => x.p);
  if (His.length && Los.length) { const hi = Math.max(...His), lo = Math.min(...Los); [0.382, 0.5, 0.618, 0.786].forEach((f) => add(hi - (hi - lo) * f, `Fib${f}`)); }
  const tol = Math.max(atr4 * 0.5, price * 0.0025); // 0.5xATR or 0.25% fallback
  cand.sort((a, b) => a.p - b.p);
  const zones = [];
  for (const x of cand) { const z = zones[zones.length - 1]; if (z && x.p - z.hi <= tol) { z.hi = x.p; z.tags.add(x.tag); z.pts.push(x.p); } else zones.push({ lo: x.p, hi: x.p, tags: new Set([x.tag]), pts: [x.p] }); }
  const touches = (lo, hi) => h4._h.reduce((n, _, i) => n + ((h4._h[i] >= lo && h4._l[i] <= hi) ? 1 : 0), 0);
  const fin = zones.map((z) => { const lo = z.lo - tol / 2, hi = z.hi + tol / 2, mid = (z.lo + z.hi) / 2; const t = touches(lo, hi); return { low: r2(lo, 2), high: r2(hi, 2), type: mid < price ? 'support' : 'resistance', confluence: [...z.tags], touches: t, strength: Math.min(100, z.tags.size * 22 + Math.min(t, 6) * 6) }; });
  const sup = fin.filter((z) => z.type === 'support').sort((a, b) => b.high - a.high).slice(0, 3);
  const res = fin.filter((z) => z.type === 'resistance').sort((a, b) => a.low - b.low).slice(0, 3);
  return { support: sup, resistance: res };
}

// ---------- trade plan: entry zone / stop zone / trailing-TP zone ----------
// Entry float: user-specified BTC ±369, ETH ±20; others fall back to 0.5x 4H ATR or 0.35%
const ENTRY_TOL = { BTCUSDT: 369, ETHUSDT: 20 };
function pointTol(symbol, price, atr4) {
  if (ENTRY_TOL[symbol] != null) return ENTRY_TOL[symbol];
  return Math.max((atr4 || price * 0.01) * 0.5, price * 0.0035);
}
function buildTradePlan(symbol, price, lean, zones, atr4) {
  if (!zones || price == null || !isFinite(price)) return null;
  const tol = pointTol(symbol, price, atr4);
  const atr = atr4 || price * 0.01;
  // ★Precision must follow price magnitude: for sub-cent coins (PENGU 0.0067 / BOME 0.00087), fixed 6 decimals
  // would truncate the support floor and ATR tolerance to 0.000000, and subtraction then yields a **negative stop**.
  const dp = price >= 100 ? 1 : price >= 1 ? 3 : price >= 0.01 ? 5 : price >= 0.0001 ? 7 : 10;
  const R = (x) => +Number(x).toFixed(dp);
  const rng = (a, b) => [R(Math.min(a, b)), R(Math.max(a, b))];
  const sup = (zones.support || []).filter((z) => z.high < price);   // sorted nearest-first
  const res = (zones.resistance || []).filter((z) => z.low > price);
  const dir = lean === '偏多' ? 'long' : lean === '偏空' ? 'short' : 'neutral';
  const base = { symbol, direction_tol_points: R(tol), atr4h: R(atr), note: '技术位推演,非投资建议;必设止损、仓位自负' };
  // ★Safety net: any non-positive or NaN price level means the coin's magnitude is too small and zones are unreliable.
  // Rather than emit a misleading negative stop, honestly degrade to watch.
  const guard = (plan) => {
    const isLong = plan.direction === '做多';
    // ★Targets must stay sane vs current price. Zone clustering can return far historical zones (SOL at 76 with secondary resistance at 208);
    // the data isn't wrong, but it's useless as a TP. Beyond 8xATR, extrapolate with ATR instead.
    const MAX = 8 * atr;
    const tooFar = (z) => Array.isArray(z) && Math.abs((isLong ? z[0] : z[1]) - price) > MAX;
    if (tooFar(plan.tp1)) {
      plan = { ...plan, tp1: isLong ? rng(price + 2 * atr, price + 3 * atr) : rng(price - 3 * atr, price - 2 * atr) };
    }
    if (tooFar(plan.tp2)) {
      plan = { ...plan, tp2: isLong ? rng(price + 4 * atr, price + 5 * atr) : rng(price - 5 * atr, price - 4 * atr) };
    }
    // TP2 must sit beyond TP1. Resistance clustering sometimes yields one zone (or two that round to the same),
    // which would make tp1 == tp2 — embarrassing in public output, so ATR extrapolation separates them here.
    if (Array.isArray(plan.tp1) && Array.isArray(plan.tp2)) {
      const notFurther = isLong ? plan.tp2[1] <= plan.tp1[1] : plan.tp2[0] >= plan.tp1[0];
      if (notFurther) {
        plan = { ...plan, tp2: isLong
          ? rng(plan.tp1[1] + 1.2 * atr, plan.tp1[1] + 2 * atr)
          : rng(plan.tp1[0] - 2 * atr, plan.tp1[0] - 1.2 * atr) };
      }
    }
    const vals = ['entry_now', 'entry_pullback', 'stop', 'tp1', 'tp2']
      .flatMap((k) => (Array.isArray(plan[k]) ? plan[k] : []));
    if (vals.some((v) => !isFinite(v) || v <= 0)) {
      return { ...base, direction: '观望', reason: '该标的价格量级过小,技术区间计算不稳定,本次不给出具体价位' };
    }
    return plan;
  };
  if (dir === 'neutral') return { ...base, direction: '观望', reason: '方向中性(|方向分|≤15),不宜追单;等突破阻力或回踩支撑站稳再动手' };
  if (dir === 'long') {
    const s1 = sup[0], r1 = res[0], r2z = res[1];
    const anchor = s1 ? Math.min(price, Math.max(s1.high, price - 1.5 * atr)) : price;
    return guard({ ...base, direction: '做多',
      entry_now: rng(price - tol, price + tol),
      entry_pullback: s1 ? rng(s1.low, s1.high + tol) : rng(anchor - tol, anchor + tol),
      stop: s1 ? rng(s1.low - tol * 0.6 - 0.4 * atr, s1.low - tol * 0.15) : rng(anchor - 1.8 * atr, anchor - 1.3 * atr),
      tp1: r1 ? rng(r1.low - tol, r1.high) : rng(price + 1.6 * atr, price + 2.2 * atr),
      tp2: r2z ? rng(r2z.low - tol, r2z.high) : rng(price + 3 * atr, price + 4 * atr),
      trailing: `到 TP1 先把止损上移到开单价保本;之后按 4H ATR≈${R(atr)} 跟踪——每收一根 4H 阳线,把止损上移到该根低点下方约 ${R(atr * 0.5)},4H 跌破前低即离场` });
  }
  const s1 = sup[0], s2 = sup[1], r1 = res[0];
  const anchor = r1 ? Math.max(price, Math.min(r1.low, price + 1.5 * atr)) : price;
  return guard({ ...base, direction: '做空',
    entry_now: rng(price - tol, price + tol),
    entry_pullback: r1 ? rng(r1.low - tol, r1.high) : rng(anchor - tol, anchor + tol),
    stop: r1 ? rng(r1.high + tol * 0.15, r1.high + tol * 0.6 + 0.4 * atr) : rng(anchor + 1.3 * atr, anchor + 1.8 * atr),
    tp1: s1 ? rng(s1.low, s1.high + tol) : rng(price - 2.2 * atr, price - 1.6 * atr),
    tp2: s2 ? rng(s2.low, s2.high + tol) : rng(price - 4 * atr, price - 3 * atr),
    trailing: `到 TP1 先把止损下移到开单价保本;之后按 4H ATR≈${R(atr)} 跟踪——每收一根 4H 阴线,把止损下移到该根高点上方约 ${R(atr * 0.5)},4H 突破前高即离场` });
}

// ---------- direction score + confidence ----------
function scoreAll(d1, h4, h1, fut, newsLean) {
  const tv = (t) => t === 'up' ? 1 : t === 'down' ? -1 : 0;
  // Structure/trend 40: daily carries the most weight
  const struct = (tv(d1.trend) * 0.5 + tv(h4.trend) * 0.3 + tv(h1.trend) * 0.2) * 0.6 + (tv(d1.structure) * 0.5 + tv(h4.structure) * 0.3 + tv(h1.structure) * 0.2) * 0.4;
  // Momentum 15: MACD hist sign + RSI position (4H-led)
  const mom = ((h4.macd?.hist > 0 ? 1 : h4.macd?.hist < 0 ? -1 : 0) * 0.5 + (h4.rsi14 > 55 ? 1 : h4.rsi14 < 45 ? -1 : 0) * 0.5);
  // Crowding 17: high long-short ratio + high funding = crowded longs → contrarian risk (negative)
  let crowd = 0; if (fut.ls_ratio != null) { if (fut.ls_ratio > 2 && (fut.funding_now || 0) > 0.0002) crowd = -0.7; else if (fut.ls_ratio < 1 && (fut.funding_now || 0) < 0) crowd = 0.5; else crowd = (fut.ls_chg_24h || 0) > 0 ? -0.2 : 0.2; }
  // Participation 18: taker imbalance + OI confirmation (price judged separately; here imbalance + OI direction only)
  let part = 0; if (fut.taker_imb_4h != null) part = Math.max(-1, Math.min(1, fut.taker_imb_4h / 20));
  // News sentiment 10
  const news = Math.max(-1, Math.min(1, newsLean));
  const W = { struct: 40, mom: 15, crowd: 17, part: 18, news: 10 };
  const raw = struct * W.struct + mom * W.mom + crowd * W.crowd + part * W.part + news * W.news;
  const directionScore = Math.round(raw); // -100~100
  const lean = directionScore > 15 ? '偏多' : directionScore < -15 ? '偏空' : '中性';
  // Confidence: multi-timeframe agreement + data completeness + factor resonance
  const trends = [d1.trend, h4.trend, h1.trend];
  const agree = trends.filter((t) => tv(t) === Math.sign(directionScore) && tv(t) !== 0).length;
  const dims = [Math.sign(struct), Math.sign(mom), Math.sign(part), Math.sign(news)].filter((x) => x !== 0);
  const resonance = dims.length ? Math.abs(dims.reduce((a, b) => a + b, 0)) / dims.length : 0;
  const complete = fut.missing.length === 0;
  let conf = '低'; const pts = (agree >= 3 ? 2 : agree === 2 ? 1 : 0) + (resonance >= 0.6 ? 1 : 0) + (complete ? 1 : 0);
  conf = pts >= 3 ? '高' : pts >= 2 ? '中' : '低';
  const evidence = [
    { dim: '结构/趋势', lean: struct > 0.15 ? '多' : struct < -0.15 ? '空' : '中', note: `日${d1.trend}/4H${h4.trend}/1H${h1.trend}` },
    { dim: '动量', lean: mom > 0 ? '多' : mom < 0 ? '空' : '中', note: `4H MACD ${h4.macd?.hist} RSI ${h4.rsi14}` },
    { dim: '拥挤度', lean: crowd > 0 ? '多' : crowd < 0 ? '空' : '中', note: `多空比${fut.ls_ratio} 资金费率${fut.funding_now}` },
    { dim: '参与度', lean: part > 0.1 ? '多' : part < -0.1 ? '空' : '中', note: `主动买卖失衡4H ${fut.taker_imb_4h}% OI24h ${fut.oi_chg_24h}%` },
    { dim: '消息面', lean: news > 0.1 ? '多' : news < -0.1 ? '空' : '中', note: `6551新闻净倾向 ${r2(newsLean, 2)}` },
  ];
  return { directionScore, lean, confidence: conf, evidence };
}

// Net news tilt: high-score (≥60) items weighted by signal, capped at ±1 (weight 10 → at most ±10)
function newsLeanOf(news) {
  if (!news || !news.length) return 0;
  let s = 0, n = 0;
  for (const it of news) { const sc = (it.score || 0) / 100; if (sc < 0.6) continue; const sig = it.signal === 'long' ? 1 : it.signal === 'short' ? -1 : 0; s += sig * sc; n++; }
  if (!n) return 0; return Math.max(-1, Math.min(1, s / Math.max(n, 2)));
}

// ---------- main entry ----------
async function analyze_market(symbol) {
  const s = sym(symbol);
  const asOf = new Date().toISOString();
  const [tk, d1r, h4r, h1r, futr, newsr] = await Promise.allSettled([
    j(`${OKX}/api/v5/market/ticker?instId=${spotId(s)}`),
    analyzeTF(s, '1D'), analyzeTF(s, '4H'), analyzeTF(s, '1H'),
    futures(s), getCoinNews(s, 8),
  ]);
  if (tk.status !== 'fulfilled') throw new Error('spot price unavailable — analysis halted');
  const t = tk.value.data[0]; const price = +t.last;
  const missing = [];
  const d1 = d1r.status === 'fulfilled' ? d1r.value : (missing.push('daily'), null);
  const h4 = h4r.status === 'fulfilled' ? h4r.value : (missing.push('4h'), null);
  const h1 = h1r.status === 'fulfilled' ? h1r.value : (missing.push('1h'), null);
  const fut = futr.status === 'fulfilled' ? futr.value : { missing: ['futures'] };
  const news = newsr.status === 'fulfilled' && newsr.value ? newsr.value.news : null;
  if (!d1 || !h4 || !h1) { // missing timeframe → low-confidence skeleton only
    return { symbol: s, asOf, price, quality: 'low', missing: missing.concat(fut.missing || []), note: '多周期数据不全,置信度低', partial: { d1, h4, h1 } };
  }
  const nLean = newsLeanOf(news);
  const zones = buildZones(d1, h4, price, h4._atr || price * 0.01);
  const sc = scoreAll(d1, h4, h1, fut, nLean);
  const t144 = calculateT144(h4);
  const baseDirectionScore = sc.directionScore;
  const directionScore = Math.max(-100, Math.min(100, baseDirectionScore + t144.score_adjustment));
  const lean = directionScore > 15 ? '偏多' : directionScore < -15 ? '偏空' : '中性';
  const t144Lean = t144.score_adjustment > 0 ? '多' : t144.score_adjustment < 0 ? '空' : '中';
  const evidence = [...sc.evidence, { dim: 'T-144', lean: t144Lean, note: `4H MA144防线修正 ${t144.score_adjustment >= 0 ? '+' : ''}${t144.score_adjustment}; ${t144.signals.join('/') || t144.posture}` }];
  const trade_plan = buildTradePlan(s, price, lean, zones, h4._atr || price * 0.01);
  const strip = (x) => { const { _c, _h, _l, _o, _v, _t, _sw, _atr, ...rest } = x; return rest; }; // 删内部字段
  const allMissing = [...new Set([...missing, ...(fut.missing || [])])];
  const quality = allMissing.length === 0 ? 'high' : allMissing.includes('futures') ? 'medium' : 'medium';
  return {
    symbol: s, horizon: '24-72h', asOf, source: 'OKX + 6551', price, change_24h_pct: pct(price, +t.open24h),
    completedCandlesOnly: true, quality, missing: allMissing,
    direction_score_base: baseDirectionScore, t144_adjustment: t144.score_adjustment,
    direction_score: directionScore, lean, confidence: sc.confidence, evidence,
    timeframes: { daily: strip(d1), h4: strip(h4), h1: strip(h1) },
    t144,
    futures: fut,
    support_resistance: zones,
    trade_plan,
    news_top: news ? news.filter((x) => (x.score || 0) >= 60).slice(0, 5).map((x) => ({ text: x.text, score: x.score, signal: x.signal, source: x.source })) : [],
    reminder: '多空比为OKX账户数口径;支撑阻力为区间非单点;指标仅用已收盘K线;不构成投资建议',
  };
}

// ---- ZALIEN #3 chart: real candles + EMA7/25/99 + my support/resistance zones + current-price line (QuickChart labels)----
function emaSeriesA(v, p) { const k = 2 / (p + 1); const o = [v[0]]; for (let i = 1; i < v.length; i++) o.push(v[i] * k + o[i - 1] * (1 - k)); return o; }
async function buildAnnotatedChart(ms) {
  const s = ms.symbol;
  const d = await j(`${OKX}/api/v5/market/candles?instId=${spotId(s)}&bar=4H&limit=220`);
  const raw = (d.data || []).slice().reverse().filter((c) => c[8] === '1');
  if (raw.length < 30) throw new Error('not enough candles');
  const k = raw.slice(-60); const closesAll = raw.map((c) => +c[4]); const off = raw.length - k.length;
  const candles = k.map((c) => ({ x: +c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4] }));
  const smaSeries = (v, p) => v.map((_, i) => i < p - 1 ? null : v.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p);
  const line = (arr, label, color, w) => ({ label, type: 'line', data: k.map((c, i) => ({ x: +c[0], y: arr[off + i] == null ? null : +arr[off + i].toFixed(2) })), borderColor: color, borderWidth: w || 1.4, pointRadius: 0, fill: false, spanGaps: true });
  const emaS7 = emaSeriesA(closesAll, 7), emaS25 = emaSeriesA(closesAll, 25), emaS99 = emaSeriesA(closesAll, 99), ma144S = smaSeries(closesAll, 144);
  const dp0 = ms.price >= 100 ? 1 : ms.price >= 1 ? 3 : 6;
  const ann = {};
  (ms.support_resistance.support || []).slice(0, 2).forEach((z, i) => { ann['s' + i] = { type: 'box', yMin: z.low, yMax: z.high, backgroundColor: 'rgba(38,208,124,0.13)', borderColor: 'rgba(38,208,124,0.6)', borderWidth: 1, label: { display: true, content: `支撑 ${z.low}`, position: 'start', color: '#26d07c', font: { size: 10 } } }; });
  (ms.support_resistance.resistance || []).slice(0, 2).forEach((z, i) => { ann['r' + i] = { type: 'box', yMin: z.low, yMax: z.high, backgroundColor: 'rgba(240,80,80,0.13)', borderColor: 'rgba(240,80,80,0.6)', borderWidth: 1, label: { display: true, content: `阻力 ${z.high}`, position: 'start', color: '#f05050', font: { size: 10 } } }; });
  ann['price'] = { type: 'line', yMin: ms.price, yMax: ms.price, borderColor: '#ffd166', borderWidth: 1.2, borderDash: [5, 4], label: { display: true, content: `现价 ${ms.price}`, position: 'end', backgroundColor: '#ffd166', color: '#000', font: { size: 9 } } };
  const tp = ms.trade_plan;
  if (tp && tp.direction && tp.direction !== '观望') {
    ann['entry'] = { type: 'box', yMin: tp.entry_now[0], yMax: tp.entry_now[1], backgroundColor: 'rgba(120,180,255,0.10)', borderColor: 'rgba(120,180,255,0.75)', borderWidth: 1, borderDash: [4, 3], label: { display: true, content: `开单 ${tp.entry_now[0]}~${tp.entry_now[1]}`, position: 'center', color: '#7ab4ff', font: { size: 9 } } };
    ann['stopz'] = { type: 'line', yMin: tp.stop[0], yMax: tp.stop[0], borderColor: '#ff5f56', borderWidth: 1.2, borderDash: [3, 3], label: { display: true, content: `止损 ${tp.stop[0]}`, position: 'start', backgroundColor: '#ff5f56', color: '#000', font: { size: 9 } } };
    ann['tp1z'] = { type: 'line', yMin: tp.tp1[1], yMax: tp.tp1[1], borderColor: '#27c93f', borderWidth: 1.2, borderDash: [3, 3], label: { display: true, content: `止盈 ${tp.tp1[1]}`, position: 'end', backgroundColor: '#27c93f', color: '#000', font: { size: 9 } } };
  }
  // ---- Chan-theory (strokes/zones/divergence) · Waves · Fibonacci overlay ----
  const hAll = raw.map((c) => +c[2]), lAll = raw.map((c) => +c[3]);
  const sw2 = swings(hAll, lAll, 3);
  let piv = [...sw2.hi.map((x) => ({ i: x.i, p: x.p, t: 'H' })), ...sw2.lo.map((x) => ({ i: x.i, p: x.p, t: 'L' }))].sort((a, b) => a.i - b.i);
  const zz = []; for (const p of piv) { const last = zz[zz.length - 1]; if (!last || last.t !== p.t) zz.push(p); else if ((p.t === 'H' && p.p > last.p) || (p.t === 'L' && p.p < last.p)) zz[zz.length - 1] = p; }
  const zzWin = zz.filter((p) => p.i >= off - 1);
  const zzData = zzWin.map((p) => ({ x: +raw[p.i][0], y: p.p })); zzData.push({ x: +k[k.length - 1][0], y: ms.price });
  const marks = '①②③④⑤'; zzWin.slice(-5).forEach((p, idx) => { ann['w' + idx] = { type: 'label', xValue: +raw[p.i][0], yValue: p.p, content: [marks[idx] || '•'], color: '#00e0d0', backgroundColor: 'rgba(0,0,0,0.45)', font: { size: 11, weight: 'bold' }, padding: 2, yAdjust: p.t === 'H' ? -13 : 13 }; });
  const winH = Math.max(...k.map((c) => +c[2])), winL = Math.min(...k.map((c) => +c[3]));
  [0.236, 0.382, 0.5, 0.618, 0.786].forEach((f) => { const y = +(winH - (winH - winL) * f).toFixed(dp0); ann['fib' + String(f).replace('.', '')] = { type: 'line', yMin: y, yMax: y, borderColor: 'rgba(255,205,90,0.45)', borderWidth: 1, borderDash: [2, 4], label: { display: true, content: `Fib${f} ${y}`, position: 'start', color: '#ffcd5a', backgroundColor: 'rgba(0,0,0,0.35)', font: { size: 8 } } }; });
  const recent = zz.slice(-5), rh = recent.filter((p) => p.t === 'H').map((p) => p.p), rl = recent.filter((p) => p.t === 'L').map((p) => p.p);
  if (rh.length && rl.length) { const zt = Math.min(...rh), zb = Math.max(...rl); if (zt > zb) ann['zhongshu'] = { type: 'box', yMin: zb, yMax: zt, backgroundColor: 'rgba(0,224,208,0.06)', borderColor: 'rgba(0,224,208,0.45)', borderWidth: 1, borderDash: [5, 4], label: { display: true, content: '缠论中枢', position: { x: 'start', y: 'center' }, color: '#00e0d0', font: { size: 9 } } }; }
  let beichi = '';
  try { const e12 = emaSeriesA(closesAll, 12), e26 = emaSeriesA(closesAll, 26), ml = e12.map((x, i) => x - e26[i]); const sig = emaSeriesA(ml, 9), hist = ml.map((x, i) => x - sig[i]);
    const hh = sw2.hi.slice(-2), ll = sw2.lo.slice(-2);
    if (hh.length === 2 && hh[1].p > hh[0].p && hist[hh[1].i] < hist[hh[0].i]) beichi = ' · 顶背驰⚠(价新高·MACD不配合)';
    else if (ll.length === 2 && ll[1].p < ll[0].p && hist[ll[1].i] > hist[ll[0].i]) beichi = ' · 底背驰✦(价新低·MACD不配合)'; } catch (e) {}
  const h4i = (ms.timeframes && ms.timeframes.h4) || {};
  const struct = h4i.trend ? `4H结构 ${h4i.trend}/${h4i.structure || '-'}` : '';
  const subtitle = `RSI ${h4i.rsi14 ?? '-'} · MACD柱 ${h4i.macd ? h4i.macd.hist : '-'} · ATR ${h4i.atr14 ?? '-'}(${h4i.atr_pct ?? '-'}%) · 量比 ${h4i.rvol20 ?? '-'} · 方向分 ${ms.direction_score}${beichi}`;
  const legend3 = `青线=缠论笔/波浪(①-⑤枢纽) · 金虚线=斐波那契回撤 · 青框=中枢 · ${struct}`;
  const cfg = { type: 'candlestick', data: { datasets: [
      { label: `${base(s)} 4H`, data: candles },
      { label: '笔/波浪', type: 'line', data: zzData, borderColor: '#00e0d0', borderWidth: 1.7, pointRadius: 3, pointBackgroundColor: '#00e0d0', fill: false, tension: 0 },
      line(emaS25, 'EMA25', '#f5a623'), line(emaS99, 'EMA99', '#c060ff'), line(ma144S, 'MA144', '#ff5fa2', 1.9),
    ] }, options: { plugins: { legend: { display: true, position: 'top', labels: { color: '#cfd3de', boxWidth: 14, font: { size: 10 }, filter: (it) => it.text !== `${base(s)} 4H` } }, annotation: { annotations: ann }, title: { display: true, text: [`Artemis · ${base(s)}/USDT 4H · ${ms.lean} / 置信${ms.confidence}`, subtitle, legend3], color: '#e8e8e8', font: { size: 12 } } }, scales: { x: { type: 'time', ticks: { color: '#aaa' } }, y: { position: 'right', ticks: { color: '#aaa' } } } } };
  const r = await fetch('https://quickchart.io/chart/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chart: cfg, width: 1120, height: 700, backgroundColor: '#0b0e13', version: '4' }) });
  const jr = await r.json(); if (!jr.url) throw new Error('chart generation failed');
  const png = await fetch(jr.url); return Buffer.from(await png.arrayBuffer()).toString('base64');
}

const declarations = [
  { name: 'analyze_market', description: '★做"分析/研判某币行情"时用这一个工具(不要再自己分别调 get_klines 多次)。代码内部并行拉 日线/4H/1H(已收盘)+现货+期货历史变化率(OI/资金费率/多空比/主动买卖量)+6551消息面,算好趋势/结构/ATR/支撑阻力区间/方向分/置信度,返回结构化 market_state。你只需按固定模板把它写成人话。', parameters: { type: 'object', properties: { symbol: { type: 'string', description: '如 BTCUSDT/ETHUSDT/TONUSDT' } } } },
];
const impl = { analyze_market };
module.exports = { declarations, impl, buildAnnotatedChart, _test: { calculateT144, buildTradePlan, pointTol } };
