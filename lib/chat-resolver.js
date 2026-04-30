/**
 * chat-resolver.js
 * 채팅이 "봇에 의해 해결 완료"인지 판단하는 공통 유틸
 * scheduler.js, analytics.js 양쪽에서 사용
 */

// CSAT/CES 숫자 응답 패턴
var CSAT_PATTERN = /^[1-5]$/;

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

    // Case 2: 고객 마지막 메시지가 감사/확인 표현
    var lowerText = lastUserText.toLowerCase();
    for (var j = 0; j < RESOLVED_PHRASES.length; j++) {
      if (lowerText.indexOf(RESOLVED_PHRASES[j].toLowerCase()) > -1 && lastUserText.length < 30) {
        return { resolved: true, reason: 'thank_confirm' };
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

module.exports = { isChatResolved: isChatResolved, CSAT_PATTERN: CSAT_PATTERN, RESOLVED_PHRASES: RESOLVED_PHRASES };
