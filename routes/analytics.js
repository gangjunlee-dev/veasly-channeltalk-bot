var chatResolver = require('../lib/chat-resolver');
var express = require('express');
var autoUpgrade = require('../lib/auto-upgrade');
var path = require('path');
var fs = require('fs');
var mgrStats = require('../lib/manager-stats');
var bizHours = require('../lib/business-hours');
var aiLog = require('../lib/ai-log');
var router = express.Router();

// === 미응답 캐시 (5분) ===
var unrepliedCache = { data: null, timestamp: 0 };
var UNREPLIED_CACHE_TTL = 5 * 60 * 1000; // 5분
var analytics = require('../lib/analytics');
var channeltalk = require('../lib/channeltalk');

// 분석 리포트 조회 (한국어)
router.get('/report', async function(req, res) {
  try {
    var days = parseInt(req.query.days) || 7;
    console.log('[Analytics] Generating report for last ' + days + ' days...');
    
    var results = await analytics.analyzeRecentChats(days);
    var reportKo = analytics.generateReport(results);
    var reportTw = analytics.generateReportTW(results);
    
    res.json({
      success: true,
      reportKo: reportKo,
      reportTw: reportTw,
      raw: results,
      totalChats: results.totalChats,
      totalMessages: results.totalMessages,
      userMessages: results.userMessages,
      botMessages: results.botMessages,
      managerMessages: results.managerMessages,
      systemMessages: results.systemMessages,
      categories: results.categories,
      topKeywords: results.topKeywords,
      channelStats: results.channelStats,
      channels: results.channelStats,
      hourlyDistribution: results.hourlyDistribution,
      unresolvedChats: results.unresolvedChats,
      period: results.period
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 팀 채팅으로 리포트 발송
router.post('/send-report', async function(req, res) {
  try {
    var days = parseInt(req.body.days) || 7;
    var groupId = req.body.groupId;

    console.log('[Analytics] Generating and sending report...');
    
    var results = await analytics.analyzeRecentChats(days);
    var report = analytics.generateReport(results);

    if (groupId) {
      await channeltalk.sendGroupMessage(groupId, {
        blocks: [{ type: 'text', value: report }]
      });
      res.json({ success: true, message: 'Report sent to group ' + groupId });
    } else {
      res.json({ success: true, report: report, message: 'No groupId provided. Report generated but not sent.' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



// [2026-06-30] 폐기된 /csat 라우트 삭제 — 죽은 인-챗 1~5점(csat-results.json) 서빙. 전략 대시보드가 cs-score-metrics의 m.csat로 재배선되며 호출처 없어짐. CSAT는 csat-v2-stats / cs-score-metrics 사용.

// 배송 트래커 상태 조회
router.get('/shipping', async function(req, res) {
  try {
    var stateFile = require('path').join(__dirname, '..', 'data', 'shipping-state.json');
    var logFile = require('path').join(__dirname, '..', 'data', 'shipping-notify-log.json');

    var state = {};
    if (fs.existsSync(stateFile)) {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
    var logs = [];
    if (fs.existsSync(logFile)) {
      logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }

    // Status distribution
    var statusCounts = {};
    var keys = Object.keys(state);
    keys.forEach(function(k) {
      var s = state[k];
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });

    // Recent notifications
    var days = parseInt(req.query.days) || 7;
    var cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
    var recentLogs = logs.filter(function(l) { return l.timestamp >= cutoff; });

    res.json({
      success: true,
      trackedItems: keys.length,
      statusDistribution: statusCounts,
      notifications: {
        total: recentLogs.length,
        sent: recentLogs.filter(function(l) { return l.sent; }).length,
        failed: recentLogs.filter(function(l) { return !l.sent; }).length
      },
      recentNotifications: recentLogs.slice(-20).reverse()
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// FAQ 업데이트 로그 조회
router.get('/faq-log', async function(req, res) {
  try {
    var logFile = require('path').join(__dirname, '..', 'data', 'faq-update-log.json');
    var logs = [];
    if (fs.existsSync(logFile)) {
      logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }
    res.json({
      success: true,
      totalUpdates: logs.length,
      lastUpdate: logs.length > 0 ? logs[logs.length - 1] : null,
      history: logs.reverse()
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// [2026-06-30] /auto-close + /dashboard-summary 라우트 삭제 - 둘 다 동결된 csat-results.json(인-챗 1~5점, 6/9 멈춤)을 읽던 죽은/오집계 코드.
// '설문 대기' 카드는 개요 탭에서 웹설문 /api/csat/funnel로 재배선됨. /dashboard-summary는 호출처 없는 dead route였음.

// 매니저 성과 분석
router.get('/manager-performance', async function(req, res) {
  try {
    var days = parseInt(req.query.days) || 7;
    var report = mgrStats.generateReport(days);
    var channeltalk2 = require('../lib/channeltalk');

    // Resolve manager names
    var managers = [];
    try {
      var mgrList = await channeltalk2.listManagers();
      managers = (mgrList.managers || []);
    } catch(e) {}

    var enriched = report.map(function(r) {
      var found = managers.find(function(m) { return m.id === r.managerId; });
      var qScore = mgrStats.calculateQualityScore(r.managerId, days);
      return {
        managerId: r.managerId,
        qualityScore: qScore,
        name: found ? (found.email ? found.email.split('@')[0] : found.name || r.managerId) : r.managerId.substring(0, 8) + "...",
        email: found ? (found.email || '') : '',
        totalReplies: r.totalReplies,
        uniqueChats: r.uniqueChats,
        avgReplyLength: r.avgReplyLength,
        avgResponseTimeMin: r.avgResponseTimeMin,
        bizAvgResponseTimeMin: r.bizAvgResponseTimeMin || 0,
        responseSamples: r.responseSamples,
        bizResponseSamples: r.bizResponseSamples || 0,
        dailyTrend: r.dailyTrend || []
      };
    });

    // Find managers who are followers but didn't reply
    var activeIds = enriched.map(function(e) { return e.managerId; });
    var inactiveManagers = managers.filter(function(m) {
      return activeIds.indexOf(m.id) === -1 && !m.bot;
    }).map(function(m) {
      return {
        managerId: m.id,
        name: m.email ? m.email.split('@')[0] : (m.name || m.id.substring(0, 8) + "..."),
        email: m.email || '',
        totalReplies: 0,
        uniqueChats: 0,
        avgReplyLength: 0,
        avgResponseTimeMin: 0,
        responseSamples: 0,
        status: "inactive"
      };
    });

    var allManagers = enriched.map(function(e) {
      e.status = "active";
      return e;
    }).concat(inactiveManagers);

    res.json({
      success: true,
      period: days + " days",
      managers: allManagers,
      summary: {
        totalManagers: allManagers.length,
        activeManagers: enriched.length,
        inactiveManagers: inactiveManagers.length,
        totalReplies: enriched.reduce(function(s, m) { return s + m.totalReplies; }, 0),
        totalChats: enriched.reduce(function(s, m) { return s + m.uniqueChats; }, 0)
      }
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// AI 대화 로그 조회
router.get('/ai-conversations', async function(req, res) {
  try {
    var limit = parseInt(req.query.limit) || 50;
    var type = req.query.type || null;
    var filter = {};
    if (type) filter.type = type;
    if (req.query.escalated === 'true') filter.escalated = true;

    var conversations = aiLog.getConversations(limit, Object.keys(filter).length > 0 ? filter : null);
    var stats = aiLog.getStats();

    res.json({
      success: true,
      stats: stats,
      conversations: conversations
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// AI answer review/rating by admin
router.post('/ai-review', async function(req, res) {
  try {
    var review = req.body;
    if (!review.chatId || !review.timestamp || !review.rating) {
      return res.status(400).json({ success: false, error: 'chatId, timestamp, rating required' });
    }
    var reviewFile = require('path').join(__dirname, '..', 'data', 'ai-reviews.json');
    var reviews = [];
    try { reviews = JSON.parse(fs.readFileSync(reviewFile, 'utf8')); } catch(e) {}
    reviews.push({
      chatId: review.chatId,
      originalTimestamp: review.timestamp,
      rating: review.rating,
      comment: review.comment || '',
      reviewedAt: new Date().toISOString(),
      userMessage: review.userMessage || '',
      aiResponse: review.aiResponse || ''
    });
    if (reviews.length > 1000) reviews = reviews.slice(-1000);
    fs.writeFileSync(reviewFile, JSON.stringify(reviews, null, 2));
    res.json({ success: true, totalReviews: reviews.length });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/ai-reviews', async function(req, res) {
  try {
    var reviewFile = require('path').join(__dirname, '..', 'data', 'ai-reviews.json');
    var reviews = [];
    try { reviews = JSON.parse(fs.readFileSync(reviewFile, 'utf8')); } catch(e) {}
    var manual = reviews.filter(function(r) { return r.rating; });
    var auto = reviews.filter(function(r) { return r.scores && typeof r.scores.totalScore === 'number'; });
    // [2026-06-30] 수동 평가는 거의 없고 자동 셀프리뷰(scores.totalScore/25)가 실데이터 → 자동 점수를 밴딩해 합산.
    // good: 18+/25, fix(개선후보): 12~17, bad: <12.
    var autoGood = auto.filter(function(r){ return r.scores.totalScore >= 18; }).length;
    var autoFix  = auto.filter(function(r){ return r.scores.totalScore >= 12 && r.scores.totalScore < 18; }).length;
    var autoBad  = auto.filter(function(r){ return r.scores.totalScore < 12; }).length;
    var total = manual.length + auto.length;
    var good = manual.filter(function(r) { return r.rating === 'good'; }).length + autoGood;
    var bad = manual.filter(function(r) { return r.rating === 'bad'; }).length + autoBad;
    var fix = manual.filter(function(r) { return r.rating === 'fix'; }).length + autoFix;
    res.json({ success: true, total: total, good: good, bad: bad, fix: fix, manualCount: manual.length, autoReviewCount: auto.length, recent: reviews.slice(-30).reverse() });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});



// CS Score Metrics - 응답속도 분포, 미응답종료율, 재문의율
// ai-quality-reviews 별칭 (대시보드 호환)
router.get('/ai-quality-reviews', async function(req, res) {
  try {
    var reviewFile = path.join(__dirname, '..', 'data', 'ai-reviews.json');
    var reviews = [];
    if (fs.existsSync(reviewFile)) {
      reviews = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
    }
    var days = parseInt(req.query.days) || 30;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    var filtered = reviews.filter(function(r) {
      return new Date(r.timestamp || r.date) >= cutoff;
    });
    var metrics = filtered.map(function(r) {
      return {
        managerId: r.managerId || 'unknown',
        score: r.scores ? (r.scores.totalScore || 0) : 0, // [2026-06-30] 필드 오타 수정: total → totalScore (ai-review.js 저장 필드). 전부 0이던 버그.
        date: r.timestamp || r.date,
        summary: r.scores ? (r.scores.summary || '') : ''
      };
    });
    res.json({ success: true, metrics: metrics, total: metrics.length });
  } catch(e) {
    res.json({ success: true, metrics: [], total: 0 });
  }
});


router.get('/cs-score-metrics', async function(req, res) {
  try {
    var days = parseInt(req.query.days) || 7;
    var channeltalk = require('../lib/channeltalk');
    var mgrStats = require('../lib/manager-stats');

    // 1. Response time distribution from manager-stats
    var statsFile = require('path').join(__dirname, '..', 'data', 'manager-stats.json');
    var stats = {};
    try { stats = JSON.parse(fs.readFileSync(statsFile, 'utf8')); } catch(e) { console.error('[CS Score] manager-stats.json read failed — noReply/응답률이 0으로 과소집계될 수 있음:', e.message); }
    var responseTimes = [];
    var cutoffMs = Date.now() - days * 86400000;
    var chatKeys = Object.keys(stats.chats || {});
    var totalMgrChats = 0;
    var noReplyChats = 0;
    var userIdChats = {};

    chatKeys.forEach(function(cid) {
      var chat = stats.chats[cid];
      if (chat.firstUserMsg && chat.firstUserMsg >= cutoffMs) {
        // 영업시간 기준 경과 시간 계산
        var bizElapsed = bizHours.getBusinessHoursElapsedInHours(chat.firstUserMsg, Date.now());
        
        if (chat.firstMgrReply) {
          totalMgrChats++;
          var rt = chat.firstMgrReply - chat.firstUserMsg;
          if (rt > 0 && rt < 86400000) responseTimes.push(rt);
        } else {
          // 영업시간 1시간 이상 경과한 경우만 미응답으로 집계
          // (오프시간/주말에 들어온 문의는 다음 영업일까지 대기)
          if (bizElapsed >= 1) {
            // 봇 해결 완료 체크 - CSAT 숫자/감사 메시지는 미응답 제외
            var _msgs1 = chat.messages || [];
            var _resolved1 = chatResolver.isChatResolved(_msgs1);
            if (_resolved1.resolved) {
              // 봇이 해결한 채팅 → 미응답 집계 제외
            } else {
              totalMgrChats++;
              noReplyChats++;
            }
          }
          // else: 아직 영업시간 기준 1시간 미만 → 집계 제외
        }
      }
    });

    // Response time buckets
    var buckets = { under5: 0, under15: 0, under30: 0, under60: 0, over60: 0 };
    responseTimes.forEach(function(rt) {
      var min = rt / 60000;
      if (min <= 5) buckets.under5++;
      else if (min <= 15) buckets.under15++;
      else if (min <= 30) buckets.under30++;
      else if (min <= 60) buckets.under60++;
      else buckets.over60++;
    });

    var totalRT = responseTimes.length;
    var within30 = buckets.under5 + buckets.under15 + buckets.under30;
    var within30Rate = totalRT > 0 ? Math.round((within30 / totalRT) * 100) : 0;
    var avgRT = 0;
    if (totalRT > 0) { var sum = 0; responseTimes.forEach(function(t) { sum += t; }); avgRT = Math.round(sum / totalRT / 60000); }

    // 영업시간 기준 FRT 계산
    var bizResponseTimes = [];
    chatKeys.forEach(function(cid) {
      var chat = stats.chats[cid];
      if (chat.firstUserMsg && chat.firstUserMsg >= cutoffMs && chat.firstMgrReply) {
        var bizRT = bizHours.getBusinessHoursElapsedInHours(chat.firstUserMsg, chat.firstMgrReply) * 60;
        if (bizRT > 0 && bizRT < 1440) bizResponseTimes.push(bizRT);
      }
    });
    var bizBuckets = { under5: 0, under15: 0, under30: 0, under60: 0, over60: 0 };
    bizResponseTimes.forEach(function(rt) {
      if (rt <= 5) bizBuckets.under5++;
      else if (rt <= 15) bizBuckets.under15++;
      else if (rt <= 30) bizBuckets.under30++;
      else if (rt <= 60) bizBuckets.under60++;
      else bizBuckets.over60++;
    });
    var bizTotalRT = bizResponseTimes.length;
    var bizWithin30 = bizBuckets.under5 + bizBuckets.under15 + bizBuckets.under30;
    var bizWithin30Rate = bizTotalRT > 0 ? Math.round((bizWithin30 / bizTotalRT) * 100) : 0;
    var bizAvgRT = 0;
    if (bizTotalRT > 0) { var bizSum = 0; bizResponseTimes.forEach(function(t) { bizSum += t; }); bizAvgRT = Math.round(bizSum / bizTotalRT); }

    // 2. No-reply close rate
    var noReplyRate = totalMgrChats > 0 ? Math.round((noReplyChats / totalMgrChats) * 100) : 0;

    // 3. Repeat inquiry rate - from closed chats
    var repeatRate = 0;
    var repeatUsers = 0;
    var totalUsers = 0;
    try {
      var closedChats = await channeltalk.listUserChats('closed', 50);
      var chatList = closedChats.userChats || [];
      var userChatCount = {};
      chatList.forEach(function(c) {
        var uid = c.userId || c.memberId || '';
        if (uid) userChatCount[uid] = (userChatCount[uid] || 0) + 1;
      });
      totalUsers = Object.keys(userChatCount).length;
      repeatUsers = Object.keys(userChatCount).filter(function(u) { return userChatCount[u] >= 2; }).length;
      repeatRate = totalUsers > 0 ? Math.round((repeatUsers / totalUsers) * 100) : 0;
    } catch(e) { console.error('[CS Score] repeatInquiry(listUserChats) 실패 — 재문의율이 0으로 과소집계될 수 있음:', e.message); }

    // 4. Business hours coverage
    var aiConvFile = require('path').join(__dirname, '..', 'data', 'ai-conversations.json');
    var aiLogs = [];
    try { aiLogs = JSON.parse(fs.readFileSync(aiConvFile, 'utf8')); } catch(e) {}
    var cutoffDate = new Date(Date.now() - days * 86400000).toISOString().substring(0, 10);
    var recentLogs = aiLogs.filter(function(l) { return l.timestamp && l.timestamp.substring(0, 10) >= cutoffDate; });
    var bizHourMsgs = 0;
    var offHourMsgs = 0;
    recentLogs.forEach(function(l) {
      var msgDate = new Date(l.timestamp);
      if (bizHours.isBusinessHoursAt(msgDate)) bizHourMsgs++;
      else offHourMsgs++;
    });

    // 5. AI full resolution rate
    var aiResolved = recentLogs.filter(function(l) { return !l.escalated && l.type === 'ai_answer'; }).length;
    var aiTotal = recentLogs.filter(function(l) { return l.type === 'ai_answer'; }).length;
    var aiResolveRate = aiTotal > 0 ? Math.round((aiResolved / aiTotal) * 100) : 0;

    // 6. Per-manager response time
    var mgrRT = {};
    chatKeys.forEach(function(cid) {
      var chat = stats.chats[cid];
      if (chat.firstUserMsg && chat.firstMgrReply && chat.managerId && chat.firstUserMsg >= cutoffMs) {
        var mid = chat.managerId;
        if (!mgrRT[mid]) mgrRT[mid] = { times: [], under30: 0 };
        var rt = chat.firstMgrReply - chat.firstUserMsg;
        if (rt > 0 && rt < 86400000) {
          mgrRT[mid].times.push(rt);
          if (rt <= 1800000) mgrRT[mid].under30++;
        }
      }
    });

    var mgrRTSummary = [];
    Object.keys(mgrRT).forEach(function(mid) {
      var m = mgrRT[mid];
      var sum = 0; m.times.forEach(function(t) { sum += t; });
      mgrRTSummary.push({
        managerId: mid,
        avgMin: Math.round(sum / m.times.length / 60000),
        within30Rate: Math.round((m.under30 / m.times.length) * 100),
        samples: m.times.length
      });
    });

  // [2026-06-30] CES Data 블록 제거 — 인-챗 CES 종료. 폐기된 ces-results.json을 매 요청 읽고 cesAvg 계산하던 죽은 코드
  // (CES pillar는 이미 _components에서 제외됨, cesScoreVal도 미사용이라 함께 삭제).

  // === FCR Data ===
  var fcrData = { resolved: [], reopened: [] };
  try { fcrData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'fcr-tracker.json'), 'utf8')); } catch(e) {}
  var fcrCutoff = Date.now() - days * 86400000;
  var recentResolved = (fcrData.resolved || []).filter(function(r) { return r.timestamp >= fcrCutoff; });
  var recentReopened = (fcrData.reopened || []).filter(function(r) { return r.timestamp >= fcrCutoff; });
  var fcrRate = recentResolved.length > 0 ? Math.round((1 - recentReopened.length / recentResolved.length) * 100) : 0;

  // === Integrated CS Quality Score (5-point scale) ===
  // Weights: FRT 20%, FCR 25%, CSAT 20%, CES 15%, No-Reply 20%
  var frtScore = 0;
  if (within30Rate >= 80) frtScore = 5;
  else if (within30Rate >= 60) frtScore = 3.5;
  else if (within30Rate >= 40) frtScore = 2.5;
  else frtScore = 1.5;

  var bizFrtScore = 0;
  if (bizWithin30Rate >= 80) bizFrtScore = 5;
  else if (bizWithin30Rate >= 60) bizFrtScore = 3.5;
  else if (bizWithin30Rate >= 40) bizFrtScore = 2.5;
  else bizFrtScore = 1.5;

  var fcrScore = 0;
  var fcrSampleCount = recentResolved.length + recentReopened.length;
  if (fcrSampleCount < 10) {
    fcrScore = 2; // 데이터 부족 시 보수적 기본값
    console.log("[CS Score] FCR data insufficient:", fcrSampleCount, "samples (min 10) - using default 2.0");
  } else if (fcrRate >= 80) fcrScore = 5;
  else if (fcrRate >= 70) fcrScore = 4;
  else if (fcrRate >= 55) fcrScore = 3;
  else fcrScore = 2;

  // CSAT: [2026-06-30] 죽은 인-챗 csat-results.json(1~5) 대신 살아있는 웹설문 csat-feedback-v2.json(이진 만족/불만족) 사용.
  // 만족률(satisfied/total)을 1~5로 매핑(100%→5, 0%→1). days 윈도 필터. 데이터 없으면 2.5 기본값(저신뢰로 종합점수에서 제외).
  var csatScore = 2.5;
  var csatWindowCount = 0;
  var csatSatRate = null;
  try {
    var csatFb = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'csat-feedback-v2.json'), 'utf8'));
    var _csatCut = Date.now() - days * 86400000;
    var recentCSAT = (Array.isArray(csatFb) ? csatFb : []).filter(function(c) {
      var t = c.submittedAt ? new Date(c.submittedAt).getTime() : (typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp);
      return t >= _csatCut;
    });
    csatWindowCount = recentCSAT.length;
    if (csatWindowCount > 0) {
      var _csatSat = recentCSAT.filter(function(c) { return c.satisfied === true; }).length;
      csatSatRate = _csatSat / csatWindowCount;       // 0~1
      csatScore = 1 + csatSatRate * 4;                 // 1~5
    }
  } catch(e) {}
  if (csatWindowCount === 0) console.log('[CS Score] CSAT(web survey) no windowed data - using default 2.5');

  var noReplyScore = 0;
  if (noReplyRate <= 10) noReplyScore = 5;
  else if (noReplyRate <= 20) noReplyScore = 4;
  else if (noReplyRate <= 30) noReplyScore = 3;
  else noReplyScore = 1.5;


  // [검증] 표본 10건 미만이면 신뢰도 낮음 (기본값 대체 + 통계적으로 무의미한 소표본 모두 포함)
  var reliability = {
    fcrLowConfidence: fcrSampleCount < 10,
    csatLowConfidence: csatWindowCount < 10,
    fcrSamples: fcrSampleCount,
    csatSamples: csatWindowCount
  };
  reliability.needsVerification = reliability.fcrLowConfidence || reliability.csatLowConfidence;

  // [①③ 가중치 재정규화] 저표본 컴포넌트(FCR/CES/CSAT)는 종합점수에서 제외하고 남은 가중치로 재정규화.
  // [④] FRT는 영업시간 기준 점수(bizFrtScore)를 사용 (벽시계 frtScore는 breakdown에 참고용으로 남김).
  var _components = [
    { key: 'frt',     score: bizFrtScore,  weight: 0.20, lowConf: false },
    { key: 'fcr',     score: fcrScore,     weight: 0.25, lowConf: reliability.fcrLowConfidence },
    { key: 'csat',    score: csatScore,    weight: 0.20, lowConf: reliability.csatLowConfidence },
    { key: 'noReply', score: noReplyScore, weight: 0.20, lowConf: false }
    // [2026-06-30] CES pillar 제거 (인-챗 CES 종료) — 남은 가중치는 _trustedWeight로 자동 재정규화
  ];
  var _trusted = _components.filter(function(c) { return !c.lowConf; });
  var _trustedWeight = _trusted.reduce(function(s, c) { return s + c.weight; }, 0);
  var integratedScore = 0;
  if (_trustedWeight > 0) {
    integratedScore = _trusted.reduce(function(s, c) { return s + c.score * (c.weight / _trustedWeight); }, 0);
  }
  integratedScore = Math.round(integratedScore * 100) / 100;
  reliability.scoredComponents = _trusted.map(function(c) { return c.key; });
  reliability.excludedComponents = _components.filter(function(c) { return c.lowConf; }).map(function(c) { return c.key; });

    res.json({
      success: true,
      period: days + ' days',
      responseTime: {
        avgMinutes: avgRT,
        bizAvgMinutes: bizAvgRT,
        bizWithin30MinRate: bizWithin30Rate,
        bizDistribution: bizBuckets,
        within30MinRate: within30Rate,
        distribution: buckets,
        totalSamples: totalRT
      },
      noReplyClose: {
        rate: noReplyRate,
        count: noReplyChats,
        total: totalMgrChats
      },
      repeatInquiry: {
        rate: repeatRate,
        repeatUsers: repeatUsers,
        totalUsers: totalUsers
      },
      businessHours: {
        bizHour: bizHourMsgs,
        offHour: offHourMsgs,
        offHourRate: (bizHourMsgs + offHourMsgs) > 0 ? Math.round((offHourMsgs / (bizHourMsgs + offHourMsgs)) * 100) : 0
      },
      aiResolution: {
        rate: aiResolveRate,
        resolved: aiResolved,
        total: aiTotal
      },
      managerResponseTime: mgrRTSummary
    ,
      ces: { retired: true, totalResponses: 0 },
      fcr: { rate: fcrRate, resolved: recentResolved.length, reopened: recentReopened.length },
      csat: { satisfactionRate: csatSatRate !== null ? Math.round(csatSatRate * 100) : null, total: csatWindowCount },
      integratedScore: { score: integratedScore, breakdown: { frt: { score: frtScore, weight: 0.20, bizScore: bizFrtScore }, fcr: { score: fcrScore, weight: 0.25 }, csat: { score: csatScore, weight: 0.20 }, noReply: { score: noReplyScore, weight: 0.20 } }, target: 3.0 },
      reliability: reliability
  });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// [2026-06-30] 폐기된 /ces, /csat-feedback 라우트 삭제 — 각각 죽은 ces-results.json / 인-챗 csat-feedback.json 서빙, 대시보드 호출처 없음. 현 CSAT는 csat-v2-stats 사용.

// === Escalation Analysis API ===
router.get('/escalation-analysis', function(req, res) {
  try {
    var aiLog2 = require('../lib/ai-log');
    var days = parseInt(req.query.days) || 7;
    var cutoff = new Date(Date.now() - days * 86400000).toISOString();
    var all = aiLog2.getConversations(500, { escalated: true });
    var recent = all.filter(function(c) { return c.timestamp >= cutoff; });
    var categories = {};
    var examples = {};
    recent.forEach(function(c) {
      var msg = (c.userMessage || '').toLowerCase();
      var cat = 'other';
      // 0. 인사/감사/확인 메시지 → 제외
      if (msg.indexOf('了解') > -1 && msg.indexOf('謝謝') > -1) cat = 'greeting';
      else if (msg.indexOf('好的') > -1 && msg.indexOf('了解') > -1 && msg.length < 40) cat = 'greeting';
      else if (/^\[image/i.test(msg.trim()) || msg.indexOf('從我的iphone') > -1 || msg.indexOf('mail.channel.io') > -1) cat = 'greeting';
      // 1. 상담사 직접 요청 (가장 먼저 - 단순 "客服" 한마디)
      if (/^客服$|^상담사$|^상담원$|^真人$|^人工$/i.test(msg.trim())) cat = 'agent_direct';
      // 2. 주문 상태/추적 (번호 입력 포함)
      else if (msg.indexOf('訂單') > -1 || msg.indexOf('주문') > -1 || msg.indexOf('進度') > -1 || msg.indexOf('狀態') > -1 || /\d{10,}/.test(msg) || /\d{8}(tw|hk)\d+/i.test(msg) || /^(tw|hk)?\d{6,}$/i.test(msg.trim()) || msg.indexOf('多久') > -1 || msg.indexOf('等了') > -1 || msg.indexOf('天了') > -1 || msg.indexOf('幾天') > -1 || msg.indexOf('update') > -1 || msg.indexOf('一個禮拜') > -1 || msg.indexOf('這三筆') > -1 || msg.indexOf('這筆') > -1 || msg.indexOf('那筆') > -1 || msg.indexOf('還沒到') > -1 || msg.indexOf('沒到') > -1 || msg.indexOf('過期') > -1 || msg.indexOf('馬上下單') > -1 || msg.indexOf('查詢都') > -1) cat = 'order_status';
      // 3. 배송/물류
      else if (msg.indexOf('배송') > -1 || msg.indexOf('物流') > -1 || msg.indexOf('配送') > -1 || msg.indexOf('出貨') > -1 || msg.indexOf('發貨') > -1 || msg.indexOf('寄出') > -1 || msg.indexOf('到貨') > -1 || msg.indexOf('快遞') > -1 || msg.indexOf('順豐') > -1 || msg.indexOf('택배') > -1 || msg.indexOf('도착') > -1 || msg.indexOf('집운') > -1 || msg.indexOf('集運') > -1 || msg.indexOf('貨') > -1 || msg.indexOf('還要多久') > -1 || msg.indexOf('禮拜') > -1 || msg.indexOf('包裹') > -1) cat = 'shipping';
      // 4. 국제배송비/운임
      else if (msg.indexOf('國際運費') > -1 || msg.indexOf('운비') > -1 || msg.indexOf('배송비') > -1 || msg.indexOf('運費') > -1 || msg.indexOf('관세') > -1 || msg.indexOf('稅') > -1 || msg.indexOf('報關') > -1 || msg.indexOf('海關') > -1 || msg.indexOf('관부가세') > -1 || msg.indexOf('多收費') > -1 || msg.indexOf('再退') > -1 || msg.indexOf('65元') > -1 || msg.indexOf('重量') > -1) cat = 'shipping_fee';
      // 5. 취소/환불/반품
      else if (msg.indexOf('취소') > -1 || msg.indexOf('取消') > -1 || msg.indexOf('退款') > -1 || msg.indexOf('退貨') > -1 || msg.indexOf('환불') > -1 || msg.indexOf('반품') > -1 || msg.indexOf('不要了') > -1 || msg.indexOf('先不要發貨') > -1) cat = 'cancel_refund';
      // 6. 결제/금액
      else if (msg.indexOf('결제') > -1 || msg.indexOf('付款') > -1 || msg.indexOf('刷卡') > -1 || msg.indexOf('金額') > -1 || msg.indexOf('價') > -1 || msg.indexOf('元') > -1 || msg.indexOf('費用') > -1 || msg.indexOf('報價') > -1 || msg.indexOf('얼마') > -1 || msg.indexOf('多少') > -1 || msg.indexOf('優惠碼') > -1 || msg.indexOf('tappay') > -1 || msg.indexOf('얼마') > -1) cat = 'payment';
      // 7. 상품문의/불량/교환
      else if (msg.indexOf('商品') > -1 || msg.indexOf('상품') > -1 || msg.indexOf('壞') > -1 || msg.indexOf('不能用') > -1 || msg.indexOf('損') > -1 || msg.indexOf('瑕疵') > -1 || msg.indexOf('品質') > -1 || msg.indexOf('색상') > -1 || msg.indexOf('色差') > -1 || msg.indexOf('換貨') > -1 || msg.indexOf('교환') > -1 || msg.indexOf('包包') > -1 || msg.indexOf('사이즈') > -1 || msg.indexOf('찾') > -1 || msg.indexOf('找') > -1 || msg.indexOf('有賣') > -1 || msg.indexOf('壞掉') > -1 || msg.indexOf('記憶卡') > -1 || msg.indexOf('相機') > -1 || msg.indexOf('受損') > -1 || msg.indexOf('變形') > -1 || msg.indexOf('檢查') > -1 || msg.indexOf('這款') > -1 || msg.indexOf('開箱') > -1 || msg.indexOf('影片') > -1 || msg.indexOf('玩具') > -1 || msg.indexOf('娃娃') > -1 || msg.indexOf('還有') > -1 || /^品$/.test(msg.trim())) cat = 'product';
      // 8. 계정/로그인/회원정보
      else if (msg.indexOf('登') > -1 || msg.indexOf('帳號') > -1 || msg.indexOf('會員') > -1 || msg.indexOf('계정') > -1 || msg.indexOf('密碼') > -1 || msg.indexOf('信箱') > -1 || msg.indexOf('email') > -1 || msg.indexOf('이메일') > -1 || msg.indexOf('修改') > -1 || msg.indexOf('填錯') > -1 || msg.indexOf('註冊') > -1 || msg.indexOf('登不了') > -1 || msg.indexOf('ez way') > -1 || msg.indexOf('ezway') > -1 || msg.indexOf('申報') > -1) cat = 'account';
      // 9. 사이트 이용/주문방법
      else if (msg.indexOf('下訂') > -1 || msg.indexOf('無法') > -1 || msg.indexOf('怎麼') > -1 || msg.indexOf('如何') > -1 || msg.indexOf('방법') > -1 || msg.indexOf('使用') > -1 || msg.indexOf('操作') > -1 || msg.indexOf('어떻게') > -1 || msg.indexOf('顯示') > -1 || msg.indexOf('何時會改') > -1 || msg.indexOf('無法下訂') > -1 || msg.indexOf('看不懂') > -1 || msg.indexOf('可以嗎') > -1 || msg.indexOf('辦法') > -1 || msg.indexOf('何時') > -1 || msg.indexOf('買不到') > -1) cat = 'how_to';
      // 10. 클레임/불만
      else if (msg.indexOf('多收') > -1 || msg.indexOf('多收錢') > -1 || msg.indexOf('沒有處理') > -1 || msg.indexOf('不合理') > -1 || msg.indexOf('受害者') > -1 || msg.indexOf('處理問題') > -1 || msg.indexOf('不智能') > -1 || msg.indexOf('傻眼') > -1 || msg.indexOf('混亂') > -1 || msg.indexOf('離譜') > -1 || msg.indexOf('被騙') > -1 || msg.indexOf('不太對') > -1) cat = 'complaint';
      // 11. 상담사 연결 요청 (문장 속 客服)
      else if (msg.indexOf('客服') > -1 || msg.indexOf('真人') > -1 || msg.indexOf('상담') > -1 || msg.indexOf('人工') > -1 || msg.indexOf('幫我') > -1 || msg.indexOf('客房') > -1 || msg.indexOf('轉做') > -1 || msg.indexOf('麻煩轉') > -1) cat = 'agent_request';
      categories[cat] = (categories[cat] || 0) + 1;
      if (!examples[cat]) examples[cat] = [];
      if (examples[cat].length < 3) examples[cat].push((c.userMessage || '').substring(0, 80));
    });
    var sorted = Object.keys(categories).sort(function(a,b) { return categories[b] - categories[a]; });
    var result = sorted.map(function(cat) { return { category: cat, count: categories[cat], examples: examples[cat] }; });
    // 에스컬레이션 사유별 집계 (카테고리 기반으로 통합)
    var reasonCounts = {};
    sorted.forEach(function(cat) {
      var nameMap = {
        agent_direct: '직접요청',
        order_status: '주문조회',
        shipping: '배송/물류',
        shipping_fee: '국제운임',
        cancel_refund: '취소/환불',
        payment: '결제/금액',
        product: '상품문의',
        account: '계정/회원',
        how_to: '이용방법',
        agent_request: '상담사전환',
        complaint: '클레임/불만',
        other: '기타'
      };
      if (cat !== 'greeting') reasonCounts[nameMap[cat] || cat] = categories[cat];
    });
    var escalationRate = 0;
    try {
      var aiLog3 = require('../lib/ai-log');
      var allConvs = aiLog3.getConversations(500);
      var recentAll = allConvs.filter(function(c) { return c.timestamp >= cutoff; });
      if (recentAll.length > 0) escalationRate = Math.round((recent.length / recentAll.length) * 100);
    } catch(er) {}
    res.json({ success: true, period: days + ' days', total: recent.length, totalEscalated: recent.length, totalEscalations: recent.length, escalatedRate: escalationRate, escalationRate: escalationRate, reasons: reasonCounts, categories: result });
  } catch(e) { res.json({ success: false, error: e.message }); }
});


// CS Score 일일 트렌드 API
router.get('/cs-score-trend', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const historyFile = path.join(__dirname, '../data/cs-score-history.json');
    let history = [];
    if (fs.existsSync(historyFile)) {
      history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    }
    
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const filtered = history.filter(h => new Date(h.date) >= cutoff);
    
    // 트렌드 분석
    let trend = 'stable';
    if (filtered.length >= 3) {
      const recent3 = filtered.slice(-3);
      const first = recent3[0].score;
      const last = recent3[recent3.length - 1].score;
      if (last - first > 0.2) trend = 'improving';
      else if (first - last > 0.2) trend = 'declining';
    }
    
    // 목표 도달 예측
    const target = 3.0;
    let estimatedDaysToTarget = null;
    if (filtered.length >= 2) {
      const oldest = filtered[0];
      const newest = filtered[filtered.length - 1];
      const daysDiff = (new Date(newest.date) - new Date(oldest.date)) / (1000 * 60 * 60 * 24);
      const scoreDiff = newest.score - oldest.score;
      if (daysDiff > 0 && scoreDiff > 0) {
        const dailyRate = scoreDiff / daysDiff;
        const remaining = target - newest.score;
        if (remaining > 0) {
          estimatedDaysToTarget = Math.ceil(remaining / dailyRate);
        } else {
          estimatedDaysToTarget = 0;
        }
      }
    }
    
    res.json({
      success: true,
      trend,
      target,
      estimatedDaysToTarget,
      currentScore: filtered.length > 0 ? filtered[filtered.length - 1].score : null,
      dataPoints: filtered.length,
      history: filtered
    });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// 주간 사업 지표 API  
router.get('/business-metrics', (req, res) => {
  try {
    const weeks = parseInt(req.query.weeks) || 12;
    const bizFile = path.join(__dirname, '../data/business-metrics.json');
    let bizData = [];
    if (fs.existsSync(bizFile)) {
      bizData = JSON.parse(fs.readFileSync(bizFile, 'utf8'));
    }
    
    const filtered = bizData.slice(-weeks);
    
    res.json({
      success: true,
      totalWeeks: filtered.length,
      metrics: filtered
    });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// 에스컬레이션 기반 FAQ 추천 API
router.get('/faq-recommendations', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const logFile = path.join(__dirname, '../data/ai-conversations.json');
    let logs = [];
    if (fs.existsSync(logFile)) {
      logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }
    
    // [2026-06-30] ai-conversations의 timestamp는 ISO 문자열인데 숫자 cutoff와 비교해 항상 false → 패널 영구 빈값.
    // escalation-analysis(정상 동작)와 동일하게 ISO 문자열 cutoff로 비교.
    const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
    const recent = logs.filter(l => l.timestamp > cutoff && l.escalated);
    
    // 에스컬레이션 질문을 카테고리별로 분류
    const categories = {};
    const keywords = {
      order_status: ['訂單', '주문', '進度', '狀態', '多久', '等了', '天了', '幾天', 'update', 'order', '조회'],
      shipping: ['배송', '운송', '택배', '寄', '到貨', '물류', 'delivery', 'ship', '發貨', '出貨', '配送', '快遞', '集運', '집운'],
      shipping_fee: ['國際運費', '운비', '배송비', '運費', '관세', '稅', '報關', '海關', '관부가세'],
      cancel_refund: ['환불', '취소', '退款', '取消', 'refund', 'cancel', '退貨', '반품', '不要了'],
      payment: ['결제', '카드', 'PayPal', '付款', '支付', 'payment', '입금', '刷卡', '金額', '報價', '얼마', '多少'],
      product: ['상품', '사이즈', '色', '商品', 'product', 'size', '品質', '壞', '不能用', '瑕疵', '교환', '換貨', '包包', '찾'],
      account: ['帳號', '會員', '계정', '密碼', '信箱', 'email', '이메일', '登', '修改'],
      how_to: ['下訂', '無法', '怎麼', '如何', '방법', '使用', '操作', '어떻게'],
      customs: ['통관', '관세', '세관', '報關', 'EZ', 'customs'],
      agent_request: ['客服', '真人', '상담', '人工', '幫我']
    };
    
    recent.forEach(log => {
      const q = (log.userMessage || '').toLowerCase();
      let matched = false;
      for (const [cat, kws] of Object.entries(keywords)) {
        if (kws.some(kw => q.includes(kw.toLowerCase()))) {
          if (!categories[cat]) categories[cat] = { count: 0, examples: [] };
          categories[cat].count++;
          if (categories[cat].examples.length < 3) {
            categories[cat].examples.push(log.userMessage);
          }
          matched = true;
          break;
        }
      }
      if (!matched) {
        if (!categories['other']) categories['other'] = { count: 0, examples: [] };
        categories['other'].count++;
        if (categories['other'].examples.length < 3) {
          categories['other'].examples.push(log.userMessage);
        }
      }
    });
    
    // 우선순위 정렬
    const sorted = Object.entries(categories)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([cat, data]) => ({ category: cat, ...data }));
    
    // FAQ 추천 생성
    const recommendations = sorted.slice(0, 5).map(cat => ({
      category: cat.category,
      escalationCount: cat.count,
      sampleQuestions: cat.examples,
      recommendation: `${cat.category} 관련 FAQ ${cat.count}건 에스컬레이션 발생. 구어체 변형 추가 권장.`
    }));
    
    res.json({
      success: true,
      period: days + ' days',
      totalEscalations: recent.length,
      recommendations
    });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});



// 데이터 축적 상태 모니터링 API
router.get('/data-health', (req, res) => {
  try {
    var checks = {};
    
    // CSAT 데이터 상태 [2026-06-30] 살아있는 웹설문 csat-feedback-v2.json 기준 (죽은 인-챗 csat-results.json 아님 → 영구 오경보 제거)
    var csatFile = path.join(__dirname, '../data/csat-feedback-v2.json');
    var csatData = [];
    if (fs.existsSync(csatFile)) { try { csatData = JSON.parse(fs.readFileSync(csatFile, 'utf8')); } catch(e) {} }
    if (!Array.isArray(csatData)) csatData = [];
    var _csat7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
    var csatRecent = csatData.filter(function(c) {
      var t = c.submittedAt ? new Date(c.submittedAt).getTime() : (typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp);
      return t > _csat7d;
    });
    checks.csat = {
      total: csatData.length,
      last7days: csatRecent.length,
      sufficient: csatRecent.length >= 10,
      target: 10,
      status: csatRecent.length >= 10 ? 'OK' : csatRecent.length >= 5 ? 'PARTIAL' : 'INSUFFICIENT'
    };
    
    // [2026-06-30] CES 데이터 헬스체크 제거 — 인-챗 CES 종료 (영구 INSUFFICIENT 오경보 원인)

    // FCR 데이터 상태
    var fcrFile = path.join(__dirname, '../data/fcr-tracker.json');
    var fcrData = { resolved: [], reopened: [] };
    if (fs.existsSync(fcrFile)) { try { fcrData = JSON.parse(fs.readFileSync(fcrFile, 'utf8')); } catch(e) {} }
    checks.fcr = {
      resolved: (fcrData.resolved || []).length,
      reopened: (fcrData.reopened || []).length,
      sufficient: (fcrData.resolved || []).length >= 10,
      target: 10,
      status: (fcrData.resolved || []).length >= 10 ? 'OK' : (fcrData.resolved || []).length >= 3 ? 'PARTIAL' : 'INSUFFICIENT'
    };
    
    // CS Score History
    var histFile = path.join(__dirname, '../data/cs-score-history.json');
    var histData = [];
    if (fs.existsSync(histFile)) { try { histData = JSON.parse(fs.readFileSync(histFile, 'utf8')); } catch(e) {} }
    checks.scoreHistory = {
      dataPoints: histData.length,
      sufficient: histData.length >= 7,
      target: 7,
      status: histData.length >= 7 ? 'OK' : histData.length >= 3 ? 'PARTIAL' : 'INSUFFICIENT',
      latestScore: histData.length > 0 ? histData[histData.length - 1].score : null,
      latestDate: histData.length > 0 ? histData[histData.length - 1].date : null
    };
    
    // AI 대화 로그
    var aiFile = path.join(__dirname, '../data/ai-conversations.json');
    var aiData = [];
    if (fs.existsSync(aiFile)) { try { aiData = JSON.parse(fs.readFileSync(aiFile, 'utf8')); } catch(e) {} }
    var aiRecent = aiData.filter(function(a) { 
      var ts = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      return ts > Date.now() - 7 * 24 * 60 * 60 * 1000; 
    });
    var escalatedRecent = aiRecent.filter(function(a) { return a.escalated; });
    checks.aiConversations = {
      total: aiData.length,
      last7days: aiRecent.length,
      escalated7days: escalatedRecent.length,
      escalationRate: aiRecent.length > 0 ? Math.round(escalatedRecent.length / aiRecent.length * 100) : 0
    };
    
    // [2026-06-30] checks.csatFeedback 제거 — 폐기된 인-챗 csat-feedback.json을 읽던 죽은 체크(미렌더, overallStatus에도 미포함)

    // 전체 상태 판단
    var allStatuses = [checks.csat.status, checks.fcr.status, checks.scoreHistory.status];
    var overallStatus = allStatuses.every(function(s) { return s === 'OK'; }) ? 'HEALTHY' :
                        allStatuses.some(function(s) { return s === 'OK'; }) ? 'PARTIAL' : 'NEEDS_DATA';
    
    // 추천 액션
    var recommendations = [];
    if (checks.csat.status !== 'OK') recommendations.push('CSAT(웹 설문) 응답 ' + checks.csat.target + '건 목표 대비 7일 ' + checks.csat.last7days + '건 - 설문 응답률 개선 필요');
    if (checks.fcr.status !== 'OK') recommendations.push('FCR resolved ' + checks.fcr.target + '건 목표 대비 ' + checks.fcr.resolved + '건 - 채팅 종료 시 FCR 기록 확인');
    if (checks.aiConversations.escalationRate > 40) recommendations.push('에스컬레이션율 ' + checks.aiConversations.escalationRate + '% - FAQ 보강 또는 AI confidence 개선 필요');
    
    res.json({
      success: true,
      overallStatus: overallStatus,
      checks: checks,
      recommendations: recommendations,
      timestamp: new Date().toISOString()
    });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});



// FAQ 강화 후보 조회
router.get('/faq-candidates', function(req, res) {
  try {
    var faqQueue = require('../lib/faq-queue');
    faqQueue.updateCandidates();
    var queue = faqQueue.loadQueue();
    var pending = queue.candidates.filter(function(c) { return c.status === 'pending'; });
    
    // 사유별 그룹핑
    var byReason = {};
    pending.forEach(function(c) {
      var r = c.escalationReason || 'unclassified';
      if (!byReason[r]) byReason[r] = { count: 0, samples: [] };
      byReason[r].count++;
      if (byReason[r].samples.length < 3) {
        byReason[r].samples.push({ message: c.userMessage, lang: c.lang, keywords: c.keywords });
      }
    });

    // 키워드 빈도
    var kwFreq = {};
    pending.forEach(function(c) {
      (c.keywords || []).forEach(function(kw) { kwFreq[kw] = (kwFreq[kw] || 0) + 1; });
    });

    res.json({
      success: true,
      totalPending: pending.length,
      lastUpdated: queue.lastUpdated,
      byReason: byReason,
      topKeywords: Object.entries(kwFreq).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 20),
      candidates: pending.slice(0, 50)
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 일일 리포트 수동 실행
router.get('/daily-report', async function(req, res) {
  try {
    var dailyReport = require('../lib/daily-report');
    var result = dailyReport.generateDailyReport();
    res.json({ success: true, report: result.report, stats: result.stats });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 일일 리포트 발송 (수동)
router.post('/send-daily-report', async function(req, res) {
  try {
    var dailyReport = require('../lib/daily-report');
    var result = await dailyReport.sendDailyReport();
    res.json({ success: true, stats: result ? result.stats : null });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});



// === AI 자동 업그레이드 API ===
router.get('/auto-upgrade/status', async function(req, res) {
  try {
    var analysis = autoUpgrade.analyzeConfidenceDistribution();
    var faqQueue = require('../lib/faq-queue');
    var queue = faqQueue.loadQueue();
    var pending = (queue.candidates || []).filter(function(c) { return c.status === 'pending'; }).length;
    var added = (queue.candidates || []).filter(function(c) { return c.status === 'added'; }).length;
    res.json({ success: true, pendingCandidates: pending, processedCandidates: added, confidenceAnalysis: analysis });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

router.post('/auto-upgrade/run', async function(req, res) {
  try {
    var result = await autoUpgrade.runAutoUpgrade();
    res.json({ success: true, result: result });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

router.get('/auto-upgrade/report', function(req, res) {
  try {
    var report = autoUpgrade.generateUpgradeReport();
    res.json({ success: true, report: report });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});


// TEMP: file upload endpoint
router.post('/upload-file', function(req, res) {
  var chunks = [];
  req.on('data', function(c) { chunks.push(c); });
  req.on('end', function() {
    var buf = Buffer.concat(chunks);
    require('fs').writeFileSync(require('path').join(__dirname, '..', 'data', 'export.xlsx'), buf);
    res.json({ success: true, bytes: buf.length });
    console.log('[UPLOAD] File saved:', buf.length, 'bytes');
  });
});


// 미응답 opened 채팅 목록
router.get('/unreplied-chats', async function(req, res) {
  // 캐시 체크
  var forceRefresh = req.query.refresh === 'true';
  if (!forceRefresh && unrepliedCache.data && (Date.now() - unrepliedCache.timestamp) < UNREPLIED_CACHE_TTL) {
    return res.json(unrepliedCache.data);
  }

  try {
    var https = require('https');
    var results = [];
    var states = ['opened'];
    
    function fetchChats(state, after) {
      return new Promise(function(resolve, reject) {
        var path = '/open/v5/user-chats?limit=50&sortOrder=desc&state=' + state + (after ? '&after=' + after : '');
        https.get({
          hostname: 'api.channel.io',
          path: path,
          headers: {
            'x-access-key': process.env.CHANNEL_ACCESS_KEY || '69d224cf1096da048a55',
            'x-access-secret': process.env.CHANNEL_ACCESS_SECRET || '4c6c9ab20f5be3dd319eec0a8d583c93'
          }
        }, function(r) {
          var b = '';
          r.on('data', function(d) { b += d; });
          r.on('end', function() {
            try { resolve(JSON.parse(b)); } catch(e) { reject(e); }
          });
        }).on('error', reject);
      });
    }

    function fetchMessages(chatId) {
      return new Promise(function(resolve, reject) {
        https.get({
          hostname: 'api.channel.io',
          path: '/open/v5/user-chats/' + chatId + '/messages?limit=20&sortOrder=desc',
          headers: {
            'x-access-key': process.env.CHANNEL_ACCESS_KEY || '69d224cf1096da048a55',
            'x-access-secret': process.env.CHANNEL_ACCESS_SECRET || '4c6c9ab20f5be3dd319eec0a8d583c93'
          }
        }, function(r) {
          var b = '';
          r.on('data', function(d) { b += d; });
          r.on('end', function() {
            try { resolve(JSON.parse(b)); } catch(e) { reject(e); }
          });
        }).on('error', reject);
      });
    }


    function fetchChats2(state2, after2) {
      return new Promise(function(resolve, reject) {
        var path2 = '/open/v5/user-chats?limit=50&sortOrder=desc&state=' + state2 + (after2 ? '&after=' + after2 : '');
        https.get({
          hostname: 'api.channel.io',
          path: path2,
          headers: {
            'x-access-key': process.env.CHANNEL_ACCESS_KEY || '69d224cf1096da048a55',
            'x-access-secret': process.env.CHANNEL_ACCESS_SECRET || '4c6c9ab20f5be3dd319eec0a8d583c93'
          }
        }, function(r) {
          var b = '';
          r.on('data', function(d) { b += d; });
          r.on('end', function() {
            try { resolve(JSON.parse(b)); } catch(e) { reject(e); }
          });
        }).on('error', reject);
      });
    }

    // opened 채팅 수집 (최대 200건)
    var allChats = [];
    var after = null;
    for (var page = 0; page < 4; page++) {
      var data = await fetchChats('opened', after);
      var chats = data.userChats || [];
      allChats = allChats.concat(chats);
      if (chats.length < 50 || !data.next) break;
      after = data.next;
      await new Promise(function(r) { setTimeout(r, 200); });
    }

    // 각 채팅의 마지막 메시지 확인
    var unreplied = [];
    for (var i = 0; i < allChats.length; i++) {
      var chat = allChats[i];
      // 에스컬레이션 건도 체크하기 위해 조건 완화
      // if (!chat.userLastMessageId) continue;

      try {
        var msgData = await fetchMessages(chat.id);
        await new Promise(function(r) { setTimeout(r, 100); });
        var msgs = msgData.messages || [];
        if (msgs.length === 0) continue;

        // 봇 시스템 메시지(CSAT, 대기안내 등) 건너뛰고 실제 마지막 메시지 찾기
        var systemKW = ["想聽聽您的寶貴意見","滿意度","服務體驗","만족도","satisfaction","稍等","請稍候","感謝您的耐心","48小時","48시간"];
        var lastMsg = null;
        var lastPersonType = "";
        for (var mi = 0; mi < msgs.length; mi++) {
          var mm = msgs[mi];
          if (mm.personType === "bot") {
            var bTxt = "";
            if (mm.blocks && mm.blocks.length > 0) { bTxt = mm.blocks.map(function(bl){ return bl.value || ""; }).join(" "); }
            else if (mm.plainText) { bTxt = String(mm.plainText); }
            var isSys = systemKW.some(function(kw){ return bTxt.indexOf(kw) >= 0; });
            if (isSys) continue;
          }
          lastMsg = mm;
          lastPersonType = mm.personType || "";
          break;
        }
        if (!lastMsg) { lastMsg = msgs[0]; lastPersonType = lastMsg.personType || ""; }

        // === 봇 해결 완료 → 미응답 제외 (chat-resolver) ===
        var _resolved2 = chatResolver.isChatResolved(msgs);
        if (_resolved2.resolved) {
          // CSAT 숫자, 감사 메시지, 봇 답변 후 추가 문의 없음 → skip
          continue;
        }

        // === 미응답 판단 로직 (확장) ===
        var isUnreplied = false;
        var unrepliedType = "";

        // 케이스1: 마지막 실제 메시지가 고객
        if (lastPersonType === "user" || lastPersonType === "endUser") {
          isUnreplied = true;
          unrepliedType = "no_response";
        }
        // 케이스2: 봇이 에스컬레이션 안내 후 매니저 미응답
        else if (lastPersonType === "bot") {
          var botText2 = "";
          if (lastMsg.blocks && lastMsg.blocks.length > 0) { botText2 = lastMsg.blocks.map(function(bl){ return bl.value || ""; }).join(" "); }
          else if (lastMsg.plainText) { botText2 = String(lastMsg.plainText); }
          var escKW = ["轉接客服","轉接","客服人員","確認一下","先為您轉接","담당자","연결해","connect you","support team","正在為您轉接","幫您確認"];
          var hasEsc = escKW.some(function(kw){ return botText2.indexOf(kw) >= 0; });
          var hasMgr = msgs.some(function(m){ return m.personType === "manager"; });
          if (hasEsc && !hasMgr) {
            isUnreplied = true;
            unrepliedType = "escalation_pending";
          }
        }
        
        if (isUnreplied) {
          var text = '';
          if (lastMsg.blocks && lastMsg.blocks.length > 0) {
            text = lastMsg.blocks.map(function(bl) { return bl.value || ''; }).join(' ').substring(0, 150);
          } else if (lastMsg.plainText) {
            text = String(lastMsg.plainText).substring(0, 150);
          }

          var waitMinutes = Math.round((Date.now() - (lastMsg.createdAt || chat.updatedAt || Date.now())) / 60000);

          unreplied.push({
            chatId: chat.id,
            name: chat.name || '(이름없음)',
            state: chat.state,
            assigneeId: chat.assigneeId || null,
            unrepliedType: unrepliedType || 'no_response',
            lastUserMessage: text || '(이미지/스티커)',
            lastMessageTime: new Date(lastMsg.createdAt || chat.updatedAt).toISOString(),
            waitingMinutes: waitMinutes,
            waitingHours: Math.round(waitMinutes / 60 * 10) / 10,
            createdAt: new Date(chat.createdAt).toISOString(),
            priority: chat.priority || 'medium',
            page: chat.source ? chat.source.url : ''
          });
        }
      } catch(e) { /* skip */ }

      if (i % 10 === 9) await new Promise(function(r) { setTimeout(r, 50); });
    }

    // 대기시간 순 정렬 (오래 기다린 순)
    // 중복 제거
var seen = {};

    // === 방치 자동종료 건 수집 (매니저 미응답 포함) ===
    try {
      var closedChats = [];
      var closedAfter = null;
      for (var cp = 0; cp < 3; cp++) {
        var cData = await fetchChats2('closed', closedAfter);
        var cList = cData.userChats || [];
        closedChats = closedChats.concat(cList);
        if (cList.length < 50 || !cData.next) break;
        closedAfter = cData.next;
        await new Promise(function(r) { setTimeout(r, 200); });
      }
      // 최근 7일 내 종료건만
      var sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      closedChats = closedChats.filter(function(c) { return (c.updatedAt || 0) > sevenDaysAgo; });

      for (var ci = 0; ci < closedChats.length; ci++) {
        var cc = closedChats[ci];
        try {
          var cmData = await fetchMessages(cc.id);
          var cMsgs = cmData.messages || [];
          if (cMsgs.length === 0) continue;

          // 매니저가 한 번이라도 응답했는지 (봇 제외)
          var hasRealManagerMsg = false;
          var lastRealMgrTime = 0;
          var lastUserTime = 0;
          var lastUserMsg = null;
          
          for (var cj = 0; cj < cMsgs.length; cj++) {
            var cm = cMsgs[cj];
            // 실제 매니저 (봇 아닌)
            if (cm.personType === 'manager' && !cm.botId) {
              hasRealManagerMsg = true;
              if (cm.createdAt > lastRealMgrTime) lastRealMgrTime = cm.createdAt;
            }
            // 고객 메시지
            if (cm.personType === 'user' || cm.personType === 'endUser') {
              if (cm.createdAt > lastUserTime) {
                lastUserTime = cm.createdAt;
                lastUserMsg = cm;
              }
            }
          }
          
          if (!lastUserMsg) continue; // 고객 메시지 없으면 스킵

          // 봇 해결 완료 → 방치종료 미응답에서 제외
          var _allMsgs3 = msgs || [];
          var _resolved3 = chatResolver.isChatResolved(_allMsgs3);
          if (_resolved3.resolved) { continue; }

          var shouldAdd = false;
          var customerLeftHanging = false;
          
          if (!hasRealManagerMsg) {
            // 케이스1: 실제 매니저 응답 없음 (봇만 응답)
            shouldAdd = true;
          } else if (lastUserTime > lastRealMgrTime) {
            // 케이스2: 매니저 응답 있지만, 고객이 그 후 추가 질문 → 미응답
            shouldAdd = true;
            customerLeftHanging = true;
          }

          if (shouldAdd) {
            var cText2 = '';
            if (lastUserMsg.blocks && lastUserMsg.blocks.length > 0) {
              cText2 = lastUserMsg.blocks.map(function(bl){return bl.value||'';}).join(' ').substring(0, 150);
            } else if (lastUserMsg.plainText) {
              cText2 = String(lastUserMsg.plainText).substring(0, 150);
            }

            var customerMsgTime = lastUserMsg.createdAt || cc.openedAt;
            var closeTime = cc.closedAt || cc.updatedAt;
            var waitMin = Math.round((closeTime - customerMsgTime) / 60000);

            unreplied.push({
              chatId: cc.id,
              name: cc.name || '(이름없음)',
              state: 'closed',
              unrepliedType: 'abandoned_closed',
              subType: customerLeftHanging ? '추가질문미응답' : '매니저응답없음',
              noManagerReply: !hasRealManagerMsg,
              customerLeftHanging: customerLeftHanging,
              assigneeId: cc.assigneeId || null,
              lastUserMessage: cText2 || '(이미지/스티커)',
              lastMessageTime: new Date(customerMsgTime).toISOString(),
              waitingMinutes: waitMin,
              waitingHours: Math.round(waitMin / 60 * 10) / 10,
              createdAt: new Date(cc.createdAt).toISOString(),
              closedAt: new Date(closeTime).toISOString(),
              priority: !hasRealManagerMsg ? 'critical' : 'high',
              page: cc.source ? cc.source.url : ''
            });
          }

          if (ci % 10 === 9) await new Promise(function(r) { setTimeout(r, 50); });
        } catch(e) {}
      }
      console.log('[Unreplied] Found', closedChats.length, 'recent closed chats, abandoned:', unreplied.filter(function(u){return u.unrepliedType==='abandoned_closed';}).length);
    } catch(abandonErr) {
      console.error('[Unreplied] Abandoned closed scan error:', abandonErr.message);
    }

unreplied = unreplied.filter(function(u) { if (seen[u.chatId]) return false; seen[u.chatId] = true; return true; });
unreplied.sort(function(a, b) { return b.waitingMinutes - a.waitingMinutes; });

    // 매니저 매핑
    var mgrMap = {};
    try {
      var mgrData = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'data', 'managers.json'), 'utf8'));
      if (Array.isArray(mgrData)) {
        mgrData.forEach(function(m) { mgrMap[m.id] = m.email ? m.email.split('@')[0] : m.name; });
      }
    } catch(e) {}

    unreplied.forEach(function(u) {
      u.assigneeName = mgrMap[u.assigneeId] || u.assigneeId || '미배정';
      // 긴급도
      if (u.waitingMinutes > 1440) u.urgency = 'critical';
      else if (u.waitingMinutes > 480) u.urgency = 'high';
      else if (u.waitingMinutes > 120) u.urgency = 'medium';
      else u.urgency = 'low';
    });

    var _unrepliedResp = {
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        totalOpened: allChats.length,
        unreplied: unreplied.length,
        critical: unreplied.filter(function(u) { return u.urgency === 'critical'; }).length,
        high: unreplied.filter(function(u) { return u.urgency === 'high'; }).length,
        medium: unreplied.filter(function(u) { return u.urgency === 'medium'; }).length,
        low: unreplied.filter(function(u) { return u.urgency === 'low'; }).length,
        escalationPending: unreplied.filter(function(u) { return u.unrepliedType === 'escalation_pending'; }).length,
        noResponse: unreplied.filter(function(u) { return u.unrepliedType === 'no_response'; }).length,
        abandonedClosed: unreplied.filter(function(u) { return u.unrepliedType === 'abandoned_closed'; }).length,
        avgWaitHours: unreplied.length > 0 ? Math.round(unreplied.reduce(function(s, u) { return s + u.waitingHours; }, 0) / unreplied.length * 10) / 10 : 0
      },
      chats: unreplied
    };
    unrepliedCache.data = _unrepliedResp;
    unrepliedCache.timestamp = Date.now();
    res.json(_unrepliedResp);
  } catch(err) {
    console.error('[UnrepliedChats] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});



// === CSAT v2 설문 통합 API ===
router.get('/csat-v2-stats', function(req, res) {
  try {
    var fbPath = path.join(__dirname, '..', 'data', 'csat-feedback-v2.json');
    var drawPath = path.join(__dirname, '..', 'data', 'csat-draw-log.json');
    var feedback = [];
    var drawLog = [];
    try { feedback = JSON.parse(fs.readFileSync(fbPath, 'utf8')); } catch(e) {}
    try { drawLog = JSON.parse(fs.readFileSync(drawPath, 'utf8')); } catch(e) {}

    var days = parseInt(req.query.days) || 30;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    var filtered = feedback.filter(function(f) {
      return new Date(f.submittedAt || f.timestamp) >= cutoff;
    });

    var satisfied = 0, unsatisfied = 0;
    var categories = {};
    var reasons = {};
    var byType = { bot: 0, manager: 0 };
    var byLang = {};
    var monthly = {};

    for (var i = 0; i < filtered.length; i++) {
      var f = filtered[i];
      if (f.satisfied) satisfied++; else unsatisfied++;
      
      // 카테고리별
      var cat = f.category || 'other';
      if (!categories[cat]) categories[cat] = { total: 0, satisfied: 0, unsatisfied: 0 };
      categories[cat].total++;
      if (f.satisfied) categories[cat].satisfied++; else categories[cat].unsatisfied++;
      
      // 사유별
      var rs = f.reasons || [];
      for (var j = 0; j < rs.length; j++) {
        reasons[rs[j]] = (reasons[rs[j]] || 0) + 1;
      }
      
      // 타입별
      var typ = f.type || 'bot';
      byType[typ] = (byType[typ] || 0) + 1;
      
      // 언어별
      var lng = f.lang || 'unknown';
      byLang[lng] = (byLang[lng] || 0) + 1;
      
      // 월별
      var mon = (f.submittedAt || f.timestamp || '').substring(0, 7);
      if (mon) {
        if (!monthly[mon]) monthly[mon] = { satisfied: 0, unsatisfied: 0, total: 0 };
        monthly[mon].total++;
        if (f.satisfied) monthly[mon].satisfied++; else monthly[mon].unsatisfied++;
      }
    }

    var total = satisfied + unsatisfied;
    var rate = total > 0 ? Math.round(satisfied / total * 100) : 0;

    // 추첨 현황
    var draws = drawLog.map(function(d) {
      return {
        month: d.month,
        date: d.drawDate,
        totalCandidates: d.totalCandidates || 0,
        winners: (d.winners || []).map(function(w) {
          return { rank: w.rank, name: (w.name || '').substring(0, 4) + '***', points: w.points, email: (w.email || '').substring(0, 3) + '***' };
        })
      };
    });

    res.json({
      success: true,
      period: days + ' days',
      total: total,
      satisfied: satisfied,
      unsatisfied: unsatisfied,
      satisfactionRate: rate,
      categories: categories,
      reasons: reasons,
      byType: byType,
      byLang: byLang,
      monthly: monthly,
      draws: draws,
      recentFeedback: filtered.slice(-20).reverse().map(function(f) {
        return {
          chatId: f.chatId,
          satisfied: f.satisfied,
          category: f.category,
          reasons: f.reasons,
          comment: f.comment,
          lang: f.lang,
          type: f.type,
          submittedAt: f.submittedAt || f.timestamp,
          rewardStatus: f.rewardStatus,
          // [2026-06-30] 프론트 '최근 피드백' 표가 읽지만 미반환이라 항상 '-'/'비회원'이던 고객 식별 필드 추가
          customerName: f.customerName,
          email: f.email,
          veaslyId: f.veaslyId,
          userId: f.userId,
          isMember: f.isMember
        };
      }),
      allFeedback: feedback.length,
      thisMonth: filtered.filter(function(f) {
        var now = new Date();
        var fDate = new Date(f.submittedAt || f.timestamp);
        return fDate.getMonth() === now.getMonth() && fDate.getFullYear() === now.getFullYear();
      }).length
    });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === AI 리뷰 점수 수정 API (totalScore 매핑) ===
router.get('/ai-review-summary', function(req, res) {
  try {
    var reviewFile = path.join(__dirname, '..', 'data', 'ai-reviews.json');
    var reviews = [];
    try { reviews = JSON.parse(fs.readFileSync(reviewFile, 'utf8')); } catch(e) {}
    
    var days = parseInt(req.query.days) || 30;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    var filtered = reviews.filter(function(r) {
      return new Date(r.timestamp || r.date) >= cutoff;
    });

    // 매니저 이름 매핑
    var mgrNameMap = {};
    try {
      var perfData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'manager-stats.json'), 'utf8'));
      if (perfData.managers) {
        for (var mk in perfData.managers) {
          var mv = perfData.managers[mk];
          if (mv && mv.managerId) mgrNameMap[mv.managerId] = mv.name || mv.email || mk;
        }
      }
    } catch(e) {}
    // 하드코딩 폴백
    if (!mgrNameMap['622148']) mgrNameMap['622148'] = 'vida890515';
    if (!mgrNameMap['609410']) mgrNameMap['609410'] = 'mia';
    if (!mgrNameMap['357940']) mgrNameMap['357940'] = 'gangjun.lee';

    // 매니저별 집계
    var byManager = {};
    for (var i = 0; i < filtered.length; i++) {
      var r = filtered[i];
      var mid = r.managerId || 'unknown';
      var scores = r.scores || {};
      if (!byManager[mid]) {
        byManager[mid] = { reviews: 0, totalScore: 0, resolution: 0, attitude: 0, accuracy: 0, responsiveness: 0, professionalism: 0, summaries: [] };
      }
      byManager[mid].reviews++;
      byManager[mid].totalScore += scores.totalScore || 0;
      byManager[mid].resolution += scores.resolution || 0;
      byManager[mid].attitude += scores.attitude || 0;
      byManager[mid].accuracy += scores.accuracy || 0;
      byManager[mid].responsiveness += scores.responsiveness || 0;
      byManager[mid].professionalism += scores.professionalism || 0;
      if (scores.summary) byManager[mid].summaries.push(scores.summary);
    }

    // 평균 계산
    var managers = {};
    for (var mid in byManager) {
      var m = byManager[mid];
      var cnt = m.reviews;
      managers[mid] = {
        name: mgrNameMap[mid] || mid,
        reviews: cnt,
        avgTotal: Math.round(m.totalScore / cnt * 10) / 10,
        avgResolution: Math.round(m.resolution / cnt * 10) / 10,
        avgAttitude: Math.round(m.attitude / cnt * 10) / 10,
        avgAccuracy: Math.round(m.accuracy / cnt * 10) / 10,
        avgResponsiveness: Math.round(m.responsiveness / cnt * 10) / 10,
        avgProfessionalism: Math.round(m.professionalism / cnt * 10) / 10,
        recentSummaries: m.summaries.slice(-3)
      };
    }

    res.json({
      success: true,
      period: days + ' days',
      totalReviews: filtered.length,
      managers: managers,
      scoreDistribution: {
        excellent: filtered.filter(function(r) { return (r.scores && r.scores.totalScore || 0) >= 20; }).length,
        good: filtered.filter(function(r) { var s = r.scores && r.scores.totalScore || 0; return s >= 15 && s < 20; }).length,
        average: filtered.filter(function(r) { var s = r.scores && r.scores.totalScore || 0; return s >= 10 && s < 15; }).length,
        poor: filtered.filter(function(r) { return (r.scores && r.scores.totalScore || 0) < 10; }).length
      },
      // [2026-06-30] 매니저 탭 'CS 직원 자동 품질 리뷰' 표가 recent를 읽는데 미반환이라 항상 빈 표였음 → 최근 30건 추가
      recent: filtered.slice(-30).reverse()
    });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
