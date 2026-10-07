# monad小精灵 · Monad-Native AI Trading System

> 开源 AI 自动交易系统，Monad 原生执行。
> 信号（果蝇脑 + 量化引擎）→ 风控（现货模型）→ 执行（Monad bonding curve 代币），
> 全链路可在 Monad testnet 上真实跑通。默认 paper 模式，不动真钱。

**Monad Metropolis 黑客松提交作品** · 赛道：On-chain Finance & Trading · PolyForm-Noncommercial 1.0.0（source-available，非商用）

## 一句话

monad小精灵是一个开箱即用的 AI 交易机器人：在 Monad 上自动发现新发射的 meme 币，
用 AI 风险评分过滤 rug，用量化 + 果蝇脑双信号决策，用现货风控模型管理仓位，
在 bonding curve 上自动买卖。策略有效性可用 paper 模式验证，再决定是否实盘。

## 快速开始

```bash
# 1. 执行层依赖
cd packages/monad-executor && npm install && cd ../..

# 2. 扫描链上代币（只读）
node packages/cli/cli.js scan

# 3. 纸交易跑一轮（不签名不广播，价格走链上真实读数）
node packages/cli/cli.js paper --once

# 4. 纸交易循环
node packages/cli/cli.js paper
```

实盘（⚠️ 动真钱，需双重确认）：
```bash
export MONAD_PRIVATE_KEY=...   # 只在本地 export，绝不进仓库
node packages/cli/cli.js live --live --i-know-what-im-doing
```

Rug Radar 评分服务（可选，不跑则跳过评分门禁）：
```bash
cd packages/radar && npm install && npm run build && npm start
# 然后 export RADAR_API=http://localhost:3001
```

合约（Foundry）：
```bash
cd contracts && forge test   # 9 个测试
```

## 架构

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；
风控模型见 [docs/RISK-MODEL.md](docs/RISK-MODEL.md)；
果蝇信号源接入见 [docs/FLY-BRAIN.md](docs/FLY-BRAIN.md)。

## Monad 集成说明

- **执行链**：Monad testnet（chain 10143，`https://testnet-rpc.monad.xyz`），viem 直连
- **已部署合约**：MemeLauncher `0x8ca1990c872b9f28f0dedc2ac9024dd6d1d2457f`
  （交易哈希 `0xb08aadb731f23c5d2f6b6e45e97d694d37e6ae2f4caca425824b0c0677ea8679`）
- **交易标的**：Launcher 发行的 bonding curve meme 代币（`buy`/`sell`/`quoteBuy`/`quoteSell`/`getPrice` 全链上）
- **价格真实性**：paper 模式也读链上 `getPrice()`，不 mock 行情
- **主网**：chain 143 开关已预留（`packages/monad-executor/src/chain.js`），本次提交用测试网

## 合规声明（Monad Metropolis 规则 4.1 / 4.3）

### Pre-existing 组件（作者自研，赛前已存在，README 标识）
- `apps/0x4-web/`：0x4 多链自托管交易钱包前端（钱包/行情/闪兑/社交 UI）——
  作者 2026 年 9 月起自研。本次提交为**比赛分支快照**，与线上产品隔离；
  敏感配置已脱敏：无硬编码密钥，配置全部走 `VITE_*` 环境变量（模板见 `apps/0x4-web/.env.example`，仅占位符）
- `packages/engine/signals/`：zalien 量化信号引擎（`analyze.js` 多因子打分、
  `screener.js`、`picks.js`、`sectors.js`、`economy.js`、`memory.js`、`crypto.js`）——
  作者 2026 年 9~10 月自研，纯公开数据源，零密钥，可选的 6551 消息面已降级为 stub
- 果蝇脑**概念**借鉴公开研究：Google MaleCNS v1.0、Coinbase Stonkfly（见 docs/FLY-BRAIN.md）；
  真实 `aster.py` 为作者私有代码，**不在本仓库**，仓库内仅含 `SignalProvider` 接口 + mock

### 赛期内新增（2026-10-07 ~ 2026-10-14，本次提交的主体）
- `apps/0x4-web/` 内 Monad 集成（赛期新增代码）：
  `src/lib/chains.ts` 的 Monad testnet（10143）链配置、
  `src/lib/monadLauncher.ts` 合约交互层、
  `src/pages/Launch.tsx` 一键发币页、
  `src/pages/MonadToken.tsx` bonding curve 代币详情页（链上价格+合约买卖）
- `contracts/`：MemeLauncher / MemeToken 合约、测试、部署脚本 + 测试网部署
- `packages/radar/`：Rug Radar AI 风险评分服务（5 类信号）
- `packages/monad-executor/`：viem 执行层（paper/live 双模式、滑点保护）
- `packages/engine/risk/`：现货风控模型（SpotGuard 七项检查、RISK-MODEL.md）
- `packages/engine/fusion/`：双脑融合决策器、经典理论模块（量价/威科夫/缠论简化）
- `packages/engine/risk/flyReward.js`：多巴胺奖赏 + 兴奋止盈（SatiationTP）
- `packages/cli/`：统一命令行（scan/score/paper/live/backtest）
- `apps/demo-ui/`：一键发币/交易/评分前端

### AI 工具使用披露（规则 4.1 要求）
本仓库部分代码在 AI 编程助手协助下编写，架构、策略逻辑与风控规则由作者设计，
所有提交前经作者审查。AI 生成内容不改变"作者原创作品"属性（规则 4.3）。

### 许可证
PolyForm-Noncommercial 1.0.0（source-available：代码公开可读、可学习、可用于非商业目的；
**不可用于商业用途**，不可商用分发。详见 LICENSE。）

## 风险提示

- 本系统是交易**工具**，不是投资建议。**不承诺盈利、不承诺不亏损。**
- paper 模式为默认；live 模式需要显式双重确认，亏损为真钱亏损。
- meme 币波动极大，Radar 评分不能保证识别所有 rug。
- 能保证的是：单笔 1% 风险上限、单币 20% 上限、单日 3% 熔断、$500 停火线——亏有上限。

## 仓库结构

```
monad-sprite/
├── contracts/                 # Foundry：MemeLauncher + MemeToken
├── packages/
│   ├── engine/
│   │   ├── signals/           # zalien 量化引擎（pre-existing，作者自研）
│   │   ├── fusion/            # 双脑融合 + 经典理论（赛期）
│   │   ├── risk/              # 现货风控（赛期）；perps-legacy/ 为永续版留档
│   │   └── providers/         # SignalProvider 接口 + mock（赛期）
│   ├── monad-executor/        # viem 执行层 paper/live（赛期）
│   ├── radar/                 # Rug Radar 评分服务（赛期）
│   ├── backtest/              # 回测
│   └── cli/                   # 统一 CLI（赛期）
├── apps/
│   ├── 0x4-web/               # 0x4 钱包前端（pre-existing，作者自研；Monad 集成部分为赛期新增）
│   └── demo-ui/               # Next.js 前端（赛期）
└── docs/                      # RISK-MODEL / ARCHITECTURE / FLY-BRAIN
```
