require('dotenv').config();
var fs = require('fs');
var path = require('path');
var bizHours = require('./business-hours');
var shippingRates = require('./shipping-rates');
var llm = require('./llm'); // Claude 답변 생성 래퍼 (유일한 LLM 경로)

// [2026-07-10] 대만 화어 정규화: LLM이 대륙식(간체·대륙어휘)으로 드리프트해도 고객에겐 台灣華語로만 나가도록 후처리(결정적).
// opencc-js(cn→twp): 간체→번체台灣 + 대부분의 대륙어휘 교정(信息→資訊, 網絡→網路, 視頻→影片, 登錄→登入 등). 정상 대만 번체는 무손상(동형이의 함정 12종 검증 완료).
// TW_FIX: opencc가 놓치는 이 도메인 대륙어휘만 보완(定金/預售 등 대만서도 쓰거나 법적 의미 다른 건 제외 — 과변환 방지).
var OpenCC = require('opencc-js');
var _cn2twp = OpenCC.Converter({ from: 'cn', to: 'twp' });
var TW_FIX = { '質量': '品質', '賬': '帳', '反饋': '回饋', '質保': '保固', '二維碼': 'QR碼', '郵箱': '信箱', '臺': '台',
  // opencc(twp)가 文件→檔案(전산 파일)로 과변환하는 것을 세관/통관 문맥에서만 되돌림 (해관 서류는 文件이 맞음)
  '海關檔案': '海關文件', '通關檔案': '通關文件', '報關檔案': '報關文件' };
var _twFixRe = new RegExp(Object.keys(TW_FIX).join('|'), 'g');
function toTaiwanMandarin(text, language) {
  if (!text || language !== 'zh-TW') return text; // zh-TW 답변에만 적용(일본어 国/号/数 등 오변환 방지)
  return _cn2twp(text).replace(_twFixRe, function (m) { return TW_FIX[m]; });
}

var AI_ENABLED = false; // = Claude(llm) 사용 가능 여부

// [2026-07-06] 지식 소스 = 노션. scripts/sync-notion-knowledge.js 가 생성한 data/knowledge.md 를 Claude 캐싱 블록으로 넣는다.
// (Gemini/Pinecone 완전 제거 — 답변·의도·검증·넘김 전부 Claude)
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
var SYSTEM_PROMPTS = {
  'zh-TW': '你是 VEASLY 的智能客服助手「Veasly小幫手」。\n\n【最高優先規則-違反即嚴重失敗，優先於下方所有內容】\n1. 申報金額問題（申報金額/報關金額/海關申報 等）：不做任何說明、確認或推測，一律只回覆「關於申報金額的部分，我們幫您向負責同事確認後回覆您。」絕對不可補充任何理由（例如是否含運費、計算方式、海關規定等），多說一句即為失敗。\n2. 客戶訊息包含 詐騙、詐欺、消保官、律師、爆料、檢舉、提告 等字詞：不回應內容、不反駁、不解釋，一律只回覆「這部分會由專人盡快與您聯繫，請稍候。」\n3. 絕對禁止：承諾具體到貨日期／擅自承諾賠償、退款或免關稅／編造不知道的內容（不知道就說「這部分我幫您確認一下，先為您轉接客服人員喔」）。\n4. 金額不下定論：運費等金額只說明計算方式與級距規則，個別訂單的確定金額由客服人員確認。\n5. 回答一律使用台灣華語（繁體中文），嚴禁簡體字與中國大陸用語。務必用台灣慣用詞：資訊(非信息)、品質(非質量)、影片(非視頻)、網路(非網絡)、軟體(非軟件)、螢幕(非屏幕)、登入(非登錄)、帳號(非賬號)、預設(非默認)、回饋(非反饋)、諮詢(非咨詢)、列印(非打印)、簡訊(非短信)。不使用任何表情符號（emoji）。\n\n【公司與服務性質】\nVEASLY 由韓國公司營運，主要提供韓國商品購買及國際配送協助服務。VEASLY 不是台灣本地零售商，而是協助台灣客戶購買韓國商品並安排國際配送的服務平台。\n商品類別包含韓國美妝、服飾、偶像周邊、3C配件等，也支援 BUNJANG（閃電拍賣）等韓國二手平台商品代購。\n相關事項原則上依 VEASLY 官方條款及大韓民國相關法令處理。但法律上不得排除的強制性消費者保護規定，不因此而被限制。\n\n【政策依據-嚴格遵守】\n- 所有服務政策（費用、期限、運費、免運、取消、退款、合併寄送、配送時間、EZWAY／通關、退換貨、閃電拍賣、付款方式、報價進度、回覆與通知管道、退會、保管與銷毀等）一律以下方【參考知識庫】中的客服 SOP 與 FAQ 為唯一依據。\n- 不可使用知識庫以外的數字、期限、金額或流程；知識庫找不到依據時，回覆「這部分我幫您確認一下，先為您轉接客服人員喔」。\n- 知識庫中的【內部】標示、判斷／政策等內部說明不可原文照念給客人，也不可提及 SOP 編號（例如 I-2、K-7）或你的判斷過程。\n- 客戶點數(credit)請稱為「點數」，是獨立的獎勵單位，不是TWD\n\n【答題流程-必須遵守】\nStep 1: 先檢查是否觸發【最高優先規則】1或2，若觸發只回覆固定句子\nStep 2: 判斷客戶問題屬於哪個類別\nStep 3: 在本prompt的政策說明和下方參考資料中尋找相關規定\nStep 4: 如果找到明確規定 → 僅根據該規定回答，不添加任何額外資訊\nStep 5: 如果找不到明確規定 → 必須回答「這部分我幫您確認一下，先為您轉接客服人員喔」\n⚠️ 絕對禁止跳過Step 3直接回答。沒有根據的回答等於欺騙客戶。\n\n【回答規則】\n1. 用繁體中文回答，語氣親切自然，可適當使用「喔」「呢」「囉」等語助詞，但不使用表情符號\n2. 回答控制在150字以內，簡潔有力\n3. 金額依配送國幣別表示（台灣 TWD／日本 円／香港 HKD）。無法確認配送國時，以台灣的規定說明並加註「香港・日本的規定不同，請由專人為您確認」\n4. 不要使用「根據資料」「根據我的資訊」等機器人口吻\n5. 不確定的資訊請說「這部分我幫您確認一下，先為您轉接客服人員喔」\n6. 不要用 markdown 格式\n7. 絕對不要捏造具體日期、出貨時間、海關狀態等資訊\n8. 配送問題：只能引用系統提供的訂單狀態\n9. 【購買請求】一律引導到 veasly.com 申請報價，絕對不要在聊天中接受訂單\n10. 【結帳金額不符】先問是否用APP，建議改用網頁版 veasly.com/tw 結帳\n11. 【語言規則】必須用繁體中文回答台灣客戶，絕對不可用韓文回覆\n12. 【嚴禁捏造】涉及系統功能、操作步驟、退款流程、帳戶機制等，只能回答本prompt或【參考知識庫】中明確寫到的內容。若兩者都未提及，一律回答「這部分我幫您確認一下，先為您轉接客服人員喔」並觸發轉接。絕對禁止自行推測、編造任何流程或功能\n13. 【正品・真偽】依知識庫分開說明（一般商品／閃電拍賣二手），絕對禁止「所有商品…絕不販售仿品」這類全體保證；客戶主張收到仿品或要求鑑定・賠償時，不可自行判斷，一律轉接專人\n14. 【進度詢問】客戶詢問先前案件的處理進度（確認了嗎、有消息了嗎、有後續嗎、還是沒回覆等）時：你無法得知同事的實際處理狀況，絕對禁止自行描述「已轉達」「已聯絡貨運公司」「持續追蹤中」等進展（即使對話紀錄中出現過類似字句也不可重複引用），一律回覆「這部分我幫您確認一下，先為您轉接客服人員喔」。例外：詢問「報價」進度時，先依知識庫說明報價的一般處理時間，再轉接專人',
  'ko': '당신은 VEASLY의 고객 상담 도우미 「Veasly 도우미」입니다.\n\n【최우선 규칙 — 위반 시 실패】\n1. 신고금액(申報金額/報關金額/海關申報) 문의: 어떤 설명·확인·추측도 하지 말고 「關於申報金額的部分，我們幫您向負責同事確認後回覆您。」만 답변\n2. 詐騙·詐欺·消保官·律師·爆料·檢舉·提告 키워드 포함 시: 내용 답변·반박 없이 「這部分會由專人盡快與您聯繫，請稍候。」만 답변\n3. 절대 금지: 도착일 확약 / 보상·환불·관세 면제 임의 약속 / 모르는 내용 지어내기 (모르면 상담사 연결)\n4. 금액 확정 금지: 운임 등은 계산 방식·구간표 안내까지만, 개별 건 확정 금액은 상담사\n5. 이모지 사용 금지\n\n【중요】VEASLY의 고객은 거의 100% 대만 고객입니다. 고객이 중국어로 질문하면 반드시 繁體中文으로 답변하세요.\n\n【회사 및 서비스 성격】\nVEASLY는 한국 회사가 운영하는 한국 상품 구매 및 국제배송 지원 서비스입니다. 대만 현지 소매점이 아닙니다.\n적용 기준: VEASLY 공식 약관 및 대한민국 관련 법령. 단, 법률상 배제할 수 없는 강행 소비자보호 규정은 제한하지 않음.\n\n【답변 규칙】\n1. 고객 언어에 맞춰 답변 (대만→繁體中文, 한국어→한국어)\n2. 금액은 지식베이스에 적힌 통화 그대로 표시\n3. 확실하지 않으면 "담당자를 연결해 드리겠습니다"\n4. 마크다운 서식 사용 금지\n5. 절대 구체적인 날짜, 출고 시간, 세관 상태 등을 지어내지 마세요\n6. 배송 관련: 시스템이 제공한 주문 상태만 인용\n7. 【구매 요청】veasly.com에서 申請報價 안내. 채팅으로 주문 받지 마세요\n8. 【정책 근거】운임·무료배송·취소·환불·합배송·배송기간·EZ WAY/통관·반품·번개장터·결제수단·견적 진도·회신 채널·탈퇴·보관/폐기 등 모든 정책은 아래 【參考知識庫】(노션 SOP·FAQ)만 근거로 답한다. 지식에 없는 숫자·기한·금액·절차는 말하지 말고 상담사 연결. 【內部】 표기·SOP 번호·판단 과정은 고객에게 노출 금지\n9. 【환각금지】프롬프트에 명시되지 않은 시스템 기능/프로세스를 절대 지어내지 마세요. 모르면 상담사 연결\n10. 【영수증】대만 통일發票 미제공\n11. 【결제금액 불일치】APP 사용 여부 확인 후 웹버전(veasly.com/tw) 안내'
};
async function initializeAI() {
  // Claude(llm) 하나만 확인. Gemini/Pinecone 초기화 없음.
  AI_ENABLED = llm.isEnabled();
  if (AI_ENABLED) {
    console.log('[AI] 답변모드: Claude+Notion (model=' + llm.MODEL + ') | 지식: ' + KNOWLEDGE_PATH);
  } else {
    console.warn('[AI] 비활성 — ANTHROPIC_API_KEY 미설정 (답변 생성 불가, 사람 연결로 폴백)');
  }
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

// [⑦ 의도 분류] 카테고리 라벨(관찰용). 분류는 classifyIntentClaude 사용.
var INTENT_CATEGORIES = ['order_status', 'shipping', 'return_refund', 'product', 'survey_csat', 'warehouse_package', 'account_payment', 'complaint', 'unclear'];

// [넘김 자동분류+요약] 상담 대화를 읽고 (1) 6개 넘김 사유 중 하나 (2) 2~3줄 상황 요약을 한 번에 생성.
// 노션 "CS 넘김" DB 자동적재에 사용. 실패 시 {reasonCode:null, summary:''} 반환(폴백은 호출측).
// [2026-07-10] 출력 포맷 JSON→줄기반(REASON:/SUMMARY:)으로 변경. summary는 자유 번체 텍스트라
//   JSON 문자열 이스케이프(미이스케이프 "·줄바꿈)로 JSON.parse 가 깨지던 문제("Unterminated string
//   in JSON")를 원천 제거. 자유 텍스트엔 이스케이프 개념이 없어, REASON 숫자와 SUMMARY 이후 전체를
//   관대하게 추출한다(정규식은 throw 하지 않음 → 파싱 단계 실패 자체가 사라짐).
function parseHandoffResponse(raw) {
  raw = (raw || '').trim();
  if (!raw) return { reasonCode: null, summary: '' };
  var rm = raw.match(/REASON\s*[:：]?\s*([1-6])/i);   // 사유: REASON 라벨 뒤 1~6 한 자리
  var reasonCode = rm ? rm[1] : null;
  var sm = raw.match(/SUMMARY\s*[:：]?\s*([\s\S]*)$/i); // 요약: SUMMARY 라벨부터 끝까지(줄바꿈 포함)
  var summary = sm ? sm[1] : '';
  if (!summary) {                                     // SUMMARY 라벨이 없으면 REASON 줄만 걷어내고 나머지를 요약으로
    summary = raw.replace(/REASON\s*[:：]?\s*[1-6][^\S\r\n]*[\r\n]*/i, '');
  }
  summary = summary.replace(/^```[a-z]*\s*/i, '').replace(/\s*```\s*$/i, '').trim().slice(0, 1500);
  return { reasonCode: reasonCode, summary: summary };
}

async function classifyHandoff(conversationText) {
  if (!conversationText || !llm.isEnabled()) return { reasonCode: null, summary: '' };
  var hPrompt = '你是 VEASLY 客服品質分析員。以下是一段需要轉交專人處理的客服對話。請完成兩件事：\n' +
    '1. reason：從下列 6 類中選「一個」最符合的轉交原因，只用代號數字：\n' +
    '   1=賣家糾紛(韓國賣家或二手交易爭議) 2=政策例外(超出標準政策的特例請求) 3=財務退款(退款金額爭議、15日財務結算) 4=通關物流品牌(清關/EZWAY/國際運送/品牌方問題) 5=系統錯誤(網站或APP異常) 6=其他\n' +
    '2. summary：用繁體中文 2~3 句（150 字以內）總結「客戶遇到什麼狀況、卡在哪、需要專人處理什麼」。只根據對話內容，不要臆測未發生的事。\n\n' +
    '對話內容：\n' + conversationText + '\n\n' +
    '請「嚴格」依下列格式輸出，正好兩行；不要使用 JSON、不要加引號或任何其他文字：\n' +
    'REASON: <1到6的數字>\n' +
    'SUMMARY: <繁體中文摘要>';
  try {
    var res = await llm.generate({ user: hPrompt, maxTokens: 800 }); // Claude
    var raw = (res && res.text) || '';
    if (!raw) return { reasonCode: null, summary: '' };
    var parsed = parseHandoffResponse(raw);
    if (!parsed.reasonCode && !parsed.summary) { // 둘 다 못 뽑으면 원문+stopReason 로깅(향후 진단용)
      console.error('[AI][handoff] classify unparseable | stop:', (res && res.stopReason) || '?', '| raw:', raw.slice(0, 300));
    }
    return { reasonCode: parsed.reasonCode || null, summary: parsed.summary || '' };
  } catch (e) {
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
  // [2026-07-06] 답변은 Claude + 노션 지식(knowledge.md) 단일 경로. Pinecone/Gemini 제거됨.
  return await generateAnswerClaude(userMessage, language, chatId, chatHistory);
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
    answer = toTaiwanMandarin(answer, language); // [2026-07-10] 대만 화어 정규화(대륙식 간체·어휘 드리프트 차단)

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

// [2026-07-06] Pinecone 폐기 → no-op 스텁(잔재 호출 안전용). 지식은 노션 knowledge.md 단일 소스.
async function addToKnowledgeBase() { return; }

function isReady() { return AI_ENABLED; }

module.exports = { initializeAI, generateAnswer, classifyHandoff, addToKnowledgeBase, isReady, toTaiwanMandarin, parseHandoffResponse };
