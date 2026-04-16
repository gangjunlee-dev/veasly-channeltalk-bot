require('dotenv').config();
var { GoogleGenerativeAI } = require('@google/generative-ai');
var { Pinecone } = require('@pinecone-database/pinecone');

var AI_ENABLED = false;
var genAI = null;
var model = null;
var pineconeIndex = null;

var SYSTEM_PROMPTS = {
  'zh-TW': '你是 VEASLY 的智能客服助手「Veasly小幫手」。\n\n【公司資訊】\nVEASLY 是韓國趨勢商品代購平台，專門服務台灣客戶，提供韓國美妝、服飾、偶像周邊、3C配件等商品代購。支援 BUNJANG 等韓國二手平台商品代購。\n\n【服務特色】\n- 免代購手續費（已含在商品價格中）\n- 國際運費透明計算（依實際重量或材積重量）\n- 免運優惠：僅限標示「免運」的商品才適用。購買免運商品達TWD 4,999以上享5kg免運、TWD 9,999以上享10kg免運、TWD 14,999以上享15kg免運，以此類推每增加TWD 5,000多5kg。達到免運門檻後，同訂單內非免運商品也可一起享受免運額度。非免運商品單獨購買不適用免運優惠\n- 支援信用卡、LINE Pay、超商付款\n- 通關需完成 EZ WAY 實名認證\n\n【回答規則】\n1. 請用繁體中文回答，語氣像朋友一樣親切自然，適當使用「喔」「呢」「囉」等語助詞\n2. 回答控制在150字以內，簡潔有力\n3. 金額一律用 TWD 表示\n4. 不要使用「根據資料」「根據我的資訊」等機器人口吻\n5. 不確定的資訊請說「這部分我幫您確認一下，先為您轉接客服人員喔」\n6. 不要用 markdown 格式（不要用 * 或 ** 或 # 等符號）\n7. 回答要直接解決客戶問題，不要繞圈子
12. 語氣友善但專業，不要過度興奮或使用太多感嘆號、「是不是很棒」等誇張表達\n8. 客戶的點數(credit)請稱為「點數」或「포인트」，不是TWD，點數是獨立的獎勵單位\n9. 絕對不要捏造具體日期、出貨時間、海關狀態等資訊。如果系統沒有提供具體數據，就不要編造\n10. 配送相關問題：只能引用系統提供的訂單狀態，不能自己推測配送進度、出貨日期或海關情況\n11. 如果客戶問的問題超出你所擁有的資料範圍，請回答「這部分我幫您確認一下，先為您轉接客服人員喔」',
  'ko': '당신은 VEASLY의 고객 상담 도우미 「Veasly 도우미」입니다.\n\n【회사 정보】\nVEASLY는 한국 트렌드 상품 역직구 플랫폼으로, 대만 고객에게 한국 뷰티, 패션, 아이돌 굿즈, IT 액세서리 등을 제공합니다. 번개장터 등 중고 플랫폼 상품도 대행합니다.\n\n【답변 규칙】\n1. 한국어로 친절하게 답변 (150자 이내)\n2. 금액은 TWD로 표시\n3. 확실하지 않으면 "담당자를 연결해 드리겠습니다"라고 답변\n4. 마크다운 서식 사용 금지\n5. 고객 문제를 직접 해결하는 답변\n6. 절대 구체적인 날짜, 출고 시간, 세관 상태 등을 지어내지 마세요. 시스템이 제공하지 않은 데이터는 만들지 마세요\n7. 배송 관련 질문: 시스템이 제공한 주문 상태만 인용하고, 배송 진행 상황이나 출고 날짜를 추측하지 마세요\n8. 확실하지 않으면 반드시 "담당자를 연결해 드리겠습니다"라고 답변하세요',
  'en': "You are VEASLY's customer support assistant.\n\nVEASLY is a Korean trend product purchasing platform serving mainly Taiwanese customers. We offer Korean beauty, fashion, K-pop merchandise, and tech accessories. We also handle purchases from Korean secondhand platforms like BUNJANG.\n\nRules:\n1. Reply in English, friendly and concise (under 100 words)\n2. Use TWD for prices\n3. If unsure, say \"Let me connect you with our support team\"\n4. No markdown formatting\n5. Be direct and helpful\n6. NEVER fabricate specific dates, shipping times, customs status, or any data not provided by the system\n7. For shipping questions: only cite the order status provided by the system. Do not guess delivery progress\n8. If unsure, ALWAYS say 'Let me connect you with our support team'",
  'ja': 'あなたはVEASLYのカスタマーサポート「Veaslyアシスタント」です。\n\nVEASLYは韓国トレンド商品の購買代行プラットフォームで、主に台湾のお客様にサービスを提供しています。\n\n【ルール】\n1. 日本語で親切に回答（150文字以内）\n2. 金額はTWDで表示\n3. 不明な場合は「担当者におつなぎします」\n4. マークダウン書式は使用しない\n5. お客様の問題を直接解決する回答\n6. 具体的な日付、出荷時間、税関状況などを絶対に捏造しないでください\n7. 配送関連の質問：システムが提供した注文状況のみを引用してください\n8. 不明な場合は必ず「担当者におつなぎします」と回答してください'
};
async function initializeAI() {
  try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    var indexName = process.env.PINECONE_INDEX_NAME || 'veasly-cs';
    var desc = await pc.describeIndex(indexName);
    pineconeIndex = pc.index({ host: desc.host });
    AI_ENABLED = true;
    console.log('[AI] Initialized successfully - Gemini 2.5 Flash + Pinecone (' + desc.host + ')');
  } catch (err) {
    AI_ENABLED = false;
    console.error('[AI] Init failed:', err.message);
  }
}

async function getQueryEmbedding(text) {
  var embModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  var result = await embModel.embedContent({ content: { parts: [{ text: text }] }, taskType: 'RETRIEVAL_QUERY' });
  return result.embedding.values;
}

async function getEmbedding(text) {
  var embModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  var result = await embModel.embedContent({ content: { parts: [{ text: text }] }, taskType: 'RETRIEVAL_DOCUMENT' });
  return result.embedding.values;
}

async function generateAnswer(userMessage, language, chatId, chatHistory) {
  if (!AI_ENABLED) return null;
  try {
    var queryVector = await getQueryEmbedding(userMessage);
    var results = await Promise.all([
      pineconeIndex.namespace("faq").query({ vector: queryVector, topK: 3, includeMetadata: true }),
      pineconeIndex.namespace("manager").query({ vector: queryVector, topK: 2, includeMetadata: true }).catch(function(){ return {matches:[]}; }),
      pineconeIndex.namespace("site").query({ vector: queryVector, topK: 2, includeMetadata: true }).catch(function(){ return {matches:[]}; })
    ]);
    var faqResult = results[0]; var mgrResult = results[1]; var siteResult = results[2];
    var allMatches = (faqResult.matches||[]).concat(mgrResult.matches||[]).concat(siteResult.matches||[]);
    var context = "";
    if (allMatches.length > 0) { context = allMatches.map(function(m) { return m.metadata.text || ""; }).join("\n---\n"); }
    var systemPrompt = SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS['zh-TW'];
    var historyText = "";
    if (chatHistory && chatHistory.length > 0) {
      historyText = "\n\n이전 대화 내용 (최근 순):\n" + chatHistory.map(function(h) {
        return (h.role === "user" ? "고객: " : "봇: ") + h.text;
      }).join("\n") + "\n";
    }
    var prompt = systemPrompt + '\n\n참고자료:\n' + context + historyText + '\n\n고객 최신 질문: ' + userMessage;
    var result = await model.generateContent(prompt);
    var answer = result.response.text();
    if (answer && answer.trim().length > 0) {
      var topScore = allMatches.length > 0 ? allMatches[0].score : 0;
      console.log('[AI] Generated answer for chatId:', chatId, '| confidence:', topScore.toFixed(3));
      return { answer: answer.trim(), confidence: topScore };
    }
    return null;
  } catch (err) {
    console.error('[AI] generateAnswer error:', err.message);
    return null;
  }
}

async function addToKnowledgeBase(id, text, metadata) {
  if (!AI_ENABLED) return;
  try {
    var vector = await getEmbedding(text);
    var ns = (metadata && metadata.namespace) || 'faq';
    await pineconeIndex.namespace(ns).upsert({ records: [{ id: id, values: vector, metadata: Object.assign({ text: text }, metadata || {}) }] });
    console.log('[AI] Added to knowledge base:', id);
  } catch (err) {
    console.error('[AI] addToKnowledgeBase error:', err.message);
  }
}

function isReady() { return AI_ENABLED; }

module.exports = { initializeAI, generateAnswer, getEmbedding, getQueryEmbedding, addToKnowledgeBase, isReady };
