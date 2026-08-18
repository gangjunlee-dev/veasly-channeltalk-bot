/**
 * chat-resolver.js
 * 채팅이 "봇에 의해 해결 완료"인지 판단하는 공통 유틸
 * scheduler.js, analytics.js 양쪽에서 사용
 */

// CSAT/CES 숫자 응답 패턴
var CSAT_PATTERN = /^[1-5]$/;

// [2026-08-14] 불만/미해결 신호. 아래 RESOLVED_PHRASES 는 부분매칭이라
//   「還沒收到退款」(환불 아직 못 받음)이 '收到'에, 「好的但是還沒出貨」가 '好的'에 걸려
//   불만이 '해결 완료'로 판정되고 있었다. 이 신호가 있으면 감사/확인 판정을 하지 않는다.
//   '退款'·'환불' 같은 주제어는 제외 — 「退款已收到，謝謝」까지 미해결로 뒤집힌다.
var COMPLAINT_SIGNALS = [
  '但是', '可是', '不過', '還沒', '还没', '未收到', '沒收到', '没收到', '沒有收到',
  '沒退', '没退', '怎麼辦', '為什麼', '为什么', '不對', '錯了',
  '아직', '안 왔', '안왔', '근데', '그런데'
];
var COMPLAINT_EN = /\b(but|still not|haven't|have not|not yet)\b/i;

function hasComplaintSignal(text) {
  if (!text) return false;
  for (var i = 0; i < COMPLAINT_SIGNALS.length; i++) {
    if (text.indexOf(COMPLAINT_SIGNALS[i]) > -1) return true;
  }
  return COMPLAINT_EN.test(text);
}

// 감사/확인/종료 의사 표현 (추가 문의 없음으로 간주)
var RESOLVED_PHRASES = [
  '謝謝', '感謝', '好的', '收到', '了解', '知道了', '沒問題', 'OK', 'ok', 'Ok',
  '감사', '고마워', '알겠', '네네', '넵', '확인', 'thanks', 'thank you', 'got it',
  'ありがとう', '了解です', 'わかりました'
];

/**
 * 메시지 목록에서 마지막 고객 메시지가 "해결 완료" 상태인지 판단
 * @param {Array} messages - 최근 메시지 배열 (personType, plainText 포함)
 * @param {string} botPersonId - 봇의 personId (optional)
 * @returns {{ resolved: boolean, reason: string }}
 */
function isChatResolved(messages, botPersonId) {
  if (!messages || messages.length === 0) {
    return { resolved: false, reason: 'no_messages' };
  }

  // [2026-08-14] 아래 판정은 "배열 끝 = 최신"을 전제하는데, 호출처(채널톡 API 응답)의 정렬이
  //   보장되지 않아 Case 1~3이 통째로 뒤집힐 수 있었다. createdAt 이 전부 있으면 오래된 순으로
  //   정규화한 뒤 판정한다(이미 오름차순이면 결과 동일).
  var _ts = function (m) {
    var v = m && m.createdAt;
    if (typeof v === 'number') return v;
    var p = Date.parse(v);
    return isNaN(p) ? 0 : p;
  };
  if (messages.every(function (m) { return _ts(m) > 0; })) {
    messages = messages.slice().sort(function (a, b) { return _ts(a) - _ts(b); });
  }

  // 최신 메시지부터 역순으로 확인
  var userMessages = [];
  var lastBotMsgIndex = -1;

  for (var i = messages.length - 1; i >= 0; i--) {
    var msg = messages[i];
    if (msg.personType === 'user') {
      userMessages.push(msg);
    }
    if (lastBotMsgIndex === -1 && msg.personType === 'bot') {
      lastBotMsgIndex = i;
    }
    if (lastBotMsgIndex === -1 && botPersonId && msg.personId === botPersonId) {
      lastBotMsgIndex = i;
    }
  }

  // Case 1: 고객 마지막 메시지가 CSAT 숫자 (1~5)
  if (userMessages.length > 0) {
    var lastUserText = (userMessages[0].plainText || '').trim();
    if (CSAT_PATTERN.test(lastUserText)) {
      return { resolved: true, reason: 'csat_response' };
    }

    // Case 2: 고객 마지막 메시지가 감사/확인 표현 (단, 불만 신호가 섞여 있으면 제외)
    var lowerText = lastUserText.toLowerCase();
    if (!hasComplaintSignal(lowerText)) {
      for (var j = 0; j < RESOLVED_PHRASES.length; j++) {
        if (lowerText.indexOf(RESOLVED_PHRASES[j].toLowerCase()) > -1 && lastUserText.length < 30) {
          return { resolved: true, reason: 'thank_confirm' };
        }
      }
    }
  }

  // Case 3: 봇이 마지막으로 응답한 후 고객 추가 메시지 없음
  if (lastBotMsgIndex > -1) {
    var hasUserAfterBot = false;
    for (var k = lastBotMsgIndex + 1; k < messages.length; k++) {
      if (messages[k].personType === 'user') {
        hasUserAfterBot = true;
        break;
      }
    }
    if (!hasUserAfterBot) {
      return { resolved: true, reason: 'bot_answered_no_followup' };
    }
  }

  return { resolved: false, reason: 'unresolved' };
}

module.exports = { isChatResolved: isChatResolved, CSAT_PATTERN: CSAT_PATTERN, RESOLVED_PHRASES: RESOLVED_PHRASES, hasComplaintSignal: hasComplaintSignal };
