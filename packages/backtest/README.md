# backtest —— 回测

- `backtest3way.js`：perps 三向回测留档（纯 zalien / 静态果蝇融合 / 多巴胺学习果蝇，
  合成数据 960 tick）。`legacy/` 下是它依赖的永续版模块（exitEngine v1、fusion、learningFly）。
- Monad spot 回放回测（录制的 bonding curve 代币价格序列）为 P1 待建：
  用 `packages/monad-executor/src/paper.js` 的本地曲线数学做回放引擎。
