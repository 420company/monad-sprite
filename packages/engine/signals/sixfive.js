'use strict';
/**
 * sixfive.js — test stub (paid 6551 news API, not in this snapshot).
 * analyze.js calls: sixfive.impl.get_coin_news(s, 8).catch(() => null)
 * The original code has .catch + null handling — safe degradation to null (news-sentiment dimension simply goes missing).
 */
module.exports = {
  impl: {
    get_coin_news: async () => null,
  },
};
