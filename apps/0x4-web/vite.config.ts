import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { APP_PREFIXES } from './src/lib/appPrefixes'

// Vite 构建配置：React + Tailwind v4 + PWA（可安装到手机主屏幕）
const PREVIEW = process.env.PREVIEW_BUILD === '1'
// 原生 App（Capacitor）打包：不注册 Service Worker，页面从本地资源加载
const NATIVE = process.env.CAPACITOR_BUILD === '1'
// 电脑端网页版（420.meme/app，见 src/lib/surface.ts）：挂在 /app/ 下，不注册 Service Worker（官网同域，免得缓存住旧版）
const WEB = process.env.VITE_SURFACE === 'web'
// iOS 上架版不带合约（src/lib/features.ts 的 PERP_ENABLED）：两个合约页换成空页面，文件不进安装包。
// 更具体的两条要排在 '@' 前面，否则先被 '@' 匹配走
const NO_PERP = process.env.VITE_NO_PERP === '1'
const NO_PERP_ALIAS = NO_PERP ? [
  { find: '@/pages/Perp', replacement: '/src/lib/noPage.tsx' },
  { find: '@/desktop/pages/PerpTerminal', replacement: '/src/lib/noPage.tsx' },
] : []

/**
 * 网页版专用：<head> 里放进场脚本 warp.js（第一帧前同步执行，见 src/desktop/warp.js）。手机 App 构建不走这个插件。
 * 字体 Geist 打包在网页版里（main.tsx 引 @fontsource-variable/geist），不连 Google Fonts：国内打不开，会退回系统字体。
 */
function webSurface(): Plugin {
  const WARP = readFileSync(new URL('./src/desktop/warp.js', import.meta.url), 'utf8')
  return {
    name: '0x4-web-surface',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'warp.js', source: WARP }) },
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        { tag: 'script', attrs: { src: '/app/warp.js' }, injectTo: 'head' },
      ],
    },
    // 本地开发（vite dev）时 /app/warp.js 也要能拿到
    configureServer(server) {
      // 干净网址（2026-10-02，lib/route.ts）：开发服务器上直接打开 /discover、/token/... 这些页面也要给网页版的 index.html，
      // 和线上 Vercel 的转发规则一样
      const page = new RegExp(`^/(${APP_PREFIXES.join('|')})(/|\\?|$)`)
      server.middlewares.use((req, _res, next) => {
        if (req.method === 'GET' && page.test(req.url || '') && (req.headers.accept || '').includes('text/html')) req.url = '/app/'
        next()
      })
      // 开发服务器会给 index.html 里的绝对地址再加一次 base（变成 /app/app/warp.js），两个地址都给
      for (const p of ['/app/warp.js', '/app/app/warp.js']) server.middlewares.use(p, (_req, res) => { res.setHeader('content-type', 'text/javascript'); res.end(WARP) })
    },
  }
}

/**
 * 网页版直播特效的识别引擎（2026-10-02，@mediapipe/tasks-vision 的 wasm）：原样放进 assets/mediapipe-<版本>/，
 * 路径带版本号所以能永久缓存；开发时由开发服务器直接给。所有构建都带（2026-10-02 goat：手机 App 的主播也要能用特效），
 * 只在主播打开特效时才会下载，手机网页版的离线缓存里也不放（见下面 globIgnores）。
 * （用 import ?url 不行：那个包的 package.json 不让按路径引 wasm 目录，开发服务器还会把加载脚本当依赖打包，地址就错了）
 */
const MP_DIR = `mediapipe-${JSON.parse(readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8')).version}`
function mediapipeWasm(emit: boolean): Plugin {
  const files = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']
  const VID = 'virtual:0x4-mediapipe'
  const src = (f: string) => new URL(`./node_modules/@mediapipe/tasks-vision/wasm/${f}`, import.meta.url)
  return {
    name: '0x4-mediapipe-wasm',
    // src/effects/engine.ts 从这个虚拟模块拿目录名（开发、正式构建都一样）
    resolveId(id) { return id === VID ? '\0' + VID : null },
    load(id) { return id === '\0' + VID ? `export default ${JSON.stringify(MP_DIR)}` : null },
    generateBundle() { if (emit) for (const f of files) this.emitFile({ type: 'asset', fileName: `assets/${MP_DIR}/${f}`, source: readFileSync(src(f)) }) },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/assets\/mediapipe-[^/]+\/(vision_wasm_internal\.(js|wasm))(\?.*)?$/.exec(req.url || '')
        if (!m) return next()
        res.setHeader('content-type', m[2] === 'js' ? 'text/javascript' : 'application/wasm')
        res.end(readFileSync(src(m[1])))
      })
    },
  }
}

export default defineConfig({
  base: PREVIEW ? './' : WEB ? '/app/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    WEB && webSurface(),
    mediapipeWasm(true),
    !PREVIEW && !NATIVE && !WEB && VitePWA({
      registerType: 'autoUpdate',
      // 不用插件自动注入的 registerSW.js（它只注册、不管当前页面换新包，更新后第一次打开还是旧版）。
      // 注册和「新版接管后刷新 / 提示」在 src/lib/pwaUpdate.ts
      injectRegister: false,
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: '0x4',
        short_name: '0x4',
        description: '多链自托管钱包与社交',
        theme_color: '#0b0f0c',
        background_color: '#0b0f0c',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // 新 SW 装好立刻接管（injectRegister 关掉以后插件不再自动加这两项，要自己写）
        skipWaiting: true,
        clientsClaim: true,
        // 行情与链上数据永远走网络，不缓存
        navigateFallback: '/index.html',
        runtimeCaching: [],
        // 直播特效的识别引擎和 3D（约 1MB 脚本）只有主播开特效才用，不放进每个人的离线缓存
        globIgnores: ['**/mediapipe-*/**', '**/assets/processor-*.js'],
      },
    }),
  ].filter(Boolean),
  define: {
    // @solana/web3.js 在浏览器里需要 process.env 占位
    'process.env': {},
    // 原生 App 打包标记：App 里没有服务器上的 web.env，某些默认值要换（见 src/lib/env.ts）
    __NATIVE_BUILD__: NATIVE,
    // 有没有 Service Worker（只有正式网页版有）：src/lib/pwaUpdate.ts 据此决定注不注册
    __PWA__: !PREVIEW && !NATIVE && !WEB,
  },
  resolve: {
    // buffer 指向 npm 包而不是 Node 内置模块
    alias: [...NO_PERP_ALIAS, { find: '@', replacement: '/src' }, { find: 'buffer', replacement: 'buffer/' }],
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  server: {
    // 开发时把 API 与 WebSocket 代理到本地后端（server/，默认 8787 端口）
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/files': { target: 'http://localhost:8787', changeOrigin: true }, // 上传的图片 / 视频 / 加密媒体
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/files': { target: 'http://localhost:8787', changeOrigin: true }, // 上传的图片 / 视频 / 加密媒体
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
})
