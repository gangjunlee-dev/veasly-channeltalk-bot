require('dotenv').config({ path: '/home/ubuntu/veasly-channeltalk-bot/.env' });

async function fix() {
  var { Pinecone } = require('@pinecone-database/pinecone');
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var index = pc.index(process.env.PINECONE_INDEX || 'veasly-cs');

  // 1) 남은 부정확한 데이터 삭제
  console.log("=== 추가 삭제 ===");
  await index.namespace("faq").deleteMany({ ids: ['auto_esc_merge_shipping_1778781617447_1'] });
  console.log("✅ 삭제 완료");

  // 2) AI 답변 테스트
  console.log("\n=== AI 답변 테스트 ===");
  var aiEngine = require('/home/ubuntu/veasly-channeltalk-bot/lib/ai-engine');
  await aiEngine.initializeAI();

  var tests = [
    { q: "合併寄送後多的運費會退嗎？", label: "합배송 환불 (정확한 정책만)" },
    { q: "可以用點數換現金嗎？", label: "포인트 현금교환 (상담사 연결)" },
    { q: "國際運費怎麼算？", label: "배송비 (TWD 310)" }
  ];

  for (var i = 0; i < tests.length; i++) {
    console.log("\n━━━━━━━━━━━━━━━━━━━━");
    console.log("📝 " + tests[i].label);
    console.log("   Q: " + tests[i].q);
    var r = await aiEngine.generateAnswer(tests[i].q, "zh-TW", "cleanup-test-" + i, []);
    if (r) {
      console.log("   A: " + r.answer);
      console.log("   score: " + r.confidence.toFixed(3));
    } else {
      console.log("   A: NULL");
    }
  }
}

fix().catch(function(e) { console.error("에러:", e.message); });
