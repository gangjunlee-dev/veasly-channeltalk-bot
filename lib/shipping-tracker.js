require("dotenv").config();
var auth = require("./auth");
var axios = require("axios");
var channeltalk = require("./channeltalk");

var STATE_FILE = require("path").join(__dirname, "..", "data", "shipping-state.json");
var NOTIFY_LOG_FILE = require("path").join(__dirname, "..", "data", "shipping-notify-log.json");

// Status transitions that trigger notifications
var NOTIFY_TRANSITIONS = {
  "ORDER_PROCESSING": {
    "zh-TW": "📦 您的訂單已開始處理！我們正在為您準備商品。",
    "ko": "📦 주문 처리가 시작되었습니다! 상품을 준비 중입니다.",
    "en": "📦 Your order is now being processed!",
    "ja": "📦 ご注文の処理が開始されました！"
  },
  "SHIPPING_TO_BDJ": {
    "zh-TW": "🚛 您的商品已從賣家出貨，正在運往VEASLY集貨倉庫！",
    "ko": "🚛 상품이 판매자에서 출고되어 VEASLY 물류센터로 이동 중입니다!",
    "en": "🚛 Your item has been shipped from the seller to VEASLY warehouse!",
    "ja": "🚛 商品が出荷され、VEASLY倉庫に向かっています！"
  },
  "SHIPPING_TO_HOME": {
    "zh-TW": "✈️ 您的包裹已從韓國寄出，國際配送中！預計5-10個工作天送達。\n📋 收到EZ WAY通知時，請記得按「申報相符」才能順利通關喔！",
    "ko": "✈️ 한국에서 출발! 국제 배송 중입니다. 5-10 영업일 소요 예상.",
    "en": "✈️ Your package has left Korea! International shipping in progress. Estimated 5-10 business days.",
    "ja": "✈️ 韓国から発送されました！国際配送中です。5-10営業日でお届け予定。"
  },
  "COMPLETED": {
    "zh-TW": "🎉 您的訂單已完成配送！感謝您在VEASLY購物！\n如有任何問題，歡迎隨時聯繫我們。",
    "ko": "🎉 배송이 완료되었습니다! VEASLY를 이용해 주셔서 감사합니다!",
    "en": "🎉 Your order has been delivered! Thank you for shopping with VEASLY!",
    "ja": "🎉 配送完了！VEASLYでのお買い物ありがとうございます！"
  }
};

// Load previous state
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }
  } catch(e) {}
  return {};
}

// Save current state
function saveState(state) {
  try {
    var dir = require("path").dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), "utf8");
  } catch(e) { console.error("[Tracker] Save state error:", e.message); }
}

// Save notification log
function logNotification(entry) {
  try {
    var dir = require("path").dirname(NOTIFY_LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var logs = [];
    if (fs.existsSync(NOTIFY_LOG_FILE)) {
      logs = JSON.parse(fs.readFileSync(NOTIFY_LOG_FILE, "utf8"));
    }
    logs.push(entry);
    if (logs.length > 500) logs = logs.slice(-500);
    fs.writeFileSync(NOTIFY_LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
  } catch(e) {}
}

// Find ChannelTalk user by email
async function findCTUser(email) {
  try {
    var res = await channeltalk.getUserByMemberId(email);
    return res;
  } catch(e) {
    return null;
  }
}

// Get recent orders with item-level status
async function fetchRecentOrders(pages) {
  pages = pages || 3;
  var allOrders = [];
  try {
    var token = await auth.getToken();
    for (var p = 0; p < pages; p++) {
      var skip = p * 50;
      var res = await axios.get("https://api.veasly.com/admin/orders/" + skip + "/50", {
        headers: { Authorization: "Bearer " + token }
      });
      var orders = (res.data && res.data.data) || [];
      allOrders = allOrders.concat(orders);
      if (orders.length < 50) break;
    }
  } catch(e) {
    console.error("[Tracker] fetchRecentOrders error:", e.message);
  }
  return allOrders;
}

// Main tracking function
async function checkShippingUpdates() {
  console.log("[Tracker] Checking shipping status updates...");
  var prevState = loadState();
  var newState = {};
  var notifications = [];

  try {
    var orders = await fetchRecentOrders(3);
    console.log("[Tracker] Fetched", orders.length, "recent orders");

    for (var i = 0; i < orders.length; i++) {
      var order = orders[i];
      var items = order.items || [];

      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        var itemKey = order.orderNumber + "_" + (item.orderItemNumber || item.id);
        var currentStatus = item.status;
        var prevStatus = prevState[itemKey];

        newState[itemKey] = currentStatus;

        // Detect status change
        if (prevStatus && prevStatus !== currentStatus && NOTIFY_TRANSITIONS[currentStatus]) {
          notifications.push({
            orderNumber: order.orderNumber,
            itemName: item.product ? item.product.name : "商品",
            itemNumber: item.orderItemNumber || item.id,
            oldStatus: prevStatus,
            newStatus: currentStatus,
            userEmail: order.user ? order.user.email : null,
            userId: order.user ? order.user.id : null
          });
        }
      }
    }

    // Save new state
    saveState(newState);

    // Send notifications
    var sentCount = 0;
    for (var n = 0; n < notifications.length; n++) {
      var notif = notifications[n];
      if (!notif.userEmail) continue;

      try {
        // Find user in ChannelTalk
        var ctUser = await findCTUser(notif.userEmail).catch(function() { return null; });
        if (!ctUser || !ctUser.user) continue;

        // Create or find chat
        var userId = ctUser.user.id;
        var lang = (ctUser.user.profile && ctUser.user.profile.language) || "zh-TW";
        if (lang !== "zh-TW" && lang !== "ko" && lang !== "en" && lang !== "ja") lang = "zh-TW";

        var statusMsg = NOTIFY_TRANSITIONS[notif.newStatus];
        var msg = statusMsg[lang] || statusMsg["zh-TW"];
        var fullMsg = "🔔 訂單更新通知 / 주문 업데이트\n\n" +
          "📋 " + notif.orderNumber + "\n" +
          msg + "\n\n" +
          (lang === "ko" ? "궁금한 점이 있으시면 언제든 문의해주세요!" : 
           lang === "en" ? "Feel free to ask if you have any questions!" :
           lang === "ja" ? "ご質問がありましたらお気軽にどうぞ！" :
           "如有任何問題，歡迎隨時詢問！");

        // Send via new chat
        var chat = await channeltalk.createUserChat(userId);
        if (chat && chat.userChat) {
          await channeltalk.sendMessage(chat.userChat.id, { blocks: [{ type: "text", value: fullMsg }] });
          sentCount++;
          logNotification({
            timestamp: new Date().toISOString(),
            orderNumber: notif.orderNumber,
            oldStatus: notif.oldStatus,
            newStatus: notif.newStatus,
            userEmail: notif.userEmail,
            sent: true
          });
          console.log("[Tracker] Notified:", notif.orderNumber, notif.oldStatus, "->", notif.newStatus);
        }
      } catch(sendErr) {
        console.error("[Tracker] Send error for", notif.orderNumber, ":", sendErr.message);
        logNotification({
          timestamp: new Date().toISOString(),
          orderNumber: notif.orderNumber,
          oldStatus: notif.oldStatus,
          newStatus: notif.newStatus,
          userEmail: notif.userEmail,
          sent: false,
          error: sendErr.message
        });
      }
    }

    var result = {
      timestamp: new Date().toISOString(),
      ordersChecked: orders.length,
      stateChanges: notifications.length,
      notificationsSent: sentCount
    };
    console.log("[Tracker] Check complete:", JSON.stringify(result));
    return result;
  } catch(e) {
    console.error("[Tracker] checkShippingUpdates error:", e.message);
    return { error: e.message };
  }
}

module.exports = {
  checkShippingUpdates: checkShippingUpdates,
  fetchRecentOrders: fetchRecentOrders,
  loadState: loadState
};
