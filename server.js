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
app.use(express.static("public"));
app.use(express.json());
// Dashboard password protection
app.get("/dashboard", function(req, res) {
  var auth = req.headers.authorization;
  if (!auth || auth.indexOf("Basic ") !== 0) {
    res.setHeader("WWW-Authenticate", 'Basic realm="VEASLY Dashboard"');
    return res.status(401).send("Authentication required");
  }
  var credentials = Buffer.from(auth.split(" ")[1], "base64").toString();
  var parts = credentials.split(":");
  var user = parts[0];
  var pass = parts.slice(1).join(":");
  if (user === (process.env.DASHBOARD_USER || "admin") && pass === (process.env.DASHBOARD_PASS || "veasly2026!")) {
    return res.sendFile(require('path').join(__dirname, 'public', 'dashboard.html'));
  }
  res.setHeader("WWW-Authenticate", 'Basic realm="VEASLY Dashboard"');
  return res.status(401).send("Invalid credentials");
});

var webhookRouter = require('./routes/webhook');
var botRouter = require('./routes/bot');
var analyticsRouter = require('./routes/analytics');
var marketingRouter = require('./routes/marketing');
var scheduler = require('./lib/scheduler');
var aiEngine = require('./lib/ai-engine');

// dashboard.html 직접 접근 지원
// /dashboard는 위에서 직접 처리

app.get('/dashboard.html', function(req, res) { res.sendFile(require('path').join(__dirname, 'public', 'dashboard.html')); });

app.use('/webhook', webhookRouter);
app.use('/api/bot', botRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/marketing', marketingRouter);

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
