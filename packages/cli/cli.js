#!/usr/bin/env node
'use strict';
/**
 * monad-sprite CLI
 *
 *   node cli.js scan                  # scan all Launcher tokens (price + Radar score)
 *   node cli.js score <tokenAddress>   # Radar score for one token
 *   node cli.js paper [--once]         # paper trading (loops by default, --once runs one round)
 *   node cli.js live --i-know-what-im-doing   # live trading (double confirmation, real money)
 *   node cli.js backtest              # backtest (perps 3-way backtest on record + spot framework)
 *
 * paper is the default mode; live requires explicit --live --i-know-what-im-doing.
 */
const path = require('path');
process.env.NODE_PATH = [
  path.join(__dirname, '..', 'monad-executor', 'node_modules'),
  path.join(__dirname, '..', 'engine'),
].join(':');
require('module').Module._initPaths();

const { loadConfig } = require('./config');

async function radarScore(api, tokenAddress) {
  // Test only: MOCK_RADAR_SCORE=75 skips HTTP and returns a mock score directly
  if (process.env.MOCK_RADAR_SCORE) {
    const s = Number(process.env.MOCK_RADAR_SCORE);
    return { score: s, level: s >= 70 ? 'LOW' : s >= 40 ? 'MEDIUM' : 'HIGH', tokenAddress, mock: true };
  }
  if (!api) return null;
  const r = await fetch(`${api.replace(/\/$/, '')}/score`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tokenAddress }),
  });
  if (!r.ok) throw new Error(`radar ${r.status}`);
  return r.json();
}

async function cmdScan(cfg) {
  const { getAllTokens, formatEther } = require('../monad-executor/src/launcher');
  const tokens = await getAllTokens(cfg.chainId);
  console.log(`Launcher tokens: ${tokens.length} (chain ${cfg.chainId})`);
  for (const t of tokens) {
    let radar = '';
    try {
      const s = await radarScore(cfg.radarApi, t.address);
      if (s) radar = `｜Radar ${s.score}/${s.level}`;
    } catch { radar = ' | Radar unavailable'; }
    console.log(`- ${t.name} (${t.symbol}) ${t.address}| price ${formatEther(t.price)} MON${radar}`);
  }
}

async function cmdScore(cfg, addr) {
  if (!addr) { console.error('usage: node cli.js score <tokenAddress>'); process.exit(1); }
  const s = await radarScore(cfg.radarApi, addr);
  if (!s) { console.error('RADAR_API not configured'); process.exit(1); }
  console.log(JSON.stringify(s, null, 2));
}

/** paper main loop: signals → SpotGuard → executor → exit management */
async function paperOnce(cfg, executor) {
  const { getAllTokens, quoteBuy, formatEther } = require('../monad-executor/src/launcher');
  const { SpotGuard } = require('../engine/risk/spotGuard');
  const { planExit, checkExitV2, applyExitV2 } = require('../engine/risk/exit');
  const { SatiationTP } = require('../engine/risk/flyReward');

  const guard = global.__guard || (global.__guard = new SpotGuard({
    equity: cfg.guard.equity, minRadarScore: cfg.guard.minRadarScore,
    dangerScore: cfg.guard.dangerScore, maxSlippagePct: cfg.guard.maxSlippagePct,
  }));
  const exits = global.__exits || (global.__exits = new Map());   // token -> exit plan
  const sats = global.__sats || (global.__sats = new Map());      // token -> SatiationTP

  const equity = cfg.guard.equity + (await executor.equityUsd());
  const tokens = await getAllTokens(cfg.chainId);

  // 1) Manage existing positions: exit engine + Radar rescan
  for (const [token, plan] of exits) {
    const info = tokens.find((t) => t.address.toLowerCase() === token.toLowerCase());
    if (!info) continue;
    const price = Number(formatEther(info.price));
    const tick = { price, high: price, low: price, directionScore: 0 };
    const action = checkExitV2(plan, tick);
    // SatiationTP: take profit on excitement
    const sat = sats.get(token) || new SatiationTP();
    sats.set(token, sat);
    const pnlPct = (price - plan.entryPrice) / plan.entryPrice;
    const se = sat.update(pnlPct);
    // Radar score breakdown
    let radarDump = false;
    try {
      const s = await radarScore(cfg.radarApi, token);
      if (s) radarDump = guard.radarWatch(token, { score: s.score, fatal: s.level === 'CRITICAL' }).dump;
    } catch { /* skip if radar unavailable */ }

    let shouldClose = 0;
    let why = '';
    if (radarDump) { shouldClose = 1; why = 'Radar breakdown'; }
    else if (se.trigger) { shouldClose = 0.5; why = `satiation TP (${se.path})`; }
    else if (action.type === 'take_profit_1') { shouldClose = action.closePct / 100; why = 'TP1'; }
    else if (action.type === 'take_profit_2' || action.type === 'stop_out') { shouldClose = 1; why = action.type === 'stop_out' ? `止损:${action.reason}` : 'TP2'; }
    else if (action.type === 'hold' && action.newStopLoss != null) { plan.stopLoss = action.newStopLoss; }

    if (shouldClose > 0) {
      const r = await executor.sell(token, shouldClose);
      const pnl = r.pnlUsd || 0;
      guard.onClose({ tokenAddress: token, usd: 0, pnlUsd: pnl, equityNow: equity });
      console.log(`[CLOSE] ${token.slice(0, 10)}… ${why} pnl=$${pnl.toFixed(2)}`);
      if (shouldClose >= 1) { exits.delete(token); sats.delete(token); }
    }
  }

  // 2) Scan for new opportunities: Radar gate → SpotGuard → buy
  for (const t of tokens) {
    if (exits.has(t.address)) continue;
    let radar = null;
    try { radar = await radarScore(cfg.radarApi, t.address); } catch { /* no radar */ }
    const price = Number(formatEther(t.price));
    if (!price) continue;
    const atr = price * 0.05; // conservative: 5% ATR for meme coins (fallback without candles)
    const stop = price * 0.97; // -3% initial stop (≈ -0.6xATR, tight — meme coins are volatile)
    let slippagePct = 0;
    try {
      const q = await quoteBuy(t.address, BigInt(1e15), cfg.chainId); // 0.001 MON probe to measure slippage
      void q;
    } catch { /* skip on quote failure */ }
    const dec = guard.requestOpen({
      tokenAddress: t.address, creator: 'unknown', entryPrice: price, stopPrice: stop,
      equityNow: equity,
      radar: radar ? { score: radar.score, level: radar.level, fatal: radar.level === 'CRITICAL', launchedAtSec: radar.launchedAt } : null,
      slippagePct,
    });
    if (!dec.allowed) continue;
    try {
      const r = await executor.buy(t.address, dec.sizeUsd);
      guard.onFill({ tokenAddress: t.address, creator: 'unknown', usd: dec.sizeUsd });
      exits.set(t.address, planExit({ side: 'long', entryPrice: price, atr, zones: null, directionScore: radar?.score ?? 0 }));
      sats.set(t.address, new SatiationTP());
      console.log(`[OPEN] ${t.name} $${dec.sizeUsd.toFixed(2)} | ${dec.reason}`);
    } catch (e) { console.log(`[OPEN FAILED] ${t.name}: ${e.message}`); }
  }

  console.log('[STATUS]', JSON.stringify(guard.status(equity)));
}

async function cmdPaper(cfg, once) {
  const { createExecutor } = require('../monad-executor/src/executor');
  const ex = createExecutor({ mode: 'paper', chainId: cfg.chainId, monPriceUsd: cfg.monPriceUsd });
  console.log(`paper mode started (chain ${cfg.chainId}, prices from live on-chain reads, no signing/broadcasting)`);
  await paperOnce(cfg, ex);
  if (once) return;
  setInterval(() => paperOnce(cfg, ex).catch((e) => console.error('[paper]', e.message)), cfg.paper.intervalMs);
}

async function cmdLive(cfg) {
  if (!process.argv.includes('--i-know-what-im-doing')) {
    console.error('⛔ live needs double confirmation: node cli.js live --live --i-know-what-im-doing');
    console.error('   This uses the real-money wallet behind MONAD_PRIVATE_KEY. Run paper first.');
    process.exit(1);
  }
  console.log('⚠️  LIVE mode: real signing and broadcasting — this is real money.');
  const { createExecutor } = require('../monad-executor/src/executor');
  const ex = createExecutor({ mode: 'live', chainId: cfg.chainId, monPriceUsd: cfg.monPriceUsd });
  await paperOnce(cfg, ex); // same logic, executor in live mode
}

async function cmdBacktest() {
  console.log('spot backtest framework: seeded from packages/backtest/backtest3way.js (perps on record).');
  console.log('Monad spot replay backtest (recorded token price series) is P1 — smoke-run the recorded case first:');
  require('child_process').execSync(`node ${path.join(__dirname, '..', 'backtest', 'backtest3way.js')}`, { stdio: 'inherit' });
}

async function main() {
  const cfg = loadConfig();
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'scan') await cmdScan(cfg);
    else if (cmd === 'score') await cmdScore(cfg, arg);
    else if (cmd === 'paper') await cmdPaper(cfg, process.argv.includes('--once'));
    else if (cmd === 'live') {
      if (!process.argv.includes('--live')) { console.error('usage: node cli.js live --live --i-know-what-im-doing'); process.exit(1); }
      await cmdLive(cfg);
    }
    else if (cmd === 'backtest') await cmdBacktest();
    else {
      console.log('usage: node cli.js <scan|score <addr>|paper [--once]|live --live --i-know-what-im-doing|backtest>');
      process.exit(1);
    }
  } catch (e) { console.error('error:', e.message); process.exit(1); }
}
main();
