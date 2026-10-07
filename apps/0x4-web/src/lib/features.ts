// 功能开关（2026-09-27 goat）：站内余额相关的功能（余额与收入页、充值、提现、送礼物打赏、余额红包、余额转账、付费领养 / 续期）
// 在手机端一律不出现。app.420.meme 现在是手机 App 上架前的临时「手机端网页版」，和原生 App 同样对待。
// 以后的「网页端」是另一套界面（有预测市场、站内钱包充值提现），那一套构建时设 VITE_BALANCE_FEATURES=1 打开。
// 原因：用 App 外充值的余额买虚拟礼物、在用户之间转余额，苹果审核要求走内购或视为支付服务，会导致上不了架。
// 这些功能记在白皮书的「未来计划」里，见记忆 project_0x4_balance_features_future。

/** 站内余额类功能是否可用：默认关闭（手机端 / app.420.meme） */
export const BALANCE_FEATURES = import.meta.env.VITE_BALANCE_FEATURES === '1'

/**
 * 合约交易（2026-10-02 goat）：苹果的规定是加密货币期货交易必须由持牌金融机构提交，所以 iOS 上架版不带合约。
 * 代码一行没删：iOS 打包时设 VITE_NO_PERP=1（npm run ios:store）把入口关掉——合约页、首页的「合约」按钮、
 * 小精灵的合约模式和合约申请、合约相关的费率 / 通知开关 / 提示。别人发的合约动态照常能看，点进去回首页。
 * 网页版、安卓和平时的开发构建默认开着。以后有持牌的合作方：去掉这个变量重新打包，功能原样回来，不用重写。
 */
export const PERP_ENABLED = import.meta.env.VITE_NO_PERP !== '1'

/**
 * App 里领养小精灵（2026-10-02 goat：领养只在网页）：苹果规定「持有 NFT 不能解锁 App 里的功能」，也不许 App 里引导到别处购买。
 * iOS 上架版打包时设 VITE_NO_ADOPT=1（npm run ios:store 已带）：小精灵页只列出已经有的小精灵，不查钱包里的 NFT、
 * 不出现领养按钮和「Zalien is the key」这类话，也不写「去网页领养」。已经领养的照常看、照常设置。
 * 网页版、安卓和平时的开发构建默认开着。
 */
export const ADOPT_IN_APP = import.meta.env.VITE_NO_ADOPT !== '1'
