var fs = require('fs');
var file = './lib/scheduler.js';
var content = fs.readFileSync(file, 'utf8');

// 1) 긴 survey URL → 짧은 URL로 변경 (auto-close 부분)
var oldUrl = 'var _cSurveyUrl = _cBaseUrl + "?cid=" + closeChatId + "&uid=" + (closeList[d].userId || "") + "&lang=" + _cLang + "&type=bot&ts=" + Math.floor(Date.now()/1000) + "&member=" + (_cUserInfo.member ? "1" : "0") + "&email=" + encodeURIComponent(_cUserInfo.email) + "&vid=" + encodeURIComponent(_cUserInfo.veaslyId);';
var newUrl = 'var _cSurveyUrl = _cBaseUrl + "?c=" + closeChatId + "&l=" + _cLang;';

if (content.includes(oldUrl)) {
  content = content.replace(oldUrl, newUrl);
  console.log('✅ URL 단축 완료');
} else {
  console.log('⚠️ URL 패턴 불일치 - 수동 확인 필요');
  process.exit(1);
}

// 2) 메시지를 분리: 종료 안내 + 설문 별도 전송
var oldMsgs = `var _closeMsgs = {
          "zh-TW": "此對話因長時間無新訊息，將自動結束。如有其他問題，歡迎隨時開啟新對話！😊\\n\\n💬 最後想請您花30秒填個小問卷，有機會參加每月抽獎 🎁\\n\\n👉 <link type=\\"url\\">" + _cSurveyUrl + "</link>",
          "ko": "장시간 추가 메시지가 없어 자동 종료됩니다. 추가 문의가 있으시면 새 채팅을 시작해주세요! 😊\\n\\n💬 30초만 투자해서 설문에 답해주세요 🎁\\n\\n👉 <link type=\\"url\\">" + _cSurveyUrl + "</link>",
          "en": "This chat is closing due to inactivity. Feel free to start a new chat anytime! 😊\\n\\n💬 Quick 30-sec survey for a chance to win monthly prizes! 🎁\\n\\n👉 <link type=\\"url\\">" + _cSurveyUrl + "</link>",
          "ja": "長時間メッセージがないため、自動終了します。新しいチャットはいつでも開始できます！😊\\n\\n💬 30秒アンケートで毎月抽選チャンス！🎁\\n\\n👉 <link type=\\"url\\">" + _cSurveyUrl + "</link>"
        };
        var closeMsg = _closeMsgs[_cLang] || _closeMsgs["zh-TW"];
        await channeltalk.sendMessage(closeChatId, { blocks: [{ type: "text", value: closeMsg }] });`;

var newMsgs = `// 메시지 1: 종료 안내
        var _closeNotice = {
          "zh-TW": "此對話因長時間無新訊息，將自動結束。\\n如有其他問題，歡迎隨時開啟新對話！😊",
          "ko": "장시간 추가 메시지가 없어 자동 종료됩니다.\\n추가 문의 시 새 채팅을 시작해주세요! 😊",
          "en": "This chat is closing due to inactivity.\\nFeel free to start a new chat anytime! 😊",
          "ja": "長時間メッセージがないため自動終了します。\\n新しいチャットはいつでも開始できます！😊"
        };
        await channeltalk.sendMessage(closeChatId, { blocks: [{ type: "text", value: _closeNotice[_cLang] || _closeNotice["zh-TW"] }] });
        // 메시지 2: 설문 링크 (별도 메시지로 눈에 띄게)
        var _surveyMsg = {
          "zh-TW": "🎁 花30秒填問卷，參加每月抽獎！\\n\\n👉 <link type=\\"url\\">" + _cSurveyUrl + "</link>",
          "ko": "🎁 30초 설문 참여하고 매월 추첨에 응모하세요!\\n\\n👉 <link type=\\"url\\">" + _cSurveyUrl + "</link>",
          "en": "🎁 30-sec survey for monthly prize draw!\\n\\n👉 <link type=\\"url\\">" + _cSurveyUrl + "</link>",
          "ja": "🎁 30秒アンケートで毎月抽選チャンス！\\n\\n👉 <link type=\\"url\\">" + _cSurveyUrl + "</link>"
        };
        await channeltalk.sendMessage(closeChatId, { blocks: [{ type: "text", value: _surveyMsg[_cLang] || _surveyMsg["zh-TW"] }] });`;

if (content.includes(oldMsgs)) {
  content = content.replace(oldMsgs, newMsgs);
  console.log('✅ 메시지 분리 완료');
} else {
  console.log('⚠️ 메시지 패턴 불일치 - 수동 확인 필요');
  // 부분 매칭 시도
  process.exit(1);
}

fs.writeFileSync(file, content);
console.log('✅ 전체 수정 완료');
