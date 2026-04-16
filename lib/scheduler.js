var fs = require('fs');
var cron = require('node-cron');
var channeltalk = require('./channeltalk');
var analytics = require('./analytics');
var faqUpdater = require('./faq-updater');
var shippingTracker = require('./shipping-tracker');

var ALERT_HOURS = 24;

var CSAT_FILE = require('path').join(__dirname, '..', 'data', 'csat-sent.json');
var CSAT_RESULTS_FILE = require('path').join(__dirname, '..', 'data', 'csat-results.json');

function loadCSATSent() {
  try {
    if (require('fs').existsSync(CSAT_FILE)) {
      return JSON.parse(require('fs').readFileSync(CSAT_FILE, 'utf8'));
    }
  } catch(e) {}
  return {};
}

function saveCSATSent(data) {
  try {
    var dir = require('path').dirname(CSAT_FILE);
    if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true });
    require('fs').writeFileSync(CSAT_FILE, JSON.stringify(data), 'utf8');
  } catch(e) { console.error("[Scheduler] Save CSAT error:", e.message); }
}

function saveCSATResult(result) {
  try {
    var dir = require('path').dirname(CSAT_RESULTS_FILE);
    if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true });
    var results = [];
    if (require('fs').existsSync(CSAT_RESULTS_FILE)) {
      results = JSON.parse(require('fs').readFileSync(CSAT_RESULTS_FILE, 'utf8'));
    }
    results.push(result);
    require('fs').writeFileSync(CSAT_RESULTS_FILE, JSON.stringify(results, null, 2), 'utf8');
  } catch(e) { console.error("[Scheduler] Save CSAT result error:", e.message); }
}



async function checkUnresolvedChats() {
  try {
    var res = await channeltalk.listUserChats('opened', 100);
    var chats = (res.userChats || []);
    var now = Date.now();
    var csatList = [];
    var closeList = [];
    var unresolvedList = [];

    for (var i = 0; i < chats.length; i++) {
      var chat = chats[i];
      var lastMsgAt = chat.openedAt || chat.createdAt;
      var hoursPassed = (now - lastMsgAt) / (1000 * 60 * 60);

      // Skip LINE chats from auto-close (conversation history lost)
      var isLine = chat.source && chat.source.medium && chat.source.medium.mediumType === "app";
      if (hoursPassed >= 48 && !isLine) {
        closeList.push({ id: chat.id, hours: Math.floor(hoursPassed), userId: chat.userId });
      } else if (hoursPassed >= 24) {
        csatList.push({ id: chat.id, hours: Math.floor(hoursPassed), userId: chat.userId });
      }

      if (hoursPassed >= ALERT_HOURS) {
        unresolvedList.push({ id: chat.id, hours: Math.floor(hoursPassed), userId: chat.userId });
      }
    }

    // Step 1: Send CSAT survey to 24h+ chats (before closing)
    for (var c = 0; c < csatList.length; c++) {
      try {
        var csatChatId = csatList[c].id;
        // Check if we already sent CSAT (avoid duplicates)
        var csatSentData = loadCSATSent();
        if (csatSentData[csatChatId]) continue;

        // Load language for this chat
        var chatLangs = {};
        try { chatLangs = JSON.parse(fs.readFileSync(require("path").join(__dirname, "..", "data", "chat-languages.json"), "utf8")); } catch(le) {}
        var csatLang = chatLangs[csatChatId] || "zh-TW";
        var csatMsgs = {
          "zh-TW": "📋 想聽聽您的寶貴意見！\n\n這次的服務體驗如何呢？\n\n1️⃣ 非常滿意\n2️⃣ 滿意\n3️⃣ 普通\n4️⃣ 不滿意\n5️⃣ 非常不滿意\n\n請輸入數字 1~5",
          "ko": "📋 고객님의 소중한 의견을 듣고 싶습니다!\n\n이번 상담은 어떠셨나요?\n\n1️⃣ 매우 만족\n2️⃣ 만족\n3️⃣ 보통\n4️⃣ 불만족\n5️⃣ 매우 불만족\n\n숫자를 입력해주세요 1~5",
          "en": "📋 We'd love your feedback!\n\nHow was your experience?\n\n1️⃣ Excellent\n2️⃣ Good\n3️⃣ Average\n4️⃣ Poor\n5️⃣ Very Poor\n\nPlease enter 1~5",
          "ja": "📋 ご意見をお聞かせください！\n\n今回の対応はいかがでしたか？\n\n1️⃣ 大満足\n2️⃣ 満足\n3️⃣ 普通\n4️⃣ 不満\n5️⃣ 大不満\n\n数字を入力してください 1~5"
        };
        var csatMsg = csatMsgs[csatLang] || csatMsgs["zh-TW"];

        await channeltalk.sendMessage(csatChatId, { blocks: [{ type: "text", value: csatMsg }] });
        csatSentData[csatChatId] = Date.now(); saveCSATSent(csatSentData);
        console.log("[Scheduler] CSAT survey sent to chat:", csatChatId);
      } catch (csatErr) {
        console.error("[Scheduler] CSAT send error:", csatErr.message);
      }
    }

    // Step 2: Auto-close 48h+ chats
    var closedCount = 0;
    for (var d = 0; d < closeList.length; d++) {
      try {
        var closeChatId = closeList[d].id;

        // Send closing message
        var closeMsg = "이 상담은 48시간 동안 추가 메시지가 없어 자동 종료됩니다. 추가 문의가 있으시면 언제든 새 채팅을 시작해주세요! 😊\n\n" +
          "此對話因超過48小時無新訊息，將自動結束。如有其他問題，歡迎隨時開啟新對話！😊";

        await channeltalk.sendMessage(closeChatId, { blocks: [{ type: "text", value: closeMsg }] });
        await channeltalk.closeChat(closeChatId);
        closedCount++;

        // Clean up CSAT tracking
        var csatData2 = loadCSATSent(); delete csatData2[closeChatId]; saveCSATSent(csatData2);
      } catch (closeErr) {
        console.error("[Scheduler] Auto-close error for", closeList[d].id, ":", closeErr.message);
      }
    }

    if (closedCount > 0) {
      console.log("[Scheduler] Auto-closed", closedCount, "chats (48h+ inactive)");
    }

    // Step 3: Alert for remaining unresolved
    if (unresolvedList.length > 0) {
      console.log("[Scheduler] Unresolved check done:", unresolvedList.length, "overdue chats (" + csatList.length + " CSAT sent,", closedCount, "closed)");
    }
  } catch (err) {
    console.error("[Scheduler] Unresolved check error:", err.message);
  }
}

async function sendWeeklyReport() {
  try {
    var result = await analytics.analyzeRecentChats(7);
    var reportKo = analytics.generateReport(result);
    var reportTw = analytics.generateReportTW(result);
    console.log('[Scheduler] Weekly Report Generated');
    console.log(reportKo);

    var groups = await channeltalk.listGroups(10);
    if (groups.groups && groups.groups.length > 0) {
      var groupId = groups.groups[0].id;
      await channeltalk.sendGroupMessage(groupId, {
        blocks: [{ type: 'text', value: reportKo }]
      });
      console.log('[Scheduler] Weekly report sent to group: ' + groupId);
    }
  } catch (err) {
    console.error('[Scheduler] Weekly report error:', err.message);
  }
}

function startScheduler() {
  cron.schedule('0 9 * * 1', function() {
    console.log('[Scheduler] Running weekly report (Monday 9AM)...');
    sendWeeklyReport();
  }, { timezone: 'Asia/Seoul' });

  cron.schedule('0 */4 * * *', function() {
    console.log('[Scheduler] Checking unresolved chats...');
    checkUnresolvedChats();
  }, { timezone: 'Asia/Seoul' });



  // Shipping status tracker: every 2 hours
  cron.schedule('0 */2 * * *', function() {
    console.log('[Scheduler] Checking shipping updates...');
    shippingTracker.checkShippingUpdates().then(function(result) {
      if (result.stateChanges > 0) {
        console.log('[Scheduler] Shipping updates:', result.stateChanges, 'changes,', result.notificationsSent, 'notified');
      }
    }).catch(function(e) {
      console.error('[Scheduler] Shipping tracker error:', e.message);
    });
  }, { timezone: 'Asia/Seoul' });

  // FAQ auto-update + review learning: every day 3AM KST
  cron.schedule('0 3 * * *', function() {
    console.log('[Scheduler] Running FAQ auto-update...');
    faqUpdater.runFAQUpdate().then(function(result) {
      console.log('[Scheduler] FAQ update result:', JSON.stringify(result));
    }).catch(function(e) {
      console.error('[Scheduler] FAQ update error:', e.message);
    });
  }, { timezone: 'Asia/Seoul' });

  
  // Repurchase campaign: daily 10AM KST
  cron.schedule('0 10 * * *', function() {
    console.log('[Scheduler] Running repurchase campaign check...');
    shippingTracker.checkRepurchaseCampaign().then(function(count) {
      console.log('[Scheduler] Repurchase campaigns sent:', count);
    }).catch(function(e) {
      console.error('[Scheduler] Repurchase error:', e.message);
    });
  }, { timezone: 'Asia/Seoul' });

  console.log('[Scheduler] Started - Weekly report: Mon 9AM KST, Unresolved check: every 4h, FAQ update + review learning: daily 3AM KST, Shipping tracker: every 2h, Repurchase: daily 10AM KST');
}


// CSAT response categories
var CSAT_SCORES = { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "1️⃣": 1, "2️⃣": 2, "3️⃣": 3, "4️⃣": 4, "5️⃣": 5 };

function parseCSATResponse(text) {
  text = (text || "").trim();
  if (CSAT_SCORES[text] !== undefined) return CSAT_SCORES[text];
  if (text.match(/^[1-5]$/)) return CSAT_SCORES[text];
  if (text.indexOf("非常不滿") > -1 || text.indexOf("매우 불만") > -1) return 5;
  if (text.indexOf("不滿") > -1 || text.indexOf("불만") > -1) return 4;
  if (text.indexOf("非常滿意") > -1 || text.indexOf("매우 만족") > -1) return 1;
  if (text.indexOf("滿意") > -1 || text.indexOf("만족") > -1) return 2;
  return null;
}

function isCSATPending(chatId) {
  var sent = loadCSATSent();
  return sent[chatId] ? true : false;
}


// Pending escalation tracking for off-hours
var PENDING_ESC_FILE = require("path").join(__dirname, "..", "data", "pending-escalations.json");
function loadPendingEscalations() { try { return JSON.parse(fs.readFileSync(PENDING_ESC_FILE, "utf8")); } catch(e) { return []; } }
function savePendingEscalation(chatId, userId, message) {
  var list = loadPendingEscalations();
  list.push({ chatId: chatId, userId: userId, message: message, timestamp: Date.now() });
  fs.writeFileSync(PENDING_ESC_FILE, JSON.stringify(list), "utf8");
}
function checkPendingEscalations() {
  var list = loadPendingEscalations();
  if (list.length > 0) {
    console.log("[Scheduler] Pending off-hours escalations:", list.length);
    fs.writeFileSync(PENDING_ESC_FILE, "[]", "utf8");
  }
  return list;
}

module.exports = { startScheduler: startScheduler, checkUnresolvedChats: checkUnresolvedChats, sendWeeklyReport: sendWeeklyReport, parseCSATResponse: parseCSATResponse, isCSATPending: isCSATPending, saveCSATResult: saveCSATResult };
