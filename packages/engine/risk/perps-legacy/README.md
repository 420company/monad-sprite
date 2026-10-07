# perps-legacy —— 永续合约版风控（留档，现货系统不引用）

2026-10-07 白天为永续合约写的风控数学：杠杆铁律（`leverageGuard`）、
三关账户总控（`accountGuard`，含暴跌表与统一爆仓线逻辑）。

monad小精灵在 Monad 上做**现货 bonding curve 交易**，没有杠杆没有爆仓，
这些模块不再被主流程引用。保留在此供回测与思路参考。

现货风控见 `../spotGuard.js` + `../../docs/RISK-MODEL.md`。
