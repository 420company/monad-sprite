'use strict';
/**
 * Full-market screener (OKX /market/tickers, read-only): gainers / volume / losers.
 * Filters: -USDT spot only, drop leveraged tokens (3L/3S/5L/5S/UP/DOWN) and stablecoin bases; gainers need a min-volume floor against "wick microcaps".
 */
const OKX = process.env.OKX_BASE || 'https://www.okx.com';
const j = async (u, ms = 8000) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); try { const r = await fetch(u, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); const d = await r.json(); if (d.code && d.code !== '0') throw new Error('OKX ' + d.code); return d; } finally { clearTimeout(t); } };
const STABLE = new Set(['USDC', 'DAI', 'TUSD', 'FDUSD', 'USDD', 'USDP', 'PYUSD', 'EURT', 'USTC', 'FRAX', 'USDE', 'GUSD']);
const isLev = (b) => /(\d+[LS])$/.test(b) || /-(UP|DOWN)$/.test(b);
const r2 = (x, n = 2) => (x == null || !isFinite(x)) ? null : +Number(x).toFixed(n);

async function rows() {
  const d = await j(`${OKX}/api/v5/market/tickers?instType=SPOT`);
  return (d.data || []).filter((x) => x.instId.endsWith('-USDT')).map((x) => {
    const b = x.instId.replace('-USDT', ''); const last = +x.last, open = +x.open24h;
    return { sym: b, last, chg: open ? (last - open) / open * 100 : 0, vol_usdt: +x.volCcy24h, high: +x.high24h, low: +x.low24h };
  }).filter((x) => x.sym && !isLev(x.sym) && !STABLE.has(x.sym) && isFinite(x.chg));
}

// Full-market screener: gainers/volume/losers boards. min_vol_usdt = min 24h volume for the mover boards (default 3M, filters wick microcaps)
async function get_top_movers(limit = 8, min_vol_usdt = 3e6) {
  const all = await rows();
  const liquid = all.filter((x) => x.vol_usdt >= (Number(min_vol_usdt) || 3e6));
  const n = Math.min(Math.max(Number(limit) || 8, 3), 20);
  const fmt = (x) => ({ sym: x.sym, price: r2(x.last, x.last < 1 ? 6 : 2), chg_24h_pct: r2(x.chg, 2), vol_usdt_m: r2(x.vol_usdt / 1e6, 1) });
  return {
    source: 'OKX', universe: all.length, liquid_universe: liquid.length, min_vol_usdt,
    top_gainers: liquid.slice().sort((a, b) => b.chg - a.chg).slice(0, n).map(fmt),
    top_losers: liquid.slice().sort((a, b) => a.chg - b.chg).slice(0, n).map(fmt),
    top_volume: all.slice().sort((a, b) => b.vol_usdt - a.vol_usdt).slice(0, n).map(fmt),
  };
}

const declarations = [
  { name: 'get_top_movers', description: '全市场甄选(OKX,1300+ USDT现货):24h 涨幅榜/跌幅榜/成交量榜。用户问"今天什么币涨得猛/放量/领涨领跌/有什么异动"或做每日盘面扫描时用。已剔除杠杆代币和低流动性插针小币。', parameters: { type: 'object', properties: { limit: { type: 'number', description: '每个榜取几个,默认8' }, min_vol_usdt: { type: 'number', description: '涨跌幅榜最低24h成交额(USDT),默认300万' } } } },
];
const impl = { get_top_movers };
module.exports = { declarations, impl, rows };
