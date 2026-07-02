var fs = require('fs');
var file = './lib/scheduler.js';
var content = fs.readFileSync(file, 'utf8');

var oldBlock = `var warnMsgs = {
          "zh-TW": "⏰ 提醒您，此對話即將結束。\\n\\n如果沒有其他問題，此對話將在稍後自動結束。\\n如需繼續諮詢，請回覆任何訊息即可！\\n\\n💬 最後想請您花30秒填個小問卷，有機會參加每月抽獎 🎁\\n\\n👉 <link type=\\"url\\">" + _wSurveyUrl + "</link>",
          "ko": "⏰ 이 상담이 곧 종료됩니다.\\n\\n추가 문의가 없으시면 자동 종료됩니다.\\n계속 상담이 필요하시면 아무 메시지나 보내주세요!\\n\\n💬 30초만 투자해서 설문에 답해주세요. 매월 추첨 기회! 🎁\\n\\n👉 <link type=\\"url\\">" + _wSurveyUrl + "</link>",
          "en": "⏰ This chat will be closing soon.\\n\\nIf you need further help, please send a message!\\n\\n💬 Take 30 seconds for a quick survey & enter our monthly draw! 🎁\\n\\n👉 <link type=\\"url\\">" + _wSurveyUrl + "</link>",
          "ja": "⏰ このチャットはまもなく終了します。\\n\\n続けてご質問がある場合はメッセージを送信してください！\\n\\n💬 30秒のアンケートにご協力ください。毎月抽選のチャンス！🎁\\n\\n👉 <link type=\\"url\\">" + _wSurveyUrl + "</link>"
        };
        await channeltalk.sendMessage(warnChatId, { blocks: [{ type: "text", value: warnMsgs[warnLang] || warnMsgs["zh-TW"] }] });`;

var newBlock = `// 메시지 1: 종료 경고
        var _wNotice = {
          "zh-TW": "⏰ 提醒您，此對話即將結束。\\n\\n如果沒有其他問題，此對話將在稍後自動結束。\\n如需繼續諮詢，請回覆任何訊息即可！",
          "ko": "⏰ 이 상담이 곧 종료됩니다.\\n\\n추가 문의가 없으시면 자동 종료됩니다.\\n계속 상담이 필요하시면 아무 메시지나 보내주세요!",
          "en": "⏰ This chat will be closing soon.\\n\\nIf you need further help, please send a message!",
          "ja": "⏰ このチャットはまもなく終了します。\\n\\n続けてご質問がある場合はメッセージを送信してください！"
        };
        await channeltalk.sendMessage(warnChatId, { blocks: [{ type: "text", value: _wNotice[warnLang] || _wNotice["zh-TW"] }] });
        // 메시지 2: 설문 링크 (별도)
        var _wSurveyMsg = {
          "zh-TW": "🎁 花30秒填問卷，參加每月抽獎！\\n\\n👉 <link type=\\"url\\">" + _wSurveyUrl + "</link>",
          "ko": "🎁 30초 설문 참여하고 매월 추첨에 응모하세요!\\n\\n👉 <link type=\\"url\\">" + _wSurveyUrl + "</link>",
          "en": "🎁 30-sec survey for monthly prize draw!\\n\\n👉 <link type=\\"url\\">" + _wSurveyUrl + "</link>",
          "ja": "🎁 30秒アンケートで毎月抽選チャンス！\\n\\n👉 <link type=\\"url\\">" + _wSurveyUrl + "</link>"
        };
        await channeltalk.sendMessage(warnChatId, { blocks: [{ type: "text", value: _wSurveyMsg[warnLang] || _wSurveyMsg["zh-TW"] }] });`;

if (content.includes(oldBlock)) {
  content = content.replace(oldBlock, newBlock);
  fs.writeFileSync(file, content);
  console.log('✅ warning 메시지 분리 완료');
} else {
  console.log('⚠️ 패턴 불일치');
  process.exit(1);
}
