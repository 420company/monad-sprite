'use strict';
/**
 * providers/index.js —— SignalProvider 接口（果蝇大脑/任意信号源的接入点）
 *
 * 接口约定：
 *   {
 *     name: string,                       // 如 'stonkfly' / 'mock-fly'
 *     getSignal(symbol) => Promise<{      // symbol 如 'BTCUSDT' 或代币地址
 *       direction: 'long' | 'short' | 'flat',
 *       strength: number,                 // 0~1
 *       confidence?: number,              // 0~1，可选
 *       timestamp?: number,               // ms，可选
 *       source: string,
 *     }>
 *   }
 *
 * 真实果蝇（aster.py）在作者服务器上运行，未开源。本仓库内带 mock 实现，
 * 文档 docs/FLY-BRAIN.md 说明私有 aster.py 如何实现该接口接入。
 */

/** mock 实现：测试/演示用，真实接入时替换 */
function mockFlyProvider(direction = 'long', strength = 0.7) {
  return {
    name: 'mock-fly',
    async getSignal(symbol) {
      return {
        direction, strength,
        source: 'mock-fly（真实果蝇接入时替换为 aster.py 输出）',
        timestamp: Date.now(), symbol,
      };
    },
  };
}

/**
 * 把 provider 信号 + zalien 标准信号融合成决策（fusion.js 的薄封装，
 * 保持原有 fuse() 语义，输入改为 provider）。
 */
async function fusedDecision(provider, zalienSignal, entryPrice) {
  const { fuse } = require('../fusion/fusion');
  const fly = await provider.getSignal(zalienSignal.symbol);
  return fuse(fly, zalienSignal, entryPrice);
}

module.exports = { mockFlyProvider, fusedDecision };
