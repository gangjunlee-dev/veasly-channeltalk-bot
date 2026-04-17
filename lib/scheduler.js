var fs = require('fs');
var cron = require('node-cron');
var channeltalk = require('./channeltalk');
var analytics = require('./analytics');
var faqUpdater = require('./faq-updater');
var shippingTracker = require('./shipping-tracker');

var csScoreTracker = require('../scripts/daily-cs-score-tracker');
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
    var warningList = [];
    var unresolvedList = [];

    for (var i = 0; i < chats.length; i++) {
      var chat = chats[i];
      if (!chat || !chat.id) continue;
      var lastMsgAt = chat.openedAt || chat.createdAt;
      var hoursPassed = (now - lastMsgAt) / (1000 * 60 * 60);

      // Skip LINE chats from auto-close (conversation history lost)
      var isLine = chat.source && chat.source.medium && chat.source.medium.mediumType === "app";
      if (hoursPassed >= 60 && !isLine) {
        // 60h+ → 실제 종료 (예고 후 12시간 경과)
        closeList.push({ id: chat.id, hours: Math.floor(hoursPassed), userId: chat.userId });
      } else if (hoursPassed >= 48 && !isLine) {
        // 48h+ → 종료 예고 메시지
        warningList.push({ id: chat.id, hours: Math.floor(hoursPassed), userId: chat.userId });
        // 종료 예고 채팅도 CSAT 재발송 방지
        if (!csatSentData[chat.id]) { csatSentData[chat.id] = { sentAt: Date.now(), count: 0, warning: true }; saveCSATSent(csatSentData); }

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
        if (csatSentData[csatChatId]) { console.log("[Scheduler] CSAT already sent to:", csatChatId, "- skip"); continue; }

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
        csatSentData[csatChatId] = { sentAt: Date.now(), count: 1 }; saveCSATSent(csatSentData);
        console.log("[Scheduler] CSAT survey sent to chat:", csatChatId);
      } catch (csatErr) {
        console.error("[Scheduler] CSAT send error:", csatErr.message);
      }
    }

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
          "zh-TW": "⏰ 提醒您，此對話已超過48小時沒有新訊息。\n\n如果沒有其他問題，此對話將在12小時後自動結束。\n如需繼續諮詢，請回覆任何訊息即可！😊",
          "ko": "⏰ 알림: 이 대화가 48시간 동안 새 메시지가 없었습니다.\n\n추가 문의가 없으시면 12시간 후 자동 종료됩니다.\n계속 상담이 필요하시면 아무 메시지나 보내주세요! 😊",
          "en": "⏰ Notice: This chat has been inactive for 48 hours.\n\nIf no further messages are received, it will be automatically closed in 12 hours.\nPlease send any message if you need further assistance! 😊",
          "ja": "⏰ お知らせ：このチャットは48時間メッセージがありません。\n\n追加のお問い合わせがなければ、12時間後に自動終了します。\n引き続きご相談が必要な場合は、メッセージをお送りください！😊"
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
    var closedCount = 0;
    for (var d = 0; d < closeList.length; d++) {
      try {
        var closeChatId = closeList[d].id;

        // Send closing message
        var closeMsg = "이 상담은 장시간 추가 메시지가 없어 자동 종료됩니다. 추가 문의가 있으시면 언제든 새 채팅을 시작해주세요! 😊\n\n" +
          "此對話因長時間無新訊息，將自動結束。如有其他問題，歡迎隨時開啟新對話！😊";

        await channeltalk.sendMessage(closeChatId, { blocks: [{ type: "text", value: closeMsg }] });
        await channeltalk.closeChat(closeChatId);
        try { var _cw = JSON.parse(fs.readFileSync(closeWarnFile, "utf8")); delete _cw[closeChatId]; fs.writeFileSync(closeWarnFile, JSON.stringify(_cw), "utf8"); } catch(e) {}
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

    // Step 3: Alert for remaining unresolved + manager notification
    if (unresolvedList.length > 0) {
      console.log("[Scheduler] Unresolved check done:", unresolvedList.length, "overdue chats (" + csatList.length + " CSAT sent,", closedCount, "closed)");
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
