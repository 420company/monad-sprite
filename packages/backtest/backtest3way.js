'use strict';
/**
 * test/backtest3way.js — three-way backtest: does dopamine reward learning actually help?
 *
 * Same 320-tick synthetic price series (trend + chop + fake breakouts), three strategies head-to-head:
 *   (a) pure zalien signals + exit engine
 *   (b) non-learning fly mock + zalien fusion + exit engine
 *   (c) dopamine-reward-learning fly + zalien fusion + exit engine
 *
 * Metrics: total P&L, win rate, max drawdown, trade count.
 *
 * ★ Honesty notice (must read):
 *   The fly mock's "raw neural signal" is sampled from the true direction of the next 6 ticks at a set accuracy
 *   (65% in trends, 45% in chop, 40% in fake-breakout traps) — simulating
 *   "a neural net with some, regime-dependent predictive power".
 *   What this backtest validates: whether dopamine learning can discover "in which regimes to trust the fly" —
 *   it does NOT prove the real fly can predict markets.
 */

const { checkExit, applyExit } = require('./legacy/exitEngine');
const { fuse } = require('./legacy/fusion');
const { LearningFly, stateIndex } = require('./legacy/fly-reward/learningFly');

// ---------- deterministic PRNG (reproducible results) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- data generation ----------
const SEED = Number(process.env.BT_SEED) || 20261007;
const CYCLE = 320;              // one market cycle (trend + chop + fake breakouts)
const REPEATS = 3;              // repeat 3 cycles — enough samples for the learner
const N = CYCLE * REPEATS;
const TICK_HOURS = 0.25; // each tick = 15 minutes
const REGIMES = [
  { from: 0, to: 59, drift: 0.0012, vol: 0.004, flyAcc: 0.65, name: '趋势上' },
  { from: 60, to: 119, drift: 0.0, vol: 0.006, flyAcc: 0.45, name: '震荡' },
  { from: 120, to: 139, drift: 0.0022, vol: 0.005, flyAcc: 0.55, name: '假突破上' },
  { from: 140, to: 159, drift: -0.0028, vol: 0.005, flyAcc: 0.40, name: '假突破反杀' },
  { from: 160, to: 219, drift: -0.0012, vol: 0.004, flyAcc: 0.65, name: '趋势下' },
  { from: 220, to: 259, drift: 0.0, vol: 0.007, flyAcc: 0.45, name: '震荡2' },
  { from: 260, to: 319, drift: 0.0010, vol: 0.004, flyAcc: 0.65, name: '趋势上2' },
];
const regimeOf = (i) => REGIMES.find((r) => (i % CYCLE) >= r.from && (i % CYCLE) <= r.to);

function genMarket() {
  const rng = mulberry32(SEED);
  const prices = [100];
  for (let i = 1; i < N; i++) {
    const rg = regimeOf(i);
    prices.push(prices[i - 1] * (1 + rg.drift + rg.vol * gauss(rng)));
  }
  const rets = prices.map((p, i) => (i === 0 ? 0 : (p - prices[i - 1]) / prices[i - 1]));

  // ATR%: mean |r| over last 14 ticks
  const atrPct = rets.map((_, i) => {
    const w = rets.slice(Math.max(0, i - 13), i + 1);
    return w.reduce((a, r) => a + Math.abs(r), 0) / w.length;
  });
  // Rolling volatility: 24-tick stddev (for zalien score normalization)
  const rollVol = rets.map((_, i) => {
    const w = rets.slice(Math.max(0, i - 23), i + 1);
    const m = w.reduce((a, r) => a + r, 0) / w.length;
    return Math.sqrt(w.reduce((a, r) => a + (r - m) * (r - m), 0) / w.length) || 1e-6;
  });
  // zalien direction score: 24-tick momentum / volatility-normalized + noise (accurate in trends, whipsawed in chop)
  const scores = rets.map((_, i) => {
    const w = rets.slice(Math.max(0, i - 23), i + 1);
    const mom = w.reduce((a, r) => a + r, 0);
    const raw = (55 * mom) / (rollVol[i] * Math.sqrt(24)) + gauss(rng) * 10;
    return Math.max(-100, Math.min(100, Math.round(raw)));
  });
  // Fly raw neural signal: true direction of next 6 ticks, sampled at the regime's accuracy
  const flyRaws = rets.map((_, i) => {
    if (i > N - 8) return { direction: 'flat', strength: 0 };
    const fut = rets.slice(i + 1, i + 7).reduce((a, r) => a + r, 0);
    const trueDir = fut > 0.0005 ? 'long' : fut < -0.0005 ? 'short' : 'flat';
    if (trueDir === 'flat') return { direction: 'flat', strength: 0 };
    const rg = regimeOf(i);
    const correct = rng() < rg.flyAcc;
    return {
      direction: correct ? trueDir : (trueDir === 'long' ? 'short' : 'long'),
      strength: 0.5 + rng() * 0.5,
    };
  });
  return { prices, rets, atrPct, scores, flyRaws };
}

const confidenceOf = (s) => (Math.abs(s) >= 70 ? '高' : Math.abs(s) >= 50 ? '中' : '低');

// (a) Pure zalien decision: |score|>40 opens (aligned with fuse's strength threshold)
function zalienDecision(z, price) {
  const side = z.score > 40 ? 'long' : z.score < -40 ? 'short' : null;
  if (!side) return { action: 'skip' };
  const dir = side === 'long' ? 1 : -1;
  return {
    action: 'open', side, entryPrice: price,
    stopLoss: price * (1 - dir * 0.02),
    takeProfit1: price * (1 + dir * 0.02),
    takeProfit2: price * (1 + dir * 0.04),
    trailAtr: 1.5 * z.atr,
  };
}

const START_EQUITY = 10000;
const NOTIONAL = 1000; // fixed notional per trade (same for all 3 strategies, keeps it comparable)

function runBacktest(strategy, mkt) {
  const { prices, atrPct, scores, flyRaws } = mkt;
  const fly = strategy === 'learning' ? new LearningFly({ lr: 0.06 }) : null;
  let equity = START_EQUITY;
  const curve = [];
  let pos = null; // { st, entryIdx, flyDir, flyState }
  let cooldown = 0;
  const trades = [];

  const unrealized = (p, price) => {
    const dir = p.side === 'long' ? 1 : -1;
    return pos.st.remainingUsd * (((price - p.entryPrice) / p.entryPrice) * dir);
  };

  for (let i = 24; i < N; i++) {
    const price = prices[i];
    const atr = atrPct[i];
    const atrAbs = atr * price;
    const score = scores[i];
    const nowMs = i * TICK_HOURS * 3600 * 1000;

    if (pos) {
      const p = pos.st.position;
      const action = checkExit(p, price, nowMs);
      applyExit(pos.st, action, price);
      const upnl = ((price - p.entryPrice) / p.entryPrice) * (p.side === 'long' ? 1 : -1);
      // Weak in-position feedback (learning only)
      if (fly && pos.flyDir !== 'flat') fly.tickUpdate(pos.flyState, pos.flyDir, upnl, atr);
      if (!pos.st.position) {
        const pnl = pos.st.realizedUsd;
        const holdingH = (i - pos.entryIdx) * TICK_HOURS;
        trades.push({ side: p.side, pnl, holdingH, flyDir: pos.flyDir, flyState: pos.flyState });
        equity += pnl;
        if (fly) fly.feedback(pos.flyState, pos.flyDir, pnl / NOTIONAL, atr, holdingH);
        pos = null;
        cooldown = 2;
      }
      curve.push(equity + (pos ? unrealized(pos.st.position, price) : 0));
    } else {
      if (cooldown > 0) cooldown--;
      else {
        const z = { symbol: 'MEME', score, confidence: confidenceOf(score), atr: atrAbs, price };
        let decision, flyDir = 'flat', flyState = -1;
        if (strategy === 'zalien') {
          decision = zalienDecision(z, price);
        } else {
          const raw = flyRaws[i];
          const st = stateIndex(score, atr);
          let flySig;
          if (strategy === 'learning') {
            flySig = fly.signal(st, raw);
          } else {
            flySig = { direction: raw.direction, strength: raw.strength, source: 'static-fly' };
          }
          flyDir = flySig.direction; flyState = st;
          decision = fuse(flySig, z, price);
        }
        if (decision.action === 'open') {
          pos = {
            st: {
              remainingUsd: NOTIONAL, realizedUsd: 0,
              position: {
                id: `bt-${strategy}-${i}`, symbol: 'MEME', side: decision.side,
                entryPrice: price, amountUsd: NOTIONAL,
                stopLoss: decision.stopLoss, tp1: decision.takeProfit1, tp2: decision.takeProfit2,
                tp1Done: false, trailAtr: decision.trailAtr, openedAt: nowMs,
              },
            },
            entryIdx: i, flyDir, flyState,
          };
        }
      }
      curve.push(equity);
    }
  }
  // Wind-down: force-close any open positions
  if (pos) {
    const p = pos.st.position;
    applyExit(pos.st, { type: 'stop_out', reason: '回测结束强制平仓' }, prices[N - 1]);
    const pnl = pos.st.realizedUsd;
    trades.push({ side: p.side, pnl, holdingH: (N - 1 - pos.entryIdx) * TICK_HOURS, flyDir: pos.flyDir, flyState: pos.flyState, forced: true });
    equity += pnl;
    if (fly) fly.feedback(pos.flyState, pos.flyDir, pnl / NOTIONAL, atrPct[N - 1], 1);
    pos = null;
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  let peak = -Infinity, maxDD = 0;
  for (const e of curve) { peak = Math.max(peak, e); maxDD = Math.max(maxDD, peak - e); }

  return {
    strategy,
    trades: trades.length,
    wins: wins.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    totalPnl: trades.reduce((a, t) => a + t.pnl, 0),
    avgWin: wins.length ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((a, t) => a + t.pnl, 0) / losses.length : 0,
    maxDD,
    finalEquity: equity,
    fly: fly ? {
      updates: fly.updates, tickUpdates: fly.tickUpdates, abstentions: fly.abstentions,
      trust: fly.trustTable(),
    } : null,
  };
}

// ---------- run ----------
const mkt = genMarket();
const results = ['zalien', 'static', 'learning'].map((s) => runBacktest(s, mkt));

const fmt = (x, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);
console.log(`=== 三向对比回测 ===  seed=${SEED}, 960 ticks(15min, 3个市场周期), 起始 $10000, 每笔 $1000 固定 ===\n`);
console.log('策略      笔数  胜率    总盈亏($)   收益率   平均盈利  平均亏损  最大回撤($)');
for (const r of results) {
  const name = r.strategy === 'zalien' ? '(a)纯zalien ' : r.strategy === 'static' ? '(b)静态果蝇 ' : '(c)学习果蝇 ';
  console.log(
    `${name}  ${String(r.trades).padStart(4)}  ${(r.winRate * 100).toFixed(1).padStart(5)}%  ` +
    `${fmt(r.totalPnl, 2).padStart(10)}  ${fmt((r.totalPnl / START_EQUITY) * 100, 2).padStart(6)}%  ` +
    `${fmt(r.avgWin, 2).padStart(8)}  ${fmt(r.avgLoss, 2).padStart(8)}  ${r.maxDD.toFixed(2).padStart(10)}`
  );
}

const lc = results.find((r) => r.strategy === 'learning').fly;
if (lc) {
  console.log(`\n--- (c) 学习果蝇：平仓更新 ${lc.updates} 次，tick 弱更新 ${lc.tickUpdates} 次，弃权 ${lc.abstentions} 次 ---`);
  console.log('状态               信任度');
  for (const row of lc.trust) console.log(`  ${row.state.padEnd(16)} ${row.trust.toFixed(3)}`);
}

// Machine-readable results for the report
if (process.argv.includes('--json')) {
  console.log('\n__JSON__' + JSON.stringify(results.map(({ fly, ...r }) => ({
    ...r, flyTrust: fly ? fly.trust : null, flyUpdates: fly?.updates, flyAbstentions: fly?.abstentions,
  }))));
}
