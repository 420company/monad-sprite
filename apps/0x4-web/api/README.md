# Sprite Agent — 架构文档

> 完整 Muse 级 AI agent：网页 + Telegram 同一个大脑，MCP 插件架构，24/7 自主运行。

## 一句话

用户启用 agent 后，得到一个专属 AI（网页聊天 + Telegram 远程控制），绑定他的钱包，
有可插拔的工具插件，能 24 小时自己干活（盯盘、定时报告），能力对标 Muse。

## 架构图

```
┌─────────────┐     ┌──────────────┐
│  网页聊天    │     │  Telegram     │
│ /agent      │     │  webhook      │
└──────┬──────┘     └──────┬───────┘
       │                   │
       ▼                   ▼
┌─────────────────────────────────┐
│  api/agent.ts  api/telegram.ts   │  Vercel serverless
│         ▼                       │
│  api/_lib/agentCore.ts          │  共享对话循环（router.ai + 工具调用）
│         ▼                       │
│  Plugin Registry                │  MCP 式插件系统
│   ├─ monad-trading (6 tools)    │  查价/持仓/买入/卖出/发币
│   ├─ media (1 tool)             │  AI 画图
│   └─ code-runner (1 tool)       │  沙箱代码执行
└─────────────────────────────────┘
       │                   │
       ▼                   ▼
┌──────────────┐   ┌──────────────┐
│ router.ai    │   │ Monad testnet│
│ 151 models   │   │ chain 10143  │
└──────────────┘   └──────────────┘

┌─────────────────────────────────┐
│  api/cron/brief.ts              │  24/7：每天 01:00 UTC 自动推送早报
└─────────────────────────────────┘
```

## 插件系统（MCP 式）

加新能力只需 3 步，不碰核心代码：

```typescript
// api/_lib/plugins/myPlugin.ts
export const myPlugin: AgentPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  description: '...',
  tools: [ /* OpenAI function schemas */ ],
  async execute(toolName, args) { /* ... */ },
};

// api/_lib/plugins/index.ts
registry.register(myPlugin);
```

## 安全模型

| 操作 | 方式 |
|------|------|
| 查价/持仓/画图/代码 | 服务端直接执行 |
| 买入/卖出/发币 | 返回**未签名交易**，用户在 MetaMask 亲签 |
| 定时任务 | 只读 + Telegram 推送，不碰钱 |
| 自主签名 | ⏳ 待定（需用户拍板限额方案） |

服务器从不持有私钥、不签名。私钥只在用户浏览器钱包里。

## 环境变量（Vercel）

| 变量 | 用途 |
|------|------|
| `ROUTER_AI_KEY` | router.ai API key（必需） |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token（Telegram 功能需要） |
| `BRIEF_CHAT_ID` | 定时早报推送目标 |
| `BRIEF_WALLET` | 定时早报查询的钱包 |
| `CRON_SECRET` | cron 接口鉴权 |

## 待办

- [ ] agent 自主签名限额方案（用户拍板）
- [ ] 持久化记忆（Upstash KV，替代内存 Map）
- [ ] 视频生成插件（router.ai 有 seedance 模型）
- [ ] Rug Radar 插件（接 packages/radar 评分）
