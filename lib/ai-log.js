var fs = require('fs');
var path = require('path');

var LOG_FILE = path.join(__dirname, '..', 'data', 'ai-conversations.json');
var MAX_LOGS = 500;

function saveConversation(entry) {
  // escalationReason 자동 보강
  if (entry.escalated && !entry.escalationReason) {
    if (entry.category && entry.category !== 'unknown' && entry.category !== 'other') {
      entry.escalationReason = 'category_' + entry.category;
    } else {
      entry.escalationReason = 'unclassified';
    }
  }

  try {
    var dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var logs = [];
    if (fs.existsSync(LOG_FILE)) {
      logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    }
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');
  } catch(e) { console.error("[AILog] Save error:", e.message); }
}

function getConversations(limit, filter) {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    var logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    if (filter) {
      if (filter.type) logs = logs.filter(function(l) { return l.type === filter.type; });
      if (filter.lang) logs = logs.filter(function(l) { return l.lang === filter.lang; });
      if (filter.escalated) logs = logs.filter(function(l) { return l.escalated; });
    }
    return logs.slice(-(limit || 50)).reverse();
  } catch(e) { return []; }
}

function getStats() {
  try {
    if (!fs.existsSync(LOG_FILE)) return { total: 0 };
    var logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    var today = new Date().toISOString().substring(0, 10);
    var todayLogs = logs.filter(function(l) { return l.timestamp && l.timestamp.substring(0, 10) === today; });

    var types = {};
    var escalated = 0;
    var langs = {};
    logs.forEach(function(l) {
      types[l.type] = (types[l.type] || 0) + 1;
      langs[l.lang] = (langs[l.lang] || 0) + 1;
      if (l.escalated) escalated++;
    });

    return {
      total: logs.length,
      today: todayLogs.length,
      types: types,
      languages: langs,
      escalatedCount: escalated,
      escalatedRate: logs.length > 0 ? Math.round((escalated / logs.length) * 100) : 0
    };
  } catch(e) { return { total: 0, error: e.message }; }
}

module.exports = {
  saveConversation: saveConversation,
  getConversations: getConversations,
  getStats: getStats
};
