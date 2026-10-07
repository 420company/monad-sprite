/**
 * classics.js —— 经典理论模块（zalien 缺的几块，现场新写的融合代码）
 *
 * 包含：
 *  1. 量价配合 (Volume-Price)：价涨量增/价涨量缩/价跌量增/放量突破
 *  2. 清算风险代理 (Liquidation Risk Proxy)：无热力图数据源时，用 OI+资金费率+多空比估算
 *  3. 威科夫 Spring / Upthrust：弹簧洗盘 / 上冲回落（聪明钱行为）
 *  4. 缠论简化版：中枢（线段重叠区间）+ 背驰（MACD hist 收缩）
 *
 * 不做：完整波浪理论（主观性太强，算法数浪≈噪音，投入产出比差）
 * 已有（别重复造）：斐波那契 0.382/0.5/0.618/0.786 在 analyze.js buildZones 里
 */
'use strict';

// ---------- 小工具 ----------
const last = (a) => a[a.length - 1];
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** 分型摆动点（照抄 analyze.js swings 逻辑，w=2） */
function swings(h, l, w = 2) {
  const hi = [], lo = [];
  for (let i = w; i < h.length - w; i++) {
    let ph = true, pl = true;
    for (let k = 1; k <= w; k++) {
      if (h[i] <= h[i - k] || h[i] <= h[i + k]) ph = false;
      if (l[i] >= l[i - k] || l[i] >= l[i + k]) pl = false;
    }
    if (ph) hi.push({ i, p: h[i] });
    if (pl) lo.push({ i, p: l[i] });
  }
  return { hi, lo };
}

function macdHist(c) {
  if (c.length < 35) return null;
  const e = (arr, p) => { const k = 2 / (p + 1); const o = [arr[0]]; for (let i = 1; i < arr.length; i++) o.push(arr[i] * k + o[i - 1] * (1 - k)); return o; };
  const e12 = e(c, 12), e26 = e(c, 26);
  const dif = c.map((_, i) => e12[i] - e26[i]);
  const dea = e(dif.slice(26), 9);
  return (dif[dif.length - 1] - dea[dea.length - 1]) * 2;
}

// ---------- 1. 量价配合 ----------
function volumePrice(c, v) {
  if (!c || c.length < 25 || !v || v.length < 25) return { score: 0, label: '数据不足', volRatio: null, pxChgPct: null };
  const pxChg = (last(c) - c[c.length - 2]) / c[c.length - 2];
  const pxChgPct = pxChg * 100;
  const volRatio = last(v) / avg(v.slice(-21, -1));
  let score = 0; const tags = [];
  const up = pxChgPct > 0.3, down = pxChgPct < -0.3, flat = !up && !down;
  const volUp = volRatio > 1.5, volDown = volRatio < 0.7, volBurst = volRatio > 2;
  if (up && volUp) { score += 1; tags.push('价涨量增'); }
  if (up && volDown) { score -= 0.5; tags.push('价涨量缩(乏力)'); }
  if (down && volUp) { score -= 1; tags.push('价跌量增(恐慌)'); }
  if (down && volDown) { score += 0.5; tags.push('价跌量缩(惜售)'); }
  if (pxChgPct > 1 && volBurst) { score += 0.5; tags.push('放量突破'); }
  if (pxChgPct < -1 && volBurst) { score -= 0.5; tags.push('放量破位'); }
  if (flat && volDown) tags.push('缩量横盘(变盘前兆)');
  return { score: clamp(score, -2, 2), label: tags.join('+') || '量价中性', volRatio: +volRatio.toFixed(2), pxChgPct: +pxChgPct.toFixed(2) };
}

// ---------- 2. 清算风险代理 ----------
// 真热力图要 Coinglass 付费数据。这里用 OI 变化 + 资金费率 + 多空比估算拥挤方向。
// 逻辑：多头越拥挤 → 下方多头清算单越多 → 跌破时加速
function liquidationRisk(fut = {}) {
  const t = (x) => Math.tanh(x || 0);
  const funding = fut.funding_now || 0;
  const oiChg = fut.oi_chg_24h || 0;
  const ls = (fut.ls_ratio || 1) - 1;
  // 多头清算风险：资金费率高 + OI 增 + 多头多
  const longRisk = clamp(50 + 30 * t(funding / 0.0005) + 12 * t(oiChg / 40) + 8 * t(ls / 0.8), 0, 100);
  const shortRisk = clamp(50 - 30 * t(funding / 0.0005) - 12 * t(oiChg / 40) - 8 * t(ls / 0.8), 0, 100);
  const note = longRisk > 70 ? '多头拥挤，下方清算多，跌破加速风险高'
    : shortRisk > 70 ? '空头拥挤，上方清算多，突破加速风险高' : '清算风险中性';
  return { longLiqRisk: Math.round(longRisk), shortLiqRisk: Math.round(shortRisk), note, proxy: true };
}

// ---------- 3. 威科夫 Spring / Upthrust ----------
function wyckoff(h, l, c, v) {
  if (!h || h.length < 30) return { signal: null, strength: 0, note: '数据不足' };
  const i = c.length - 1;
  const sw = swings(h, l, 2);
  const recentLows = l.slice(-12, -2), recentHighs = h.slice(-12, -2);
  const supFloor = Math.min(...recentLows), resCeil = Math.max(...recentHighs);
  const volRatio = last(v) / avg(v.slice(-21, -1));
  // Spring：下影线击穿近期低点但收回 + 放量
  const spring = l[i] < supFloor && c[i] > supFloor && volRatio > 1.2;
  // Upthrust：上影线突破近期高点但收回 + 放量
  const upthrust = h[i] > resCeil && c[i] < resCeil && volRatio > 1.2;
  if (spring) return { signal: 'spring', strength: clamp(volRatio / 2, 0.3, 1), note: `Spring 弹簧洗盘（${supFloor.toFixed(2)} 下方吸筹），偏多` };
  if (upthrust) return { signal: 'upthrust', strength: clamp(volRatio / 2, 0.3, 1), note: `Upthrust 上冲回落（${resCeil.toFixed(2)} 上方派发），偏空` };
  return { signal: null, strength: 0, note: '无威科夫信号' };
}

// ---------- 4. 缠论简化版：中枢 + 背驰 ----------
// 中枢 = 连续三段走势重叠的价格区间（简化：用 swing 高低点构造线段）
// 背驰 = 创新高/新低但 MACD hist 收缩
function chanLun(h, l, c) {
  if (!c || c.length < 60) return { zhongshu: null, beichi: null, note: '数据不足' };
  const sw = swings(h, l, 2);
  // 取最近 6 个 swing 点构造线段方向
  const pts = [];
  const all = [...sw.hi.map((x) => ({ ...x, t: 'h' })), ...sw.lo.map((x) => ({ ...x, t: 'l' }))]
    .sort((a, b) => a.i - b.i).slice(-8);
  // 中枢：找最近 3 个 swing 区间重叠部分
  let zhongshu = null;
  if (all.length >= 6) {
    const segs = [];
    for (let k = 0; k + 1 < all.length; k += 2) {
      const a = all[k], b = all[k + 1];
      segs.push({ lo: Math.min(a.p, b.p), hi: Math.max(a.p, b.p) });
    }
    if (segs.length >= 3) {
      const s3 = segs.slice(-3);
      const lo = Math.max(...s3.map((s) => s.lo)), hi = Math.min(...s3.map((s) => s.hi));
      if (hi > lo) zhongshu = { low: +lo.toFixed(2), high: +hi.toFixed(2) };
    }
  }
  // 背驰：最近 swing 高创新高，但 MACD hist 比上一个 swing 高时收缩
  let beichi = null;
  const his = sw.hi.slice(-2);
  if (his.length === 2 && his[1].p > his[0].p && c.length > his[1].i + 5) {
    const hNow = macdHist(c.slice(0, his[1].i + 1));
    const hPrev = macdHist(c.slice(0, his[0].i + 1));
    if (hNow != null && hPrev != null && hNow < hPrev * 0.7 && hNow > 0) beichi = 'top';
  }
  const los = sw.lo.slice(-2);
  if (!beichi && los.length === 2 && los[1].p < los[0].p && c.length > los[1].i + 5) {
    const hNow = macdHist(c.slice(0, los[1].i + 1));
    const hPrev = macdHist(c.slice(0, los[0].i + 1));
    if (hNow != null && hPrev != null && hNow > hPrev * 0.7 && hNow < 0) beichi = 'bottom';
  }
  return {
    zhongshu,
    beichi,
    note: zhongshu ? `中枢 ${zhongshu.low}~${zhongshu.high}` : '无中枢',
    beichiNote: beichi === 'top' ? '顶背驰（创新高量能收缩）' : beichi === 'bottom' ? '底背驰' : '无背驰',
  };
}

/** 一键全算：输入 K 线数组 + futures 对象 */
function analyzeClassics({ o, h, l, c, v, futures }) {
  const vp = volumePrice(c, v);
  const liq = liquidationRisk(futures || {});
  const wy = wyckoff(h, l, c, v);
  const ch = chanLun(h, l, c);
  // 综合经典分：-100~100，可并入 direction_score 或单独展示
  let score = vp.score * 20;
  if (wy.signal === 'spring') score += 25 * wy.strength;
  if (wy.signal === 'upthrust') score -= 25 * wy.strength;
  if (ch.beichi === 'top') score -= 20;
  if (ch.beichi === 'bottom') score += 20;
  if (liq.longLiqRisk > 70) score -= 10;
  if (liq.shortLiqRisk > 70) score += 10;
  return { volumePrice: vp, liquidation: liq, wyckoff: wy, chanlun: ch, classicsScore: clamp(Math.round(score), -100, 100) };
}

module.exports = { volumePrice, liquidationRisk, wyckoff, chanLun, analyzeClassics, swings };
