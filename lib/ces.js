'use strict';
var fs = require('fs');
var path = require('path');

var CES_PENDING_FILE = path.join(__dirname, '..', 'data', 'ces-pending.json');
var CES_RESULTS_FILE = path.join(__dirname, '..', 'data', 'ces-results.json');

function loadPending() {
  try {
    if (fs.existsSync(CES_PENDING_FILE)) {
      return JSON.parse(fs.readFileSync(CES_PENDING_FILE, 'utf8'));
    }
  } catch(e) { console.error('[CES] Load pending error:', e.message); }
  return {};
}

function savePending(data) {
  try {
    fs.writeFileSync(CES_PENDING_FILE, JSON.stringify(data), 'utf8');
  } catch(e) { console.error('[CES] Save pending error:', e.message); }
}

function isPending(chatId) {
  var data = loadPending();
  if (!data[chatId]) return false;
  if (Date.now() - data[chatId].timestamp > 600000) {
    delete data[chatId];
    savePending(data);
    return false;
  }
  return true;
}

function getPending(chatId) {
  var data = loadPending();
  return data[chatId] || null;
}

function markPending(chatId, info) {
  var data = loadPending();
  data[chatId] = {
    timestamp: Date.now(),
    chatId: chatId,
    userId: (info && info.userId) || '',
    managerId: (info && info.managerId) || '',
    csatScore: (info && info.csatScore) || 0
  };
  savePending(data);
  console.log('[CES] Marked pending:', chatId);
}

function removePending(chatId) {
  var data = loadPending();
  delete data[chatId];
  savePending(data);
}

function saveResult(entry) {
  try {
    var data = [];
    if (fs.existsSync(CES_RESULTS_FILE)) {
      data = JSON.parse(fs.readFileSync(CES_RESULTS_FILE, 'utf8'));
    }
    data.push(entry);
    if (data.length > 1000) data = data.slice(-1000);
    fs.writeFileSync(CES_RESULTS_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('[CES] Result saved. Total:', data.length);
  } catch(e) { console.error('[CES] Save result error:', e.message); }
}

module.exports = {
  isPending: isPending,
  getPending: getPending,
  markPending: markPending,
  removePending: removePending,
  saveResult: saveResult
};
