'use strict';
/**
 * providers/index.js — SignalProvider interface (plug-in point for the fly brain / any signal source)
 *
 * Interface contract:
 *   {
 *     name: string,                       // e.g. 'stonkfly' / 'mock-fly'
 *     getSignal(symbol) => Promise<{      // symbol e.g. 'BTCUSDT' or token address
 *       direction: 'long' | 'short' | 'flat',
 *       strength: number,                 // 0~1
 *       confidence?: number,              // 0-1, optional
 *       timestamp?: number,               // ms, optional
 *       source: string,
 *     }>
 *   }
 *
 * The real fly (aster.py) runs on the author's server, not open-sourced. This repo ships a mock,
 * and docs/FLY-BRAIN.md explains how the private aster.py implements this interface.
 */

/** Mock implementation: for tests/demos, replaced by the real integration */
function mockFlyProvider(direction = 'long', strength = 0.7) {
  return {
    name: 'mock-fly',
    async getSignal(symbol) {
      return {
        direction, strength,
        source: 'mock-fly (replaced by aster.py output on real integration)',
        timestamp: Date.now(), symbol,
      };
    },
  };
}

/**
 * Merges provider signal + zalien standard signal into a decision (thin wrapper over fusion.js,
 * preserving fuse() semantics with provider-based input).
 */
async function fusedDecision(provider, zalienSignal, entryPrice) {
  const { fuse } = require('../fusion/fusion');
  const fly = await provider.getSignal(zalienSignal.symbol);
  return fuse(fly, zalienSignal, entryPrice);
}

module.exports = { mockFlyProvider, fusedDecision };
