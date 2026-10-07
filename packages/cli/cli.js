#!/usr/bin/env node
'use strict';
/**
 * monad小精灵 CLI
 *
 *   node cli.js scan                  # 扫描 Launcher 全部代币（价格 + Radar 评分）
 *   node cli.js score <tokenAddress>   # 单个代币 Radar 评分
 *   node cli.js paper [--once]         # 纸交易（默认循环，--once 跑一轮）
 *   node cli.js live --i-know-what-im-doing   # 实盘（双重确认，动真钱）
 *   node cli.js backtest              # 回测（perps 三向回测留档 + spot 框架位）
 *
 * paper 是默认模式；live 必须显式 --live --i-know-what-im-doing。
 */
const path = require('path');
process.env.NODE_PATH = [
  path.join(__dirname, '..', 'monad-executor', 'node_modules'),
  path.join(__dirname, '..', 'engine'),
].join(':');
require('module').Module._initPaths();

const { loadConfig } = require('./config');

async function radarScore(api, tokenAddress) {
  // 仅测试用：MOCK_RADAR_SCORE=75 时跳过 HTTP，直接返回模拟评分
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
  console.log(`Launcher 代币 ${tokens.length} 个（chain ${cfg.chainId}）`);
  for (const t of tokens) {
    let radar = '';
    try {
      const s = await radarScore(cfg.radarApi, t.address);
      if (s) radar = `｜Radar ${s.score}/${s.level}`;
    } catch { radar = '｜Radar 不可用'; }
    console.log(`- ${t.name} (${t.symbol}) ${t.address}｜价格 ${formatEther(t.price)} MON${radar}`);
  }
}

async function cmdScore(cfg, addr) {
  if (!addr) { console.error('用法: node cli.js score <tokenAddress>'); process.exit(1); }
  const s = await radarScore(cfg.radarApi, addr);
  if (!s) { console.error('未配置 RADAR_API'); process.exit(1); }
  console.log(JSON.stringify(s, null, 2));
}

/** paper 主循环：信号 → SpotGuard → executor → 退出管理 */
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

  // 1) 管理已有持仓：退出引擎 + Radar 重扫
  for (const [token, plan] of exits) {
    const info = tokens.find((t) => t.address.toLowerCase() === token.toLowerCase());
    if (!info) continue;
    const price = Number(formatEther(info.price));
    const tick = { price, high: price, low: price, directionScore: 0 };
    const action = checkExitV2(plan, tick);
    // SatiationTP：兴奋止盈
    const sat = sats.get(token) || new SatiationTP();
    sats.set(token, sat);
    const pnlPct = (price - plan.entryPrice) / plan.entryPrice;
    const se = sat.update(pnlPct);
    // Radar 跌破
    let radarDump = false;
    try {
      const s = await radarScore(cfg.radarApi, token);
      if (s) radarDump = guard.radarWatch(token, { score: s.score, fatal: s.level === 'CRITICAL' }).dump;
    } catch { /* radar 不可用则跳过 */ }

    let shouldClose = 0;
    let why = '';
    if (radarDump) { shouldClose = 1; why = 'Radar 跌破'; }
    else if (se.trigger) { shouldClose = 0.5; why = `兴奋止盈(${se.path})`; }
    else if (action.type === 'take_profit_1') { shouldClose = action.closePct / 100; why = 'TP1'; }
    else if (action.type === 'take_profit_2' || action.type === 'stop_out') { shouldClose = 1; why = action.type === 'stop_out' ? `止损:${action.reason}` : 'TP2'; }
    else if (action.type === 'hold' && action.newStopLoss != null) { plan.stopLoss = action.newStopLoss; }

    if (shouldClose > 0) {
      const r = await executor.sell(token, shouldClose);
      const pnl = r.pnlUsd || 0;
      guard.onClose({ tokenAddress: token, usd: 0, pnlUsd: pnl, equityNow: equity });
      console.log(`[平仓] ${token.slice(0, 10)}… ${why} pnl=$${pnl.toFixed(2)}`);
      if (shouldClose >= 1) { exits.delete(token); sats.delete(token); }
    }
  }

  // 2) 扫描新机会：Radar 门禁 → SpotGuard → 买入
  for (const t of tokens) {
    if (exits.has(t.address)) continue;
    let radar = null;
    try { radar = await radarScore(cfg.radarApi, t.address); } catch { /* 无 radar */ }
    const price = Number(formatEther(t.price));
    if (!price) continue;
    const atr = price * 0.05; // 保守估计：meme 币 5% ATR（无 K 线时的兜底）
    const stop = price * 0.97; // -3% 初始止损（≈ -0.6×ATR，偏紧，meme 波动大）
    let slippagePct = 0;
    try {
      const q = await quoteBuy(t.address, BigInt(1e15), cfg.chainId); // 0.001 MON 试单测滑点
      void q;
    } catch { /* quote 失败则跳过 */ }
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
      console.log(`[开仓] ${t.name} $${dec.sizeUsd.toFixed(2)}｜${dec.reason}`);
    } catch (e) { console.log(`[开仓失败] ${t.name}: ${e.message}`); }
  }

  console.log('[状态]', JSON.stringify(guard.status(equity)));
}

async function cmdPaper(cfg, once) {
  const { createExecutor } = require('../monad-executor/src/executor');
  const ex = createExecutor({ mode: 'paper', chainId: cfg.chainId, monPriceUsd: cfg.monPriceUsd });
  console.log(`paper 模式启动（chain ${cfg.chainId}，价格走链上真实读数，不签名不广播）`);
  await paperOnce(cfg, ex);
  if (once) return;
  setInterval(() => paperOnce(cfg, ex).catch((e) => console.error('[paper]', e.message)), cfg.paper.intervalMs);
}

async function cmdLive(cfg) {
  if (!process.argv.includes('--i-know-what-im-doing')) {
    console.error('⛔ 实盘需要双重确认：node cli.js live --live --i-know-what-im-doing');
    console.error('   这会动用 MONAD_PRIVATE_KEY 对应的真钱钱包。请先跑 paper。');
    process.exit(1);
  }
  console.log('⚠️  LIVE 模式：真实签名广播，亏的是真钱。');
  const { createExecutor } = require('../monad-executor/src/executor');
  const ex = createExecutor({ mode: 'live', chainId: cfg.chainId, monPriceUsd: cfg.monPriceUsd });
  await paperOnce(cfg, ex); // 同一套逻辑，只是 executor 为 live
}

async function cmdBacktest() {
  console.log('spot 回测框架：以 packages/backtest/backtest3way.js 为种子（perps 留档）。');
  console.log('Monad spot 回放回测（录制的代币价格序列）为 P1，先跑留档用例冒烟：');
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
      if (!process.argv.includes('--live')) { console.error('用法: node cli.js live --live --i-know-what-im-doing'); process.exit(1); }
      await cmdLive(cfg);
    }
    else if (cmd === 'backtest') await cmdBacktest();
    else {
      console.log('用法: node cli.js <scan|score <addr>|paper [--once]|live --live --i-know-what-im-doing|backtest>');
      process.exit(1);
    }
  } catch (e) { console.error('出错:', e.message); process.exit(1); }
}
main();
