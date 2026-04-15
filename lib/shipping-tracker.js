var fs = require("fs");
require("dotenv").config();
var auth = require("./auth");
var axios = require("axios");
var channeltalk = require("./channeltalk");

var STATE_FILE = require("path").join(__dirname, "..", "data", "shipping-state.json");
var NOTIFY_LOG_FILE = require("path").join(__dirname, "..", "data", "shipping-notify-log.json");

// Status transitions that trigger notifications
var NOTIFY_TRANSITIONS = {
  "ORDER_PROCESSING": {
    "zh-TW": "🚛 您的商品正在韓國國內配送中！正從賣家寄往VEASLY倉庫，請耐心等候。",
    "ko": "🚛 상품이 한국 내 배송 중입니다! 판매자에서 VEASLY 창고로 이동 중이에요.",
    "en": "🚛 Your item is being shipped within Korea to VEASLY warehouse!",
    "ja": "🚛 商品が韓国国内で配送中です！VEASLY倉庫へ移動しています。"
  },
  "SHIPPING_TO_BDJ": {
    "zh-TW": "📦 您的商品已到達VEASLY倉庫！我們正在準備國際包裹，即將寄出。",
    "ko": "📦 상품이 VEASLY 창고에 도착했습니다! 국제 배송 준비 중이에요.",
    "en": "📦 Your item has arrived at VEASLY warehouse! Preparing for international shipping.",
    "ja": "📦 商品がVEASLY倉庫に到着しました！国際発送の準備中です。"
  },
  "SHIPPING_TO_HOME": {
    "zh-TW": "✈️ 您的包裹已從韓國寄出，正在前往台灣途中！預計5-10個工作天送達。\n📋 收到EZ WAY通知時，請記得按「申報相符」才能順利通關喔！",
    "ko": "✈️ 한국에서 대만으로 발송 완료! 국제 배송 중입니다. 5-10 영업일 소요 예상.",
    "en": "✈️ Your package has been shipped from Korea to Taiwan! Estimated 5-10 business days.",
    "ja": "✈️ 韓国から台湾へ発送済みです！5-10営業日でお届け予定。"
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


// Repurchase campaign - send message 7 days after COMPLETED
var REPURCHASE_FILE = require("path").join(__dirname, "..", "data", "repurchase-sent.json");

function loadRepurchaseSent() {
  try { return JSON.parse(fs.readFileSync(REPURCHASE_FILE, "utf8")); } catch(e) { return {}; }
}

function saveRepurchaseSent(data) {
  var dir = require("path").dirname(REPURCHASE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(REPURCHASE_FILE, JSON.stringify(data));
}

async function checkRepurchaseCampaign() {
  console.log("[Repurchase] Checking for completed orders...");
  var sent = loadRepurchaseSent();
  var now = Date.now();
  var SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  var state = loadState();
  var campaignsSent = 0;

  for (var itemKey in state) {
    var item = state[itemKey];
    if (item.status !== "COMPLETED") continue;
    if (sent[itemKey]) continue;

    var completedAt = item.lastUpdated || item.timestamp;
    if (!completedAt) continue;
    var elapsed = now - new Date(completedAt).getTime();
    if (elapsed < SEVEN_DAYS || elapsed > 14 * 24 * 60 * 60 * 1000) continue;

    // Find user's chat
    if (!item.userId) continue;
    try {
      var msgs = {
        "zh-TW": "🎉 " + (item.userName || "朋友") + " 您好！\n\n您的訂單已順利送達一週了，希望您喜歡！\n\n" + (item.points && item.points >= 100 ? "💰 您目前有 " + item.points + " 點數可以使用喔！\n\n" : "") + "🛍️ 最近韓國有很多新商品上架，歡迎再來逛逛：\nhttps://veasly.com\n\n有任何問題隨時找我們！",
        "ko": "🎉 " + (item.userName || "고객") + "님 안녕하세요!\n\n주문이 도착한 지 일주일이 됐네요, 만족하셨나요?\n\n" + (item.points && item.points >= 100 ? "💰 현재 " + item.points + " 포인트 사용 가능합니다!\n\n" : "") + "🛍️ 한국 신상품이 많이 입고됐어요:\nhttps://veasly.com\n\n문의사항은 언제든 말씀해주세요!"
      };
      var lang = item.lang || "zh-TW";
      var msg = msgs[lang] || msgs["zh-TW"];
      await channeltalk.sendMessage(item.chatId, { blocks: [{ type: "text", value: msg }] });
      sent[itemKey] = { sentAt: new Date().toISOString() };
      campaignsSent++;
      console.log("[Repurchase] Sent to", item.userName || itemKey);
    } catch(e) { console.error("[Repurchase] Error:", e.message); }
  }

  saveRepurchaseSent(sent);
  console.log("[Repurchase] Done. Campaigns sent:", campaignsSent);
  return campaignsSent;
}

module.exports = {
  checkRepurchaseCampaign: checkRepurchaseCampaign,
  checkShippingUpdates: checkShippingUpdates,
  fetchRecentOrders: fetchRecentOrders,
  loadState: loadState
};
