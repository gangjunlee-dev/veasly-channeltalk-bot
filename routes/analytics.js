var express = require('express');
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
    var total = reviews.length;
    var good = reviews.filter(function(r) { return r.rating === 'good'; }).length;
    var bad = reviews.filter(function(r) { return r.rating === 'bad'; }).length;
    var fix = reviews.filter(function(r) { return r.rating === 'fix'; }).length;
    res.json({ success: true, total: total, good: good, bad: bad, fix: fix, recent: reviews.slice(-20).reverse() });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
