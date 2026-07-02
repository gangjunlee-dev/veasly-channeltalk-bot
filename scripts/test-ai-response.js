require('dotenv').config({ path: '/home/ubuntu/veasly-channeltalk-bot/.env' });
var aiEngine = require('/home/ubuntu/veasly-channeltalk-bot/lib/ai-engine');

async function test() {
  await aiEngine.initializeAI();
  console.log("AI 초기화 완료\n");

  var testCases = [
    { q: "合併寄送後多的運費會退嗎？", label: "합배송 환불 (정확한 정책 답변해야 함)" },
    { q: "可以用點數換現金嗎？", label: "포인트 현금교환 (프롬프트에 없음 → 상담사 연결)" },
    { q: "國際運費怎麼算？", label: "배송비 계산 (TWD 310 정확히 답해야 함)" },
    { q: "我的訂單什麼時候會到？", label: "배송 시간 (구체 날짜 지어내면 안 됨)" },
    { q: "退貨的話退款要多久？", label: "환불 기간 (3-14 영업일, 구체 날짜 X)" }
  ];

  for (var i = 0; i < testCases.length; i++) {
    var tc = testCases[i];
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📝 테스트 " + (i+1) + ": " + tc.label);
    console.log("   질문: " + tc.q);
    var result = await aiEngine.generateAnswer(tc.q, "zh-TW", "test-chat-" + i, []);
    if (result) {
      console.log("   답변: " + result.answer);
      console.log("   신뢰도: " + result.confidence.toFixed(3));
    } else {
      console.log("   답변: NULL (에러 또는 미응답)");
    }
    console.log("");
  }
}

test().catch(function(e) { console.error("에러:", e.message); });
