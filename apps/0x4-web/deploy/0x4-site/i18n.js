// 0x4 官网文案（2026-09-29 单屏轮播版）。只写真实可用的功能；余额类（打赏、红包、转账、充提、付费领养）不写，不写收益承诺和编造的数字。
// ★文案不出现第三方品牌名（交易所、行情源、脑图数据集名都不写）；Google 那句是 goat 自己要求的说法。
// 首屏标语 Friends, Token, Community 中英文都用英文（goat 定：品牌旗帜）。
// 数字来源：连接组数字 = docs/FLY.md。
window.I18N = {
  zh: {
    'meta.title': '0x4 · Meme is everything',
    'meta.desc': '0x4 是多链自托管钱包，也是和朋友一起交易、社交的地方。',
    'lang.label': '切换语言',
    'into': 'Into the 0x4',
    'nav.carousel': '介绍', 'nav.go': '第 {n} 页：{name}',
    'scene.hero': '0x4', 'scene.chains': '多链', 'scene.trade': '交易', 'scene.keys': '密钥', 'scene.social': '不仅如此', 'scene.sprite': '小精灵',

    'chains.title': '一个应用，<br><em>多条链路</em>',
    'chains.lede': 'BSC、以太坊、Solana、比特币等数十条链，在一个钱包里完全兼容。',

    'trade.title': '看到想买的，<br><em>当场就能买</em>',
    'trade.p1.t': '一键买卖',
    'trade.p1.d': '热门币、群聊里提到的币，点开就是实时行情，一键成交。',
    'trade.p2.t': '闪兑与跨链',
    'trade.p2.d': '不同链上的币直接互换。跨链的资金到账后，自动出现在你的钱包里。',
    'trade.p3.t': '永续合约',
    'trade.p3.d': '使用去中心化协议看涨看跌，保证金和杠杆一眼看清。',

    'keys.title': '您的密钥会保留在<br><em>您的设备上</em>',
    'keys.lede': '我们绝不触及用户任何密钥。',

    'social.title': '不仅<em>如此</em>',
    'social.lede': '我们成为朋友，我们一起交易，我们一起建设。',
    'tp.spot': '现货', 'tp.perp': '合约', 'tp.buy': '买入', 'tp.sell': '卖出', 'tp.long': '做多', 'tp.short': '做空',
    'keys.b1': '生物识别解锁', 'keys.b2': '本机加密存储',

    'sprite.title': '一颗真实的大脑，<br><em>替你盯盘</em>',
    'sprite.lede': '借助谷歌 AI 重建并公开发布的首批真实生物大脑完整神经连接图之一，被我们优化成一只正在学习人类交易习惯的小精灵。',
    'sprite.stats': '166,700 个神经元 · 2,560 万条连接 · 7,835 条会学习的突触',
    'sprite.s1.t': '看', 'sprite.s1.d': 'K 线图送进它的眼睛，感光神经元开始放电。',
    'sprite.s2.t': '想', 'sprite.s2.d': '放电沿着真实的连接传遍全脑。',
    'sprite.s3.t': '选', 'sprite.s3.d': '左右两组下行神经元比较放电快慢，偏向哪边，就是买或卖。',
    'sprite.s4.t': '记', 'sprite.s4.d': '盈亏改写它的记忆突触。下一次看盘，它已经不一样了。',
    'sprite.buy': '买', 'sprite.sell': '卖',
    'sprite.caveat': '小精灵的决策来自神经科学模拟，这是一场社会性实验，DYOR。'
  },
  en: {
    'meta.title': '0x4 · Meme is everything',
    'meta.desc': '0x4 is a self-custody wallet for many chains and a place to trade and hang out with friends.',
    'lang.label': 'Switch language',
    'into': 'Into the 0x4',
    'nav.carousel': 'Introduction', 'nav.go': 'Slide {n}: {name}',
    'scene.hero': '0x4', 'scene.chains': 'Chains', 'scene.trade': 'Trade', 'scene.keys': 'Keys', 'scene.social': 'Beyond', 'scene.sprite': 'Sprite',

    'chains.title': 'One app, <em>many chains</em>',
    'chains.lede': 'BSC, Ethereum, Solana, Bitcoin and dozens more chains, fully compatible in one wallet.',

    'trade.title': 'See it, and <em>buy it on the spot</em>',
    'trade.p1.t': 'One-tap trades',
    'trade.p1.d': 'Trending tokens and the ones your group mentions open to live charts. One tap to trade.',
    'trade.p2.t': 'Swaps across chains',
    'trade.p2.d': 'Trade tokens that live on different chains. Bridged funds appear in your wallet as soon as they land.',
    'trade.p3.t': 'Perpetuals',
    'trade.p3.d': 'Go long or short through decentralized protocols, with margin and leverage in plain view.',

    'keys.title': 'Your keys stay <em>on your device</em>',
    'keys.lede': 'We never touch any user’s keys.',

    'social.title': 'Beyond the <em>Trade</em>',
    'social.lede': 'We become friends, we trade together, we build together.',
    'tp.spot': 'Spot', 'tp.perp': 'Perps', 'tp.buy': 'Buy', 'tp.sell': 'Sell', 'tp.long': 'Long', 'tp.short': 'Short',
    'keys.b1': 'Biometric unlock', 'keys.b2': 'Encrypted on device',

    'sprite.title': 'A real brain, <em>watching the market for you</em>',
    'sprite.lede': 'One of the first complete wiring maps of a real brain, reconstructed with Google’s AI and released openly. We tuned it into a sprite that is learning how people trade.',
    'sprite.stats': '166,700 neurons · 25.6M connections · 7,835 synapses that learn',
    'sprite.s1.t': 'See', 'sprite.s1.d': 'The chart reaches its eyes and photoreceptors start firing.',
    'sprite.s2.t': 'Think', 'sprite.s2.d': 'Spikes travel along real connections across the whole brain.',
    'sprite.s3.t': 'Decide', 'sprite.s3.d': 'Two groups of descending neurons compare how fast they fire. The winning side means buy or sell.',
    'sprite.s4.t': 'Learn', 'sprite.s4.d': 'Gains and losses rewrite its memory synapses. The next look is already different.',
    'sprite.buy': 'Buy', 'sprite.sell': 'Sell',
    'sprite.caveat': 'A sprite decides through a neuroscience simulation. This is a social experiment. DYOR.'
  }
}
