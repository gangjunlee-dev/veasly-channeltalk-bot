var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// ============================================
// PART 1: CSAT 탭에서 AI 리뷰 제거
// ============================================

// 1-a) ai-review-summary fetch → 빈 Promise로 교체
var oldFetch = "    fetch('/api/analytics/ai-review-summary?days=' + days).then(function(r) { return r.json(); })";
var newFetch = "    Promise.resolve({totalReviews:0,managers:{},scoreDistribution:{}})";
if (code.indexOf(oldFetch) > -1) {
  code = code.replace(oldFetch, newFetch);
  console.log("  [1a] CSAT 탭 ai-review-summary fetch 제거");
  changes++;
}

// 1-b) SECTION 2 HTML 블록 제거
var sec2Start = code.indexOf("    // ===== SECTION 2: AI");
var sec2End = code.indexOf("    // ===== 추첨 현황 =====");
if (sec2Start > -1 && sec2End > -1) {
  code = code.substring(0, sec2Start) + "\n" + code.substring(sec2End);
  console.log("  [1b] CSAT 탭 SECTION 2 HTML 제거 (" + (sec2End - sec2Start) + " bytes)");
  changes++;
}

// 1-c) review 변수 참조 제거 (var review = results[1] 은 남겨두되 사용 안 함)

// ============================================
// PART 2: 매니저 탭 AI 리뷰를 신규 API로 교체
// ============================================

// 2-a) 구 API fetch를 신규 API로 교체
var oldMgrFetch = "    fetch('/api/analytics/ai-reviews').then(function(r) { return r.json(); }).catch(function() { return null; })";
var newMgrFetch = "    fetch('/api/analytics/ai-review-summary?days=' + days).then(function(r) { return r.json(); }).catch(function() { return {totalReviews:0,managers:{},scoreDistribution:{}}; })";
if (code.indexOf(oldMgrFetch) > -1) {
  code = code.replace(oldMgrFetch, newMgrFetch);
  console.log("  [2a] 매니저 탭 API를 ai-review-summary로 교체");
  changes++;
}

// 2-b) 기존 reviewData 파싱 로직을 새 API 구조에 맞게 교체
var oldReviewParse = [
  "    // AI Quality Review Summary Cards",
  "    var reviewData = {};",
  "    if (aiReviews && aiReviews.recent) {",
  "      aiReviews.recent.forEach(function(rev) {",
  "        // Only process AI auto-scored reviews (have scores.totalScore)",
  "        if (!rev.scores || !rev.scores.totalScore) return;",
  "        if (!rev.managerId) return;",
  "        if (!reviewData[rev.managerId]) reviewData[rev.managerId] = { scores: [], count: 0 };",
  "        reviewData[rev.managerId].scores.push(rev.scores);",
  "        reviewData[rev.managerId].count++;",
  "      });",
  "    }"
].join("\n");

var newReviewParse = [
  "    // AI Quality Review Summary (from ai-review-summary API)",
  "    var reviewData = {};",
  "    if (aiReviews && aiReviews.managers) {",
  "      var _rmKeys = Object.keys(aiReviews.managers);",
  "      for (var _ri = 0; _ri < _rmKeys.length; _ri++) {",
  "        var _rmk = _rmKeys[_ri];",
  "        var _rmv = aiReviews.managers[_rmk];",
  "        reviewData[_rmk] = {",
  "          count: _rmv.reviews || 0,",
  "          name: _rmv.name || _rmk,",
  "          avgTotal: _rmv.avgTotal || 0,",
  "          avgResolution: _rmv.avgResolution || 0,",
  "          avgAttitude: _rmv.avgAttitude || 0,",
  "          avgAccuracy: _rmv.avgAccuracy || 0,",
  "          avgResponsiveness: _rmv.avgResponsiveness || 0,",
  "          avgProfessionalism: _rmv.avgProfessionalism || 0",
  "        };",
  "      }",
  "    }"
].join("\n");

if (code.indexOf(oldReviewParse) > -1) {
  code = code.replace(oldReviewParse, newReviewParse);
  console.log("  [2b] 매니저 탭 reviewData 파싱 로직 교체");
  changes++;
}

// 2-c) 매니저 카드에 AI 리뷰 점수 표시 추가
// 기존: var rd = reviewData[m.managerId]; 후 rd를 사용하는 부분 찾기
var oldRdUsage = "      var rd = reviewData[m.managerId];";
if (code.indexOf(oldRdUsage) > -1) {
  // rd 다음에 AI 점수 배지 추가 - 기존 코드 후에 삽입
  var rdInsertPoint = code.indexOf(oldRdUsage) + oldRdUsage.length;
  // 다음 줄 시작 찾기
  var nextLineAfterRd = code.indexOf("\n", rdInsertPoint) + 1;
  
  var aiScoreBadge = [
    "",
    "      // AI 리뷰 점수 표시",
    "      var _aiGrade = '-';",
    "      var _aiTotal = 0;",
    "      if (rd && rd.avgTotal) {",
    "        _aiTotal = rd.avgTotal;",
    "        _aiGrade = _aiTotal >= 20 ? 'A' : _aiTotal >= 15 ? 'B' : _aiTotal >= 10 ? 'C' : 'D';",
    "      }",
    ""
  ].join("\n");
  
  code = code.substring(0, nextLineAfterRd) + aiScoreBadge + code.substring(nextLineAfterRd);
  console.log("  [2c] 매니저 카드에 AI 점수 변수 추가");
  changes++;
}

// 2-d) 매니저별 성과 요약 아래에 AI 리뷰 종합 섹션 추가
// "매니저별 성과 요약" 제목 바로 위에 AI 리뷰 종합 카드 삽입
var mgrTitleMarker = "html += '<div class=\"section-title\" style=\"display:flex;justify-content:space-between;align-items:center;\">매니저별 성과 요약";
var mgrTitleIdx = code.indexOf(mgrTitleMarker);

if (mgrTitleIdx > -1) {
  var aiSummarySection = [
    "",
    "    // === AI 품질 리뷰 종합 ===",
    "    if (aiReviews && aiReviews.totalReviews > 0) {",
    "      var _dist = aiReviews.scoreDistribution || {};",
    "      html += '<div class=\"section-title\">🤖 CS 응대 품질 AI 리뷰 <span style=\"font-size:12px;color:var(--text-muted);font-weight:400;\">(Gemini 자동 평가 · ' + aiReviews.totalReviews + '건)</span></div>';",
    "      html += '<div class=\"grid\">';",
    "      html += card('우수 (20+)', _dist.excellent || 0, '건', 'green', '', '총점 25점 만점 중 20점 이상');",
    "      html += card('양호 (15-19)', _dist.good || 0, '건', 'blue', '', '총점 15~19점');",
    "      html += card('보통 (10-14)', _dist.average || 0, '건', 'yellow', '', '총점 10~14점');",
    "      html += card('개선필요 (<10)', _dist.poor || 0, '건', 'red', '', '총점 10점 미만');",
    "      html += '</div>';",
    "",
    "      // 매니저별 AI 점수 테이블",
    "      var _rmKeys2 = Object.keys(reviewData);",
    "      if (_rmKeys2.length > 0) {",
    "        html += '<div class=\"charts\"><div class=\"chart-card full\">';",
    "        html += '<h3>📊 매니저별 AI 품질 점수 (5점 만점 · 5개 항목)</h3>';",
    "        html += '<table><thead><tr><th>매니저</th><th>리뷰 수</th><th>총점 평균</th><th>해결력</th><th>태도</th><th>정확성</th><th>응답성</th><th>전문성</th></tr></thead><tbody>';",
    "        function _tdS(v) { var c = v >= 4 ? '#22c55e' : v >= 3 ? '#3b82f6' : v >= 2 ? '#f59e0b' : '#ef4444'; return '<td style=\"color:' + c + ';font-weight:600;\">' + v + '</td>'; }",
    "        for (var _ti = 0; _ti < _rmKeys2.length; _ti++) {",
    "          var _tk = _rmKeys2[_ti];",
    "          var _tv = reviewData[_tk];",
    "          var _tg = (_tv.avgTotal||0) >= 20 ? 'A' : (_tv.avgTotal||0) >= 15 ? 'B' : (_tv.avgTotal||0) >= 10 ? 'C' : 'D';",
    "          html += '<tr>';",
    "          html += '<td>' + (_tv.name || _tk) + ' <span style=\"background:' + (_tg==='A'?'#22c55e':_tg==='B'?'#3b82f6':_tg==='C'?'#f59e0b':'#ef4444') + ';color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;\">' + _tg + '</span></td>';",
    "          html += '<td>' + (_tv.count||0) + '건</td>';",
    "          html += '<td style=\"font-weight:700;\">' + (_tv.avgTotal||0) + '/25</td>';",
    "          html += _tdS(_tv.avgResolution||0);",
    "          html += _tdS(_tv.avgAttitude||0);",
    "          html += _tdS(_tv.avgAccuracy||0);",
    "          html += _tdS(_tv.avgResponsiveness||0);",
    "          html += _tdS(_tv.avgProfessionalism||0);",
    "          html += '</tr>';",
    "        }",
    "        html += '</tbody></table></div></div>';",
    "      }",
    "    }",
    ""
  ].join("\n");
  
  code = code.substring(0, mgrTitleIdx) + aiSummarySection + "\n    " + code.substring(mgrTitleIdx);
  console.log("  [2d] 매니저 탭에 AI 리뷰 종합 섹션 추가");
  changes++;
}

// ============================================
// 저장
// ============================================
fs.writeFileSync(file, code);
console.log("\n✅ 총 " + changes + "개 변경 적용 완료");
