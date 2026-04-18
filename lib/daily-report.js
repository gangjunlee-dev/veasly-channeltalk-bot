var fs = require('fs');
var path = require('path');
var channeltalk = require('./channeltalk');
var bizHours = require('./business-hours');

var DATA_DIR = path.join(__dirname, '..', 'data');

function loadJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'));
  } catch(e) {
    return [];
  }
}

// 전일(어제) 데이터 필터
function getYesterdayRange() {
  var now = new Date();
  // KST 기준
  var kstNow = new Date(now.getTime() + 9 * 3600000);
  var yesterday = new Date(kstNow);
  yesterday.setDate(yesterday.getDate() - 1);
  var dateStr = yesterday.toISOString().substring(0, 10);
  return dateStr;
}

function generateDailyReport() {
  var dateStr = getYesterdayRange();
  var convs = loadJSON('ai-conversations.json');
  var csatResults = loadJSON('csat-results.json');
  var cesResults = loadJSON('ces-results.json');

  // 전일 데이터 필터
  var dailyConvs = convs.filter(function(c) {
    return c.timestamp && c.timestamp.substring(0, 10) === dateStr;
  });

  var totalConvs = dailyConvs.length;
  var escalated = dailyConvs.filter(function(c) { return c.escalated; });
  var aiHandled = dailyConvs.filter(function(c) { return !c.escalated && c.type === 'ai_answer'; });

  // 에스컬레이션 사유 TOP 5
  var reasonCounts = {};
  escalated.forEach(function(c) {
    var r = c.escalationReason || 'unclassified';
    reasonCounts[r] = (reasonCounts[r] || 0) + 1;
  });
  var topReasons = Object.entries(reasonCounts)
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 5);

  // CSAT (전일)
  var dailyCsat = csatResults.filter(function(r) {
    return r.timestamp && r.timestamp.substring(0, 10) === dateStr;
  });
  var csatAvg = 0;
  if (dailyCsat.length > 0) {
    var sum = 0;
    dailyCsat.forEach(function(r) { sum += r.score; });
    csatAvg = (sum / dailyCsat.length).toFixed(1);
  }

  // AI 처리율
  var aiRate = totalConvs > 0 ? Math.round((aiHandled.length / totalConvs) * 100) : 0;
  var escRate = totalConvs > 0 ? Math.round((escalated.length / totalConvs) * 100) : 0;

  // confidence 분포
  var confBuckets = { high: 0, med: 0, low: 0, none: 0 };
  dailyConvs.forEach(function(c) {
    if (c.confidence === undefined || c.confidence === null) confBuckets.none++;
    else if (c.confidence >= 0.6) confBuckets.high++;
    else if (c.confidence >= 0.3) confBuckets.med++;
    else confBuckets.low++;
  });

  // 리포트 생성 (한국어 + 중국어 요약)
  var report = '📊 VEASLY CS 일일 리포트 (' + dateStr + ')\n';
  report += '═══════════════════════════\n\n';

  report += '📈 기본 지표\n';
  report += '  총 대화: ' + totalConvs + '건\n';
  report += '  AI 처리: ' + aiHandled.length + '건 (' + aiRate + '%)\n';
  report += '  에스컬레이션: ' + escalated.length + '건 (' + escRate + '%)\n';
  report += '  CSAT: ' + (dailyCsat.length > 0 ? csatAvg + ' (' + dailyCsat.length + '건)' : '수집 없음') + '\n\n';

  report += '🔴 에스컬레이션 TOP 5 사유\n';
  if (topReasons.length > 0) {
    topReasons.forEach(function(entry, i) {
      var label = entry[0].replace('category_', '').replace('action_request_', '');
      report += '  ' + (i + 1) + '. ' + label + ': ' + entry[1] + '건\n';
    });
  } else {
    report += '  (에스컬레이션 없음)\n';
  }

  report += '\n🤖 AI Confidence 분포\n';
  report += '  High(≥0.6): ' + confBuckets.high + ' | Med(0.3~0.6): ' + confBuckets.med + ' | Low(<0.3): ' + confBuckets.low + ' | 미기록: ' + confBuckets.none + '\n\n';

  // 미응답 질문 샘플 (에스컬레이션 중 FAQ로 커버 가능한 것)
  var faqCandidates = escalated.filter(function(c) {
    return c.escalationReason && c.escalationReason.startsWith('category_');
  }).slice(0, 3);

  if (faqCandidates.length > 0) {
    report += '💡 FAQ 강화 후보 (AI가 답변 못한 질문)\n';
    faqCandidates.forEach(function(c, i) {
      report += '  ' + (i + 1) + '. [' + (c.escalationReason || '').replace('category_', '') + '] ' + (c.userMessage || '').substring(0, 80) + '\n';
    });
    report += '\n';
  }

  report += '═══════════════════════════\n';
  report += '🎯 CS Score 목표: 3.0 | 현재: 2.48\n';
  report += '📌 다음 액션: FAQ 강화 큐 확인 → /api/analytics/faq-candidates';

  return { report: report, stats: { date: dateStr, total: totalConvs, aiHandled: aiHandled.length, escalated: escalated.length, aiRate: aiRate, escRate: escRate, csatAvg: csatAvg, csatCount: dailyCsat.length, topReasons: topReasons } };
}

async function sendDailyReport() {
  try {
    var result = generateDailyReport();
    console.log('[DailyReport] Generated for', result.stats.date);
    console.log('[DailyReport]', result.report.substring(0, 200) + '...');

    // 채널톡 그룹 발송
    var groupId = process.env.REPORT_GROUP_ID;
    if (groupId) {
      await channeltalk.sendGroupMessage(groupId, {
        blocks: [{ type: 'text', value: result.report }]
      }, 'VEASLY CS Bot');
      console.log('[DailyReport] Sent to group:', groupId);
    } else {
      console.log('[DailyReport] REPORT_GROUP_ID not set. Report saved locally only.');
    }

    // 로컬 저장 (히스토리)
    var histFile = path.join(DATA_DIR, 'daily-reports.json');
    var history = [];
    try { history = JSON.parse(fs.readFileSync(histFile, 'utf8')); } catch(e) {}
    history.push({ timestamp: new Date().toISOString(), stats: result.stats });
    // 최근 90일만 보관
    if (history.length > 90) history = history.slice(-90);
    fs.writeFileSync(histFile, JSON.stringify(history, null, 2));

    return result;
  } catch(e) {
    console.error('[DailyReport] Error:', e.message);
    return null;
  }
}

module.exports = {
  generateDailyReport: generateDailyReport,
  sendDailyReport: sendDailyReport
};
