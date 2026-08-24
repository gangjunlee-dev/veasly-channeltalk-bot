/**
 * @deprecated 2026-08-24 — veasly-ops 전용 push 였으나, 대상 플랫폼이 별도로 정해지면서
 *   범용 모듈 lib/cs-feed.js 로 대체됐다. 하위 호환용 얇은 래퍼만 남긴다.
 *   신규 코드는 require('./cs-feed').refresh() 를 쓸 것.
 */
var csFeed = require('./cs-feed');
module.exports = {
  pushSnapshot: function (o) { return csFeed.refresh(o); },
  isEnabled: function () { return !!process.env.CS_FEED_WEBHOOK_URL; }
};
