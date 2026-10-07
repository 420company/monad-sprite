# 0x4 Web

0x4 网页版（https://420.meme/app/）的前端代码。0x4 是多链自托管交易钱包 + 社交：Solana 和 27 条 EVM 链买卖、合约交易、动态 / 群 / 私信、直播和会议、交易小精灵。

The web front end of 0x4 (https://420.meme/app/): a multi-chain self-custody trading wallet with social features.

## 技术栈 / Stack

- Vite 8 + React 19 + TypeScript + Tailwind CSS v4 + zustand
- 网页版和手机 App 是同一套代码（`src/`），网页版用 `VITE_SURFACE=web` 构建；电脑宽屏的页面在 `src/desktop/`，手机宽度用 `src/pages/`
- 钱包签名走 0x4 Wallet 浏览器插件（私钥只在插件里），也支持 MetaMask 等外部钱包
- 后端（`api.420.meme`）不在这个仓库里

## 目录 / Layout

| 路径 | 内容 |
| --- | --- |
| `src/desktop/` | 网页版电脑宽屏：布局、行情、现货 / 合约终端、社区、资产、设置 |
| `src/pages/` | 手机宽度页面（和 App 共用） |
| `src/components/` | 共用组件 |
| `src/lib/` | 链、交易、社交、钱包等逻辑（含单元测试 `*.test.ts`） |
| `src/store/` | zustand 状态 |
| `deploy/0x4-site/` | 官网落地页、下载中心、服务条款 / 隐私 / 风险披露静态页 |
| `deploy/vercel/0x4-site.vercel.json` | 线上路由和安全规则（CSP） |

## 运行 / Run

```sh
npm install
VITE_SURFACE=web npm run dev        # 本地开发（需要后端时设 VITE_SOCIAL_API）
VITE_SURFACE=web npx vite build     # 构建
npx tsc --noEmit -p tsconfig.app.json
npx vitest run src
```
