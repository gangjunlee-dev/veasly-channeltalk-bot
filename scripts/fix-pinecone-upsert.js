require('dotenv').config({ path: '/home/ubuntu/veasly-channeltalk-bot/.env' });

async function fix() {
  var { Pinecone } = require('@pinecone-database/pinecone');
  var { GoogleGenerativeAI } = require('@google/generative-ai');

  var genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  var embModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var index = pc.index(process.env.PINECONE_INDEX || 'veasly-cs');

  var correctFAQ = "Q: 合併配送後運費會退嗎？怎麼申請？\n" +
    "A: 合併配送須由客戶自行在訂單頁面的「我的頁面」申請，客服無法代為操作。\n" +
    "申請連結：https://www.veasly.com/tw/my-page/orders/combined-shipping/request\n" +
    "申請條件：訂單內須有尚未到達韓國倉庫的商品。所有商品都已到倉則無法申請。\n" +
    "運費處理：合併後依總重量重新計算國際運費，多收的部分退還、少收的部分會請求補繳差額。\n" +
    "不可合併的情況：免運訂單與一般配送訂單不可合併，預約配送訂單與一般配送訂單不可合併。\n" +
    "注意：合併後不一定比分開寄送便宜，視實際重量和材積重量而定。";

  console.log("=== 임베딩 생성 ===");
  var embResult = await embModel.embedContent(correctFAQ);
  var vector = embResult.embedding.values;
  console.log("벡터 길이:", vector.length);

  console.log("\n=== FAQ 삽입 (records 형식) ===");
  await index.namespace("faq").upsert({ records: [
    {
      id: 'official-faq-merge-shipping-policy',
      values: vector,
      metadata: { text: correctFAQ, category: 'shipping', source: 'official' }
    }
  ]});
  console.log("✅ 삽입 완료");

  // 검증
  console.log("\n=== 검증: 합배송 검색 ===");
  var testEmb = await embModel.embedContent("合併寄送後多的運費會退嗎");
  var testVector = testEmb.embedding.values;
  var verify = await index.namespace("faq").query({ vector: testVector, topK: 3, includeMetadata: true });
  (verify.matches || []).forEach(function(m, i) {
    console.log("[" + (i+1) + "] score:" + m.score.toFixed(3) + " id:" + m.id);
    console.log("   " + (m.metadata.text || "").substring(0, 150));
    console.log("");
  });
}

fix().catch(function(e) { console.error("에러:", e.message); });
