require("dotenv").config();
var axios = require("axios");

var auth = require("./auth");
var API_BASE = process.env.VEASLY_API_URL || "https://api.veasly.com";

async function apiGet(path) {
  var token = await auth.getToken();
  return axios.get(API_BASE + path, {
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }
  });
}

var STATUS_MAP = {
  "zh-TW": {
    "PAYMENT_WAITING": "等待付款",
    "PAYMENT_COMPLETED": "已付款完成",
    "ORDER_PROCESSING": "韓國國內配送中",
    "SHIPPING_TO_BDJ": "已到達VEASLY倉庫",
    "SHIPPING_TO_HOME": "國際配送中（寄往台灣途中）",
    "COMPLETED": "配送完成",
    "CANCEL_COMPLETED": "已取消"
  },
  "ko": {
    "PAYMENT_WAITING": "결제 대기",
    "PAYMENT_COMPLETED": "결제 완료",
    "ORDER_PROCESSING": "한국 국내 배송 중",
    "SHIPPING_TO_BDJ": "VEASLY 창고 도착",
    "SHIPPING_TO_HOME": "국제 배송 중 (대만으로 발송)",
    "COMPLETED": "배송 완료",
    "CANCEL_COMPLETED": "취소 완료"
  },
  "en": {
    "PAYMENT_WAITING": "Awaiting Payment",
    "PAYMENT_COMPLETED": "Payment Completed",
    "ORDER_PROCESSING": "Shipping within Korea",
    "SHIPPING_TO_BDJ": "Arrived at VEASLY Warehouse",
    "SHIPPING_TO_HOME": "International Shipping (On the way to Taiwan)",
    "COMPLETED": "Delivered",
    "CANCEL_COMPLETED": "Cancelled"
  },
  "ja": {
    "PAYMENT_WAITING": "支払い待ち",
    "PAYMENT_COMPLETED": "決済完了",
    "ORDER_PROCESSING": "韓国国内配送中",
    "SHIPPING_TO_BDJ": "VEASLY倉庫に到着",
    "SHIPPING_TO_HOME": "国際配送中（台湾へ発送済み）",
    "COMPLETED": "配送完了",
    "CANCEL_COMPLETED": "キャンセル済み"
  }
};

async function findUserByEmail(email) {
  if (!email) return null;
  try {
    var res = await apiGet("/admin/users/0/20?query=" + encodeURIComponent(email) + "&queryType=USER_EMAIL");
    if (res.data && res.data.data && res.data.data.length > 0) return res.data.data[0];
    return null;
  } catch(e) { console.error("[VEASLY API] findUserByEmail error:", e.message); return null; }
}

async function findUserByName(name) {
  if (!name) return null;
  try {
    var res = await apiGet("/admin/users/0/20?query=" + encodeURIComponent(name) + "&queryType=USER_NAME");
    if (res.data && res.data.data && res.data.data.length > 0) return res.data.data[0];
    return null;
  } catch(e) { console.error("[VEASLY API] findUserByName error:", e.message); return null; }
}

async function getOrderDetail(orderNumber) {
  if (!orderNumber) return null;
  try {
    var res = await apiGet("/admin/orders/" + orderNumber + "/detail");
    return res.data;
  } catch(e) { console.error("[VEASLY API] getOrderDetail error:", e.message); return null; }
}

async function getUserOrders(userEmail, limit, userId) {
  try {
    limit = limit || 500;
    var res = await apiGet("/admin/orders/0/" + limit + "?queryType=USER_EMAIL&query=" + encodeURIComponent(userEmail));
    var orders = (res.data && res.data.data) || [];
    if (userId) {
      // Build provider map from user search
      var providerMap = {};
      try {
        var uRes = await apiGet("/admin/users/0/50?query=" + encodeURIComponent(userEmail) + "&queryType=USER_EMAIL");
        var users = (uRes.data && uRes.data.data) || [];
        users.forEach(function(u) { providerMap[String(u.id)] = u.provider || ""; });
      } catch(e) {}
      orders.forEach(function(o) {
        if (o.user) {
          o._isCurrentAccount = String(o.user.id) === String(userId);
          o._provider = providerMap[String(o.user.id)] || "";
        }
      });
    }
    return orders;
  } catch(e) { console.error("[VEASLY API] getUserOrders error:", e.message); return []; }
}

function getStatusText(status, lang) {
  var map = STATUS_MAP[lang] || STATUS_MAP["zh-TW"];
  return map[status] || status;
}

function formatOrderInfo(items, lang) {
  if (!items || items.length === 0) return "";
  var lines = [];
  items.forEach(function(item, idx) {
    var name = (item.product && item.product.name) || "商品";
    if (name.length > 25) name = name.substring(0, 25) + "...";
    var statusText = getStatusText(item.status, lang);
    lines.push((idx + 1) + ". " + name + " - " + statusText);
  });
  return lines.join("\n");
}

function formatUserInfo(user, lang) {
  if (!user) return "";
  var t = {
    "zh-TW": "[會員資訊] " + user.name + " | 訂單: " + (user.requestCount || 0) + "筆 | 點數: " + (user.credit || 0),
    "ko": "[회원정보] " + user.name + " | 주문: " + (user.requestCount || 0) + "건 | 포인트: " + (user.credit || 0),
    "en": "[Member] " + user.name + " | Orders: " + (user.requestCount || 0) + " | Points: " + (user.credit || 0),
    "ja": "[会員] " + user.name + " | 注文: " + (user.requestCount || 0) + "件 | ポイント: " + (user.credit || 0)
  };
  return t[lang] || t["zh-TW"];
}


async function findUserById(memberId, email) {
  try {
    // Search by email first, then filter by memberId
    if (email) {
      var res = await apiGet("/admin/users/0/50?query=" + encodeURIComponent(email) + "&queryType=USER_EMAIL");
      var users = (res.data && res.data.data) || [];
      var match = users.find(function(u) { return String(u.id) === String(memberId); });
      if (match) return match;
    }
    // If no email or no match, search all and filter
    var res2 = await apiGet("/admin/users/0/50?query=" + encodeURIComponent(String(memberId)));
    var users2 = (res2.data && res2.data.data) || [];
    var match2 = users2.find(function(u) { return String(u.id) === String(memberId); });
    return match2 || null;
  } catch(err) {
    console.error("[VEASLY API] findUserById error:", err.message);
    return null;
  }
}

module.exports = {
  findUserByEmail: findUserByEmail,
  findUserById: findUserById,
  findUserByName: findUserByName,
  getOrderDetail: getOrderDetail,
  getUserOrders: getUserOrders,
  getStatusText: getStatusText,
  formatOrderInfo: formatOrderInfo,
  formatUserInfo: formatUserInfo,
  STATUS_MAP: STATUS_MAP
};