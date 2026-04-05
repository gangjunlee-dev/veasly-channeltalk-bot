var express = require('express');
var router = express.Router();
var channeltalk = require('../lib/channeltalk');
var orderNotifier = require('../lib/order-notifier');

router.post('/create', async function(req, res) {
  try {
    var result = await channeltalk.createBot('Veasly小幫手', '', '#6B4EFF');
    res.json({ success: true, bot: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/list', async function(req, res) {
  try {
    var result = await channeltalk.listBots();
    res.json({ success: true, bots: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/setup-webhook', async function(req, res) {
  try {
    var url = req.body.url;
    var result = await channeltalk.createWebhook('Veasly Auto-Response Bot', url);
    res.json({ success: true, webhook: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/webhooks', async function(req, res) {
  try {
    var result = await channeltalk.listWebhooks();
    res.json({ success: true, webhooks: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/managers', async function(req, res) {
  try {
    var result = await channeltalk.listManagers();
    res.json({ success: true, managers: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/chats', async function(req, res) {
  try {
    var state = req.query.state || 'opened';
    var result = await channeltalk.listUserChats(state);
    res.json({ success: true, chats: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Phase 2-A: 주문 상태 변경 알림 Webhook
// Veasly 백엔드에서 POST /api/bot/order-status 로 호출
router.post('/order-status', orderNotifier.getWebhookHandler());

// Phase 2-A: 수동 알림 테스트용
router.post('/test-notify', async function(req, res) {
  try {
    var memberId = req.body.memberId;
    var orderId = req.body.orderId || 'TEST-001';
    var status = req.body.status || 'PAYMENT_COMPLETED';
    
    await orderNotifier.notifyOrderStatus(memberId, orderId, status);
    res.json({ success: true, message: 'Test notification sent' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
