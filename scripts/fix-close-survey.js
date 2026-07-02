var fs = require('fs');
var file = '/home/ubuntu/veasly-channeltalk-bot/lib/scheduler.js';
var content = fs.readFileSync(file, 'utf8');

// 기존 종료 메시지 블록을 설문 포함 버전으로 교체
var oldClose = `        // 종료 메시지 (CSAT는 12h 경고에서 이미 발송)
        var closeMsg = "이 상담은 장시간 추가 메시지가 없어 자동 종료됩니다. 추가 문의가 있으시면 언제든 새 채팅을 시작해주세요! 😊\\n\\n" +
          "此對話因長時間無新訊息，將自動結束。如有其他問題，歡迎隨時開啟新對話！😊";

        await channeltalk.sendMessage(closeChatId, { blocks: [{ type: "text", value: closeMsg }] });
        // CSAT는 12h 경고에서 이미 발송됨`;

var newClose = `        // 종료 메시지 + 설문 링크 발송
        var _cLangs = {}; try { _cLangs = JSON.parse(fs.readFileSync(require("path").join(__dirname, "..", "data", "chat-languages.json"), "utf8")); } catch(e) {}
        var _cLang = _cLangs[closeChatId] || "zh-TW";
        var _cUserInfo = { member: false, email: '', veaslyId: '', name: '' };
        try {
          var _cUserData = await channeltalk.getUser(closeList[d].userId || '');
          var _cu = (_cUserData && _cUserData.user) ? _cUserData.user : _cUserData;
          if (_cu) { _cUserInfo.member = _cu.member === true; _cUserInfo.email = _cu.email || (_cu.profile && _cu.profile.email) || ''; _cUserInfo.veaslyId = (_cu.profile && _cu.profile.veasly_id) || _cu.memberId || ''; _cUserInfo.name = _cu.name || (_cu.profile && _cu.profile.name) || ''; }
        } catch(_cue) {}
        var _cBaseUrl = "https://veasly-dashboard.gangjun-lee.workers.dev/survey.html";
        var _cSurveyUrl = _cBaseUrl + "?cid=" + closeChatId + "&uid=" + (closeList[d].userId || "") + "&lang=" + _cLang + "&type=bot&ts=" + Math.floor(Date.now()/1000) + "&member=" + (_cUserInfo.member ? "1" : "0") + "&email=" + encodeURIComponent(_cUserInfo.email) + "&vid=" + encodeURIComponent(_cUserInfo.veaslyId);
        var _closeMsgs = {
          "zh-TW": "此對話因長時間無新訊息，將自動結束。如有其他問題，歡迎隨時開啟新對話！😊\\n\\n💬 最後想請您花30秒填個小問卷，有機會參加每月抽獎 🎁\\n\\n👉 <link type=\\"url\\">" + _cSurveyUrl + "</link>",
          "ko": "장시간 추가 메시지가 없어 자동 종료됩니다. 추가 문의가 있으시면 새 채팅을 시작해주세요! 😊\\n\\n💬 30초만 투자해서 설문에 답해주세요 🎁\\n\\n👉 <link type=\\"url\\">" + _cSurveyUrl + "</link>",
          "en": "This chat is closing due to inactivity. Feel free to start a new chat anytime! 😊\\n\\n💬 Quick 30-sec survey for a chance to win monthly prizes! 🎁\\n\\n👉 <link type=\\"url\\">" + _cSurveyUrl + "</link>",
          "ja": "長時間メッセージがないため、自動終了します。新しいチャットはいつでも開始できます！😊\\n\\n💬 30秒アンケートで毎月抽選チャンス！🎁\\n\\n👉 <link type=\\"url\\">" + _cSurveyUrl + "</link>"
        };
        var closeMsg = _closeMsgs[_cLang] || _closeMsgs["zh-TW"];
        await channeltalk.sendMessage(closeChatId, { blocks: [{ type: "text", value: closeMsg }] });
        if (!csatHelper.alreadySent(closeChatId)) { csatHelper.markSent(closeChatId, "auto-close-csat"); }`;

if (content.includes(oldClose)) {
  content = content.replace(oldClose, newClose);
  fs.writeFileSync(file, content, 'utf8');
  console.log('✅ 자동종료 시 설문 발송 로직 추가 완료');
} else {
  console.log('❌ 패턴 불일치 - 수동 확인 필요');
  console.log('찾는 패턴 첫 줄:', oldClose.split('\n')[0]);
}
