require('dotenv').config();
var fs = require('fs');
var path = require('path');
var bizHours = require('./business-hours');
var { GoogleGenerativeAI } = require('@google/generative-ai');
var { Pinecone } = require('@pinecone-database/pinecone');
var email = require('./email');
var shippingRates = require('./shipping-rates');
var llm = require('./llm'); // Claude 답변 생성 래퍼 (KNOWLEDGE_SOURCE=notion 경로에서 사용)

var AI_ENABLED = false;
var genAI = null;
var model = null;
var pineconeIndex = null;

// [2026-07-05] 지식 소스 전환: pinecone(기존 RAG) | notion(knowledge.md 통짜 캐싱 컨텍스트).
// notion 경로는 scripts/sync-notion-knowledge.js 가 생성한 data/knowledge.md 를 Claude 캐싱 블록으로 넣는다.
var KNOWLEDGE_PATH = path.join(__dirname, '..', 'data', 'knowledge.md');
var _knowledge = { text: '', mtime: 0 };
function loadKnowledge() {
  try {
    var st = fs.statSync(KNOWLEDGE_PATH);
    if (st.mtimeMs !== _knowledge.mtime) {
      _knowledge.text = fs.readFileSync(KNOWLEDGE_PATH, 'utf8');
      _knowledge.mtime = st.mtimeMs;
      console.log('[AI] knowledge.md loaded (' + _knowledge.text.length + ' chars)');
    }
  } catch (e) {
    if (_knowledge.text === '') console.warn('[AI] knowledge.md 없음 (' + KNOWLEDGE_PATH + ') — notion 경로에 참고지식 없음. 먼저 sync 실행 필요.');
  }
  return _knowledge.text;
}
function useNotionKnowledge() {
  return (process.env.KNOWLEDGE_SOURCE || 'pinecone') === 'notion' && llm.isEnabled();
}

// [2026-06-29] Gemini 429/크레딧 소진 반복 감지 → 이메일 경보 (현재 가시성 0이던 장애를 알림화).
// 10분 창에서 3회 이상 실패 시 1회 메일, 이후 30분 쿨다운. 알림이 본 흐름을 절대 깨지 않도록 try-guard.
var _gemFail = { count: 0, windowStart: 0, lastAlert: 0 };
function _noteGeminiError(context, err) {
  try {
    var msg = (err && err.message) || String(err);
    if (!/429|Too Many Requests|credits|quota|RESOURCE_EXHAUSTED/i.test(msg)) return;
    var now = Date.now();
    if (now - _gemFail.windowStart > 10 * 60 * 1000) { _gemFail.windowStart = now; _gemFail.count = 0; }
    _gemFail.count++;
    if (_gemFail.count >= 3 && now - _gemFail.lastAlert > 30 * 60 * 1000) {
      _gemFail.lastAlert = now;
      var body = 'Gemini API 호출이 반복 실패하고 있습니다 (' + _gemFail.count + '회/10분).\n\n'
        + '위치: ' + context + '\n메시지: ' + msg + '\n\n'
        + '대부분 원인은 "선불 크레딧 소진(429)"입니다. Google AI Studio(https://ai.studio)에서 크레딧/쿼터를 확인하세요.\n'
        + '이 동안 봇은 AI 답변을 만들지 못하고 사람 연결로 넘어갑니다.\n\n시각: ' + new Date().toISOString();
      email.sendAlertEmail('🚨 VEASLY 봇 Gemini API 장애 (' + _gemFail.count + '회/10분)', body)
        .catch(function(e){ console.error('[Alert] email failed:', e.message); });
      console.log('[Alert] Gemini failure email triggered (' + _gemFail.count + ' in 10min window)');
    }
  } catch(_e) { /* alerting must never break the main flow */ }
}

var SYSTEM_PROMPTS = {
  'zh-TW': '你是 VEASLY 的智能客服助手「Veasly小幫手」。\n\n【最高優先規則-違反即嚴重失敗，優先於下方所有內容】\n1. 申報金額問題（申報金額/報關金額/海關申報 等）：不做任何說明、確認或推測，一律只回覆「關於申報金額的部分，我們幫您向負責同事確認後回覆您。」絕對不可補充任何理由（例如是否含運費、計算方式、海關規定等），多說一句即為失敗。\n2. 客戶訊息包含 詐騙、詐欺、消保官、律師、爆料、檢舉、提告 等字詞：不回應內容、不反駁、不解釋，一律只回覆「這部分會由專人盡快與您聯繫，請稍候。」\n3. 絕對禁止：承諾具體到貨日期／擅自承諾賠償、退款或免關稅／編造不知道的內容（不知道就說「這部分我幫您確認一下，先為您轉接客服人員喔」）。\n4. 金額不下定論：運費等金額只說明計算方式與級距規則，個別訂單的確定金額由客服人員確認。\n5. 回答一律使用台灣華語（繁體中文），不使用任何表情符號（emoji）。\n\n【公司與服務性質】\nVEASLY 由韓國公司營運，主要提供韓國商品購買及國際配送協助服務。VEASLY 不是台灣本地零售商，而是協助台灣客戶購買韓國商品並安排國際配送的服務平台。\n商品類別包含韓國美妝、服飾、偶像周邊、3C配件等，也支援 BUNJANG（閃電拍賣）等韓國二手平台商品代購。\n相關事項原則上依 VEASLY 官方條款及大韓民國相關法令處理。但法律上不得排除的強制性消費者保護規定，不因此而被限制。\n\n【服務特色】\n- 免代購手續費（已含在商品價格中）\n- 國際運費透明計算（依實際重量或材積重量中較高者）\n- 免運優惠：僅限標示「免運」的商品才適用。訂單金額達 TWD 4,999 以上→ 5kg、9,999 以上→ 10kg、14,999 以上→ 15kg、19,999 以上→ 20kg、24,999 以上→ 25kg 免運額度（每增加 TWD 5,000 多 5kg）。達到免運門檻後，同訂單內非免運商品也可一起享受免運額度。非免運商品單獨購買不適用免運優惠\n- 免運活動不包含：關稅、偏遠地區附加費、因客戶資料錯誤導致的重新配送費用\n- 付款方式僅 3 種：信用卡（TapPay）、PayPal、轉帳（虛擬帳號）（BUNJANG商品不支援轉帳）\n\n【訂單流程】\n提交商品連結 → 收到報價 → 付款 → 韓國國內購買 → 到達VEASLY物流中心 → 國際配送 → 台灣通關（檢查商品／確認EZWAY，約3~4個工作天） → 送達\n\n【取消與退款政策-嚴格遵守】\n- 取消僅在賣家發注（下單購買）前可保證；賣家已出貨、國際運單開立後，取消、變更地址、追加商品全部不可\n- 因買家原因（變心、選錯規格等）的取消退回：每件商品收取 170 TWD 處理費\n- 商品瑕疵、寄錯、配送破損、安心交易被拒、運費溢收：全額退款，不收 170 TWD 處理費\n- 退款時效務必區分，不可混用：運費溢收（多收）退款＝收到商品後約 3~7 個工作天；取消／退回的退刷＝約 7~14 個工作天\n- 退款方式：原付款方式退回，信用卡依銀行作業可能多 1~2 個帳單週期\n- 使用的優惠券/折扣碼/點數：依實際使用條件決定是否退還\n- 匯率差異：退款金額可能因匯率變動而與付款金額不完全一致\n\n【配送與通關-嚴格遵守】\n- 國際運費（寄送至台灣）：依重量階梯計費，0~1kg 起 TWD 295；不同重量級距費率不同，詳細以結帳頁顯示為準。以實際重量與材積重量（長×寬×高 cm ÷ 5000）中較高者計算。超過免運額度的部分依超額重量表（從 0 開始）計費。25kg 以上請先洽客服取得正式報價\n- 不提供秤重照片，僅提供包裝箱尺寸供客戶確認\n- 合併寄送（重要，嚴格依此回答）：只要要合併的訂單中有任一筆尚未抵達集運倉，即可申請；訂單全部抵達集運倉後即無法申請（與是否為免運訂單無關）。已被拒絕過的組合無法再次申請。未合併的訂單會分別從韓國寄出。合併後依訂單合計金額重新計算免運額度（例：5,000＋5,000 → 10kg 免運）。合併寄送一律宅配到府；原本選擇超商取貨的訂單，申請合併時需改為宅配地址。想追加訂單時：先取消原合併申請，再將要合併的訂單一起重新申請。客戶須自行在訂單頁面申請，客服無法代為操作\n- 配送時間：韓國出發後約7~14天，抵台後清關前置檢查（檢查商品／確認EZWAY）正常約需 3~4 個工作天\n- EZ WAY 實名認證：台灣收貨必須完成，收件人資訊須與EZ WAY認證一致。未完成實名認證就不會收到申報通知；客戶說沒收到通知時，請引導確認 App 安裝與實名認證，並可打開 App 的「委任管理」查看待辦申報；抵台後的申報通知正常約需 3~4 個工作天，超過仍未收到再由客服向物流端確認\n- 客戶人在國外無法完成 EZWAY 委任：提供兩個選項——改由在台灣的親友代收（變更收件人資料），或取消退回（每件商品收取 170 TWD 處理費）\n- 物流顯示「已送達」但客戶未收到：先請確認是否由管理室、家人或鄰居代收；若都沒有，請客戶提供訂單編號協助調閱配送紀錄。依規定，物流顯示已送達後的未領取由收件人負責；重新安排配送收取 200 TWD 重配費用\n- 超過 NT$2,000 可能產生關稅，稅費由客戶負擔\n- 因地址錯誤、未取件、個人原因退回產生的費用由客戶負擔\n- 禁止/限制進口品（如部分食品、藥品、含鋰電池商品等）：客戶須自行確認是否可進口，因違禁遭扣押/銷毀由客戶自行負責\n\n【退貨與換貨-嚴格遵守】\n- 適用範圍：商品瑕疵、寄錯、配送中破損或數量短少，收到商品後 7 天內聯繫客服\n- 必須提供「拆封前就開始」的全程連續錄影（未拆封外箱 → 物流標籤 → 拆封過程 → 商品本體 → 瑕疵部位），這是判斷責任歸屬的必要依據，缺少完整連續影片可能影響退換貨處理\n- 須保留原包裝及所有配件\n- 個人原因（不喜歡、尺寸不合、色差、與期待不同）不接受退貨退款；若經審核受理，每件收取 170 TWD 處理費\n- 不要自行承諾具體賠償方式或期限，統一說「請聯繫客服確認處理方式」\n\n【閃電拍賣（BUNJANG）三規則-嚴格遵守】\n1. 議價：無法代為向賣家議價，商品以賣場標示價格為準\n2. 週末與韓國國定假日：僅受理報價，代購下單會在下一個營業日依序處理；二手商品數量有限，期間售出敬請見諒\n3. 賣家要求直接聯絡時：請透過客服轉達，我們會代客戶與賣家聯絡確認；未來將推出讓客戶直接與賣家溝通的功能\n- BUNJANG自動代購：賣家不同意則絕對無法取消，這是個人賣家平台特性\n- 中古商品：狀態以賣家描述為準，可能有使用痕跡，一律不接受退換貨\n\n【數量限制】\n- 有購買限制的商品與閃電拍賣（二手）商品僅能購買 1 件\n- 一般商品需要多件時，引導分次下單後申請合併寄送\n\n【會員退會】\n- 客戶要求退會時：告知已收到申請、會轉交專人處理，並務必事先告知「退會後帳戶剩餘的點數將會失效、無法退還」，請客戶確認要繼續再回覆。實際處理由客服人員進行\n\n【特殊商品注意事項】\n- 限量/快閃/搶購商品：不保證一定買到，購買進行後取消受限，搶購失敗時全額退款\n- 預購/團購商品：等待時間較長，取消條件依賣家政策\n\n【其他重要事項】\n- 價格可能因市場變動、匯率、促銷活動而調整，以付款時確認的金額為準\n- VEASLY不提供台灣統一發票或台灣格式的收據\n- 客戶點數(credit)請稱為「點數」，是獨立的獎勵單位，不是TWD\n\n【答題流程-必須遵守】\nStep 1: 先檢查是否觸發【最高優先規則】1或2，若觸發只回覆固定句子\nStep 2: 判斷客戶問題屬於哪個類別\nStep 3: 在本prompt的政策說明和下方參考資料中尋找相關規定\nStep 4: 如果找到明確規定 → 僅根據該規定回答，不添加任何額外資訊\nStep 5: 如果找不到明確規定 → 必須回答「這部分我幫您確認一下，先為您轉接客服人員喔」\n⚠️ 絕對禁止跳過Step 3直接回答。沒有根據的回答等於欺騙客戶。\n\n【回答規則】\n1. 用繁體中文回答，語氣親切自然，可適當使用「喔」「呢」「囉」等語助詞，但不使用表情符號\n2. 回答控制在150字以內，簡潔有力\n3. 金額一律用 TWD 表示\n4. 不要使用「根據資料」「根據我的資訊」等機器人口吻\n5. 不確定的資訊請說「這部分我幫您確認一下，先為您轉接客服人員喔」\n6. 不要用 markdown 格式\n7. 絕對不要捏造具體日期、出貨時間、海關狀態等資訊\n8. 配送問題：只能引用系統提供的訂單狀態\n9. 【購買請求】一律引導到 veasly.com 申請報價，絕對不要在聊天中接受訂單\n10. 【結帳金額不符】先問是否用APP，建議改用網頁版 veasly.com/tw 結帳\n11. 【語言規則】必須用繁體中文回答台灣客戶，絕對不可用韓文回覆\n12. 【嚴禁捏造】涉及系統功能、操作步驟、退款流程、帳戶機制等，只能回答本prompt中明確寫到的內容。若prompt未提及，一律回答「這部分我幫您確認一下，先為您轉接客服人員喔」並觸發轉接。絕對禁止自行推測、編造任何流程或功能',
  'ko': '당신은 VEASLY의 고객 상담 도우미 「Veasly 도우미」입니다.\n\n【최우선 규칙 — 위반 시 실패】\n1. 신고금액(申報金額/報關金額/海關申報) 문의: 어떤 설명·확인·추측도 하지 말고 「關於申報金額的部分，我們幫您向負責同事確認後回覆您。」만 답변\n2. 詐騙·詐欺·消保官·律師·爆料·檢舉·提告 키워드 포함 시: 내용 답변·반박 없이 「這部分會由專人盡快與您聯繫，請稍候。」만 답변\n3. 절대 금지: 도착일 확약 / 보상·환불·관세 면제 임의 약속 / 모르는 내용 지어내기 (모르면 상담사 연결)\n4. 금액 확정 금지: 운임 등은 계산 방식·구간표 안내까지만, 개별 건 확정 금액은 상담사\n5. 이모지 사용 금지\n\n【중요】VEASLY의 고객은 거의 100% 대만 고객입니다. 고객이 중국어로 질문하면 반드시 繁體中文으로 답변하세요.\n\n【회사 및 서비스 성격】\nVEASLY는 한국 회사가 운영하는 한국 상품 구매 및 국제배송 지원 서비스입니다. 대만 현지 소매점이 아닙니다.\n적용 기준: VEASLY 공식 약관 및 대한민국 관련 법령. 단, 법률상 배제할 수 없는 강행 소비자보호 규정은 제한하지 않음.\n\n【답변 규칙】\n1. 고객 언어에 맞춰 답변 (대만→繁體中文, 한국어→한국어)\n2. 금액은 TWD로 표시\n3. 확실하지 않으면 "담당자를 연결해 드리겠습니다"\n4. 마크다운 서식 사용 금지\n5. 절대 구체적인 날짜, 출고 시간, 세관 상태 등을 지어내지 마세요\n6. 배송 관련: 시스템이 제공한 주문 상태만 인용\n7. 【구매 요청】veasly.com에서 申請報價 안내. 채팅으로 주문 받지 마세요\n8. 【취소 정책】셀러 발주 전만 취소 보장. 출고·국제운송장 개설 후에는 취소·주소변경·상품추가 전부 불가. 고객귀책 취소·퇴환은 상품당 170 TWD 처리비 (하자·오배송·파손·안심거래 거부·운임 과다청구는 전액 환불)\n9. 【반품·교환】하자·오배송·파손·수량부족만 접수, 수령 후 7일 이내, 개봉 전부터 시작된 연속 개봉 영상 필수\n10. 【번개장터 3규칙】① 가격 협상 대행 불가(표시가 기준) ② 주말·한국 공휴일은 견적만, 발주는 익영업일 ③ 셀러 직접연락 요청 시 CS가 대리 연락. BUNJANG 자동구매 상품은 판매자 동의 없이 절대 취소 불가\n11. 【국제배송비】대만 기준 무게 구간별 단계 과금. 0~1kg부터 TWD 295로 시작. 정확한 금액은 결제 페이지 기준. 실제 중량과 부피 중량(가로×세로×높이 cm ÷ 5000) 중 큰 값 기준. 초과분은 초과중량표 0부터 조회. 25kg 초과 시 별도 견적. 측정 사진은 제공하지 않고 박스 사이즈만 제공\n12. 【합배송】묶으려는 주문 중 하나라도 집운창 미도착이면 신청 가능, 전부 입고되면 불가 (무료배송 여부와 무관). 거절된 조합은 재신청 불가. 미합병 주문은 한국에서 각각 발송. 합배송은 무조건 宅配(집 배송) — 편의점 수령 주문도 집 주소로 변경 필요. 합계금액 기준 무료배송 재계산 (5,000+5,000 → 10kg). 고객이 직접 주문 페이지에서 신청\n13. 【배송완료 미수령】관리실·가족·이웃 대리수령 확인 → 배송기록 조회 협조. 물류 已送達 이후 미수령은 고객 책임, 재배송 시 200 TWD\n14. 【EZ WAY】대만 통관 필수, 수취인 정보 일치 필수. 미인증이면 통지 없음 → 앱 설치+실명인증 확인, 「委任管理」 대기건 확인, 정상 대기 약 3~4영업일. 해외 체류로 위임 불가 시: 수취인 변경 or 취소·반송(상품당 170 TWD) 2옵션. NT$2,000 초과 시 관세 발생 가능\n15. 【무료배송】주문금액 TWD 4,999 이상→5kg, 9,999→10kg, 14,999→15kg, 19,999→20kg, 24,999→25kg 무료 (5,000 증가마다 5kg). 관세/원격지비/재배송비는 별도\n16. 【수량 제한】구매제한 상품·번개장터 상품은 1개 고정. 일반 상품 다수 필요 시 분할 주문 후 합배송 안내\n17. 【환불 시효 구분】운임 과다징수 = 수령 후 3~7영업일 / 취소·퇴환 退刷 = 7~14영업일. 절대 섞어 말하지 말 것\n18. 【회원 탈퇴】접수 안내 + 잔여 포인트 소멸 사전 고지까지만. 처리는 상담원\n19. 【결제수단】信用卡(TapPay) / PayPal / 轉帳 3종뿐\n20. 【환각금지】프롬프트에 명시되지 않은 시스템 기능/프로세스를 절대 지어내지 마세요. 모르면 상담사 연결\n21. 【영수증】대만 통일發票 미제공\n22. 【결제금액 불일치】APP 사용 여부 확인 후 웹버전(veasly.com/tw) 안내'
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
    // 실행 중인 답변 모드 확정 로그(운영 확인용)
    console.log('[AI] 답변모드: ' + (useNotionKnowledge()
      ? 'Claude+Notion (KNOWLEDGE_SOURCE=notion, model=' + llm.MODEL + ')'
      : 'Pinecone+Gemini (KNOWLEDGE_SOURCE=' + (process.env.KNOWLEDGE_SOURCE || 'pinecone') + ', ANTHROPIC_KEY=' + (llm.isEnabled() ? 'set' : 'MISSING') + ')'));
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
    _noteGeminiError('validate', e);
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
    _noteGeminiError('intent', e);
    console.error('[AI][intent] error:', e.message);
    return 'unclear';
  }
}

// [넘김 자동분류+요약] 상담 대화를 읽고 (1) 6개 넘김 사유 중 하나 (2) 2~3줄 상황 요약을 한 번에 생성.
// 노션 "CS 넘김" DB 자동적재에 사용. 실패 시 {reasonCode:null, summary:''} 반환(폴백은 호출측).
async function classifyHandoff(conversationText) {
  if (!conversationText) return { reasonCode: null, summary: '' };
  var hPrompt = '你是 VEASLY 客服品質分析員。以下是一段需要轉交專人處理的客服對話。請完成兩件事，並「只」以 JSON 回覆：\n' +
    '1. reason：從下列 6 類中選「一個」最符合的轉交原因，只回代號數字：\n' +
    '   1=賣家糾紛(韓國賣家或二手交易爭議) 2=政策例外(超出標準政策的特例請求) 3=財務退款(退款金額爭議、15日財務結算) 4=通關物流品牌(清關/EZWAY/國際運送/品牌方問題) 5=系統錯誤(網站或APP異常) 6=其他\n' +
    '2. summary：用繁體中文 2~3 句總結「客戶遇到什麼狀況、卡在哪、需要專人處理什麼」。只根據對話內容，不要臆測未發生的事。\n\n' +
    '對話內容：\n' + conversationText + '\n\n' +
    '只回 JSON，格式：{"reason": <1到6的數字>, "summary": "..."}';
  try {
    // [2026-07-06] Claude 우선(Gemini 크레딧 소진 대응). llm 없으면 Gemini 폴백.
    var raw = '';
    if (llm.isEnabled()) {
      var res = await llm.generate({ user: hPrompt, maxTokens: 800 });
      raw = (res && res.text) || '';
    } else if (AI_ENABLED) {
      var r = await model.generateContent(hPrompt);
      raw = r.response.text() || '';
    }
    if (!raw) return { reasonCode: null, summary: '' };
    var m = raw.match(/\{[\s\S]*\}/); // 첫 JSON 객체만 추출(앞뒤 잡텍스트 방어)
    var obj = JSON.parse(m ? m[0] : raw);
    var code = String(obj.reason || '').replace(/[^1-6]/g, '').slice(0, 1);
    return { reasonCode: code || null, summary: (obj.summary || '').toString().slice(0, 1500) };
  } catch (e) {
    _noteGeminiError('classifyHandoff', e);
    console.error('[AI][handoff] classify error:', e.message);
    return { reasonCode: null, summary: '' };
  }
}

// ── 공유 컨텍스트 빌더 (pinecone·notion 두 경로 공용). 기존 generateAnswer 인라인 코드를 추출한 것. ──
function adjustSystemPromptForLang(systemPrompt, language) {
  // [③ en/ja] 전용 프롬프트가 없어 zh-TW로 폴백되던 문제 보정. 정책 원문은 참고자료로 두고 출력 언어만 강제.
  if (language === 'en') {
    return 'CRITICAL LANGUAGE RULE: This customer is writing in English. You MUST reply ONLY in natural, fluent English. The policy text below may be in Chinese - treat it purely as reference knowledge and never output Chinese. Ignore any instruction below that tells you to answer in Chinese.\n\n' + systemPrompt;
  } else if (language === 'ja') {
    return '重要な言語ルール：この顧客は日本語で問い合わせています。必ず自然な日本語のみで回答してください。下記のポリシー文は中国語の場合がありますが、参考知識として扱い、中国語では出力しないでください。\n\n' + systemPrompt;
  }
  return systemPrompt;
}
function buildHistoryText(chatHistory) {
  if (!chatHistory || chatHistory.length === 0) return '';
  return "\n\n之前的對話紀錄：\n" + chatHistory.map(function(h) {
    return (h.role === "user" ? "客戶: " : "客服: ") + h.text;
  }).join("\n") + "\n";
}
function buildOrderCtx(chatHistory) {
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
  return orderCtx;
}
function buildHolidayCtx() {
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
  return holidayCtx;
}
function buildShippingCtx(userMessage, language) {
  // [2026-06-29] 운임 질문이면 최신 운임표를 권위 컨텍스트로 주입(하드코딩·stale 인용 차단) + stale 자동 감지
  var shippingCtx = '';
  try {
    if (shippingRates.isFeeQuestion(userMessage)) {
      var _rt = shippingRates.getRateTableText(language);
      if (_rt) shippingCtx = '\n\n【最新運費資料（權威來源，優先於下方參考資料及任何其他金額）】\n' + _rt + '\n⚠️ 回答運費相關問題時，金額一律以上表為準，禁止引用其他來源（含下方參考資料）的運費數字。';
      shippingRates.maybeRefresh();
    }
  } catch(_se) { console.error('[AI] shippingCtx error:', _se.message); }
  return shippingCtx;
}

async function generateAnswer(userMessage, language, chatId, chatHistory) {
  if (!AI_ENABLED) return null;
  // [2026-07-05] KNOWLEDGE_SOURCE=notion + ANTHROPIC_API_KEY 있으면 Claude+knowledge.md 경로로. 아니면 기존 Pinecone/Gemini.
  if (useNotionKnowledge()) {
    return await generateAnswerClaude(userMessage, language, chatId, chatHistory);
  }
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
    // [2026-06-30] 검색 관련도 하한선: raw score < FLOOR 매치는 context에서 제외(동떨어진 자료로 억지 답 방지).
    // 보수적 기본 0.45 — 정상 군집(0.6~0.8)은 무영향, 명백히 무관한 매치만 제거. env RETRIEVAL_SCORE_FLOOR로 조정.
    // 남는 매치가 없으면 context 비움 → topScore/confidence 0 → '근거 없으면 상담사 연결' 경로로.
    var _scoreFloor = parseFloat(process.env.RETRIEVAL_SCORE_FLOOR || '0.45');
    var _beforeFloor = allMatches.length;
    allMatches = allMatches.filter(function(m){ return (m && typeof m.score === 'number' ? m.score : 0) >= _scoreFloor; });
    if (allMatches.length < _beforeFloor) {
      console.log('[AI][retrieval] score-floor ' + _scoreFloor + ': kept ' + allMatches.length + '/' + _beforeFloor + (allMatches.length === 0 ? ' (empty context -> escalate)' : ''));
    }
    var context = "";
    if (allMatches.length > 0) { context = allMatches.map(function(m) { return (m && m.metadata && m.metadata.text) || ""; }).filter(function(t) { return t; }).join("\n---\n"); }
    var systemPrompt = adjustSystemPromptForLang(SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS['zh-TW'], language);
    var historyText = buildHistoryText(chatHistory);
    var orderCtx = buildOrderCtx(chatHistory);
    var holidayCtx = buildHolidayCtx();
    var shippingCtx = buildShippingCtx(userMessage, language);
    var prompt = systemPrompt + orderCtx + shippingCtx + holidayCtx + '\n\n【重要提醒】以下參考資料是你唯一可引用的外部資訊。如果參考資料和上方政策說明都沒有提到的內容，你絕對不可以自行回答。\n\n參考資料:\n' + context + historyText + '\n\n客戶最新問題: ' + userMessage;
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
      var referenceText = systemPrompt + orderCtx + shippingCtx + holidayCtx + '\n參考資料:\n' + context;
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
    _noteGeminiError('generateAnswer', err);
    console.error('[AI] generateAnswer error:', err.message);
    return null;
  }
}

// 채널톡은 평문이라 마크다운(**·#·불릿·`)이 원문 노출됨. 프롬프트가 금지해도 haiku가 넣어 스트립 필요.
function stripMarkdown(s) {
  if (!s) return s;
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')    // **볼드** → 볼드
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')   // ## 헤더 제거
    .replace(/^(\s*)[-*+]\s+/gm, '$1')    // 불릿 마커 제거(들여쓰기 유지)
    .replace(/`([^`]+)`/g, '$1')          // `코드` → 코드
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── [2026-07-05] Claude 답변 경로 (KNOWLEDGE_SOURCE=notion). Pinecone/Gemini 대신 knowledge.md 통짜 캐싱 컨텍스트 사용. ──
// 의도 분류(관찰용). Gemini classifyIntent 의 Claude 포팅.
async function classifyIntentClaude(userMessage) {
  try {
    var cUser = '把下面的客戶訊息分類成「一個」類別，只回答類別代碼一個單字：\n' +
      'order_status=訂單進度 / shipping=配送物流運費 / return_refund=退貨退款取消 / product=商品詢問 / ' +
      'survey_csat=問卷滿意度 / warehouse_package=倉庫包裹狀態 / account_payment=帳號付款 / ' +
      'complaint=抱怨投訴 / unclear=不清楚或其他\n\n客戶訊息: ' + userMessage + '\n\n只回答一個類別代碼:';
    var r = await llm.generate({ user: cUser, maxTokens: 12 });
    if (!r || !r.text) return 'unclear';
    var c = r.text.trim().toLowerCase().replace(/[^a-z_]/g, '');
    return INTENT_CATEGORIES.indexOf(c) !== -1 ? c : 'unclear';
  } catch (e) {
    console.error('[AI][intent:claude] error:', e.message);
    return 'unclear';
  }
}

// 위험 답변 근거 검증 (Gemini validateAnswer 의 Claude 포팅). systemStable 을 그대로 넘겨 캐시 프리픽스 재사용.
// 실패 시 fail-CLOSED(false) — 근거 없는 위험 답변을 그대로 내보내지 않는다.
async function validateAnswerClaude(answer, systemStable, systemVolatile) {
  try {
    var vUser = '你是嚴格的答案審核員。根據「系統提供的政策與參考知識庫」，判斷下方「客服回答」中所有具體的日期、金額、配送狀態、退款狀態、政策數字是否都能找到明確依據。\n\n' +
      '客服回答:\n' + answer + '\n\n' +
      '規則：回答中只要有一個具體的日期、金額、配送/退款狀態找不到依據，就回答 NO。若回答只是引導、詢問澄清、或所有具體資訊都有依據，回答 YES。\n只回答一個單字：YES 或 NO';
    var r = await llm.generate({ systemStable: systemStable, systemVolatile: systemVolatile, user: vUser, maxTokens: 8 });
    if (!r || !r.text) return false; // fail-closed
    return r.text.trim().toUpperCase().indexOf('NO') === -1;
  } catch (e) {
    console.error('[AI][validation:claude] error (fail-closed for risky answer):', e.message);
    return false;
  }
}

async function generateAnswerClaude(userMessage, language, chatId, chatHistory) {
  try {
    var knowledge = loadKnowledge();
    var systemPrompt = adjustSystemPromptForLang(SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS['zh-TW'], language);
    var orderCtx = buildOrderCtx(chatHistory);
    var shippingCtx = buildShippingCtx(userMessage, language);
    var holidayCtx = buildHolidayCtx();
    var historyText = buildHistoryText(chatHistory);

    // 캐싱 최적화: [정책 프롬프트 + 지식베이스] = 안정 블록(cache_control) / [주문·운임·공휴일] = 가변 블록.
    var systemStable = systemPrompt +
      '\n\n【參考知識庫 — 以下為你唯一可引用的外部資訊。若客戶問題在系統政策與此知識庫中都找不到依據，一律回覆「這部分我幫您確認一下，先為您轉接客服人員喔」，絕不可自行編造】\n' + knowledge;
    var systemVolatile = orderCtx + shippingCtx + holidayCtx;
    var userTurn = historyText + '\n\n客戶最新問題: ' + userMessage;

    var intentPromise = classifyIntentClaude(userMessage); // 병렬 (관찰용, 라우팅 아님)
    var res = await llm.generate({ systemStable: systemStable, systemVolatile: systemVolatile, user: userTurn, maxTokens: 1024 });
    if (!res || !res.text) { console.error('[AI][claude] empty response for chatId:', chatId); return null; }
    var answer = stripMarkdown(res.text.trim()); // 채널톡 평문 대응
    if (!answer) return null;

    // 신뢰도 휴리스틱: 봇이 "轉接客服/專人/確認" 핸드오프 문구를 냈으면 escalate 신호(confidence 0), 아니면 confident(0.85).
    // Pinecone 검색점수가 없는 대신 봇의 자체 핸드오프 신호를 confidence로 환산 → webhook 하류 로직 그대로 재사용.
    var isHandoff = /先為您轉接客服人員|會由專人|向負責同事確認|幫您確認一下|轉接客服/.test(answer);
    var confidence = isHandoff ? 0 : 0.85;

    // 위험 주장(날짜·금액·배송/환불 상태·수수료)엔 근거검증 1콜(캐시 재사용). 근거 없으면 grounded=false → 하류가 confidence 0 처리.
    var grounded = true;
    if (!isHandoff && answerHasRiskyClaims(answer)) {
      grounded = await validateAnswerClaude(answer, systemStable, systemVolatile);
      console.log('[AI][validation:claude] chatId:', chatId, '| grounded:', grounded);
    }
    var category = await intentPromise;
    console.log('[AI][claude] chatId:', chatId, '| handoff:', isHandoff, '| confidence:', confidence, '| category:', category,
      (res.usage ? '| in:' + res.usage.input_tokens + ' cacheRead:' + (res.usage.cache_read_input_tokens || 0) + ' out:' + res.usage.output_tokens : ''));
    return { answer: answer, confidence: confidence, grounded: grounded, category: category };
  } catch (err) {
    console.error('[AI] generateAnswerClaude error:', err.message);
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

module.exports = { initializeAI, generateAnswer, classifyHandoff, getEmbedding, getQueryEmbedding, addToKnowledgeBase, isReady };
