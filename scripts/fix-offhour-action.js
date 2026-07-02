var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/routes/webhook.js";
var code = fs.readFileSync(file, "utf8");

// 현재 코드 찾기
var searchStr = 'var actionMsg = (actionMsgs[actionType] && actionMsgs[actionType][detectedLang]) || (actionMsgs[actionType] && actionMsgs[actionType]["zh-TW"]) || "正在為您轉接客服人員 🙋‍♀️";';
var idx = code.indexOf(searchStr);

if (idx === -1) {
  console.log("패턴 못 찾음. 주변 코드 확인:");
  var i2 = code.indexOf("actionMsgs[actionType]");
  if (i2 > -1) console.log(code.substring(i2 - 50, i2 + 300));
  process.exit(1);
}

// actionMsg ~ connectManager 까지 3줄을 찾아서 교체
var endStr = "await connectManager(chatId, detectedLang);";
var endIdx = code.indexOf(endStr, idx);
if (endIdx === -1) { console.log("connectManager 패턴 못 찾음"); process.exit(1); }
var fullEnd = endIdx + endStr.length;

var oldBlock = code.substring(idx, fullEnd);
console.log("찾은 블록 길이:", oldBlock.length);

var newBlock = [
  'if (!isBusinessHours()) {',
  '        // 오프시간: 안내 메시지 + 매니저 초대(출근 후 확인용)',
  '        var _holAct = getHolidayNotice(detectedLang);',
  '        var offHourActionMsgs = {',
  '          "zh-TW": (_holAct ? _holAct + "\\n\\n" : "") + "\\ud83d\\udca1 目前非客服時間（台灣 09:00~18:00），此問題需要客服人員為您處理。\\n\\n\\ud83d\\udcdd 請先留下相關資訊（如訂單號碼），客服人員上班後會優先為您處理！\\n\\n\\u23f0 客服時間：週一至週五 台灣 09:00~18:00\\n我們一定會回覆您！\\ud83d\\ude0a",',
  '          "ko": "\\ud83d\\udca1 현재 영업시간이 아닙니다 (평일 10:00~19:00 KST). 이 문의는 상담사 확인이 필요합니다.\\n\\n\\ud83d\\udcdd 관련 정보(주문번호 등)를 남겨주시면 업무 시작 후 우선 처리해드리겠습니다!\\n\\n\\u23f0 상담시간: 평일 10:00~19:00 (한국시간)",',
  '          "en": "\\ud83d\\udca1 Currently outside business hours (Mon-Fri 10:00-19:00 KST). This request needs agent assistance.\\n\\n\\ud83d\\udcdd Please leave the details (e.g. order number) and our team will prioritize it first thing!",',
  '          "ja": "\\ud83d\\udca1 現在営業時間外です（月〜金 10:00〜19:00 KST）。このお問い合わせはスタッフの対応が必要です。\\n\\n\\ud83d\\udcdd 関連情報（注文番号など）を残してください。営業開始後すぐに対応いたします！"',
  '        };',
  '        await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: offHourActionMsgs[detectedLang] || offHourActionMsgs["zh-TW"] }] });',
  '        await connectManager(chatId, detectedLang);',
  '      } else {',
  '        var actionMsg = (actionMsgs[actionType] && actionMsgs[actionType][detectedLang]) || (actionMsgs[actionType] && actionMsgs[actionType]["zh-TW"]) || "正在為您轉接客服人員 \\ud83d\\ude4b\\u200d\\u2640\\ufe0f";',
  '        await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: actionMsg }] });',
  '        await connectManager(chatId, detectedLang);',
  '      }'
].join("\n      ");

code = code.substring(0, idx) + newBlock + code.substring(fullEnd);
fs.writeFileSync(file, code);
console.log("✅ action_request 오프시간 분기 추가 완료");
