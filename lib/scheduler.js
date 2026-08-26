var chatResolver = require('./chat-resolver');
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

// [2026-08-14] '매니저 미응답' 긴급알림 1회 발송 기록(상담ID → 발송시각).
//   기록이 없어 4시간 크론마다 같은 알림이 반복되던 문제 방지. close-warning-sent.json 과 같은 방식.
var noMgrAlertFile = require('path').join(__dirname, '..', 'data', 'no-manager-alert-sent.json');
var noMgrAlertSent = {};
try { noMgrAlertSent = JSON.parse(fs.readFileSync(noMgrAlertFile, 'utf8')); } catch (e) {}

// [2026-08-14] 직원용 내부 알림 채널. 슬랙(SLACK_WEBHOOK_URL) → 팀챗(REPORT_GROUP_ID) → 첫 그룹 순.
//   고객 채팅(sendMessage)으로 내부 지시문이 나가지 않도록 이 함수만 쓴다. 성공 시 true.
async function notifyInternal(text) {
  var slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (slackUrl) {
    try {
      await require('axios').post(slackUrl, { text: text }, { timeout: 10000 });
      return true;
    } catch (e) { console.error('[Notify] Slack error:', e.message); }
  }
  try {
    var groupId = process.env.REPORT_GROUP_ID;
    if (!groupId) {
      var groups = await channeltalk.listGroups(5);
      if (groups.groups && groups.groups.length > 0) groupId = groups.groups[0].id;
    }
    if (!groupId) { console.warn('[Notify] 내부 알림 채널 없음(SLACK_WEBHOOK_URL/REPORT_GROUP_ID 미설정)'); return false; }
    await channeltalk.sendGroupMessage(groupId, { blocks: [{ type: 'text', value: text }] });
    return true;
  } catch (e) { console.error('[Notify] Teamchat error:', e.message); return false; }
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

var _unresolvedRunning = false;

async function checkUnresolvedChats() {
  if (_unresolvedRunning) {
    console.log("[Scheduler] checkUnresolvedChats already running, skip");
    return;
  }
  _unresolvedRunning = true;
  try {
    var res = await channeltalk.listUserChats('opened', 100);
    var chats = (res.userChats || []);
    var now = Date.now();
    // REMOVED: csatList (CSAT는 12h 경고에서 발송)
    var closeList = [];
    var warningList = [];
    var unresolvedList = [];

    // csatSentData를 루프 전에 미리 로드 (warningList 분기에서 사용)
    // LEGACY REMOVED: csatSentData
    var closeWarnFile = require("path").join(__dirname, "..", "data", "close-warning-sent.json");
    var _preWarnSent = {};
    try { _preWarnSent = JSON.parse(fs.readFileSync(closeWarnFile, "utf8")); } catch(e) {}

    for (var i = 0; i < chats.length; i++) {
      var chat = chats[i];
      if (!chat || !chat.id) continue;
      // [2026-08-24 FIX] 종료/경고 타이머 기준을 '연 시각(openedAt)' → '마지막 메시지 시각'으로.
      //   openedAt 기준이라 매니저가 응대 중인 장기 상담(예: 통관 20일 지연 건)이 대화 당일에도
      //   16영업시간 초과로 종료+설문 발송됐다(8/14 실사례 — 고객 "還是沒回覆耶" 14분 뒤 자동종료).
      var lastMsgAt = Math.max(chat.frontUpdatedAt || 0, chat.deskUpdatedAt || 0) || chat.openedAt || chat.createdAt;
      var hoursPassed = (now - lastMsgAt) / (1000 * 60 * 60);
      var bizHoursPassed = bizHours.getBusinessHoursElapsedInHours(lastMsgAt, now);

      // Skip LINE chats from auto-close (conversation history lost)
      var isLine = chat.source && chat.source.medium && chat.source.medium.mediumType === "app";
      
      // 영업시간 기준으로 판단 (오프시간/주말/공휴일 제외)
      // 자동 종료: 영업시간 16h (약 2영업일)
      // 경고: 영업시간 12h (약 1.5영업일)
      // CSAT: 영업시간 4h
      if (bizHoursPassed >= 16 && !isLine) {
        closeList.push({ id: chat.id, hours: Math.floor(hoursPassed), bizHours: Math.floor(bizHoursPassed), userId: chat.userId,
          awaitingReply: !!(chat.userLastMessageId && chat.userLastMessageId === chat.frontMessageId) }); // 마지막 발화=고객(미회신)
      } else if (bizHoursPassed >= 12 && !isLine) {
        warningList.push({ id: chat.id, hours: Math.floor(hoursPassed), bizHours: Math.floor(bizHoursPassed), userId: chat.userId });
        // markSent는 실제 발송 성공 후에 수행 (발송 루프에서 처리)

      } else if (bizHoursPassed >= 4) {
        // REMOVED: CSAT 사전발송 (자동종료 시 발송으로 변경)
      }

      if (bizHoursPassed >= 9) {
        // 영업시간 9h 이상(1영업일 이상) 미해결 → 알림
        unresolvedList.push({ id: chat.id, hours: Math.floor(hoursPassed), bizHours: Math.floor(bizHoursPassed), userId: chat.userId });
      }
    }

    // Step 1: CSAT는 자동종료 시 발송 (여기서 발송하지 않음)
    // LEGACY REMOVED: csatSentCount

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
        // 유저 정보 조회 (회원 여부, 이메일, VEASLY ID, 이름)
        var _wUserInfo = { member: false, email: '', veaslyId: '', name: '' };
        try {
          var _wUserData = await channeltalk.getUser(warningList[w].userId || '');
          var _wu = (_wUserData && _wUserData.user) ? _wUserData.user : _wUserData;
          if (_wu) {
            _wUserInfo.member = _wu.member === true;
            _wUserInfo.email = _wu.email || (_wu.profile && _wu.profile.email) || '';
            _wUserInfo.veaslyId = (_wu.profile && _wu.profile.veasly_id) || _wu.memberId || '';
            _wUserInfo.name = _wu.name || (_wu.profile && _wu.profile.name) || '';
          }
        } catch(_wue) { console.log('[Scheduler] User info error:', _wue.message); }
        var _wBaseUrl = "https://veasly-dashboard.gangjun-lee.workers.dev/survey.html";
        var _wSurveyUrl = _wBaseUrl + "?c=" + warnChatId + "&l=" + warnLang;
        // 메시지 1: 종료 경고
        var _wNotice = {
          "zh-TW": "⏰ 提醒您，此對話即將結束。\n\n如果沒有其他問題，此對話將在稍後自動結束。\n如需繼續諮詢，請回覆任何訊息即可！",
          "ko": "⏰ 이 상담이 곧 종료됩니다.\n\n추가 문의가 없으시면 자동 종료됩니다.\n계속 상담이 필요하시면 아무 메시지나 보내주세요!",
          "en": "⏰ This chat will be closing soon.\n\nIf you need further help, please send a message!",
          "ja": "⏰ このチャットはまもなく終了します。\n\n続けてご質問がある場合はメッセージを送信してください！"
        };
        await channeltalk.sendMessage(warnChatId, { blocks: [{ type: "text", value: _wNotice[warnLang] || _wNotice["zh-TW"] }] });
        // 가시성 향상을 위해 두 메시지 사이 짧은 간격
        await new Promise(function(r){ setTimeout(r, 800); });
        // 메시지 2: 설문 링크 (Option A - warm tone, 12h 미응답 단계라 부드럽게 응대)
        var _wName = _wUserInfo.name || '';
        var _wSurveyMsg = {
          "zh-TW": (_wName ? _wName + ' ' : '') + "您好！剛才的諮詢還順利嗎？\n花30秒幫我們打個分，月月抽獎別錯過 🎁\n\n👉 <link type=\"url\">" + _wSurveyUrl + "</link>",
          "ko": (_wName ? _wName + '님 ' : '') + "안녕하세요! 오늘 상담은 어떠셨나요?\n30초 평가 + 매월 추첨 🎁\n\n👉 <link type=\"url\">" + _wSurveyUrl + "</link>",
          "en": "Hi " + (_wName || 'there') + "! How was your chat today?\n30 seconds to rate + monthly draw 🎁\n\n👉 <link type=\"url\">" + _wSurveyUrl + "</link>",
          "ja": (_wName ? _wName + '様、' : '') + "こんにちは！本日のご対応はいかがでしたか？\n30秒の評価で抽選チャンス 🎁\n\n👉 <link type=\"url\">" + _wSurveyUrl + "</link>"
        };
        await channeltalk.sendMessage(warnChatId, { blocks: [{ type: "text", value: _wSurveyMsg[warnLang] || _wSurveyMsg["zh-TW"] }] });
        closeWarnSent[warnChatId] = Date.now();
        fs.writeFileSync(closeWarnFile, JSON.stringify(closeWarnSent), "utf8");
        if (!csatHelper.alreadySent(warnChatId)) { csatHelper.markSent(warnChatId, "warning-csat"); }
        console.log("[Scheduler] Close warning sent to chat:", warnChatId);
      } catch(warnErr) {
        console.error("[Scheduler] Close warning error:", warnErr.message);
      }
    }

        // Step 2: Auto-close 48h+ chats
    // 중복 chatId 제거
    // warningList 중복 제거
    var _warnIds = {};
    warningList = warningList.filter(function(w) { if (_warnIds[w.id]) return false; _warnIds[w.id] = true; return true; });

    var _closeIds = {};
    closeList = closeList.filter(function(c) { if (_closeIds[c.id]) return false; _closeIds[c.id] = true; return true; });
    var closedCount = 0;
    for (var d = 0; d < closeList.length; d++) {
      try {
        var closeChatId = closeList[d].id;

                // === 봇 해결 완료 체크 (chat-resolver) ===
        var recentMsgs = [];
        // [2026-08-14 FIX] chat-resolver 는 원본 메시지(personType/plainText)를 읽는데 여기서만
        //   {role,text} 로 바꿔 넘기고 있어 isChatResolved 가 항상 false 였다(= 봇이 깔끔히 해결한
        //   상담까지 전부 '매니저 미응답' 경로로 유입). analytics.js 처럼 원본을 그대로 넘긴다.
        try {
          var _resolveMsgs = await channeltalk.getChatMessages(closeChatId, 20);
          recentMsgs = (_resolveMsgs.messages || []).map(function(m){
            return {
              personType: m.personType,
              personId: m.personId,
              createdAt: m.createdAt,
              plainText: m.plainText || (m.blocks && m.blocks[0] && m.blocks[0].value) || ""
            };
          });
        } catch(_rmErr) {}
        var resolveResult = chatResolver.isChatResolved(recentMsgs);
        var _isResolved = resolveResult.resolved;
        if (_isResolved) {
          console.log("[Scheduler] Chat " + closeChatId + " resolved by bot (" + resolveResult.reason + "), closing without manager alert");
        }

        // 매니저 미응답 체크 - resolved가 아닌 경우에만
        if (!_isResolved) { try {
          var _closeCheck = await channeltalk.getChatMessages(closeChatId, 50);
          var _noManagerClose = !(_closeCheck.messages || []).some(function(m) {
            return m.personType === "manager" && m.personId && m.personId !== "0";
          });
          if (_noManagerClose) {
            console.log("[Scheduler] WARNING: No manager reply, skip auto-close:", closeChatId);
            // [2026-08-14 FIX] 이 알림은 '직원용 내부 지시문'인데 sendMessage(=/user-chats/{id}/messages)로
            //   고객 채팅창에 발송되고 있었다. 게다가 발송 기록이 없어 4시간 크론마다 무한 반복됐다.
            //   → 내부 채널(슬랙/팀챗)로 보내고, 상담당 1회만 발송한다. 고객에게는 아무것도 보내지 않는다.
            try {
              var _mgrIds = await channeltalk.listManagers();
              var _alertManagers = (_mgrIds.managers || []).filter(function(m){return m.role !== "bot";}).slice(0,3);
              for (var _am = 0; _am < _alertManagers.length; _am++) {
                await channeltalk.addFollowers(closeChatId, _alertManagers[_am].id);
              }
              if (!noMgrAlertSent[closeChatId]) {
                var _alertText = "[긴급] 매니저 응답이 한 번도 없는 상담입니다. 즉시 확인해주세요!\n"
                  + "상담 바로가기: https://desk.channel.io/#/channels/138710/user_chats/" + closeChatId;
                var _alerted = await notifyInternal(_alertText);
                if (_alerted) {
                  noMgrAlertSent[closeChatId] = Date.now();
                  try { fs.writeFileSync(noMgrAlertFile, JSON.stringify(noMgrAlertSent), "utf8"); } catch(e) {}
                }
              }
            } catch(_alertErr) { console.error("[Scheduler] Alert error:", _alertErr.message); }
            continue;
          }
        } catch(_closeChkErr) { console.log("[Scheduler] Close check error:", _closeChkErr.message); } }

        // [2026-08-24 FIX] 마지막 발화가 고객(=미회신)인 미해결 상담은 닫지 않는다.
        //   종료+설문이 "방치 확인사살"이 되는 문제(8/14 실사례). 대신 내부 미회신 알림 1회.
        if (!_isResolved && closeList[d].awaitingReply) {
          console.log("[Scheduler] Awaiting staff reply, skip auto-close:", closeChatId);
          if (!noMgrAlertSent[closeChatId]) {
            try {
              var _awAlerted = await notifyInternal("[미회신] 고객 질문에 답이 없는 채 16영업시간+ 방치된 상담입니다. 확인해주세요!\n상담 바로가기: https://desk.channel.io/#/channels/138710/user_chats/" + closeChatId);
              if (_awAlerted) { noMgrAlertSent[closeChatId] = Date.now(); try { fs.writeFileSync(noMgrAlertFile, JSON.stringify(noMgrAlertSent), "utf8"); } catch(e) {} }
            } catch(_awErr) { console.error("[Scheduler] Await-reply alert error:", _awErr.message); }
          }
          continue;
        }

        // Send closing message
        // 종료 메시지 + 설문 링크 발송
        var _cLangs = {}; try { _cLangs = JSON.parse(fs.readFileSync(require("path").join(__dirname, "..", "data", "chat-languages.json"), "utf8")); } catch(e) {}
        var _cLang = _cLangs[closeChatId] || "zh-TW";
        var _cUserInfo = { member: false, email: '', veaslyId: '', name: '' };
        try {
          var _cUserData = await channeltalk.getUser(closeList[d].userId || '');
          var _cu = (_cUserData && _cUserData.user) ? _cUserData.user : _cUserData;
          if (_cu) { _cUserInfo.member = _cu.member === true; _cUserInfo.email = _cu.email || (_cu.profile && _cu.profile.email) || ''; _cUserInfo.veaslyId = (_cu.profile && _cu.profile.veasly_id) || _cu.memberId || ''; _cUserInfo.name = _cu.name || (_cu.profile && _cu.profile.name) || ''; }
        } catch(_cue) {}
        var _cBaseUrl = "https://veasly-dashboard.gangjun-lee.workers.dev/survey.html";
        var _cSurveyUrl = _cBaseUrl + "?c=" + closeChatId + "&l=" + _cLang;
        // 메시지 1: 종료 안내
        var _closeNotice = {
          "zh-TW": "此對話因長時間無新訊息，將自動結束。\n如有其他問題，歡迎隨時開啟新對話！😊",
          "ko": "장시간 추가 메시지가 없어 자동 종료됩니다.\n추가 문의 시 새 채팅을 시작해주세요! 😊",
          "en": "This chat is closing due to inactivity.\nFeel free to start a new chat anytime! 😊",
          "ja": "長時間メッセージがないため自動終了します。\n新しいチャットはいつでも開始できます！😊"
        };
        await channeltalk.sendMessage(closeChatId, { blocks: [{ type: "text", value: _closeNotice[_cLang] || _closeNotice["zh-TW"] }] });
        // 가시성 향상을 위해 두 메시지 사이 짧은 간격
        await new Promise(function(r){ setTimeout(r, 800); });
        // 메시지 2: 설문 링크 (Option B - action tone, 자동종료 단계라 자극적으로 응답 유도)
        var _cName = _cUserInfo.name || '';
        var _surveyMsg = {
          "zh-TW": (_cName ? _cName + ' ' : '') + "您好 ⭐ 您的一句話 = 我們的改進方向\n30秒打分，立即參加月月抽獎\n\n👉 立即評分 <link type=\"url\">" + _cSurveyUrl + "</link>",
          "ko": (_cName ? _cName + '님 ' : '') + "⭐ 한 줄 평가가 서비스 개선의 시작입니다\n30초 평가 + 매월 추첨 응모\n\n👉 지금 평가하기 <link type=\"url\">" + _cSurveyUrl + "</link>",
          "en": "Hi " + (_cName || 'there') + " ⭐ One rating = real improvement\n30 sec rating + monthly draw entry\n\n👉 Rate now <link type=\"url\">" + _cSurveyUrl + "</link>",
          "ja": (_cName ? _cName + '様 ' : '') + "⭐ 一言の評価がサービスを変えます\n30秒評価 + 毎月抽選応募\n\n👉 今すぐ評価 <link type=\"url\">" + _cSurveyUrl + "</link>"
        };
        // [2026-08-24 FIX] 설문 '발송' 자체를 가드 안으로 — 기존엔 기록만 가드해 12h 경고 설문과
        //   이중 발송됐고(감사 확정), 재오픈 상담엔 종료 때마다 재발송됐다(8/14+8/20 실사례).
        if (!csatHelper.alreadySent(closeChatId)) {
          await channeltalk.sendMessage(closeChatId, { blocks: [{ type: "text", value: _surveyMsg[_cLang] || _surveyMsg["zh-TW"] }] });
          csatHelper.markSent(closeChatId, "auto-close-csat");
        }
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
      // 오래된 close-warning-sent 기록 정리 (30일 이상)
    var _cwNow = Date.now();
    var _cwChanged = false;
    Object.keys(closeWarnSent).forEach(function(k) {
      if (_cwNow - closeWarnSent[k] > 30 * 86400000) { delete closeWarnSent[k]; _cwChanged = true; }
    });
    if (_cwChanged) { fs.writeFileSync(closeWarnFile, JSON.stringify(closeWarnSent), "utf8"); }
    // [2026-08-14] 매니저 미응답 알림 기록도 같이 정리 (30일 이상)
    var _nmChanged = false;
    Object.keys(noMgrAlertSent).forEach(function(k) {
      if (_cwNow - noMgrAlertSent[k] > 30 * 86400000) { delete noMgrAlertSent[k]; _nmChanged = true; }
    });
    if (_nmChanged) { try { fs.writeFileSync(noMgrAlertFile, JSON.stringify(noMgrAlertSent), "utf8"); } catch(e) {} }
    console.log("[Scheduler] Unresolved check done:", unresolvedList.length, "overdue chats (" + "0 CSAT,", closedCount, "closed)");
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

var _schedulerStarted = false;

function startScheduler() {
  if (_schedulerStarted) {
    console.log("[Scheduler] Already started, skipping duplicate init");
    return;
  }
  _schedulerStarted = true;
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

  // [2026-07-05] 노션 지식 동기화: 매일 04:30 KST (notion 모드일 때만). data/knowledge.md 재생성.
  cron.schedule('30 4 * * *', function() {
    if ((process.env.KNOWLEDGE_SOURCE || 'pinecone') !== 'notion') return;
    console.log('[Scheduler] 노션 지식 동기화 시작 (knowledge.md)...');
    try {
      require('../scripts/sync-notion-knowledge').main()
        .then(function() { console.log('[Scheduler] 노션 지식 동기화 완료'); })
        .catch(function(e) { console.error('[Scheduler] 노션 지식 동기화 실패:', e.message); });
    } catch (e) { console.error('[Scheduler] 노션 지식 동기화 로드 실패:', e.message); }
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
// ═══════════════════════════════════════════════════════════════════
// [2026-08-24] CS 넘김 데일리 정리 — 열린(신규/처리 중) 건의 실제 대화를 실사해
//   ① 실질 마무리(매니저 응대 후 종료/3일+ 조용) → 자동 해결 처리
//   ② 미회신·매니저 약속 후 2일+ 무소식(이행 미확인) → 해결로 넘기지 않고 약속추적 등록(기한 즉시)
//   첫 수동 정리(8/24, 133건)에서 확인한 맹점 "약속 후 침묵을 해결로 오판"을 반영한 자동판.
// ═══════════════════════════════════════════════════════════════════
var HANDOFF_DB = process.env.NOTION_CS_HANDOFF_DB || '41f0db07e5104a67bb0bbcfb20471250';
var _TRIAGE_PROMISE_RE = /確認後|確認一下|確認完|向賣家|跟賣家|向物流|跟物流|向品牌|查詢後|查一下|回覆您|稍後回覆|會盡快|第一時間|一有/;
function _triageThanks(t) { t = (t || '').trim(); if (t.indexOf('스티커를 전송') > -1) return true; return t.length < 30 && /謝謝|感謝|好的|好喔|好哦|了解|收到|知道了|明白|辛苦|感恩|ok|thank|감사/i.test(t); }
async function handoffTriage() {
  if (!process.env.NOTION_TOKEN) return;
  var axios = require('axios');
  var notionLib = require('./notion');
  var NH = { headers: { 'Authorization': 'Bearer ' + process.env.NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, timeout: 15000 };
  var CHH = { headers: { 'x-access-key': process.env.CHANNEL_ACCESS_KEY, 'x-access-secret': process.env.CHANNEL_ACCESS_SECRET }, timeout: 15000, validateStatus: function () { return true; } };
  function zzz(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var rows = [], cursor;
  do {
    var qb = { page_size: 100, filter: { or: [{ property: '상태', select: { equals: '신규' } }, { property: '상태', select: { equals: '처리 중' } }] } };
    if (cursor) qb.start_cursor = cursor;
    var qr = await axios.post('https://api.notion.com/v1/databases/' + HANDOFF_DB + '/query', qb, NH);
    rows = rows.concat(qr.data.results); cursor = qr.data.has_more ? qr.data.next_cursor : null;
  } while (cursor && rows.length < 300);
  var resolved = 0, flagged = 0, summarized = 0, seenChat = {};
  for (var i = 0; i < rows.length; i++) {
    var p = rows[i];
    var link = ''; try { link = p.properties['채널톡 링크'].url || ''; } catch (e) {}
    var tChatId = (link.match(/user_chats\/([a-z0-9]+)/i) || [])[1] || '';
    if (!tChatId) continue;
    var verdict = seenChat[tChatId]; // 같은 상담의 중복 row는 같은 판정 재사용(대화 재조회 없이)
    if (!verdict) {
      var mr = await axios.get('https://api.channel.io/open/v5/user-chats/' + tChatId + '/messages?limit=60&sortOrder=desc', CHH);
      if (mr.status >= 400) { seenChat[tChatId] = { v: 'skip' }; continue; }
      var msgs = (mr.data.messages || []).filter(function (m) { return m.createdAt; });
      var rowCreated = new Date(p.created_time).getTime();
      var lastMgr = null, lastUser = null, mgrAfterRow = false, lastAny = 0;
      msgs.forEach(function (m) {
        lastAny = Math.max(lastAny, m.createdAt);
        if (m.personType === 'manager') { if (!lastMgr || m.createdAt > lastMgr.createdAt) lastMgr = m; if (m.createdAt > rowCreated - 300000) mgrAfterRow = true; }
        if (m.personType === 'user') { if (!lastUser || m.createdAt > lastUser.createdAt) lastUser = m; }
      });
      var chState = null;
      var cr = await axios.get('https://api.channel.io/open/v5/user-chats/' + tChatId, CHH);
      if (cr.status < 400) { try { chState = (cr.data.userChat || cr.data).state; } catch (e) {} }
      var quietDays = lastAny ? (Date.now() - lastAny) / 86400000 : 999;
      if (!msgs.length) verdict = { v: 'skip' };
      else if (!mgrAfterRow) verdict = { v: 'flag', why: '넘김 후 매니저 응답 0건' };
      else if (lastUser && lastMgr && lastUser.createdAt > lastMgr.createdAt && !_triageThanks(lastUser.plainText)) verdict = { v: 'flag', why: '고객 마지막 메시지 미회신: ' + String(lastUser.plainText || '').replace(/\s+/g, ' ').slice(0, 60) };
      else if (lastMgr && _TRIAGE_PROMISE_RE.test(lastMgr.plainText || '') && (!lastUser || lastUser.createdAt < lastMgr.createdAt) && quietDays >= 2) verdict = { v: 'flag', why: '매니저 확인 약속 후 ' + Math.floor(quietDays) + '일 무소식(이행 미확인): ' + String(lastMgr.plainText || '').replace(/\s+/g, ' ').slice(0, 60) };
      else if (chState === 'closed' || quietDays >= 3) verdict = { v: 'resolve' };
      else verdict = { v: 'keep' };
      verdict.msgs = msgs;
      seenChat[tChatId] = verdict;
      if (verdict.v === 'flag') {
        try { await notionLib.createPromise({ chatId: tChatId, channelId: '138710', text: 'CS넘김 미해결: ' + verdict.why, source: '수동', dueIso: new Date().toISOString() }); flagged++; } catch (e) {}
      }
      await zzz(150);
    }
    if (verdict.v === 'resolve') {
      try {
        var props = { '상태': { select: { name: '해결' } } };
        // [2026-08-24] 처리 결과 / 한 줄 규칙 자동 작성 — 이 필드가 SOP 승격 원천인데
        //   실측 392건 중 233건이 빈칸·자동메모여서 파이프라인이 안 돌고 있었다.
        //   사람이 쓴 값은 절대 덮지 않고(isOverwritable), 대화에 근거 없으면 쓰지 않는다.
        try {
          var hr = require('./handoff-resolution');
          var cur = '';
          try { cur = (p.properties['처리 결과 / 한 줄 규칙'].rich_text || []).map(function (t) { return t.plain_text; }).join('').trim(); } catch (e2) {}
          if (hr.isOverwritable(cur) && verdict.msgs && verdict.msgs.length) {
            var reasonName = '';
            try { reasonName = p.properties['넘김 사유'].select.name; } catch (e3) {}
            var line = await hr.generateResolution(verdict.msgs, { reason: reasonName });
            if (line) { props['처리 결과 / 한 줄 규칙'] = { rich_text: [{ text: { content: line.slice(0, 1900) } }] }; summarized++; }
          }
        } catch (hrErr) { console.error('[HandoffTriage] 처리결과 생성 실패:', hrErr.message); }
        await axios.patch('https://api.notion.com/v1/pages/' + p.id, { properties: props }, NH);
        resolved++;
      } catch (e) {}
      await zzz(300);
    }
  }
  console.log('[HandoffTriage] 해결 처리:', resolved, '| 처리결과 작성:', summarized, '| 미해결 플래그:', flagged, '| 검사 상담:', Object.keys(seenChat).length);
  if (resolved || flagged) {
    try { await notifyInternal('🔄 넘김 데일리 정리: 실질 마무리 ' + resolved + '건 자동 해결' + (summarized ? '(처리결과 ' + summarized + '건 작성)' : '') + (flagged ? ' / 미해결·약속 미이행 ' + flagged + '건 → 약속 추적(오늘 독촉 목록 포함)' : '')); } catch (e) {}
  }
  return { resolved: resolved, flagged: flagged };
}

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


  // ===== [2026-08-24] 회신 SLA 래더 (영업시간 중 10분마다) =====
  //   채널톡 실제 상태에서 "마지막 발화=고객"을 매번 재계산 → 재시작 무관, 매니저 직접 응대 건도 커버.
  //   단계(30분/2h/4h@here/8h@here)가 올라갈 때만 알림 → 도배 없이 압력만 상승.
  cron.schedule('*/10 * * * *', async () => {
    try {
      if (bizHours.isKRHoliday(Date.now())) return;
      await require('./reply-sla').slaLadderSweep();
    } catch (e) { console.error('[Scheduler] ReplySLA sweep error:', e.message); }
    // [2026-08-24] CS 피드 갱신 — 스윕 직후라 데이터가 최신. 파일 저장 + (설정 시)플랫폼 push
    try { await require('./cs-feed').refresh(); } catch (e) { console.error('[Scheduler] CSFeed error:', e.message); }
  });

  // ===== [2026-08-24] 마감 확인 (평일 KST 18:00 = 09:00 UTC, 영업종료 1시간 전) =====
  //   "오늘 미회신 N건" → 0이면 ✅. 아침 독촉과 짝을 이뤄 '0으로 만들고 퇴근' 습관을 만든다.
  cron.schedule('0 9 * * 1-5', async () => {
    try { await require('./reply-sla').eodSummary(); }
    catch (e) { console.error('[Scheduler] EOD summary error:', e.message); }
    // 하루 1회 — 일별 추이(history)에 한 행 추가
    try { await require('./cs-feed').refresh({ withHistory: true }); } catch (e) {}
  });

  // ===== [2026-08-24] 유령 상담 정리 (평일 KST 20:00 = 11:00 UTC, 영업 종료 후) =====
  //   고객 마지막 메시지가 스티커·감사인 상담을 조용히 종료(고객에게 메시지 미발송).
  //   미회신 큐에서 노이즈를 매일 걷어내 진짜 건이 묻히지 않게 하는 장치.
  cron.schedule('0 11 * * 1-5', async () => {
    try {
      var g = await require('./reply-sla').closeGhosts({ minBizH: 8, max: 200 });
      if (g && g.closed) { console.log('[Scheduler] 유령 상담 종료:', g.closed); }
    } catch (e) { console.error('[Scheduler] closeGhosts error:', e.message); }
  });

  // ===== [2026-08-24] CS 넘김 데일리 정리 (평일 09:00 KST = 00:00 UTC) — 09:30 약속 독촉 전에 실행 =====
  cron.schedule('0 0 * * 1-5', async () => {
    try {
      if (bizHours.isKRHoliday(Date.now())) return;
      await handoffTriage();
    } catch (e) { console.error('[Scheduler] HandoffTriage error:', e.message); }
  });

  // ===== [2026-08-24] 처리결과 일일 스윕 (평일 09:05 KST = 00:05 UTC, 넘김 정리 직후) =====
  //   handoffTriage 는 '해결' 판정 건만 작성하므로 '처리 중'·기존 빈칸 행이 남는다. 매일 20건씩 메꾼다.
  //   근거부족 건은 7일 백오프(data/resolution-skip.json)로 같은 행에 LLM 을 매일 낭비하지 않는다.
  cron.schedule('5 0 * * 1-5', async () => {
    try {
      if (bizHours.isKRHoliday(Date.now())) return;
      var r = await require('./handoff-resolution').sweep({ limit: 20 });
      if (r && r.written) console.log('[Scheduler] 처리결과 스윕:', r.written, '건 작성, 남은', r.remaining);
    } catch (e) { console.error('[Scheduler] ResolutionSweep error:', e.message); }
  });

  // ===== [2026-08-24] 주간 SOP 승격 후보 리포트 (월요일 10:00 KST = 01:00 UTC) =====
  //   「규칙:」 문구를 LLM 1콜로 주제별 묶어 3건+ 반복되는 것만 슬랙 보고.
  //   자유 텍스트라 문자열 일치로는 안 묶여서 '3회 반복 시 SOP 승격' 설계가 그동안 죽어 있었다.
  cron.schedule('0 1 * * 1', async () => {
    try {
      var c = await require('./handoff-resolution').sopCandidates();
      if (!c || !c.text) { console.log('[Scheduler] SOP 후보 없음'); return; }
      await notifyInternal('📚 주간 SOP 승격 후보 (누적 규칙 ' + c.total + '건 분석)' + String.fromCharCode(10) + String.fromCharCode(10) + c.text + String.fromCharCode(10) + String.fromCharCode(10) + '→ 채택할 항목은 機器人知識庫 SOP 에 추가하면 봇 자동응답률도 함께 올라갑니다.');
      console.log('[Scheduler] SOP 승격 후보 리포트 발송');
    } catch (e) { console.error('[Scheduler] SOPCandidates error:', e.message); }
  });

  // ===== [2026-08-24] 약속 미이행 아침 독촉 (평일 09:30 KST = 00:30 UTC) =====
  // 노션 "📌 고객 약속 추적"에서 기한 지난 대기중 건 → 슬랙 #채널톡-미회신.
  // 완료 처리 전까지 매 영업일 반복 — 약속이 조용히 증발하지 못하게 하는 마지막 그물.
  cron.schedule('30 0 * * 1-5', async () => {
    try {
      if (bizHours.isKRHoliday(Date.now())) return;
      var notionLib = require('./notion');
      var overdue = await notionLib.listOverduePromises();
      if (!overdue.length) { console.log('[Scheduler] 미이행 약속 없음'); return; }
      var lines = overdue.slice(0, 15).map(function (p, i) {
        var days = p.due ? Math.max(0, Math.floor((Date.now() - new Date(p.due).getTime()) / 86400000)) : 0;
        return (i + 1) + '. ' + (p.customer || p.title || ('상담 ' + String(p.chatId).slice(-6))) +
          ' — ' + (days > 0 ? days + '일 경과' : '오늘 기한') + (p.reinquiry ? ' · 고객 재문의 ' + p.reinquiry + '회' : '') +
          (p.chatLink ? '\n   상담: ' + p.chatLink : '') + '\n   노션: ' + p.pageUrl;
      });
      var txt = '📌 미이행 약속 ' + overdue.length + '건 — 오늘 우선 처리해주세요!\n\n' + lines.join('\n') +
        (overdue.length > 15 ? '\n…외 ' + (overdue.length - 15) + '건(노션 확인)' : '') +
        '\n\n완료 처리: 노션에서 상태를 완료로 변경하거나, 해당 상담 팀챗에 /완료';
      await notifyInternal(txt);
      console.log('[Scheduler] Promise reminder sent:', overdue.length, '건');
    } catch (e) { console.error('[Scheduler] Promise reminder error:', e.message); }
    // [2026-08-24] 이월 미회신(24영업h+)도 같은 아침에 한 번 — SLA 래더는 당일 건만 다루므로 여기서 커버.
    try {
      var backlog = await require('./reply-sla').oldBacklogText(10);
      if (backlog) { await notifyInternal(backlog); console.log('[Scheduler] Old backlog reminder sent'); }
    } catch (e) { console.error('[Scheduler] Old backlog error:', e.message); }
  });

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


module.exports = { startScheduler: startScheduler, checkUnresolvedChats: checkUnresolvedChats, sendWeeklyReport: sendWeeklyReport, parseCSATResponse: parseCSATResponse, isCSATPending: isCSATPending, saveCSATResult: saveCSATResult, notifyInternal: notifyInternal, handoffTriage: handoffTriage };
