'use strict';
/**
 * fly-reward/learningFly.js —— 会"长记性"的 mock 果蝇
 *
 * 生物学映射：
 *   12 条"决策通路" = 12 个市场状态（zalien 分数桶 6 × 波动率 2）
 *   每条通路有权重 trust ∈ [0,1]："这条路走过、吃到过糖吗？"
 *   平仓后用 reward.js 算多巴胺 → 可塑性规则更新走过的那条通路
 *   trust < 0.5 的通路被抑制（果蝇"不想走这条路"→ 输出 flat = 弃权）
 *
 * 注意：这是 mock。真实果蝇（aster.py）的 16 万神经元换成 12 条通路做演示，
 * 学习机制（多巴胺→可塑性）是同一套公式。
 */

const { FlyReward } = require('./reward');

const N_STATES = 12;
const VOL_HIGH = 0.0055; // atrPct 高于此为高波动

/**
 * 市场状态索引：0~11
 * 分数桶: 0:>60 1:40~60 2:15~40 3:-15~15 4:-40~-15 5:<-40
 * vol: 0=低波动 1=高波动 → idx = bucket*2 + vol
 */
function stateIndex(score, atrPct) {
  let b;
  if (score > 60) b = 0;
  else if (score > 40) b = 1;
  else if (score > 15) b = 2;
  else if (score >= -15) b = 3;
  else if (score >= -40) b = 4;
  else b = 5;
  const v = atrPct > VOL_HIGH ? 1 : 0;
  return b * 2 + v;
}

function stateName(idx) {
  const buckets = ['强多>60', '多40~60', '弱多15~40', '中性', '弱空-40~-15', '强空<-40'];
  const b = Math.floor(idx / 2), v = idx % 2;
  return `${buckets[b]}×${v ? '高波' : '低波'}`;
}

class LearningFly {
  /**
   * @param {object} opts
   * @param {number} opts.lr         学习率（平仓更新用）
   * @param {number} opts.tickRatio 持仓中 tick 反馈相对权重（文档：1/10）
   * @param {number} opts.initTrust 初始信任（0.5=中性，略高一点让它敢先试）
   */
  constructor({ lr = 0.06, tickRatio = 0.1, initTrust = 0.55 } = {}) {
    this.lr = lr;
    this.tickRatio = tickRatio;
    this.trust = new Array(N_STATES).fill(initTrust);
    this.reward = new FlyReward();
    this.updates = 0;      // 平仓更新次数
    this.tickUpdates = 0;  // 持仓 tick 更新次数
    this.abstentions = 0;  // 被抑制（弃权）次数
  }

  /**
   * 决策：raw 是神经原始输出 { direction, strength }
   * trust ≥ 0.5 → 放行（强度按信任缩放）；trust < 0.5 → 抑制为 flat（弃权）
   */
  signal(stateIdx, raw) {
    const t = this.trust[stateIdx];
    if (!raw || raw.direction === 'flat' || t < 0.5) {
      if (t < 0.5 && raw && raw.direction !== 'flat') this.abstentions++;
      return { direction: 'flat', strength: 0, trust: t, state: stateIdx, source: 'learning-fly' };
    }
    const strength = Math.min(1, raw.strength * (0.4 + 2.4 * (t - 0.5)));
    return { direction: raw.direction, strength, trust: t, state: stateIdx, source: 'learning-fly' };
  }

  /**
   * 平仓反馈：这条通路用过 → 按多巴胺更新
   * @returns {object|null} { dopamine, dw, trust }
   */
  feedback(stateIdx, usedDirection, pnlPct, atrPct, holdingHours) {
    if (usedDirection === 'flat') return null; // 通路没用过，不更新
    const dopamine = this.reward.tradeFeedback(pnlPct, atrPct, holdingHours);
    const dw = FlyReward.plasticity(1, 1, dopamine, this.lr);
    this.trust[stateIdx] = Math.min(0.95, Math.max(0.05, this.trust[stateIdx] + dw));
    this.updates++;
    return { dopamine, dw, trust: this.trust[stateIdx] };
  }

  /**
   * 持仓中的弱反馈（"气味渐浓"）：每 tick 调一次，权重只有平仓的 tickRatio。
   * 用未实现盈亏给一个轻推，让学习样本更密。
   */
  tickUpdate(stateIdx, usedDirection, unrealizedPct, atrPct) {
    if (usedDirection === 'flat') return null;
    const d = this.reward.tickFeedback(unrealizedPct, atrPct);
    const dw = FlyReward.plasticity(1, 1, d, this.lr * this.tickRatio);
    this.trust[stateIdx] = Math.min(0.95, Math.max(0.05, this.trust[stateIdx] + dw));
    this.tickUpdates++;
    return { dopamine: d, dw };
  }

  /** 信任表（给回测报告用） */
  trustTable() {
    return this.trust.map((t, i) => ({ state: stateName(i), trust: +t.toFixed(3) }));
  }
}

module.exports = { LearningFly, stateIndex, stateName, N_STATES };
