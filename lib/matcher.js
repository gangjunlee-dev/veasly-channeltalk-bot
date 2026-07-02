var FAQ_DATABASE = require("../data/faq");

var SYNONYMS = {
  '운비': '運費', '배송비': '運費', '운송비': '運費',
  '환불': '退款', '돈돌려': '退款', '退錢': '退款', '想退': '退款',
  '배송': '配送', '出貨': '配送', '寄送': '配送', '到貨': '配送',
  '얼마': '費用', '多少錢': '費用', '收費': '費用',
  '결제': '付款', '카드': '信用卡', '刷卡': '信用卡',
  '免費': '免運', '包郵': '免運', '免邮': '免運',
  '帐号': '帳戶', '账号': '帳戶', '密码': '密碼',
  '正品嗎': '正品', '真假': '正品', '是真的嗎': '正品',
  '尺码': '尺寸', '大小': '尺寸', '號碼': '尺寸',
  '打折': '折扣', '優惠': '折扣', '特價': '折扣',
  '預約': '預購', '預定': '預購',
  '壞了': '破損', '碎了': '破損', '瑕疵': '破損',
  '稅': '關稅', '繳稅': '關稅', '課稅': '關稅',
  '休息': '休假', '放假': '休假', '上班': '休假',
  '價格不對': '價格不符', '金額不對': '價格不符', '太貴': '價格不符',
  '幫我買': '報價',
  '想買': '報價',
  '能買嗎': '報價',
  '可以買嗎': '報價',
  '代購': '報價',
  '幫我代購': '報價',
  '구매대행': '報價',
  '사고싶어': '報價',
  '金額不同': '金額不符',
  '金額有差': '金額不符',
  '金額錯了': '金額不符',
  '結帳有問題': '金額不符',
  '付款有問題': '金額不符',
  '금액틀림': '金額不符',
  '금액다름': '金額不符',
};

var fallbackLog = {};

function applySynonyms(text) {
  var result = text;
  var keys = Object.keys(SYNONYMS);
  for (var i = 0; i < keys.length; i++) {
    if (result.indexOf(keys[i]) !== -1) {
      result = result.replace(keys[i], SYNONYMS[keys[i]]);
    }
  }
  return result;
}

// [2026-06-29] ASCII/라틴 키워드는 단어경계로 매칭해 'OK','app','line' 같은 짧은 토큰이
// 무관한 메시지에 부분일치(예: 'line' in 'online')해 엉뚱한 FAQ를 고르던 오탐을 방지.
// CJK(중국어/한국어/일본어)는 단어경계 개념이 약하므로 부분일치 유지.
function _isAscii(s) { return /^[\x00-\x7F]+$/.test(s); }
function _kwHit(haystack, kw) {
  if (!kw) return false;
  if (_isAscii(kw)) {
    var esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + esc + '([^a-z0-9]|$)', 'i').test(haystack);
  }
  return haystack.indexOf(kw) !== -1;
}

function findBestMatch(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return null;
  var normalizedMsg = userMessage.toLowerCase().trim();
  var synonymMsg = applySynonyms(normalizedMsg);

  var bestMatch = null;
  var highestScore = 0;

  for (var i = 0; i < FAQ_DATABASE.length; i++) {
    var faq = FAQ_DATABASE[i];
    if (!faq.keywords || !Array.isArray(faq.keywords)) continue;
    var score = 0;

    // Keyword matching (단어경계 적용 - _kwHit)
    for (var j = 0; j < faq.keywords.length; j++) {
      var kw = faq.keywords[j].toLowerCase();
      if (_kwHit(normalizedMsg, kw)) {
        score += kw.length * 2;
      } else if (_kwHit(synonymMsg, kw)) {
        score += kw.length;
      }
    }

    // Category matching (단어경계 적용, 가중치 하향 *3→*2 — 카테고리명 우연 포함 오탐 완화)
    if (faq.category && _kwHit(normalizedMsg, faq.category.toLowerCase())) {
      score += faq.category.length * 2;
    }

    if (score > highestScore) {
      highestScore = score;
      bestMatch = faq;
    }
  }

  if (highestScore < 2) {
    // Log fallback
    var key = normalizedMsg.substring(0, 50);
    fallbackLog[key] = (fallbackLog[key] || 0) + 1;
    return null;
  }
  return bestMatch;
}

function getFallbackStats() {
  var sorted = Object.keys(fallbackLog).sort(function(a, b) {
    return fallbackLog[b] - fallbackLog[a];
  });
  var top = {};
  for (var i = 0; i < Math.min(20, sorted.length); i++) {
    top[sorted[i]] = fallbackLog[sorted[i]];
  }
  return {
    total: Object.keys(fallbackLog).reduce(function(sum, k) { return sum + fallbackLog[k]; }, 0),
    top: top
  };
}

module.exports = {
  findBestMatch: findBestMatch,
  getFallbackStats: getFallbackStats
};
