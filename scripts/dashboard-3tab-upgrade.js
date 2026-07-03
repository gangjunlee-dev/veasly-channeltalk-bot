var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// ============================================
// TAB 1: 종합현황 - CSAT 대기 카드 → v2 만족률 + 오프시간 카드
// ============================================

// 1-a) 기존 CSAT 대기 카드를 v2 만족률 + 오프시간 비율로 교체
// 기존 fetch에 csat-v2-stats + cs-score-metrics 추가
var oldOverviewFetch = [
  "  Promise.all([",
  "    fetch(API_BASE + '/api/analytics/report?days=' + days).then(function(r) { return r.json(); }),",
  "    fetch('/api/analytics/auto-close').then(function(r) { return r.json(); }).catch(function() { return null; })",
  "  ]).then(function(results) {",
  "    var data = results[0];",
  "    var autoClose = results[1];"
].join("\n");

var newOverviewFetch = [
  "  Promise.all([",
  "    fetch(API_BASE + '/api/analytics/report?days=' + days).then(function(r) { return r.json(); }),",
  "    fetch('/api/analytics/auto-close').then(function(r) { return r.json(); }).catch(function() { return null; }),",
  "    fetch('/api/analytics/csat-v2-stats?days=' + days).then(function(r) { return r.json(); }).catch(function() { return null; }),",
  "    fetch('/api/analytics/cs-score-metrics?days=' + days).then(function(r) { return r.json(); }).catch(function() { return null; })",
  "  ]).then(function(results) {",
  "    var data = results[0];",
  "    var autoClose = results[1];",
  "    var csatV2 = results[2];",
  "    var csMetrics = results[3];"
].join("\n");

if (code.indexOf(oldOverviewFetch) > -1) {
  code = code.replace(oldOverviewFetch, newOverviewFetch);
  console.log("  [1a] 종합현황 fetch에 csat-v2 + cs-metrics 추가");
  changes++;
}

// 1-b) CSAT 대기 카드를 v2 만족률 + 오프시간 비율로 교체
var oldCsatCard = "    if (autoClose && autoClose.success) {\n      html += card('CSAT 대기', autoClose.csatPending, '건', autoClose.csatPending > 10 ? 'yellow' : 'green', '12h 경고 → 16h 종료', '📋 CSAT 설문 발송(12h 경고 시) 후 미응답 건수입니다. 영업시간 16h에 자동종료됩니다.');\n    }";

var newCsatCards = [
  "    // CSAT v2 만족률",
  "    if (csatV2 && csatV2.total > 0) {",
  "      var _csatRate = csatV2.satisfactionRate || 0;",
  "      var _csatColor = _csatRate >= 80 ? 'green' : _csatRate >= 50 ? 'yellow' : 'red';",
  "      html += card('고객 만족률', _csatRate + '%', '', _csatColor, '응답 ' + csatV2.total + '건', '📋 CSAT v2 설문 기준 만족률입니다. 만족+불만족 응답 비율.');",
  "    } else {",
  "      html += card('고객 만족률', '-', '', 'yellow', '설문 수집 중', '📋 CSAT v2 설문 응답이 아직 없습니다.');",
  "    }",
  "    // 오프시간 비율",
  "    if (csMetrics && csMetrics.businessHours) {",
  "      var _bh = csMetrics.businessHours;",
  "      var _offRate = _bh.offHourRate || 0;",
  "      var _offColor = _offRate > 60 ? 'red' : _offRate > 40 ? 'yellow' : 'green';",
  "      html += card('오프시간 문의', _offRate + '%', '', _offColor, '영업 ' + _bh.bizHour + '건 / 오프 ' + _bh.offHour + '건', '🌙 영업시간(평일 10-19시) 외 접수된 문의 비율입니다.');",
  "    }",
  "    // CSAT 대기 (기존 유지)",
  "    if (autoClose && autoClose.success && autoClose.csatPending > 0) {",
  "      html += card('설문 대기', autoClose.csatPending, '건', autoClose.csatPending > 5 ? 'yellow' : 'green', 'CSAT 발송 후 미응답', '📋 CSAT 설문 발송 후 미응답 건수입니다.');",
  "    }"
].join("\n");

if (code.indexOf(oldCsatCard) > -1) {
  code = code.replace(oldCsatCard, newCsatCards);
  console.log("  [1b] 종합현황 CSAT 대기 → v2 만족률 + 오프시간 카드 교체");
  changes++;
}

// ============================================
// TAB 2: CS Score - CES 상세를 CSAT v2로 교체
// ============================================

// 2-a) CS Score fetch에 csat-v2-stats 추가
var oldCSFetch = [
  "    fetch('/api/analytics/cs-score-metrics?days=' + days).then(function(r){ return r.json(); }),",
  "    fetch('/api/analytics/manager-performance?days=' + days).then(function(r){ return r.json(); }).catch(function(){ return null; })"
].join("\n");

var newCSFetch = [
  "    fetch('/api/analytics/cs-score-metrics?days=' + days).then(function(r){ return r.json(); }),",
  "    fetch('/api/analytics/manager-performance?days=' + days).then(function(r){ return r.json(); }).catch(function(){ return null; }),",
  "    fetch('/api/analytics/csat-v2-stats?days=' + days).then(function(r){ return r.json(); }).catch(function(){ return null; })"
].join("\n");

if (code.indexOf(oldCSFetch) > -1) {
  // CS Score 함수 내에서만 교체 (첫번째 매치)
  var csScoreIdx = code.indexOf("function loadCSScoreData()");
  var csScoreFetchIdx = code.indexOf(oldCSFetch, csScoreIdx);
  if (csScoreFetchIdx > -1 && csScoreFetchIdx < csScoreIdx + 500) {
    code = code.substring(0, csScoreFetchIdx) + newCSFetch + code.substring(csScoreFetchIdx + oldCSFetch.length);
    console.log("  [2a] CS Score fetch에 csat-v2-stats 추가");
    changes++;
  }
}

// 2-b) results 파싱에 csatV2 추가
var oldCSResults = "      var d = results[0];\n      var mgrPerf = results[1];";
var newCSResults = "      var d = results[0];\n      var mgrPerf = results[1];\n      var csatV2CS = results[2];";
// CS Score 함수 내에서만 교체
var csScoreStart = code.indexOf("function loadCSScoreData()");
var csResultsIdx = code.indexOf(oldCSResults, csScoreStart);
if (csResultsIdx > -1 && csResultsIdx < csScoreStart + 500) {
  code = code.substring(0, csResultsIdx) + newCSResults + code.substring(csResultsIdx + oldCSResults.length);
  console.log("  [2b] CS Score results에 csatV2CS 추가");
  changes++;
}

// 2-c) CES 상세 블록 → CSAT v2 + CES 축소
var oldCES = "      // CES Detail\n      html += '<div style=\"background:var(--bg-secondary);border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid var(--border-primary)\">';\n      html += '<div style=\"font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:12px\">고객 노력 점수 (CES)</div>';";

var newCESBlock = [
  "      // CSAT v2 + CES Detail",
  "      // --- CSAT v2 상세 ---",
  "      html += '<div style=\"background:var(--bg-secondary);border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid var(--border-primary)\">';",
  "      html += '<div style=\"font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:12px\">고객 만족도 설문 (CSAT v2)</div>';",
  "      if (csatV2CS && csatV2CS.total > 0) {",
  "        var _cv2Rate = csatV2CS.satisfactionRate || 0;",
  "        var _cv2Color = _cv2Rate >= 80 ? '#10b981' : _cv2Rate >= 50 ? '#f59e0b' : '#ef4444';",
  "        html += '<div style=\"display:flex;gap:20px\">';",
  "        html += '<div style=\"flex:1;text-align:center\"><div style=\"font-size:36px;font-weight:700;color:' + _cv2Color + '\">' + _cv2Rate + '%</div><div style=\"font-size:11px;color:var(--text-secondary)\">만족률</div></div>';",
  "        html += '<div style=\"flex:1;text-align:center\"><div style=\"font-size:36px;font-weight:700;color:#22c55e\">' + (csatV2CS.satisfied||0) + '</div><div style=\"font-size:11px;color:var(--text-secondary)\">만족</div></div>';",
  "        html += '<div style=\"flex:1;text-align:center\"><div style=\"font-size:36px;font-weight:700;color:#ef4444\">' + (csatV2CS.unsatisfied||0) + '</div><div style=\"font-size:11px;color:var(--text-secondary)\">불만족</div></div>';",
  "        html += '<div style=\"flex:1;text-align:center\"><div style=\"font-size:36px;font-weight:700;color:#3b82f6\">' + (csatV2CS.total||0) + '</div><div style=\"font-size:11px;color:var(--text-secondary)\">총 응답</div></div>';",
  "        html += '</div>';",
  "        // 카테고리별 불만족 분석",
  "        var _cats = csatV2CS.categories || {};",
  "        var _catKeys = Object.keys(_cats);",
  "        if (_catKeys.length > 0) {",
  "          html += '<div style=\"margin-top:12px;padding-top:12px;border-top:1px solid var(--border-primary)\">';",
  "          html += '<div style=\"font-size:12px;color:var(--text-secondary);margin-bottom:8px\">카테고리별 분석</div>';",
  "          html += '<div style=\"display:flex;gap:8px;flex-wrap:wrap\">';",
  "          for (var _ci=0; _ci<_catKeys.length; _ci++) {",
  "            var _ck = _catKeys[_ci]; var _cv = _cats[_ck];",
  "            html += '<span style=\"padding:4px 10px;border-radius:12px;font-size:11px;background:rgba(99,102,241,0.15);color:#818cf8\">' + _ck + ' ' + _cv.total + '건</span>';",
  "          }",
  "          html += '</div></div>';",
  "        }",
  "      } else {",
  "        html += '<div style=\"text-align:center;padding:20px;color:var(--text-secondary)\">';",
  "        html += '<div style=\"font-size:36px;margin-bottom:8px\">📋</div>';",
  "        html += '<div style=\"font-size:14px\">설문 응답 수집 중</div>';",
  "        html += '<div style=\"font-size:12px;margin-top:4px\">채팅 종료 시 CSAT v2 설문이 자동 발송됩니다</div>';",
  "        html += '</div>';",
  "      }",
  "      html += '</div>';",
  "",
  "      // --- CES 축소 표시 ---",
  "      html += '<div style=\"background:var(--bg-secondary);border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid var(--border-primary)\">';",
  "      html += '<div style=\"font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:12px\">고객 노력 점수 (CES)</div>';"
].join("\n");

if (code.indexOf(oldCES) > -1) {
  code = code.replace(oldCES, newCESBlock);
  console.log("  [2c] CS Score CES 상세 → CSAT v2 + CES 축소 교체");
  changes++;
}

// ============================================
// TAB 3: 고객 피드백 - 불필요한 review 참조 정리
// ============================================

// 3-a) Promise.resolve 제거 → 단일 fetch로 변경
var oldCSATFetch = [
  "  Promise.all([",
  "    fetch('/api/analytics/csat-v2-stats?days=' + days).then(function(r) { return r.json(); }),",
  "    Promise.resolve({totalReviews:0,managers:{},scoreDistribution:{}})",
  "  ]).then(function(results) {",
  "    var csat = results[0];",
  "    var review = results[1];"
].join("\n");

var newCSATFetch = [
  "  fetch('/api/analytics/csat-v2-stats?days=' + days).then(function(r) { return r.json(); })",
  "  .then(function(csat) {"
].join("\n");

if (code.indexOf(oldCSATFetch) > -1) {
  code = code.replace(oldCSATFetch, newCSATFetch);
  console.log("  [3a] CSAT 탭 불필요한 Promise.all → 단일 fetch 정리");
  changes++;
}

// ============================================
// 저장
// ============================================
fs.writeFileSync(file, code);
console.log("\n✅ 총 " + changes + "개 변경 적용 완료");
console.log("- 종합현황: v2 만족률 + 오프시간 카드 추가");
console.log("- CS Score: CSAT v2 상세 + CES 축소");
console.log("- 고객 피드백: 불필요한 review 참조 정리");
