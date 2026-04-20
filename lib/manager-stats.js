var fs = require('fs');
var path = require('path');
var bizHoursLib = require('./business-hours');

var STATS_FILE = path.join(__dirname, '..', 'data', 'manager-stats.json');

function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    }
  } catch(e) {}
  return { managers: {}, chats: {} };
}

function saveStats(data) {
  try {
    var dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch(e) { console.error("[MgrStats] Save error:", e.message); }
}

// Record manager reply
function recordReply(managerId, chatId, messageLength) {
  var stats = loadStats();
  var now = Date.now();

  if (!stats.managers[managerId]) {
    stats.managers[managerId] = {
      totalReplies: 0,
      totalChars: 0,
      firstSeen: now,
      lastSeen: now,
      dailyStats: {},
      chats: []
    };
  }

  var mgr = stats.managers[managerId];
  mgr.totalReplies++;
  mgr.totalChars += messageLength;
  mgr.lastSeen = now;

  // Daily stats
  var today = new Date().toISOString().substring(0, 10);
  if (!mgr.dailyStats[today]) {
    mgr.dailyStats[today] = { replies: 0, chars: 0, chats: [] };
  }
  mgr.dailyStats[today].replies++;
  mgr.dailyStats[today].chars += messageLength;
  if (mgr.dailyStats[today].chats.indexOf(chatId) === -1) {
    mgr.dailyStats[today].chats.push(chatId);
  }

  // Track unique chats
  if (mgr.chats.indexOf(chatId) === -1) {
    mgr.chats.push(chatId);
    if (mgr.chats.length > 200) mgr.chats = mgr.chats.slice(-200);
  }

  // Track response time per chat
  if (!stats.chats[chatId]) {
    stats.chats[chatId] = { firstUserMsg: null, firstMgrReply: null, managerId: null };
  }
  if (!stats.chats[chatId].firstMgrReply) {
    stats.chats[chatId].firstMgrReply = now;
    stats.chats[chatId].managerId = managerId;
  }

  // Keep only last 30 days of daily stats
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  var cutoffStr = cutoff.toISOString().substring(0, 10);
  var dayKeys = Object.keys(mgr.dailyStats);
  for (var d = 0; d < dayKeys.length; d++) {
    if (dayKeys[d] < cutoffStr) delete mgr.dailyStats[dayKeys[d]];
  }

  saveStats(stats);
}

// Record user message time (for response time calculation)
function recordUserMessage(chatId) {
  var stats = loadStats();
  if (!stats.chats[chatId]) {
    stats.chats[chatId] = { firstUserMsg: Date.now(), firstMgrReply: null, managerId: null };
  } else if (!stats.chats[chatId].firstUserMsg) {
    stats.chats[chatId].firstUserMsg = Date.now();
  }
  saveStats(stats);
}

// Generate manager performance report
function generateReport(days) {
  days = days || 7;
  var stats = loadStats();
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  var cutoffStr = cutoff.toISOString().substring(0, 10);

  var report = [];
  var mgrIds = Object.keys(stats.managers);

  for (var i = 0; i < mgrIds.length; i++) {
    var mgrId = mgrIds[i];
    var mgr = stats.managers[mgrId];
    var periodReplies = 0;
    var periodChars = 0;
    var periodChats = [];

    var dayKeys = Object.keys(mgr.dailyStats);
    for (var d = 0; d < dayKeys.length; d++) {
      if (dayKeys[d] >= cutoffStr) {
        var day = mgr.dailyStats[dayKeys[d]];
        periodReplies += day.replies;
        periodChars += day.chars;
        for (var c = 0; c < day.chats.length; c++) {
          if (periodChats.indexOf(day.chats[c]) === -1) periodChats.push(day.chats[c]);
        }
      }
    }

    if (periodReplies === 0) continue;

    // Calculate average response time for this manager
    var responseTimes = [];
    var chatKeys = Object.keys(stats.chats);
    for (var j = 0; j < chatKeys.length; j++) {
      var chat = stats.chats[chatKeys[j]];
      if (chat.managerId === mgrId && chat.firstUserMsg && chat.firstMgrReply) {
        var rt = chat.firstMgrReply - chat.firstUserMsg;
        if (rt > 0 && rt < 86400000) responseTimes.push(rt);
      }
    }

    
    // Business-hours response times
    var bizResponseTimes = [];
    for (var bj = 0; bj < chatKeys.length; bj++) {
      var bchat = stats.chats[chatKeys[bj]];
      if (bchat.managerId === mgrId && bchat.firstUserMsg && bchat.firstMgrReply) {
        try {
          var bizRT = bizHoursLib.getBusinessHoursElapsedInHours(bchat.firstUserMsg, bchat.firstMgrReply) * 60;
          if (bizRT > 0 && bizRT < 1440) bizResponseTimes.push(bizRT);
        } catch(e) {}
      }
    }

    var bizAvgResponseTime = 0;
    if (bizResponseTimes.length > 0) {
      var bizRtSum = 0;
      bizResponseTimes.forEach(function(t) { bizRtSum += t; });
      bizAvgResponseTime = Math.round(bizRtSum / bizResponseTimes.length);
    }

var avgResponseTime = 0;
    if (responseTimes.length > 0) {
      var rtSum = 0;
      responseTimes.forEach(function(t) { rtSum += t; });
      avgResponseTime = Math.round(rtSum / responseTimes.length / 60000);
    }

    report.push({
      managerId: mgrId,
      totalReplies: periodReplies,
      totalChars: periodChars,
      avgReplyLength: periodReplies > 0 ? Math.round(periodChars / periodReplies) : 0,
      uniqueChats: periodChats.length,
      avgResponseTimeMin: avgResponseTime,
      bizAvgResponseTimeMin: bizAvgResponseTime,
      responseSamples: responseTimes.length,
      bizResponseSamples: bizResponseTimes.length,
      dailyTrend: (function() {
        var trend = [];
        var dKeys = Object.keys(mgr.dailyStats).sort();
        for (var di = 0; di < dKeys.length; di++) {
          if (dKeys[di] >= cutoffStr) {
            var dStat = mgr.dailyStats[dKeys[di]];
            // calc daily avg RT
            var dRTs = [];
            for (var dk = 0; dk < chatKeys.length; dk++) {
              var dc = stats.chats[chatKeys[dk]];
              if (dc.managerId === mgrId && dc.firstUserMsg && dc.firstMgrReply) {
                var dDate = new Date(dc.firstMgrReply).toISOString().substring(0,10);
                if (dDate === dKeys[di]) {
                  var drt = dc.firstMgrReply - dc.firstUserMsg;
                  if (drt > 0 && drt < 86400000) dRTs.push(drt);
                }
              }
            }
            var dAvgRT = 0;
            if (dRTs.length > 0) { var ds = 0; dRTs.forEach(function(t){ds+=t;}); dAvgRT = Math.round(ds/dRTs.length/60000); }
            trend.push({ date: dKeys[di], replies: dStat.replies, chats: dStat.chats.length, avgRT: dAvgRT });
          }
        }
        return trend;
      })()
    });
  }

  report.sort(function(a, b) { return b.totalReplies - a.totalReplies; });
  return report;
}

// Clean old chat tracking data (>30 days)
function cleanOldData() {
  var stats = loadStats();
  var cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  var chatKeys = Object.keys(stats.chats);
  var cleaned = 0;
  for (var i = 0; i < chatKeys.length; i++) {
    var c = stats.chats[chatKeys[i]];
    if (c.firstUserMsg && c.firstUserMsg < cutoff) {
      delete stats.chats[chatKeys[i]];
      cleaned++;
    }
  }
  if (cleaned > 0) {
    saveStats(stats);
    console.log("[MgrStats] Cleaned", cleaned, "old chat records");
  }
}


// Link CSAT score to manager
function linkCSATToManager(chatId, score) {
  var stats = loadStats();
  if (stats.chats[chatId] && stats.chats[chatId].managerId) {
    var mgrId = stats.chats[chatId].managerId;
    if (stats.managers[mgrId]) {
      if (!stats.managers[mgrId].csatScores) stats.managers[mgrId].csatScores = [];
      stats.managers[mgrId].csatScores.push({ score: score, chatId: chatId, timestamp: Date.now() });
      // Keep last 100
      if (stats.managers[mgrId].csatScores.length > 100) {
        stats.managers[mgrId].csatScores = stats.managers[mgrId].csatScores.slice(-100);
      }
      saveStats(stats);
      console.log("[MgrStats] CSAT", score, "linked to manager", mgrId);
    }
  }
}

// Calculate CS quality score (0-100)
function calculateQualityScore(managerId, days) {
  days = days || 7;
  var stats = loadStats();
  var mgr = stats.managers[managerId];
  if (!mgr) return null;

  var cutoffStr = new Date(Date.now() - days * 86400000).toISOString().substring(0, 10);
  
  // 1. Reply volume (max 25 points)
  var periodReplies = 0;
  var periodChats = [];
  var dayKeys = Object.keys(mgr.dailyStats || {});
  for (var d = 0; d < dayKeys.length; d++) {
    if (dayKeys[d] >= cutoffStr) {
      periodReplies += mgr.dailyStats[dayKeys[d]].replies;
      var dc = mgr.dailyStats[dayKeys[d]].chats || [];
      for (var c = 0; c < dc.length; c++) {
        if (periodChats.indexOf(dc[c]) === -1) periodChats.push(dc[c]);
      }
    }
  }
  var volumeScore = Math.min(25, Math.round((periodReplies / Math.max(days, 1)) * 5));

  // 2. Reply quality - avg length (max 25 points) 
  var avgLen = mgr.totalReplies > 0 ? Math.round(mgr.totalChars / mgr.totalReplies) : 0;
  var qualityScore = 0;
  if (avgLen >= 100) qualityScore = 25;
  else if (avgLen >= 60) qualityScore = 20;
  else if (avgLen >= 30) qualityScore = 15;
  else if (avgLen >= 15) qualityScore = 10;
  else qualityScore = 5;

  // 3. CSAT score (max 30 points)
  var csatAvg = 0;
  var csatCount = 0;
  if (mgr.csatScores && mgr.csatScores.length > 0) {
    var recentCSAT = mgr.csatScores.filter(function(c) {
      return c.timestamp >= Date.now() - days * 86400000;
    });
    if (recentCSAT.length > 0) {
      var csatSum = 0;
      recentCSAT.forEach(function(c) { csatSum += c.score; });
      csatAvg = csatSum / recentCSAT.length;
      csatCount = recentCSAT.length;
    }
  }
  var csatScore = csatCount > 0 ? Math.round((csatAvg / 5) * 30) : 15; // default 15 if no data

  // 4. Response time (max 20 points)
  var responseTimes = [];
  var chatKeys = Object.keys(stats.chats || {});
  for (var j = 0; j < chatKeys.length; j++) {
    var chat = stats.chats[chatKeys[j]];
    if (chat.managerId === managerId && chat.firstUserMsg && chat.firstMgrReply) {
      var rt = chat.firstMgrReply - chat.firstUserMsg;
      if (rt > 0 && rt < 86400000) responseTimes.push(rt);
    }
  }
  var avgRT = 0;
  if (responseTimes.length > 0) {
    var rtSum = 0;
    responseTimes.forEach(function(t) { rtSum += t; });
    avgRT = rtSum / responseTimes.length / 60000; // minutes
  }
  var rtScore = 20;
  if (avgRT > 60) rtScore = 5;
  else if (avgRT > 30) rtScore = 10;
  else if (avgRT > 15) rtScore = 15;
  else rtScore = 20;

  var total = volumeScore + qualityScore + csatScore + rtScore;

  return {
    total: total,
    grade: total >= 80 ? "S" : total >= 65 ? "A" : total >= 50 ? "B" : total >= 35 ? "C" : "D",
    breakdown: {
      volume: { score: volumeScore, max: 25, replies: periodReplies, chats: periodChats.length },
      quality: { score: qualityScore, max: 25, avgLength: avgLen },
      csat: { score: csatScore, max: 30, avgCSAT: Math.round(csatAvg * 10) / 10, count: csatCount },
      responseTime: { score: rtScore, max: 20, avgMinutes: Math.round(avgRT) }
    }
  };
}

module.exports = {
  recordReply: recordReply,
  recordUserMessage: recordUserMessage,
  generateReport: generateReport,
  cleanOldData: cleanOldData,
  loadStats: loadStats,
  linkCSATToManager: linkCSATToManager,
  calculateQualityScore: calculateQualityScore
};
