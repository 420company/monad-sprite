import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// 测试配置独立于 vite.config.ts：跑测试不需要 React、Tailwind、PWA 那一套插件，
// 加载它们只会让每次跑测试多等好几秒。
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      buffer: 'buffer/',
    },
  },
  define: { 'process.env': {}, __NATIVE_BUILD__: 'false' },
  test: {
    // 默认 node 环境：Node 22+ 自带 WebCrypto，金库加解密可以直接测真的，不用打桩。
    // 需要 DOM 的用例在文件头写 `@vitest-environment jsdom`。
    environment: 'node',
    // server/tests 下那个是 tsx 直接跑的脚本式断言（顶层 await + node:assert），
    // 不是 vitest 套件，由 npm run test:server 单独跑，别收进来。
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    testTimeout: 30_000,   // PBKDF2 跑 25 万轮，几个用例串起来会超默认的 5 秒
  },
})
