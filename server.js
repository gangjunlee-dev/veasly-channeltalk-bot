require('dotenv').config();
var express = require('express');

var app = express();
app.use(express.json());
app.use("/dashboard", express.static("public"));

var webhookRouter = require('./routes/webhook');
var botRouter = require('./routes/bot');
var analyticsRouter = require('./routes/analytics');
var marketingRouter = require('./routes/marketing');
var scheduler = require('./lib/scheduler');
var aiEngine = require('./lib/ai-engine');

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
