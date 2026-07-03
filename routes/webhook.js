var fs = require('fs');
var path = require('path');
var express = require('express');

// === FCR (First Contact Resolution) Tracker ===
var fcrDataPath = path.join(__dirname, '..', 'data', 'fcr-tracker.json');
function loadFCRData() {
  try { return JSON.parse(fs.readFileSync(fcrDataPath, 'utf8')); } catch(e) { return { resolved: [], reopened: [] }; }
}
var fcrWriteLock = false;
function saveFCRData(data) {
  if (data.resolved.length > 2000) data.resolved = data.resolved.slice(-2000);
  if (data.reopened.length > 1000) data.reopened = data.reopened.slice(-1000);
  if (fcrWriteLock) { console.log("[FCR] Write lock active, retry in 100ms"); setTimeout(function() { saveFCRData(data); }, 100); return; }
  fcrWriteLock = true;
  try { fs.writeFileSync(fcrDataPath, JSON.stringify(data, null, 2)); } finally { fcrWriteLock = false; }
}
function trackFCR(userId, chatId, issueType) {
  if (!userId) return;
  var fcr = loadFCRData();
  var now = Date.now();
  var cutoff72h = now - (72 * 60 * 60 * 1000);
  // Check if same user had a resolved conversation in last 72h (different chatId only)
  var recentResolved = fcr.resolved.filter(function(r) {
    return r.userId === userId && r.chatId !== chatId && r.timestamp > cutoff72h;
  });
  if (recentResolved.length > 0) {
    // Check if already recorded as reopened for this chatId
    var alreadyReopened = fcr.reopened.some(function(r) {
      return r.chatId === chatId && r.userId === userId;
    });
    if (!alreadyReopened) {
      fcr.reopened.push({
        timestamp: now,
        userId: userId,
        chatId: chatId,
        issueType: issueType || 'unknown',
        previousChatId: recentResolved[recentResolved.length - 1].chatId
      });
      console.log('[FCR] Repeat inquiry detected - userId:', userId, 'chatId:', chatId, 'prev:', recentResolved[recentResolved.length - 1].chatId);
      saveFCRData(fcr);
    }
  }
}
function recordFCRResolved(userId, chatId, issueType) {
  if (!userId) return;
  var fcr = loadFCRData();
  // 같은 chatId가 이미 resolved에 있으면 중복 기록 방지
  var alreadyResolved = fcr.resolved.some(function(r) {
    return r.chatId === chatId;
  });
  if (alreadyResolved) return;
  fcr.resolved.push({
    timestamp: Date.now(),
    userId: userId,
    chatId: chatId,
    issueType: issueType || 'unknown'
  });
  saveFCRData(fcr);
}
var router = express.Router();
var pendingCES = {};
var pendingCSATReason = {};
var csatFeedbackPath = require('path').join(__dirname, '..', 'data', 'csat-feedback.json');
function loadCSATFeedback() { try { return JSON.parse(fs.readFileSync(csatFeedbackPath, 'utf8')); } catch(e) { return []; } }
function saveCSATFeedback(data) { if (data.length > 1000) data = data.slice(-1000); fs.writeFileSync(csatFeedbackPath, JSON.stringify(data, null, 2)); }

// LEGACY: cesDataPath removed - use lib/ces.js
function loadCESData() {
  try { return JSON.parse(fs.readFileSync(cesDataPath, 'utf8')); } catch(e) { return []; }
}
// LEGACY: saveCESData removed - use cesHelper.saveResult()
var channeltalk = require('../lib/channeltalk');
var matcher = require('../lib/matcher');
var aiEngine = require('../lib/ai-engine');
var veaslyApi = require("../lib/veasly-api");
var lang = require('../lib/language');
var scheduler = require('../lib/scheduler');
var mgrStats = require('../lib/manager-stats');
var aiReview = require('../lib/ai-review');
var aiLog = require('../lib/ai-log');
var errorAlert = require('../lib/error-alert');
var bizHoursUtil = require('../lib/business-hours');
function getHolidayNotice(lang) {
  var info = bizHoursUtil.getHolidayInfo();
  if (!info.isHoliday) return null;
  var kr = info.krName || "공휴일";
  var tw = info.twName || kr;
  var m = {
    "zh-TW": "\ud83c\udfd6\ufe0f 今天是韓國國定假日（" + tw + "），客服人員休假中。\nAI小幫手可以先為您服務！",
    "ko": "\ud83c\udfd6\ufe0f 오늘은 " + kr + "(공휴일)으로 상담원이 휴무입니다.\nAI가 먼저 도와드릴게요!",
    "en": "\ud83c\udfd6\ufe0f Today is a Korean national holiday (" + tw + "). Our agents are off.\nAI assistant is here to help!",
    "ja": "\ud83c\udfd6\ufe0f 本日は韓国の祝日（" + tw + "）のため、オペレーターはお休みです。\nAIがまずお手伝いします！"
  };
  return m[lang] || m["zh-TW"];
}

var analytics = require('../lib/analytics');
var routing = require('../lib/routing');
var managersLib = require('../lib/managers');

// SOP §4 넘김 체계 태그 — 봇 핸드오프 시 자동 부여 (best-effort)
var HANDOFF_TAG = '직원 처리 불가';

var processedMessages = {};
// Dedup cleanup handled below (120s TTL)
var csatHelper = require('../lib/csat');
var cesHelper = require('../lib/ces');
var satisfactionPending = {};
// CSAT 발송 중복 방지 락 (close 이벤트 2회 트리거 대응)
var _csatSendLock = {};
var chatLanguage = {};
var managerActive = {};
var pendingEscalations = {};
var teamFollowedChats = {}; // [SOP v2] 채팅별 팀 팔로워(MIA·우선·강준) 추가 여부
var chatContext = {};
var _chatHistoryCache = {};
var _managerCache = { data: null, ts: 0 };
async function getCachedManagers() { var now = Date.now(); if (_managerCache.data && (now - _managerCache.ts) < 600000) return _managerCache.data; try { var r = await channeltalk.listManagers(); _managerCache.data = r; _managerCache.ts = now; return r; } catch(e) { console.error("[getCachedManagers] Error:", e.message); return _managerCache.data || { managers: [] }; } }



// === WAITING MESSAGE: 30min no-reply notification to customer ===
var waitingMessageSent = {};
async function sendWaitingMessage(chatId, lang) {
  if (waitingMessageSent[chatId]) return;
  waitingMessageSent[chatId] = true;
  var msgs = {
    "zh-TW": "感謝您的耐心等待！客服人員正在確認您的問題，請稍候 🙏",
    "ko": "기다려 주셔서 감사합니다! 담당자가 확인 중이에요, 조금만 기다려 주세요 🙏",
    "en": "Thank you for your patience! Our team is reviewing your case, please hold on 🙏",
    "ja": "お待ちいただきありがとうございます！担当者が確認中です、もう少々お待ちください 🙏"
  };
  try {
    await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: msgs[lang] || msgs["zh-TW"] }] });
    console.log('[WAITING-MSG] Sent to', chatId);
  } catch(e) {
    console.log('[WAITING-MSG] Error:', e.message);
  }
}
// Clean up waitingMessageSent when manager replies (max 500 entries)
function cleanWaitingMsg(chatId) {
  delete waitingMessageSent[chatId];
  if (typeof clearEscalationReminder === 'function') clearEscalationReminder(chatId);
}


setInterval(function() {
  var now = Date.now();
  Object.keys(processedMessages).forEach(function(k) {
    if (now - processedMessages[k] > 120000) delete processedMessages[k];
  });
  // 메모리 누수 방지: 24시간 이상 된 항목 정리
  Object.keys(managerActive).forEach(function(k) {
    if (now - managerActive[k] > 86400000) delete managerActive[k];
  });
  Object.keys(chatLanguage).forEach(function(k) {
    if (typeof chatLanguage[k] === 'string') {
      // chatLanguage는 타임스탬프가 없으므로 chatContext 기준으로 정리
    }
  });
  Object.keys(chatContext).forEach(function(k) {
    if (chatContext[k] && chatContext[k].lastOrderTime && (now - chatContext[k].lastOrderTime > 86400000)) delete chatContext[k];
  });
  Object.keys(satisfactionPending).forEach(function(k) {
    if (satisfactionPending[k] && satisfactionPending[k].time && (now - satisfactionPending[k].time > 3600000)) delete satisfactionPending[k];
  });
  Object.keys(pendingEscalations).forEach(function(k) {
    if (pendingEscalations[k] && pendingEscalations[k].time && (now - pendingEscalations[k].time > 86400000)) delete pendingEscalations[k];
  });
  Object.keys(_csatSendLock).forEach(function(k) {
    if (now - _csatSendLock[k] > 600000) delete _csatSendLock[k];
  });
  Object.keys(waitingMessageSent).forEach(function(k) {
    if (now - waitingMessageSent[k] > 3600000) delete waitingMessageSent[k];
  });
  Object.keys(teamFollowedChats).forEach(function(k) {
    if (now - teamFollowedChats[k] > 86400000) delete teamFollowedChats[k];
  });
}, 60000);

function extractText(message) {
  if (!message) return '';
  if (message.plainText) return message.plainText.trim();
  if (message.blocks && Array.isArray(message.blocks)) {
    return message.blocks
      .filter(function(b) { return b.type === 'text'; })
      .map(function(b) { return b.value || ''; })
      .join(' ')
      .trim();
  }
  if (message.message) return message.message.trim();
  return '';
}

function getMenuText(language) {
  var menus = {
    'zh-TW': '請輸入數字查詢：\n1️⃣ 第一次使用（新會員指南）\n2️⃣ 已下單（訂單相關）\n3️⃣ 配送/物流\n4️⃣ 費用/運費\n5️⃣ 付款方式\n6️⃣ 取消/退款\n7️⃣ 訂單查詢\n8️⃣ 怎麼下單\n9️⃣ 點數/折扣碼\n\n💡 也可以直接用文字描述問題，AI會為您解答喔！',
    'ko': '번호를 입력해주세요：\n1️⃣ 처음 이용\n2️⃣ 주문 완료\n3️⃣ 배송/물류\n4️⃣ 비용/운임\n5️⃣ 결제 방법\n6️⃣ 취소/환불\n7️⃣ 주문 조회\n8️⃣ 주문 방법\n9️⃣ 포인트/할인\n\n💡 번호 외에 직접 질문을 입력하셔도 AI가 답변해드려요!',
    'en': 'Enter a number:\n1️⃣ First time\n2️⃣ Already ordered\n3️⃣ Shipping\n4️⃣ Fees\n5️⃣ Payment\n6️⃣ Cancel/Refund\n7️⃣ Order tracking\n8️⃣ How to order\n9️⃣ Points/Coupons\n\n💡 You can also type your question directly!',
    'ja': '番号を入力してください：\n1️⃣ 初めての方\n2️⃣ 注文済み\n3️⃣ 配送\n4️⃣ 費用\n5️⃣ お支払い\n6️⃣ キャンセル/返金\n7️⃣ 注文確認\n8️⃣ 注文方法\n9️⃣ ポイント/割引\n\n💡 そのままご質問を入力いただければAIがお答えします！'
  };
  return menus[language] || menus['zh-TW'];
}

var NUMBER_TO_QUERY = {
  '1': '第一次使用',
  '2': '已下單',
  '3': '配送要多久',
  '4': '運費怎麼算',
  '5': '付款方式',
  '6': '取消退款',
  '7': '訂單查詢',
  '8': '怎麼下單',
  '9': '點數折扣'
};


// 주문 상태를 AI가 해석할 수 있는 컨텍스트로 변환
function buildOrderContext(orderItems, orderNum, lang) {
  if (!orderItems || orderItems.length === 0) return '';
  var mainStatus = (orderItems[0] && orderItems[0].status) || '';
  var statusGuide = {
    'PAYMENT_WAITING': { 'zh-TW': '此訂單尚未付款。請提醒客戶盡快完成付款，否則訂單可能被取消', 'ko': '미결제 상태. 빠른 결제 안내 필요' },
    'PAYMENT_COMPLETED': { 'zh-TW': '已收到付款，正在準備處理訂單。通常1-2個工作天開始處理', 'ko': '결제 완료, 처리 시작 예정' },
    'ORDER_PROCESSING': { 'zh-TW': '商品正在韓國境內配送到VEASLY倉庫。通常需要1-3個工作天。此階段無法取消訂單', 'ko': '한국 내 배송 중 (1-3 영업일)' },
    'SHIPPING_TO_BDJ': { 'zh-TW': '商品已到達VEASLY倉庫，正在準備國際包裹。即將寄出', 'ko': 'VEASLY 창고 도착, 국제배송 준비 중' },
    'SHIPPING_TO_HOME': { 'zh-TW': '包裹已從韓國寄出！國際配送約7-14天。客戶需要在EZ WAY APP上按「申報相符」才能通關。如果EZ WAY已申報但很久沒收到，可能是海關或國內物流延遲，建議等待或聯繫客服確認', 'ko': '한국 출발 완료. 7-14일 소요. EZ WAY 신고 필요' },
    'COMPLETED': { 'zh-TW': '訂單已完成配送', 'ko': '배송 완료' },
    'CANCEL_COMPLETED': { 'zh-TW': '訂單已取消。退款通常3-5個工作天內處理', 'ko': '취소 완료. 환불 3-5 영업일' },
    'CANCEL_REQUESTED': { 'zh-TW': '客戶已申請取消，正在處理中', 'ko': '취소 요청 처리 중' }
  };
  var guide = (statusGuide[mainStatus] && statusGuide[mainStatus][lang]) || (statusGuide[mainStatus] && statusGuide[mainStatus]['zh-TW']) || '';
  var itemNames = orderItems.map(function(item) {
    return (item.product && item.product.name) || '商品';
  }).join(', ');
  return '[訂單 ' + orderNum + ' 的狀態資訊] 狀態: ' + mainStatus + ' | 商品: ' + itemNames + ' | AI回答指南: ' + guide;
}

function isBusinessHours() {
  return bizHoursUtil.isBusinessHours();
}

// [2026-06-30 UX] 반복 푸터 억제 — 같은 대화에서 최근 10분 내 이미 '다른 질문?' 푸터를 붙였으면 생략(로봇 느낌 완화).
var _footerShown = {};
function appendFooter(chatId, text, footerMap, lang) {
  var now = Date.now();
  if (Object.keys(_footerShown).length > 3000) _footerShown = {}; // 메모리 가드
  if (_footerShown[chatId] && (now - _footerShown[chatId]) < 10 * 60 * 1000) return text; // 최근 부착 → 생략
  _footerShown[chatId] = now;
  return text + (footerMap[lang] || footerMap['zh-TW']);
}

// [2026-06-30 UX] 영업외 안내에 붙일 '다음 오픈 시각(약 N시간 후)' 한 줄. (주말/공휴일은 getNextBusinessStart가 처리)
function nextOpenText(lang) {
  try {
    var ms = bizHoursUtil.getNextBusinessStart(Date.now());
    if (!ms) return '';
    var hrs = Math.max(1, Math.round((ms - Date.now()) / 3600000));
    var kst = new Date(ms + 9 * 3600 * 1000);
    var md = (kst.getUTCMonth() + 1) + '/' + kst.getUTCDate();
    var t = {
      'zh-TW': '\n\n⏰ 預計 ' + md + ' 台灣時間 09:00（約 ' + hrs + ' 小時後）開始為您優先處理。',
      'ko': '\n\n⏰ ' + md + ' 한국시간 10:00(약 ' + hrs + '시간 후)부터 우선 처리해드려요.',
      'en': '\n\n⏰ We\'ll prioritize your message from 09:00 TW time on ' + md + ' (~' + hrs + 'h).',
      'ja': '\n\n⏰ ' + md + ' 台湾時間 09:00（約' + hrs + '時間後）から優先対応します。'
    };
    return t[lang] || t['zh-TW'];
  } catch (e) { return ''; }
}


// 대만 피크타임 감지 (대만 20:00~23:00 = KST 21:00~00:00)
function isTaiwanPeakTime() {
  const now = new Date();
  const kstHour = (now.getUTCHours() + 9) % 24;
  return kstHour >= 21 || kstHour === 0;
}

// 대만 피크타임 강화 응답 - confidence 임계값을 0.5로 낮춤
function getPeakTimeConfidenceThreshold() {
  return isTaiwanPeakTime() ? 0.5 : 0.6;
}

function isEscalationRequest(text) {
  var keywords = ['客服', '真人', '真人客服', '人工客服', '人工', '找客服', '聯繫我們', '聯繫', '상담사', '상담원', '사람', 'agent', 'human', 'operator', 'help me', 'オペレーター', '담당자', '轉接', '轉人工', '轉客服', '轉做人工', '轉接客服', '人工回答', '找人工', '真人回答', '幫我轉', '請轉', '轉接真人', '我要客服', '找真人', '需要客服', '聯絡客服', '請幫我', '幫幫我', '직원', '직원연결', '사람연결', 'talk to human', 'real person', 'live agent', 'カスタマーサービス', '人に繋いで'];
  text = text.replace(/[\\\s]+$/g, '').trim(); // clean trailing backslash/spaces
  var lower = text.toLowerCase().trim();
  for (var i = 0; i < keywords.length; i++) {
    if (lower === keywords[i].toLowerCase()) return true;
  }
  if (lower === '0') return true;
  return false;
}



async function connectManager(chatId, lang) {
  try {
    // [SOP v2 핸드오프 정책, 2026-07-03 개정] 담당자 = 강준(관리자) 초대, 팔로워 = MIA·우선, 「직원 처리 불가」 태그.
    var adminIds = await managersLib.getAdminIds();
    var assigneeId = adminIds.length > 0 ? adminIds[0] : null;
    if (!assigneeId) {
      // 이메일/이름 매칭 실패 안전장치: 첫 operator
      var mgrs = await getCachedManagers();
      var managers = (mgrs && mgrs.managers) || [];
      for (var i = 0; i < managers.length; i++) {
        if (managers[i].operator) { assigneeId = managers[i].id; break; }
      }
    }
    if (assigneeId) {
      try { await channeltalk.inviteManager(chatId, assigneeId); } catch(ie) { /* 이미 초대된 매니저 등 - 무시 */ }
      managerActive[chatId] = Date.now();
      pendingEscalations[chatId] = { time: Date.now(), managerId: assigneeId, lang: lang || "zh-TW" };
      console.log('[ESCALATION] Assignee invited:', assigneeId, 'for chat:', chatId);
    }
    try {
      var followerIds = await managersLib.getFollowerIds();
      if (followerIds.length > 0) { await channeltalk.addFollowers(chatId, followerIds); teamFollowedChats[chatId] = Date.now(); }
    } catch(fe) { console.error("[ConnectManager] Follower error:", fe.message); }
    try { await channeltalk.addChatTags(chatId, [HANDOFF_TAG]); } catch(te) { /* 태그 API 미지원 시 무시 */ }
    return assigneeId;
  } catch(e) { console.error("[ConnectManager] Error:", e.message); return null; }
}

// === 주문 소유권 검증 ===
var orderSecurityMsgs = {
  noAuth: {
    "zh-TW": "🔒 為了保護您的隱私，請先透過 veasly.com 登入後再查詢訂單喔！\n如需幫助，請聯繫客服人員！",
    "ko": "🔒 개인정보 보호를 위해 로그인 후 주문 조회가 가능합니다.\n도움이 필요하시면 고객센터에 문의해주세요!",
    "en": "🔒 Please log in via veasly.com first to check your order.\nNeed help? Contact our support team!",
    "ja": "🔒 注文確認にはveasly.comでのログインが必要です。\nお困りの場合はサポートチームへどうぞ！"
  },
  denied: {
    "zh-TW": "🔒 此訂單不屬於您的帳戶，無法查詢。\n如有疑問，請聯繫客服人員！",
    "ko": "🔒 본인의 주문만 조회 가능합니다.\n도움이 필요하시면 고객센터에 문의해주세요!",
    "en": "🔒 You can only view your own orders.\nNeed help? Contact our support team!",
    "ja": "🔒 ご自身の注文のみ確認可能です。\nお困りの場合はサポートチームへどうぞ！"
  }
};

function isMergeShippingRequest(text) {
  var mergeKeywords = ["合併寄送", "合併運送", "合併出貨", "合併配送", "一起寄", "一起送", "一起出貨", "併單", "합배송", "합배", "merge ship", "combine order", "合併寄", "合併訂單", "合併運費"];
  var lower = (text || "").toLowerCase();
  for (var i = 0; i < mergeKeywords.length; i++) {
    if (lower.indexOf(mergeKeywords[i].toLowerCase()) > -1) return true;
  }
  return false;
}


function isActionRequest(text) {
  var patterns = [
    { type: "cancel_reason", keywords: ["為什麼被取消", "為何被取消", "取消的原因", "取消原因", "為什麼取消", "왜 취소", "취소 이유", "why cancel"] },
    // [2026-05-27] refund_delay를 shipping_delay 위에 배치. "還沒收到 運費退款" 같은 환불 문의가
    // shipping_delay의 너무 넓은 "還沒收到"에 먼저 매치되어 출고 답변이 나가던 버그 수정.
    { type: "refund_delay", keywords: ["運費退款", "還沒退款", "退款還沒", "沒收到退款", "退款多久", "退款進度", "退費還沒", "退費沒收到", "退費多久", "退款怎麼還沒", "退款一直", "환불 안 됐", "환불 안 받", "환불 지연", "환불 언제", "환불 늦", "환불 안 와", "환불 안 오", "still no refund", "refund still", "refund pending", "where is my refund"] },
    { type: "shipping_delay", keywords: ["等很久", "等太久", "還沒到", "還沒收到", "一直沒收到", "遲遲沒有", "什麼時候出貨", "什麼時候寄", "何時出貨", "何時寄出", "배송 지연", "아직 안 왔", "when will ship"] },
    { type: "email_change", keywords: ["信箱填錯", "email修改", "修改信箱", "修改email", "更改信箱", "更改email", "이메일 변경", "이메일 수정", "change email"] },
    { type: "product_search", keywords: ["想找這款", "幫我找", "想找這個", "有沒有賣", "有賣嗎", "能不能幫我找", "상품 찾아", "이거 있어", "find this product"] },
    { type: "price_inquiry", keywords: ["報價", "詢問價格", "多少錢", "가격 문의", "얼마"] },
    { type: "order_modify", keywords: ["修改訂單", "更改訂單", "修改地址", "更改地址", "주문 수정", "주소 변경", "change address", "modify order"] }
  ];
  var lower = (text || "").toLowerCase();
  for (var i = 0; i < patterns.length; i++) {
    for (var j = 0; j < patterns[i].keywords.length; j++) {
      if (lower.indexOf(patterns[i].keywords[j].toLowerCase()) > -1) return patterns[i].type;
    }
  }
  return null;
}

function isGreeting(text) {
  var lower = text.toLowerCase().trim();
  var exactGreetings = ['你好', '您好', '哈囉', 'hi', 'hello', '안녕', '안녕하세요', 'hey', 'こんにちは', '嗨', 'halo', '早安', '午安', '晚安'];
  for (var i = 0; i < exactGreetings.length; i++) {
    if (lower === exactGreetings[i]) return true;
  }
  if (/^(你好|您好|哈囉|嗨|hi|hello|hey|안녕)[!！~～？?。.]*$/i.test(lower)) return true;
  return false;
}

function isThankYou(text) {
  var lower = text.toLowerCase().trim();
  if (lower.length > 40) return false;
  // 정확 매칭 (기존)
  var exactThanks = ['謝謝', '感謝', '谢谢', '感谢', '太好了', '好的謝謝', '好的感謝', '知道了感謝', '非常感謝', '太感謝了', 'thanks', 'thank you', 'thx', 'ありがとう', '감사합니다', '감사', '고마워'];
  for (var i = 0; i < exactThanks.length; i++) {
    if (lower === exactThanks[i] || lower === exactThanks[i] + '!' || lower === exactThanks[i] + '~' || lower === exactThanks[i] + '！' || lower === exactThanks[i] + '～') return true;
  }
  // 부분 매칭: 감사 키워드 포함 + 질문 키워드 미포함
  var thankKeywords = ['謝謝', '感謝', '谢谢', '感谢', 'thanks', 'thank you', 'thx', 'ありがとう', '감사'];
  var questionKeywords = ['請問', '想問', '想請問', '可以', '怎麼', '什麼', '嗎', '？', '?', '如何', '요?', '까요', '나요'];
  var hasThank = false;
  var hasQuestion = false;
  for (var j = 0; j < thankKeywords.length; j++) {
    if (lower.indexOf(thankKeywords[j]) >= 0) { hasThank = true; break; }
  }
  for (var k = 0; k < questionKeywords.length; k++) {
    if (lower.indexOf(questionKeywords[k]) >= 0) { hasQuestion = true; break; }
  }
  // 대만 고객 흔한 패턴: "好的謝謝", "了解 謝謝", "OK感謝", "收到感謝"
  var twPatterns = ['好的', '了解', '收到', 'ok', '知道了', '明白', '好喔', '好哦', '好唷', '好ㄉ'];
  var hasTwPrefix = false;
  for (var p = 0; p < twPatterns.length; p++) {
    if (lower.indexOf(twPatterns[p]) >= 0) { hasTwPrefix = true; break; }
  }
  if (hasThank && !hasQuestion) return true;
  if (hasTwPrefix && hasThank) return true;
  // "好的", "了解", "收到" 단독도 감사로 처리 (대만에서 대화 종료 신호)
  var closingWords = ['好的', '了解', '收到', '知道了', '明白了', 'ok', '好喔', '好哦'];
  for (var c = 0; c < closingWords.length; c++) {
    if (lower === closingWords[c] || lower === closingWords[c] + '!' || lower === closingWords[c] + '~') return true;
  }
  return false;
}

function isSatisfactionResponse(text) {
  var ratings = ['⭐', '👍', '👎', '1', '2', '3', '4', '5'];
  var keywords = ['좋아', '좋았', '만족', '감사', '고마', 'good', 'great', 'thank', 'satisfied', '很好', '滿意', '感謝', '謝謝', '不好', '不滿', '差', 'bad', 'poor', '별로', '나빠'];
  var lower = text.toLowerCase().trim();
  for (var i = 0; i < ratings.length; i++) {
    if (lower === ratings[i]) return true;
  }
  for (var j = 0; j < keywords.length; j++) {
    if (lower.indexOf(keywords[j]) !== -1) return true;
  }
  return false;
}

function isSystemEvent(text) {
  var lower = text.toLowerCase().trim();
  if (/^(joined|left|opened|closed|assigned|snoozed|unsnoozed)$/i.test(lower)) return true;
  if (lower.indexOf('스티커를 전송했습니다') !== -1) return true;
  if (lower.indexOf('sticker') !== -1 && lower.length < 30) return true;
  return false;
}

function looksLikeOrderNumber(text) {
  var lines = text.trim().split(/[\n\r,\s]+/);
  for (var i = 0; i < lines.length; i++) {
    if (/^\d{8}TW\d+$/i.test(lines[i].trim())) return true;
  }
  return false;
}

function extractOrderNumbers(text) {
  var matches = text.match(/\d{8}TW\d+/gi);
  return matches || [];
}

function getEscalationStep(chatId) {
  if (!chatContext[chatId]) chatContext[chatId] = {};
  return chatContext[chatId].escalationStep || 0;
}

function setEscalationStep(chatId, step) {
  if (!chatContext[chatId]) chatContext[chatId] = {};
  chatContext[chatId].escalationStep = step;
}


// === ESCALATION REMINDER: 15min no-reply from manager ===
var ESCALATION_REMINDER = {};
function scheduleEscalationReminder(chatId, lang) {
  if (ESCALATION_REMINDER[chatId]) clearTimeout(ESCALATION_REMINDER[chatId]);
  ESCALATION_REMINDER[chatId] = setTimeout(async function() {
    try {
      // Check if manager has replied
      if (managerActive[chatId] && !pendingEscalations[chatId]) return;
      var reminderMsgs = {
        'zh-TW': '🔔 提醒：已等待15分鐘，客服人員正在盡快處理您的問題，請稍候！',
        'ko': '🔔 알림: 15분 경과하였습니다. 담당자가 최대한 빨리 답변드리겠습니다!',
        'en': '🔔 Reminder: 15 minutes have passed. Our team will respond as soon as possible!',
        'ja': '🔔 お知らせ：15分経過しました。担当者ができるだけ早くご対応いたします！'
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: reminderMsgs[lang] || reminderMsgs['zh-TW'] }] });
      console.log('[REMINDER] 15min escalation reminder sent to:', chatId);
    } catch(e) { console.log('[REMINDER] Error:', e.message); }
    delete ESCALATION_REMINDER[chatId];
  }, 15 * 60 * 1000); // 15 minutes
}
function clearEscalationReminder(chatId) {
  if (ESCALATION_REMINDER[chatId]) { clearTimeout(ESCALATION_REMINDER[chatId]); delete ESCALATION_REMINDER[chatId]; }
}
router.post('/channeltalk', async function(req, res) {
  try {
    var body = req.body || {};
    var event = body.event || '';
    var type = (body.type || '').toLowerCase();
    var entity = body.entity;

    // 디버그: 모든 웹훅 이벤트 로깅
    console.log('[Webhook] Event received:', event, '| type:', type, '| state:', entity && entity.state ? entity.state : '-');

    if (type === 'userchat' && event === 'update') {
      var closedChat = entity;
      if (closedChat && closedChat.state === 'closed') {
        var chatId0 = closedChat.id;
        var surveyLang = chatLanguage[chatId0] || 'zh-TW';
        var surveyMsg;
        var stats_managerId = null;
        try { var _ms = require("../lib/manager-stats"); var _st = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "data", "manager-stats.json"), "utf8")); if (_st.chats && _st.chats[chatId0]) stats_managerId = _st.chats[chatId0].managerId; } catch(e) {}
        var _csatType = managerActive[chatId0] ? "manager" : "bot";
        // 유저 정보 조회 (회원 여부, 이메일)
        var _userInfo = { member: false, email: '', veaslyId: '', name: '' };
        try {
          var _userData = await channeltalk.getUser(closedChat.userId || '');
          if (_userData && _userData.user) {
            var _u = _userData.user;
            _userInfo.member = _u.member === true;
            _userInfo.email = _u.email || (_u.profile && _u.profile.email) || '';
            _userInfo.veaslyId = (_u.profile && _u.profile.veasly_id) || _u.memberId || '';
            _userInfo.name = _u.name || (_u.profile && _u.profile.name) || '';
          } else if (_userData) {
            _userInfo.member = _userData.member === true;
            _userInfo.email = _userData.email || (_userData.profile && _userData.profile.email) || '';
            _userInfo.veaslyId = (_userData.profile && _userData.profile.veasly_id) || _userData.memberId || '';
            _userInfo.name = _userData.name || (_userData.profile && _userData.profile.name) || '';
          }
        } catch(_ue) { console.log('[CSAT] User info fetch error:', _ue.message); }
        var _baseUrl = "https://veasly-dashboard.gangjun-lee.workers.dev/survey.html";
        var _surveyUrl = _baseUrl + "?cid=" + chatId0 + "&uid=" + (closedChat.userId || "") + "&lang=" + surveyLang + "&type=" + _csatType + "&ts=" + Math.floor(Date.now()/1000) + "&member=" + (_userInfo.member ? "1" : "0") + "&email=" + encodeURIComponent(_userInfo.email) + "&vid=" + encodeURIComponent(_userInfo.veaslyId) + "&name=" + encodeURIComponent(_userInfo.name || _userInfo.email || "");
        var csatLinkMsgs = {
          'zh-TW': '💬 感謝您的諮詢！\n\n花30秒幫我們填個小問卷，您的意見是我們進步的動力 🙏\n\n👉 <link type="url">' + _surveyUrl + '</link>',
          'ko': '💬 상담이 종료되었습니다！\n\n30초만 투자해서 간단한 설문에 답해주세요 🙏\n\n👉 <link type="url">' + _surveyUrl + '</link>',
          'en': '💬 Thank you for reaching out!\n\nPlease take 30 seconds to share your feedback 🙏\n\n👉 <link type="url">' + _surveyUrl + '</link>',
          'ja': '💬 お問い合わせありがとうございます！\n\n30秒でアンケートにご協力ください 🙏\n\n👉 <link type="url">' + _surveyUrl + '</link>'
        };
        surveyMsg = csatLinkMsgs[surveyLang] || csatLinkMsgs['zh-TW']
        // REMOVED: escalation-close CSAT (자동종료 시에만 발송)
        // REMOVED: CSAT survey sendMessage (자동종료 시에만 발송)
        // === CSAT 발송 복원 (3중 안전장치) ===
        // 1차: 메모리 락 (_csatSendLock) - 동시 close 이벤트 방지
        // 2차: csatHelper.alreadySent - 파일 기반 영구 기록
        // 3차: markSent 즉시 호출 - 발송 전에 기록
        // CSAT on close: removed (not supported by webhook scope)


        // AI quality review for manager conversations
        if (closedChat) {
          // Fallback: extract managerId from chat messages if stats missing
          if (!stats_managerId) {
            try {
              var _msgData = await channeltalk.getChatMessages(chatId0, 50);
              var _msgs = (_msgData.messages || _msgData || []);
              for (var _mi = 0; _mi < _msgs.length; _mi++) {
                if (_msgs[_mi].personType === 'manager' && _msgs[_mi].personId) {
                  stats_managerId = _msgs[_mi].personId;
                  break;
                }
              }
            } catch(_me) {}
          }
          if (stats_managerId) {
          (async function(cid, mid) {
            try {
              var msgData = await channeltalk.getChatMessages(cid, 50);
              var msgs = (msgData.messages || msgData || []);
              if (msgs && msgs.length > 2) {
                var formatted = msgs.map(function(m) {
                  return { role: m.personType === "manager" ? "manager" : "customer", text: m.plainText || m.message || "" };
                }).filter(function(m) { return m.text; });
                if (formatted.length > 2) {
                  await aiReview.evaluateConversation(cid, mid, formatted);
                }
              }
            } catch(revErr) { console.error("[AIReview] Trigger error:", revErr.message); }
          })(chatId0, stats_managerId);
          }
        }
        // Record FCR resolved
        try {
          var _closeUserId = '';
          if (closedChat.userId) _closeUserId = closedChat.userId;
          else if (closedChat.memberId) _closeUserId = closedChat.memberId;
          if (_closeUserId) recordFCRResolved(_closeUserId, chatId0, 'closed');
        } catch(fcrErr) { console.log('[FCR] Record error:', fcrErr.message); }
        delete managerActive[chatId0];
        delete chatContext[chatId0];
      }
      return res.status(200).send('OK');
    }

    if (type !== 'message') return res.status(200).send('OK');
    if (!['upsert', 'push'].includes(event)) return res.status(200).send('OK');

    var message = entity;
    if (!message) return res.status(200).send('OK');
    var msgId = message.id || '';
    if (processedMessages[msgId]) return res.status(200).send('OK');
    processedMessages[msgId] = Date.now();

        var personType = (message.personType || '').toLowerCase();
    var chatType = (message.chatType || '').toLowerCase();
    var chatId = message.chatId || message.userChatId || '';

    if (personType === "manager") {
      if (chatId) {
        managerActive[chatId] = Date.now();
        var mgrPersonId = message.personId || "unknown";
        var mgrText = extractText(message);
        // Record manager performance stats
        if (mgrText) {
          mgrStats.recordReply(mgrPersonId, chatId, mgrText.length);
          if (pendingEscalations[chatId]) { cleanWaitingMsg(chatId);
      delete pendingEscalations[chatId]; }
        }
        // [② 2026-05-22 비활성화] 매니저 메시지 KB 자동적재 중단.
        // 검증 없는 일회성/고객특정 발언이 RAG '참고자료'를 오염시킴(원인 D).
        // 재활성화: 아래 조건의 'false &&' 제거. (기존 manager 네임스페이스 누적분은 별도 정리 필요)
        if (false && mgrText && mgrText.length > 10 && aiEngine.isReady()) {
          aiEngine.addToKnowledgeBase(
            "mgr_" + chatId + "_" + Date.now(),
            mgrText,
            { namespace: "manager", source: "manager_reply", chatId: chatId, timestamp: new Date().toISOString() }
          ).catch(function(e){ console.error("[Learn] manager save error:", e.message); });
          console.log("[Learn] Manager reply saved:", mgrText.substring(0, 50));
        }
      }
      return res.status(200).send("OK");
    }
    if (personType === 'bot') return res.status(200).send('OK');
    if (chatType !== 'userchat') return res.status(200).send('OK');

    var userText = extractText(message);

    if (!userText || !chatId) return res.status(200).send('OK');
    mgrStats.recordUserMessage(chatId);
    if (isSystemEvent(userText)) return res.status(200).send('OK');

    if (managerActive[chatId]) {
      var _mgrElapsed = Date.now() - managerActive[chatId];
      var _mgrTimeoutMs = 2 * 60 * 60 * 1000; // 2시간
      if (_mgrElapsed > _mgrTimeoutMs) {
        // 마지막 매니저 활동 후 2시간 경과 → AI 다시 활성화
        delete managerActive[chatId];
        if (pendingEscalations[chatId]) delete pendingEscalations[chatId];
        console.log("[ManagerActive] Auto-released after 2h for chat:", chatId);
      } else {
        return res.status(200).send('OK');
      }
    }

    // VEASLY member lookup
    var veaslyUser = null;
    var personId = message.personId || "";
    if (personId) {
      try {
        var chUser = await channeltalk.getUser(personId);
        var userProfile = (chUser && chUser.user) || chUser || {};
        var memberEmail = userProfile.email || (userProfile.profile && userProfile.profile.email) || "";
        var userLang = userProfile.language || (userProfile.profile && userProfile.profile.language) || "";
        var memberId = userProfile.memberId || "";
        if (memberId) {
          veaslyUser = await veaslyApi.findUserById(memberId, memberEmail);
        } else if (memberEmail) {
          veaslyUser = await veaslyApi.findUserByEmail(memberEmail);
        }
        if (veaslyUser) {
          console.log("[Member] Matched:", veaslyUser.name, "| ID:", veaslyUser.id, "| Orders:", veaslyUser.requestCount, "| Credit:", veaslyUser.credit);
          // Sync VEASLY info + auto-tags to ChannelTalk profile
          try {
            var orderCount = veaslyUser.requestCount || 0;
            var credit = veaslyUser.credit || 0;

            // Calculate customer tier tag
            var tierTag = "새회원";
            if (orderCount >= 20) tierTag = "VIP";
            else if (orderCount >= 10) tierTag = "우수회원";
            else if (orderCount >= 5) tierTag = "단골회원";
            else if (orderCount >= 2) tierTag = "재구매";
            else if (orderCount >= 1) tierTag = "첫구매완료";

            // Calculate shipping status from recent orders
            var shippingTag = "";
            try {
              var recentOrders = await veaslyApi.getUserOrders(veaslyUser.email, 5, memberId);
              if (recentOrders && recentOrders.length > 0) {
                var activeItems = [];
                for (var oi = 0; oi < recentOrders.length; oi++) {
                  var orderItems = recentOrders[oi].items || [];
                  for (var oj = 0; oj < orderItems.length; oj++) {
                    if (orderItems[oj].status && orderItems[oj].status !== "COMPLETED" && orderItems[oj].status !== "CANCEL_COMPLETED") {
                      activeItems.push(orderItems[oj].status);
                    }
                  }
                }
                if (activeItems.indexOf("SHIPPING_TO_HOME") > -1) shippingTag = "국제배송중";
                else if (activeItems.indexOf("SHIPPING_TO_BDJ") > -1) shippingTag = "물류센터이동";
                else if (activeItems.indexOf("ORDER_PROCESSING") > -1) shippingTag = "주문처리중";
                else if (activeItems.indexOf("PAYMENT_COMPLETED") > -1) shippingTag = "결제완료";
              }
            } catch(tagErr) {}

            // Point status tag
            var pointTag = "";
            if (credit >= 10000) pointTag = "포인트VIP";
            else if (credit >= 5000) pointTag = "포인트많음";
            else if (credit >= 1000) pointTag = "포인트보유";

            var profileData = {
              "veasly_id": String(veaslyUser.id),
              "veasly_orders": orderCount,
              "veasly_points": credit,
              "veasly_provider": veaslyUser.provider || "",
              "veasly_role": veaslyUser.role || "",
              "veasly_joined": (veaslyUser.createdAt || "").substring(0, 10),
              "veasly_tier": tierTag,
              "veasly_shipping": shippingTag,
              "veasly_point_tier": pointTag
            };

            await channeltalk.updateUser(personId, profileData);
            console.log("[Sync] Profile updated for", personId, "| Tier:", tierTag, shippingTag ? "| Ship:" + shippingTag : "");
          } catch(syncErr) { console.error("[Sync] Error:", syncErr.message); }
        }
      } catch(mErr) { console.error("[Member] Lookup error:", mErr.message); }
    }
    var detectedLang = lang.detectLanguage(userText);
    // Override with ChannelTalk user language if text is ambiguous (numbers, order numbers, etc.)
    if (userLang && /^[a-zA-Z0-9\s\-\.\,\/\@\#]+$/.test(userText)) {
      var langMap = {"ko": "zh-TW", "ja": "ja", "en": "en", "zh": "zh-TW", "zh-TW": "zh-TW", "zh-CN": "zh-TW"};
      if (langMap[userLang]) detectedLang = langMap[userLang];
    }
    chatLanguage[chatId] = detectedLang;
    var chatSource = "web";
    try { var srcData = JSON.parse(req.body.entity || "{}"); if (srcData.source && srcData.source.medium && srcData.source.medium.mediumType === "app") chatSource = "LINE"; } catch(se) {}
    try { var lf = require("path").join(__dirname, "..", "data", "chat-languages.json"); var ld = {}; try { ld = JSON.parse(fs.readFileSync(lf, "utf8")); } catch(e) {} ld[chatId] = detectedLang; fs.writeFileSync(lf, JSON.stringify(ld), "utf8"); } catch(e) {}

    // Track FCR for returning users (placed after member lookup so memberId is populated)
    trackFCR(memberId || personId || "", chatId, "");

    // [SOP v2 팔로워 정책, 2026-07-03 개정] 모든 채팅에 기본 팔로워(MIA·우선)만 추가.
    // 강준은 봇 핸드오프 시 담당자로 초대 (connectManager). (봇 응답은 계속 — managerActive 미설정)
    if (!teamFollowedChats[chatId]) {
      teamFollowedChats[chatId] = Date.now();
      try {
        var _followIds = await managersLib.getFollowerIds();
        if (_followIds.length > 0) await channeltalk.addFollowers(chatId, _followIds);
        console.log('[Follower] Default followers set (' + _followIds.length + ') for chat:', chatId);
      } catch(_tfErr) { console.error('[Follower] Team add error:', _tfErr.message); }
    }

    // ============================================================
    // [SOP v2 행동 규칙 — 최상위 우선순위. 다른 어떤 핸들러보다 먼저 평가]
    // 규칙 2: 분쟁 키워드(詐騙·詐欺·消保官·律師·爆料·檢舉·提告) → 즉시 핸드오프.
    // 내용에 대한 답변·반박 절대 금지 — 고정 문구만.
    if (routing.isDisputeMessage(userText)) {
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: routing.DISPUTE_REPLY }] });
      await connectManager(chatId, detectedLang);
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || '', lang: detectedLang, type: 'escalation', userMessage: userText.substring(0, 200), aiResponse: 'SOP v2 분쟁 키워드 → 즉시 핸드오프 (고정 문구)', escalated: true, escalationReason: 'dispute_keyword', confidence: 1.0, category: 'complaint' });
      return res.status(200).send('OK');
    }
    // 규칙 1: 신고금액(申報金額/報關金額/海關申報) 문의 → 어떤 설명·확인·추측도 금지.
    // 고정 문구만 응답 후 상담원 핸드오프.
    if (routing.isDeclaredAmountInquiry(userText)) {
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: routing.DECLARED_AMOUNT_REPLY }] });
      await connectManager(chatId, detectedLang);
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || '', lang: detectedLang, type: 'escalation', userMessage: userText.substring(0, 200), aiResponse: 'SOP v2 신고금액 → 고정 응답 + 핸드오프', escalated: true, escalationReason: 'declared_amount', confidence: 1.0, category: 'account_payment' });
      return res.status(200).send('OK');
    }
    // ============================================================

    // CSAT dissatisfaction reason handler
    // [2026-06-30] 인-챗 점수/사유 폐지 — 링크 설문만 사용 (false 가드로 비활성화)
    if (false && pendingCSATReason[chatId]) {
      var reasonText = (userText || '').trim();
      if (reasonText.length > 0 && reasonText.length <= 500) {
        var feedback = loadCSATFeedback();
        feedback.push({
          timestamp: new Date().toISOString(),
          chatId: chatId,
          userId: pendingCSATReason[chatId].userId,
          csatScore: pendingCSATReason[chatId].csatScore,
          reason: reasonText,
          lang: detectedLang
        });
        saveCSATFeedback(feedback);
        delete pendingCSATReason[chatId];
        var reasonThanks = {
          'zh-TW': '非常感謝您寶貴的意見！我們會認真檢討並改善，期待下次能給您更好的體驗 🙏',
          'ko': '소중한 의견 감사합니다! 꼭 개선하겠습니다. 더 나은 서비스로 보답하겠습니다 🙏',
          'en': 'Thank you so much for sharing! We will work hard to improve your experience 🙏',
          'ja': '貴重なご意見ありがとうございます！改善に全力で取り組みます 🙏'
        };
        await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: reasonThanks[detectedLang] || reasonThanks['zh-TW'] }] });
        // 사유 응답 완료 (채팅은 open 유지 → 16h에 자동종료)
        console.log('[CSAT-REASON] Feedback saved for chat:', chatId, '| Score:', pendingCSATReason[chatId] ? pendingCSATReason[chatId].csatScore : '?', '| Reason:', reasonText.substring(0, 50));
        aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || '', userName: '', lang: detectedLang, type: 'csat_feedback', userMessage: reasonText, aiResponse: 'CSAT feedback recorded', escalated: false, confidence: 1.0, category: 'other' });
        return res.status(200).send('OK');
      }
      if (Date.now() - pendingCSATReason[chatId].timestamp > 600000) {
        delete pendingCSATReason[chatId];
      }
    }
    // CES response handler
    // [2026-06-30] 인-챗 CES 폐지 — 링크 설문만 사용 (false 가드로 비활성화)
    if (false && cesHelper.isPending(chatId)) {
      var cesText = (userText || '').trim();
      var cesNum = parseInt(cesText);
      if (cesNum >= 1 && cesNum <= 5) {
        cesHelper.saveResult({
        /* saved via cesHelper */ 
          timestamp: new Date().toISOString(),
          chatId: chatId,
          userId: (cesHelper.getPending(chatId)||{}).userId || '',
          score: cesNum,
          managerId: (cesHelper.getPending(chatId)||{}).managerId || ''
        });
        cesHelper.removePending(chatId);
        var cesThanks = {
          "zh-TW": "感謝您的回饋！祝您購物愉快 😊",
          "ko": "소중한 의견 감사합니다! 즐거운 쇼핑 되세요 😊",
          "en": "Thank you for your feedback! Happy shopping 😊",
          "ja": "フィードバックありがとうございます！お買い物をお楽しみください 😊"
        };
        await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: cesThanks[detectedLang] || cesThanks["zh-TW"] }] });
        console.log("[CES] Score recorded:", cesNum, "for chat:", chatId);
        // CES 완료 (채팅은 open 유지 → 16h에 자동종료)
        aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || '', userName: '', lang: detectedLang, type: 'ces_response', userMessage: cesText, aiResponse: 'CES score: ' + cesNum, escalated: false, confidence: 1.0, category: 'other' });
        return res.status(200).send('OK');
      }
      // 10분 지나면 만료
      if (!cesHelper.isPending(chatId)) { // 만료는 cesHelper가 자동 처리
        cesHelper.removePending(chatId);
      }
    }

    // Restore previous language for CSAT/CES numeric responses
    if (/^[1-5]$/.test(userText.trim())) {
      if (chatLanguage[chatId] && chatLanguage[chatId] !== detectedLang) {
        // Keep previous chat language for numeric input
      } else {
        try {
          var clFile = require("path").join(__dirname, "..", "data", "chat-languages.json");
          var clData = JSON.parse(fs.readFileSync(clFile, "utf8"));
          if (clData[chatId]) detectedLang = clData[chatId];
        } catch(e) {}
      }
      if (chatLanguage[chatId]) detectedLang = chatLanguage[chatId];
    }
    
    // CSAT response handler
    // [2026-06-30] 인-챗 점수 수신 폐지 — 링크 설문만 사용 (메뉴 '1' 오인 버그도 해소; false 가드)
    if (false && scheduler.isCSATPending(chatId)) {
      var csatScore = scheduler.parseCSATResponse(userText);
      if (csatScore !== null) {
        // Record CSAT score
        scheduler.saveCSATResult ? scheduler.saveCSATResult({
          chatId: chatId,
          score: csatScore,
          timestamp: Date.now(),
          userId: memberId || ""
        }) : null;

        var csatSatisfied = csatScore <= 2; // 1=非常滿意, 2=滿意 → satisfied
        var csatThanks = {
          "zh-TW": csatSatisfied ? "太好了，感謝您的滿意回饋！我們會繼續努力提供更好的服務 😊" : "感謝您的回饋！我們會認真改善，讓您有更好的體驗 🙏",
          "ko": csatSatisfied ? "만족하셨다니 정말 감사합니다! 더 좋은 서비스로 보답하겠습니다 😊" : "소중한 피드백 감사합니다! 개선하도록 노력하겠습니다 🙏",
          "en": csatSatisfied ? "So glad you're satisfied! We'll keep up the great work 😊" : "Thank you for your feedback! We'll work hard to improve 🙏",
          "ja": csatSatisfied ? "ご満足いただけて嬉しいです！これからも頑張ります 😊" : "フィードバックありがとうございます！改善に努めます 🙏"
        };

        var thankMsg = csatThanks[detectedLang] || csatThanks["zh-TW"];
        await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: thankMsg }] });
        console.log("[CSAT] Score recorded:", csatScore, "for chat:", chatId);
        mgrStats.linkCSATToManager(chatId, csatScore);

        // Clear CSAT pending
        // Clear CSAT pending from file
        // CSAT 응답 완료 처리는 아래 분기에서 진행

        // CSAT 점수별 분기: 만족(1-2)→CES(간단), 보통(3)→CES, 불만족(4-5)→사유질문
        if (csatScore <= 2) {
          // 만족 → CES 질문으로 편의성 측정 (데이터 수집 확대)
          cesHelper.markPending(chatId, { userId: memberId || personId || '', managerId: '', csatScore: csatScore });
          var cesQSatisfied = {
            'zh-TW': '感謝您的好評！最後想請問，今天解決問題的過程容易嗎？\n1=非常困難 ~ 5=非常容易',
            'ko': '좋은 평가 감사합니다! 마지막으로, 문제 해결 과정이 쉬웠나요?\n1=매우 어려움 ~ 5=매우 쉬움',
            'en': 'Thanks for the great feedback! Lastly, how easy was it to resolve your issue?\n1=Very difficult ~ 5=Very easy',
            'ja': '高評価ありがとうございます！最後に、問題解決は簡単でしたか？\n1=非常に難しい ~ 5=非常に簡単'
          };
          try {
            await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: cesQSatisfied[detectedLang] || cesQSatisfied['zh-TW'] }] });
            console.log('[CES] Satisfied CES question sent to chat:', chatId);
            // CES 미응답 시 5분 후 pending만 정리 (채팅은 open 유지)
            setTimeout(function() {
              if (cesHelper.isPending(chatId)) {
                cesHelper.removePending(chatId);
                console.log("[CES] Pending expired (5min):", chatId);
              }
            }, 300000);
          } catch(cesErr) { console.log('[CES] Satisfied send error:', cesErr.message); }
        } else if (csatScore === 3) {
          // 보통 → CES 질문
          cesHelper.markPending(chatId, { userId: memberId || personId || '', managerId: '', csatScore: csatScore });
          var cesQ = {
            'zh-TW': '最後一個問題！今天解決問題容易嗎？\n1=非常困難 2=困難 3=普通 4=容易 5=非常容易',
            'ko': '마지막 질문! 오늘 문제 해결이 쉬웠나요?\n1=매우 어려움 2=어려움 3=보통 4=쉬움 5=매우 쉬움',
            'en': 'One last question! How easy was it to resolve your issue?\n1=Very difficult 2=Difficult 3=Neutral 4=Easy 5=Very easy',
            'ja': '最後の質問です！今日の問題解決は簡単でしたか？\n1=非常に難しい 2=難しい 3=普通 4=簡単 5=非常に簡単'
          };
          try {
            await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: cesQ[detectedLang] || cesQ['zh-TW'] }] });
            console.log('[CES] Question sent to chat:', chatId);
            // CES 미응답 시 5분 후 pending만 정리 (채팅은 open 유지)
            setTimeout(function() {
              if (cesHelper.isPending(chatId)) {
                cesHelper.removePending(chatId);
                console.log("[CES] Pending expired (5min):", chatId);
              }
            }, 300000);
          } catch(cesErr) { console.log('[CES] Send error:', cesErr.message); }
        } else {
          // 불만족(4-5) → 사유 질문
          pendingCSATReason[chatId] = { timestamp: Date.now(), chatId: chatId, userId: memberId || personId || '', csatScore: csatScore };
          var reasonQ = {
            'zh-TW': '很抱歉讓您不滿意 🙏 方便告訴我們哪裡做得不好嗎？您的一句話就能幫助我們改善！',
            'ko': '불편을 드려 죄송합니다 🙏 어떤 부분이 아쉬우셨는지 한 마디만 남겨주시면 큰 도움이 됩니다!',
            'en': "We're sorry to hear that 🙏 Could you tell us what we could improve? Your feedback helps us get better!",
            'ja': 'ご期待に沿えず申し訳ございません 🙏 改善すべき点をお聞かせいただけますか？'
          };
          try {
            await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: reasonQ[detectedLang] || reasonQ['zh-TW'] }] });
            console.log('[CSAT-REASON] Question sent to chat:', chatId, '| Score:', csatScore);
            // 사유 미응답 시 5분 후 pending만 정리 (채팅은 open 유지)
            setTimeout(function() {
              if (pendingCSATReason[chatId]) {
                delete pendingCSATReason[chatId];
                console.log("[CSAT-REASON] Pending expired (5min):", chatId);
              }
            }, 300000);
          } catch(reasonErr) { console.log('[CSAT-REASON] Send error:', reasonErr.message); }
        }
        return res.status(200).send("OK");
      }
    }

    // Satisfaction response
    if (satisfactionPending[chatId] && isSatisfactionResponse(userText)) {
      delete satisfactionPending[chatId];
      var thanks = {
        'zh-TW': '感謝您的回饋！我們會持續改進！😊',
        'ko': '소중한 피드백 감사합니다! 😊',
        'en': 'Thank you for your feedback! 😊',
        'ja': 'フィードバックありがとうございます！😊'
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: thanks[detectedLang] || thanks['zh-TW'] }] });
      return res.status(200).send('OK');
    }

    // Thank you response
    if (isThankYou(userText)) {
      // CSAT 인라인 포함 여부 결정
      // [C 2026-05-22] 인라인 thank-you CSAT 비활성화 — 자동종료 웹설문(auto-close-csat)으로 일원화.
      // 인라인이 먼저 발송되면 alreadySent 때문에 웹설문이 차단되던 문제 해소. 되살리려면 아래를 !csatHelper.alreadySent(chatId)로.
      var _inlineCSAT = false;
      var _csatLine = {
        'zh-TW': '\n\n📋 最後想請問，這次的服務體驗如何呢？\n1️⃣ 非常滿意  2️⃣ 滿意  3️⃣ 普通  4️⃣ 不滿意  5️⃣ 非常不滿意\n💬 請回覆數字 1~5 即可，非常感謝！',
        'ko': '\n\n📋 마지막으로, 이번 서비스는 어떠셨나요?\n1️⃣ 매우 만족  2️⃣ 만족  3️⃣ 보통  4️⃣ 불만족  5️⃣ 매우 불만족\n💬 숫자 1~5만 입력해주시면 큰 도움이 됩니다!',
        'en': '\n\n📋 How was your experience?\n1️⃣ Very Satisfied  2️⃣ Satisfied  3️⃣ Neutral  4️⃣ Dissatisfied  5️⃣ Very Dissatisfied\n💬 Just reply 1~5, it really helps us!',
        'ja': '\n\n📋 今回のサービスはいかがでしたか？\n1️⃣ 大満足  2️⃣ 満足  3️⃣ 普通  4️⃣ 不満  5️⃣ 大不満\n💬 1~5の数字だけで大丈夫です！'
      };
      var thankReply = {
        'zh-TW': '不客氣！😊' + (_inlineCSAT ? _csatLine['zh-TW'] : '\n\n還有其他問題歡迎隨時詢問！'),
        'ko': '천만에요! 😊' + (_inlineCSAT ? _csatLine['ko'] : '\n\n다른 질문 있으시면 언제든 물어보세요!'),
        'en': "You're welcome! 😊" + (_inlineCSAT ? _csatLine['en'] : '\n\nFeel free to ask anything else!'),
        'ja': 'どういたしまして！😊' + (_inlineCSAT ? _csatLine['ja'] : '\n\n他にご質問があればお気軽にどうぞ！')
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: thankReply[detectedLang] || thankReply['zh-TW'] }] });
      if (_inlineCSAT) {
        csatHelper.markSent(chatId, 'thank_you_csat');
        console.log('[CSAT] Inline CSAT included in thank-you response for:', chatId);
      }
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "thank_you", userMessage: userText, aiResponse: "감사 응답", escalated: false, confidence: 1.0, category: "greeting" });
      recordFCRResolved(memberId || personId || "", chatId, "thank_you");
      // 업그레이드5 → 인라인 방식으로 대체됨 (위에서 처리)
      return res.status(200).send('OK');
    }

    // Greeting
    if (isGreeting(userText)) {
      var greetReply = {
        'zh-TW': '您好！歡迎來到 VEASLY 🇰🇷\n請問有什麼可以幫您的呢？\n\n' + getMenuText('zh-TW'),
        'ko': '안녕하세요! VEASLY에 오신 걸 환영합니다 🇰🇷\n무엇을 도와드릴까요?\n\n' + getMenuText('ko'),
        'en': 'Hello! Welcome to VEASLY 🇰🇷\nHow can I help you?\n\n' + getMenuText('en'),
        'ja': 'こんにちは！VEASLYへようこそ 🇰🇷\nどうぞお気軽にご質問ください。\n\n' + getMenuText('ja')
      };
      var greetText = greetReply[detectedLang] || greetReply['zh-TW'];
      // Add point reminder to greeting
      if (veaslyUser && veaslyUser.credit >= 500) {
        var pointHints = {
          "zh-TW": "\n\n🎁 您目前有 " + veaslyUser.credit + " 點數可以使用喔！下單時可折抵消費～",
          "ko": "\n\n🎁 현재 " + veaslyUser.credit + " 포인트 보유 중! 주문 시 할인에 사용하세요~",
          "en": "\n\n🎁 You have " + veaslyUser.credit + " points! Use them on your next order~",
          "ja": "\n\n🎁 現在 " + veaslyUser.credit + " ポイントをお持ちです！ご注文時にご利用ください～"
        };
        greetText += pointHints[detectedLang] || pointHints["zh-TW"];
      }
      await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: greetText }] });
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "greeting", userMessage: userText, category: "greeting", aiResponse: "인사 응답 + 메뉴 제공" + (veaslyUser && veaslyUser.credit >= 500 ? " (포인트:" + veaslyUser.credit + ")" : ""), escalated: false, confidence: 1.0 });
      recordFCRResolved(memberId || personId || "", chatId, "greeting");
      return res.status(200).send('OK');
    }

    // Number menu (0 removed from here - escalation handled separately)
    var trimmed = userText.trim();
    if (NUMBER_TO_QUERY[trimmed]) {
      userText = NUMBER_TO_QUERY[trimmed];
    }

    // Escalation request - multi-step process
    // Negative sentiment auto-escalation
    // 환불/refund 같은 중립어는 제외(별도 refund_delay 핸들러가 처리) — 실제 분노 표현만 남김
    var negativeKeywords = ['不滿', '不好', '生氣', '太差', '太慢', '騙', '詐騙', '投訴', '消保', '客訴', '報警', '律師', '法律', '消費者保護', '不合理', '離譜', '誇張', '差勁', '爛', '沒用', '廢物', '垃圾', '화나', '열받', '짜증', '사기', '소보원', '신고', 'scam', 'fraud', 'lawsuit', 'complaint', 'unacceptable', 'ridiculous', 'terrible', 'worst'];
    var isNegative = false;
    for (var ni = 0; ni < negativeKeywords.length; ni++) {
      if (userText.indexOf(negativeKeywords[ni]) !== -1) { isNegative = true; break; }
    }
    if (isNegative && !managerActive[chatId]) {
      setEscalationStep(chatId, 1); // skip step 0 so next escalation request goes directly to step 2
      console.log('[Sentiment] Negative detected - auto escalating:', chatId);
      var negAck = {
        'zh-TW': '👨‍💼 正在為您轉接真人客服，請稍候！我們會盡快協助您處理～',
        'ko': '👨‍💼 상담사를 연결해 드리겠습니다. 잠시만 기다려주세요!',
        'en': '👨‍💼 Connecting you to a live agent, please wait! We will help you right away.',
        'ja': '👨‍💼 オペレーターにお繋ぎします。少々お待ちください！'
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: negAck[detectedLang] || negAck['zh-TW'] }] });
      // [SOP v2] 팔로워 정책: MIA·우선 초대 + 강준 팔로워 (전체 매니저 X)
      await connectManager(chatId, detectedLang);
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || '', userName: veaslyUser ? veaslyUser.name : '', lang: detectedLang, type: 'escalation', userMessage: userText, aiResponse: '부정감정 자동 에스컬레이션 - 매니저 연결', escalated: true, escalationReason: 'negative_sentiment', confidence: 0, category: 'agent_request' });
      try { var schedulerNeg = require('../lib/scheduler'); schedulerNeg.savePendingEscalation(chatId, memberId || personId || '', userText); } catch(pe) {}
      return res.status(200).send('OK');
    }

    // Merge shipping request → immediate escalation
    // Merge shipping → AI policy guide (no escalation)
    // Merge shipping -> AI policy guide (no escalation, direct mypage link)
    if (isMergeShippingRequest(userText)) {
      // [SOP v2 §2-1·§2-2] 합배송 정책 문구
      var mergeGuide = {
        "zh-TW": "合併寄送可以在這裡直接申請喔～\nhttps://www.veasly.com/tw/my-page/orders/combined-shipping/request\n\n只要要合併的訂單中有任一筆尚未抵達集運倉，即可申請合併寄送，並依訂單合計金額重新計算免運額度（例：5,000＋5,000 → 10kg 免運）。\n\n注意事項：\n・訂單全部抵達集運倉後即無法申請（與是否為免運訂單無關）\n・已被拒絕過的組合無法再次申請\n・未合併的訂單會分別從韓國寄出\n・合併寄送一律宅配到府；原本選擇超商取貨的訂單，申請合併時需改為宅配地址\n・想追加訂單時，請先取消原合併申請，再將要合併的訂單一起重新申請\n\n還有其他問題嗎？隨時問我～",
        "ko": "합배송은 여기서 바로 신청할 수 있어요～\nhttps://www.veasly.com/tw/my-page/orders/combined-shipping/request\n\n묶으려는 주문 중 하나라도 집운창에 도착 전이면 신청 가능! 합배송 후 합계 금액 기준으로 무료배송 한도가 재계산됩니다 (예: 5,000＋5,000 → 10kg).\n\n주의사항:\n・전부 입고되면 신청 불가 (무료배송 여부와 무관)\n・거절된 조합은 재신청 불가\n・미합병 주문은 한국에서 각각 발송\n・합배송은 무조건 택배(집 배송) — 편의점 수령 주문도 집 주소로 변경 필요\n\n다른 궁금한 거 있으면 말씀해주세요~",
        "en": "You can request combined shipping here~\nhttps://www.veasly.com/tw/my-page/orders/combined-shipping/request\n\nAvailable as long as at least one order hasn't arrived at our Korea warehouse yet! Free-shipping allowance is recalculated based on the combined total (e.g. 5,000+5,000 → 10kg).\n\nNotes:\n- Once all orders have arrived at the warehouse, combining is no longer possible (regardless of free shipping)\n- Rejected combinations cannot be re-requested\n- Combined shipping is home delivery only; convenience-store pickup orders must switch to a home address\n\nAnything else I can help with?",
        "ja": "合併配送はマイページから申請できます！\n\n" +
          "リンク: https://www.veasly.com/tw/my-page/orders/combined-shipping/request\n\n" +
          "注意：全ての注文が倉庫に到着する前のみ申請可能です（送料無料かどうかは関係ありません）。合併配送は宅配のみで、コンビニ受取は住所変更が必要です。"
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: mergeGuide[detectedLang] || mergeGuide["zh-TW"] }] });
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "faq_answer", userMessage: userText.substring(0, 200), aiResponse: "합배송 → 마이페이지 안내 (에스컬레이션 없음)", escalated: false, confidence: 1.0, category: "merge_shipping" });
      return res.status(200).send("OK");
    }


    // === 통합 인텐트 감지 (키워드 조합 + 문맥 판단, isActionRequest보다 먼저) ===
    var _lower = userText.toLowerCase();
    var _hasNegative = ["不對","不一樣","不符","錯誤","有差","不同","變了","怎麼回事","有問題","錯了","差異","多收","少收","太貴","太高","被多扣","扣太多","不合理"].some(function(k) { return userText.indexOf(k) > -1; });
    var _hasPayKw = ["金額","價格","結帳","付款","app金額","app價格","手機金額","결제금액","금액","payment","amount","price"].some(function(k) { return _lower.indexOf(k) > -1; });
    var _hasQuoteKw = ["報價","估價","幫我買","想買","可以買嗎","能買嗎","代購","幫我代購","想要這個","想訂","幫我訂","我要買","購買","想購入","幫忙代購","幫我看","可以幫我買","給我報價","想問價格","能不能買","可以訂嗎","견적","구매대행","사고싶어","사줘","quote","buy for me","want to buy","purchase"].some(function(k) { return _lower.indexOf(k.toLowerCase()) > -1; });

    // 인텐트 판정: 부정/불만 키워드가 있으면 → 금액불일치 우선
    var _intent = null;
    if (_hasPayKw && _hasNegative) { _intent = "payment_mismatch"; }
    else if (_hasQuoteKw && _hasNegative) { _intent = "payment_mismatch"; }
    else if (_hasQuoteKw && !_hasNegative) { _intent = "quote_request"; }
    else if (_hasPayKw && !_hasQuoteKw && _hasNegative) { _intent = "payment_mismatch"; }

    if (_intent === "payment_mismatch") {
      var payMismatchMsgs = {
        'zh-TW': '關於結帳金額不符的問題：\n\n📌 請問您目前是用 APP（手機應用程式）下單嗎？\n\n如果是的話，建議改用網頁版 (veasly.com/tw) 進行結帳，APP版本偶爾會出現金額顯示異常的情況，使用網頁版就不會有這個問題囉！\n\n💡 操作方式：\n1️⃣ 用手機或電腦瀏覽器打開 veasly.com/tw\n2️⃣ 登入您的帳號\n3️⃣ 到「我的頁面」找到訂單重新結帳\n\n如果用網頁版還是有金額問題，請提供訂單號碼和截圖，客服人員會幫您確認！',
        'ko': '결제 금액이 다른 문제에 대해:\n\n📌 혹시 지금 APP(모바일 앱)으로 주문하고 계신가요?\n\nAPP에서 간혹 금액 표시 오류가 발생할 수 있어요. 웹 브라우저(veasly.com/tw)로 결제하시면 문제가 해결됩니다!\n\n💡 방법:\n1️⃣ 브라우저에서 veasly.com/tw 접속\n2️⃣ 로그인\n3️⃣ 마이페이지에서 주문 재결제',
        'en': 'About the payment amount mismatch:\n\n📌 Are you currently ordering through the APP?\n\nThe APP may occasionally show incorrect amounts. Please try using the web version (veasly.com/tw) instead!\n\n💡 Steps:\n1️⃣ Open veasly.com/tw\n2️⃣ Log in\n3️⃣ Go to My Page and retry payment',
        'ja': '決済金額の不一致について：\n\n📌 現在APPからご注文されていますか？\n\nAPPでは稀に金額表示の不具合が発生します。ウェブ版(veasly.com/tw)で決済すれば問題が解決します！'
      };
      var payMsg = payMismatchMsgs[detectedLang] || payMismatchMsgs['zh-TW'];
      payMsg += '\n\n💡 ' + (detectedLang === 'ko' ? '웹에서도 문제가 있으면 주문번호와 스크린샷을 보내주세요!' : detectedLang === 'en' ? 'If the issue persists on web, please send your order number and screenshot!' : detectedLang === 'ja' ? 'ウェブでも問題がある場合は注文番号とスクリーンショットをお送りください！' : '還有其他問題嗎？直接輸入問題，或輸入「客服」轉接真人客服喔！');
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: payMsg }] });
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || '', userName: veaslyUser ? veaslyUser.name : '', lang: detectedLang, type: 'faq_answer', userMessage: userText.substring(0, 200), aiResponse: '결제금액 불일치 → APP→웹 전환 안내', escalated: false, confidence: 1.0, category: 'payment_mismatch' });
      recordFCRResolved(memberId || personId || '', chatId, 'faq_payment');
      return res.status(200).send('OK');
    }

    if (_intent === "quote_request") {
      var quoteMsg = {
        'zh-TW': '想購買商品的話，請到 veasly.com 找到您想要的商品，點擊「申請報價」按鈕就可以囉！\n\n📌 報價申請步驟：\n1️⃣ 到 veasly.com/tw\n2️⃣ 貼上商品 URL 或上傳截圖\n3️⃣ 選擇規格後點擊「申請報價」\n4️⃣ 我們收到後會盡快為您處理報價！\n\n💡 報價完成後會通知您，確認金額後即可付款下單喔！',
        'ko': '상품 구매를 원하시면 veasly.com에서 원하시는 상품을 찾아 「견적 요청」 버튼을 눌러주세요!\n\n📌 견적 신청 방법:\n1️⃣ veasly.com/tw 접속\n2️⃣ 상품 URL 또는 스크린샷 업로드\n3️⃣ 옵션 선택 후 「견적 요청」 클릭\n4️⃣ 견적 완료 후 알림 드립니다!',
        'en': 'To purchase, please visit veasly.com, find your desired product, and click the "Request Quote" button!\n\n📌 Steps:\n1️⃣ Go to veasly.com/tw\n2️⃣ Paste product URL or upload screenshot\n3️⃣ Select options and click "Request Quote"\n4️⃣ We will notify you when the quote is ready!',
        'ja': 'ご購入をご希望でしたら、veasly.comで商品を見つけて「見積もり申請」ボタンをクリックしてください！\n\n📌 手順：\n1️⃣ veasly.com/tw にアクセス\n2️⃣ 商品URLまたはスクリーンショットを貼付\n3️⃣ オプション選択後「見積もり申請」をクリック'
      };
      var qMsg = quoteMsg[detectedLang] || quoteMsg['zh-TW'];
      qMsg += '\n\n🔗 ' + (detectedLang === 'ko' ? '상품 링크를 여기에 바로 붙여넣으시면, 규격/가격 정보를 확인해드릴 수 있어요!' : detectedLang === 'en' ? 'You can also paste the product link here and I will help check availability!' : detectedLang === 'ja' ? '商品リンクをここに貼り付けていただければ、在庫確認をお手伝いします！' : '也可以直接把商品連結貼在這裡，我可以先幫您確認商品資訊喔！');
      qMsg += '\n\n💡 ' + (detectedLang === 'ko' ? '다른 질문이 있으시면 입력해주세요!' : detectedLang === 'en' ? 'Any other questions? Just type!' : detectedLang === 'ja' ? '他にご質問があればどうぞ！' : '還有其他問題嗎？直接輸入問題，AI會為您解答喔！');
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: qMsg }] });
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || '', userName: veaslyUser ? veaslyUser.name : '', lang: detectedLang, type: 'faq_answer', userMessage: userText.substring(0, 200), aiResponse: '報價요청 → veasly.com 申請報價 안내', escalated: false, confidence: 1.0, category: 'quote_request' });
      recordFCRResolved(memberId || personId || '', chatId, 'quote_request');
      return res.status(200).send('OK');
    }
    // Action request → AI guide message + escalation
    var actionType = isActionRequest(userText);
    if (actionType) {
      var actionMsgs = {
        "cancel_reason": {
          "zh-TW": "關於訂單取消的原因，這部分需要客服人員幫您查詢確認喔！正在為您轉接 🙋‍♀️",
          "ko": "주문 취소 사유는 상담사가 확인해드릴게요! 연결 중입니다 🙋‍♀️",
          "en": "Let me connect you with our team to check the cancellation reason! 🙋‍♀️",
          "ja": "キャンセル理由の確認はスタッフが対応いたします！接続中です 🙋‍♀️"
        },
        "shipping_delay": {
          "zh-TW": "很抱歉讓您久等了！關於出貨進度，讓客服人員幫您確認最新狀態喔 🙋‍♀️",
          "ko": "오래 기다리셨죠! 출고 진행 상황을 상담사가 확인해드릴게요 🙋‍♀️",
          "en": "Sorry for the wait! Let me connect you with our team to check the shipping status 🙋‍♀️",
          "ja": "お待たせして申し訳ございません！配送状況をスタッフが確認いたします 🙋‍♀️"
        },
        "refund_delay": {
          "zh-TW": "很抱歉讓您久等了！關於退款進度，讓客服人員幫您查詢最新狀態喔 🙋‍♀️",
          "ko": "오래 기다리셨죠! 환불 진행 상황을 상담사가 확인해드릴게요 🙋‍♀️",
          "en": "Sorry for the wait! Let me connect you with our team to check the refund status 🙋‍♀️",
          "ja": "お待たせして申し訳ございません！返金状況をスタッフが確認いたします 🙋‍♀️"
        },
        "email_change": {
          "zh-TW": "修改信箱需要客服人員為您處理喔！正在為您轉接 🙋‍♀️",
          "ko": "이메일 변경은 상담사가 처리해드릴게요! 연결 중입니다 🙋‍♀️",
          "en": "Email changes need to be handled by our support team! Connecting you now 🙋‍♀️",
          "ja": "メールアドレスの変更はスタッフが対応いたします！接続中です 🙋‍♀️"
        },
        "product_search": {
          "zh-TW": "幫您找商品這件事，讓客服人員來協助您喔！正在為您轉接 🙋‍♀️",
          "ko": "상품 검색은 상담사가 도와드릴게요! 연결 중입니다 🙋‍♀️",
          "en": "Let me connect you with our team to help find the product! 🙋‍♀️",
          "ja": "商品探しはスタッフがお手伝いします！接続中です 🙋‍♀️"
        },
        "price_inquiry": {
          "zh-TW": "商品報價需要客服人員幫您確認喔！正在為您轉接 🙋‍♀️",
          "ko": "가격 문의는 상담사가 확인해드릴게요! 연결 중입니다 🙋‍♀️",
          "en": "Pricing inquiries need our support team! Connecting you now 🙋‍♀️",
          "ja": "お見積りはスタッフが対応いたします！接続中です 🙋‍♀️"
        },
        "order_modify": {
          "zh-TW": "修改訂單資訊需要客服人員為您處理喔！正在為您轉接 🙋‍♀️",
          "ko": "주문 정보 수정은 상담사가 처리해드릴게요! 연결 중입니다 🙋‍♀️",
          "en": "Order modifications need our support team! Connecting you now 🙋‍♀️",
          "ja": "注文内容の変更はスタッフが対応いたします！接続中です 🙋‍♀️"
        }
      };
      if (!isBusinessHours()) {
              // 오프시간: 안내 메시지 + 매니저 초대(출근 후 확인용)
              var _holAct = getHolidayNotice(detectedLang);
              var offHourActionMsgs = {
                "zh-TW": (_holAct ? _holAct + "\n\n" : "") + "\ud83d\udca1 目前非客服時間（台灣 09:00~18:00），此問題需要客服人員為您處理。\n\n\ud83d\udcdd 請先留下相關資訊（如訂單號碼），客服人員上班後會優先為您處理！\n\n\u23f0 客服時間：週一至週五 台灣 09:00~18:00\n我們一定會回覆您！\ud83d\ude0a",
                "ko": "\ud83d\udca1 현재 영업시간이 아닙니다 (평일 10:00~19:00 KST). 이 문의는 상담사 확인이 필요합니다.\n\n\ud83d\udcdd 관련 정보(주문번호 등)를 남겨주시면 업무 시작 후 우선 처리해드리겠습니다!\n\n\u23f0 상담시간: 평일 10:00~19:00 (한국시간)",
                "en": "\ud83d\udca1 Currently outside business hours (Mon-Fri 10:00-19:00 KST). This request needs agent assistance.\n\n\ud83d\udcdd Please leave the details (e.g. order number) and our team will prioritize it first thing!",
                "ja": "\ud83d\udca1 現在営業時間外です（月〜金 10:00〜19:00 KST）。このお問い合わせはスタッフの対応が必要です。\n\n\ud83d\udcdd 関連情報（注文番号など）を残してください。営業開始後すぐに対応いたします！"
              };
              await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: offHourActionMsgs[detectedLang] || offHourActionMsgs["zh-TW"] }] });
              await connectManager(chatId, detectedLang);
            } else {
              var actionMsg = (actionMsgs[actionType] && actionMsgs[actionType][detectedLang]) || (actionMsgs[actionType] && actionMsgs[actionType]["zh-TW"]) || "正在為您轉接客服人員 \ud83d\ude4b\u200d\u2640\ufe0f";
              await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: actionMsg }] });
              await connectManager(chatId, detectedLang);
            }
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "escalation", userMessage: userText.substring(0, 200), aiResponse: "행동요청(" + actionType + ") → 안내 후 에스컬레이션", escalated: true, escalationReason: 'action_request_' + actionType, confidence: 0, category: actionType || 'other' });
      return res.status(200).send("OK");
    }

    if (isEscalationRequest(userText) || trimmed === '0') {
      var step = getEscalationStep(chatId);

      if (step === 0) {
        // Step 1: Ask what they need help with
        var _holS0 = getHolidayNotice(detectedLang);
        var step1Msgs = {
          'zh-TW': !isBusinessHours() ? '💡 ' + (_holS0 || '\ud83d\udca1 目前非客服時間（台灣 09:00~18:00）') + '，但我可以馬上幫您！\n\n請直接告訴我：\n1️⃣ 輸入「訂單號碼」→ 馬上查進度\n2️⃣ 輸入您的問題 → AI即時回答\n\n例如：\n・貼上訂單號碼（如 20260415TW...）\n・「我的包裹到哪了」\n・「運費怎麼算」\n\n⏰ 客服人員上班後會優先處理需要人工協助的問題！\n🔸 還是需要真人？請再輸入「客服」，我會記錄下來' : '💡 轉接客服前，請先簡單告訴我您遇到什麼問題，這樣可以更快幫您解決喔！\n\n例如：\n・貼上訂單號碼 → 馬上查進度\n・「包裹到哪了」「運費多少」→ AI即時回答\n・「想修改地址」→ 馬上為您處理\n\n📝 請用一句話描述您的問題：\n\n🔸 還是需要真人？請再輸入「客服」',
          'ko': '💡 상담사 연결 전에 제가 도움드릴 수 있을지 확인해볼게요!\n\n질문을 간단히 설명해주세요:\n・「주문 진행 상태 확인」\n・「운임 계산 방법」\n・「환불 신청 방법」\n\n또는 번호를 입력하세요:\n' + getMenuText('ko') + '\n\n🔸 그래도 상담사가 필요하시면 「상담사」를 한 번 더 입력해주세요',
          'en': '💡 Before connecting to an agent, maybe I can help!\n\nDescribe your issue briefly, or enter a number:\n' + getMenuText('en') + '\n\n🔸 Still need a human? Type "agent" again',
          'ja': '💡 オペレーターに接続する前に、お手伝いできるかもしれません！\n\n質問を簡単に説明するか、番号を入力してください：\n' + getMenuText('ja') + '\n\n🔸 それでも必要な場合は「オペレーター」をもう一度入力'
        };
        setEscalationStep(chatId, 1);
        await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: step1Msgs[detectedLang] || step1Msgs['zh-TW'] }] });
        return res.status(200).send('OK');
      } else {
        // Step 2: Actually connect
        setEscalationStep(chatId, 0);
        var bizOpen = isBusinessHours();
        var escMsgs;
        if (bizOpen) {
          escMsgs = {
            'zh-TW': '👨‍💼 正在為您轉接真人客服，請稍候！\n\n💡 目前客服人員正依序處理中，請稍候，我們會盡快回覆您！',
            'ko': '👨‍💼 상담사를 연결해 드리겠습니다. 잠시만 기다려주세요!\n\n💡 순차적으로 상담을 진행하고 있습니다. 잠시만 기다려주세요!',
            'en': '👨‍💼 Connecting you to a live agent, please wait!\n\n💡 Our agents are assisting customers in order. Please wait, we will get to you soon!',
            'ja': '👨‍💼 オペレーターにお繋ぎします。少々お待ちください！'
          };
        } else {
          var _holN = getHolidayNotice(detectedLang);
          escMsgs = {
            'zh-TW': (_holN ? _holN + '\n\n' : '') + '👨‍💼 目前非客服時間（平日 10:00~19:00 韓國時間 = 台灣 09:00~18:00）\n\n📝 請留下您的問題，我們會在上班後優先回覆！\n・訂單問題請附上訂單號碼\n・其他問題請簡單描述\n\n我們一定會回覆您！😊',
            'ko': '👨‍💼 현재 상담 시간이 아닙니다 (평일 10:00~19:00 한국시간)\n\n📝 메시지를 남겨주시면 업무 시작 후 우선 답변드리겠습니다!',
            'en': '👨‍💼 Outside business hours (Weekdays 10:00~19:00 KST)\n\n📝 Leave your message and we\'ll reply first thing!',
            'ja': '👨‍💼 現在営業時間外です（平日 10:00~19:00 韓国時間）\n\n📝 メッセージを残してください。営業開始後すぐにご返信します！'
          };
        }
        var _escVal = escMsgs[detectedLang] || escMsgs['zh-TW'];
        if (!bizOpen) _escVal += nextOpenText(detectedLang); // [2026-06-30] 영업외엔 다음 오픈 시각 안내
        await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: _escVal }] });
        // [SOP v2] 팔로워 정책: MIA·우선 초대 + 강준 팔로워
        await connectManager(chatId, detectedLang);
        aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || '', userName: veaslyUser ? veaslyUser.name : '', lang: detectedLang, type: 'escalation', userMessage: userText, aiResponse: '에스컬레이션 - 매니저 연결', escalated: true, escalationReason: 'keyword_request', confidence: 0, category: 'agent_request' });
        try { var scheduler2 = require('../lib/scheduler'); scheduler2.savePendingEscalation(chatId, memberId || personId || '', userText); } catch(pe) {}
        return res.status(200).send('OK');
      }
    }




    // Reset escalation step only if NOT an escalation keyword
    if (!isEscalationRequest(userText)) { setEscalationStep(chatId, 0); }

    // Point promotion - notify users with available points
    if (veaslyUser && veaslyUser.credit >= 500) {
      var chatPointKey = "pointNotified_" + chatId;
      if (!global._pointNotified) global._pointNotified = {};
      if (!global._pointNotified[chatPointKey]) {
        global._pointNotified[chatPointKey] = true;
        var pts = veaslyUser.credit;
        var pointMsgs = {
          "zh-TW": "🎁 " + veaslyUser.name + " 您好！您目前有 " + pts + " 點數可以使用喔！下單時可折抵消費，別忘了使用～",
          "ko": "🎁 " + veaslyUser.name + "님! 현재 " + pts + " 포인트 보유 중이에요! 주문 시 할인에 사용할 수 있어요~",
          "en": "🎁 Hi " + veaslyUser.name + "! You have " + pts + " points available! Use them for discounts on your next order~",
          "ja": "🎁 " + veaslyUser.name + "さん！現在 " + pts + " ポイントをお持ちです！注文時にご利用いただけます～"
        };
        // Send as a separate message after a short delay
        setTimeout(async function() {
          try {
            await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: pointMsgs[detectedLang] || pointMsgs["zh-TW"] }] });
            console.log("[Promo] Point reminder sent:", pts, "points for", veaslyUser.name);
          } catch(e) { console.error("[Promo] Error:", e.message); }
        }, 2000);
      }
    }

        // Skip greeting/sticker messages - no bot response needed
    var skipPatterns = ['스티커를 전송했습니다', '스티커를 보냈습니다'];
    // Handle image/file messages with a helpful response
    var filePatterns = ['사진을 전송했습니다', '파일을 전송했습니다', '이미지를 전송했습니다', '동영상을 전송했습니다'];
    var isFileMsg = filePatterns.some(function(p) { return userText.indexOf(p) > -1; });
    if (isFileMsg) {
      var fileMsgs = {
        "zh-TW": "📷 收到您傳送的檔案了！\n\n不好意思，AI助手目前還無法讀取圖片或檔案。請用文字描述您的問題，我會盡力幫您處理喔！\n\n例如：\n・「我的包裹外觀有損壞」\n・「商品跟網站圖片不一樣」\n・「付款畫面出現錯誤」",
        "ko": "📷 파일을 확인했습니다!\n\nAI 도우미가 아직 이미지/파일을 읽지 못합니다. 텍스트로 문제를 설명해 주시면 도와드릴게요!\n\n예시:\n・「택배 외관이 손상됐어요」\n・「상품이 사진과 달라요」\n・「결제 화면 오류가 났어요」",
        "en": "📷 Got your file!\n\nSorry, the AI assistant can't read images/files yet. Please describe your issue in text and I'll do my best to help!",
        "ja": "📷 ファイルを確認しました！\n\nAIアシスタントはまだ画像/ファイルを読み取れません。テキストで問題をご説明いただければ対応いたします！"
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: fileMsgs[detectedLang] || fileMsgs["zh-TW"] }] });
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", lang: detectedLang, type: "file_message", userMessage: userText, aiResponse: "파일/이미지 수신 안내", escalated: false, confidence: 0.5, category: "other" });
      return res.status(200).send("OK");
    }
    var isSticker = skipPatterns.some(function(p) { return userText.indexOf(p) > -1; });
    var greetWords = ['謝謝', '感謝', '好的', '收到', '了解', '沒關係', '不用了', '掰掰', '再見', 'ok收到', '감사합니다', '알겠습니다', '고마워'];
    var isThankMsg = greetWords.some(function(g) { return userText.indexOf(g) > -1; }) && userText.length < 15;
    if (isSticker) {
      return res.status(200).send('OK');
    }
    if (isThankMsg) {
      var greetReplies = {
        "zh-TW": "不客氣！有需要隨時找我喔～ 😊",
        "ko": "천만에요! 필요하시면 언제든 말씀해주세요~ 😊",
        "en": "You're welcome! Let me know if you need anything~ 😊",
        "ja": "どういたしまして！何かあればいつでもどうぞ～ 😊"
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: greetReplies[detectedLang] || greetReplies["zh-TW"] }] });
      return res.status(200).send('OK');
    }

        // Order number detection - real-time API lookup
    var orderMatches = userText.match(/\d{8}TW\d{9}/g) || [];
    if (orderMatches.length > 1) {
      // Multi-order lookup
      console.log("[Order] Detected", orderMatches.length, "order numbers");
      if (!veaslyUser && personId) {
        try {
          var retryUser3 = await channeltalk.getUser(personId);
          var retryProfile3 = (retryUser3 && retryUser3.user) || retryUser3 || {};
          var retryEmail3 = retryProfile3.email || (retryProfile3.profile && retryProfile3.profile.email) || "";
          var retryMemberId3 = retryProfile3.memberId || "";
          if (retryMemberId3) veaslyUser = await veaslyApi.findUserById(retryMemberId3, retryEmail3);
          else if (retryEmail3) veaslyUser = await veaslyApi.findUserByEmail(retryEmail3);
          if (veaslyUser) console.log("[Security] Multi retry auth success:", veaslyUser.name);
        } catch(retryErr3) {}
      }
      if (!veaslyUser) {
        await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: orderSecurityMsgs.noAuth[detectedLang] || orderSecurityMsgs.noAuth["zh-TW"] }] });
        console.log("[Security] Multi-order blocked - no auth");
        return res.status(200).send("OK");
      }
      try {
        var multiReply = "";
        var successCount = 0;
        for (var oi = 0; oi < Math.min(orderMatches.length, 5); oi++) {
          var oNum = orderMatches[oi];
          try {
            var oItems = await veaslyApi.getOrderDetail(oNum);
              // 합배송 fallback
              if (!oItems || oItems.length === 0) {
                var cOrder = await veaslyApi.getOrderByNumber(oNum);
                if (cOrder && cOrder.items && cOrder.items.length > 0) {
                  var cInfo = cOrder.items.map(function(ci) { return (ci.product && ci.product.name ? ci.product.name : "상품") + " (" + veaslyApi.getStatusText(ci.status, detectedLang) + ")"; }).join(", ");
                  var isMerged = (cOrder.children || []).length > 0;
                  var mcOwnerId = (cOrder.user && cOrder.user.id) || null;
                  if (mcOwnerId && String(mcOwnerId) !== String(veaslyUser.id)) {
                    multiReply += "🔒 " + oNum + " - " + (detectedLang === "ko" ? "본인 주문이 아님" : detectedLang === "en" ? "Not your order" : detectedLang === "ja" ? "ご本人の注文ではありません" : "此訂單不屬於您的帳戶") + "\n\n";
                    console.log("[Security] Multi combined ownership mismatch:", oNum);
                    continue;
                  }
                  multiReply += "📦 " + oNum + (isMerged ? " [" + (detectedLang === "ko" ? "합배송" : detectedLang === "en" ? "Combined" : detectedLang === "ja" ? "合併配送" : "合併配送") + "]" : "") + "\n" + cInfo + "\n\n";
                  successCount++;
                  continue;
                }
              }
            if (oItems && oItems.length > 0) {
              var moOwnerId = (oItems[0] && oItems[0].order && oItems[0].order.userId) || null;
              if (moOwnerId && String(moOwnerId) !== String(veaslyUser.id)) {
                multiReply += "🔒 " + oNum + " - " + (detectedLang === "ko" ? "본인 주문이 아님" : detectedLang === "en" ? "Not your order" : detectedLang === "ja" ? "ご本人の注文ではありません" : "此訂單不屬於您的帳戶") + "\n\n";
                console.log("[Security] Multi order ownership mismatch:", oNum);
                continue;
              }
              var oInfo = veaslyApi.formatOrderInfo(oItems, detectedLang);
              var mainSt = (oItems[0] && oItems[0].status) || "";
              multiReply += "📦 " + oNum + "\n" + oInfo + "\n\n";
              successCount++;
            } else {
              multiReply += "❌ " + oNum + " - " + (detectedLang === "ko" ? "주문 정보 없음" : detectedLang === "en" ? "Not found" : detectedLang === "ja" ? "注文情報なし" : "找不到此訂單") + "\n\n";
            }
          } catch(oErr) {
            multiReply += "❌ " + oNum + " - " + (detectedLang === "ko" ? "조회 실패" : "查詢失敗") + "\n\n";
          }
        }
        var multiHeaders = {
          "zh-TW": "為您查詢了 " + orderMatches.length + " 筆訂單：\n\n",
          "ko": orderMatches.length + "건의 주문을 조회했습니다:\n\n",
          "en": "Found " + orderMatches.length + " orders:\n\n",
          "ja": orderMatches.length + "件の注文を確認しました：\n\n"
        };
        multiReply = (multiHeaders[detectedLang] || multiHeaders["zh-TW"]) + multiReply;
        multiReply += "💡 " + (detectedLang === "ko" ? "특정 주문의 상세 상태를 보려면 주문번호를 입력해주세요! 배송 지연 시 「독촉해줘」라고 입력하시면 도움드릴게요." : detectedLang === "en" ? "Enter a specific order number for details! If delayed, type 'follow up' and I will help!" : detectedLang === "ja" ? "詳細は注文番号を入力！遅延の場合は「確認して」と入力してください！" : "想看特定訂單詳情？請輸入完整訂單編號！如果配送延遲，可以告訴我「幫我催一下」喔！");
        await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: multiReply }] });
        aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "order_lookup", userMessage: userText.substring(0, 200), aiResponse: "복수 주문조회: " + orderMatches.length + "건 (" + successCount + "건 성공)", escalated: false, confidence: 0.8, category: "order" });
        recordFCRResolved(memberId || personId || "", chatId, "order_lookup_multi");
        return res.status(200).send("OK");
      } catch(multiErr) { console.error("[Order] Multi-order error:", multiErr.message); return res.status(200).send("OK"); }
    }
    if (orderMatches.length === 1) {
      var orderNum = orderMatches[0];
      console.log("[Order] Detected order number:", orderNum);
      try {
        var orderItems = await veaslyApi.getOrderDetail(orderNum);
        // 합배송 주문 fallback (getOrderDetail이 500 에러 시)
        var combinedOrder = null;
        if (!orderItems || orderItems.length === 0) {
          combinedOrder = await veaslyApi.getOrderByNumber(orderNum);
        }
        // 합배송 주문 처리
        if (combinedOrder && combinedOrder.items && combinedOrder.items.length > 0) {
          // 보안: 소유권 검증. 본인 신원은 ChannelTalk 프로필(personId)로만 복구한다.
          // (주문의 이메일로 인증하면 "물어본 사람=주인"이 되어 소유권 검증이 무력화되므로 금지)
          if (!veaslyUser && personId) {
            try {
              var retryUser = await channeltalk.getUser(personId);
              var retryProfile = (retryUser && retryUser.user) || retryUser || {};
              var retryEmail = retryProfile.email || (retryProfile.profile && retryProfile.profile.email) || "";
              var retryMemberId = retryProfile.memberId || "";
              if (retryMemberId) veaslyUser = await veaslyApi.findUserById(retryMemberId, retryEmail);
              else if (retryEmail) veaslyUser = await veaslyApi.findUserByEmail(retryEmail);
              if (veaslyUser) console.log("[Security] Retry auth success:", veaslyUser.name);
            } catch(retryErr) {}
          }
          if (!veaslyUser) {
            await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: orderSecurityMsgs.noAuth[detectedLang] || orderSecurityMsgs.noAuth["zh-TW"] }] });
            console.log("[Security] Order blocked - no auth:", orderNum);
            aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: "", userName: "", lang: detectedLang, type: "order_lookup", userMessage: userText.substring(0, 200), aiResponse: "주문조회 차단: 미인증", escalated: false, category: "order", confidence: 1.0 });
            return res.status(200).send("OK");
          }
          var cOwnerId = (combinedOrder.user && combinedOrder.user.id) || null;
          if (cOwnerId && String(cOwnerId) !== String(veaslyUser.id)) {
            await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: orderSecurityMsgs.denied[detectedLang] || orderSecurityMsgs.denied["zh-TW"] }] });
            console.log("[Security] Combined order ownership mismatch:", orderNum, "owner:", cOwnerId, "requester:", veaslyUser.id);
            aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: String(veaslyUser.id), userName: veaslyUser.name || "", lang: detectedLang, type: "order_lookup", userMessage: userText.substring(0, 200), aiResponse: "주문조회 차단: 소유권 불일치", escalated: false, category: "order", confidence: 1.0 });
            return res.status(200).send("OK");
          }
          var cItems = combinedOrder.items;
          var cChildren = combinedOrder.children || [];
          var isCombined = cChildren.length > 0;
          var cPayment = combinedOrder.payment || {};
          var cHeaders = {
            "zh-TW": isCombined ? "📦 合併配送訂單 " + orderNum + "：\n（包含 " + cChildren.length + " 筆原始訂單合併寄送）\n\n" : "📦 訂單 " + orderNum + " 的狀態：\n\n",
            "ko": isCombined ? "📦 합배송 주문 " + orderNum + ":\n(" + cChildren.length + "건의 원본 주문 합배송)\n\n" : "📦 주문 " + orderNum + " 상태:\n\n",
            "en": isCombined ? "📦 Combined Shipping Order " + orderNum + ":\n(" + cChildren.length + " original orders combined)\n\n" : "📦 Order " + orderNum + " Status:\n\n",
            "ja": isCombined ? "📦 合併配送注文 " + orderNum + "：\n（" + cChildren.length + "件の注文を合併配送）\n\n" : "📦 注文 " + orderNum + " の状態：\n\n"
          };
          var cReply = cHeaders[detectedLang] || cHeaders["zh-TW"];
          for (var ci = 0; ci < cItems.length; ci++) {
            var cItem = cItems[ci];
            var cStatus = veaslyApi.getStatusText(cItem.status, detectedLang);
            var cName = (cItem.product && cItem.product.name) || "상품";
            var cPrice = cItem.priceLocal || 0;
            var cCurrency = (cPayment.currency) || "TWD";
            cReply += (ci + 1) + ". " + cName + "\n";
            cReply += "   " + (detectedLang === "ko" ? "상태" : detectedLang === "en" ? "Status" : detectedLang === "ja" ? "状態" : "狀態") + ": " + cStatus + "\n";
            cReply += "   " + (detectedLang === "ko" ? "금액" : detectedLang === "en" ? "Price" : detectedLang === "ja" ? "金額" : "金額") + ": " + cCurrency + " " + cPrice + "\n\n";
          }
          var cTotal = cPayment.totalAmountLocal || 0;
          cReply += "💰 " + (detectedLang === "ko" ? "총 결제금액" : detectedLang === "en" ? "Total" : detectedLang === "ja" ? "合計" : "總付款金額") + ": " + (cPayment.currency || "TWD") + " " + cTotal + "\n";
          if (isCombined) {
            cReply += "\n📋 " + (detectedLang === "ko" ? "합배송으로 묶인 주문이므로 함께 배송됩니다!" : detectedLang === "en" ? "These orders are combined and will be shipped together!" : detectedLang === "ja" ? "合併配送のため、まとめて発送されます！" : "此為合併配送訂單，所有商品會一起寄出喔！");
          }
          cReply += "\n\n💡 " + (detectedLang === "ko" ? "더 궁금한 점이 있으면 입력해주세요!" : detectedLang === "en" ? "Any more questions? Just type!" : detectedLang === "ja" ? "他にご質問があればどうぞ！" : "還有其他問題嗎？直接輸入問題，AI會為您解答喔！");
          await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: cReply }] });
          console.log("[Order] Combined shipping replied:", orderNum, cItems.length, "items", isCombined ? "(merged " + cChildren.length + " orders)" : "");
          recordFCRResolved(memberId || personId || "", chatId, "order_lookup_combined");
          aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "order_lookup", userMessage: userText.substring(0, 200), aiResponse: "합배송 주문조회: " + orderNum + " (" + cItems.length + "개 아이템, " + (isCombined ? cChildren.length + "건 합배송" : "일반") + ")", escalated: false, category: "order", confidence: 0.9 });
          return res.status(200).send("OK");
        }
        if (orderItems && orderItems.length > 0) {
          // 보안: 소유권 검증. 본인 신원은 ChannelTalk 프로필(personId)로만 복구한다.
          // (주문의 이메일로 인증하면 "물어본 사람=주인"이 되어 소유권 검증이 무력화되므로 금지)
          if (!veaslyUser) {
            if (!veaslyUser && personId) {
              try {
                var retryUser2 = await channeltalk.getUser(personId);
                var retryProfile2 = (retryUser2 && retryUser2.user) || retryUser2 || {};
                var retryEmail2 = retryProfile2.email || (retryProfile2.profile && retryProfile2.profile.email) || "";
                var retryMemberId2 = retryProfile2.memberId || "";
                if (retryMemberId2) veaslyUser = await veaslyApi.findUserById(retryMemberId2, retryEmail2);
                else if (retryEmail2) veaslyUser = await veaslyApi.findUserByEmail(retryEmail2);
                if (veaslyUser) console.log("[Security] Retry auth success:", veaslyUser.name);
              } catch(retryErr2) {}
            }
            if (!veaslyUser) {
              await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: orderSecurityMsgs.noAuth[detectedLang] || orderSecurityMsgs.noAuth["zh-TW"] }] });
              console.log("[Security] Order blocked - no auth:", orderNum);
              aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: "", userName: "", lang: detectedLang, type: "order_lookup", userMessage: userText.substring(0, 200), aiResponse: "주문조회 차단: 미인증", escalated: false, category: "order", confidence: 1.0 });
              return res.status(200).send("OK");
            }
          }
          var normalOwnerId = (orderItems[0] && orderItems[0].order && orderItems[0].order.userId) || null;
          if (normalOwnerId && String(normalOwnerId) !== String(veaslyUser.id)) {
            await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: orderSecurityMsgs.denied[detectedLang] || orderSecurityMsgs.denied["zh-TW"] }] });
            console.log("[Security] Order ownership mismatch:", orderNum, "owner:", normalOwnerId, "requester:", veaslyUser.id);
            aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: String(veaslyUser.id), userName: veaslyUser.name || "", lang: detectedLang, type: "order_lookup", userMessage: userText.substring(0, 200), aiResponse: "주문조회 차단: 소유권 불일치", escalated: false, category: "order", confidence: 1.0 });
            return res.status(200).send("OK");
          }
          var orderInfo = veaslyApi.formatOrderInfo(orderItems, detectedLang);
          var orderHeaders = {
            "zh-TW": "訂單 " + orderNum + " 的狀態：",
            "ko": "주문 " + orderNum + " 상태:",
            "en": "Order " + orderNum + " status:",
            "ja": "注文 " + orderNum + " の状況："
          };
          var header = orderHeaders[detectedLang] || orderHeaders["zh-TW"];
          var orderReply = header + "\n" + orderInfo;
          // Add status-specific tips
          var mainStatus = (orderItems[0] && orderItems[0].status) || "";
          var tipMap = {
            "PAYMENT_WAITING": { "zh-TW": "請盡快完成付款，以免訂單被取消喔！", "ko": "빠른 결제 부탁드립니다!", "en": "Please complete payment soon!", "ja": "お早めにお支払いをお願いします！" },
            "PAYMENT_COMPLETED": { "zh-TW": "已收到付款，我們會盡快處理您的訂單！", "ko": "결제 확인! 빠르게 처리하겠습니다!", "en": "Payment received! We will process your order soon!", "ja": "お支払い確認済み！早速処理いたします！" },
            "ORDER_PROCESSING": { "zh-TW": "商品正在韓國國內配送中，寄往VEASLY倉庫，通常需要1-3個工作天喔！", "ko": "한국 내 배송 중입니다. VEASLY 창고로 이동 중이며 보통 1-3 영업일 소요됩니다!", "en": "Shipping within Korea to VEASLY warehouse, usually takes 1-3 business days!", "ja": "韓国国内配送中です。VEASLY倉庫へ通常1-3営業日かかります！" },
            "SHIPPING_TO_BDJ": { "zh-TW": "商品已到達VEASLY倉庫！正在準備國際包裹，即將為您寄出！", "ko": "VEASLY 창고에 도착했습니다! 국제 배송 준비 중입니다!", "en": "Arrived at VEASLY warehouse! Preparing international shipment!", "ja": "VEASLY倉庫に到着しました！国際発送の準備中です！" },
            "SHIPPING_TO_HOME": { "zh-TW": "包裹已從韓國寄出！國際配送通常需要5-10個工作天，收到 EZ WAY 通知時，請記得按「申報相符」才能順利通關喔！", "ko": "한국에서 출발! 국제 배송은 보통 5-10 영업일 소요됩니다!", "en": "Shipped from Korea! International delivery takes 5-10 business days!", "ja": "韓国から発送済み！国際配送は通常5-10営業日かかります！" },
            "COMPLETED": { "zh-TW": "訂單已完成！感謝您的購買～", "ko": "주문 완료! 감사합니다~", "en": "Order completed! Thank you!", "ja": "注文完了！ありがとうございます！" },
            "CANCEL_COMPLETED": { "zh-TW": "此訂單已取消，退款會在3-5個工作天內處理喔！", "ko": "주문이 취소되었습니다. 환불은 3-5 영업일 내 처리됩니다!", "en": "Order cancelled. Refund will be processed in 3-5 business days!", "ja": "注文キャンセル済み。返金は3-5営業日以内に処理されます！" }
          };
          var tip = (tipMap[mainStatus] && tipMap[mainStatus][detectedLang]) || (tipMap[mainStatus] && tipMap[mainStatus]["zh-TW"]) || "";
          if (tip) orderReply += "\n\n📋 " + tip;
          // 주문 상태별 맞춤 후속 행동 제안
          var followUpMap = {
            "PAYMENT_WAITING": { "zh-TW": "⏰ 如果付款遇到問題，可以直接告訴我喔！支援信用卡、ATM轉帳、PayPal付款方式。", "ko": "⏰ 결제 문제가 있으시면 알려주세요! 신용카드, ATM이체, PayPal을 지원합니다.", "en": "⏰ Need help with payment? We support credit card, ATM, and PayPal!", "ja": "⏰ お支払いでお困りですか？クレジットカード、ATM、PayPalに対応しています！" },
            "PAYMENT_COMPLETED": { "zh-TW": "🔄 商品正在等待賣家出貨，我們會持續追蹤喔！如果超過3天沒更新，請直接告訴我，我來幫您催促賣家！", "ko": "🔄 판매자 출고 대기 중입니다. 3일 이상 변동 없으면 말씀해주세요, 판매자에게 독촉하겠습니다!", "en": "🔄 Waiting for seller to ship. If no update in 3 days, let me know and I will follow up!", "ja": "🔄 セラーの発送待ちです。3日以上更新がなければお知らせください！" },
            "ORDER_PROCESSING": { "zh-TW": "🚚 如果超過3個工作天還沒到倉庫，請告訴我，我會幫您跟賣家確認喔！您也可以問我：「幫我催一下」", "ko": "🚚 3영업일 이상 변동 없으면 알려주세요! 판매자에게 확인하겠습니다. 「독촉해줘」라고 입력하셔도 돼요!", "en": "🚚 If no update in 3 business days, let me know and I will check with the seller!", "ja": "🚚 3営業日以上更新がなければお知らせください！セラーに確認いたします！" },
            "SHIPPING_TO_BDJ": { "zh-TW": "📦 商品已在倉庫！如果有其他訂單想一起寄（合併配送），請告訴我喔！通常1-2天內會安排國際寄出。", "ko": "📦 창고에 도착! 다른 주문과 합배송을 원하시면 말씀해주세요! 보통 1-2일 내 국제발송 예정입니다.", "en": "📦 At warehouse! Want to combine with other orders? Let me know! Usually ships internationally in 1-2 days.", "ja": "📦 倉庫到着！他の注文と合わせて発送をご希望ですか？通常1-2日で国際発送します！" },
            "SHIPPING_TO_HOME": { "zh-TW": "✈️ 包裹飛往您手中了！追蹤進度可以查看EZ WAY APP，收到通知記得按「申報相符」喔！通常5-10個工作天到達。\n如果超過10天還沒收到，請告訴我！", "ko": "✈️ 국제배송 중! 보통 5-10영업일 소요됩니다. 10일 이상 지연 시 말씀해주세요!", "en": "✈️ On the way! Usually arrives in 5-10 business days. Let me know if it takes longer than 10 days!", "ja": "✈️ 配送中です！通常5-10営業日で届きます。10日以上かかる場合はお知らせください！" },
            "COMPLETED": { "zh-TW": "🎉 期待您的下次購物！如果商品有任何問題，7天內可以申請退換貨喔～", "ko": "🎉 다음 쇼핑도 기대해주세요! 상품 문제 시 7일 이내 교환/환불 가능합니다~", "en": "🎉 Hope you love it! If any issues, returns are available within 7 days!", "ja": "🎉 お楽しみいただけましたか？7日以内なら返品・交換可能です！" },
            "CANCEL_COMPLETED": { "zh-TW": "💰 退款會在3-5個工作天內處理。如果想重新下單，可以直接在 veasly.com 申請報價喔！", "ko": "💰 환불은 3-5영업일 내 처리됩니다. 재주문을 원하시면 veasly.com에서 견적 요청해주세요!", "en": "💰 Refund in 3-5 business days. Want to reorder? Visit veasly.com!", "ja": "💰 返金は3-5営業日以内に処理されます。再注文はveasly.comからどうぞ！" }
          };
          var followUp = (followUpMap[mainStatus] && followUpMap[mainStatus][detectedLang]) || (followUpMap[mainStatus] && followUpMap[mainStatus]["zh-TW"]) || "";
          if (followUp) orderReply += "\n\n" + followUp;
          orderReply += "\n\n💡 " + (detectedLang === "ko" ? "더 궁금한 점이 있으면 입력해주세요!" : detectedLang === "en" ? "Any more questions? Just type!" : detectedLang === "ja" ? "他にご質問があればどうぞ！" : "還有其他問題嗎？直接輸入問題，AI會為您解答喔！");
          await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: orderReply }] });
          if (!chatContext[chatId]) chatContext[chatId] = {};
          chatContext[chatId].lastOrder = orderReply;
          chatContext[chatId].lastOrderContext = buildOrderContext(orderItems, orderNum, detectedLang);
          chatContext[chatId].lastOrderTime = Date.now();
          console.log("[Order] Replied with", orderItems.length, "items for", orderNum);
          recordFCRResolved(memberId || personId || "", chatId, "order_lookup");
          aiLog.saveConversation({
            timestamp: new Date().toISOString(),
            chatId: chatId,
            userId: memberId || "",
            userName: veaslyUser ? veaslyUser.name : "",
            lang: detectedLang,
            type: "order_lookup",
            userMessage: userText.substring(0, 200),
            aiResponse: "주문조회: " + orderNum + " (" + orderItems.length + "개 아이템)",
            escalated: false,
            category: "order",
        confidence: 0.8,
          });
          return res.status(200).send("OK");
        } else {
          var notFoundMsgs = {
            "zh-TW": "找不到訂單 " + orderNum + " 的資料，請確認訂單編號是否正確喔！",
            "ko": "주문 " + orderNum + " 정보를 찾을 수 없습니다. 주문번호를 확인해주세요!",
            "en": "Order " + orderNum + " not found. Please check the order number!",
            "ja": "注文 " + orderNum + " が見つかりません。注文番号をご確認ください！"
          };
          await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: notFoundMsgs[detectedLang] || notFoundMsgs["zh-TW"] }] });
          return res.status(200).send("OK");
        }
      } catch(orderErr) { console.error("[Order] Lookup error:", orderErr.message); }
    }

    // Order status keyword - show user's recent orders
    var orderKeywords = ["訂單", "주문", "order", "注文", "배송", "配送", "出貨"];
    var isOrderQuery = orderKeywords.some(function(kw) { return userText.toLowerCase().indexOf(kw) !== -1; });
    // 질문형 패턴 감지: 정책 FAQ 질문이면 주문목록 대신 AI로 라우팅
    var policyQuestionPatterns = ["嗎", "？", "怎麼", "為什麼", "為何", "一定", "可以嗎", "多少", "如何", "是否", "能不能", "會不會", "什麼時候", "할까", "인가요", "인가", "일까", "나요", "ですか", "でしょうか"];
    var hasQuestionPattern = policyQuestionPatterns.some(function(p) { return userText.indexOf(p) !== -1; });
    var hasOrderNumber = /\d{8}(TW|KR|JP|US)\d+/i.test(userText);
    if (isOrderQuery && hasQuestionPattern && !hasOrderNumber) {
      console.log("[Route] Question pattern detected - skip order list, route to AI:", userText.substring(0, 50));
      isOrderQuery = false;
    }
    if (isOrderQuery && veaslyUser && veaslyUser.email) {
      try {
        var userOrders = await veaslyApi.getUserOrders(veaslyUser.email, 500, memberId);
        if (userOrders.length > 0) {
          var recentOrders = userOrders.slice(0, 5);
          var listHeaders = {
            "zh-TW": "您最近的訂單：",
            "ko": "최근 주문 내역:",
            "en": "Your recent orders:",
            "ja": "最近のご注文："
          };
          var listHeader = listHeaders[detectedLang] || listHeaders["zh-TW"];
          var orderLines = recentOrders.map(function(o, i) {
            var providerTag = o._provider ? " [" + o._provider + "]" : ""; var currentTag = o._isCurrentAccount === false ? " ⚠" : ""; return (i + 1) + ". " + o.orderNumber + " (" + veaslyApi.getStatusText(o.status, detectedLang) + ")" + providerTag + currentTag;
          });
          var listReply = listHeader + "\n" + orderLines.join("\n");
          var hasMultiAccount = recentOrders.some(function(o) { return o._isCurrentAccount === false; }); if (hasMultiAccount) { listReply += "\n\n" + (detectedLang === "ko" ? "⚠ = 다른 로그인 방식으로 주문한 건입니다" : detectedLang === "en" ? "⚠ = ordered from a different login method" : detectedLang === "ja" ? "⚠ = 別のログイン方法での注文です" : "⚠ = 透過其他登入方式下的訂單"); } listReply += "\n\n" + (detectedLang === "ko" ? "주문번호를 입력하시면 상세 상태를 확인할 수 있어요!" : detectedLang === "en" ? "Enter an order number for details!" : detectedLang === "ja" ? "注文番号を入力すると詳細が確認できます！" : "輸入完整訂單編號可查看詳細狀態喔！如果配送有問題，也可以直接告訴我喔！");
          await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: listReply }] });
          console.log("[Order] Listed", recentOrders.length, "orders for", veaslyUser.email);
          
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "order_list", userMessage: userText, aiResponse: "주문 목록 " + recentOrders.length + "건 조회", escalated: false, confidence: 0.8, category: "order" });
      recordFCRResolved(memberId || personId || "", chatId, "order_list");
      return res.status(200).send("OK");
        } else {
          // No orders bound to this account (admin feed has none for this user.id).
          // Guide to direct order-number lookup / human agent instead of silently falling through.
          var noOrderMsgs = {
            "zh-TW": "找不到與您帳戶綁定的訂單記錄 😥\n如果您有訂單編號，請直接輸入完整編號（例如 20260421TW...），我馬上為您查詢！\n或輸入「聯繫客服」，由專人協助您喔～",
            "ko": "고객님 계정에 연결된 주문 내역을 찾지 못했어요 😥\n주문번호가 있으시면 전체 번호(예: 20260421TW...)를 입력해 주세요. 바로 조회해 드릴게요!\n또는 '상담원 연결'을 입력하시면 담당자가 도와드립니다.",
            "en": "I couldn't find any orders linked to your account 😥\nIf you have an order number, please enter the full number (e.g. 20260421TW...) and I'll look it up right away!\nOr type \"contact support\" to reach a human agent.",
            "ja": "お客様のアカウントに紐づくご注文が見つかりませんでした 😥\n注文番号がございましたら、完全な番号（例：20260421TW...）をご入力ください。すぐにお調べします！\nまたは「カスタマーサポート」とご入力ください。"
          };
          await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: noOrderMsgs[detectedLang] || noOrderMsgs["zh-TW"] }] });
          aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "order_list_empty", userMessage: userText, aiResponse: "주문 없음 안내 (계정 연결 주문 0건)", escalated: false, confidence: 0.8, category: "order" });
          return res.status(200).send("OK");
        }
      } catch(olErr) { console.error("[Order] List error:", olErr.message); }

    // === 업그레이드3: userId 기반 주문 자동조회 (veaslyUser 없을 때) ===
    if (isOrderQuery && !veaslyUser && memberId) {
      try {
        var _fallbackUser = await veaslyApi.findUserById(memberId);
        if (_fallbackUser && _fallbackUser.email) {
          var _fbOrders = await veaslyApi.getUserOrders(_fallbackUser.email, 500, memberId);
          if (_fbOrders.length > 0) {
            var _fbRecent = _fbOrders.slice(0, 5);
            var _fbHeader = {"zh-TW": "為您查到以下訂單：", "ko": "주문 내역을 찾았습니다:", "en": "Found your orders:", "ja": "ご注文が見つかりました："};
            var _fbLines = _fbRecent.map(function(o, i) { return (i+1) + ". " + o.orderNumber + " (" + veaslyApi.getStatusText(o.status, detectedLang) + ")"; });
            var _fbReply = (_fbHeader[detectedLang] || _fbHeader["zh-TW"]) + "\n" + _fbLines.join("\n") + "\n\n" + (detectedLang === "ko" ? "주문번호를 입력하면 상세 조회할 수 있어요!" : detectedLang === "en" ? "Enter order number for details!" : detectedLang === "ja" ? "注文番号を入力すると詳細確認できます！" : "輸入訂單編號可查看詳細狀態喔！");
            await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: _fbReply }] });
            aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || "", lang: detectedLang, type: "order_list", userMessage: userText, aiResponse: "userId fallback 주문조회 " + _fbRecent.length + "건", escalated: false, confidence: 0.8, category: "order" });
            return res.status(200).send("OK");
          }
        }
      } catch(_fbErr) { console.error("[Order] userId fallback error:", _fbErr.message); }
    }

    }

    // AI-first, then FAQ fallback

    // === 업그레이드4: 실시간 배송추적 응답 ===
    var _shipKws = ["包裹到哪", "物流", "到哪了", "寄到哪", "到貨", "配送進度", "出貨了嗎", "什麼時候到", "何時到", "還沒收到", "배송", "택배", "어디", "shipping", "tracking", "where is", "届く", "届いた", "配送状況"];
    var _isShipQuery = _shipKws.some(function(kw) { return userText.toLowerCase().indexOf(kw.toLowerCase()) > -1; });
    if (_isShipQuery && veaslyUser && veaslyUser.email && !orderMatches.length) {
      try {
        var _shipOrders = await veaslyApi.getUserOrders(veaslyUser.email, 500, memberId);
        var _activeOrders = _shipOrders.filter(function(o) { return ["ORDER_PROCESSING","SHIPPING_TO_BDJ","SHIPPING_TO_HOME"].indexOf(o.status) > -1; });
        if (_activeOrders.length > 0) {
          var _shipHeaders = {"zh-TW": "📦 您目前配送中的訂單：", "ko": "📦 배송 중인 주문:", "en": "📦 Orders in transit:", "ja": "📦 配送中のご注文："};
          var _shipLines = _activeOrders.slice(0, 5).map(function(o, i) {
            var st = veaslyApi.getStatusText(o.status, detectedLang);
            var tips = {"ORDER_PROCESSING": (detectedLang === "ko" ? "한국 내 배송 중 (1-3일)" : "韓國境內配送中（約1-3工作天）"), "SHIPPING_TO_BDJ": (detectedLang === "ko" ? "VEASLY 창고 도착, 국제발송 준비 중" : "已到VEASLY倉庫，準備國際寄送"), "SHIPPING_TO_HOME": (detectedLang === "ko" ? "국제배송 중 (7-14일)" : "國際配送中（約7-14天），請在EZ WAY APP按「申報相符」")};
            return (i+1) + ". " + o.orderNumber + "\n   " + st + " — " + (tips[o.status] || "");
          });
          var _shipReply = (_shipHeaders[detectedLang] || _shipHeaders["zh-TW"]) + "\n\n" + _shipLines.join("\n\n");
          _shipReply += "\n\n💡 " + (detectedLang === "ko" ? "주문번호를 입력하면 더 자세한 상태를 확인할 수 있어요!" : detectedLang === "en" ? "Enter order number for more details!" : detectedLang === "ja" ? "注文番号を入力すると詳細確認できます！" : "輸入訂單編號可查看更詳細狀態喔！");
          await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: _shipReply }] });
          aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "shipping_status", userMessage: userText.substring(0, 200), aiResponse: "실시간 배송추적 " + _activeOrders.length + "건", escalated: false, confidence: 0.9, category: "shipping" });
          recordFCRResolved(memberId || personId || "", chatId, "shipping_status");
          return res.status(200).send("OK");
        }
      } catch(_shipErr) { console.error("[Shipping] Realtime query error:", _shipErr.message); }
    }
    // === 업그레이드4 END ===

    var aiAnswer = null;
    var softCaveatOnly = false; // confidence<0.70: AI 참고용 딱지만 붙이고 매니저 자동호출은 안 함 (Option A)
    if (aiEngine.isReady()) {
      try {
      var memberContext = veaslyUser ? "[회원: " + veaslyUser.name + ", 주문 " + (veaslyUser.requestCount || 0) + "건, 포인트 " + (veaslyUser.credit || 0) + "]" : "";
        // Fetch recent chat history for context
        var chatHistory = [];
        try {
          var recentMsgs = await channeltalk.getChatMessages(chatId, 10);
          var msgs = (recentMsgs.messages || []).reverse();
          for (var hi = 0; hi < msgs.length; hi++) {
            var hMsg = msgs[hi];
            if (!hMsg.plainText || hMsg.plainText.trim().length === 0) continue;
            var hRole = (hMsg.personType || "").toLowerCase() === "user" ? "user" : "bot";
            var hText = hMsg.plainText.trim();
            if (hText.length > 200) hText = hText.substring(0, 200) + "...";
            chatHistory.push({ role: hRole, text: hText });
          }
          // Remove the current message (last user message) to avoid duplication
          if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === "user") {
            chatHistory.pop();
          }
          // Keep last 5 exchanges
          if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
        } catch(histErr) { console.error("[Context] History fetch error:", histErr.message); }
        // Inject recent order context if available (30min TTL)
        if (chatContext[chatId] && chatContext[chatId].lastOrderContext && (Date.now() - chatContext[chatId].lastOrderTime) < 30 * 60 * 1000) {
          // lastOrderContext에는 'AI回答指南' 마커가 있어 ai-engine이 주문 상태를 인식한다 (lastOrder는 고객용 텍스트라 인식 못함)
          chatHistory.unshift({ role: "bot", text: chatContext[chatId].lastOrderContext });
        }
        var aiResult = await aiEngine.generateAnswer(memberContext ? memberContext + " " + userText : userText, detectedLang, chatId, chatHistory);
        if (aiResult && typeof aiResult === "object") {
          aiAnswer = aiResult.answer;
          var confidence = aiResult.confidence || 0;
          console.log("[AI] Confidence:", confidence.toFixed(3));
          // [⑤ 근거 검증 실패 시 fallback] 검증에서 NO 판정된 답변은 저신뢰로 강등 → 기존 에스컬레이션 경로로
          if (aiResult.grounded === false) {
            console.log("[AI] Grounding validation FAILED - forcing escalation path");
            confidence = 0;
          }
          if (confidence < 0.25) {
            console.log("[AI] Very low confidence (" + confidence.toFixed(3) + ") - " + (isBusinessHours() ? "auto-escalate" : "off-hour AI guide only") + " [threshold: 0.25]");
            
            if (!isBusinessHours()) {
              // ★ 오프시간: 매니저 초대 없이 AI가 적극 안내
              try {
                var _holAI = getHolidayNotice(detectedLang);
                var offHourLowMsgs = {
                  "zh-TW": (_holAI ? _holAI + "\n\n" : "") + "感謝您的提問！🙏\n\n💡 目前非客服時間，但我可以馬上幫您：\n・請輸入「訂單號碼」→ 馬上查詢進度\n・描述您的問題 → AI為您解答\n\n例如：\n・貼上訂單號碼（如 20260415TW...）\n・「我的包裹到哪了」\n・「運費怎麼算」\n\n⏰ 客服時間：週一至週五 台灣09:00~18:00\n客服人員上班後會優先為您處理！😊",
                  "ko": (_holAI ? _holAI + "\n\n" : "") + "질문 감사합니다! 🙏\n\n💡 현재 상담 시간 외이지만 제가 먼저 도와드릴게요:\n・주문번호 입력 → 바로 조회\n・궁금한 점을 말씀해주세요\n\n⏰ 상담시간: 평일 10:00~19:00 (한국시간)\n업무 시작 후 우선 답변드리겠습니다!",
                  "en": (_holAI ? _holAI + "\n\n" : "") + "Thanks for your question! 🙏\n\n💡 We're currently outside business hours, but I can help right away:\n・Enter your order number for instant tracking\n・Describe your issue and I'll assist\n\n⏰ Business hours: Mon-Fri 10:00-19:00 KST\nOur team will prioritize your inquiry!",
                  "ja": (_holAI ? _holAI + "\n\n" : "") + "ご質問ありがとうございます！🙏\n\n💡 現在営業時間外ですが、まずお手伝いします：\n・注文番号を入力 → すぐに確認\n・お問い合わせ内容をご記入ください\n\n⏰ 営業時間：月〜金 10:00〜19:00 KST\n営業開始後、優先的に対応いたします！"
                };
                await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: offHourLowMsgs[detectedLang] || offHourLowMsgs["zh-TW"] }] });
                aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", lang: detectedLang, type: "ai_answer", userMessage: userText.substring(0, 200), aiResponse: "오프시간 low-confidence → AI 안내 (에스컬레이션 안 함)", escalated: false, escalationReason: "off_hour_low_confidence", confidence: confidence, category: (aiResult && aiResult.category) || "other" });
              } catch(olcErr) { console.error("[AI] Off-hour low conf error:", olcErr.message); }
            } else {
              // 영업시간: 기존 로직 유지 - 매니저 연결
              aiAnswer = null;
              try {
                var lowConfMsgs = {
                  "zh-TW": "您的問題需要客服人員協助，正在為您轉接，請稍候 🙏",
                  "ko": "해당 질문은 상담사의 도움이 필요합니다. 연결 중이니 잠시만 기다려주세요 🙏",
                  "en": "Your question needs agent assistance. Connecting you now, please wait 🙏",
                  "ja": "担当者におつなぎいたします。少々お待ちください 🙏"
                };
                await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: lowConfMsgs[detectedLang] || lowConfMsgs["zh-TW"] }] });
                // [SOP v2] 팔로워 정책: MIA·우선 초대 + 강준 팔로워
                await connectManager(chatId, detectedLang);
                console.log("[AI] Very low confidence auto-escalation for:", chatId);
                aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", lang: detectedLang, type: "escalation", userMessage: userText.substring(0, 200), aiResponse: "confidence " + confidence.toFixed(3) + " < 0.3 → 자동 에스컬레이션", escalated: true, escalationReason: "low_confidence", confidence: confidence, category: (aiResult && aiResult.category) || "other" });
              } catch(lcErr) { console.error("[AI] Low confidence escalation error:", lcErr.message); }
            }
          } else if (confidence < 0.70) {
            // 실측 분포상 점수는 0.60~0.82에 몰려 있고 횡설수설도 ~0.69까지 나옴.
            // 0.70 미만은 "AI 참고용" 딱지만 붙이고 매니저 자동호출은 하지 않는다 (Option A).
            var hasOrderCtx = chatContext[chatId] && chatContext[chatId].lastOrderContext && (Date.now() - chatContext[chatId].lastOrderTime) < 60 * 60 * 1000;
            if (hasOrderCtx) {
              console.log("[AI] Medium confidence but order context exists - answer only, skip caveat");
              // 주문 맥락 존재 → 딱지 없이 AI 답변만 전송
            } else {
              console.log("[AI] Below-confident (" + confidence.toFixed(3) + ") - soft caveat" + (isBusinessHours() ? "" : ", off-hour"));
              if (!isBusinessHours()) {
                // 오프시간: AI 답변 + 안내만, 에스컬레이션 안 함
                var offHourMedNote = {
                  "zh-TW": "\n\n💡 以上為AI回覆，供您參考！若需進一步協助，客服人員會在上班後（台灣09:00~18:00）為您確認 😊",
                  "ko": "\n\n💡 위 답변은 AI 응답입니다. 추가 확인이 필요하시면 영업시간(10:00~19:00)에 상담사가 확인해드리겠습니다 😊",
                  "en": "\n\n💡 This is an AI response for your reference. For further assistance, our team will confirm during business hours (Mon-Fri 10:00-19:00 KST) 😊",
                  "ja": "\n\n💡 上記はAI回答です。追加確認が必要な場合、営業時間内（月〜金 10:00〜19:00 KST）に担当者が確認いたします 😊"
                };
                aiAnswer += offHourMedNote[detectedLang] || offHourMedNote["zh-TW"];
                // 오프시간은 에스컬레이션 스킵 - 아래 connectManager를 건너뜀
                await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: aiAnswer }] });
                aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "ai_answer", userMessage: userText.substring(0, 200), aiResponse: aiAnswer.substring(0, 300), escalated: false, escalationReason: "off_hour_medium_confidence", confidence: confidence, category: (aiResult && aiResult.category) || "other" });
                return res.status(200).send("OK");
              }
              // 영업시간 (Option A): 약한 참고용 딱지만, 매니저 자동호출 안 함.
              // 문구에 에스컬레이션 키워드(轉接/상담사/confirm 등)를 넣지 않아 키워드 기반 호출도 트리거하지 않음.
              var softNote = {
                "zh-TW": "\n\n💡 以上為AI回覆，僅供參考。若需要更進一步的協助，隨時再告訴我喔！",
                "ko": "\n\n💡 위 답변은 참고용 AI 응답이에요. 더 도움이 필요하시면 언제든 말씀해주세요!",
                "en": "\n\n💡 This is an AI reference answer. Feel free to ask if you'd like more help!",
                "ja": "\n\n💡 上記は参考用のAI回答です。さらにお手伝いが必要でしたらいつでもどうぞ！"
              };
              aiAnswer += softNote[detectedLang] || softNote["zh-TW"];
              softCaveatOnly = true;
            } // close else (no order context)
          }
        } else {
          aiAnswer = aiResult;
        }
      } catch(aiErr) {
        console.error("[AI] Error:", aiErr.message);
        aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "ai_error", userMessage: userText.substring(0, 200), aiResponse: "AI Error: " + aiErr.message, escalated: false, confidence: 0, category: "other" });
      }
    }
    if (aiAnswer) {
      var footers = {
        "zh-TW": "\n\n💡 還有其他問題嗎？直接輸入問題，AI會為您解答喔！",
        "ko": "\n\n💡 다른 질문이 있으신가요? 직접 질문을 입력하시면 AI가 답변해드려요!",
        "en": "\n\n💡 Need more help? Just type your question!",
        "ja": "\n\n💡 他にご質問がございましたら、そのままご入力ください！"
      };
      aiAnswer = appendFooter(chatId, aiAnswer, footers, detectedLang); // [2026-06-30] 반복 푸터 억제
      // Prevent duplicate - only send if not already responded
      if (!res.headersSent) {
        await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: aiAnswer }] });
      }

      // Log AI conversation
      var aiEscalated = false;
      var escalateKeywords = ["轉接客服", "轉接", "客服確認", "客服人員", "為您確認", "幫您確認", "需要客服", "建議聯繫", "請聯繫客服", "無法為您", "담당자를 연결", "담당자에게", "상담사", "확인이 필요", "상담원", "connect you with", "support team", "contact support", "unable to help", "担当者におつなぎ", "担当者に", "お問い合わせ"];
      var needEscalate = false;
      // 봇이 확실히 아는 정보는 에스컬레이션 키워드 무시
      var _botConfidentTopics = ["假日", "공휴일", "holiday", "祝日", "營業時間", "上班時間", "영업시간",
        "business hour", "工作時間", "休假", "放假", "客服時間", "상담 시간", "幾點", "什麼時候上班",
        "週末", "주말", "weekend", "國定假日", "勞動節", "春節", "中秋", "端午", "開天節",
        "設날", "추석", "어린이날", "성탄절", "聖誕", "元旦", "新年"];
      var _botConfidentAnswer = false;
      if (confidence >= 0.6) {
        for (var _bt = 0; _bt < _botConfidentTopics.length; _bt++) {
          if (userText.indexOf(_botConfidentTopics[_bt]) > -1) {
            _botConfidentAnswer = true;
            console.log("[AI] Bot-confident topic detected: " + _botConfidentTopics[_bt] + " - skip escalation keywords");
            break;
          }
        }
      }

      // <0.6 구간엔 "상담사가 확인" 안내문구가 붙으므로(1655행) 실제 escalation도 같은 구간에 맞춘다.
      // (이전 <0.5는 en/ja가 안내만 하고 매니저 초대는 안 되는 약속불이행 버그였음)
      var mediumConfidenceEsc = (confidence > 0 && confidence < 0.6);
      // [2026-05-27] confidence와 무관하게 AI 답변이 "상담사/轉接/connect" 약속하면 실제 escalation 수행.
      // 이전: confidence >= 0.65 → 키워드 체크 스킵 → 봇이 "연결합니다" 약속만 하고 실제로는 안 함 (UX 버그).
      for (var ek = 0; !_botConfidentAnswer && ek < escalateKeywords.length; ek++) {
        if (aiAnswer.indexOf(escalateKeywords[ek]) !== -1) { needEscalate = true; break; }
      }
      if (softCaveatOnly) { needEscalate = false; mediumConfidenceEsc = false; } // 참고용 딱지 구간은 매니저 자동호출 안 함
      aiEscalated = needEscalate || mediumConfidenceEsc;
      var hasOrderCtxForEsc = chatContext[chatId] && chatContext[chatId].lastOrderContext && (Date.now() - chatContext[chatId].lastOrderTime) < 60 * 60 * 1000;
      if (mediumConfidenceEsc && !needEscalate && !hasOrderCtxForEsc) {
        console.log("[AI] Medium confidence (" + (confidence || 0).toFixed(3) + ") - triggering escalation after AI answer (no order context)");
        try {
          // [SOP v2] 팔로워 정책: MIA·우선 초대 + 강준 팔로워
          await connectManager(chatId, detectedLang);
        } catch(medErr) { console.error("[AI] Med confidence escalation error:", medErr.message); }
      }
      aiLog.saveConversation({
        timestamp: new Date().toISOString(),
        chatId: chatId,
        userId: memberId || personId || "",
        userName: veaslyUser ? veaslyUser.name : "",
        lang: detectedLang,
        type: "ai_answer",

        userMessage: userText.substring(0, 200),
        aiResponse: aiAnswer.substring(0, 500),
        escalated: needEscalate,
        category: analytics.classifyMessage(userText),
        confidence: confidence,
      });
      recordFCRResolved(memberId || personId || "", chatId, "ai_answer");

      if (needEscalate && !_botConfidentAnswer) {
        try {
          // [SOP v2] 팔로워 정책: MIA·우선 초대 + 강준 팔로워 (전체 매니저 X)
          await connectManager(chatId, detectedLang);
          console.log("[Escalate] AI auto-escalated chat:", chatId);
        } catch(escErr) { console.error("[Escalate] Error:", escErr.message); }
      }
      // Cache this exchange
      if (!_chatHistoryCache[chatId]) _chatHistoryCache[chatId] = [];
      _chatHistoryCache[chatId].push({ role: "user", text: userText.substring(0, 200) });
      _chatHistoryCache[chatId].push({ role: "bot", text: aiAnswer.substring(0, 200) });
      if (_chatHistoryCache[chatId].length > 20) _chatHistoryCache[chatId] = _chatHistoryCache[chatId].slice(-20);
      return res.status(200).send("OK");
    }
    var matched = matcher.findBestMatch(userText);
    if (matched) {
      var answerText = matched.answer;
      var footers2 = {
        "zh-TW": "\n\n💡 還有其他問題嗎？直接輸入問題，AI會為您解答喔！",
        "ko": "\n\n💡 다른 질문이 있으신가요? 직접 질문을 입력하시면 AI가 답변해드려요!",
        "en": "\n\n💡 Need more help? Just type your question!",
        "ja": "\n\n💡 他にご質問がございましたら、そのままご入力ください！"
      };
      answerText = appendFooter(chatId, answerText, footers2, detectedLang); // [2026-06-30] 반복 푸터 억제
      await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: answerText }] });
      if (matched.escalate) {
        try {
          // [SOP v2] 팔로워 정책: MIA·우선 초대 + 강준 팔로워
          await connectManager(chatId, detectedLang);
        } catch(e) {}
      }
      
          aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "escalation", userMessage: userText, aiResponse: "매니저 에스컬레이션 (수동)", escalated: true, escalationReason: "ai_self_escalate", confidence: 0, category: (aiResult && aiResult.category) || "other" });
          return res.status(200).send("OK");
    }
    // Fallback — [FIX B 2026-06-29] AI가 답을 만들지 못하고 키워드 FAQ도 미스인 경우.
    // 예전엔 '아직 학습 중' 제식 안내만 반복해(escalated:false) 손님이 무한 루프에 갇혔다
    // (특히 Gemini 429 한도소진 구간). 이제 키워드 에스컬레이션과 동일하게 상담사에게 자동 연결한다.
    // (참고: line 583에서 매니저 활성 시 이미 return하므로 여기 도달 = 활성 매니저 없음 → 중복초대 없음)
    // 학습용 미응답 저장은 유지.
    if (userText && userText.length > 2 && aiEngine.isReady()) {
      aiEngine.addToKnowledgeBase(
        "unanswered_" + chatId + "_" + Date.now(),
        userText,
        { namespace: "unanswered", source: "user_fallback", chatId: chatId, language: detectedLang, timestamp: new Date().toISOString() }
      ).catch(function(e){ console.error("[Learn] unanswered save error:", e.message); });
      console.log("[Learn] Unanswered question saved:", userText.substring(0, 50));
    }
    var fbBizOpen = isBusinessHours();
    var fbEscMsgs;
    if (fbBizOpen) {
      fbEscMsgs = {
        'zh-TW': '抱歉，這個問題我無法立即為您解答 🙏 正在為您轉接真人客服，請稍候！',
        'ko': '죄송합니다, 이 질문은 제가 바로 답변드리기 어려워요 🙏 상담사를 연결해 드릴게요, 잠시만 기다려주세요!',
        'en': "Sorry, I can't answer this one right away 🙏 Connecting you to a live agent, please wait!",
        'ja': '申し訳ございません、この質問にはすぐにお答えできません 🙏 オペレーターにお繋ぎします。少々お待ちください！'
      };
    } else {
      var _fbHol = getHolidayNotice(detectedLang);
      fbEscMsgs = {
        'zh-TW': (_fbHol ? _fbHol + '\n\n' : '') + '抱歉，這個問題需要真人客服協助 🙏\n目前非客服時間（平日 台灣 09:00~18:00）。請留下您的問題（訂單問題請附上訂單號碼），我們上班後會優先回覆您！',
        'ko': (_fbHol ? _fbHol + '\n\n' : '') + '죄송합니다, 이 질문은 상담사 확인이 필요해요 🙏\n지금은 상담 시간이 아니지만(평일 10:00~19:00 KST) 메시지를 남겨주시면 업무 시작 후 우선 답변드리겠습니다!',
        'en': "Sorry, this needs a human agent 🙏\nWe're outside business hours (Mon-Fri 09:00~18:00 TW). Leave your message (include your order number for order issues) and we'll reply first thing!",
        'ja': '申し訳ございません、この質問は担当者の確認が必要です 🙏\n現在営業時間外です（平日 10:00~19:00 KST）。メッセージを残していただければ、営業開始後すぐにご返信します！'
      };
    }
    await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: fbEscMsgs[detectedLang] || fbEscMsgs['zh-TW'] }] });
    // 사람 연결: 첫 operator 매니저 초대 + pending 등록 (키워드 경로 1126-1140과 동일 패턴)
    var fbInvited = false;
    try {
      var fbMgrs = await getCachedManagers();
      var fbManagers = (fbMgrs && fbMgrs.managers) || [];
      for (var fbi = 0; fbi < fbManagers.length; fbi++) {
        if (fbManagers[fbi].operator) {
          await channeltalk.inviteManager(chatId, fbManagers[fbi].id);
          if (fbBizOpen) managerActive[chatId] = Date.now();
          pendingEscalations[chatId] = { time: Date.now(), managerId: fbManagers[fbi].id, lang: detectedLang };
          fbInvited = true;
          break;
        }
      }
      if (!fbInvited) { pendingEscalations[chatId] = { time: Date.now(), lang: detectedLang }; } // operator 없어도 추적되게 (15분 reassign 타이머가 커버)
    } catch(fbe) { console.error("[Fallback escalation] Error:", fbe.message); pendingEscalations[chatId] = { time: Date.now(), lang: detectedLang }; }
    try { var schedulerFb = require('../lib/scheduler'); schedulerFb.savePendingEscalation(chatId, memberId || personId || '', userText); } catch(pfe) {}
    aiLog.saveConversation({
      timestamp: new Date().toISOString(),
      chatId: chatId,
      userId: memberId || personId || '',
      userName: veaslyUser ? veaslyUser.name : '',
      lang: detectedLang,
      type: 'escalation',
      userMessage: userText.substring(0, 200),
      aiResponse: 'AI 답변 실패 → 상담사 자동 연결 (fallback escalation)',
      escalated: true,
      escalationReason: 'ai_fallback_escalation',
      category: analytics.classifyMessage(userText),
      confidence: 0,
    });
    return res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook Error]', error.message, error.stack);
    errorAlert.sendAlert('Webhook Error', error.message);
    res.status(200).send('OK');
  }
});


// === 15-min auto-reassign checker ===
setInterval(async function() {
  var now = Date.now();
  var REASSIGN_TIMEOUT = 15 * 60 * 1000;
  var chatIds = Object.keys(pendingEscalations);
  for (var i = 0; i < chatIds.length; i++) {
    var cid = chatIds[i];
    var esc = pendingEscalations[cid];
    if (!esc) { delete pendingEscalations[cid]; continue; }

    // === STAGED ALERTS ===
    var elapsed = now - (esc.timestamp || esc.time || now);
    var elapsedMin = Math.round(elapsed / 60000);
    if (elapsedMin >= 5 && !esc.warned5) {
      console.log('[ESCALATION-WARN] 5min no reply - chatId:', cid);
      esc.warned5 = true;
    }
    if (elapsedMin >= 10 && !esc.warned10) {
      console.log('[ESCALATION-WARN] 10min no reply - chatId:', cid);
      esc.warned10 = true;
    }
    if (elapsedMin >= 15 && !esc.waitingSent) {
      sendWaitingMessage(cid, esc.lang || 'zh-TW');
      esc.waitingSent = true;
    }
    // 30분 후속 안내: 구체적 예상 시간 제공
    if (elapsedMin >= 30 && !esc.followup30) {
      var followup30Msgs = {
        'zh-TW': '⏳ 已等待約30分鐘，非常抱歉！客服人員正在處理其他客戶的問題，預計15~30分鐘內回覆您。\n\n💡 小提醒：如果是訂單問題，您可以直接輸入訂單號碼，AI助手也許能幫您查詢喔！',
        'ko': '⏳ 약 30분 대기 중이시네요, 정말 죄송합니다! 상담사가 다른 고객 응대 중이며 15~30분 내 답변드리겠습니다.\n\n💡 팁: 주문 관련이라면 주문번호를 입력해보세요, AI가 도와드릴 수 있어요!',
        'en': '⏳ Sorry for the 30-minute wait! Our agent is helping other customers and will respond within 15~30 minutes.\n\n💡 Tip: For order inquiries, try entering your order number - our AI may be able to help!',
        'ja': '⏳ 30分お待たせして申し訳ございません！スタッフは他のお客様対応中で、15～30分以内にご返信いたします。'
      };
      try {
        await channeltalk.sendMessage(cid, { blocks: [{ type: 'text', value: followup30Msgs[esc.lang] || followup30Msgs['zh-TW'] }] });
        console.log('[FOLLOWUP] 30min notice sent to:', cid);
      } catch(e) { console.log('[FOLLOWUP] 30min error:', e.message); }
      esc.followup30 = true;
    }
    // 60분 최종 안내: 사과 + 우선 처리 약속
    if (elapsedMin >= 60 && !esc.followup60) {
      var followup60Msgs = {
        'zh-TW': '😔 非常抱歉讓您等這麼久！您的問題已被標記為「優先處理」，客服人員會儘快回覆。\n\n如果您需要離開，請放心留言，我們一定會回覆您！也可以留下Email，處理完畢後通知您。',
        'ko': '😔 오래 기다리게 해서 정말 죄송합니다! 우선 처리로 표시되었으며, 상담사가 최대한 빨리 답변드리겠습니다.\n\n자리를 비우셔야 한다면 메시지를 남겨주세요. 반드시 답변드립니다!',
        'en': '😔 So sorry for the long wait! Your inquiry has been marked as priority. Our agent will respond ASAP.\n\nIf you need to leave, please leave a message - we will definitely reply!',
        'ja': '😔 長くお待たせして大変申し訳ございません！優先対応に変更しました。スタッフがすぐにご返信いたします。'
      };
      try {
        await channeltalk.sendMessage(cid, { blocks: [{ type: 'text', value: followup60Msgs[esc.lang] || followup60Msgs['zh-TW'] }] });
        console.log('[FOLLOWUP] 60min priority notice sent to:', cid);
      } catch(e) { console.log('[FOLLOWUP] 60min error:', e.message); }
      esc.followup60 = true;
      // 매니저 그룹에 긴급 알림
      try {
        var urgentMsg = '🚨 긴급: 고객 60분 대기 중! chatId: ' + cid + ' - 즉시 응대 필요';
        var channeltalk2 = require('../lib/channeltalk');
        await channeltalk2.sendGroupMessage(urgentMsg);
      } catch(ue) { console.log('[FOLLOWUP] urgent alert error:', ue.message); }
    }

    // 15min auto-reassign
    if (now - (esc.time || esc.timestamp || 0) >= REASSIGN_TIMEOUT) {
      try {
        var msgData = await channeltalk.getChatMessages(cid, 5);
        var msgs = msgData.messages || [];
        var mgrReplied = msgs.some(function(m) {
          return m.personType === "manager" && m.createdAt && m.createdAt > esc.time;
        });
        if (mgrReplied) {
          delete pendingEscalations[cid];
          continue;
        }
        var reassignMsg = { "zh-TW": "感謝您的耐心等待！客服人員目前較忙碌，我們已通知其他客服人員，請再稍候一下", "ko": "기다려주셔서 감사합니다! 다른 상담사에게 알림을 보냈습니다. 조금만 더 기다려주세요", "en": "Thanks for your patience! We have notified additional agents. Please hold on", "ja": "お待たせして申し訳ございません！他のスタッフに通知しました" };
        var lang = esc.lang || "zh-TW";
        await channeltalk.sendMessage(cid, { blocks: [{ type: "text", value: reassignMsg[lang] || reassignMsg["zh-TW"] }] });
        // [SOP v2] 재배정 알림도 팀(MIA·우선·강준)에게만
        var allMgrIds = await managersLib.getTeamManagerIds();
        if (allMgrIds.length > 0) {
          await channeltalk.addFollowers(cid, allMgrIds).catch(function() {});
        }
        console.log("[AutoReassign] Chat " + cid + " reassigned after 15min. Notified " + allMgrIds.length + " managers.");
        delete pendingEscalations[cid];
      } catch(e) {
        console.error("[AutoReassign] Error for " + cid + ":", e.message);
        delete pendingEscalations[cid];
      }
    }
  }
}, 3 * 60 * 1000);

module.exports = router;
