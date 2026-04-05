/**
 * Phase 2-A: 배송 상태 자동 알림 (DB 연동 준비)
 * 
 * 사용법: DB 접근 가능해지면 .env에 DB 정보 입력 후
 * server.js에서 require('./lib/order-notifier').start() 호출
 * 
 * 현재는 비활성 상태 — DB 연결 설정 전까지 실행되지 않음
 */

var channeltalk = require('./channeltalk');

// 주문 상태별 고객 알림 메시지 (繁體中文)
var STATUS_MESSAGES = {
  PAYMENT_COMPLETED: {
    title: '付款成功',
    message: '您的付款已確認！我們將開始為您處理訂單。\n\n訂單編號：{orderId}\n\n接下來我們會在韓國為您採購商品，處理時間約 1~3 個工作日。\n訂單狀態更新時會再通知您！'
  },
  ORDER_PROCESSING: {
    title: '訂單處理中',
    message: '您的訂單已開始處理！\n\n訂單編號：{orderId}\n\n我們正在韓國為您採購商品，商品備齊後會立即安排出貨。'
  },
  SHIPPING_TO_BDJ: {
    title: '商品已發貨',
    message: '好消息！您的商品已從韓國賣場發出，正在前往韓國集運倉！\n\n訂單編號：{orderId}\n\n預計 1~3 個工作日到達集運倉，届時會安排國際運送。'
  },
  SHIPPING_TO_HOME: {
    title: '海外配送中',
    message: '您的包裹已從韓國出發，正在前往台灣！\n\n訂單編號：{orderId}\n\n重要提醒：\n1. 國際運送期間（約5~10天）暫時無法追蹤，這是正常的\n2. 請確認已完成 EZ WAY 實名認證\n3. 收到 EZ WAY 推播通知時，請點擊「申報確認」\n\n到達台灣後會再通知您！'
  },
  DELIVERED: {
    title: '配送完成',
    message: '您的包裹已送達！\n\n訂單編號：{orderId}\n\n請確認商品是否完好。如有任何問題，請在收到後 7 天內聯繫客服。\n\n感謝您使用 VEASLY！希望您喜歡您的商品 :)\n\n如果方便的話，歡迎到 VEASLY 留下您的商品評價！\nhttps://www.veasly.com/tw/product-reviews'
  },
  COMPLETED: {
    title: '訂單完成',
    message: '您的訂單已完成！\n\n訂單編號：{orderId}\n\n感謝您的購買！您已獲得購物點數，下次結帳時可折抵最高 22% OFF！\n\n追蹤 @veasly.official 獲得更多優惠資訊！'
  },
  CANCEL_REQUESTED: {
    title: '取消申請已收到',
    message: '我們已收到您的取消申請。\n\n訂單編號：{orderId}\n\n我們會盡快處理，預計 1~2 個工作日內回覆結果。\n如有疑問，請隨時聯繫客服。'
  },
  CANCEL_REJECTED: {
    title: '取消申請無法受理',
    message: '很抱歉，您的取消申請無法受理。\n\n訂單編號：{orderId}\n\n可能原因：商品已進入國際運送階段，無法取消。\n\n如有疑問，請聯繫客服，我們會盡力為您處理。'
  }
};

// 알림이 필요한 상태 목록
var NOTIFY_STATUSES = [
  'PAYMENT_COMPLETED',
  'ORDER_PROCESSING', 
  'SHIPPING_TO_BDJ',
  'SHIPPING_TO_HOME',
  'DELIVERED',
  'COMPLETED',
  'CANCEL_REQUESTED',
  'CANCEL_REJECTED'
];

/**
 * 주문 상태 변경 시 고객에게 채널톡 알림 전송
 * DB 연동 후 호출할 함수
 */
async function notifyOrderStatus(memberId, orderId, newStatus) {
  var template = STATUS_MESSAGES[newStatus];
  if (!template) {
    console.log('[OrderNotifier] No template for status: ' + newStatus);
    return;
  }

  var messageText = template.message.replace(/\{orderId\}/g, orderId);

  try {
    // memberId로 채널톡 유저 조회
    var userData = await channeltalk.getUserByMemberId(memberId);
    var userId = userData.user ? userData.user.id : null;

    if (!userId) {
      console.log('[OrderNotifier] User not found for memberId: ' + memberId);
      return;
    }

    // 유저에게 새 채팅 생성
    var chatData = await channeltalk.createUserChat(userId);
    var userChatId = chatData.userChat ? chatData.userChat.id : null;

    if (!userChatId) {
      console.log('[OrderNotifier] Failed to create chat for user: ' + userId);
      return;
    }

    // 메시지 전송
    await channeltalk.sendMessage(userChatId, {
      blocks: [{ type: 'text', value: messageText }]
    });

    console.log('[OrderNotifier] Sent ' + newStatus + ' notification to user ' + memberId + ' for order ' + orderId);
  } catch (err) {
    console.error('[OrderNotifier] Error:', err.message);
  }
}

/**
 * DB Polling 방식 (추후 활성화)
 * 5분마다 최근 변경된 주문을 조회하고 알림 전송
 */
function startPolling(dbConnection) {
  console.log('[OrderNotifier] Starting DB polling (every 5 minutes)...');
  
  setInterval(async function() {
    try {
      // 최근 5분 이내 상태 변경된 주문 조회
      // 아래는 MySQL 예시 — 실제 Veasly DB 스키마에 맞게 수정 필요
      /*
      var query = `
        SELECT o.id as order_id, o.status, o.user_id, o.updated_at,
               u.email, u.member_id
        FROM orders o
        JOIN users u ON o.user_id = u.id
        WHERE o.updated_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
          AND o.status IN (?)
          AND o.notification_sent = 0
      `;
      
      var [rows] = await dbConnection.execute(query, [NOTIFY_STATUSES]);
      
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        await notifyOrderStatus(row.member_id, row.order_id, row.status);
        
        // 알림 전송 완료 표시
        await dbConnection.execute(
          'UPDATE orders SET notification_sent = 1 WHERE id = ?',
          [row.order_id]
        );
      }
      
      if (rows.length > 0) {
        console.log('[OrderNotifier] Processed ' + rows.length + ' order notifications');
      }
      */
      
      console.log('[OrderNotifier] Polling check completed (DB not connected yet)');
    } catch (err) {
      console.error('[OrderNotifier] Polling error:', err.message);
    }
  }, 5 * 60 * 1000); // 5분
}

/**
 * Webhook 방식 (추후 활성화)
 * Veasly 백엔드에서 상태 변경 시 이 엔드포인트로 POST 요청
 * 
 * POST /api/order/status-change
 * Body: { memberId, orderId, newStatus }
 */
function getWebhookHandler() {
  return async function(req, res) {
    try {
      var memberId = req.body.memberId;
      var orderId = req.body.orderId;
      var newStatus = req.body.newStatus;

      if (!memberId || !orderId || !newStatus) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      await notifyOrderStatus(memberId, orderId, newStatus);
      res.json({ success: true, message: 'Notification sent' });
    } catch (err) {
      console.error('[OrderNotifier] Webhook error:', err.message);
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = {
  notifyOrderStatus: notifyOrderStatus,
  startPolling: startPolling,
  getWebhookHandler: getWebhookHandler,
  STATUS_MESSAGES: STATUS_MESSAGES,
  NOTIFY_STATUSES: NOTIFY_STATUSES
};
