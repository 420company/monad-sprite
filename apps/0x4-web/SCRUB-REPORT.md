# 脱敏报告（SCRUB-REPORT.md）

`apps/0x4-web/` 为 0x4-web 私库的比赛分支快照（2026-10-07 拉取，不带 git 历史）。
发布前已做全面脱敏审查。

## 审查方法

- 全仓库 grep：`sk-` / API key 形状、`[0-9]{8,10}:[A-Za-z0-9_-]{35}`（Telegram token 形状）、
  64 位 hex（私钥形状）、助记词（BIP39 词表抽查）、`bot_token` / `mnemonic` / `private_key`、
  内网 IP / localhost 端口、`.env*` 文件
- 逐项核查命中项是"硬编码真实值"还是"变量引用/占位符"

## 发现与处理

| # | 位置 | 内容 | 判定 | 处理 |
|---|---|---|---|---|
| 1 | `src/lib/autoTradeCore.ts:30` | `ROOT_AUTHORITY = '0xffff…ffff'` | 哨兵占位符，非真实私钥 | 保留（无风险） |
| 2 | `src/lib/env.ts` | `WALLETCONNECT_ID = '902842f4…'` | WalletConnect project ID，代码注释明确"公开值，不是密钥" | 保留 |
| 3 | `src/lib/env.ts` | `bngAddress = '0x6652b2…'` | BSC 链上合约地址（公开） | 保留 |
| 4 | 全仓库 | 所有 `VITE_*` 配置项 | 均为 `import.meta.env.VITE_*` 引用，**无硬编码真实值** | 新增 `.env.example`（全占位） |
| 5 | 全仓库 | `.env` / `.env.local` 等 | 拉取时已排除，未进入仓库 | — |
| 6 | `src/effects/models/face_landmarker.task` | MediaPipe 人脸模型二进制 | MCP 拉取失败（非文本），且与比赛无关 | 未收录 |

## 结论

- **零硬编码 API key、私钥、助记词、Telegram/Binance 密钥**
- **零内网地址、零真实用户数据**
- 所有密钥类配置走 `VITE_*` 环境变量，`.env.example` 仅占位
- 部署私钥（`~/.monad-deployer-key`）从未进入本仓库任何目录
