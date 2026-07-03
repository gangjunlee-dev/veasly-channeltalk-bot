require('dotenv').config();
var express = require('express');

var auth = require("./lib/auth");

// Global error handlers
var errorAlert = require('./lib/error-alert');
process.on('uncaughtException', function(err) {
  console.error('[FATAL] Uncaught:', err.message);
  errorAlert.sendAlert('Uncaught Exception', err.message);
});
process.on('unhandledRejection', function(reason) {
  console.error('[FATAL] Unhandled rejection:', reason);
  errorAlert.sendAlert('Unhandled Rejection', String(reason).substring(0, 200));
});

var app = express();
// [2026-06-30 보안] dashboard.html(및 .bak 변형) 무인증 직접 접근 차단 → 인증 경로 /dashboard 로 리다이렉트.
// (survey.html 등 고객용 public 파일은 그대로 공개. /dashboard 자체는 .html이 없어 매칭 안 됨)
app.get(/^\/dashboard\.html/i, function(req, res) { return res.redirect(302, '/dashboard'); });
app.use(express.static("public"));
app.use(express.json());
// Dashboard password protection — reusable Basic-auth middleware
function requireDashboardAuth(req, res, next) {
  var a = req.headers.authorization;
  if (!a || a.indexOf("Basic ") !== 0) {
    res.setHeader("WWW-Authenticate", 'Basic realm="VEASLY Dashboard"');
    return res.status(401).send("Authentication required");
  }
  var cred = Buffer.from(a.split(" ")[1], "base64").toString();
  var parts = cred.split(":");
  var user = parts[0];
  var pass = parts.slice(1).join(":");
  if (process.env.DASHBOARD_PASS && user === (process.env.DASHBOARD_USER || "admin") && pass === process.env.DASHBOARD_PASS) return next(); // [2026-06-30 보안] 하드코딩 비번 폴백 제거, env 필수
  res.setHeader("WWW-Authenticate", 'Basic realm="VEASLY Dashboard"');
  return res.status(401).send("Invalid credentials");
}
app.get("/dashboard", requireDashboardAuth, function(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  return res.sendFile(require('path').join(__dirname, 'public', 'dashboard.html'));
});

// [2026-06-30] FAQ 검토 UI (전부 인증 필수) — 격리된 AI FAQ(faq_review)를 사람이 승인→라이브 KB 반영/거절
var faqReview = require('./lib/faq-review');
app.get("/admin/faq-review", requireDashboardAuth, function(req, res) {
  res.set('Cache-Control', 'no-store');
  return res.sendFile(require('path').join(__dirname, 'faq-review.html'));
});
app.get("/api/faq-review/list", requireDashboardAuth, function(req, res) {
  faqReview.listPending(60).then(function(r) { res.json({ ok: true, items: r.items, total: r.total }); })
    .catch(function(e) { res.status(500).json({ ok: false, error: e.message }); });
});
app.post("/api/faq-review/approve", requireDashboardAuth, function(req, res) {
  faqReview.approve(req.body.id, req.body.question, req.body.answer, req.body.category).then(function() { res.json({ ok: true }); })
    .catch(function(e) { res.status(500).json({ ok: false, error: e.message }); });
});
app.post("/api/faq-review/reject", requireDashboardAuth, function(req, res) {
  faqReview.reject(req.body.id).then(function() { res.json({ ok: true }); })
    .catch(function(e) { res.status(500).json({ ok: false, error: e.message }); });
});

var webhookRouter = require('./routes/webhook');
var botRouter = require('./routes/bot');
var analyticsRouter = require('./routes/analytics');
var marketingRouter = require('./routes/marketing');
var scheduler = require('./lib/scheduler');
var aiEngine = require('./lib/ai-engine');

// [2026-06-30 보안] /dashboard.html 무인증 직접서빙 라우트 제거 — 위 가드가 인증 경로 /dashboard 로 리다이렉트함

app.use('/webhook', webhookRouter);
app.use('/api/bot', botRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/marketing', marketingRouter);
var surveyRouter = require('./routes/survey');
app.use('/api/csat', surveyRouter);

app.get('/health', function(req, res) {
  res.json({ status: 'ok', ai: aiEngine.isReady() ? 'active' : 'fallback', timestamp: new Date().toISOString(), env: process.env.NODE_ENV || 'development' });
});

app.get('/', function(req, res) {
  res.json({ name: 'Veasly ChannelTalk Bot', status: 'running', ai: aiEngine.isReady() ? 'active' : 'fallback', version: '2.0.0' });
});

var PORT = process.env.PORT || 3000;

auth.startAutoRefresh();

app.listen(PORT, '0.0.0.0', function() {
  console.log('Veasly ChannelTalk Bot v2.0 running on port ' + PORT);
  console.log('Features: FAQ Bot, Language Detection, Menu Buttons, Satisfaction Survey, Scheduler');
  console.log('Endpoints:');
  console.log('  POST /webhook/channeltalk');
  console.log('  GET  /api/bot/list | /managers | /chats');
  console.log('  POST /api/bot/order-status');
  console.log('  GET  /api/analytics/report?days=7');
  console.log('  GET  /api/marketing/campaigns | /report');

  scheduler.startScheduler();

  aiEngine.initializeAI()
    .then(function() { console.log('[AI] Engine status:', aiEngine.isReady() ? 'ACTIVE' : 'FALLBACK (matcher.js)'); })
    .catch(function(err) { console.error('[AI] Init failed, using matcher fallback:', err.message); });
});
