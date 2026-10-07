'use strict';
/**
 * ZALIEN #3 记忆 + 自省:记录每次方向判断,事后与实际价对账,沉淀命中率(战绩)与教训。
 * 纯本地 JSON 文件,轻量。predictions.json=判断流水,learnings.json=深度复盘沉淀的教训。
 */
const fs = require('fs'); const path = require('path');
const PRED = path.join(__dirname, 'predictions.json');
const LEARN = path.join(__dirname, 'learnings.json');
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const save = (f, o) => { try { fs.writeFileSync(f, JSON.stringify(o)); } catch (e) { console.error('memory save fail', e.message); } };
const r2 = (x, n = 2) => (x == null || !isFinite(x)) ? null : +Number(x).toFixed(n);

// 记一次方向判断(分析/日报时调)
function logPrediction(p) {
  if (!p || !p.symbol || !p.price || !p.lean) return;
  const a = load(PRED, []);
  a.push({ id: `${Date.now()}-${p.symbol}`, ts: Date.now(), symbol: p.symbol, price: +p.price, lean: p.lean, confidence: p.confidence || null, dscore: p.direction_score ?? null, source: p.source || 'analysis', status: 'open' });
  if (a.length > 3000) a.splice(0, a.length - 3000);
  save(PRED, a);
}

// 自省对账:把 ≥minAgeH 小时前仍 open 的判断,与现价比对打分。getPrice(symbol)→现价数字。
async function review(getPrice, minAgeH = 20, expireDays = 7) {
  const a = load(PRED, []); const now = Date.now(); let evaluated = 0, hit = 0;
  const priceCache = {};
  for (const p of a) {
    if (p.status !== 'open') continue;
    const ageH = (now - p.ts) / 3.6e6;
    if (ageH < minAgeH) continue;
    if (ageH > expireDays * 24) { p.status = 'expired'; continue; }
    try {
      if (priceCache[p.symbol] == null) priceCache[p.symbol] = await getPrice(p.symbol);
      const cur = priceCache[p.symbol];
      if (!cur) continue;
      const chg = (cur - p.price) / p.price * 100;
      let isHit;
      if (p.lean === '偏多') isHit = chg > 0.3;
      else if (p.lean === '偏空') isHit = chg < -0.3;
      else isHit = Math.abs(chg) <= 1.5; // 中性=震荡视为对
      p.status = 'done'; p.outcome_price = r2(cur, 2); p.chg_pct = r2(chg, 2); p.hit = isHit; p.reviewedAt = now;
      evaluated++; if (isHit) hit++;
    } catch (e) { /* 取价失败下次再评 */ }
  }
  if (evaluated) save(PRED, a);
  return { evaluated, hit, winRate: evaluated ? Math.round(hit / evaluated * 100) : null };
}

// 战绩:总体 + 近30 + 按置信度 + 按币种
function trackRecord(symbol) {
  const done = load(PRED, []).filter((x) => x.status === 'done' && (!symbol || x.symbol === symbol));
  if (!done.length) return { total: 0, note: '暂无已验证的历史判断(刚起步)' };
  const wr = (arr) => arr.length ? Math.round(arr.filter((x) => x.hit).length / arr.length * 100) : null;
  const recent = done.slice(-30);
  const byConf = {}; ['高', '中', '低'].forEach((c) => { const s = done.filter((x) => x.confidence === c); if (s.length) byConf[c] = { n: s.length, win_rate: wr(s) }; });
  return { total: done.length, win_rate: wr(done), recent30: { n: recent.length, win_rate: wr(recent) }, by_confidence: byConf, symbol: symbol || 'all' };
}

// 最近已验证的判断(供深度复盘/展示)
function recentDone(n = 40) { return load(PRED, []).filter((x) => x.status === 'done').slice(-n).map((x) => ({ symbol: x.symbol, lean: x.lean, confidence: x.confidence, entry: x.price, out: x.outcome_price, chg_pct: x.chg_pct, hit: x.hit })); }

// 教训(深度复盘沉淀,注入 prompt 实现自我进化)
function getLearnings() { const l = load(LEARN, null); return l && l.text ? l : null; }
function saveLearnings(text) { save(LEARN, { ts: Date.now(), text: String(text || '').slice(0, 2000) }); }

module.exports = { logPrediction, review, trackRecord, recentDone, getLearnings, saveLearnings };
