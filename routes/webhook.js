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
  // Check if same user had a resolved conversation in last 72h
  var recentResolved = fcr.resolved.filter(function(r) {
    return r.userId === userId && r.timestamp > cutoff72h;
  });
  if (recentResolved.length > 0) {
    // This is a repeat inquiry within 72h → FCR failure
    fcr.reopened.push({
      timestamp: now,
      userId: userId,
      chatId: chatId,
      issueType: issueType || 'unknown',
      previousChatId: recentResolved[recentResolved.length - 1].chatId
    });
    console.log('[FCR] Repeat inquiry detected - userId:', userId, 'within 72h of chatId:', recentResolved[recentResolved.length - 1].chatId);
  }
  saveFCRData(fcr);
}
function recordFCRResolved(userId, chatId, issueType) {
  if (!userId) return;
  var fcr = loadFCRData();
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

var cesDataPath = path.join(__dirname, '..', 'data', 'ces-results.json');
function loadCESData() {
  try { return JSON.parse(fs.readFileSync(cesDataPath, 'utf8')); } catch(e) { return []; }
}
function saveCESData(data) {
  if (data.length > 1000) data = data.slice(-1000);
  fs.writeFileSync(cesDataPath, JSON.stringify(data, null, 2));
}
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
var analytics = require('../lib/analytics');

var processedMessages = {};
// Dedup cleanup handled below (120s TTL)
var satisfactionPending = {};
var chatLanguage = {};
var managerActive = {};
var pendingEscalations = {};
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
    var mgrs = await getCachedManagers();
    var managers = (mgrs && mgrs.managers) || [];
    for (var i = 0; i < managers.length; i++) {
      if (managers[i].operator) {
        await channeltalk.inviteManager(chatId, managers[i].id);
        
      // shortReplyWarning: 매니저 답변이 너무 짧으면 로그
      // QA check removed - plainText not in scope
      // [removed] replyLen check
        // [removed] QA plainText check
      }
managerActive[chatId] = Date.now();
        // MANAGER_DIRECT_ALERT: 매니저에게 직접 알림
        console.log('[ESCALATION] Manager invited:', managers[i].id, 'for chat:', chatId);
        pendingEscalations[chatId] = { time: Date.now(), managerId: managers[i].id, lang: lang || "zh-TW" };
        break;
      }
    }
  } catch(e) { console.error("[ConnectManager] Error:", e.message); }
}

function isMergeShippingRequest(text) {
  var mergeKeywords = ["合併寄送", "合併運送", "合併出貨", "合併配送", "一起寄", "一起送", "一起出貨", "併單", "합배송", "합배", "merge ship", "combine order", "合併寄"];
  var lower = (text || "").toLowerCase();
  for (var i = 0; i < mergeKeywords.length; i++) {
    if (lower.indexOf(mergeKeywords[i].toLowerCase()) > -1) return true;
  }
  return false;
}


function isActionRequest(text) {
  var patterns = [
    { type: "cancel_reason", keywords: ["為什麼被取消", "為何被取消", "取消的原因", "取消原因", "為什麼取消", "왜 취소", "취소 이유", "why cancel"] },
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
  if (lower.length > 20) return false; // Long messages are not simple thanks
  var thanks = ['謝謝', '感謝', '谢谢', '感谢', '太好了', '好的謝謝', '好的感謝', '知道了感謝', '非常感謝', '太感謝了', 'thanks', 'thank you', 'thx', 'ありがとう', '감사합니다', '감사', '고마워'];
  for (var i = 0; i < thanks.length; i++) {
    if (lower === thanks[i] || lower === thanks[i] + '!' || lower === thanks[i] + '~' || lower === thanks[i] + '！' || lower === thanks[i] + '～') return true;
  }
  // Regex removed - exact match only to prevent false positives
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

    if (type === 'userchat' && event === 'update') {
      var closedChat = entity;
      if (closedChat && closedChat.state === 'closed') {
        var chatId0 = closedChat.id;
        var surveyLang = chatLanguage[chatId0] || 'zh-TW';
        var surveyMsg;
        var stats_managerId = null;
        try { var _ms = require("../lib/manager-stats"); var _st = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "data", "manager-stats.json"), "utf8")); if (_st.chats && _st.chats[chatId0]) stats_managerId = _st.chats[chatId0].managerId; } catch(e) {}
        if (managerActive[chatId0]) {
          var csSurveys = {
            'zh-TW': '💬 感謝您的諮詢！\n\n請幫我們評個分吧：\n1 = 😍 非常滿意\n2 = 😊 滿意\n3 = 😐 普通\n4 = 😕 不太滿意\n5 = 😞 很不滿意\n\n直接輸入數字 1~5 就好囉！',
            'ko': '💬 상담이 종료되었습니다. 평가 부탁드려요！\n\n1 = 😍 매우 만족\n2 = 😊 만족\n3 = 😐 보통\n4 = 😕 불만족\n5 = 😞 매우 불만족\n\n숫자를 입력해주세요 1~5',
            'en': '💬 Please rate your experience:\n\n1 = 😍 Excellent\n2 = 😊 Good\n3 = 😐 Average\n4 = 😕 Poor\n5 = 😞 Very Poor\n\nPlease enter 1~5',
            'ja': '💬 今回の対応を評価してください：\n\n1 = 😍 大満足\n2 = 😊 満足\n3 = 😐 普通\n4 = 😕 不満\n5 = 😞 大不満\n\n数字を入力してください 1~5'
          };
          surveyMsg = csSurveys[surveyLang] || csSurveys['zh-TW'];
        } else {
          var botSurveys = {
            'zh-TW': '💬 這次的自動回覆有幫助到您嗎？\n\n👍 有幫助 → 輸入「感謝」\n👎 沒幫助 → 輸入「不好」',
            'ko': '💬 자동 응답이 도움이 되셨나요?\n\n👍 도움이 됨 → 「감사」\n👎 도움 안 됨 → 「별로」',
            'en': '💬 Was the auto-reply helpful?\n\n👍 Helpful → "thanks"\n👎 Not helpful → "bad"',
            'ja': '💬 自動返信はお役に立ちましたか？\n\n👍 役立った → 「感謝」\n👎 役立たなかった → 「不満」'
          };
          surveyMsg = botSurveys[surveyLang] || botSurveys['zh-TW'];
        }
        satisfactionPending[chatId0] = Date.now();
        // Mark in file to prevent scheduler duplicate
        try { var csFile = require('path').join(__dirname, '..', 'data', 'csat-sent.json'); var csData = {}; try { csData = JSON.parse(require('fs').readFileSync(csFile, 'utf8')); } catch(ce) {} csData[chatId0] = Date.now(); require('fs').writeFileSync(csFile, JSON.stringify(csData), 'utf8'); } catch(ce2) {}
        setTimeout(async function() {
          try {
            await channeltalk.sendMessage(chatId0, { blocks: [{ type: 'text', value: surveyMsg }] });
          } catch(e) {}
        }, 3000);

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
        if (mgrText && mgrText.length > 10 && aiEngine.isReady()) {
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

    // Track FCR for returning users
    trackFCR(memberId || personId || "", chatId, "");
    if (!userText || !chatId) return res.status(200).send('OK');
    mgrStats.recordUserMessage(chatId);
    if (isSystemEvent(userText)) return res.status(200).send('OK');

    if (managerActive[chatId]) {
      return res.status(200).send('OK');
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
      var langMap = {"ko": "ko", "ja": "ja", "en": "en", "zh": "zh-TW", "zh-TW": "zh-TW", "zh-CN": "zh-TW"};
      if (langMap[userLang]) detectedLang = langMap[userLang];
    }
    chatLanguage[chatId] = detectedLang;
    var chatSource = "web";
    try { var srcData = JSON.parse(req.body.entity || "{}"); if (srcData.source && srcData.source.medium && srcData.source.medium.mediumType === "app") chatSource = "LINE"; } catch(se) {}
    try { var lf = require("path").join(__dirname, "..", "data", "chat-languages.json"); var ld = {}; try { ld = JSON.parse(fs.readFileSync(lf, "utf8")); } catch(e) {} ld[chatId] = detectedLang; fs.writeFileSync(lf, JSON.stringify(ld), "utf8"); } catch(e) {}


    // CSAT dissatisfaction reason handler
    if (pendingCSATReason[chatId]) {
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
        console.log('[CSAT-REASON] Feedback saved for chat:', chatId, '| Score:', pendingCSATReason[chatId] ? pendingCSATReason[chatId].csatScore : '?', '| Reason:', reasonText.substring(0, 50));
        aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || '', userName: '', lang: detectedLang, type: 'csat_feedback', userMessage: reasonText, aiResponse: 'CSAT feedback recorded', escalated: false, confidence: 1.0 });
        return res.status(200).send('OK');
      }
      if (Date.now() - pendingCSATReason[chatId].timestamp > 600000) {
        delete pendingCSATReason[chatId];
      }
    }
    // CES response handler
    if (pendingCES[chatId]) {
      var cesText = (userText || '').trim();
      var cesNum = parseInt(cesText);
      if (cesNum >= 1 && cesNum <= 5) {
        var cesData = loadCESData();
        cesData.push({
          timestamp: new Date().toISOString(),
          chatId: chatId,
          userId: pendingCES[chatId].userId,
          score: cesNum,
          managerId: pendingCES[chatId].managerId || ''
        });
        saveCESData(cesData);
        delete pendingCES[chatId];
        var cesThanks = {
          "zh-TW": "感謝您的回饋！祝您購物愉快 😊",
          "ko": "소중한 의견 감사합니다! 즐거운 쇼핑 되세요 😊",
          "en": "Thank you for your feedback! Happy shopping 😊",
          "ja": "フィードバックありがとうございます！お買い物をお楽しみください 😊"
        };
        await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: cesThanks[detectedLang] || cesThanks["zh-TW"] }] });
        console.log("[CES] Score recorded:", cesNum, "for chat:", chatId);
        aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || '', userName: '', lang: detectedLang, type: 'ces_response', userMessage: cesText, aiResponse: 'CES score: ' + cesNum, escalated: false, confidence: 1.0 });
        return res.status(200).send('OK');
      }
      // 10분 지나면 만료
      if (Date.now() - pendingCES[chatId].timestamp > 600000) {
        delete pendingCES[chatId];
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
    if (scheduler.isCSATPending(chatId)) {
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
        try { var csatFile = require("path").join(__dirname, "..", "data", "csat-sent.json"); var csatData = JSON.parse(require("fs").readFileSync(csatFile, "utf8")); csatData[chatId] = { responded: true, respondedAt: Date.now() }; require("fs").writeFileSync(csatFile, JSON.stringify(csatData), "utf8"); } catch(ce) {}

        // CSAT 점수별 분기: 만족(1-2)→CES(간단), 보통(3)→CES, 불만족(4-5)→사유질문
        if (csatScore <= 2) {
          // 만족 → CES 질문으로 편의성 측정 (데이터 수집 확대)
          pendingCES[chatId] = { timestamp: Date.now(), chatId: chatId, userId: memberId || personId || '', managerId: '', csatScore: csatScore };
          var cesQSatisfied = {
            'zh-TW': '感謝您的好評！最後想請問，今天解決問題的過程容易嗎？\n1=非常困難 ~ 5=非常容易',
            'ko': '좋은 평가 감사합니다! 마지막으로, 문제 해결 과정이 쉬웠나요?\n1=매우 어려움 ~ 5=매우 쉬움',
            'en': 'Thanks for the great feedback! Lastly, how easy was it to resolve your issue?\n1=Very difficult ~ 5=Very easy',
            'ja': '高評価ありがとうございます！最後に、問題解決は簡単でしたか？\n1=非常に難しい ~ 5=非常に簡単'
          };
          try {
            await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: cesQSatisfied[detectedLang] || cesQSatisfied['zh-TW'] }] });
            console.log('[CES] Satisfied CES question sent to chat:', chatId);
          } catch(cesErr) { console.log('[CES] Satisfied send error:', cesErr.message); }
        } else if (csatScore === 3) {
          // 보통 → CES 질문
          pendingCES[chatId] = { timestamp: Date.now(), chatId: chatId, userId: memberId || personId || '', managerId: '', csatScore: csatScore };
          var cesQ = {
            'zh-TW': '最後一個問題！今天解決問題容易嗎？\n1=非常困難 2=困難 3=普通 4=容易 5=非常容易',
            'ko': '마지막 질문! 오늘 문제 해결이 쉬웠나요?\n1=매우 어려움 2=어려움 3=보통 4=쉬움 5=매우 쉬움',
            'en': 'One last question! How easy was it to resolve your issue?\n1=Very difficult 2=Difficult 3=Neutral 4=Easy 5=Very easy',
            'ja': '最後の質問です！今日の問題解決は簡単でしたか？\n1=非常に難しい 2=難しい 3=普通 4=簡単 5=非常に簡単'
          };
          try {
            await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: cesQ[detectedLang] || cesQ['zh-TW'] }] });
            console.log('[CES] Question sent to chat:', chatId);
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
      var thankReply = {
        'zh-TW': '不客氣！還有其他問題歡迎隨時詢問 😊\n\n' + getMenuText('zh-TW'),
        'ko': '천만에요! 다른 질문 있으시면 언제든 물어보세요 😊\n\n' + getMenuText('ko'),
        'en': "You're welcome! Feel free to ask anything else 😊\n\n" + getMenuText('en'),
        'ja': 'どういたしまして！他にご質問があればお気軽にどうぞ 😊\n\n' + getMenuText('ja')
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: thankReply[detectedLang] || thankReply['zh-TW'] }] });
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "thank_you", userMessage: userText, aiResponse: "감사 응답", escalated: false, confidence: 1.0 });
      // thank_you 후 3초 뒤 간단 CSAT 발송 (중복 방지)
      if (!satisfactionPending[chatId]) {
        var csatSentFile = require('path').join(__dirname, '..', 'data', 'csat-sent.json');
        var csatSentCheck = {};
        try { csatSentCheck = JSON.parse(require('fs').readFileSync(csatSentFile, 'utf8')); } catch(cse) {}
        if (!csatSentCheck[chatId]) {
          satisfactionPending[chatId] = Date.now();
          try { csatSentCheck[chatId] = { sentAt: Date.now(), source: 'thank_you' }; require('fs').writeFileSync(csatSentFile, JSON.stringify(csatSentCheck), 'utf8'); } catch(cse2) {}
          setTimeout(async function() {
            try {
              var tyCSAT = {
                'zh-TW': '😊 很高興能幫到您！方便花5秒幫我們評個分嗎？\n\n1 = 😍 非常滿意\n2 = 😊 滿意\n3 = 😐 普通\n4 = 😕 不太滿意\n5 = 😞 很不滿意\n\n輸入數字就好！',
                'ko': '😊 도움이 되셨다니 기뻐요! 5초만 평가해주실 수 있나요?\n\n1 = 😍 매우 만족\n2 = 😊 만족\n3 = 😐 보통\n4 = 😕 불만족\n5 = 😞 매우 불만족\n\n숫자만 입력해주세요!',
                'en': '😊 Glad I could help! Could you take 5 seconds to rate us?\n\n1 = 😍 Excellent  2 = 😊 Good  3 = 😐 Average  4 = 😕 Poor  5 = 😞 Very Poor',
                'ja': '😊 お役に立てて嬉しいです！5秒で評価していただけますか？\n\n1 = 😍 大満足  2 = 😊 満足  3 = 😐 普通  4 = 😕 不満  5 = 😞 大不満'
              };
              await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: tyCSAT[detectedLang] || tyCSAT['zh-TW'] }] });
              console.log('[CSAT] Thank-you CSAT sent to:', chatId);
            } catch(tyCsatErr) { console.log('[CSAT] Thank-you send error:', tyCsatErr.message); }
          }, 3000);
        }
      }
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
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "greeting", userMessage: userText, aiResponse: "인사 응답 + 메뉴 제공" + (veaslyUser && veaslyUser.credit >= 500 ? " (포인트:" + veaslyUser.credit + ")" : ""), escalated: false, confidence: 1.0 });
      return res.status(200).send('OK');
    }

    // Number menu (0 removed from here - escalation handled separately)
    var trimmed = userText.trim();
    if (NUMBER_TO_QUERY[trimmed]) {
      userText = NUMBER_TO_QUERY[trimmed];
    }

    // Escalation request - multi-step process
    // Negative sentiment auto-escalation
    var negativeKeywords = ['不滿', '不好', '生氣', '太差', '太慢', '騙', '詐騙', '投訴', '消保', '客訴', '退款', '退錢', '報警', '律師', '法律', '消費者保護', '不合理', '離譜', '誇張', '差勁', '爛', '沒用', '廢物', '垃圾', '화나', '열받', '짜증', '사기', '소보원', '환불', '신고', 'scam', 'fraud', 'refund', 'lawsuit', 'complaint', 'unacceptable', 'ridiculous', 'terrible', 'worst'];
    var isNegative = false;
    for (var ni = 0; ni < negativeKeywords.length; ni++) {
      if (userText.indexOf(negativeKeywords[ni]) !== -1) { isNegative = true; break; }
    }
    if (isNegative && !managerActive[chatId]) {
      setEscalationStep(chatId, 1); // skip step 0 so next escalation request goes directly to step 2
      console.log('[Sentiment] Negative detected - auto escalating:', chatId);
      try {
        var negMgrs = await getCachedManagers();
        var negArr = (negMgrs && negMgrs.managers) || [];
        for (var nj = 0; nj < negArr.length; nj++) {
          if (negArr[nj].operator) { await channeltalk.inviteManager(chatId, negArr[nj].id); managerActive[chatId] = Date.now(); break; }
        }
        var allNegIds = negArr.map(function(m) { return m.id; });
        await channeltalk.addFollowers(chatId, allNegIds).catch(function() {});
      } catch(ne) {}
    }

    // Merge shipping request → immediate escalation
    if (isMergeShippingRequest(userText)) {
      setEscalationStep(chatId, 2);
      var mergeMsg = {
        "zh-TW": "合併寄送需要由客服人員為您處理喔！正在為您轉接客服 🙋‍♀️",
        "ko": "합배송은 상담사가 직접 처리해드릴게요! 연결 중입니다 🙋‍♀️",
        "en": "Combining shipments requires our support team! Connecting you now 🙋‍♀️",
        "ja": "合併配送はスタッフが対応いたします！接続中です 🙋‍♀️"
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: mergeMsg[detectedLang] || mergeMsg["zh-TW"] }] });
      await connectManager(chatId, detectedLang);
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "escalation", userMessage: userText.substring(0, 200), aiResponse: "합배송 요청 → 즉시 에스컬레이션", escalated: true, escalationReason: 'merge_shipping', confidence: 0 });
      return res.status(200).send("OK");
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
      var actionMsg = (actionMsgs[actionType] && actionMsgs[actionType][detectedLang]) || (actionMsgs[actionType] && actionMsgs[actionType]["zh-TW"]) || "正在為您轉接客服人員 🙋‍♀️";
      await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: actionMsg }] });
      await connectManager(chatId, detectedLang);
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "escalation", userMessage: userText.substring(0, 200), aiResponse: "행동요청(" + actionType + ") → 안내 후 에스컬레이션", escalated: true, escalationReason: 'action_request_' + actionType, confidence: 0 });
      return res.status(200).send("OK");
    }

    if (isEscalationRequest(userText) || trimmed === '0') {
      var step = getEscalationStep(chatId);

      if (step === 0) {
        // Step 1: Ask what they need help with
        var step1Msgs = {
          'zh-TW': !isBusinessHours() ? '💡 目前非客服時間（台灣 09:00~18:00），但我可以馬上幫您！\n\n請直接告訴我：\n1️⃣ 輸入「訂單號碼」→ 馬上查進度\n2️⃣ 輸入您的問題 → AI即時回答\n\n例如：\n・貼上訂單號碼（如 20260415TW...）\n・「我的包裹到哪了」\n・「運費怎麼算」\n\n⏰ 客服人員上班後會優先處理需要人工協助的問題！\n🔸 還是需要真人？請再輸入「客服」，我會記錄下來' : '💡 轉接前，試試看我能不能幫到您！\n\n請直接告訴我：\n1️⃣ 輸入「訂單號碼」→ 馬上查進度\n2️⃣ 輸入您的問題 → AI即時回答\n\n例如：\n・貼上訂單號碼（如 20260415TW...）\n・「我的包裹到哪了」\n・「運費怎麼算」\n\n🔸 還是需要真人？請再輸入「客服」',
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
          escMsgs = {
            'zh-TW': '👨‍💼 目前非客服時間（平日 10:00~19:00 韓國時間 = 台灣 09:00~18:00）\n\n📝 請留下您的問題，我們會在上班後優先回覆！\n・訂單問題請附上訂單號碼\n・其他問題請簡單描述\n\n我們一定會回覆您！😊',
            'ko': '👨‍💼 현재 상담 시간이 아닙니다 (평일 10:00~19:00 한국시간)\n\n📝 메시지를 남겨주시면 업무 시작 후 우선 답변드리겠습니다!',
            'en': '👨‍💼 Outside business hours (Weekdays 10:00~19:00 KST)\n\n📝 Leave your message and we\'ll reply first thing!',
            'ja': '👨‍💼 現在営業時間外です（平日 10:00~19:00 韓国時間）\n\n📝 メッセージを残してください。営業開始後すぐにご返信します！'
          };
        }
        await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: escMsgs[detectedLang] || escMsgs['zh-TW'] }] });
        try {
          var mgrs2 = await getCachedManagers();
          var managers2 = (mgrs2 && mgrs2.managers) || [];
          for (var j = 0; j < managers2.length; j++) {
            if (managers2[j].operator) {
              await channeltalk.inviteManager(chatId, managers2[j].id);
              managerActive[chatId] = Date.now();
              pendingEscalations[chatId] = { time: Date.now(), managerId: managers2[j].id, lang: detectedLang };
              break;
            }
          }
        } catch(e) {}
        aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || '', userName: veaslyUser ? veaslyUser.name : '', lang: detectedLang, type: 'escalation', userMessage: userText, aiResponse: '에스컬레이션 - 매니저 연결', escalated: true, escalationReason: 'keyword_request', confidence: 0 });
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
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", lang: detectedLang, type: "file_message", userMessage: userText, aiResponse: "파일/이미지 수신 안내", escalated: false, confidence: 0.5 });
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
      try {
        var multiReply = "";
        var successCount = 0;
        for (var oi = 0; oi < Math.min(orderMatches.length, 5); oi++) {
          var oNum = orderMatches[oi];
          try {
            var oItems = await veaslyApi.getOrderDetail(oNum);
            if (oItems && oItems.length > 0) {
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
        multiReply += "💡 " + (detectedLang === "ko" ? "더 궁금한 점이 있으면 입력해주세요!" : detectedLang === "en" ? "Any questions?" : detectedLang === "ja" ? "ご質問があればどうぞ！" : "還有問題嗎？直接輸入問題，或輸入「客服」轉接真人客服喔！");
        await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: multiReply }] });
        aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "order_lookup", userMessage: userText.substring(0, 200), aiResponse: "복수 주문조회: " + orderMatches.length + "건 (" + successCount + "건 성공)", escalated: false, confidence: 0.8 });
        return res.status(200).send("OK");
      } catch(multiErr) { console.error("[Order] Multi-order error:", multiErr.message); return res.status(200).send("OK"); }
    }
    if (orderMatches.length === 1) {
      var orderNum = orderMatches[0];
      console.log("[Order] Detected order number:", orderNum);
      try {
        var orderItems = await veaslyApi.getOrderDetail(orderNum);
        if (orderItems && orderItems.length > 0) {
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
          orderReply += "\n\n💡 " + (detectedLang === "ko" ? "더 궁금한 점이 있으면 입력해주세요! 「상담사」 입력 시 담당자를 연결해드려요." : detectedLang === "en" ? "Any questions? Type or enter 'agent' for live support!" : detectedLang === "ja" ? "ご質問があればどうぞ！「agent」と入力で担当者に接続します！" : "還有問題嗎？直接輸入問題，或輸入「客服」轉接真人客服喔！");
          await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: orderReply }] });
          if (!chatContext[chatId]) chatContext[chatId] = {};
          chatContext[chatId].lastOrder = orderReply;
          chatContext[chatId].lastOrderContext = buildOrderContext(orderItems, orderNum, detectedLang);
          chatContext[chatId].lastOrderTime = Date.now();
          console.log("[Order] Replied with", orderItems.length, "items for", orderNum);
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
          var hasMultiAccount = recentOrders.some(function(o) { return o._isCurrentAccount === false; }); if (hasMultiAccount) { listReply += "\n\n" + (detectedLang === "ko" ? "⚠ = 다른 로그인 방식으로 주문한 건입니다" : detectedLang === "en" ? "⚠ = ordered from a different login method" : detectedLang === "ja" ? "⚠ = 別のログイン方法での注文です" : "⚠ = 透過其他登入方式下的訂單"); } listReply += "\n\n" + (detectedLang === "ko" ? "주문번호를 입력하시면 상세 상태를 확인할 수 있어요!" : detectedLang === "en" ? "Enter an order number for details!" : detectedLang === "ja" ? "注文番号を入力すると詳細が確認できます！" : "輸入完整訂單編號可查看詳細狀態喔！");
          await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: listReply }] });
          console.log("[Order] Listed", recentOrders.length, "orders for", veaslyUser.email);
          
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "order_list", userMessage: userText, aiResponse: "주문 목록 " + recentOrders.length + "건 조회", escalated: false, confidence: 0.8 });
      return res.status(200).send("OK");
        }
      } catch(olErr) { console.error("[Order] List error:", olErr.message); }
    }

    // AI-first, then FAQ fallback
    var aiAnswer = null;
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
        if (chatContext[chatId] && chatContext[chatId].lastOrder && (Date.now() - chatContext[chatId].lastOrderTime) < 30 * 60 * 1000) {
          chatHistory.unshift({ role: "bot", text: "[最近查詢的訂單資訊] " + chatContext[chatId].lastOrder.substring(0, 500) });
        }
        var aiResult = await aiEngine.generateAnswer(memberContext ? memberContext + " " + userText : userText, detectedLang, chatId, chatHistory);
        if (aiResult && typeof aiResult === "object") {
          aiAnswer = aiResult.answer;
          var confidence = aiResult.confidence || 0;
          console.log("[AI] Confidence:", confidence.toFixed(3));
          if (confidence < 0.3) {
            console.log("[AI] Very low confidence (" + confidence.toFixed(3) + ") - " + (isBusinessHours() ? "auto-escalate" : "off-hour AI guide only"));
            
            if (!isBusinessHours()) {
              // ★ 오프시간: 매니저 초대 없이 AI가 적극 안내
              try {
                var offHourLowMsgs = {
                  "zh-TW": "感謝您的提問！🙏\n\n💡 目前非客服時間，但我可以馬上幫您：\n・請輸入「訂單號碼」→ 馬上查詢進度\n・描述您的問題 → AI為您解答\n\n例如：\n・貼上訂單號碼（如 20260415TW...）\n・「我的包裹到哪了」\n・「運費怎麼算」\n\n⏰ 客服時間：週一至週五 台灣09:00~18:00\n客服人員上班後會優先為您處理！😊",
                  "ko": "질문 감사합니다! 🙏\n\n💡 현재 상담 시간 외이지만 제가 먼저 도와드릴게요:\n・주문번호 입력 → 바로 조회\n・궁금한 점을 말씀해주세요\n\n⏰ 상담시간: 평일 10:00~19:00 (한국시간)\n업무 시작 후 우선 답변드리겠습니다!",
                  "en": "Thanks for your question! 🙏\n\n💡 We're currently outside business hours, but I can help right away:\n・Enter your order number for instant tracking\n・Describe your issue and I'll assist\n\n⏰ Business hours: Mon-Fri 10:00-19:00 KST\nOur team will prioritize your inquiry!",
                  "ja": "ご質問ありがとうございます！🙏\n\n💡 現在営業時間外ですが、まずお手伝いします：\n・注文番号を入力 → すぐに確認\n・お問い合わせ内容をご記入ください\n\n⏰ 営業時間：月〜金 10:00〜19:00 KST\n営業開始後、優先的に対応いたします！"
                };
                await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: offHourLowMsgs[detectedLang] || offHourLowMsgs["zh-TW"] }] });
                aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", lang: detectedLang, type: "ai_answer", userMessage: userText.substring(0, 200), aiResponse: "오프시간 low-confidence → AI 안내 (에스컬레이션 안 함)", escalated: false, escalationReason: "off_hour_low_confidence", confidence: confidence });
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
                var mgrList0 = await getCachedManagers();
                var mgrs0 = (mgrList0 && mgrList0.managers) || [];
                for (var m0 = 0; m0 < mgrs0.length; m0++) {
                  if (mgrs0[m0].operator) { await channeltalk.inviteManager(chatId, mgrs0[m0].id); break; }
                }
                pendingEscalations[chatId] = { time: Date.now(), timestamp: Date.now(), lang: detectedLang };
                managerActive[chatId] = Date.now();
                console.log("[AI] Very low confidence auto-escalation for:", chatId);
                aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", lang: detectedLang, type: "escalation", userMessage: userText.substring(0, 200), aiResponse: "confidence " + confidence.toFixed(3) + " < 0.3 → 자동 에스컬레이션", escalated: true, escalationReason: "low_confidence", confidence: confidence });
              } catch(lcErr) { console.error("[AI] Low confidence escalation error:", lcErr.message); }
            }
          } else if (confidence < 0.6) {
            var hasOrderCtx = chatContext[chatId] && chatContext[chatId].lastOrderContext && (Date.now() - chatContext[chatId].lastOrderTime) < 60 * 60 * 1000;
            if (hasOrderCtx) {
              console.log("[AI] Medium confidence but order context exists - answer only, skip escalation");
              // 주문 맥락 존재 → 경고 문구 없이 AI 답변만 전송
            } else {
              console.log("[AI] Medium confidence (" + confidence.toFixed(3) + ") - answer + " + (isBusinessHours() ? "auto-escalate" : "off-hour AI only"));
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
                aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "ai_answer", userMessage: userText.substring(0, 200), aiResponse: aiAnswer.substring(0, 300), escalated: false, escalationReason: "off_hour_medium_confidence", confidence: confidence });
                return res.status(200).send("OK");
              }
              // 영업시간: 기존 로직 유지
              var medConfNote = {
                "zh-TW": "\n\n⚠️ 以上為AI初步回覆，客服人員會再為您確認，請稍候！",
                "ko": "\n\n⚠️ 위 답변은 AI 초기 응답입니다. 상담사가 확인 후 정확한 안내를 드리겠습니다!",
                "en": "\n\n⚠️ This is an AI preliminary answer. An agent will confirm shortly!",
                "ja": "\n\n⚠️ 上記はAIの初期回答です。担当者が確認後、正確にご案内いたします！"
              };
              aiAnswer += medConfNote[detectedLang] || medConfNote["zh-TW"];
            } // close else (no order context)
          }
        } else {
          aiAnswer = aiResult;
        }
      } catch(aiErr) {
        console.error("[AI] Error:", aiErr.message);
      }
    }
    if (aiAnswer) {
      var footers = {
        "zh-TW": "\n\n💡 還有其他問題嗎？直接輸入問題，AI會為您解答喔！",
        "ko": "\n\n💡 다른 질문이 있으신가요? 직접 질문을 입력하시면 AI가 답변해드려요!",
        "en": "\n\n💡 Need more help? Just type your question!",
        "ja": "\n\n💡 他にご質問がございましたら、そのままご入力ください！"
      };
      aiAnswer += footers[detectedLang] || footers["zh-TW"];
      // Prevent duplicate - only send if not already responded
      if (!res.headersSent) {
        await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: aiAnswer }] });
      }

      // Log AI conversation
      var aiEscalated = false;
      var escalateKeywords = ["轉接客服", "轉接", "客服確認", "客服人員", "為您確認", "幫您確認", "需要客服", "建議聯繫", "請聯繫客服", "無法為您", "담당자를 연결", "담당자에게", "상담사", "확인이 필요", "상담원", "connect you with", "support team", "contact support", "unable to help", "担当者におつなぎ", "担当者に", "お問い合わせ"];
      var needEscalate = false;
      var mediumConfidenceEsc = (confidence > 0 && confidence < 0.6);
      for (var ek = 0; ek < escalateKeywords.length; ek++) {
        if (aiAnswer.indexOf(escalateKeywords[ek]) !== -1) { needEscalate = true; break; }
      }
      aiEscalated = needEscalate || mediumConfidenceEsc;
      var hasOrderCtxForEsc = chatContext[chatId] && chatContext[chatId].lastOrderContext && (Date.now() - chatContext[chatId].lastOrderTime) < 60 * 60 * 1000;
      if (mediumConfidenceEsc && !needEscalate && !hasOrderCtxForEsc) {
        console.log("[AI] Medium confidence (" + (confidence || 0).toFixed(3) + ") - triggering escalation after AI answer (no order context)");
        try {
          var mgrListMed = await getCachedManagers();
          var mgrsMed = (mgrListMed && mgrListMed.managers) || [];
          for (var mm = 0; mm < mgrsMed.length; mm++) {
            if (mgrsMed[mm].operator) { await channeltalk.inviteManager(chatId, mgrsMed[mm].id); break; }
          }
          pendingEscalations[chatId] = { time: Date.now(), timestamp: Date.now(), lang: detectedLang };
          managerActive[chatId] = Date.now();
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

      if (needEscalate) {
        try {
          var mgrList = await getCachedManagers();
          var mgrArr = (mgrList && mgrList.managers) || [];
          for (var mi = 0; mi < mgrArr.length; mi++) {
            if (mgrArr[mi].operator) {
              await channeltalk.inviteManager(chatId, mgrArr[mi].id);
              managerActive[chatId] = Date.now();
              console.log("[Escalate] AI auto-escalated chat:", chatId);
              break;
            }
          }
          var allMgrIds = mgrArr.map(function(m){ return m.id; });
          await channeltalk.addFollowers(chatId, allMgrIds).catch(function(fe){ console.error("[Follower] Error:", fe.message); });
          console.log("[Follower] All managers added as followers:", allMgrIds.length);
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
      answerText += footers2[detectedLang] || footers2["zh-TW"];
      await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: answerText }] });
      if (matched.escalate) {
        try {
          var mgrs3 = await getCachedManagers();
          var managers3 = (mgrs3 && mgrs3.managers) || [];
          for (var k = 0; k < managers3.length; k++) {
            if (managers3[k].operator) {
              await channeltalk.inviteManager(chatId, managers3[k].id);
              managerActive[chatId] = Date.now();
              break;
            }
          }
        } catch(e) {}
      }
      
          aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "escalation", userMessage: userText, aiResponse: "매니저 에스컬레이션 (수동)", escalated: true, escalationReason: "ai_self_escalate", confidence: 0 });
          return res.status(200).send("OK");
    }
    // Fallback
    // Save unanswered question for learning
    if (userText && userText.length > 2 && aiEngine.isReady()) {
      aiEngine.addToKnowledgeBase(
        "unanswered_" + chatId + "_" + Date.now(),
        userText,
        { namespace: "unanswered", source: "user_fallback", chatId: chatId, language: detectedLang, timestamp: new Date().toISOString() }
      ).catch(function(e){ console.error("[Learn] unanswered save error:", e.message); });
      console.log("[Learn] Unanswered question saved:", userText.substring(0, 50));
    }
    var fallbackMsgs = {
      'zh-TW': '抱歉，我還在學習中 📚\n\n您可以試試以下方式：\n1️⃣ 用不同的關鍵字描述問題\n2️⃣ 輸入數字選擇分類查詢\n3️⃣ 輸入「客服」轉接真人\n\n',
      'ko': '죄송합니다, 아직 학습 중입니다 📚\n\n다음 방법을 시도해보세요:\n1️⃣ 다른 키워드로 질문\n2️⃣ 번호를 입력해서 조회\n3️⃣ 「상담사」를 입력해서 연결\n\n',
      'en': "Sorry, I'm still learning 📚\n\nTry:\n1️⃣ Rephrase your question\n2️⃣ Enter a number\n3️⃣ Type \"agent\" for live help\n\n",
      'ja': '申し訳ございません、まだ学習中です 📚\n\n以下をお試しください：\n1️⃣ 別のキーワードで質問\n2️⃣ 番号を入力\n3️⃣ 「オペレーター」と入力\n\n'
    };
    aiLog.saveConversation({
      timestamp: new Date().toISOString(),
      chatId: chatId,
      userId: memberId || '',
      lang: detectedLang,
      type: 'unanswered',
      userMessage: userText.substring(0, 200),
      aiResponse: 'AI 답변 실패 - fallback 메시지',
      escalated: false,
      category: analytics.classifyMessage(userText),
        confidence: 0,
    });
    var fbMenu = getMenuText(detectedLang);
    await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: (fallbackMsgs[detectedLang] || fallbackMsgs['zh-TW']) + fbMenu }] });

    res.status(200).send('OK');
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
        var mgrs = await getCachedManagers();
        var allMgrIds = ((mgrs && mgrs.managers) || []).filter(function(m) { return !m.bot; }).map(function(m) { return m.id; });
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
