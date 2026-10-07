'use strict';
/** config.js — config.yaml + environment variable overrides */
const fs = require('fs');
const path = require('path');

function loadConfig() {
  const cfgPath = process.env.SPRITE_CONFIG || path.join(__dirname, 'config.yaml');
  let file = {};
  if (fs.existsSync(cfgPath)) {
    // Minimal YAML parser (supports key: value with two-level indent only)
    let section = null;
    for (const rawLine of fs.readFileSync(cfgPath, 'utf8').split('\n')) {
      const line = rawLine.replace(/\s+#.*$/, ''); // strip trailing comments
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) { section = m[1]; file[section] = file[section] || {}; if (m[2]) file[section] = cast(m[2]); continue; }
      const m2 = line.match(/^\s+(\w+):\s*(.+)$/);
      if (m2 && section && typeof file[section] === 'object') file[section][m2[1]] = cast(m2[2]);
    }
  }
  const env = (k, d) => (process.env[k] !== undefined ? cast(process.env[k]) : d);
  const g = (s, k, d) => (file[s] && file[s][k] !== undefined ? file[s][k] : d);
  return {
    chainId: env('CHAIN_ID', g('chain', 'id', 10143)),
    rpcUrl: env('MONAD_TESTNET_RPC', g('chain', 'rpc', 'https://testnet-rpc.monad.xyz')),
    radarApi: env('RADAR_API', g('radar', 'api', '')),
    monPriceUsd: env('MON_PRICE_USD', g('executor', 'monPriceUsd', 1)),
    guard: {
      equity: env('EQUITY', g('guard', 'equity', 1000)),
      minRadarScore: env('MIN_RADAR_SCORE', g('guard', 'minRadarScore', 60)),
      dangerScore: env('DANGER_SCORE', g('guard', 'dangerScore', 35)),
      maxSlippagePct: env('MAX_SLIPPAGE_PCT', g('guard', 'maxSlippagePct', 0.03)),
    },
    paper: { intervalMs: env('PAPER_INTERVAL_MS', g('paper', 'intervalMs', 30000)) },
  };
}
function cast(v) {
  v = String(v).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1); // strip YAML quotes
  }
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
  if (v === 'true') return true; if (v === 'false') return false;
  return v;
}

module.exports = { loadConfig };
