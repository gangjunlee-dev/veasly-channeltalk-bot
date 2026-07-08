require("dotenv").config();
var axios = require("axios");

var auth = require("./auth");
var API_BASE = process.env.VEASLY_API_URL || "https://api.veasly.com";

async function apiGet(path, opts) {
  opts = opts || {};
  var token = await auth.getToken();
  // [2026-06-30] 일시 오류(500/502/503/타임아웃/네트워크) 1~2회 지수 백오프 재시도.
  // GET은 idempotent라 안전. 일시적 500을 손님에게 노출하기 전에 흡수 → 멀쩡한 주문을
  // "주문 없음"으로 오인하던 문제 완화. 4xx(진짜 없음/권한)는 재시도 안 함. 영구 실패는 기존처럼 throw.
  // opts.no5xxRetry: 결정적 500(예: 합배송 부모주문 /detail)은 재시도해도 무조건 실패하므로 1회만 시도(백엔드 헛호출·로그 3배 방지).
  var lastErr;
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      return await axios.get(API_BASE + path, {
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        timeout: 8000
      });
    } catch (e) {
      lastErr = e;
      var status = e.response && e.response.status;
      var retriable = (!status) || status >= 500 || e.code === 'ECONNABORTED' || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT';
      if (opts.no5xxRetry && status >= 500) retriable = false;
      if (!retriable || attempt >= 3) throw e;
      await new Promise(function (r) { setTimeout(r, 400 * attempt); }); // 400ms, 800ms
    }
  }
  throw lastErr;
}

// [2026-07-08] 2026-06 개편 신 체계(OrderItems 단위) — 고객 화면 9단계 명칭에 맞춤.
// 근거: 노션 CS 상태사전(396ae9b1…)/VSL-149/도메인 용어집. 9단계: 訂單完成→商品準備中→抵達物流中心→物流中心處理中→國際配送中→通關進行中→當地配送中→配送完成→購買確定.
// SHIPPING_TO_BDJ/SHIPPING_TO_HOME은 구버전 코드(신규 미사용) — 레거시 주문 대비 신 명칭으로 정렬 유지.
var STATUS_MAP = {
  "zh-TW": {
    "PAYMENT_WAITING": "等待付款",
    "PAYMENT_COMPLETED": "訂單完成",
    "ORDER_PROCESSING": "商品準備中",
    "ARRIVAL_DELAYED": "商品準備中",
    "ARRIVED_AT_SD_BDJ": "抵達物流中心",
    "ARRIVED_AT_BDJ": "抵達物流中心",
    "EZWAY_CHECKING": "物流中心處理中",
    "EZWAY_MISMATCH": "物流中心處理中",
    "EZWAY_RESOLVED": "物流中心處理中",
    "PACKING_COMPLETED": "物流中心處理中",
    "DEPARTED_TO_BDJ": "物流中心處理中",
    "FLIGHT_SCHEDULED": "物流中心處理中",
    "FLIGHT_DEPARTED": "國際配送中",
    "ARRIVED_AT_LOCAL": "通關進行中",
    "CUSTOMS_HOLD": "通關進行中",
    "DELIVERING": "當地配送中",
    "DELIVERED": "配送完成",
    "COMPLETED": "購買確定",
    "CANCEL_REQUESTED": "取消處理中",
    "CANCEL_COMPLETED": "已取消",
    "CANCEL_REJECTED": "取消未通過",
    "CANCEL_FAILED": "取消失敗",
    "SHIPPING_TO_BDJ": "抵達物流中心",
    "SHIPPING_TO_HOME": "國際配送中"
  },
  "ko": {
    "PAYMENT_WAITING": "결제 대기",
    "PAYMENT_COMPLETED": "주문 완료",
    "ORDER_PROCESSING": "상품 준비 중",
    "ARRIVAL_DELAYED": "상품 준비 중",
    "ARRIVED_AT_SD_BDJ": "물류센터 도착",
    "ARRIVED_AT_BDJ": "물류센터 도착",
    "EZWAY_CHECKING": "물류센터 처리 중",
    "EZWAY_MISMATCH": "물류센터 처리 중",
    "EZWAY_RESOLVED": "물류센터 처리 중",
    "PACKING_COMPLETED": "물류센터 처리 중",
    "DEPARTED_TO_BDJ": "물류센터 처리 중",
    "FLIGHT_SCHEDULED": "물류센터 처리 중",
    "FLIGHT_DEPARTED": "국제 배송 중",
    "ARRIVED_AT_LOCAL": "통관 진행 중",
    "CUSTOMS_HOLD": "통관 진행 중",
    "DELIVERING": "현지 배송 중",
    "DELIVERED": "배송 완료",
    "COMPLETED": "구매 확정",
    "CANCEL_REQUESTED": "취소 처리 중",
    "CANCEL_COMPLETED": "취소 완료",
    "CANCEL_REJECTED": "취소 거절됨",
    "CANCEL_FAILED": "취소 실패",
    "SHIPPING_TO_BDJ": "물류센터 도착",
    "SHIPPING_TO_HOME": "국제 배송 중"
  },
  "en": {
    "PAYMENT_WAITING": "Awaiting Payment",
    "PAYMENT_COMPLETED": "Order Placed",
    "ORDER_PROCESSING": "Preparing Item",
    "ARRIVAL_DELAYED": "Preparing Item",
    "ARRIVED_AT_SD_BDJ": "Arrived at Logistics Center",
    "ARRIVED_AT_BDJ": "Arrived at Logistics Center",
    "EZWAY_CHECKING": "Processing at Logistics Center",
    "EZWAY_MISMATCH": "Processing at Logistics Center",
    "EZWAY_RESOLVED": "Processing at Logistics Center",
    "PACKING_COMPLETED": "Processing at Logistics Center",
    "DEPARTED_TO_BDJ": "Processing at Logistics Center",
    "FLIGHT_SCHEDULED": "Processing at Logistics Center",
    "FLIGHT_DEPARTED": "International Shipping",
    "ARRIVED_AT_LOCAL": "Customs Clearance",
    "CUSTOMS_HOLD": "Customs Clearance",
    "DELIVERING": "Out for Delivery",
    "DELIVERED": "Delivered",
    "COMPLETED": "Purchase Confirmed",
    "CANCEL_REQUESTED": "Cancellation Processing",
    "CANCEL_COMPLETED": "Cancelled",
    "CANCEL_REJECTED": "Cancellation Rejected",
    "CANCEL_FAILED": "Cancellation Failed",
    "SHIPPING_TO_BDJ": "Arrived at Logistics Center",
    "SHIPPING_TO_HOME": "International Shipping"
  },
  "ja": {
    "PAYMENT_WAITING": "支払い待ち",
    "PAYMENT_COMPLETED": "注文完了",
    "ORDER_PROCESSING": "商品準備中",
    "ARRIVAL_DELAYED": "商品準備中",
    "ARRIVED_AT_SD_BDJ": "物流センター到着",
    "ARRIVED_AT_BDJ": "物流センター到着",
    "EZWAY_CHECKING": "物流センター処理中",
    "EZWAY_MISMATCH": "物流センター処理中",
    "EZWAY_RESOLVED": "物流センター処理中",
    "PACKING_COMPLETED": "物流センター処理中",
    "DEPARTED_TO_BDJ": "物流センター処理中",
    "FLIGHT_SCHEDULED": "物流センター処理中",
    "FLIGHT_DEPARTED": "国際配送中",
    "ARRIVED_AT_LOCAL": "通関手続き中",
    "CUSTOMS_HOLD": "通関手続き中",
    "DELIVERING": "現地配送中",
    "DELIVERED": "配送完了",
    "COMPLETED": "購入確定",
    "CANCEL_REQUESTED": "キャンセル処理中",
    "CANCEL_COMPLETED": "キャンセル済み",
    "CANCEL_REJECTED": "キャンセル却下",
    "CANCEL_FAILED": "キャンセル失敗",
    "SHIPPING_TO_BDJ": "物流センター到着",
    "SHIPPING_TO_HOME": "国際配送中"
  }
};

async function findUserByEmail(email) {
  if (!email) return null;
  try {
    var res = await apiGet("/admin/users/0/20?query=" + encodeURIComponent(email) + "&queryType=USER_EMAIL");
    var users = (res.data && res.data.data) || [];
    // SECURITY: the search is fuzzy/substring; only accept an EXACT email match,
    // otherwise we could identify (and expose) the wrong customer.
    var lc = String(email).toLowerCase();
    var exact = users.find(function(u) { return u.email && String(u.email).toLowerCase() === lc; });
    return exact || null;
  } catch(e) { console.error("[VEASLY API] findUserByEmail error:", e.message); return null; }
}

async function findUserByName(name) {
  if (!name) return null;
  try {
    var res = await apiGet("/admin/users/0/20?query=" + encodeURIComponent(name) + "&queryType=USER_NAME");
    var users = (res.data && res.data.data) || [];
    // SECURITY: search is fuzzy/substring; only accept an EXACT name match.
    var exact = users.find(function(u) { return u.name && String(u.name) === String(name); });
    return exact || null;
  } catch(e) { console.error("[VEASLY API] findUserByName error:", e.message); return null; }
}

async function getOrderDetail(orderNumber) {
  if (!orderNumber) return null;
  try {
    // [2026-06-30] no5xxRetry: 백엔드 /detail이 합배송 부모주문(children>0)에서 결정적으로 500을 던짐(백엔드 결함, 별도 보고).
    // 재시도해도 무조건 실패하므로 1회만 시도하고 호출부가 getOrderByNumber 폴백을 타게 둠. 로그도 warn으로(동작 불변).
    var res = await apiGet("/admin/orders/" + orderNumber + "/detail", { no5xxRetry: true });
    return res.data;
  } catch(e) {
    var st = e.response && e.response.status;
    console.warn("[VEASLY API] getOrderDetail " + orderNumber + " 실패(" + (st || e.message) + ")" + (st === 500 ? " — 합배송 추정, 폴백 처리됨" : "") );
    return null;
  }
}

async function getOrderByNumber(orderNumber) {
  if (!orderNumber) return null;
  try {
    var res = await apiGet("/admin/orders/0/10?query=" + encodeURIComponent(orderNumber) + "&queryType=ORDER_NUMBER");
    var orders = (res.data && res.data.data) || [];
    if (orders.length > 0) return orders[0];
    return null;
  } catch(e) { console.error("[VEASLY API] getOrderByNumber error:", e.message); return null; }
}

async function getUserOrders(userEmail, limit, userId) {
  try {
    limit = limit || 500;
    // [2026-06-30] 서버측 filter 트리 사용. 기존 queryType=USER_EMAIL은 서버가 무시해 전역 최근 N건을 반환했고
    // (→ 남의 주문 유출 위험 + 유저 주문이 최근 N건 밖이면 누락), 클라 필터로만 막던 위험한 방식이었음.
    // userId 있으면 USER_ID, 없으면 USER_EMAIL로 SEARCH. 서버 USER_EMAIL은 substring(contains)이라 아래 클라 정확매칭으로 이중 방어.
    var _leaf = userId
      ? { type: 'SEARCH', column: 'USER_ID', query: String(userId) }
      : { type: 'SEARCH', column: 'USER_EMAIL', query: userEmail || '' };
    var res = await apiGet("/admin/orders/0/" + limit + "?filter=" + encodeURIComponent(JSON.stringify(_leaf)));
    var orders = (res.data && res.data.data) || [];
    var emailLc = (userEmail || "").toLowerCase();
    orders = orders.filter(function(o) {
      if (!o.user) return false;
      if (userId) return String(o.user.id) === String(userId);
      return !!(emailLc && o.user.email && o.user.email.toLowerCase() === emailLc);
    });
    orders.forEach(function(o) { o._isCurrentAccount = true; o._provider = ""; });
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
  getOrderByNumber: getOrderByNumber,
  getUserOrders: getUserOrders,
  getStatusText: getStatusText,
  formatOrderInfo: formatOrderInfo,
  formatUserInfo: formatUserInfo,
  STATUS_MAP: STATUS_MAP
};