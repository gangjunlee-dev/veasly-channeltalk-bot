var express = require('express');
var path = require('path');
var fs = require('fs');
var mgrStats = require('../lib/manager-stats');
var bizHours = require('../lib/business-hours');
var aiLog = require('../lib/ai-log');
var router = express.Router();
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



// CSAT 결과 조회
router.get('/csat', async function(req, res) {
  try {
    var csatFile = require('path').join(__dirname, '..', 'data', 'csat-results.json');
    var results = [];
    if (fs.existsSync(csatFile)) {
      results = JSON.parse(fs.readFileSync(csatFile, 'utf8'));
    }
    var days = parseInt(req.query.days) || 30;
    var cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    var filtered = results.filter(function(r) { var ts = typeof r.timestamp === 'string' ? new Date(r.timestamp).getTime() : r.timestamp; return ts >= cutoff; });

    var total = filtered.length;
    var avgScore = 0;
    var distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (total > 0) {
      var sum = 0;
      filtered.forEach(function(r) {
        sum += r.score;
        distribution[r.score] = (distribution[r.score] || 0) + 1;
      });
      avgScore = Math.round((sum / total) * 10) / 10;
    }

    res.json({
      success: true,
      period: days + " days",
      totalResponses: total,
      averageScore: avgScore,
      distribution: distribution,
      recentResults: filtered.slice(-20).reverse()
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

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

// 자동 종료 현황
router.get('/auto-close', async function(req, res) {
  try {
    var csatSentFile = require('path').join(__dirname, '..', 'data', 'csat-sent.json');
    var csatSent = {};
    if (fs.existsSync(csatSentFile)) {
      csatSent = JSON.parse(fs.readFileSync(csatSentFile, 'utf8'));
    }
    res.json({
      success: true,
      csatPending: Object.keys(csatSent).length,
      pendingChats: Object.keys(csatSent).map(function(k) {
        return { chatId: k, sentAt: new Date(csatSent[k]).toISOString() };
      })
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 통합 대시보드 요약
router.get('/dashboard-summary', async function(req, res) {
  try {
    var days = parseInt(req.query.days) || 7;
    var results = await analytics.analyzeRecentChats(days);

    // CSAT
    var csatFile = require('path').join(__dirname, '..', 'data', 'csat-results.json');
    var csatResults = [];
    if (fs.existsSync(csatFile)) csatResults = JSON.parse(fs.readFileSync(csatFile, 'utf8'));
    var csatAvg = 0;
    if (csatResults.length > 0) {
      var csatSum = 0;
      csatResults.forEach(function(r) { csatSum += r.score; });
      csatAvg = Math.round((csatSum / csatResults.length) * 10) / 10;
    }

    // Shipping
    var stateFile = require('path').join(__dirname, '..', 'data', 'shipping-state.json');
    var state = {};
    if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

    // FAQ
    var faqLogFile = require('path').join(__dirname, '..', 'data', 'faq-update-log.json');
    var faqLogs = [];
    if (fs.existsSync(faqLogFile)) faqLogs = JSON.parse(fs.readFileSync(faqLogFile, 'utf8'));

    res.json({
      success: true,
      period: days + " days",
      cs: {
        totalChats: results.totalChats,
        aiResponseRate: results.aiResponseRate,
        unresolvedChats: results.unresolvedChats,
        channelStats: results.channelStats,
        topCategories: results.categories
      },
      csat: {
        totalResponses: csatResults.length,
        averageScore: csatAvg
      },
      shipping: {
        trackedItems: Object.keys(state).length
      },
      faq: {
        lastUpdate: faqLogs.length > 0 ? faqLogs[faqLogs.length - 1] : null
      }
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


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
        responseSamples: r.responseSamples
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
    var auto = reviews.filter(function(r) { return r.scores; });
    var total = manual.length;
    var good = manual.filter(function(r) { return r.rating === 'good'; }).length;
    var bad = manual.filter(function(r) { return r.rating === 'bad'; }).length;
    var fix = manual.filter(function(r) { return r.rating === 'fix'; }).length;
    res.json({ success: true, total: total, good: good, bad: bad, fix: fix, autoReviewCount: auto.length, recent: reviews.slice(-30).reverse() });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});



// CS Score Metrics - 응답속도 분포, 미응답종료율, 재문의율
router.get('/cs-score-metrics', async function(req, res) {
  try {
    var days = parseInt(req.query.days) || 7;
    var channeltalk = require('../lib/channeltalk');
    var mgrStats = require('../lib/manager-stats');

    // 1. Response time distribution from manager-stats
    var statsFile = require('path').join(__dirname, '..', 'data', 'manager-stats.json');
    var stats = {};
    try { stats = JSON.parse(fs.readFileSync(statsFile, 'utf8')); } catch(e) {}
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
            totalMgrChats++;
            noReplyChats++;
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
    } catch(e) {}

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

  // === CES Data ===
  var cesData = [];
  try { cesData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'ces-results.json'), 'utf8')); } catch(e) {}
  var cesCutoff = new Date(Date.now() - days * 86400000);
  var recentCES = cesData.filter(function(c) { return new Date(c.timestamp) >= cesCutoff; });
  var cesAvg = 0;
  if (recentCES.length > 0) {
    cesAvg = recentCES.reduce(function(sum, c) { return sum + c.score; }, 0) / recentCES.length;
    cesAvg = Math.round(cesAvg * 100) / 100;
  }

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

  var fcrScore = 0;
  var fcrSampleCount = recentResolved.length + recentReopened.length;
  if (fcrSampleCount < 10) {
    fcrScore = 2; // 데이터 부족 시 보수적 기본값
    console.log("[CS Score] FCR data insufficient:", fcrSampleCount, "samples (min 10) - using default 2.0");
  } else if (fcrRate >= 80) fcrScore = 5;
  else if (fcrRate >= 70) fcrScore = 4;
  else if (fcrRate >= 55) fcrScore = 3;
  else fcrScore = 2;

  var csatAvg = 0;
  try {
    var csatData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'csat-results.json'), 'utf8'));
    var recentCSAT = csatData.filter(function(c) { return new Date(c.timestamp) >= cutoff; });
    if (recentCSAT.length > 0) {
      csatAvg = recentCSAT.reduce(function(sum, c) { return sum + c.score; }, 0) / recentCSAT.length;
    }
  } catch(e) {}
  var csatScore = csatAvg > 0 ? csatAvg : 2.5; // default if no CSAT data
  if (csatAvg === 0) console.log('[CS Score] CSAT no data - using default 2.5');

  var cesScoreVal = cesAvg > 0 ? cesAvg : 2.5; // default if no data

  var noReplyScore = 0;
  if (noReplyRate <= 10) noReplyScore = 5;
  else if (noReplyRate <= 20) noReplyScore = 4;
  else if (noReplyRate <= 30) noReplyScore = 3;
  else noReplyScore = 1.5;

  var integratedScore = (frtScore * 0.20) + (fcrScore * 0.25) + (csatScore * 0.20) + (cesScoreVal * 0.15) + (noReplyScore * 0.20);
  integratedScore = Math.round(integratedScore * 100) / 100;

    res.json({
      success: true,
      period: days + ' days',
      responseTime: {
        avgMinutes: avgRT,
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
      ces: { avgScore: cesAvg, totalResponses: recentCES.length },
      fcr: { rate: fcrRate, resolved: recentResolved.length, reopened: recentReopened.length },
      integratedScore: { score: integratedScore, breakdown: { frt: { score: frtScore, weight: 0.20 }, fcr: { score: fcrScore, weight: 0.25 }, csat: { score: csatScore, weight: 0.20 }, ces: { score: cesScoreVal, weight: 0.15 }, noReply: { score: noReplyScore, weight: 0.20 } }, target: 3.0 }
  });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// === CES API ===
router.get('/ces', function(req, res) {
  try {
    var cesPath2 = path.join(__dirname, '..', 'data', 'ces-results.json');
    var data = [];
    try { data = JSON.parse(fs.readFileSync(cesPath2, 'utf8')); } catch(e) {}
    var days = parseInt(req.query.days) || 30;
    var cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    var recent = data.filter(function(d) { return new Date(d.timestamp).getTime() > cutoff; });
    var total = recent.length;
    var avg = 0;
    if (total > 0) { var sum = 0; recent.forEach(function(d) { sum += d.score; }); avg = parseFloat((sum / total).toFixed(2)); }
    var dist = { 1:0, 2:0, 3:0, 4:0, 5:0 };
    recent.forEach(function(d) { if (d.score >= 1 && d.score <= 5) dist[d.score]++; });
    res.json({ success: true, average: avg, total: total, distribution: dist, recent: recent.slice(-20).reverse() });
  } catch(e) { res.json({ success: false, error: e.message }); }
});


// === CSAT Feedback (Dissatisfaction Reasons) API ===
router.get('/csat-feedback', function(req, res) {
  try {
    var fbPath = require('path').join(__dirname, '..', 'data', 'csat-feedback.json');
    var data = [];
    try { data = JSON.parse(require('fs').readFileSync(fbPath, 'utf8')); } catch(e) {}
    var days = parseInt(req.query.days) || 30;
    var cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    var recent = data.filter(function(d) { return new Date(d.timestamp).getTime() > cutoff; });
    res.json({ success: true, total: recent.length, feedback: recent.reverse() });
  } catch(e) { res.json({ success: false, error: e.message }); }
});


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
      // 1. 상담사 직접 요청 (가장 먼저 - 단순 "客服" 한마디)
      if (/^客服$|^상담사$|^상담원$|^真人$|^人工$/i.test(msg.trim())) cat = 'agent_direct';
      // 2. 주문 상태/추적 (번호 입력 포함)
      else if (msg.indexOf('訂單') > -1 || msg.indexOf('주문') > -1 || msg.indexOf('進度') > -1 || msg.indexOf('狀態') > -1 || /\d{10,}/.test(msg) || msg.indexOf('多久') > -1 || msg.indexOf('等了') > -1 || msg.indexOf('天了') > -1 || msg.indexOf('幾天') > -1 || msg.indexOf('update') > -1 || msg.indexOf('一個禮拜') > -1) cat = 'order_status';
      // 3. 배송/물류
      else if (msg.indexOf('배송') > -1 || msg.indexOf('物流') > -1 || msg.indexOf('配送') > -1 || msg.indexOf('出貨') > -1 || msg.indexOf('發貨') > -1 || msg.indexOf('寄出') > -1 || msg.indexOf('到貨') > -1 || msg.indexOf('快遞') > -1 || msg.indexOf('順豐') > -1 || msg.indexOf('택배') > -1 || msg.indexOf('도착') > -1 || msg.indexOf('집운') > -1 || msg.indexOf('集運') > -1) cat = 'shipping';
      // 4. 국제배송비/운임
      else if (msg.indexOf('國際運費') > -1 || msg.indexOf('운비') > -1 || msg.indexOf('배송비') > -1 || msg.indexOf('運費') > -1 || msg.indexOf('관세') > -1 || msg.indexOf('稅') > -1 || msg.indexOf('報關') > -1 || msg.indexOf('海關') > -1 || msg.indexOf('관부가세') > -1) cat = 'shipping_fee';
      // 5. 취소/환불/반품
      else if (msg.indexOf('취소') > -1 || msg.indexOf('取消') > -1 || msg.indexOf('退款') > -1 || msg.indexOf('退貨') > -1 || msg.indexOf('환불') > -1 || msg.indexOf('반품') > -1 || msg.indexOf('不要了') > -1 || msg.indexOf('先不要發貨') > -1) cat = 'cancel_refund';
      // 6. 결제/금액
      else if (msg.indexOf('결제') > -1 || msg.indexOf('付款') > -1 || msg.indexOf('刷卡') > -1 || msg.indexOf('金額') > -1 || msg.indexOf('價') > -1 || msg.indexOf('元') > -1 || msg.indexOf('費用') > -1 || msg.indexOf('報價') > -1 || msg.indexOf('얼마') > -1 || msg.indexOf('多少') > -1) cat = 'payment';
      // 7. 상품문의/불량/교환
      else if (msg.indexOf('商品') > -1 || msg.indexOf('상품') > -1 || msg.indexOf('壞') > -1 || msg.indexOf('不能用') > -1 || msg.indexOf('損') > -1 || msg.indexOf('瑕疵') > -1 || msg.indexOf('品質') > -1 || msg.indexOf('색상') > -1 || msg.indexOf('色差') > -1 || msg.indexOf('換貨') > -1 || msg.indexOf('교환') > -1 || msg.indexOf('包包') > -1 || msg.indexOf('사이즈') > -1 || msg.indexOf('찾') > -1 || msg.indexOf('找') > -1 || msg.indexOf('有賣') > -1) cat = 'product';
      // 8. 계정/로그인/회원정보
      else if (msg.indexOf('登') > -1 || msg.indexOf('帳號') > -1 || msg.indexOf('會員') > -1 || msg.indexOf('계정') > -1 || msg.indexOf('密碼') > -1 || msg.indexOf('信箱') > -1 || msg.indexOf('email') > -1 || msg.indexOf('이메일') > -1 || msg.indexOf('修改') > -1) cat = 'account';
      // 9. 사이트 이용/주문방법
      else if (msg.indexOf('下訂') > -1 || msg.indexOf('無法') > -1 || msg.indexOf('怎麼') > -1 || msg.indexOf('如何') > -1 || msg.indexOf('방법') > -1 || msg.indexOf('使用') > -1 || msg.indexOf('操作') > -1 || msg.indexOf('어떻게') > -1) cat = 'how_to';
      // 10. 상담사 연결 요청 (문장 속 客服)
      else if (msg.indexOf('客服') > -1 || msg.indexOf('真人') > -1 || msg.indexOf('상담') > -1 || msg.indexOf('人工') > -1 || msg.indexOf('幫我') > -1) cat = 'agent_request';
      categories[cat] = (categories[cat] || 0) + 1;
      if (!examples[cat]) examples[cat] = [];
      if (examples[cat].length < 3) examples[cat].push((c.userMessage || '').substring(0, 80));
    });
    var sorted = Object.keys(categories).sort(function(a,b) { return categories[b] - categories[a]; });
    var result = sorted.map(function(cat) { return { category: cat, count: categories[cat], examples: examples[cat] }; });
    // 에스컬레이션 사유별 집계
    var reasonCounts = {};
    recent.forEach(function(c) {
      var reason = c.escalationReason || 'unknown';
      if (!reasonCounts[reason]) reasonCounts[reason] = 0;
      reasonCounts[reason]++;
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
    
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
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
      const q = (log.question || '').toLowerCase();
      let matched = false;
      for (const [cat, kws] of Object.entries(keywords)) {
        if (kws.some(kw => q.includes(kw.toLowerCase()))) {
          if (!categories[cat]) categories[cat] = { count: 0, examples: [] };
          categories[cat].count++;
          if (categories[cat].examples.length < 3) {
            categories[cat].examples.push(log.question);
          }
          matched = true;
          break;
        }
      }
      if (!matched) {
        if (!categories['other']) categories['other'] = { count: 0, examples: [] };
        categories['other'].count++;
        if (categories['other'].examples.length < 3) {
          categories['other'].examples.push(log.question);
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
    
    // CSAT 데이터 상태
    var csatFile = path.join(__dirname, '../data/csat-results.json');
    var csatData = [];
    if (fs.existsSync(csatFile)) { try { csatData = JSON.parse(fs.readFileSync(csatFile, 'utf8')); } catch(e) {} }
    var csatRecent = csatData.filter(function(c) { return c.timestamp > Date.now() - 7 * 24 * 60 * 60 * 1000; });
    checks.csat = {
      total: csatData.length,
      last7days: csatRecent.length,
      sufficient: csatRecent.length >= 10,
      target: 10,
      status: csatRecent.length >= 10 ? 'OK' : csatRecent.length >= 5 ? 'PARTIAL' : 'INSUFFICIENT'
    };
    
    // CES 데이터 상태
    var cesFile = path.join(__dirname, '../data/ces-results.json');
    var cesData = [];
    if (fs.existsSync(cesFile)) { try { cesData = JSON.parse(fs.readFileSync(cesFile, 'utf8')); } catch(e) {} }
    var cesRecent = cesData.filter(function(c) { return c.timestamp > Date.now() - 14 * 24 * 60 * 60 * 1000; });
    checks.ces = {
      total: cesData.length,
      last14days: cesRecent.length,
      sufficient: cesRecent.length >= 20,
      target: 20,
      status: cesRecent.length >= 20 ? 'OK' : cesRecent.length >= 5 ? 'PARTIAL' : 'INSUFFICIENT'
    };
    
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
    
    // CSAT Feedback
    var fbFile = path.join(__dirname, '../data/csat-feedback.json');
    var fbData = [];
    if (fs.existsSync(fbFile)) { try { fbData = JSON.parse(fs.readFileSync(fbFile, 'utf8')); } catch(e) {} }
    checks.csatFeedback = {
      total: fbData.length,
      status: fbData.length > 0 ? 'COLLECTING' : 'WAITING'
    };
    
    // 전체 상태 판단
    var allStatuses = [checks.csat.status, checks.ces.status, checks.fcr.status, checks.scoreHistory.status];
    var overallStatus = allStatuses.every(function(s) { return s === 'OK'; }) ? 'HEALTHY' :
                        allStatuses.some(function(s) { return s === 'OK'; }) ? 'PARTIAL' : 'NEEDS_DATA';
    
    // 추천 액션
    var recommendations = [];
    if (checks.csat.status !== 'OK') recommendations.push('CSAT 응답 ' + checks.csat.target + '건 목표 대비 ' + checks.csat.last7days + '건 - CSAT 설문 응답률 개선 필요');
    if (checks.ces.status !== 'OK') recommendations.push('CES 응답 ' + checks.ces.target + '건 목표 대비 ' + checks.ces.last14days + '건 - CES 수집 파이프라인 확인 필요');
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


module.exports = router;
