# monad小精灵 · 架构

```
┌─────────────────────────────────────────────────────────────┐
│                        apps/demo-ui                          │
│              Next.js 前端：一键发币 / 交易 / 评分展示          │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼──────────────────────────────────┐
│                      packages/cli                            │
│            scan / score / paper / live / backtest             │
└──┬──────────────┬───────────────┬──────────────┬─────────────┘
   │              │               │              │
   ▼              ▼               ▼              ▼
┌───────┐  ┌─────────────┐  ┌──────────┐  ┌──────────────┐
│engine │  │monad-       │  │ radar    │  │ backtest     │
│signals│  │executor     │  │ (评分服务) │  │              │
│fusion │  │paper/live   │  │          │  │              │
│risk   │  │viem→10143   │  │          │  │              │
│providers│ │             │  │          │  │              │
└───────┘  └──────┬──────┘  └──────────┘  └──────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ contracts/ (Foundry)                     │
│ MemeLauncher 0x8ca1…457f (testnet 已部署) │
│ MemeToken (bonding curve)                │
└─────────────────────────────────────────┘
```

## 数据流（paper/live 一轮）

1. **scan**：`monad-executor` 从链上读全部 Launcher 代币（`getAllTokens`，真实价格）
2. **score**：`radar` 服务给每个代币打分（5 类信号）；无 radar 时降级跳过门禁
3. **signal**：`engine/signals`（zalien 量化引擎）+ `providers`（果蝇脑）→ `fusion` 融合决策
4. **risk**：`SpotGuard.requestOpen` 七项检查（停火线/DayGuard/Radar门禁/单币上限/
   创建者上限/滑点预检/预算）→ 批仓位
5. **execute**：paper 记账 / live 签名广播 `buy()`；退出由 `exit.js`（ATR）+
   `SatiationTP`（兴奋止盈）+ Radar 跌破强制离场三路管理
6. **learn**：平仓后 `FlyReward.tradeFeedback` → 多巴胺 → 影响下次信号权重（不代替退出）

## 目录说明

| 目录 | 来源 | 说明 |
|---|---|---|
| `contracts/` | 赛期新建（2026-10-07） | Foundry 合约 + 9 个测试 |
| `packages/radar/` | 赛期新建（2026-10-07） | Node+TS 评分服务 |
| `apps/demo-ui/` | 赛期新建（2026-10-07） | Next.js 前端 |
| `packages/monad-executor/` | 赛期新建（2026-10-07） | viem 执行层，paper/live |
| `packages/cli/` | 赛期新建（2026-10-07） | 统一命令行 |
| `packages/engine/signals/` | 作者自研（pre-existing，见 README） | zalien 量化引擎等 |
| `packages/engine/fusion/` | 2026-10-07 新建 | 双脑融合 + 经典理论 |
| `packages/engine/risk/` | 2026-10-07 新建/改造 | 现货风控；`perps-legacy/` 为永续版留档 |
| `packages/engine/providers/` | 赛期新建 | SignalProvider 接口 + mock |
| `packages/backtest/` | 种子 2026-10-07 | 回测（perps 三向留档，spot 框架 P1） |

## 设计原则

- **paper 默认**：不签名不广播也能验证策略；live 必须双重确认
- **价格真实**：paper 用的也是链上 `getPrice()` 真实读数，不 mock 行情
- **降级不阻断**：radar/sixfive 任一缺失，系统降级运行（门禁跳过/情绪维度缺失）
- **零第三方依赖**：`engine` 纯 JS，只依赖 Node 20；只有 `monad-executor` 依赖 viem
