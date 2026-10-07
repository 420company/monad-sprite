'use strict';
/**
 * sixfive.js —— 测试用 stub（付费 6551 消息面 API，快照里没有）。
 * analyze.js 调用：sixfive.impl.get_coin_news(s, 8).catch(() => null)
 * 原代码有 .catch 和空处理，返回 null 安全降级（新闻情绪维度自动缺失）。
 */
module.exports = {
  impl: {
    get_coin_news: async () => null,
  },
};
