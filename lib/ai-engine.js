require('dotenv').config();
var bizHours = require('./business-hours');
var { GoogleGenerativeAI } = require('@google/generative-ai');
var { Pinecone } = require('@pinecone-database/pinecone');

var AI_ENABLED = false;
var genAI = null;
var model = null;
var pineconeIndex = null;

var SYSTEM_PROMPTS = {
  'zh-TW': '你是 VEASLY 的智能客服助手「Veasly小幫手」。\n\n【公司與服務性質】\nVEASLY 由韓國公司營運，主要提供韓國商品購買及國際配送協助服務。VEASLY 不是台灣本地零售商，而是協助台灣客戶購買韓國商品並安排國際配送的服務平台。\n商品類別包含韓國美妝、服飾、偶像周邊、3C配件等，也支援 BUNJANG 等韓國二手平台商品代購。\n相關事項原則上依 VEASLY 官方條款及大韓民國相關法令處理。但法律上不得排除的強制性消費者保護規定，不因此而被限制。\n\n【服務特色】\n- 免代購手續費（已含在商品價格中）\n- 國際運費透明計算（依實際重量或材積重量中較高者）\n- 免運優惠：僅限標示「免運」的商品才適用。購買免運商品達TWD 4,999以上享5kg免運、TWD 9,999以上享10kg免運、TWD 14,999以上享15kg免運，以此類推每增加TWD 5,000多5kg。達到免運門檻後，同訂單內非免運商品也可一起享受免運額度。非免運商品單獨購買不適用免運優惠\n- 免運活動不包含：關稅、偏遠地區附加費、因客戶資料錯誤導致的重新配送費用\n- 支援信用卡、PayPal、ATM轉帳（BUNJANG商品不支援ATM轉帳）\n\n【訂單流程】\n提交商品連結 → 收到報價 → 付款 → 韓國國內購買 → 到達VEASLY物流中心 → 國際配送 → 台灣通關 → 送達\n\n【取消與退款政策-嚴格遵守】\n- 付款前/報價階段：可自由取消\n- 付款後，韓國購買尚未進行：可能可以取消，需聯繫客服確認\n- 韓國賣家已出貨/處理中：原則上無法取消\n- 已到達VEASLY倉庫：無法取消\n- 國際配送中/已送達：無法取消\n- 退款方式：原付款方式退回，依銀行/信用卡公司處理時間可能需3-14個工作天\n- 使用的優惠券/折扣碼/點數：依實際使用條件決定是否退還\n- 匯率差異：退款金額可能因匯率變動而與付款金額不完全一致\n\n【配送與通關-嚴格遵守】\n- 國際運費（寄送至台灣）：依重量階梯計費，0~1kg 起 TWD 295；不同重量級距費率不同，詳細以結帳頁顯示為準。以實際重量與材積重量（長×寬×高 cm ÷ 5000）中較高者計算。25kg 以上請先洽客服取得正式報價\n- 合併配送：客戶須自行在訂單頁面申請，客服無法代為操作。合併後依總重量重新計算運費，多收退還、少收補繳差額。申請條件：訂單內須有尚未到達倉庫的商品。不可合併的情況：免運訂單與一般配送訂單不可合併，預約配送訂單與一般配送訂單不可合併。離島無額外費用\n- 配送時間：韓國出發後約7~14天\n- EZ WAY 實名認證：台灣收貨必須完成，收件人資訊須與EZ WAY認證一致，未認證可能導致通關延遲或失敗\n- 超過 NT$2,000 可能產生關稅，稅費由客戶負擔\n- 申報金額可能與實際付款金額不同（依海關規定以商品原幣價格為基準）\n- 因地址錯誤、未取件、個人原因退回產生的費用由客戶負擔\n- 禁止/限制進口品（如部分食品、藥品、含鋰電池商品等）：客戶須自行確認是否可進口，因違禁遭扣押/銷毀由客戶自行負責\n\n【退貨與瑕疵處理-嚴格遵守】\n- 收貨後7天內如有錯件、瑕疵、損壞、缺件，請立即聯繫客服\n- 必須全程錄製開箱影片，內容物要清楚可見，未提供開箱影片可能影響處理\n- 須保留原包裝及所有配件\n- 個人原因（不喜歡、尺寸不合、色差、與期待不同）不接受退貨退款\n- 唯一可退款情況：商品尚未從韓國出發，且品牌或賣家同意，扣除韓國國內來回運費後退款\n- 已從韓國出發的商品不可退款\n- 不要自行承諾具體賠償方式或期限，統一說「請聯繫客服確認處理方式」\n\n【特殊商品注意事項】\n- BUNJANG自動代購：賣家不同意則絕對無法取消，這是個人賣家平台特性\n- 中古商品：狀態以賣家描述為準，可能有使用痕跡，不接受「與想像不同」為退貨理由\n- 限量/快閃/搶購商品：不保證一定買到，購買進行後取消受限，搶購失敗時全額退款\n- 預購/團購商品：等待時間較長，取消條件依賣家政策\n\n【其他重要事項】\n- 價格可能因市場變動、匯率、促銷活動而調整，以付款時確認的金額為準\n- VEASLY不提供台灣統一發票或台灣格式的收據\n- 客戶點數(credit)請稱為「點數」，是獨立的獎勵單位，不是TWD\n\n【答題流程-必須遵守】\nStep 1: 判斷客戶問題屬於哪個類別\nStep 2: 在本prompt的政策說明和下方參考資料中尋找相關規定\nStep 3: 如果找到明確規定 → 僅根據該規定回答，不添加任何額外資訊\nStep 4: 如果找不到明確規定 → 必須回答「這部分我幫您確認一下，先為您轉接客服人員喔」\n⚠️ 絕對禁止跳過Step 2直接回答。沒有根據的回答等於欺騙客戶。\n\n【回答規則】\n1. 用繁體中文回答，語氣像朋友一樣親切自然，適當使用「喔」「呢」「囉」等語助詞\n2. 回答控制在150字以內，簡潔有力\n3. 金額一律用 TWD 表示\n4. 不要使用「根據資料」「根據我的資訊」等機器人口吻\n5. 不確定的資訊請說「這部分我幫您確認一下，先為您轉接客服人員喔」\n6. 不要用 markdown 格式\n7. 絕對不要捏造具體日期、出貨時間、海關狀態等資訊\n8. 配送問題：只能引用系統提供的訂單狀態\n9. 【購買請求】一律引導到 veasly.com 申請報價，絕對不要在聊天中接受訂單\n10. 【結帳金額不符】先問是否用APP，建議改用網頁版 veasly.com/tw 結帳\n11. 【語言規則】必須用繁體中文回答台灣客戶，絕對不可用韓文回覆\n12. 【嚴禁捏造】涉及系統功能、操作步驟、退款流程、帳戶機制等，只能回答本prompt中明確寫到的內容。若prompt未提及，一律回答「這部分我幫您確認一下，先為您轉接客服人員喔」並觸發轉接。絕對禁止自行推測、編造任何流程或功能',
  'ko': '당신은 VEASLY의 고객 상담 도우미 「Veasly 도우미」입니다.\n\n【중요】VEASLY의 고객은 거의 100% 대만 고객입니다. 고객이 중국어로 질문하면 반드시 繁體中文으로 답변하세요.\n\n【회사 및 서비스 성격】\nVEASLY는 한국 회사가 운영하는 한국 상품 구매 및 국제배송 지원 서비스입니다. 대만 현지 소매점이 아닙니다.\n적용 기준: VEASLY 공식 약관 및 대한민국 관련 법령. 단, 법률상 배제할 수 없는 강행 소비자보호 규정은 제한하지 않음.\n\n【답변 규칙】\n1. 고객 언어에 맞춰 답변 (대만→繁體中文, 한국어→한국어)\n2. 금액은 TWD로 표시\n3. 확실하지 않으면 "담당자를 연결해 드리겠습니다"\n4. 마크다운 서식 사용 금지\n5. 절대 구체적인 날짜, 출고 시간, 세관 상태 등을 지어내지 마세요\n6. 배송 관련: 시스템이 제공한 주문 상태만 인용\n7. 【구매 요청】veasly.com에서 申請報價 안내. 채팅으로 주문 받지 마세요\n8. 【취소 정책】주문 상태별 차등: 결제 전 자유취소, 한국 구매 진행 후 원칙적 불가, 출고 후 불가\n9. 【반품 정책】고객사유 반품 불가. 한국 미출발+판매자 동의 시에만 환불 가능. 수령 7일 이내 오배송/하자/파손/누락만 접수, 개봉영상 필수\n10. 【번개장터】BUNJANG 자동구매 상품은 판매자 동의 없이 절대 취소 불가\n11. 【국제배송비】대만 기준 무게 구간별 단계 과금. 0~1kg부터 TWD 295로 시작. 정확한 금액은 결제 페이지 기준. 실제 중량과 부피 중량(가로×세로×높이 cm ÷ 5000) 중 큰 값 기준. 25kg 초과 시 별도 견적\n12. 【합배송】고객이 직접 주문 페이지에서 신청해야 함. 합배송 후 총중량 기준 재계산하여 차액 환불/추가결제. 조건: 창고 미도착 상품 포함 시만 가능. 무료배송+일반배송, 예약배송+일반배송은 합배송 불가\n13. 【환각금지】프롬프트에 명시되지 않은 시스템 기능/프로세스를 절대 지어내지 마세요. 모르면 상담사 연결\n12. 【EZ WAY】대만 통관 필수, 수취인 정보 일치 필수, NT$2,000 초과 시 관세 발생 가능\n13. 【무료배송】이벤트 조건에 따라 변경 가능, 관세/원격지비/재배송비는 별도\n14. 【영수증】대만 통일發票 미제공\n15. 【결제금액 불일치】APP 사용 여부 확인 후 웹버전(veasly.com/tw) 안내'
};
async function initializeAI() {
  try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0.15, topP: 0.8, topK: 20, maxOutputTokens: 2048 } });
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

// [④ 답변 검증] 답변에 근거가 필요한 위험 정보(날짜·금액·배송/환불 상태)가 있는지 감지
function answerHasRiskyClaims(answer) {
  if (!answer) return false;
  if (/\d+\s*(月|日|天|일|월|주|個工作天|工作天|시간|영업일|business days?|days?|weeks?)/.test(answer)) return true;
  if (/\d{1,2}\s*[\/月-]\s*\d{1,2}/.test(answer)) return true;
  if (/(TWD|NT\$|US\$|\$|￥|円|원|元)\s*\d|\d+\s*(元|원|円)/.test(answer)) return true;
  if (/(已出貨|已發貨|配送中|運送中|已送達|已退款|退款完成|已通關|出庫|발송됨|배송\s*중|환불\s*완료|통관\s*완료|shipped|in transit|delivered|refunded)/.test(answer)) return true;
  // 수수료/요금 주장도 검증 대상 (대표적 거짓답 영역)
  if (/(手續費|代購費|服務費|免費|不收費|手数料|수수료|무료|fee|charge|free of charge)/.test(answer)) return true;
  return false;
}

// 생성된 답변이 참고자료/정책으로 뒷받침되는지 LLM으로 검증.
// 위험 답변(숫자·금액·상태·수수료)에만 호출되므로, 검증 실패 시 fail-CLOSED(false)로
// 처리해 근거 없는 답을 그대로 내보내지 않고 에스컬레이션 경로로 보낸다.
async function validateAnswer(answer, referenceText) {
  try {
    var vPrompt = '你是嚴格的答案審核員。判斷「客服回答」中所有具體的日期、金額、配送狀態、退款狀態、政策數字是否都能在「參考資料」中找到明確依據。\n\n' +
      '參考資料:\n' + referenceText + '\n\n客服回答:\n' + answer + '\n\n' +
      '規則：回答中只要有一個具體的日期、金額、配送/退款狀態在參考資料中找不到依據，就回答 NO。若回答只是引導、詢問澄清、或所有具體資訊都有依據，回答 YES。\n只回答一個單字：YES 或 NO';
    var r = await model.generateContent(vPrompt);
    var verdict = (r.response.text() || '').trim().toUpperCase();
    return verdict.indexOf('NO') === -1;
  } catch (e) {
    console.error('[AI][validation] error (fail-closed for risky answer):', e.message);
    return false;
  }
}

// [⑦ 의도 분류] 메시지를 9개 카테고리 중 하나로 라벨링 (라우팅 변경 아님, 로깅/관찰용)
var INTENT_CATEGORIES = ['order_status', 'shipping', 'return_refund', 'product', 'survey_csat', 'warehouse_package', 'account_payment', 'complaint', 'unclear'];

async function classifyIntent(userMessage) {
  try {
    var cPrompt = '把下面的客戶訊息分類成「一個」類別，只回答類別代碼一個單字：\n' +
      'order_status=訂單進度 / shipping=配送物流運費 / return_refund=退貨退款取消 / product=商品詢問 / ' +
      'survey_csat=問卷滿意度 / warehouse_package=倉庫包裹狀態 / account_payment=帳號付款 / ' +
      'complaint=抱怨投訴 / unclear=不清楚或其他\n\n客戶訊息: ' + userMessage + '\n\n只回答一個類別代碼:';
    var r = await model.generateContent(cPrompt);
    var c = (r.response.text() || '').trim().toLowerCase().replace(/[^a-z_]/g, '');
    return INTENT_CATEGORIES.indexOf(c) !== -1 ? c : 'unclear';
  } catch (e) {
    console.error('[AI][intent] error:', e.message);
    return 'unclear';
  }
}

async function generateAnswer(userMessage, language, chatId, chatHistory) {
  if (!AI_ENABLED) return null;
  try {
    var intentPromise = classifyIntent(userMessage);
    var queryVector = await getQueryEmbedding(userMessage);
    var results = await Promise.all([
      pineconeIndex.namespace("faq").query({ vector: queryVector, topK: 3, includeMetadata: true }),
      Promise.resolve({matches:[]}), // [2026-05-27] manager NS 조회 차단. 검증 안 된 매니저 응답이 confidence/RAG 오염. 1629개 누적분 정리는 별도. 재활성화: 윗줄 복원 + manager NS 정제 후.
      pineconeIndex.namespace("site").query({ vector: queryVector, topK: 2, includeMetadata: true }).catch(function(){ return {matches:[]}; })
    ]);
    var faqResult = results[0]; var mgrResult = results[1]; var siteResult = results[2];
    var allMatches = (faqResult.matches||[]).concat(mgrResult.matches||[]).concat(siteResult.matches||[]);
    // [① 검색 점수 측정] 2~N번째 매치 점수 분포 파악용 - 데이터 확보 후 임계값 필터 설계 예정
    console.log('[AI][retrieval] faq=[' + (faqResult.matches||[]).map(function(m){return (m.score||0).toFixed(3);}).join(',') +
      '] mgr=[' + (mgrResult.matches||[]).map(function(m){return (m.score||0).toFixed(3);}).join(',') +
      '] site=[' + (siteResult.matches||[]).map(function(m){return (m.score||0).toFixed(3);}).join(',') + ']');
    // [2026-05-27] 공식 정책 출처에 +0.05 가중치를 주어 컨텍스트 순서 재정렬.
    // auto_generated/auto_escalation_analysis 같은 미검증 출처가 0.001 차이로 공식본을 가리는 문제 보정.
    // 가산은 정렬에만 사용하고 .score는 보존 → confidence 수치는 raw 그대로.
    function _sourceBoost(m) {
      var src = (m && m.metadata && m.metadata.source) || '';
      if (src.indexOf('official-doc') === 0) return 0.05;
      if (src.indexOf('official-faq') === 0) return 0.05;
      if (src.indexOf('official-policy') === 0) return 0.05;
      if (src === 'admin_review_fix') return 0.05;
      return 0;
    }
    allMatches.sort(function(a, b) {
      return ((b.score||0) + _sourceBoost(b)) - ((a.score||0) + _sourceBoost(a));
    });
    var context = "";
    if (allMatches.length > 0) { context = allMatches.map(function(m) { return m.metadata.text || ""; }).join("\n---\n"); }
    var systemPrompt = SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS['zh-TW'];
    // [③ en/ja 언어 처리] 전용 프롬프트가 없어 zh-TW(중국어)로 폴백되던 문제 보정.
    // 정책 본문은 권위 있는 원문을 그대로 참고자료로 두고, 출력 언어만 강제 override.
    if (language === 'en') {
      systemPrompt = 'CRITICAL LANGUAGE RULE: This customer is writing in English. You MUST reply ONLY in natural, fluent English. The policy text below may be in Chinese - treat it purely as reference knowledge and never output Chinese. Ignore any instruction below that tells you to answer in Chinese.\n\n' + systemPrompt;
    } else if (language === 'ja') {
      systemPrompt = '重要な言語ルール：この顧客は日本語で問い合わせています。必ず自然な日本語のみで回答してください。下記のポリシー文は中国語の場合がありますが、参考知識として扱い、中国語では出力しないでください。\n\n' + systemPrompt;
    }
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
        holidayCtx += '- 今天是韓國國定假日: ' + (_today.twName || _today.krName || '공휴일') + '，客服休假\n';
      } else {
        holidayCtx += '- 今天不是韓國國定假日\n';
      }
      if (_tomorrow.isHoliday) {
        holidayCtx += '- 明天是韓國國定假日: ' + (_tomorrow.twName || _tomorrow.krName || '공휴일') + '\n';
      } else {
        holidayCtx += '- 明天不是韓國國定假日，正常營業\n';
      }
      // 다음 7일 공휴일 체크
      var _upcoming = [];
      for (var _d = 2; _d <= 7; _d++) {
        var _futureInfo = bizHours.getHolidayInfo(_now.getTime() + _d * 24 * 60 * 60 * 1000);
        if (_futureInfo.isHoliday) {
          var _fd = new Date(_now.getTime() + _d * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000);
          _upcoming.push(('0'+(_fd.getUTCMonth()+1)).slice(-2) + '/' + ('0'+_fd.getUTCDate()).slice(-2) + ' ' + (_futureInfo.twName || _futureInfo.krName || ''));
        }
      }
      if (_upcoming.length > 0) holidayCtx += '- 近期假日: ' + _upcoming.join(', ') + '\n';
      holidayCtx += '- 客服營業時間: 週一至週五 10:00~19:00 韓國時間（= 台灣 09:00~18:00），週末及國定假日休息\n';
    } catch(_hErr) { console.error('[AI] Holiday context error:', _hErr.message); }

    var prompt = systemPrompt + orderCtx + holidayCtx + '\n\n【重要提醒】以下參考資料是你唯一可引用的外部資訊。如果參考資料和上方政策說明都沒有提到的內容，你絕對不可以自行回答。\n\n參考資料:\n' + context + historyText + '\n\n客戶最新問題: ' + userMessage;
    var result = await model.generateContent(prompt);
    var answer = result.response.text();
    if (answer && answer.trim().length > 0) {
      var topScore = allMatches.length > 0 ? allMatches[0].score : 0;
      console.log('[AI] Generated answer for chatId:', chatId, '| confidence:', topScore.toFixed(3));
      
    // [2026-05-27] shippingFeeGuard 제거. 교체 텍스트의 'TWD 310'이 실제 요율(0~1kg TWD 295 기점 계층)과 달랐고,
    // 운임 정책이 시스템 프롬프트와 Pinecone(official-shipping-rates-tw-2026-05-*)에 정확히 적재됨.
    // 이제 LLM이 KB와 프롬프트로 충분히 정답을 생성. 하드코딩된 강제 교체는 더 큰 위험.

    // [④ 답변 검증] 위험 패턴(날짜·금액·배송/환불 상태)이 있을 때만 근거 검증 1콜 추가
    var grounded = true;
    if (answerHasRiskyClaims(answer)) {
      var referenceText = systemPrompt + orderCtx + holidayCtx + '\n參考資料:\n' + context;
      grounded = await validateAnswer(answer.trim(), referenceText);
      console.log('[AI][validation] risky answer for chatId:', chatId, '| grounded:', grounded);
    }
    // [⑦ 의도 분류] 병렬로 돌린 분류 결과 수거 (추가 지연 거의 없음)
    var category = await intentPromise;
    console.log('[AI][intent] chatId:', chatId, '| category:', category);
    return { answer: answer.trim(), confidence: topScore, grounded: grounded, category: category };
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
