var express = require('express');
var router = express.Router();
var fs = require('fs');
var path = require('path');

var DATA_FILE = path.join(__dirname, '..', 'data', 'csat-feedback-v2.json');
var MAX_ENTRIES = 5000;

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch(e) { return []; }
}

function saveData(data) {
  if (data.length > MAX_ENTRIES) data = data.slice(-MAX_ENTRIES);
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// POST /api/csat/submit
router.post('/submit', function(req, res) {
  var body = req.body;
  if (!body.chatId || body.satisfied === undefined) {
    return res.status(400).json({ ok: false, message: 'chatId and satisfied are required' });
  }
  var data = loadData();

  // 중복 방지: 동일 chatId로 이미 제출된 경우
  var duplicate = data.some(function(entry) {
    return entry.chatId === body.chatId && body.chatId;
  });

  if (duplicate) {
    return res.json({ ok: true, duplicate: true, message: 'Already submitted for this chat' });
  }

  var entry = {
    chatId: body.chatId || '',
    userId: body.userId || '',
    lang: body.lang || 'zh-TW',
    type: body.type || 'bot',
    satisfied: body.satisfied,
    category: body.category || '',
    reasons: body.reasons || [],
    comment: body.comment || '',
    customerName: body.customerName || '',
    email: body.email || body.guestEmail || '',
    veaslyId: body.veaslyId || '',
    isMember: body.isMember || false,
    submittedAt: body.submittedAt || new Date().toISOString(),
    surveyVersion: body.surveyVersion || 'v3',
    rewardStatus: 'pending_draw'
  };

  data.push(entry);
  saveData(data);
  console.log('[CSAT] New submission:', entry.chatId, entry.satisfied ? 'satisfied' : 'unsatisfied', entry.category);

  res.json({ ok: true, duplicate: false });
});

// GET /api/csat/stats
router.get('/stats', function(req, res) {
  var data = loadData();
  var total = data.length;
  var satisfied = data.filter(function(d) { return d.satisfied === true; }).length;
  var unsatisfied = data.filter(function(d) { return d.satisfied === false; }).length;

  // Category breakdown
  var categoryBreakdown = {};
  data.forEach(function(d) {
    if (d.category) {
      if (!categoryBreakdown[d.category]) categoryBreakdown[d.category] = { total: 0, satisfied: 0, unsatisfied: 0 };
      categoryBreakdown[d.category].total++;
      if (d.satisfied) categoryBreakdown[d.category].satisfied++;
      else categoryBreakdown[d.category].unsatisfied++;
    }
  });

  // Reason breakdown
  var reasonBreakdown = {};
  data.forEach(function(d) {
    (d.reasons || []).forEach(function(r) {
      reasonBreakdown[r] = (reasonBreakdown[r] || 0) + 1;
    });
  });

  // By type
  var byType = { bot: 0, manager: 0 };
  data.forEach(function(d) { if (byType[d.type] !== undefined) byType[d.type]++; });

  // By language
  var byLang = {};
  data.forEach(function(d) { byLang[d.lang] = (byLang[d.lang] || 0) + 1; });

  // Monthly entries (for draw)
  var now = new Date();
  var monthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  var thisMonth = data.filter(function(d) {
    return d.submittedAt && d.submittedAt.substring(0, 7) === monthKey;
  });

  res.json({
    total: total,
    satisfied: satisfied,
    unsatisfied: unsatisfied,
    satisfactionRate: total > 0 ? Math.round(satisfied / total * 100) + '%' : '0%',
    categoryBreakdown: categoryBreakdown,
    reasonBreakdown: reasonBreakdown,
    byType: byType,
    byLang: byLang,
    thisMonthEntries: thisMonth.length,
    recentFeedback: data.slice(-5).reverse()
  });
});

module.exports = router;
