'use strict';
/**
 * 每日甄选历史与 24 小时复盘。只保存公开行情分析快照,不执行交易。
 */
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = process.env.PICKS_HISTORY_FILE || path.join(__dirname, 'picks_history.json');
const HOUR_MS = 3.6e6;
const r2 = (x, n = 2) => (x == null || !isFinite(x)) ? null : +Number(x).toFixed(n);

function emptyHistory() { return { version: 1, batches: [] }; }
function loadHistory(file = HISTORY_FILE) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data)) return { version: 1, batches: data };
    return data && Array.isArray(data.batches) ? data : emptyHistory();
  } catch { return emptyHistory(); }
}
function saveHistory(history, file = HISTORY_FILE) {
  const dir = path.dirname(file); fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(history, null, 2));
    fs.renameSync(temp, file);
  } finally { try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {} }
}

function dayKey(value, timeZone = process.env.TZ_NAME || 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = (type) => parts.find((x) => x.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function getBatchForDay(history, now = Date.now(), timeZone) {
  const key = dayKey(now, timeZone);
  return (history.batches || []).slice().reverse().find((b) => dayKey(b.created_at_ms || b.created_at, timeZone) === key) || null;
}
function latestBatch(history) { return (history.batches || [])[history.batches.length - 1] || null; }
function latestReviewedBatch(history) { return (history.batches || []).slice().reverse().find((b) => b.status === 'reviewed') || null; }

function rankCandidate(analysis, market = {}) {
  const direction = Number(analysis.direction_score) || 0;
  const t144 = Number(analysis.t144_adjustment) || 0;
  const quality = analysis.quality === 'high' ? 12 : analysis.quality === 'medium' ? 6 : 0;
  const confidence = analysis.confidence === '高' ? 14 : analysis.confidence === '中' ? 8 : 2;
  const aligned = direction && t144 && Math.sign(direction) === Math.sign(t144) ? 8 : direction && t144 ? -5 : 0;
  const liquidity = Math.min(12, Math.max(0, Math.log10(Math.max(Number(market.vol_usdt) || 1, 1e6) / 1e6) * 5));
  const rvol = Number(analysis.timeframes?.h4?.rvol20) || 0;
  const participation = Math.min(6, Math.max(0, (rvol - 0.8) * 5));
  const extremePenalty = analysis.t144?.signals?.includes('EXTREME_DEVIATION') ? 8 : 0;
  return r2(Math.abs(direction) * 0.6 + quality + confidence + aligned + liquidity + participation - extremePenalty, 2);
}

function selectionReasons(analysis, market = {}) {
  const reasons = [];
  reasons.push(`方向分 ${analysis.direction_score}（T-144 ${analysis.t144_adjustment >= 0 ? '+' : ''}${analysis.t144_adjustment || 0}）`);
  if (analysis.confidence) reasons.push(`置信度${analysis.confidence}`);
  const h4 = analysis.timeframes?.h4;
  if (h4) reasons.push(`4H ${h4.trend}/${h4.structure}，RSI ${h4.rsi14}`);
  if (analysis.t144?.signals?.length) reasons.push(`T-144 ${analysis.t144.signals.join('/')}`);
  else if (analysis.t144?.posture) reasons.push(`T-144 ${analysis.t144.posture}`);
  if (market.vol_usdt) reasons.push(`24H 成交额 ${r2(market.vol_usdt / 1e6, 1)}M USDT`);
  return reasons;
}

function toPick(item, rank) {
  const analysis = item.analysis; const market = item.market || {};
  return {
    rank, symbol: analysis.symbol, entry_price: Number(analysis.price), lean: analysis.lean,
    confidence: analysis.confidence, direction_score: analysis.direction_score,
    direction_score_base: analysis.direction_score_base, t144_adjustment: analysis.t144_adjustment,
    selection_score: rankCandidate(analysis, market), reasons: selectionReasons(analysis, market),
    market: { change_24h_pct: analysis.change_24h_pct ?? r2(market.chg), quote_volume_24h: r2(market.vol_usdt, 2), quality: analysis.quality, missing: analysis.missing || [] },
    technical: { daily: analysis.timeframes?.daily || null, h4: analysis.timeframes?.h4 || null, h1: analysis.timeframes?.h1 || null },
    t144: analysis.t144 || null, futures: analysis.futures || null,
    support_resistance: analysis.support_resistance || null, evidence: analysis.evidence || [], news_top: analysis.news_top || [],
    trade_plan: analysis.trade_plan || null,
  };
}

function createBatch(items, options = {}) {
  const now = Number(options.now) || Date.now(); const limit = Math.max(1, Number(options.limit) || 5);
  const ranked = (items || []).filter((x) => x?.analysis?.symbol && Number(x.analysis.price) > 0 && x.analysis.lean)
    .map((x) => ({ ...x, score: rankCandidate(x.analysis, x.market) }))
    .sort((a, b) => b.score - a.score || Math.abs(b.analysis.direction_score || 0) - Math.abs(a.analysis.direction_score || 0))
    .slice(0, limit);
  if (!ranked.length) throw new Error('没有可保存的甄选候选');
  return {
    id: `picks-${now}`, created_at: new Date(now).toISOString(), created_at_ms: now,
    review_due_at: new Date(now + 24 * HOUR_MS).toISOString(), review_after_hours: 24,
    status: 'pending', source: 'OKX + 6551', requested_count: limit,
    picks: ranked.map((x, i) => toPick(x, i + 1)),
  };
}

function appendBatch(batch, file = HISTORY_FILE) {
  const history = loadHistory(file);
  if (!history.batches.some((x) => x.id === batch.id)) history.batches.push(batch);
  if (history.batches.length > 400) history.batches.splice(0, history.batches.length - 400);
  saveHistory(history, file);
  return batch;
}

function directionMatches(lean, changePct) {
  if (lean === '偏多') return changePct > 0.3;
  if (lean === '偏空') return changePct < -0.3;
  return Math.abs(changePct) <= 1.5;
}
function evaluateBatch(batch, prices, now = Date.now()) {
  const outcomes = batch.picks.map((pick) => {
    const price = Number(prices[pick.symbol]);
    if (!(price > 0)) throw new Error(`${pick.symbol} 复盘价不可用`);
    const changePct = (price - pick.entry_price) / pick.entry_price * 100;
    return { symbol: pick.symbol, lean: pick.lean, entry_price: pick.entry_price, review_price: price, change_pct: r2(changePct, 2), rose: changePct > 0, fell: changePct < 0, direction_match: directionMatches(pick.lean, changePct) };
  });
  const up = outcomes.filter((x) => x.rose).length; const down = outcomes.filter((x) => x.fell).length;
  const matched = outcomes.filter((x) => x.direction_match).length;
  batch.status = 'reviewed'; batch.reviewed_at = new Date(now).toISOString();
  batch.review = { age_hours: r2((now - batch.created_at_ms) / HOUR_MS, 2), total: outcomes.length, up_count: up, down_count: down, flat_count: outcomes.length - up - down, direction_match_count: matched, direction_match_rate: outcomes.length ? r2(matched / outcomes.length * 100, 1) : null, outcomes };
  return batch;
}

async function reviewDueBatches(getPrice, options = {}) {
  if (typeof getPrice !== 'function') throw new TypeError('getPrice 必须是函数');
  const file = options.file || HISTORY_FILE; const now = Number(options.now) || Date.now();
  const history = loadHistory(file); const reviewed = []; const skipped = [];
  for (const batch of history.batches) {
    if (batch.status !== 'pending' || now < (batch.created_at_ms + 24 * HOUR_MS)) continue;
    try {
      const prices = {};
      await Promise.all(batch.picks.map(async (pick) => { prices[pick.symbol] = await getPrice(pick.symbol); }));
      evaluateBatch(batch, prices, now); reviewed.push(batch);
    } catch (e) { skipped.push({ id: batch.id, error: String(e.message || e) }); }
  }
  if (reviewed.length) saveHistory(history, file);
  return { reviewed_count: reviewed.length, reviewed, skipped, history };
}

const n = (x, digits = 2) => x == null ? '-' : Number(x).toLocaleString('en-US', { maximumFractionDigits: digits });
function formatPlanLine(tp) {
  if (!tp) return '操作参考：数据不足，暂不给区间';
  if (tp.direction === '观望') return '操作参考：观望（方向中性，不宜追单）';
  const z = (r) => (Array.isArray(r) ? `${n(r[0], 8)}~${n(r[1], 8)}` : '-');
  return `操作参考：${tp.direction}｜开单 ${z(tp.entry_now)}（±${tp.direction_tol_points}）｜回踩 ${z(tp.entry_pullback)}｜止损 ${z(tp.stop)}｜止盈 ${z(tp.tp1)}→${z(tp.tp2)}（到TP1移保本后按ATR跟踪）`;
}

function formatPicks(batch) {
  if (!batch) return '今日尚未生成甄选。';
  const age = batch.status === 'reviewed' ? '已复盘' : `待 ${batch.review_due_at} 后复盘`;
  const lines = [`Artemis · 每日甄选`, `${batch.created_at}｜${batch.picks.length} 个候选｜${age}`];
  for (const p of batch.picks) {
    const h4 = p.technical?.h4 || {}; const ti = p.t144?.indicators || {}; const f = p.futures || {};
    const sup = p.support_resistance?.support?.[0]; const res = p.support_resistance?.resistance?.[0];
    lines.push('', `${p.rank}. ${p.symbol.replace(/USDT$/, '')}｜${p.lean}｜置信${p.confidence}｜方向分 ${p.direction_score}`,
      `入选价 ${n(p.entry_price, 8)}｜24H ${p.market.change_24h_pct == null ? '-' : `${n(p.market.change_24h_pct)}%`}｜成交额 ${p.market.quote_volume_24h == null ? '-' : `${n(p.market.quote_volume_24h / 1e6, 1)}M`}`,
      `4H ${h4.trend || '-'}/${h4.structure || '-'}｜RSI ${n(h4.rsi14, 1)}｜MACD ${n(h4.macd?.hist, 2)}｜RVOL ${n(h4.rvol20, 2)}`,
      `T-144 ${p.t144?.posture || '-'} ${p.t144_adjustment >= 0 ? '+' : ''}${p.t144_adjustment || 0}｜MA144 ${n(ti.ma144, 8)}｜距线 ${ti.pct_from_ma144 == null ? '-' : `${n(ti.pct_from_ma144)}%`}｜量比 ${n(ti.vol_ratio)}`,
      `OI24H ${f.oi_chg_24h == null ? '-' : `${n(f.oi_chg_24h)}%`}｜资金费率 ${n(f.funding_now, 6)}｜多空比 ${n(f.ls_ratio)}｜支撑 ${sup ? `${n(sup.low, 8)}-${n(sup.high, 8)}` : '-'}｜阻力 ${res ? `${n(res.low, 8)}-${n(res.high, 8)}` : '-'}`,
      formatPlanLine(p.trade_plan),
      `依据：${p.reasons.join('；')}`);
  }
  return lines.join('\n').slice(0, 4096);
}
function formatReview(batch) {
  if (!batch) return '尚无已完成的 24 小时甄选复盘。';
  if (batch.status !== 'reviewed') return `最近一批甄选仍待复盘：${batch.review_due_at} 后才满 24 小时。`;
  const r = batch.review; const lines = ['Artemis · 24 小时甄选复盘', `${batch.created_at} 批次｜实际上涨 ${r.up_count}/${r.total}｜下跌 ${r.down_count}/${r.total}｜方向符合 ${r.direction_match_count}/${r.total}（${r.direction_match_rate}%）`];
  for (const x of r.outcomes) lines.push(`${x.symbol.replace(/USDT$/, '')} ${x.change_pct >= 0 ? '+' : ''}${x.change_pct}%｜原判${x.lean}｜${x.direction_match ? '符合' : '不符合'}`);
  lines.push(`复盘于 ${batch.reviewed_at}，距入选 ${r.age_hours} 小时。方向符合口径：偏多 > +0.3%，偏空 < -0.3%，中性在 ±1.5% 内。`);
  return lines.join('\n');
}

module.exports = {
  HISTORY_FILE, loadHistory, saveHistory, dayKey, getBatchForDay, latestBatch, latestReviewedBatch,
  rankCandidate, createBatch, appendBatch, evaluateBatch, reviewDueBatches, formatPicks, formatReview,
};
