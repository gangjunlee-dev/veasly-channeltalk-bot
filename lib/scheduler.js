var fs = require('fs');
var cron = require('node-cron');
var dailyReport = require('./daily-report');
var faqQueue = require('./faq-queue');
var channeltalk = require('./channeltalk');
var aiReview = require('./ai-review');
var analytics = require('./analytics');
var faqUpdater = require('./faq-updater');
var autoUpgrade = require('./auto-upgrade');
var shippingTracker = require('./shipping-tracker');

var csScoreTracker = require('../scripts/daily-cs-score-tracker');
var bizHours = require('./business-hours');
var ALERT_HOURS = 24;

var csatHelper = require('./csat');
// LEGACY: CSAT_FILE removed - use lib/csat.js
var CSAT_RESULTS_FILE = require('path').join(__dirname, '..', 'data', 'csat-results.json');



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




// AI Quality Review - check recently closed chats
var REVIEWED_FILE = require('path').join(__dirname, '..', 'data', 'reviewed-chats.json');
function loadReviewed() { try { return JSON.parse(fs.readFileSync(REVIEWED_FILE, 'utf8')); } catch(e) { return {}; } }
function saveReviewed(d) { try { fs.writeFileSync(REVIEWED_FILE, JSON.stringify(d), 'utf8'); } catch(e) {} }


// === 매일 CS Score 히스토리 자동 기록 ===
async function recordDailyCSScore() {
  try {
    var http = require('http');
    var data = await new Promise(function(resolve, reject) {
      http.get('http://localhost:3000/api/analytics/cs-score-metrics?days=7', function(res) {
        var body = '';
        res.on('data', function(d) { body += d; });
        res.on('end', function() {
          try { resolve(JSON.parse(body)); } catch(e) { reject(e); }
        });
      }).on('error', reject);
    });

    if (!data.success || !data.integratedScore) {
      console.log('[CSHistory] API 데이터 없음');
      return;
    }

    var score = data.integratedScore;
    var b = score.breakdown || {};
    var today = new Date().toISOString().split('T')[0];

    var historyPath = require('path').join(__dirname, '..', 'data', 'cs-score-history.json');
    var history = [];
    try { history = JSON.parse(fs.readFileSync(historyPath, 'utf8')); } catch(e) {}

    var entry = {
      date: today,
      timestamp: new Date().toISOString(),
      score: score.score,
      breakdown: {
        frt: b.frt ? b.frt.score : 0,
        fcr: b.fcr ? b.fcr.score : 0,
        csat: b.csat ? b.csat.score : 0,
        ces: b.ces ? b.ces.score : 0,
        noReply: b.noReply ? b.noReply.score : 0
      },
      rawMetrics: {
        fcrRate: data.fcr ? data.fcr.rate : null,
        csatAvg: data.csat ? data.csat.average : null,
        noReplyRate: data.noReply ? data.noReply.rate : null,
        totalChats: data.frt ? data.frt.totalChats : null
      }
    };

    var idx = history.findIndex(function(h) { return h.date === today; });
    if (idx >= 0) { history[idx] = entry; }
    else { history.push(entry); }

    // 90일 초과 데이터 삭제
    if (history.length > 90) history = history.slice(-90);

    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
    console.log('[CSHistory] ' + today + ' 기록 완료: ' + score.score);
  } catch(e) {
    console.log('[CSHistory] 에러:', e.message);
  }
}

async function checkClosedForReview() {
  try {
    console.log('[Scheduler] Checking closed chats for AI review...');
    var reviewed = loadReviewed();
    var res = await channeltalk.listUserChats('closed', 30);
    var chats = (res.userChats || []);
    var reviewCount = 0;
    var mgrStatsData = {};
    try { mgrStatsData = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'data', 'manager-stats.json'), 'utf8')); } catch(e) {}

    for (var i = 0; i < chats.length; i++) {
      var chat = chats[i];
      if (reviewed[chat.id]) continue;
      
      // Only review chats closed in last 24h
      var closedAge = Date.now() - (chat.closedAt || chat.updatedAt || 0);
      if (closedAge > 86400000) continue;

      // Find managerId
      var managerId = null;
      if (mgrStatsData.chats && mgrStatsData.chats[chat.id]) {
        managerId = mgrStatsData.chats[chat.id].managerId;
      }
      if (!managerId) {
        try {
          var msgData = await channeltalk.getChatMessages(chat.id, 50);
          var msgs = (msgData.messages || []);
          for (var mi = 0; mi < msgs.length; mi++) {
            if (msgs[mi].personType === 'manager' && msgs[mi].personId) {
              managerId = msgs[mi].personId;
              break;
            }
          }
        } catch(e) {}
      }
      if (!managerId) { reviewed[chat.id] = Date.now(); saveReviewed(reviewed); continue; }

      // Get messages and review
      try {
        var msgData2 = await channeltalk.getChatMessages(chat.id, 50);
        var msgs2 = (msgData2.messages || []);
        var formatted = msgs2.map(function(m) {
          return { role: m.personType === 'manager' ? 'manager' : 'customer', text: m.plainText || m.message || '' };
        }).filter(function(m) { return m.text; });

        if (formatted.length > 2) {
          await aiReview.evaluateConversation(chat.id, managerId, formatted, chat.name || '');
          reviewCount++;
          console.log('[AIReview] Reviewed:', chat.id, 'manager:', managerId);
        }
      } catch(revErr) { console.error('[AIReview] Error:', chat.id, revErr.message); }

      reviewed[chat.id] = Date.now();
      saveReviewed(reviewed);

      // Rate limit - 3s between reviews
      await new Promise(function(r) { setTimeout(r, 3000); });
    }

    // Clean old entries (>7 days)
    var cutoff = Date.now() - 7 * 86400000;
    Object.keys(reviewed).forEach(function(k) { if (reviewed[k] < cutoff) delete reviewed[k]; });
    saveReviewed(reviewed);

    console.log('[Scheduler] AI review complete:', reviewCount, 'new reviews');
  } catch(e) { console.error('[Scheduler] Review check error:', e.message); }
}

async function checkUnresolvedChats() {
  try {
    var res = await channeltalk.listUserChats('opened', 100);
    var chats = (res.userChats || []);
    var now = Date.now();
    // REMOVED: csatList (CSAT는 12h 경고에서 발송)
    var closeList = [];
    var warningList = [];
    var unresolvedList = [];

    // csatSentData를 루프 전에 미리 로드 (warningList 분기에서 사용)
    // csatSentData는 더 이상 루프에서 사용하지 않음
    var closeWarnFile = require("path").join(__dirname, "..", "data", "close-warning-sent.json");
    var _preWarnSent = {};
    try { _preWarnSent = JSON.parse(fs.readFileSync(closeWarnFile, "utf8")); } catch(e) {}

    for (var i = 0; i < chats.length; i++) {
      var chat = chats[i];
      if (!chat || !chat.id) continue;
      var lastMsgAt = chat.openedAt || chat.createdAt;
      var hoursPassed = (now - lastMsgAt) / (1000 * 60 * 60);
      var bizHoursPassed = bizHours.getBusinessHoursElapsedInHours(lastMsgAt, now);

      // Skip LINE chats from auto-close (conversation history lost)
      var isLine = chat.source && chat.source.medium && chat.source.medium.mediumType === "app";
      
      // 영업시간 기준으로 판단 (오프시간/주말/공휴일 제외)
      // 자동 종료: 영업시간 16h (약 2영업일)
      // 경고: 영업시간 12h (약 1.5영업일)
      // CSAT: 영업시간 4h
      if (bizHoursPassed >= 16 && !isLine) {
        closeList.push({ id: chat.id, hours: Math.floor(hoursPassed), bizHours: Math.floor(bizHoursPassed), userId: chat.userId });
      } else if (bizHoursPassed >= 12 && !isLine) {
        if (!_preWarnSent[chat.id]) { warningList.push({ id: chat.id, hours: Math.floor(hoursPassed), bizHours: Math.floor(bizHoursPassed), userId: chat.userId }); }
        // 12h 경고에 CSAT 포함 → markSent
        if (!csatHelper.alreadySent(chat.id)) { csatHelper.markSent(chat.id, "warning-csat"); }

      } else if (bizHoursPassed >= 4) {
        // REMOVED: CSAT 사전발송 (자동종료 시 발송으로 변경)
      }

      if (bizHoursPassed >= 9) {
        // 영업시간 9h 이상(1영업일 이상) 미해결 → 알림
        unresolvedList.push({ id: chat.id, hours: Math.floor(hoursPassed), bizHours: Math.floor(bizHoursPassed), userId: chat.userId });
      }
    }

    // Step 1: CSAT는 자동종료 시 발송 (여기서 발송하지 않음)
    var csatSentCount = 0;

    // Step 1.5: Send closing WARNING to 48h+ chats (actual close at 60h)
    var closeWarnFile = require("path").join(__dirname, "..", "data", "close-warning-sent.json");
    var closeWarnSent = {};
    try { closeWarnSent = JSON.parse(fs.readFileSync(closeWarnFile, "utf8")); } catch(e) {}
    for (var w = 0; w < warningList.length; w++) {
      try {
        var warnChatId = warningList[w].id;
        if (closeWarnSent[warnChatId]) continue; // already warned

        var chatLangs2 = {};
        try { chatLangs2 = JSON.parse(fs.readFileSync(require("path").join(__dirname, "..", "data", "chat-languages.json"), "utf8")); } catch(le) {}
        var warnLang = chatLangs2[warnChatId] || "zh-TW";
        var warnMsgs = {
          "zh-TW": "⏰ 提醒您，此對話即將結束。\n\n如果沒有其他問題，此對話將在稍後自動結束。\n如需繼續諮詢，請回覆任何訊息即可！\n\n📋 最後想請問，這次的服務體驗如何呢？\n1️⃣ 非常滿意  2️⃣ 滿意  3️⃣ 普通  4️⃣ 不滿意  5️⃣ 非常不滿意\n請輸入數字 1~5",
          "ko": "⏰ 이 상담이 곧 종료됩니다.\n\n추가 문의가 없으시면 자동 종료됩니다.\n계속 상담이 필요하시면 아무 메시지나 보내주세요!\n\n📋 마지막으로, 이번 서비스는 어떠셨나요?\n1️⃣ 매우 만족  2️⃣ 만족  3️⃣ 보통  4️⃣ 불만족  5️⃣ 매우 불만족\n숫자 1~5를 입력해주세요",
          "en": "⏰ This chat will be closing soon.\n\nIf you need further help, please send a message!\n\n📋 How was your experience?\n1️⃣ Very Satisfied  2️⃣ Satisfied  3️⃣ Neutral  4️⃣ Dissatisfied  5️⃣ Very Dissatisfied\nPlease enter 1~5",
          "ja": "⏰ このチャットはまもなく終了します。\n\n続けてご質問がある場合はメッセージを送信してください！\n\n📋 今回のサービスはいかがでしたか？\n1️⃣ 大満足  2️⃣ 満足  3️⃣ 普通  4️⃣ 不満  5️⃣ 大不満\n1~5の数字を入力してください"
        };
        await channeltalk.sendMessage(warnChatId, { blocks: [{ type: "text", value: warnMsgs[warnLang] || warnMsgs["zh-TW"] }] });
        closeWarnSent[warnChatId] = Date.now();
        fs.writeFileSync(closeWarnFile, JSON.stringify(closeWarnSent), "utf8");
        console.log("[Scheduler] Close warning sent to chat:", warnChatId);
      } catch(warnErr) {
        console.error("[Scheduler] Close warning error:", warnErr.message);
      }
    }

        // Step 2: Auto-close 48h+ chats
    // 중복 chatId 제거
    var _closeIds = {};
    closeList = closeList.filter(function(c) { if (_closeIds[c.id]) return false; _closeIds[c.id] = true; return true; });
    var closedCount = 0;
    for (var d = 0; d < closeList.length; d++) {
      try {
        var closeChatId = closeList[d].id;

        // 매니저 미응답 체크 - 한 번도 답변 안 한 채팅은 종료하지 않고 긴급 알림
        try {
          var _closeCheck = await channeltalk.getChatMessages(closeChatId, 50);
          var _noManagerClose = !(_closeCheck.messages || []).some(function(m) {
            return m.personType === "manager" && m.personId && m.personId !== "0";
          });
          if (_noManagerClose) {
            console.log("[Scheduler] WARNING: No manager reply, skip auto-close:", closeChatId);
            // 긴급 알림 발송
            try {
              var _mgrIds = await channeltalk.listManagers();
              var _alertManagers = (_mgrIds.managers || []).filter(function(m){return m.role !== "bot";}).slice(0,3);
              for (var _am = 0; _am < _alertManagers.length; _am++) {
                await channeltalk.addManagerToChat(closeChatId, _alertManagers[_am].id);
              }
              await channeltalk.sendMessage(closeChatId, { blocks: [{ type: "text", value: "⚠️ [긴급] 이 고객 문의에 매니저 응답이 없습니다. 즉시 확인해주세요!\n⚠️ [緊急] 此客戶尚未收到客服回覆，請立即確認！" }] });
            } catch(_alertErr) { console.error("[Scheduler] Alert error:", _alertErr.message); }
            continue;
          }
        } catch(_closeChkErr) { console.log("[Scheduler] Close check error:", _closeChkErr.message); }

        // Send closing message
        // 종료 메시지 (CSAT는 12h 경고에서 이미 발송)
        var closeMsg = "이 상담은 장시간 추가 메시지가 없어 자동 종료됩니다. 추가 문의가 있으시면 언제든 새 채팅을 시작해주세요! 😊\n\n" +
          "此對話因長時間無新訊息，將自動結束。如有其他問題，歡迎隨時開啟新對話！😊";

        await channeltalk.sendMessage(closeChatId, { blocks: [{ type: "text", value: closeMsg }] });
        // CSAT는 12h 경고에서 이미 발송됨
        console.log("[Scheduler] Auto-closing chat:", closeChatId);
        await channeltalk.closeChat(closeChatId);
        try { var _cw = JSON.parse(fs.readFileSync(closeWarnFile, "utf8")); delete _cw[closeChatId]; fs.writeFileSync(closeWarnFile, JSON.stringify(_cw), "utf8"); } catch(e) {}
        closedCount++;

        // CSAT tracking: 자동종료 시 markSent 했으므로 remove하지 않음 (응답 대기)
      } catch (closeErr) {
        console.error("[Scheduler] Auto-close error for", closeList[d].id, ":", closeErr.message);
      }
    }

    if (closedCount > 0) {
      console.log("[Scheduler] Auto-closed", closedCount, "chats (48h+ inactive)");
    }

    // Step 3: Alert for remaining unresolved + manager notification
    if (unresolvedList.length > 0) {
      console.log("[Scheduler] Unresolved check done:", unresolvedList.length, "overdue chats (" + 0 + " CSAT,", closedCount, "closed)");
      // 매니저에게 미해결 채팅 알림 (그룹 메시지)
      if (unresolvedList.length >= 3) {
        try {
          var groups = await channeltalk.listGroups(5);
          if (groups.groups && groups.groups.length > 0) {
            var alertMsg = '⚠️ [CS Alert] 미해결 상담 ' + unresolvedList.length + '건 (24시간+)\n';
            unresolvedList.slice(0, 5).forEach(function(u) {
              alertMsg += '  - Chat ' + u.id.substring(0,8) + '... (' + u.hours + 'h)\n';
            });
            alertMsg += '\n빠른 응답 부탁드립니다!';
            await channeltalk.sendGroupMessage(groups.groups[0].id, { blocks: [{ type: 'text', value: alertMsg }] });
            console.log('[Scheduler] Manager alert sent: ' + unresolvedList.length + ' unresolved chats');
          }
        } catch(alertErr) { console.log('[Scheduler] Alert error:', alertErr.message); }
      }
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

    // CS Score 요약 추가
    var csScoreSummary = '';
    try {
      var http = require('http');
      var csData = await new Promise(function(resolve, reject) {
        http.get('http://localhost:3000/api/analytics/cs-score-metrics?days=7', function(res2) {
          var body = ''; res2.on('data', function(c) { body += c; }); res2.on('end', function() { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
        }).on('error', reject);
      });
      if (csData.success && csData.integratedScore) {
        var is = csData.integratedScore;
        csScoreSummary = '\n\n📊 CS Quality Score: ' + is.score + '/5.0 (목표: ' + is.target + ')\n';
        csScoreSummary += '  FRT: ' + is.breakdown.frt.score.toFixed(1) + '/5 | FCR: ' + is.breakdown.fcr.score.toFixed(1) + '/5 | CSAT: ' + is.breakdown.csat.score.toFixed(1) + '/5\n';
        csScoreSummary += '  CES: ' + is.breakdown.ces.score.toFixed(1) + '/5 | NoReply: ' + is.breakdown.noReply.score.toFixed(1) + '/5';
      }
    } catch(csErr) { console.log('[Scheduler] CS Score summary error:', csErr.message); }
    reportKo += csScoreSummary;

    // escalation Top 5 분석
    try {
      var aiLogMod = require('./ai-log');
      var escConvs = aiLogMod.getConversations(200, { escalated: true });
      if (escConvs && escConvs.length > 0) {
        var escCategories = {};
        escConvs.forEach(function(c) {
          var msg = (c.userMessage || '').toLowerCase();
          var cat = '기타';
          if (msg.indexOf('배송') > -1 || msg.indexOf('物流') > -1 || msg.indexOf('寄') > -1 || msg.indexOf('送') > -1) cat = '배송/물류';
          else if (msg.indexOf('취소') > -1 || msg.indexOf('取消') > -1 || msg.indexOf('退') > -1) cat = '취소/환불';
          else if (msg.indexOf('결제') > -1 || msg.indexOf('付款') > -1 || msg.indexOf('信用卡') > -1) cat = '결제';
          else if (msg.indexOf('가격') > -1 || msg.indexOf('價格') > -1 || msg.indexOf('運費') > -1 || msg.indexOf('費用') > -1) cat = '가격/비용';
          else if (msg.indexOf('찾') > -1 || msg.indexOf('找') > -1 || msg.indexOf('有賣') > -1 || msg.indexOf('幫我') > -1) cat = '상품문의';
          else if (msg.indexOf('客服') > -1 || msg.indexOf('真人') > -1 || msg.indexOf('상담') > -1) cat = '에스컬레이션 요청';
          escCategories[cat] = (escCategories[cat] || 0) + 1;
        });
        var sorted = Object.keys(escCategories).sort(function(a,b) { return escCategories[b] - escCategories[a]; });
        var escReport = '\n\n🔥 에스컬레이션 Top 5 (최근 200건):\n';
        sorted.slice(0, 5).forEach(function(cat, i) {
          escReport += '  ' + (i+1) + '. ' + cat + ': ' + escCategories[cat] + '건\n';
        });
        reportKo += escReport;
      }
    } catch(escErr) { console.log('[Scheduler] Escalation analysis error:', escErr.message); }

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

  // AI Review - every 2 hours
  cron.schedule('30 */2 * * *', function() {
    checkClosedForReview();
  });

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

  
  // CS Score daily record - 매일 23:55 KST
  cron.schedule('55 23 * * *', async () => {
    console.log('[Scheduler] 일일 CS Score 기록 시작');
    try {
      await csScoreTracker.record();
      console.log('[Scheduler] 일일 CS Score 기록 완료');
    } catch(e) {
      console.error('[Scheduler] CS Score 기록 오류:', e.message);
    }
  }, { timezone: 'Asia/Seoul' });

  
  // Morning priority alert - 매일 아침 10시(KST) 미해결 채팅 알림
  cron.schedule('0 10 * * 1-5', async () => {
    console.log('[Scheduler] 아침 미해결 채팅 알림 시작');
    try {
      var chats = await channeltalk.listUserChats('opened', 100);
      var openChats = (chats && chats.userChats) || [];
      var urgentCount = 0;
      var urgentList = [];
      
      openChats.forEach(function(chat) {
        var lastMsgTime = chat.openedAt || chat.createdAt || 0;
        if (!lastMsgTime) return;
        var hoursSince = (Date.now() - lastMsgTime) / (1000 * 60 * 60);
        if (hoursSince >= 4) {
          urgentCount++;
          if (urgentList.length < 5) {
            urgentList.push('・' + (chat.name || chat.id) + ' (' + Math.floor(hoursSince) + '시간 경과)');
          }
        }
      });
      
      if (urgentCount > 0) {
        var alertMsg = '🔔 아침 미해결 채팅 알림\n\n';
        alertMsg += '⚠️ 4시간 이상 미응답: ' + urgentCount + '건\n';
        if (urgentList.length > 0) alertMsg += urgentList.join('\n') + '\n';
        if (urgentCount > 5) alertMsg += '...외 ' + (urgentCount - 5) + '건\n';
        alertMsg += '\n👉 우선 처리 부탁드립니다!';
        
        try {
          var groups = await channeltalk.listGroups();
          if (groups && groups.groups && groups.groups.length > 0) {
            await channeltalk.sendGroupMessage(groups.groups[0].id, { blocks: [{ type: 'text', value: alertMsg }] });
          }
        } catch(ge) { console.log('[Morning Alert] Group message error:', ge.message); }
        console.log('[Scheduler] 아침 알림 발송: ' + urgentCount + '건 미해결');
      } else {
        console.log('[Scheduler] 아침 알림: 미해결 채팅 없음');
      }
    } catch(e) {
      console.error('[Scheduler] 아침 알림 오류:', e.message);
    }
  }, { timezone: 'Asia/Seoul' });

  
  // Afternoon check alert - 매일 오후 3시(KST) 중간 점검
  cron.schedule('0 15 * * 1-5', async () => {
    console.log('[Scheduler] 오후 중간 점검 시작');
    try {
      var chats = await channeltalk.listUserChats('opened', 100);
      var openChats = (chats && chats.userChats) || [];
      var longWait = openChats.filter(function(chat) {
        var lastTime = chat.openedAt || chat.createdAt || 0;
        if (!lastTime) return false;
        var hoursSince = (Date.now() - lastTime) / (1000 * 60 * 60);
        return hoursSince >= 2;
      });
      
      if (longWait.length >= 3) {
        var alertMsg = '⏰ 오후 중간 점검\n\n';
        alertMsg += '2시간 이상 대기 중: ' + longWait.length + '건\n';
        alertMsg += '퇴근 전 처리 권장!\n';
        alertMsg += '\n현재 미해결 총: ' + openChats.length + '건';
        
        try {
          var groups = await channeltalk.listGroups();
          if (groups && groups.groups && groups.groups.length > 0) {
            await channeltalk.sendGroupMessage(groups.groups[0].id, { blocks: [{ type: 'text', value: alertMsg }] });
          }
        } catch(ge) {}
        console.log('[Scheduler] 오후 점검 발송: ' + longWait.length + '건 대기중');
      }
    } catch(e) {
      console.error('[Scheduler] 오후 점검 오류:', e.message);
    }
  }, { timezone: 'Asia/Seoul' });

  
  // Data health weekly check - 수요일 14시 데이터 축적 상태 체크
  cron.schedule('0 14 * * 3', async () => {
    console.log('[Scheduler] 주간 데이터 헬스 체크 시작');
    try {
      var http = require('http');
      var getJSON = function(url) {
        return new Promise(function(resolve, reject) {
          http.get(url, function(res) {
            var d = '';
            res.on('data', function(c) { d += c; });
            res.on('end', function() { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
          }).on('error', reject);
        });
      };
      
      var health = await getJSON('http://localhost:3000/api/analytics/data-health');
      if (health.success && health.recommendations && health.recommendations.length > 0) {
        var alertMsg = '📊 주간 데이터 헬스 리포트\n\n';
        alertMsg += '상태: ' + health.overallStatus + '\n\n';
        alertMsg += '필요 조치:\n';
        health.recommendations.forEach(function(r) { alertMsg += '• ' + r + '\n'; });
        
        try {
          var groups = await channeltalk.listGroups();
          if (groups && groups.groups && groups.groups.length > 0) {
            await channeltalk.sendGroupMessage(groups.groups[0].id, { blocks: [{ type: 'text', value: alertMsg }] });
          }
        } catch(ge) {}
      }
      console.log('[Scheduler] 데이터 헬스 체크 완료:', health.overallStatus);
    } catch(e) {
      console.error('[Scheduler] 데이터 헬스 체크 오류:', e.message);
    }
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

  // Business metrics collection - 매주 월요일 10시 KST
  cron.schedule('0 10 * * 1', async () => {
    console.log('[Scheduler] 주간 사업 지표 수집 시작');
    try {
      const http = require('http');
      // CS Score 트렌드 조회
      const getJSON = (url) => new Promise((resolve, reject) => {
        http.get(url, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
        }).on('error', reject);
      });
      
      const csScore = await getJSON('http://localhost:3000/api/analytics/cs-score-metrics?days=7');
      const escAnalysis = await getJSON('http://localhost:3000/api/analytics/escalation-analysis?days=7');
      
      // 사업 지표 파일에 기록
      const bizFile = require('path').join(__dirname, '../data/business-metrics.json');
      let bizData = [];
      try { if (require('fs').existsSync(bizFile)) bizData = JSON.parse(require('fs').readFileSync(bizFile, 'utf8')); } catch(e) {}
      
      bizData.push({
        week: new Date().toISOString().split('T')[0],
        csScore: csScore.success ? csScore.integratedScore.score : null,
        breakdown: csScore.success ? csScore.integratedScore.breakdown : null,
        escalationTop5: escAnalysis.success ? escAnalysis.categories : null,
        totalEscalations: escAnalysis.success ? escAnalysis.totalEscalated : 0
      });
      
      // 최대 52주(1년) 보관
      if (bizData.length > 52) bizData = bizData.slice(-52);
      require('fs').writeFileSync(bizFile, JSON.stringify(bizData, null, 2), 'utf8');
      console.log('[Scheduler] 주간 사업 지표 기록 완료');
    } catch(e) {
      console.error('[Scheduler] 사업 지표 수집 오류:', e.message);
    }
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
  // 1) csat-sent.json에 기록이 있는지 (csatHelper 통일)
  var sent = csatHelper.load();
  if (!sent[chatId]) return false; // 발송 기록 없음 → pending 아님
  
  // 2) skipped 건은 pending 아님
  if (sent[chatId].skipped) return false;
  
  // 3) count가 0이고 warning만 있는 건 → 아직 실제 발송 안 됨
  if (sent[chatId].count === 0) return false;
  
  // 4) csat-results.json에 이미 응답했는지 (배열이므로 find로 검색)
  try {
    var results = JSON.parse(fs.readFileSync(require("path").join(__dirname, "..", "data", "csat-results.json"), "utf8"));
    if (Array.isArray(results)) {
      var found = results.some(function(r) { return r.chatId === chatId; });
      if (found) return false; // 이미 응답 완료
    }
  } catch(e) {}
  
  // 5) 발송 기록 있고, 응답 기록 없음 → pending
  return true;
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


  // ===== 일일 CS 리포트 (매일 09:00 KST) =====
  cron.schedule('0 0 * * *', async () => {
    console.log('[Scheduler] Daily CS report triggered');
    try {
      var result = await dailyReport.sendDailyReport();
      if (result) {
        console.log('[Scheduler] Daily report sent:', result.stats.date);
      }
    } catch(e) {
      console.error('[Scheduler] Daily report error:', e.message);
    }
  });

  // ===== FAQ 후보 자동 수집 (매일 01:00 KST = 16:00 UTC 전일) =====
  cron.schedule('0 16 * * *', () => {
    console.log('[Scheduler] FAQ candidate update triggered');
    try {
      var result = faqQueue.updateCandidates();
      console.log('[Scheduler] FAQ candidates updated:', result.totalCandidates, 'pending');
    } catch(e) {
      console.error('[Scheduler] FAQ queue error:', e.message);
    }
  });

  // CS Score 히스토리 매일 기록 (23:55 KST = 14:55 UTC)
  cron.schedule('55 14 * * *', function() {
    console.log('[Scheduler] CS Score 일별 기록 시작');
    recordDailyCSScore();
  });

  // ===== 주간 FAQ 강화 리포트 (월요일 10:00 KST = 01:00 UTC) =====
  cron.schedule('0 1 * * 1', async () => {
    console.log('[Scheduler] Weekly FAQ report triggered');
    try {
      faqQueue.updateCandidates();
      var report = faqQueue.generateWeeklyFAQReport();
      console.log('[Scheduler] Weekly FAQ report:', report.substring(0, 200));
      
      var groupId = process.env.REPORT_GROUP_ID;
      if (groupId) {
        var channeltalk = require('./channeltalk');
        await channeltalk.sendGroupMessage(groupId, {
          blocks: [{ type: 'text', value: report }]
        }, 'VEASLY AI Bot');
      }
    } catch(e) {
      console.error('[Scheduler] Weekly FAQ report error:', e.message);
    }
  });

  // === AI 자동 업그레이드 (매 6시간) ===
  cron.schedule('0 */6 * * *', async () => {
    console.log('[Scheduler] Running AI auto-upgrade...');
    try {
      var result = await autoUpgrade.runAutoUpgrade();
      console.log('[Scheduler] Auto-upgrade complete:', JSON.stringify({ added: result.escalationFAQs ? result.escalationFAQs.added : 0, fixes: result.reviewFixes ? result.reviewFixes.fixed : 0 }));
    } catch(e) {
      console.error('[Scheduler] Auto-upgrade error:', e.message);
    }
  });

  // === AI 업그레이드 주간 리포트 (월요일 11시) ===
  cron.schedule('0 11 * * 1', async () => {
    console.log('[Scheduler] Generating upgrade report...');
    try {
      var report = autoUpgrade.generateUpgradeReport();
      console.log(report);
    } catch(e) {
      console.error('[Scheduler] Upgrade report error:', e.message);
    }
  });


module.exports = { startScheduler: startScheduler, checkUnresolvedChats: checkUnresolvedChats, sendWeeklyReport: sendWeeklyReport, parseCSATResponse: parseCSATResponse, isCSATPending: isCSATPending, saveCSATResult: saveCSATResult };
