var express = require('express');
var path = require('path');
var fs = require('fs');
var mgrStats = require('../lib/manager-stats');
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
      raw: results
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
    var filtered = results.filter(function(r) { return r.timestamp >= cutoff; });

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
        totalMgrChats++;
        if (chat.firstMgrReply) {
          var rt = chat.firstMgrReply - chat.firstUserMsg;
          if (rt > 0 && rt < 86400000) responseTimes.push(rt);
        } else {
          noReplyChats++;
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
      var h = parseInt((l.timestamp || '').substring(11, 13));
      var twH = (h + 1) % 24;
      if (twH >= 9 && twH < 18) bizHourMsgs++;
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
  if (fcrRate >= 80) fcrScore = 5;
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
  var csatScore = csatAvg > 0 ? csatAvg : 2.5; // default if no data

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

module.exports = router;
