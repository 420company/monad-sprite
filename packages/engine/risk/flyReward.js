'use strict';
/**
 * fly-reward/reward.js — JS port of reward.py (formulas kept identical)
 *
 * The Python original is untouched (it's for the user's live aster.py).
 * This copy serves the Node test harness / fusion system.
 *
 * Biology mapping:
 *   Foraging success → dopamine neuron (DAN) firing → mushroom-body synapses strengthen → repeat next time
 *   Trading profit  → dopamine > 0.5 → decision pathway strengthens
 *   Trading loss    → dopamine < 0.5 → decision pathway weakens
 *
 * Author note: no profit promised. This makes the fly "able to learn", not guaranteed to "learn real patterns".
 */

class FlyReward {
  constructor(baselineWindow = 20, steepness = 3.0) {
    // baseline: average risk-adjusted return of last N trades — only beating expectations counts as reward
    // Prevents the fly getting hooked on "random profits" (e.g. everything wins in a bull market)
    this.baselineWindow = baselineWindow;
    this.steepness = steepness;
    this._history = []; // per-trade risk-adjusted return r
  }

  /**
   * Called once per closed trade
   * @param {number} pnlPct       Realized P&L, e.g. 0.023 = +2.3%
   * @param {number} atrPct       Market ATR% (volatility) at the time, e.g. 0.015
   * @param {number} holdingHours Holding time in hours
   * @returns {number} dopamine in (0,1): >0.5 pleasure, <0.5 pain, =0.5 neutral
   */
  tradeFeedback(pnlPct, atrPct, holdingHours = 1.0) {
    atrPct = Math.max(atrPct, 1e-4);

    // 1) Risk adjustment: +2% in a 1% ATR market deserves more reward than +2% in a 5% ATR market
    const r = pnlPct / atrPct; // "how many ATRs earned"

    // 2) Time decay: +2% in 1 hour > +2% over 4 days (capital efficiency)
    const timeFactor = 1.0 / Math.sqrt(Math.max(holdingHours, 0.25));

    // 3) Beat expectations: subtract the baseline — only outperforming your own average counts as pleasure
    const hist = this._history.slice(-this.baselineWindow);
    const baseline = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
    const edge = r * timeFactor - baseline;

    const dopamine = 1.0 / (1.0 + Math.exp(-this.steepness * edge));

    this._history.push(r * timeFactor);
    if (this._history.length > 200) this._history.shift();
    return dopamine;
  }

  /**
   * Continuous weak signal while holding ("scent getting stronger"), weighted 1/10 of close signals.
   * Keeps the fly feeling something while holding.
   */
  tickFeedback(unrealizedPct, atrPct) {
    atrPct = Math.max(atrPct, 1e-4);
    const r = unrealizedPct / atrPct;
    return 0.5 + 0.05 * Math.tanh(r); // gentle nudge within 0.45–0.55
  }

  /**
   * Plasticity rule: replaces the old reward-free Δw
   * @param {number} pre      Presynaptic neuron activation at decision time (0-1)
   * @param {number} post     Postsynaptic neuron activation at decision time (0-1)
   * @param {number} dopamine Reward signal computed above
   * @param {number} lr       Learning rate
   * Old (maybe): w += lr * pre * post            (no reward, blind strengthening)
   * Now:         w += lr * (dopamine - 0.5) * 2 * pre * post
   *             pleasure→strengthen, pain→weaken, neutral→unchanged
   */
  static plasticity(pre, post, dopamine, lr = 0.01) {
    return lr * (dopamine - 0.5) * 2.0 * pre * post;
  }
}

/**
 * SatiationTP — the "excitement→exit" circuit (satiety take-profit)
 *
 * Problem solved: dopamine excitement only fed the learning circuit — a holding fly got more excited as price rose but never sold.
 * Biology mapping: animals stop eating when full — diminishing marginal utility; when satiation fills up, "bank it".
 *
 * Two trigger paths:
 *  Fast path: single-tick excitement ≥ 0.8 (position up ~+25%) → take profit on half immediately
 *  Slow path: accumulated satiation reaches 5.0 (slow-burn profits fill it too) → take profit on half, satiation resets to 1.0
 */
class SatiationTP {
  constructor({ excitementScale = 0.25, fastThreshold = 0.8, slowThreshold = 5.0 } = {}) {
    this.excitementScale = excitementScale; // position P&L that counts as "very excited", default 25%
    this.fastThreshold = fastThreshold;
    this.slowThreshold = slowThreshold;
    this.satisfaction = 0;
  }

  /** Excitement: based on position P&L (what the fly actually feels), 0–1 */
  excitement(positionPnlPct) {
    return Math.tanh(Math.max(positionPnlPct, 0) / this.excitementScale);
  }

  /**
   * Called every tick
   * @param {number} positionPnlPct Current unrealized position P&L, e.g. 0.30 = +30%
   * @returns {{excitement:number, satisfaction:number, trigger:boolean, path:string|null}}
   */
  update(positionPnlPct) {
    const e = this.excitement(positionPnlPct);
    if (positionPnlPct > 0) this.satisfaction += e; // only accumulate excitement from profits; losses don't bank "satisfaction"
    else this.satisfaction = Math.max(0, this.satisfaction - 0.5); // cool down when losing

    if (e >= this.fastThreshold) {
      this.satisfaction = 1.0;
      return { excitement: e, satisfaction: this.satisfaction, trigger: true, path: 'fast' };
    }
    if (this.satisfaction >= this.slowThreshold) {
      this.satisfaction = 1.0;
      return { excitement: e, satisfaction: this.satisfaction, trigger: true, path: 'slow' };
    }
    return { excitement: e, satisfaction: this.satisfaction, trigger: false, path: null };
  }

  reset() { this.satisfaction = 0; }
}



module.exports = { FlyReward, SatiationTP };

// ---------- self-check: node fly-reward/reward.js ----------
if (require.main === module) {
  const fr = new FlyReward();
  const cases = [
    [0.02, 0.01, 1.0, '+2%, ATR1%, held 1H'],
    [0.02, 0.05, 1.0, '+2%, ATR5%, held 1H'],
    [-0.02, 0.01, 0.5, '-2%, ATR1%, held 0.5H'],
    [0.03, 0.01, 96.0, '+3%, held 4d'],
    [0.005, 0.01, 1.0, '+0.5%, ATR1%'],
  ];
  for (const [pnl, atr, hh, label] of cases) {
    console.log(`${label.padEnd(24)} → dopamine = ${fr.tradeFeedback(pnl, atr, hh).toFixed(3)}`);
  }
}
