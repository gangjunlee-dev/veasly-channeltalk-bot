require('dotenv').config();
var express = require('express');

var app = express();
app.use(express.json());

var webhookRouter = require('./routes/webhook');
var botRouter = require('./routes/bot');
var analyticsRouter = require('./routes/analytics');
var marketingRouter = require('./routes/marketing');

app.use('/webhook', webhookRouter);
app.use('/api/bot', botRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/marketing', marketingRouter);

app.get('/health', function(req, res) {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV || 'development' });
});

app.get('/', function(req, res) {
  res.json({ name: 'Veasly ChannelTalk Bot', status: 'running', version: '1.0.0' });
});

var PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', function() {
  console.log('Veasly ChannelTalk Bot Server running on port ' + PORT);
  console.log('Endpoints:');
  console.log('  POST /webhook/channeltalk');
  console.log('  GET  /api/bot/list | /managers | /chats');
  console.log('  POST /api/bot/order-status (Phase 2-A)');
  console.log('  GET  /api/analytics/report?days=7');
  console.log('  GET  /api/marketing/campaigns | /report');
});
