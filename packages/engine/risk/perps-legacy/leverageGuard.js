'use strict';
/** leverageGuard —— 永续合约杠杆铁律（现货系统不用，移入 legacy 留作参考） */

/**
 * leverageGuard —— 杠杆铁律（50x 专用保命检查）
 *
 * 数学事实：
 *  - 爆仓距离 ≈ 1/杠杆（50x → 价格反向 2% 就没了）
 *  - 止损距离 × 杠杆 × 仓位占比 = 这笔最多亏多少本金
 *
 * @param {number} leverage    杠杆倍数，如 50
 * @param {number} stopDistPct 价格止损距离，如 0.01 = 1%
 * @param {number} maxRiskPct  单笔最多亏本金的比例，默认 1%
 * @returns {{allowed:boolean, reason:string, maxSizePct:number, liqDistPct:number}}
 */
function leverageGuard(leverage, stopDistPct, maxRiskPct = 0.01) {
  const liqDistPct = 1 / leverage;
  // 铁律1：止损必须明显早于爆仓线（< 80% 爆仓距离），否则极端行情下止损来不及
  if (stopDistPct >= liqDistPct * 0.8) {
    return {
      allowed: false,
      reason: `止损 ${(stopDistPct * 100).toFixed(2)}% 距爆仓线 ${(liqDistPct * 100).toFixed(2)}% 太近，极端行情下可能先爆仓`,
      warning: null, maxSizePct: 0, liqDistPct,
    };
  }
  // 铁律2：仓位上限 = 单笔风险 / (杠杆 × 止损距离) —— 50x 下这个数会非常小
  const maxSizePct = maxRiskPct / (leverage * stopDistPct);
  const warning = stopDistPct >= liqDistPct * 0.5
    ? `止损已用掉爆仓距离一半以上，滑点会放大实际亏损`
    : null;
  return {
    allowed: true,
    reason: `${leverage}x：单笔风险 ${maxRiskPct * 100}%，仓位不得超过本金 ${(maxSizePct * 100).toFixed(2)}%`,
    warning, maxSizePct, liqDistPct,
  };
}

module.exports = { leverageGuard };
