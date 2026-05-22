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

// 설문 페이지 열람(클릭) 이벤트 저장 파일
var EVENTS_FILE = path.join(__dirname, '..', 'data', 'csat-events.json');

function loadEvents() {
  try { return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')); }
  catch(e) { return []; }
}

function saveEvents(data) {
  if (data.length > MAX_ENTRIES) data = data.slice(-MAX_ENTRIES);
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(data));
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

// GET /api/csat/track - 설문 페이지가 열릴 때 호출되는 추적 비콘
router.get('/track', function(req, res) {
  try {
    var chatId = req.query.c || req.query.cid || '';
    if (chatId) {
      var events = loadEvents();
      events.push({
        chatId: chatId,
        lang: req.query.l || req.query.lang || '',
        ts: parseInt(req.query.ts || '0', 10),
        at: new Date().toISOString(),
        ua: (req.headers['user-agent'] || '').slice(0, 200)
      });
      saveEvents(events);
      console.log('[CSAT] Survey opened:', chatId);
    }
  } catch(e) { console.error('[CSAT] Track error:', e.message); }
  res.set('Cache-Control', 'no-store');
  res.status(204).end();
});

// GET /api/csat/funnel - 발송→열람→제출 깔때기 조회
router.get('/funnel', function(req, res) {
  var sent = {};
  try { sent = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'csat-sent.json'), 'utf8')); }
  catch(e) {}
  var events = loadEvents();
  var submissions = loadData();

  var sentBySource = {};
  Object.keys(sent).forEach(function(cid) {
    var src = (sent[cid] && sent[cid].source) || 'unknown';
    sentBySource[src] = (sentBySource[src] || 0) + 1;
  });

  var openedChats = {};
  events.forEach(function(e) { if (e.chatId) openedChats[e.chatId] = true; });
  var submittedChats = {};
  submissions.forEach(function(s) { if (s.chatId) submittedChats[s.chatId] = true; });

  res.json({
    sentTotal: Object.keys(sent).length,
    sentBySource: sentBySource,
    openedUnique: Object.keys(openedChats).length,
    openedTotal: events.length,
    submittedUnique: Object.keys(submittedChats).length,
    recentOpens: events.slice(-15).reverse()
  });
});

// 채널톡 백필로 채워지는 수신자 정보 (chatId -> {name,email,phone,userId})
var RECIPIENTS_FILE = path.join(__dirname, '..', 'data', 'csat-recipients.json');
function loadRecipients() {
  try { return JSON.parse(fs.readFileSync(RECIPIENTS_FILE, 'utf8')); }
  catch(e) { return {}; }
}

// 집계 시작일 (열람 추적이 추가된 날, KST 고정)
var AGGREGATION_START_DATE = '2026-05-22';

// GET /api/csat/recipients - 발송을 chatId 기준으로 발송→열람→제출까지 조인한 감사용 표
router.get('/recipients', function(req, res) {
  var sent = {};
  try { sent = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'csat-sent.json'), 'utf8')); }
  catch(e) {}
  var inChat = [];
  try { inChat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'csat-results.json'), 'utf8')); }
  catch(e) {}
  var events = loadEvents();
  var submissions = loadData();
  var recipients = loadRecipients();

  // chatId 기준 인덱스 구성
  var openedMap = {};
  events.forEach(function(e) {
    if (e.chatId && (!openedMap[e.chatId] || e.at < openedMap[e.chatId])) openedMap[e.chatId] = e.at;
  });
  var webMap = {};
  submissions.forEach(function(s) { if (s.chatId) webMap[s.chatId] = s; });
  var chatScoreMap = {};
  inChat.forEach(function(r) { if (r.chatId) chatScoreMap[r.chatId] = r; });

  var rows = Object.keys(sent).map(function(cid) {
    var rec = sent[cid] || {};
    var web = webMap[cid];
    var chatScore = chatScoreMap[cid];
    var info = recipients[cid] || {};
    var isSkipped = rec.source === 'skip-old' || rec.count === 0;
    var opened = !!openedMap[cid];
    var submitted = !!web || !!chatScore;
    var status = isSkipped ? 'skipped' : submitted ? 'submitted' : opened ? 'opened' : 'sent';

    return {
      chatId: cid,
      source: rec.source || 'unknown',
      sentAt: rec.sentAt || null,
      opened: opened,
      openedAt: openedMap[cid] || null,
      submitted: submitted,
      submittedAt: web ? web.submittedAt : (chatScore ? new Date(chatScore.timestamp).toISOString() : null),
      submitChannel: web ? 'web' : (chatScore ? 'in-chat' : null),
      score: web ? (web.satisfied ? '만족' : '불만족') : (chatScore ? chatScore.score : null),
      customerName: (web && web.customerName) || info.name || '',
      email: (web && web.email) || info.email || '',
      phone: info.phone || '',
      userId: (web && web.userId) || (chatScore && chatScore.userId) || info.userId || '',
      status: status
    };
  });

  rows.sort(function(a, b) { return (b.sentAt || 0) - (a.sentAt || 0); });

  var summary = { total: rows.length, skipped: 0, sent: 0, opened: 0, submitted: 0 };
  rows.forEach(function(r) { if (summary[r.status] !== undefined) summary[r.status]++; });

  res.json({
    aggregationStartDate: AGGREGATION_START_DATE,
    enrichedCount: Object.keys(recipients).length,
    summary: summary,
    rows: rows
  });
});

module.exports = router;
