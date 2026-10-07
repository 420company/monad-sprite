'use strict';
/**
 * Sector rotation (CoinGecko /coins/categories, free read-only): which sectors rise/fall + representative coins.
 * Filters a minimum market-cap floor, dropping noisy micro-sectors like "Trading Bots +581%". Reachable from US GCE.
 */
const CG = process.env.CG_BASE || 'https://api.coingecko.com';
const j = async (u, ms = 10000) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); try { const r = await fetch(u, { signal: ac.signal, headers: { accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); } };
const r2 = (x, n = 2) => (x == null || !isFinite(x)) ? null : +Number(x).toFixed(n);

// Sector rotation: sort by 24h market-cap change, filter min market cap (default $100M) against noise
async function get_sector_rotation(limit = 8, min_mcap_usd = 5e8) {
  const d = await j(`${CG}/api/v3/coins/categories?order=market_cap_change_24h_desc`);
  if (!Array.isArray(d)) throw new Error('CoinGecko 返回异常');
  const min = Number(min_mcap_usd) || 1e8;
  const clean = d.filter((c) => (c.market_cap || 0) >= min && c.market_cap_change_24h != null)
    .map((c) => ({ name: c.name, chg_24h_pct: r2(c.market_cap_change_24h, 2), mcap_b: r2((c.market_cap || 0) / 1e9, 2), vol_b: r2((c.volume_24h || 0) / 1e9, 2), top_coins: (c.top_3_coins_id || []).slice(0, 3) }));
  const n = Math.min(Math.max(Number(limit) || 8, 3), 15);
  return {
    source: 'CoinGecko', sectors_scanned: d.length, min_mcap_usd: min,
    hot_sectors: clean.slice(0, n),                                   // 领涨板块(资金流入)
    cold_sectors: clean.slice().sort((a, b) => a.chg_24h_pct - b.chg_24h_pct).slice(0, n), // 领跌板块(资金流出)
    note: '板块=CoinGecko分类的成分币市值加权24h变化;轮动看资金从冷板块流向热板块的节奏',
  };
}

const declarations = [
  { name: 'get_sector_rotation', description: '板块轮动(CoinGecko):当前哪些板块/赛道在领涨(资金流入)、哪些在领跌(流出),含代表币。用户问"什么板块在轮动/现在什么行情/下一个板块/哪里能埋伏"时用,结合资金从冷板块流向热板块的节奏做轮动判断。', parameters: { type: 'object', properties: { limit: { type: 'number', description: '取几个板块,默认8' }, min_mcap_usd: { type: 'number', description: '板块最低市值门槛(美元),默认5亿(滤噪声小板块)' } } } },
];
const impl = { get_sector_rotation };
module.exports = { declarations, impl };
