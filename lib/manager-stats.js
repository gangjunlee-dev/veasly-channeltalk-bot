var fs = require('fs');
var path = require('path');

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
      responseSamples: responseTimes.length
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

module.exports = {
  recordReply: recordReply,
  recordUserMessage: recordUserMessage,
  generateReport: generateReport,
  cleanOldData: cleanOldData,
  loadStats: loadStats
};
