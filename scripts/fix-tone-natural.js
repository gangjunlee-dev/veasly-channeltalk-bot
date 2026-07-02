var fs = require("fs");

// ========== 1) ai-engine.js - shippingFeeGuard 수정 ==========
var aiFile = "/home/ubuntu/veasly-channeltalk-bot/lib/ai-engine.js";
var aiCode = fs.readFileSync(aiFile, "utf8");
var aiChanges = 0;

// 1-A) 잘못된 금액 감지 시 교체 텍스트를 자연스럽게
var oldBadFee = "answer = '國際運費是0~1公斤TWD 310，以實際重量和材積重量中較高者為計算基準。沒有0.5公斤的計費方式。配送時間大約韓國出發後7~14天，依通關速度而異。VEASLY不會在運費中加收額外費用喔！';";
var newBadFee = "answer = '國際運費是每公斤TWD 310起算喔！以實際重量和材積重量較高的那個為準，沒有0.5公斤的計費方式。寄出後大約7~14天會到，不會額外加收費用的～';";

if (aiCode.indexOf(oldBadFee) > -1) {
  aiCode = aiCode.replace(oldBadFee, newBadFee);
  aiChanges++;
  console.log("✅ [1] 배송비 교정 텍스트 자연스럽게 변경");
}

// 1-B) "310 누락 시 보충" 로직 삭제 (Gemini 답변 그대로 유지)
var oldSupp = "      // TWD 310이 없으면 보충\n" +
  "      if (!answer.includes('310')) {\n" +
  "        console.log('[shippingFeeGuard] TWD 310 누락, 보충 추가');\n" +
  "        answer = answer + ' 補充：VEASLY國際運費為0~1公斤TWD 310（固定費率），以實際重量和材積重量中較高者為準。合併配送須由客戶自行在訂單頁面申請。';\n" +
  "      }";

if (aiCode.indexOf(oldSupp) > -1) {
  aiCode = aiCode.replace(oldSupp, "      // [removed] 310 보충 로직 제거 - temperature 0.15 + 프롬프트로 충분");
  aiChanges++;
  console.log("✅ [2] 310 보충 로직 삭제 (Gemini 자연 답변 유지)");
}

fs.writeFileSync(aiFile, aiCode, "utf8");
console.log("   ai-engine.js: " + aiChanges + "개 변경\n");

// ========== 2) webhook.js - 합배송 텍스트 축소 + 자연스럽게 ==========
var whFile = "/home/ubuntu/veasly-channeltalk-bot/routes/webhook.js";
var whCode = fs.readFileSync(whFile, "utf8");
var whChanges = 0;

// 2-A) zh-TW 합배송 텍스트
var oldMergeZH = '"zh-TW": "關於合併配送，您可以在「我的頁面」直接申請喔！\\n\\n" +\n' +
  '          "申請連結：https://www.veasly.com/tw/my-page/orders/combined-shipping/request\\n\\n" +\n' +
  '          "請注意以下幾點：\\n" +\n' +
  '          "- 必須在訂單內仍有商品尚未抵達韓國倉庫時才能申請\\n" +\n' +
  '          "- 若所有商品都已到倉，會自動進入包裝流程，無法再申請合併\\n" +\n' +
  '          "- 合併後運費會依實際重量、材積重量與包裹尺寸重新計算，不一定比分開寄送便宜\\n" +\n' +
  '          "- 部分大型、易碎或特殊包裝商品可能無法合併\\n\\n" +\n' +
  '          "如有其他問題，歡迎隨時詢問！"';

var newMergeZH = '"zh-TW": "合併配送可以在這裡直接申請喔～\\nhttps://www.veasly.com/tw/my-page/orders/combined-shipping/request\\n\\n只要訂單裡還有商品沒到韓國倉庫就能申請！合併後運費會重新計算，多退少補。\\n⚠️ 免運訂單和一般訂單不能合併，預約配送也不能跟一般訂單合併喔。\\n\\n還有其他問題嗎？隨時問我～"';

if (whCode.indexOf(oldMergeZH) > -1) {
  whCode = whCode.replace(oldMergeZH, newMergeZH);
  whChanges++;
  console.log("✅ [3] 합배송 zh-TW 텍스트 축소 + 자연스럽게");
}

// 2-B) ko 합배송 텍스트
var oldMergeKO = '"ko": "합배송은 마이페이지에서 직접 신청할 수 있어요!\\n\\n" +\n' +
  '          "신청 링크: https://www.veasly.com/tw/my-page/orders/combined-shipping/request\\n\\n" +\n' +
  '          "주의사항:\\n" +\n' +
  '          "- 주문 내 상품이 아직 한국 창고에 도착하지 않았을 때만 신청 가능\\n" +\n' +
  '          "- 모든 상품이 창고에 도착하면 자동으로 포장 절차에 들어가 합배송 불가\\n" +\n' +
  '          "- 합배송 후 운임은 실제 중량/부피/사이즈로 재계산, 반드시 저렴하지 않을 수 있음\\n" +\n' +
  '          "- 대형/파손 위험/특수 포장 상품은 합배송 불가할 수 있음"';

var newMergeKO = '"ko": "합배송은 여기서 바로 신청할 수 있어요～\\nhttps://www.veasly.com/tw/my-page/orders/combined-shipping/request\\n\\n창고에 아직 안 도착한 상품이 있으면 신청 가능! 합배송 후 운임은 재계산돼서 차액은 환불/추가결제 처리됩니다.\\n⚠️ 무료배송+일반배송, 예약배송+일반배송은 합배송 불가예요.\\n\\n다른 궁금한 거 있으면 말씀해주세요~"';

if (whCode.indexOf(oldMergeKO) > -1) {
  whCode = whCode.replace(oldMergeKO, newMergeKO);
  whChanges++;
  console.log("✅ [4] 합배송 ko 텍스트 축소 + 자연스럽게");
}

// 2-C) en 합배송 텍스트
var oldMergeEN = '"en": "You can request combined shipping from My Page!\\n\\n" +\n' +
  '          "Link: https://www.veasly.com/tw/my-page/orders/combined-shipping/request\\n\\n" +\n' +
  '          "Notes:\\n" +\n' +
  '          "- Only available while at least one item has not yet arrived at the Korea warehouse\\n" +\n' +
  '          "- Once all items arrive, packaging begins automatically\\n" +\n' +
  '          "- Fees are recalculated based on actual weight and dimensions - not always cheaper"';

var newMergeEN = '"en": "You can request combined shipping here~\\nhttps://www.veasly.com/tw/my-page/orders/combined-shipping/request\\n\\nAvailable as long as at least one item hasn\'t arrived at our Korea warehouse yet! Fees are recalculated after combining - difference will be refunded or charged.\\n⚠️ Free-shipping orders can\'t be combined with regular orders.\\n\\nAnything else I can help with?"';

if (whCode.indexOf(oldMergeEN) > -1) {
  whCode = whCode.replace(oldMergeEN, newMergeEN);
  whChanges++;
  console.log("✅ [5] 합배송 en 텍스트 축소 + 자연스럽게");
}

fs.writeFileSync(whFile, whCode, "utf8");
console.log("   webhook.js: " + whChanges + "개 변경");

console.log("\n✅ 총 " + (aiChanges + whChanges) + "개 변경 완료");
