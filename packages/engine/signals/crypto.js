'use strict';
/**
 * 加密行情工具 —— 单一数据源 OKX 公开 API(美国 GCE 可达;Binance api/fapi 在美被 451、Bybit 403)。
 * 纯外部只读:现货 ticker + K线 candles + 期货资金费率/OI/多空比,QuickChart 出图。
 * 零本地文件/shell/代码访问 —— 只出站 HTTPS。安全边界靠"工具白名单"。指标本地算,给 Gemini 真数值。
 */
const OKX = process.env.OKX_BASE || 'https://www.okx.com';
// 带 8s 超时(AbortController),防止 fetch 挂死拖垮整个回答
const j = async (u, ms = 8000) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); try { const r = await fetch(u, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); const d = await r.json(); if (d.code && d.code !== '0') throw new Error('OKX ' + d.code + ' ' + (d.msg || '')); return d; } finally { clearTimeout(t); } };
const sym = (s) => String(s || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
const base = (s) => s.replace(/USDT$/, '');                    // BTCUSDT → BTC
const spotId = (s) => base(s) + '-USDT';                       // → BTC-USDT
const swapId = (s) => base(s) + '-USDT-SWAP';                  // → BTC-USDT-SWAP(永续)
const okxBar = (iv) => ({ '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '12h': '12H', '1d': '1D', '1w': '1W' }[String(iv || '4h').toLowerCase()] || '4H');

// ---- 指标 ----
function ema(vals, p) { const k = 2 / (p + 1); let e = vals[0]; const out = [e]; for (let i = 1; i < vals.length; i++) { e = vals[i] * k + e * (1 - k); out.push(e); } return out; }
function rsi(closes, p = 14) {
  if (closes.length < p + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = closes[i] - closes[i - 1]; d >= 0 ? (g += d) : (l -= d); }
  g /= p; l /= p;
  for (let i = p + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; g = (g * (p - 1) + (d > 0 ? d : 0)) / p; l = (l * (p - 1) + (d < 0 ? -d : 0)) / p; }
  const rs = l === 0 ? 100 : g / l; return +(100 - 100 / (1 + rs)).toFixed(1);
}
function macd(closes) {
  if (closes.length < 35) return null;
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const dif = closes.map((_, i) => e12[i] - e26[i]);
  const dea = ema(dif.slice(26), 9);
  const d = dif[dif.length - 1], s = dea[dea.length - 1];
  return { dif: +d.toFixed(1), dea: +s.toFixed(1), hist: +((d - s) * 2).toFixed(1) };
}
// OKX candles 是"新→旧",取回来反成"旧→新"。每根末位 confirm:'1'=已收盘 '0'=进行中。
async function okxCandles(s, bar, limit) {
  const d = await j(`${OKX}/api/v5/market/candles?instId=${spotId(s)}&bar=${bar}&limit=${Math.min(Math.max(Number(limit) || 300, 30), 300)}`);
  return (d.data || []).slice().reverse();
}

// ---- 工具实现 ----
async function get_market(symbol) {
  const s = sym(symbol);
  const t = (await j(`${OKX}/api/v5/market/ticker?instId=${spotId(s)}`)).data[0];
  const last = +t.last, open24 = +t.open24h;
  const out = { symbol: s, source: 'OKX', price: last, change_24h_pct: open24 ? +(((last - open24) / open24) * 100).toFixed(2) : null, high_24h: +t.high24h, low_24h: +t.low24h, volume_24h: +t.vol24h, quote_volume_24h: +t.volCcy24h };
  const inst = swapId(s), ccy = base(s); // 永续合约动能(失败不阻断)
  try { const fr = await j(`${OKX}/api/v5/public/funding-rate?instId=${inst}`); if (fr.data && fr.data[0]) out.funding_rate = +fr.data[0].fundingRate; } catch {}
  try { const oi = await j(`${OKX}/api/v5/public/open-interest?instId=${inst}`); if (oi.data && oi.data[0]) out.open_interest = +oi.data[0].oiCcy; } catch {}
  try { const ls = await j(`${OKX}/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=1H`); if (ls.data && ls.data[0]) out.long_short_ratio = +ls.data[0][1]; } catch {}
  return out;
}
async function get_klines(symbol, interval = '4h', limit = 300) {
  const s = sym(symbol), bar = okxBar(interval);
  const raw = await okxCandles(s, bar, limit);
  if (!raw.length) throw new Error('无 K 线数据(检查币种)');
  const k = raw.filter((c) => c[8] === '1');        // ★只用已收盘 K 线算指标,避免进行中 K 线导致 EMA/MACD/RSI 重绘
  if (k.length < 35) throw new Error('已收盘 K 线不足以计算指标');
  const closes = k.map((c) => +c[4]);
  const livePrice = +raw[raw.length - 1][4];          // 含未收盘的最新价(供参考,指标不用它)
  const lastClosed = closes[closes.length - 1];
  const e = (p) => { const a = ema(closes, p); return +a[a.length - 1].toFixed(1); };
  const recent = k.slice(-12).map((c) => ({ t: +c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] }));
  return {
    symbol: s, source: 'OKX', interval: bar,
    price: livePrice, last_closed: lastClosed, closed_candles: k.length, indicators_on: 'closed_candles_only',
    ema7: e(7), ema25: e(25), ema99: e(99), rsi14: rsi(closes), macd: macd(closes),
    period_high: Math.max(...k.map((c) => +c[2])), period_low: Math.min(...k.map((c) => +c[3])),
    last_12_candles: recent,
  };
}
// TradingView(chart-img)周期映射
const tvIv = (iv) => ({ '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1D', '1w': '1W' }[String(iv || '4h').toLowerCase()] || '4h');
// chart-img:真 TradingView 高级图(带 EMA/RSI/MACD、深色)。返回 PNG 字节 base64。无 key/失败则抛出→上层回退 QuickChart。
async function tvChart(s, interval) {
  const key = process.env.CHARTIMG_KEY;
  if (!key) throw new Error('no CHARTIMG_KEY');
  const ex = process.env.CHART_EXCHANGE || 'BINANCE';
  // chart-img 免费档最多 3 个指标 → 用 EMA7/25/99 三条均线(对应均线排列多空判断);RSI/MACD 数值在文字分析里已给。
  // 升级付费档可加更多:设 env CHARTIMG_STUDIES 覆盖(JSON 数组)。
  const defStudies = [{ name: 'Moving Average Exponential', input: { length: 7 } }, { name: 'Moving Average Exponential', input: { length: 25 } }, { name: 'Moving Average Exponential', input: { length: 99 } }];
  let studies = defStudies; try { if (process.env.CHARTIMG_STUDIES) studies = JSON.parse(process.env.CHARTIMG_STUDIES); } catch {}
  const body = { symbol: `${ex}:${s}`, interval: tvIv(interval), theme: 'dark', width: 800, height: 600, studies };
  const to = withTimeoutSignal(12000);
  try {
    const r = await fetch('https://api.chart-img.com/v2/tradingview/advanced-chart', { method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: to.signal });
    if (!r.ok) throw new Error('chart-img HTTP ' + r.status);
    const ct = r.headers.get('content-type') || '';
    let buf;
    if (ct.includes('application/json')) { const jj = await r.json(); const u = jj.url || (jj.data && jj.data.url); if (!u) throw new Error('chart-img 无 url'); const p = await fetch(u); buf = Buffer.from(await p.arrayBuffer()); }
    else buf = Buffer.from(await r.arrayBuffer());
    return { chart_b64: buf.toString('base64'), source: 'TradingView', symbol: s, interval: tvIv(interval) };
  } finally { to.done(); }
}
function withTimeoutSignal(ms) { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); return { signal: ac.signal, done: () => clearTimeout(t) }; }
// QuickChart 回退:Chart.js 蜡烛图 → 下成 PNG 字节 base64
async function quickChart(s, bar) {
  const k = await okxCandles(s, bar, 48);
  const data = k.map((c) => ({ x: +c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4] }));
  const cfg = { type: 'candlestick', data: { datasets: [{ label: `${base(s)}/USDT ${bar}`, data }] }, options: { plugins: { legend: { display: true } }, scales: { x: { type: 'time' } } } };
  const r = await fetch('https://quickchart.io/chart/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chart: cfg, width: 800, height: 450, backgroundColor: '#0b0e13' }) });
  const jr = await r.json();
  if (!jr.url) throw new Error('chart 生成失败');
  const png = await fetch(jr.url); const buf = Buffer.from(await png.arrayBuffer());
  return { chart_b64: buf.toString('base64'), source: 'QuickChart', symbol: s, interval: bar };
}
// 出图:优先真 TradingView(chart-img),失败/无 key 回退 QuickChart。统一返回 chart_b64(PNG字节)。
async function get_kline_chart(symbol, interval = '4h') {
  const s = sym(symbol), bar = okxBar(interval);
  try { return await tvChart(s, interval); }
  catch (e) { if (process.env.CHARTIMG_KEY) console.error('chart-img 失败,回退 QuickChart:', e.message); return await quickChart(s, bar); }
}

const declarations = [
  { name: 'get_market', description: '某币种实时行情(OKX):现价/24h涨跌/高低/成交量 + 永续资金费率/持仓量OI/多空比', parameters: { type: 'object', properties: { symbol: { type: 'string', description: '如 BTCUSDT/ETHUSDT/TONUSDT/SOLUSDT,默认 BTCUSDT' } } } },
  { name: 'get_klines', description: '某周期K线技术数据(OKX):现价 + EMA7/25/99 + RSI14 + MACD + 区间高低 + 最近12根蜡烛(用于趋势/均线排列/背驰分析)', parameters: { type: 'object', properties: { symbol: { type: 'string' }, interval: { type: 'string', description: '5m/15m/1h/4h/1d/1w,默认 4h' }, limit: { type: 'number', description: 'K线根数,默认120' } } } },
  { name: 'get_kline_chart', description: '生成某币种某周期 K 线蜡烛图图片(用户要"看图/画K线"时用),返回 chart_url', parameters: { type: 'object', properties: { symbol: { type: 'string' }, interval: { type: 'string', description: '默认 4h' } } } },
];
const impl = { get_market, get_klines, get_kline_chart };
module.exports = { declarations, impl };
