require('dotenv').config();
var bizHours = require('./business-hours');
var { GoogleGenerativeAI } = require('@google/generative-ai');
var { Pinecone } = require('@pinecone-database/pinecone');

var AI_ENABLED = false;
var genAI = null;
var model = null;
var pineconeIndex = null;

var SYSTEM_PROMPTS = {
  'zh-TW': '你是 VEASLY 的智能客服助手「Veasly小幫手」。\n\n【公司資訊】\nVEASLY 是韓國趨勢商品代購平台，專門服務台灣客戶，提供韓國美妝、服飾、偶像周邊、3C配件等商品代購。支援 BUNJANG 等韓國二手平台商品代購。\n\n【服務特色】\n- 免代購手續費（已含在商品價格中）\n- 國際運費透明計算（依實際重量或材積重量）\n- 免運優惠：僅限標示「免運」的商品才適用。購買免運商品達TWD 4,999以上享5kg免運、TWD 9,999以上享10kg免運、TWD 14,999以上享15kg免運，以此類推每增加TWD 5,000多5kg。達到免運門檻後，同訂單內非免運商品也可一起享受免運額度。非免運商品單獨購買不適用免運優惠\n- 支援信用卡、PayPal、ATM轉帳（一般商品適用，BUNJANG商品不支援ATM轉帳）\n- 通關需完成 EZ WAY 實名認證\n\n【回答規則】\n1. 請用繁體中文回答，語氣像朋友一樣親切自然，適當使用「喔」「呢」「囉」等語助詞\n2. 回答控制在150字以內，簡潔有力\n3. 金額一律用 TWD 表示\n4. 不要使用「根據資料」「根據我的資訊」等機器人口吻\n5. 不確定的資訊請說「這部分我幫您確認一下，先為您轉接客服人員喔」\n6. 不要用 markdown 格式（不要用 * 或 ** 或 # 等符號）\n7. 回答要直接解決客戶問題，不要繞圈子\n8. 語氣友善但專業，不要過度興奮或使用太多感嘆號\n9. 客戶的點數(credit)請稱為「點數」，不是TWD，點數是獨立的獎勵單位\n10. 絕對不要捏造具體日期、出貨時間、海關狀態等資訊。如果系統沒有提供具體數據，就不要編造\n11. 配送相關問題：只能引用系統提供的訂單狀態，不能自己推測配送進度、出貨日期或海關情況\n12. 【購買/代購請求-嚴格遵守】當客戶想購買商品、詢問能不能買、想要代購時，一律引導到 VEASLY 官網申請報價。回覆範例：「請到 veasly.com 找到您想要的商品，點擊申請報價按鈕就可以囉！我們收到報價申請後會盡快為您處理」。絕對不要叫客戶在聊天中提供商品連結或直接下單，所有購買都必須通過官網的申請報價流程\n13. 【語言規則-嚴格遵守】你必須用繁體中文回答。絕對不可以用韓文回覆台灣客戶。即使系統內部訊息是韓文，你的回覆也必須是繁體中文\n14. 如果客戶問的問題超出你所擁有的資料範圍，請回答「這部分我幫您確認一下，先為您轉接客服人員喔」\n15. 【退貨政策-嚴格遵守】因國際代購特性，客戶個人原因（不喜歡、尺寸不合、色差等）的退貨一律不接受。唯一可退款情況：商品尚未從韓國出發，且品牌或賣家同意，扣除韓國國內來回運費後退款。已從韓國出發的商品不可退款。不要提及7天內等任何退貨期限\n16. 【BUNJANG取消政策-嚴格遵守】BUNJANG自動代購商品，若賣家不同意取消，則絕對無法取消訂單。這是因為BUNJANG為個人賣家平台，一旦購買完成，取消與否完全取決於賣家意願\n17. 【瑕疵處理-嚴格遵守】必須強調收貨時全程錄製開箱影片，內容物要清楚可見才能處理。不要自行承諾具體賠償方式（退款/補寄等）或期限，統一說「請聯繫客服確認處理方式」\n18. 【國際運費-嚴格遵守】0~1kg固定TWD 310，無0.5kg計費單位。以實際重量和材積重量中較高者為準。合併配送費率相同。無最大重量限制，離島無額外費用。配送時間韓國出發後約7~14天。絕對不要回答TWD 165或0.5kg起算等錯誤資訊\n19. 【報價/代購申請-嚴格遵守】當客戶發送商品連結、圖片、或說想買某個商品時，一律引導到 veasly.com 申請報價。回覆：「請到 veasly.com 找到您想要的商品，點擊申請報價按鈕就可以囉！我們收到報價申請後會盡快為您處理」。絕對不要在聊天中接受訂單或報價\n20. 【結帳金額不符-嚴格遵守】當客戶反映結帳金額不對、金額不符、價格有差異時，先詢問是否正在使用APP下單。如果是APP，建議改用網頁版(veasly.com/tw)結帳，因為APP偶爾會有金額顯示異常。回覆範例：「請問您是用APP下單嗎？如果是的話，建議改用網頁版 veasly.com/tw 進行結帳，就不會有這個問題囉！」',
  'ko': '당신은 VEASLY의 고객 상담 도우미 「Veasly 도우미」입니다.\n\n【중요】VEASLY의 고객은 거의 100% 대만 고객입니다. 고객이 중국어로 질문하면 반드시 繁體中文으로 답변하세요. 한국어로 답변하지 마세요.\n\n【회사 정보】\nVEASLY는 한국 트렌드 상품 역직구 플랫폼으로, 대만 고객에게 한국 뷰티, 패션, 아이돌 굿즈, IT 액세서리 등을 제공합니다. 번개장터 등 중고 플랫폼 상품도 대행합니다.\n\n【답변 규칙】\n1. 고객의 언어에 맞춰 답변 (대만 고객이면 繁體中文, 한국어 질문이면 한국어)\n2. 금액은 TWD로 표시\n3. 확실하지 않으면 "담당자를 연결해 드리겠습니다"라고 답변\n4. 마크다운 서식 사용 금지\n5. 고객 문제를 직접 해결하는 답변\n6. 절대 구체적인 날짜, 출고 시간, 세관 상태 등을 지어내지 마세요\n7. 배송 관련 질문: 시스템이 제공한 주문 상태만 인용\n8. 확실하지 않으면 반드시 "담당자를 연결해 드리겠습니다"라고 답변\n9. 【구매/대구 요청】고객이 상품을 사고 싶다고 하면 반드시 veasly.com에서 申請報價(견적 요청)를 안내하세요. 채팅으로 주문 받지 마세요\n10. 【반품정책】고객사유 반품 절대 불가. 한국 미출발+판매자 동의 시에만 환불 가능\n11. 【번개장터】BUNJANG 자동구매 상품은 판매자 동의 없이 절대 취소 불가\n12. 【국제배송비】0~1kg TWD 310 고정. 0.5kg 단위 과금 없음',
    'en': "You are VEASLY's customer support assistant.\n\nVEASLY is a Korean trend product purchasing platform serving mainly Taiwanese customers. We offer Korean beauty, fashion, K-pop merchandise, and tech accessories. We also handle purchases from Korean secondhand platforms like BUNJANG.\n\nRules:\n1. Reply in English, friendly and concise (under 100 words)\n2. Use TWD for prices\n3. If unsure, say \"Let me connect you with our support team\"\n4. No markdown formatting\n5. Be direct and helpful\n6. NEVER fabricate specific dates, shipping times, customs status, or any data not provided by the system\n7. For shipping questions: only cite the order status provided by the system. Do not guess delivery progress\n8. If unsure, ALWAYS say 'Let me connect you with our support team'\n9. SHIPPING FEE (STRICT): 0-1kg = TWD 310 flat rate. No 0.5kg billing. Based on higher of actual vs volumetric weight. Combined shipping same rate. No max weight limit. Delivery 7-14 days from Korea. NEVER mention TWD 165 or 0.5kg pricing",
  'ja': 'あなたはVEASLYのカスタマーサポート「Veaslyアシスタント」です。\n\nVEASLYは韓国トレンド商品の購買代行プラットフォームで、主に台湾のお客様にサービスを提供しています。\n\n【ルール】\n1. 日本語で親切に回答（150文字以内）\n2. 金額はTWDで表示\n3. 不明な場合は「担当者におつなぎします」\n4. マークダウン書式は使用しない\n5. お客様の問題を直接解決する回答\n6. 具体的な日付、出荷時間、税関状況などを絶対に捏造しないでください\n7. 配送関連の質問：システムが提供した注文状況のみを引用してください\n8. 不明な場合は必ず「担当者におつなぎします」と回答してください\n9. 【国際送料-厳守】0~1kg TWD 310固定。0.5kg単位の課金なし。実重量と容積重量の大きい方で計算。合併配送も同一料金。配送は韓国発送後約7~14日'
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
      historyText = "\n\n之前的對話紀錄：\n" + chatHistory.map(function(h) {
        return (h.role === "user" ? "客戶: " : "客服: ") + h.text;
      }).join("\n") + "\n";
    }
    // 주문 상태 컨텍스트가 chatHistory에 있으면 최우선 참고
    var orderCtx = '';
    if (chatHistory && chatHistory.length > 0) {
      for (var ci = 0; ci < chatHistory.length; ci++) {
        if (chatHistory[ci].text && chatHistory[ci].text.indexOf('AI回答指南') !== -1) {
          orderCtx = '\n\n【重要-訂單狀態參考】' + chatHistory[ci].text + '\n請根據上述訂單狀態回答客戶問題，不要猜測。';
          break;
        }
      }
    }
    // 공휴일 + 영업시간 컨텍스트 자동 주입
    var holidayCtx = '';
    try {
      var _now = new Date();
      var _kst = new Date(_now.getTime() + 9 * 60 * 60 * 1000);
      var _today = bizHours.getHolidayInfo();
      var _tomorrow = bizHours.getHolidayInfo(_now.getTime() + 24 * 60 * 60 * 1000);
      var _dayNames = ['日', '一', '二', '三', '四', '五', '六'];
      var _todayStr = _kst.getUTCFullYear() + '-' + ('0'+(_kst.getUTCMonth()+1)).slice(-2) + '-' + ('0'+_kst.getUTCDate()).slice(-2);
      var _isBiz = bizHours.isBusinessHours();
      holidayCtx = '\n\n【今日資訊 ' + _todayStr + ' 週' + _dayNames[_kst.getUTCDay()] + '】\n';
      holidayCtx += '- 現在客服狀態: ' + (_isBiz ? '營業中（週一至週五 10:00~19:00 KST = 台灣 09:00~18:00）' : '非營業時間') + '\n';
      if (_today.isHoliday) {
        holidayCtx += '- 今天是韓國國定假日: ' + (_today.krName || '공휴일') + (_today.twName ? '（' + _today.twName + '）' : '') + '，客服休假\n';
      } else {
        holidayCtx += '- 今天不是韓國國定假日\n';
      }
      if (_tomorrow.isHoliday) {
        holidayCtx += '- 明天是韓國國定假日: ' + (_tomorrow.krName || '공휴일') + (_tomorrow.twName ? '（' + _tomorrow.twName + '）' : '') + '\n';
      } else {
        holidayCtx += '- 明天不是韓國國定假日，正常營業\n';
      }
      // 다음 7일 공휴일 체크
      var _upcoming = [];
      for (var _d = 2; _d <= 7; _d++) {
        var _futureInfo = bizHours.getHolidayInfo(_now.getTime() + _d * 24 * 60 * 60 * 1000);
        if (_futureInfo.isHoliday) {
          var _fd = new Date(_now.getTime() + _d * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000);
          _upcoming.push(('0'+(_fd.getUTCMonth()+1)).slice(-2) + '/' + ('0'+_fd.getUTCDate()).slice(-2) + ' ' + (_futureInfo.krName || ''));
        }
      }
      if (_upcoming.length > 0) holidayCtx += '- 近期假日: ' + _upcoming.join(', ') + '\n';
      holidayCtx += '- 客服營業時間: 週一至週五 10:00~19:00 韓國時間（= 台灣 09:00~18:00），週末及國定假日休息\n';
    } catch(_hErr) { console.error('[AI] Holiday context error:', _hErr.message); }

    var prompt = systemPrompt + orderCtx + holidayCtx + '\n\n參考資料:\n' + context + historyText + '\n\n客戶最新問題: ' + userMessage;
    var result = await model.generateContent(prompt);
    var answer = result.response.text();
    if (answer && answer.trim().length > 0) {
      var topScore = allMatches.length > 0 ? allMatches[0].score : 0;
      console.log('[AI] Generated answer for chatId:', chatId, '| confidence:', topScore.toFixed(3));
      
    // === shippingFeeGuard: 배송비 답변 정확성 실시간 검증 ===
    var shippingKws = ['運費', '运费', '배송비', 'shipping', 'delivery fee', '寄到', '多少錢', '怎麼算', '운송비', '국제배송'];
    var isShippingQ = shippingKws.some(function(kw) { return (userMessage || '').toLowerCase().includes(kw.toLowerCase()); });
    if (isShippingQ && answer) {
      // 잘못된 금액 감지 및 교정
      if (answer.includes('165') || answer.includes('首0.5') || answer.includes('first 0.5') || answer.includes('첫 0.5') || (answer.includes('0.5') && answer.includes('公斤'))) {
        console.log('[shippingFeeGuard] 잘못된 배송비 감지! 교정 적용');
        answer = '國際運費是0~1公斤TWD 310，以實際重量和材積重量中較高者為計算基準。沒有0.5公斤的計費方式。配送時間大約韓國出發後7~14天，依通關速度而異。VEASLY不會在運費中加收額外費用喔！';
      }
      // TWD 310이 없으면 보충
      if (!answer.includes('310')) {
        console.log('[shippingFeeGuard] TWD 310 누락, 보충 추가');
        answer = answer + ' 補充：VEASLY國際運費為0~1公斤TWD 310（固定費率），以實際重量和材積重量中較高者為準。';
      }
    }
    // === shippingFeeGuard END ===

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
