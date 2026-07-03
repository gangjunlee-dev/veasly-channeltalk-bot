require('dotenv').config({ path: '/home/ubuntu/veasly-channeltalk-bot/.env' });

async function test() {
  var { Pinecone } = require('@pinecone-database/pinecone');
  var { GoogleGenerativeAI } = require('@google/generative-ai');
  
  var genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  var embModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var indexName = process.env.PINECONE_INDEX || 'veasly-cs';
  console.log("Index name:", indexName);
  
  var index = pc.index(indexName);
  
  // 임베딩 생성
  var query = "合併寄送後多的運費會退嗎";
  var embResult = await embModel.embedContent(query);
  var vector = embResult.embedding.values;
  console.log("Vector length:", vector.length);

  console.log("\n=== FAQ namespace ===");
  var faqResults = await index.namespace("faq").query({ vector: vector, topK: 5, includeMetadata: true });
  (faqResults.matches || []).forEach(function(m, i) {
    console.log("\n[" + (i+1) + "] score:" + m.score.toFixed(3) + " id:" + m.id);
    console.log("   text:", (m.metadata && m.metadata.text ? m.metadata.text.substring(0, 250) : "N/A"));
  });

  console.log("\n\n=== manager namespace ===");
  var mgrResults = await index.namespace("manager").query({ vector: vector, topK: 3, includeMetadata: true });
  (mgrResults.matches || []).forEach(function(m, i) {
    console.log("\n[" + (i+1) + "] score:" + m.score.toFixed(3) + " id:" + m.id);
    console.log("   text:", (m.metadata && m.metadata.text ? m.metadata.text.substring(0, 250) : "N/A"));
  });

  console.log("\n\n=== site namespace ===");
  var siteResults = await index.namespace("site").query({ vector: vector, topK: 3, includeMetadata: true });
  (siteResults.matches || []).forEach(function(m, i) {
    console.log("\n[" + (i+1) + "] score:" + m.score.toFixed(3) + " id:" + m.id);
    console.log("   text:", (m.metadata && m.metadata.text ? m.metadata.text.substring(0, 250) : "N/A"));
  });
}

test().catch(function(e) { console.error("에러:", e.message, e.stack); });
