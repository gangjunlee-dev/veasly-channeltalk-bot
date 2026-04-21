'use strict';
var fs = require('fs');
var path = require('path');

var CSAT_SENT_FILE = path.join(__dirname, '..', 'data', 'csat-sent.json');

function load() {
  try {
    if (fs.existsSync(CSAT_SENT_FILE)) {
      return JSON.parse(fs.readFileSync(CSAT_SENT_FILE, 'utf8'));
    }
  } catch(e) { console.error('[CSAT] Load error:', e.message); }
  return {};
}

function save(data) {
  try {
    var dir = path.dirname(CSAT_SENT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CSAT_SENT_FILE, JSON.stringify(data), 'utf8');
  } catch(e) { console.error('[CSAT] Save error:', e.message); }
}

// 이미 CSAT를 보냈는지 확인
function alreadySent(chatId) {
  var data = load();
  if (!data[chatId]) return false;
  // 어떤 형식이든 존재하면 이미 보낸 것
  return true;
}

// CSAT 발송 기록 (통일된 형식)
function markSent(chatId, source) {
  var data = load();
  data[chatId] = {
    sentAt: Date.now(),
    count: (data[chatId] && typeof data[chatId] === 'object' && data[chatId].count) ? data[chatId].count + 1 : 1,
    source: source || 'unknown'
  };
  save(data);
  console.log('[CSAT] Marked sent:', chatId, '| source:', source);
}

// CSAT 스킵 기록 (봇만 응답 등)
function markSkipped(chatId, reason) {
  var data = load();
  data[chatId] = { sentAt: Date.now(), count: 0, skipped: true, reason: reason || '' };
  save(data);
}

// warning만 기록 (12h+ 대기)
function markWarning(chatId) {
  var data = load();
  if (!data[chatId]) {
    data[chatId] = { sentAt: Date.now(), count: 0, warning: true };
    save(data);
  }
}

// 삭제 (채팅 종료 시)
function remove(chatId) {
  var data = load();
  delete data[chatId];
  save(data);
}

// 전체 데이터 반환
function getAll() {
  return load();
}

module.exports = {
  alreadySent: alreadySent,
  markSent: markSent,
  markSkipped: markSkipped,
  markWarning: markWarning,
  remove: remove,
  getAll: getAll,
  load: load,
  save: save
};
