'use strict';
/**
 * 加密经济工具:市场总量/主导率、稳定币流动性、DeFi TVL、恐惧贪婪与代币经济体检。
 * 全部使用公开只读接口,不接钱包、不下单。代码只计算可验证指标,模型负责解释。
 */
const CG = process.env.CG_BASE || 'https://api.coingecko.com';
const LLAMA = process.env.LLAMA_BASE || 'https://api.llama.fi';
const STABLES = process.env.STABLES_BASE || 'https://stablecoins.llama.fi';
const FNG = process.env.FNG_BASE || 'https://api.alternative.me';

const cache = new Map();
const r2 = (x, n = 2) => (x == null || !isFinite(x)) ? null : +Number(x).toFixed(n);
const pct = (now, before) => before ? r2((now - before) / before * 100, 2) : null;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

async function json(url, ms = 10000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json', 'user-agent': 'monad-sprite/0.1' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const pending = Promise.resolve().then(load);
  cache.set(key, { expires: Date.now() + ttlMs, value: pending });
  try {
    const value = await pending;
    cache.set(key, { expires: Date.now() + ttlMs, value });
    return value;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

const usd = (asset, field) => Number(asset?.[field]?.peggedUSD) || 0;
const MAJOR_PEGS = new Set(['USDT', 'USDC', 'DAI', 'USDS', 'FDUSD', 'USDE', 'PYUSD', 'TUSD', 'FRAX', 'USDP', 'GUSD', 'LUSD', 'CRVUSD', 'USD0', 'RLUSD']);

function summarizeStablecoins(payload) {
  const assets = (payload?.peggedAssets || []).filter((x) => x.pegType === 'peggedUSD');
  const sum = (field) => assets.reduce((total, asset) => total + usd(asset, field), 0);
  const current = sum('circulating');
  const day = sum('circulatingPrevDay');
  const week = sum('circulatingPrevWeek');
  const month = sum('circulatingPrevMonth');
  const depegs = assets
    .filter((x) => MAJOR_PEGS.has(String(x.symbol || '').toUpperCase()) && usd(x, 'circulating') >= 5e7 && x.price != null && isFinite(+x.price) && Math.abs(+x.price - 1) >= 0.01)
    .map((x) => ({ symbol: x.symbol, price: r2(+x.price, 4), supply_usd: r2(usd(x, 'circulating'), 0), deviation_pct: r2((+x.price - 1) * 100, 2) }))
    .sort((a, b) => Math.abs(b.deviation_pct) - Math.abs(a.deviation_pct));
  return {
    supply_usd: r2(current, 0), change_1d_pct: pct(current, day), change_7d_pct: pct(current, week), change_30d_pct: pct(current, month),
    tracked_assets: assets.length, major_depegs: depegs.slice(0, 5),
  };
}

function summarizeTvl(points) {
  const data = (Array.isArray(points) ? points : []).filter((x) => isFinite(+x.tvl) && +x.tvl > 0).sort((a, b) => +a.date - +b.date);
  if (!data.length) throw new Error('DeFi TVL 数据为空');
  const at = (days) => +data[Math.max(0, data.length - 1 - days)].tvl;
  const current = at(0);
  return { tvl_usd: r2(current, 0), change_1d_pct: pct(current, at(1)), change_7d_pct: pct(current, at(7)), change_30d_pct: pct(current, at(30)) };
}

function classifyMarketPulse(parts) {
  const g = parts.global || {}, s = parts.stablecoins || {}, d = parts.defi || {}, f = parts.sentiment || {};
  const components = [];
  const add = (name, value, weight, scale) => {
    if (value == null || !isFinite(value)) return;
    const contribution = clamp(value / scale, -1, 1) * weight;
    components.push({ name, value: r2(value, 2), contribution: r2(contribution, 1) });
  };
  add('总市值24h', g.market_cap_change_24h_pct, 30, 4);
  add('稳定币供应7d', s.change_7d_pct, 25, 1.5);
  add('DeFi TVL 7d', d.change_7d_pct, 20, 6);
  if (f.value != null) add('恐惧贪婪', +f.value - 50, 25, 50);
  const score = components.length ? Math.round(components.reduce((sum, x) => sum + x.contribution, 0)) : null;
  const regime = score == null ? '未知' : score >= 30 ? '风险偏好' : score <= -30 ? '风险规避' : '中性震荡';
  const btc = g.btc_dominance_pct;
  const altcoinRegime = btc == null ? '未知' : btc >= 58 ? 'BTC主导' : btc <= 50 ? '山寨相对占优' : '均衡';
  const liquidity = s.change_7d_pct == null ? '未知' : s.change_7d_pct >= 0.5 ? '扩张' : s.change_7d_pct <= -0.5 ? '收缩' : '平稳';
  return { score, regime, altcoin_regime: altcoinRegime, stablecoin_liquidity: liquidity, components, note: '分数是环境温度计(-100~100),不是涨跌概率或交易信号' };
}

function summarizeGlobal(payload) {
  const x = payload?.data;
  if (!x) throw new Error('CoinGecko global 数据为空');
  const marketCap = +x.total_market_cap?.usd;
  const volume = +x.total_volume?.usd;
  return {
    market_cap_usd: r2(marketCap, 0), volume_24h_usd: r2(volume, 0),
    market_cap_change_24h_pct: r2(x.market_cap_change_percentage_24h_usd, 2), volume_change_24h_pct: r2(x.volume_change_percentage_24h_usd, 2),
    turnover_24h_pct: marketCap ? r2(volume / marketCap * 100, 2) : null,
    btc_dominance_pct: r2(x.market_cap_percentage?.btc, 2), eth_dominance_pct: r2(x.market_cap_percentage?.eth, 2),
    usdt_usdc_dominance_pct: r2((+x.market_cap_percentage?.usdt || 0) + (+x.market_cap_percentage?.usdc || 0), 2),
    active_cryptocurrencies: x.active_cryptocurrencies || null,
  };
}

function summarizeSentiment(payload) {
  const rows = payload?.data || [];
  if (!rows.length) throw new Error('恐惧贪婪数据为空');
  const values = rows.map((x) => +x.value).filter(isFinite);
  return {
    value: values[0], classification: rows[0].value_classification || null,
    change_1d: values[1] == null ? null : values[0] - values[1],
    average_7d: values.length ? r2(values.slice(0, 7).reduce((a, b) => a + b, 0) / Math.min(7, values.length), 1) : null,
  };
}

async function get_crypto_economy() {
  return cached('crypto-economy', 5 * 60 * 1000, async () => {
    const settled = await Promise.allSettled([
      json(`${CG}/api/v3/global`),
      json(`${STABLES}/stablecoins?includePrices=true`),
      json(`${LLAMA}/v2/historicalChainTvl`),
      json(`${FNG}/fng/?limit=8&format=json`),
    ]);
    const names = ['global', 'stablecoins', 'defi', 'sentiment'];
    const parsers = [summarizeGlobal, summarizeStablecoins, summarizeTvl, summarizeSentiment];
    const out = {};
    const missing = [];
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        try { out[names[i]] = parsers[i](result.value); } catch { missing.push(names[i]); }
      } else missing.push(names[i]);
    });
    if (!Object.keys(out).length) throw new Error('加密经济数据源全部不可用');
    const totalMarketCap = out.global?.market_cap_usd;
    if (totalMarketCap && out.stablecoins?.supply_usd) out.stablecoins.supply_to_market_cap_pct = r2(out.stablecoins.supply_usd / totalMarketCap * 100, 2);
    return {
      asOf: new Date().toISOString(), source: 'CoinGecko + DefiLlama + Alternative.me', quality: missing.length ? 'partial' : 'high', missing,
      ...out, regime: classifyMarketPulse(out),
      reminder: '市场温度分不是涨跌概率;稳定币供应与TVL变化代表流动性线索,不能单独作为买卖依据',
    };
  });
}

const KNOWN_IDS = {
  btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin', xrp: 'ripple', doge: 'dogecoin', ada: 'cardano',
  avax: 'avalanche-2', link: 'chainlink', dot: 'polkadot', sui: 'sui', trx: 'tron', ltc: 'litecoin', bch: 'bitcoin-cash',
  ton: 'the-open-network', gram: 'the-open-network',
};

async function resolveCoinId(query) {
  const raw = String(query || '').trim();
  if (!raw) throw new Error('请提供币种符号或 CoinGecko ID');
  const key = raw.toLowerCase().replace(/usdt$/, '');
  if (KNOWN_IDS[key]) return KNOWN_IDS[key];
  const result = await json(`${CG}/api/v3/search?query=${encodeURIComponent(raw)}`);
  const candidates = (result.coins || []).filter((x) => x.id && x.symbol);
  const exact = candidates.filter((x) => [x.id, x.symbol, x.name].some((v) => String(v || '').toLowerCase() === key));
  if (!exact.length) throw new Error(`无法唯一识别 ${raw},请使用 CoinGecko ID`);
  return exact.sort((a, b) => (a.market_cap_rank || 1e9) - (b.market_cap_rank || 1e9))[0].id;
}

function assessTokenEconomics(coin) {
  const m = coin?.market_data || {};
  const marketCap = +m.market_cap?.usd || null;
  const fdv = +m.fully_diluted_valuation?.usd || null;
  const volume = +m.total_volume?.usd || null;
  const circulating = +m.circulating_supply || null;
  const total = +m.total_supply || null;
  const max = +m.max_supply || null;
  const supplyBase = max || total;
  const circulatingRatio = circulating && supplyBase ? circulating / supplyBase * 100 : null;
  const fdvMultiple = fdv && marketCap ? fdv / marketCap : null;
  const turnover = volume && marketCap ? volume / marketCap * 100 : null;
  let risk = 0;
  const flags = [];
  if (fdvMultiple != null) {
    if (fdvMultiple >= 5) { risk += 30; flags.push('FDV/市值差距极高'); }
    else if (fdvMultiple >= 3) { risk += 24; flags.push('FDV/市值差距很高'); }
    else if (fdvMultiple >= 2) { risk += 16; flags.push('FDV/市值差距偏高'); }
    else if (fdvMultiple >= 1.25) { risk += 8; flags.push('存在估值稀释差'); }
  }
  if (circulatingRatio != null) {
    if (circulatingRatio < 20) { risk += 30; flags.push('流通比例极低'); }
    else if (circulatingRatio < 40) { risk += 22; flags.push('流通比例偏低'); }
    else if (circulatingRatio < 60) { risk += 14; flags.push('仍有较多未流通供应'); }
    else if (circulatingRatio < 80) { risk += 7; flags.push('仍有一定潜在稀释'); }
  } else flags.push('供应上限或总供应数据不完整');
  if (marketCap != null) {
    if (marketCap < 5e7) { risk += 20; flags.push('小市值波动风险高'); }
    else if (marketCap < 2.5e8) { risk += 14; flags.push('市值与深度偏小'); }
    else if (marketCap < 1e9) risk += 8;
    else if (marketCap < 5e9) risk += 3;
  }
  if (turnover != null) {
    if (turnover >= 100) { risk += 12; flags.push('换手率异常高,投机性强'); }
    else if (turnover >= 50) { risk += 8; flags.push('换手率很高'); }
    else if (turnover < 0.5) { risk += 10; flags.push('换手率很低,退出流动性有限'); }
    else if (turnover < 2) risk += 5;
  }
  if (m.max_supply_infinite === true) flags.push('无固定硬上限,需结合净发行与销毁机制判断');
  risk = Math.min(100, risk);
  const level = risk >= 75 ? '极高' : risk >= 50 ? '高' : risk >= 25 ? '中' : '低';
  const pressure = circulatingRatio == null && fdvMultiple == null ? '未知' : (circulatingRatio != null && circulatingRatio < 40) || (fdvMultiple != null && fdvMultiple >= 2) ? '高' : (circulatingRatio != null && circulatingRatio < 75) || (fdvMultiple != null && fdvMultiple >= 1.3) ? '中' : '低';
  return {
    token: { id: coin.id, symbol: String(coin.symbol || '').toUpperCase(), name: coin.name, market_cap_rank: coin.market_cap_rank || null },
    valuation: {
      price_usd: r2(m.current_price?.usd, 8), market_cap_usd: r2(marketCap, 0), fdv_usd: r2(fdv, 0), fdv_to_market_cap: r2(fdvMultiple, 2),
      volume_24h_usd: r2(volume, 0), turnover_24h_pct: r2(turnover, 2), price_change_24h_pct: r2(m.price_change_percentage_24h, 2),
    },
    supply: {
      circulating: r2(circulating, 2), total: r2(total, 2), max: r2(max, 2), circulating_ratio_pct: r2(circulatingRatio, 2),
      max_supply_infinite: m.max_supply_infinite ?? null, potential_dilution_pressure: pressure,
    },
    risk: { score: risk, level, flags: [...new Set(flags)] },
    quality: circulatingRatio == null || marketCap == null ? 'partial' : 'high',
    limitation: '公开市场数据不含未来解锁日历、团队/投资人归属与真实抛压;潜在稀释压力不等于即将解锁',
  };
}

async function analyze_tokenomics(symbol) {
  const id = await resolveCoinId(symbol);
  return cached(`tokenomics:${id}`, 10 * 60 * 1000, async () => {
    const coin = await json(`${CG}/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`);
    return { asOf: new Date().toISOString(), source: 'CoinGecko', ...assessTokenEconomics(coin) };
  });
}

const declarations = [
  { name: 'get_crypto_economy', description: '加密市场经济温度计:总市值/成交量、BTC与ETH主导率、稳定币供应变化、DeFi TVL、恐惧贪婪,并给风险偏好和流动性状态。用户问大盘环境、牛熊、资金是否进场、流动性、BTC吸血或山寨季时用。', parameters: { type: 'object', properties: {} } },
  { name: 'analyze_tokenomics', description: '代币经济体检:市值与FDV、流通率、潜在稀释压力、24h换手率和风险旗标。用户问某币代币经济、通胀、FDV、流通盘、估值是否虚高时用;不包含未来解锁日历。', parameters: { type: 'object', properties: { symbol: { type: 'string', description: '币种符号或CoinGecko ID,如 ETH/SOL/arbitrum' } }, required: ['symbol'] } },
];
const impl = { get_crypto_economy, analyze_tokenomics };

module.exports = { declarations, impl, _test: { summarizeGlobal, summarizeStablecoins, summarizeTvl, summarizeSentiment, classifyMarketPulse, assessTokenEconomics } };
