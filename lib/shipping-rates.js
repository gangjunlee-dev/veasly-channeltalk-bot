// [2026-06-30] 운임표 — 백엔드 공개 API(GET /orders/shipping-cost)에서 실시간 조회 + 1h 캐시.
// 라이브 실패 시 data/shipping-rates.json 스냅샷으로 폴백. getRateTableText는 동기(캐시 읽기)라 요청 경로 지연 없음.
// 갱신은 요금 질문 시 throttle(1h) fire-and-forget + 서버 기동 시 1회.
var fs = require('fs');
var path = require('path');
var axios = require('axios');

var SNAPSHOT_FILE = path.join(__dirname, '..', 'data', 'shipping-rates.json');
var API_BASE = process.env.VEASLY_API_URL || 'https://api.veasly.com';
var CACHE_TTL = 60 * 60 * 1000; // 1h

function loadSnapshot() {
  try { return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')); } catch (e) { return null; }
}

var _snap = loadSnapshot();
// 캐시 상태: 초기엔 스냅샷(즉시 사용 가능), 이후 라이브로 갱신
var _state = {
  tiers: (_snap && _snap.tiers) || [],
  source: 'snapshot',
  fetchedAt: 0
};
var _lastAttempt = 0;

var FEE_KEYWORDS = ['運費', '運送費', '配送費', '國際運費', '運費多少', '運費怎麼', '多少運費', '運費表', '寄到台灣', '寄台灣', '寄回台灣', '到台灣多少', '幾公斤', '多重', 'shipping fee', 'shipping cost', 'freight', 'how much to ship', '배송비', '운임', '운송비', '送料', '運賃'];
function isFeeQuestion(text) {
  if (!text) return false;
  var l = String(text).toLowerCase();
  for (var i = 0; i < FEE_KEYWORDS.length; i++) { if (l.indexOf(FEE_KEYWORDS[i].toLowerCase()) > -1) return true; }
  return false;
}

// 라이브 조회: GET /orders/shipping-cost (공개, 무인증) → country=TW 티어만 추출
async function refreshFromLive() {
  var r = await axios.get(API_BASE + '/orders/shipping-cost', { timeout: 8000 });
  var arr = Array.isArray(r.data) ? r.data : [];
  var tw = arr.filter(function (x) { return x.country === 'TW'; }).map(function (x) {
    var twd = (x.price || []).find(function (p) { return p.currency === 'TWD'; });
    return { minG: x.min, maxG: x.max, twd: twd ? twd.value : null };
  }).filter(function (t) { return t.twd != null && typeof t.minG === 'number' && t.maxG <= 25000; }) // 0~25kg만(25kg↑는 정책상 상담사 문의), 라이브엔 100kg+까지 100여개 티어가 옴
    .sort(function (a, b) { return a.minG - b.minG; });
  if (tw.length) {
    _state = { tiers: tw, source: 'live', fetchedAt: Date.now() };
    console.log('[ShippingRates] live refresh ok: ' + tw.length + ' TW tiers (0~1kg=' + (tw[0] && tw[0].twd) + ')');
  }
  return tw;
}

// 요금 질문 시 throttle 갱신 (요청 경로를 막지 않는 fire-and-forget)
function maybeRefresh() {
  if (Date.now() - _lastAttempt < CACHE_TTL) return;
  _lastAttempt = Date.now();
  refreshFromLive().catch(function (e) {
    console.error('[ShippingRates] live fetch failed, keeping ' + _state.source + ' (0~1kg=' + ((_state.tiers[0] || {}).twd) + '):', e.message);
  });
}

function getRateTableText(lang) {
  var tiers = _state.tiers || [];
  if (!tiers.length) return '';
  var header = (lang === 'ko') ? '【대만행 국제 운임표 (최신)】' : (lang === 'ja') ? '【台湾向け国際送料表（最新）】' : (lang === 'en') ? '[Latest international shipping rates to Taiwan]' : '【台灣國際運費表（最新）】';
  var lines = tiers.map(function (t) { return '・' + (t.minG / 1000) + '~' + (t.maxG / 1000) + 'kg：TWD ' + t.twd; });
  var note = (_snap && _snap.note_zh) || '';
  return header + '\n' + lines.join('\n') + (note ? ('\n' + note) : '');
}

// 서버 기동 시 1회 라이브 시도 (실패해도 스냅샷으로 동작)
refreshFromLive().catch(function () {});

module.exports = { isFeeQuestion: isFeeQuestion, getRateTableText: getRateTableText, maybeRefresh: maybeRefresh, refreshFromLive: refreshFromLive };
