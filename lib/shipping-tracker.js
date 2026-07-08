var fs = require("fs");
require("dotenv").config();
var auth = require("./auth");
var axios = require("axios");
var channeltalk = require("./channeltalk");

var STATE_FILE = require("path").join(__dirname, "..", "data", "shipping-state.json");
var NOTIFY_LOG_FILE = require("path").join(__dirname, "..", "data", "shipping-notify-log.json");

// Status transitions that trigger notifications
// [2026-07-08] 신 체계(OrderItems 9단계) 마일스톤 알림. 처리중 세부(EZWAY/打包/航班예정)는 스팸 방지 위해 알림 제외.
var _notifyArrivedCenter = {
  "zh-TW": "📦 您的商品已抵達物流中心！正在檢查與打包，準備國際配送。",
  "ko": "📦 상품이 물류센터에 도착했습니다! 검사·포장 후 국제 배송을 준비해요.",
  "en": "📦 Your item has arrived at our logistics center! Inspecting and packing for international shipping.",
  "ja": "📦 商品が物流センターに到着しました！検査・梱包して国際配送を準備します。"
};
var NOTIFY_TRANSITIONS = {
  "ORDER_PROCESSING": {
    "zh-TW": "🚚 賣家正在準備出貨！商品即將寄往物流中心，請耐心等候。",
    "ko": "🚚 판매자가 출고를 준비 중입니다! 상품이 물류센터로 이동할 예정이에요.",
    "en": "🚚 The seller is preparing to ship! Your item will head to our logistics center soon.",
    "ja": "🚚 セラーが発送準備中です！商品は物流センターへ向かいます。"
  },
  "ARRIVED_AT_SD_BDJ": _notifyArrivedCenter,
  "ARRIVED_AT_BDJ": _notifyArrivedCenter,
  "FLIGHT_DEPARTED": {
    "zh-TW": "✈️ 您的包裹已搭機飛往台灣！\n📋 收到 EZ WAY 通知時，請記得按「申報相符」才能順利通關喔！",
    "ko": "✈️ 상품이 항공편으로 대만으로 출발했습니다!\n📋 EZ WAY 알림이 오면 「申報相符」를 눌러야 통관됩니다!",
    "en": "✈️ Your package has departed by air to Taiwan!\n📋 Tap 'declaration matched' on the EZ WAY notice to clear customs!",
    "ja": "✈️ お荷物が空路で台湾へ出発しました！\n📋 EZ WAY通知が届いたら「申報相符」を押すと通関できます！"
  },
  "ARRIVED_AT_LOCAL": {
    "zh-TW": "🛃 您的包裹已抵達台灣，通關進行中（通常約 3~4 個工作天）！請留意 EZ WAY 通知。",
    "ko": "🛃 상품이 대만에 도착해 통관 진행 중입니다(보통 3~4 영업일)! EZ WAY 알림을 확인해주세요.",
    "en": "🛃 Your package has arrived in Taiwan and is clearing customs (usually ~3-4 business days)! Please watch for the EZ WAY notice.",
    "ja": "🛃 お荷物が台湾に到着し通関手続き中です（通常3~4営業日）！EZ WAY通知にご注意ください。"
  },
  "DELIVERING": {
    "zh-TW": "🚚 您的包裹正在台灣境內配送，即將送達！",
    "ko": "🚚 상품이 대만 현지 배송 중입니다. 곧 도착해요!",
    "en": "🚚 Your package is out for local delivery in Taiwan and will arrive soon!",
    "ja": "🚚 お荷物は台湾国内で配送中です。まもなく到着します！"
  },
  "DELIVERED": {
    "zh-TW": "🎉 您的包裹已送達！感謝您在 VEASLY 購物！\n如商品有問題，可於收到後 7 天內申請退換貨。",
    "ko": "🎉 배송이 완료되었습니다! VEASLY를 이용해 주셔서 감사합니다!\n상품 문제 시 수령 후 7일 이내 교환/반품 신청 가능해요.",
    "en": "🎉 Your package has been delivered! Thank you for shopping with VEASLY!\nReturns/exchanges available within 7 days of receipt.",
    "ja": "🎉 配送完了！VEASLYでのお買い物ありがとうございます！\n商品に問題があれば受取後7日以内に返品・交換を申請できます。"
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
  // [2026-06-30] 능동 알림은 한국시간 09~22시에만 발송(야간 푸시 방지). 그 외 시간엔 스킵하고 상태도 건드리지 않음
  // → 다음 주간 실행이 누락분을 감지해 발송(알림 유실 없음).
  var _kstHour = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
  if (_kstHour < 9 || _kstHour >= 22) {
    console.log("[Tracker] off-hours (KST " + _kstHour + "h) - skip shipping-notify run");
    return { skipped: true, reason: "off-hours" };
  }
  var prevState = loadState();
  var newState = Object.assign({}, prevState); // 기존 state 유지
  var notifications = [];

  try {
    var orders = await fetchRecentOrders(10);
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

    // [2026-06-30] 다품목 주문이 같은 상태로 전환되면 품목마다 알림이 가던 문제 → 주문번호+상태 기준 1건으로 dedup
    var _seenNotif = {};
    notifications = notifications.filter(function (n) {
      var k = n.orderNumber + '|' + n.newStatus;
      if (_seenNotif[k]) return false;
      _seenNotif[k] = true;
      return true;
    });

    // Send notifications
    var sentCount = 0;
    for (var n = 0; n < notifications.length; n++) {
      if (sentCount >= 30) { console.log("[Tracker] per-run cap(30) reached; remaining " + (notifications.length - n) + " skipped this run"); break; } // [2026-06-30] 폭주 방지 안전캡
      var notif = notifications[n];
      if (!notif.userId) continue; // [2026-06-30] 회원ID로 매칭 (이메일→getUserByMemberId 불일치로 0건이던 버그 수정)

      try {
        // Find user in ChannelTalk (VEASLY 회원ID = ChannelTalk @memberId)
        var ctUser = await findCTUser(notif.userId).catch(function() { return null; });
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
