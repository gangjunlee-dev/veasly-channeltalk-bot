var fs = require('fs');
var path = require('path');

var DATA_DIR = path.join(__dirname, '..', 'data');
var QUEUE_FILE = path.join(DATA_DIR, 'faq-candidates.json');

function loadQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  } catch(e) {
    return { candidates: [], lastUpdated: null, weeklyReport: [] };
  }
}

function saveQueue(queue) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

// 에스컬레이션 로그에서 FAQ 후보 추출
function updateCandidates() {
  var convFile = path.join(DATA_DIR, 'ai-conversations.json');
  var convs = [];
  try { convs = JSON.parse(fs.readFileSync(convFile, 'utf8')); } catch(e) { return; }

  var queue = loadQueue();
  var existingIds = {};
  queue.candidates.forEach(function(c) { existingIds[c.chatId + '_' + c.timestamp] = true; });

  // 최근 7일 에스컬레이션만
  var cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  var recent = convs.filter(function(c) {
    return c.escalated && c.timestamp && c.timestamp >= cutoff;
  });

  // 키워드 빈도 계산
  var keywordMap = {};
  var kwList = ['客服', '訂單', '出貨', '運費', '退款', '退貨', '合併', '寄送', '到貨',
                '報價', '下單', '付款', '商品', '取消', '物流', '配送', '帳號', '點數',
                '交換', '換貨', '尺寸', '地址', '收件', 'ez way', 'ezway'];

  recent.forEach(function(c) {
    var msg = (c.userMessage || '').toLowerCase();
    var matchedKw = [];
    kwList.forEach(function(kw) {
      if (msg.includes(kw.toLowerCase())) matchedKw.push(kw);
    });

    var id = (c.chatId || '') + '_' + (c.timestamp || '');
    if (!existingIds[id]) {
      queue.candidates.push({
        chatId: c.chatId || '',
        timestamp: c.timestamp || '',
        userMessage: (c.userMessage || '').substring(0, 200),
        lang: c.lang || 'unknown',
        escalationReason: c.escalationReason || 'unclassified',
        keywords: matchedKw,
        confidence: c.confidence || null,
        status: 'pending'  // pending → approved → added / rejected
      });
      existingIds[id] = true;
    }

    matchedKw.forEach(function(kw) {
      keywordMap[kw] = (keywordMap[kw] || 0) + 1;
    });
  });

  // 오래된 후보 정리 (30일 이상)
  var oldCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  queue.candidates = queue.candidates.filter(function(c) {
    return c.timestamp >= oldCutoff || c.status === 'approved';
  });

  queue.lastUpdated = new Date().toISOString();
  saveQueue(queue);

  return {
    totalCandidates: queue.candidates.filter(function(c) { return c.status === 'pending'; }).length,
    keywordFrequency: keywordMap,
    newAdded: recent.length
  };
}

// 주간 FAQ 후보 리포트 생성
function generateWeeklyFAQReport() {
  var queue = loadQueue();
  var pending = queue.candidates.filter(function(c) { return c.status === 'pending'; });

  // 사유별 그룹핑
  var byReason = {};
  pending.forEach(function(c) {
    var r = c.escalationReason || 'unclassified';
    if (!byReason[r]) byReason[r] = [];
    byReason[r].push(c);
  });

  // 키워드 빈도
  var kwFreq = {};
  pending.forEach(function(c) {
    (c.keywords || []).forEach(function(kw) {
      kwFreq[kw] = (kwFreq[kw] || 0) + 1;
    });
  });

  var sortedReasons = Object.entries(byReason).sort(function(a, b) { return b[1].length - a[1].length; });
  var sortedKw = Object.entries(kwFreq).sort(function(a, b) { return b[1] - a[1]; });

  var report = '🔧 VEASLY AI 강화 큐 주간 리포트\n';
  report += '═══════════════════════════\n';
  report += '📋 미처리 FAQ 후보: ' + pending.length + '건\n\n';

  report += '📊 사유별 분포 (TOP 10)\n';
  sortedReasons.slice(0, 10).forEach(function(entry, i) {
    var label = entry[0].replace('category_', '').replace('action_request_', '');
    report += '  ' + (i + 1) + '. ' + label + ': ' + entry[1].length + '건\n';
    // 대표 질문 1개
    var sample = entry[1][0];
    report += '     예) ' + (sample.userMessage || '').substring(0, 60) + '\n';
  });

  report += '\n🔑 핵심 키워드 (TOP 10)\n';
  sortedKw.slice(0, 10).forEach(function(entry, i) {
    report += '  ' + (i + 1) + '. ' + entry[0] + ': ' + entry[1] + '회\n';
  });

  report += '\n💡 추천 액션\n';
  if (sortedReasons.length > 0) {
    var topReason = sortedReasons[0];
    report += '  → "' + topReason[0].replace('category_', '') + '" 관련 FAQ ' + Math.min(topReason[1].length, 3) + '건 추가 권장\n';
  }
  report += '  → /api/analytics/faq-candidates 에서 상세 확인\n';
  report += '═══════════════════════════';

  return report;
}

// 후보 상태 변경
function updateCandidateStatus(chatId, timestamp, status) {
  var queue = loadQueue();
  queue.candidates.forEach(function(c) {
    if (c.chatId === chatId && c.timestamp === timestamp) {
      c.status = status; // approved, rejected, added
    }
  });
  saveQueue(queue);
}

module.exports = {
  updateCandidates: updateCandidates,
  generateWeeklyFAQReport: generateWeeklyFAQReport,
  updateCandidateStatus: updateCandidateStatus,
  loadQueue: loadQueue
};
