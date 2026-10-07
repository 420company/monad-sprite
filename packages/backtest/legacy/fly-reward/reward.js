'use strict';
/**
 * fly-reward/reward.js —— reward.py 的 JS 翻写（公式保持一致）
 *
 * Python 原文件不动（那是给用户真机 aster.py 用的）。
 * 这份给 Node 测试框架 / 融合系统调用。
 *
 * 生物学对应：
 *   觅食成功 → 多巴胺神经元(DAN)放电 → 蘑菇体突触加强 → 下次还走这条路
 *   交易盈利 → dopamine > 0.5        → 决策通路加强
 *   交易亏损 → dopamine < 0.5        → 决策通路削弱
 *
 * 作者注：不承诺盈利。这让果蝇"能学习"，不保证"学到真规律"。
 */

class FlyReward {
  constructor(baselineWindow = 20, steepness = 3.0) {
    // baseline: 最近 N 笔的平均风险调整收益，超预期才算奖赏
    // 防止果蝇对"随机盈利"上瘾（比如牛市里闭眼买都赚）
    this.baselineWindow = baselineWindow;
    this.steepness = steepness;
    this._history = []; // 存每笔的风险调整收益 r
  }

  /**
   * 每笔交易结束（平仓）时调一次
   * @param {number} pnlPct       已实现盈亏，如 0.023 = +2.3%
   * @param {number} atrPct       当时市场的 ATR%（波动率），如 0.015
   * @param {number} holdingHours 持仓小时数
   * @returns {number} dopamine ∈ (0,1)：>0.5 快感，<0.5 痛苦，=0.5 无感
   */
  tradeFeedback(pnlPct, atrPct, holdingHours = 1.0) {
    atrPct = Math.max(atrPct, 1e-4);

    // 1) 风险调整：赚 2% 在 ATR 1% 的市场里，比在 ATR 5% 的市场里更值得奖励
    const r = pnlPct / atrPct; // "赚了几个 ATR"

    // 2) 时间衰减：1 小时赚 2% > 拿 4 天赚 2%（资金效率）
    const timeFactor = 1.0 / Math.sqrt(Math.max(holdingHours, 0.25));

    // 3) 超预期：减去基线，只有跑赢自己过去平均水平才算快感
    const hist = this._history.slice(-this.baselineWindow);
    const baseline = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
    const edge = r * timeFactor - baseline;

    const dopamine = 1.0 / (1.0 + Math.exp(-this.steepness * edge));

    this._history.push(r * timeFactor);
    if (this._history.length > 200) this._history.shift();
    return dopamine;
  }

  /**
   * 持仓中的连续弱信号（"气味渐浓"），权重只有平仓信号的 1/10。
   * 别让果蝇持仓时完全没感觉。
   */
  tickFeedback(unrealizedPct, atrPct) {
    atrPct = Math.max(atrPct, 1e-4);
    const r = unrealizedPct / atrPct;
    return 0.5 + 0.05 * Math.tanh(r); // 0.45 ~ 0.55 之间轻推
  }

  /**
   * 可塑性规则：替换原来无奖赏的 Δw
   * @param {number} pre      突触前神经元在决策时刻的激活值 (0~1)
   * @param {number} post     突触后神经元在决策时刻的激活值 (0~1)
   * @param {number} dopamine 上面算出的奖赏信号
   * @param {number} lr       学习率
   * 原来可能是: w += lr * pre * post            （无奖赏，瞎加强）
   * 现在换成:   w += lr * (dopamine - 0.5) * 2 * pre * post
   *             快感→加强，痛苦→削弱，无感→不动
   */
  static plasticity(pre, post, dopamine, lr = 0.01) {
    return lr * (dopamine - 0.5) * 2.0 * pre * post;
  }
}

/**
 * SatiationTP —— "兴奋→平仓"回路（饱足止盈）
 *
 * 解决的问题：多巴胺的兴奋只进了学习回路，持仓中的果蝇越涨越兴奋却永远不卖。
 * 生物学对应：动物吃饱了就停嘴 —— 边际效用递减，满足度满了就"落袋"。
 *
 * 两条触发路径：
 *  快路径：单 tick 兴奋度 ≥ 0.8（仓位盈利约 +25%）→ 立刻止盈一半
 *  慢路径：满足度累积满 5.0（小火慢炖的盈利也会攒满）→ 止盈一半，满足度回落到 1.0
 */
class SatiationTP {
  constructor({ excitementScale = 0.25, fastThreshold = 0.8, slowThreshold = 5.0 } = {}) {
    this.excitementScale = excitementScale; // 仓位盈利多少算"很兴奋"，默认 25%
    this.fastThreshold = fastThreshold;
    this.slowThreshold = slowThreshold;
    this.satisfaction = 0;
  }

  /** 兴奋度：基于仓位盈亏（果蝇实际感受到的），0~1 */
  excitement(positionPnlPct) {
    return Math.tanh(Math.max(positionPnlPct, 0) / this.excitementScale);
  }

  /**
   * 每个 tick 调一次
   * @param {number} positionPnlPct 仓位当前浮盈，如 0.30 = +30%
   * @returns {{excitement:number, satisfaction:number, trigger:boolean, path:string|null}}
   */
  update(positionPnlPct) {
    const e = this.excitement(positionPnlPct);
    if (positionPnlPct > 0) this.satisfaction += e; // 只累积盈利的兴奋，亏损不攒"满足"
    else this.satisfaction = Math.max(0, this.satisfaction - 0.5); // 亏钱时冷静一点

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

// ---------- 自检：node fly-reward/reward.js ----------
if (require.main === module) {
  const fr = new FlyReward();
  const cases = [
    [0.02, 0.01, 1.0, '赚2%, ATR1%, 拿1H'],
    [0.02, 0.05, 1.0, '赚2%, ATR5%, 拿1H'],
    [-0.02, 0.01, 0.5, '亏2%, ATR1%, 拿半H'],
    [0.03, 0.01, 96.0, '赚3%, 拿了4天'],
    [0.005, 0.01, 1.0, '赚0.5%, ATR1%'],
  ];
  for (const [pnl, atr, hh, label] of cases) {
    console.log(`${label.padEnd(24)} → dopamine = ${fr.tradeFeedback(pnl, atr, hh).toFixed(3)}`);
  }
}
