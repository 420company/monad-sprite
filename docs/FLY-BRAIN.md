# 果蝇大脑信号源接入文档

## 背景（公开研究，非私有财产）

- Google Research 2026-09 开源 **MaleCNS v1.0**：果蝇大脑完整 connectome（166,700 神经元）
- Coinbase 工程师 Alex Wormuth 开源 **Stonkfly**：果蝇脑启发的交易原型

monad小精灵借鉴其思路：把"神经放电→突触可塑性"映射为"交易盈亏→多巴胺→决策权重调整"
（见 `packages/engine/risk/flyReward.js`）。

## SignalProvider 接口

```js
// packages/engine/providers/index.js
{
  name: 'stonkfly',                    // 信号源名
  getSignal: async (symbol) => ({      // symbol: 'BTCUSDT' 或代币地址
    direction: 'long' | 'short' | 'flat',
    strength: 0.7,                    // 0~1
    confidence: 0.8,                  // 可选，0~1
    timestamp: Date.now(),            // 可选
    source: 'stonkfly',
  })
}
```

融合器（`packages/engine/fusion/fusion.js` 的 `fuse()`）要求：
双信号同向 **且** `|zalien方向分| > 40` 才开仓；单信号进观察池；无信号跳过。

## 私有 aster.py 如何接入（作者自有代码，未开源）

1. 在你的运行环境实现上述接口（读 aster.py 输出，转成 `{direction, strength}`）
2. `packages/cli/cli.js` 的 `paperOnce` 里把 `mockFlyProvider` 换成你的 provider
3. 其余链路（风控/执行/退出）零改动

## 当前状态

仓库内带 `mockFlyProvider`（可配方向/强度），用于测试与演示。
真实果蝇信号为作者私有研究代码，不在本仓库开源范围内。
