var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/lib/ai-engine.js";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// 1) zh-TW 프롬프트에 합병 배송 정책 추가
// 기존: "合併配送費率相同，無最大重量限制，離島無額外費用"
var oldMerge = "合併配送費率相同，無最大重量限制，離島無額外費用";
var newMerge = "合併配送：客戶須自行在訂單頁面申請，客服無法代為操作。合併後依總重量重新計算運費，多收退還、少收補繳差額。申請條件：訂單內須有尚未到達倉庫的商品。不可合併的情況：免運訂單與一般配送訂單不可合併，預約配送訂單與一般配送訂單不可合併。離島無額外費用";

if (code.indexOf(oldMerge) > -1) {
  code = code.replace(oldMerge, newMerge);
  changes++;
  console.log("✅ [1] 합병 배송 정책 교체 완료");
}

// 2) hallucination 방지 규칙 강화 (규칙 7번 뒤에 12번 추가)
var oldRule11 = "11. 【語言規則】必須用繁體中文回答台灣客戶，絕對不可用韓文回覆";
var newRule11 = "11. 【語言規則】必須用繁體中文回答台灣客戶，絕對不可用韓文回覆\\n12. 【嚴禁捏造】涉及系統功能、操作步驟、退款流程、帳戶機制等，只能回答本prompt中明確寫到的內容。若prompt未提及，一律回答「這部分我幫您確認一下，先為您轉接客服人員喔」並觸發轉接。絕對禁止自行推測、編造任何流程或功能";

if (code.indexOf(oldRule11) > -1) {
  code = code.replace(oldRule11, newRule11);
  changes++;
  console.log("✅ [2] hallucination 방지 규칙 12번 추가");
}

// 3) 배송 키워드 자동 보충 문구도 수정 (line 127 근처)
var oldSupp = "補充：VEASLY國際運費為0~1公斤TWD 310（固定費率），以實際重量和材積重量中較高者為準。";
var newSupp = "補充：VEASLY國際運費為0~1公斤TWD 310（固定費率），以實際重量和材積重量中較高者為準。合併配送須由客戶自行在訂單頁面申請。";

if (code.indexOf(oldSupp) > -1) {
  code = code.replace(oldSupp, newSupp);
  changes++;
  console.log("✅ [3] 배송 보충 문구에 합병 안내 추가");
}

// 4) ko 프롬프트에도 동일 정책 추가
var oldKoShip = "11. 【국제배송비】0~1kg TWD 310 고정. 0.5kg 단위 과금 없음";
var newKoShip = "11. 【국제배송비】0~1kg TWD 310 고정. 0.5kg 단위 과금 없음\\n12. 【합배송】고객이 직접 주문 페이지에서 신청해야 함. 합배송 후 총중량 기준 재계산하여 차액 환불/추가결제. 조건: 창고 미도착 상품 포함 시만 가능. 무료배송+일반배송, 예약배송+일반배송은 합배송 불가\\n13. 【환각금지】프롬프트에 명시되지 않은 시스템 기능/프로세스를 절대 지어내지 마세요. 모르면 상담사 연결";

if (code.indexOf(oldKoShip) > -1) {
  code = code.replace(oldKoShip, newKoShip);
  changes++;
  console.log("✅ [4] ko 프롬프트에 합배송 + 환각금지 규칙 추가");
}

fs.writeFileSync(file, code, "utf8");
console.log("\n✅ 총 " + changes + "개 변경 완료");
