require('dotenv').config({ path: '/home/ubuntu/veasly-channeltalk-bot/.env' });

async function fix() {
  var { Pinecone } = require('@pinecone-database/pinecone');
  var { GoogleGenerativeAI } = require('@google/generative-ai');

  var genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  var embModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var index = pc.index(process.env.PINECONE_INDEX || 'veasly-cs');

  // 1) 잘못된 FAQ 데이터 삭제 (하나씩)
  var faqDeleteIds = [
    'auto_esc_merge_shipping_1778500888268_1',
    'auto_esc_merge_shipping_1778781615998_0',
    'auto_faq_shipping_1778868041889_4',
    'auto_faq_shipping_1778781640894_2'
  ];

  console.log("=== 1단계: 잘못된 FAQ 삭제 ===");
  for (var i = 0; i < faqDeleteIds.length; i++) {
    try {
      await index.namespace("faq").deleteOne(faqDeleteIds[i]);
      console.log("  삭제: " + faqDeleteIds[i]);
    } catch(e) {
      // deleteOne 없으면 다른 방식 시도
      console.log("  deleteOne 실패, ids 배열 방식 시도");
      break;
    }
  }
  // ids 배열 방식
  try {
    await index.namespace("faq")['delete']({ ids: faqDeleteIds });
    console.log("✅ FAQ 4개 삭제 완료 (ids 방식)");
  } catch(e2) {
    console.log("  ids 방식도 실패:", e2.message);
    // 최후 수단: deleteMany with ids array
    try {
      await index.namespace("faq").deleteMany({ ids: faqDeleteIds });
      console.log("✅ FAQ 4개 삭제 완료 (deleteMany ids 방식)");
    } catch(e3) {
      console.log("  deleteMany ids도 실패:", e3.message);
    }
  }

  // 2) manager namespace 삭제
  var mgrDeleteIds = [
    'mgr_69eba50b5635efdb07dc_1777263123646',
    'mgr_69e5aa3a70787f60f8d3_1776761894218'
  ];

  console.log("\n=== 2단계: 매니저 답변 삭제 ===");
  try {
    await index.namespace("manager")['delete']({ ids: mgrDeleteIds });
    console.log("✅ manager 2개 삭제 완료");
  } catch(e) {
    try {
      await index.namespace("manager").deleteMany({ ids: mgrDeleteIds });
      console.log("✅ manager 2개 삭제 완료 (deleteMany)");
    } catch(e2) {
      console.log("  manager 삭제 실패:", e2.message);
    }
  }

  // 3) 정확한 합배송 FAQ 삽입
  console.log("\n=== 3단계: 정확한 FAQ 삽입 ===");
  var correctFAQ = "Q: 合併配送後運費會退嗎？怎麼申請？\n" +
    "A: 合併配送須由客戶自行在訂單頁面的「我的頁面」申請，客服無法代為操作。\n" +
    "申請連結：https://www.veasly.com/tw/my-page/orders/combined-shipping/request\n" +
    "申請條件：訂單內須有尚未到達韓國倉庫的商品。所有商品都已到倉則無法申請。\n" +
    "運費處理：合併後依總重量重新計算國際運費，多收的部分退還、少收的部分會請求補繳差額。\n" +
    "不可合併的情況：免運訂單與一般配送訂單不可合併，預約配送訂單與一般配送訂單不可合併。\n" +
    "注意：合併後不一定比分開寄送便宜，視實際重量和材積重量而定。";

  var embResult = await embModel.embedContent(correctFAQ);
  var vector = embResult.embedding.values;

  await index.namespace("faq").upsert([{
    id: 'official-faq-merge-shipping-policy',
    values: vector,
    metadata: { text: correctFAQ, category: 'shipping', source: 'official' }
  }]);
  console.log("✅ official-faq-merge-shipping-policy 삽입 완료");

  // 4) 검증
  console.log("\n=== 4단계: 검증 ===");
  var testEmb = await embModel.embedContent("合併寄送後多的運費會退嗎");
  var testVector = testEmb.embedding.values;
  var verify = await index.namespace("faq").query({ vector: testVector, topK: 3, includeMetadata: true });
  (verify.matches || []).forEach(function(m, i) {
    console.log("[" + (i+1) + "] score:" + m.score.toFixed(3) + " id:" + m.id);
    console.log("   " + (m.metadata.text || "").substring(0, 120));
    console.log("");
  });
}

fix().catch(function(e) { console.error("최종 에러:", e.message); });
