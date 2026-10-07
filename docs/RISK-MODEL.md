# monad小精灵 · 现货风控模型（RISK-MODEL）

> 定稿 2026-10-07。先读这篇再改代码。
>
> **关键认知转变**：2026-10-07 白天写的风控模块是为**永续合约**设计的——整套数学围着杠杆/爆仓转
> （leverageGuard、暴跌表、统一爆仓线 672、逐仓/全仓）。monad小精灵在 Monad 上做的是**现货
> bonding curve 交易**：买入 MemeLauncher 发行的代币、卖出获利。**没有杠杆，没有爆仓**，
> 价格跌到零最多亏光本金，不存在"被强平"。所以杠杆爆仓数学整段删除，换成现货真正的风险：
> **rug（跑路）、滑点（曲线吃单）、单币重仓**。

## 1. 保留（杠杆无关，本来就是对的）

| 模块 | 保留内容 | 说明 |
|---|---|---|
| 资金分区 | $1000 → $500 交易预算 + $500 储备金；净值 ≤ $500 停火 | 一字不改。储备金是停火线，不是救援金，无追加接口 |
| 单笔风险 | 每笔最多亏本金的 **1%**（`sizeForRisk`） | 止损距离倒推仓位，止损宽则仓位小 |
| ATR 退出 | `planExit`/`checkExitV2`：-1×ATR 硬止损、TP1 +1.5×ATR 平一半、TP2 +3×ATR、Chandelier 2.5×ATR 追踪、TP1 后保本移动 | 只用 `long` 方向；信号反转/4H 时间止损保留 |
| DayGuard | 单日 -3% 或连亏 3 笔 → 停手 | 一字不改 |
| 多巴胺学习 | FlyReward（风险调整+时间衰减+自适应基线）、SatiationTP（兴奋止盈） | 只影响"学什么"，不代替退出 |

## 2. 删除（永续合约专用）

- `leverageGuard`（爆仓距离 = 1/杠杆）——现货无爆仓
- 暴跌表 `crashSafeSize`、统一爆仓线 `unifiedPlan`、分批爆仓推导 `ladderPlan` 中的爆仓价部分
- 逐仓/全仓保证金讨论、`positionPlan` 的"几x必爆"表
- 这些文件移入 `packages/engine/risk/perps-legacy/`，留作回测与参考，spot 系统不引用

## 3. 新增（现货真正的风险）

### 3.1 Radar 分数门禁（防 rug 第一道）
- 开仓要求 Radar 综合评分 ≥ `minRadarScore`（默认 60/100）
- 持仓中每 N 分钟重扫：评分跌破 `dangerScore`（默认 35/100）→ 立刻市价离场，不等 ATR 止损
- 新发射代币（<30 分钟）强制要求 `freshTokenMinScore`（默认 70/100）——刚发射的最容易 rug

### 3.2 滑点保护（bonding curve 吃单）
- 下单前必调 `quoteBuy`/`quoteSell` 拿实际成交价
- `|实际价 - 预期价| / 预期价 > maxSlippagePct`（默认 3%）→ 放弃这单，不追
- 大单自动拆小：单笔买入超过 `maxSingleBuyPct`（默认 5%）的曲线深度时拆成多笔

### 3.3 单币持仓上限（防单币归零）
- 单个代币市值 ≤ 交易预算的 `maxTokenPct`（默认 20%）
- 同一创建者发行的代币合计 ≤ `maxCreatorPct`（默认 30%）——防连环 rug

### 3.4 现货仓位公式（替代杠杆铁律）
```
riskUsd    = equity × 1%                      # 单笔最多亏这么多
stopDist   = entry - stopLoss（ATR/结构位定）   # 与杠杆无关，纯技术分析
sizeUsd    = min(riskUsd / stopDistPct,        # 风险倒推
                 budget × maxTokenPct,          # 单币上限
                 budget - used)                 # 预算剩余
```
没有杠杆放大，sizeUsd 就是真金白银的现货金额。最坏情况：代币归零，亏掉 sizeUsd，
但 AccountGuard 的分区保证总净值不死。

## 4. 开仓检查清单（SpotGuard.requestOpen）

按顺序，任一不通过即拒绝：

1. **停火线**：净值 ≤ $500 → 拒绝（储备金不动）
2. **DayGuard**：今日已熔断 → 拒绝
3. **Radar 门禁**：评分 < minRadarScore → 拒绝（记录原因：分数/等级/致命信号）
4. **单币上限**：该币已持仓 + 新单 > budget×20% → 拒绝
5. **创建者上限**：该创建者代币合计 > budget×30% → 拒绝
6. **滑点预检**：quote 滑点 > 3% → 拒绝
7. **预算**：budget - used < $5 → 拒绝

通过 → 返回 `{ allowed: true, sizeUsd, stopLoss, takeProfit, reason }`

## 5. 退出（沿用 exitEngineV2，long only）

- 开仓时 `planExit({ side: 'long', entryPrice, atr, zones })`
- 每个价格 tick `checkExitV2`：硬止损 / TP1半仓 / TP2清仓 / Chandelier / 保本 / 信号反转 / 时间止损
- SatiationTP 并行跑：兴奋度 ≥0.8（约 +25%）→ 止盈一半（"兴奋必须有出口"）
- Radar 跌破 dangerScore → 最高优先级离场（插队在 ATR 止损之前）

## 6. 纸交易 vs 实盘

- 默认 **paper**：全链路跑真实逻辑（信号→风控→quote→"成交"），只是不签名不广播。`--live` 显式开启才动真钱
- paper 用的价格：链上 `getPrice()` 真实读数，不是 mock——策略有效性可信
- 实盘前置：`--live` 要求同时提供 `--i-know-what-im-doing` 确认旗（防手滑），并在启动时打印风险提示

## 7. 不承诺

不承诺盈利、不承诺不亏损。能保证的是：**单笔亏有上限（1%）、单币亏有上限（20%预算）、
单日亏有熔断（3%）、净值有停火线（$500）、rug 有 Radar 门禁**——亏得明白，死不了。
