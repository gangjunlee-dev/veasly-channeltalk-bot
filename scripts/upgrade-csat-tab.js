var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");

// loadCSATData 함수를 찾아서 교체
var funcStart = code.indexOf("function loadCSATData()");
if (funcStart === -1) { console.log("loadCSATData 함수 못 찾음"); process.exit(1); }

// 다음 function 시작점 찾기
var nextFunc = code.indexOf("\nfunction ", funcStart + 10);
if (nextFunc === -1) { console.log("다음 함수 못 찾음"); process.exit(1); }

var oldFunc = code.substring(funcStart, nextFunc);
console.log("기존 loadCSATData 길이:", oldFunc.length, "bytes");

var newFunc = `function loadCSATData() {
  var days = document.getElementById('days').value;
  document.getElementById('csatContent').innerHTML = '<div class="loading">고객 피드백 데이터 로딩 중...</div>';

  Promise.all([
    fetch('/api/analytics/csat-v2-stats?days=' + days).then(function(r) { return r.json(); }),
    fetch('/api/analytics/ai-review-summary?days=' + days).then(function(r) { return r.json(); })
  ]).then(function(results) {
    var csat = results[0];
    var review = results[1];
    var html = '';

    // ===== SECTION 1: CSAT 설문 결과 =====
    html += '<div class="section-title">📋 고객 만족도 설문 (CSAT v2)</div>';
    html += '<div class="grid">';

    // 만족률 게이지
    var rate = csat.satisfactionRate || 0;
    var rateColor = rate >= 80 ? 'green' : rate >= 50 ? 'yellow' : 'red';
    html += card('만족률', rate + '%', '', rateColor, '총 ' + csat.total + '건 응답', '만족: ' + csat.satisfied + ' / 불만족: ' + csat.unsatisfied);
    html += card('이번 달 응답', csat.thisMonth || 0, '건', 'blue', '전체 누적: ' + csat.allFeedback + '건', '');
    html += card('추첨 대기', csat.recentFeedback ? csat.recentFeedback.filter(function(f){return f.rewardStatus==="pending_draw"}).length : 0, '명', 'purple', '매월 1일 자동 추첨', '1등 10,000P / 2등 5,000P / 3등 1,000P');

    // 채널별
    var byType = csat.byType || {};
    html += card('봇 응대', byType.bot || 0, '건', 'cyan', '', '');
    html += card('매니저 응대', byType.manager || 0, '건', 'blue', '', '');

    // 언어별
    var langs = csat.byLang || {};
    var langStr = Object.keys(langs).map(function(k) { return k + ': ' + langs[k]; }).join(' / ');
    html += card('언어별', csat.total || 0, '건', 'purple', langStr, '');
    html += '</div>';

    // ===== 카테고리별 불만 분석 =====
    var cats = csat.categories || {};
    var catKeys = Object.keys(cats);
    if (catKeys.length > 0) {
      html += '<div class="charts">';
      html += '<div class="chart-card">';
      html += '<h3>📊 카테고리별 불만 분석</h3>';
      html += '<div class="bar-chart">';
      var catNames = {
        "order_shipping": "주문/배송", "cancel_refund": "취소/환불", "product_quality": "상품 품질",
        "payment": "결제", "bot_response": "봇 응답", "manager_response": "상담사 응답",
        "website_app": "웹사이트/앱", "other": "기타"
      };
      var maxCat = Math.max.apply(null, catKeys.map(function(k){ return cats[k].total; }));
      for (var ci = 0; ci < catKeys.length; ci++) {
        var ck = catKeys[ci];
        var cv = cats[ck];
        var pct = maxCat > 0 ? Math.round(cv.total / maxCat * 100) : 0;
        var barColor = cv.unsatisfied > cv.satisfied ? '#ef4444' : '#22c55e';
        html += '<div class="bar-row"><div class="bar-label">' + (catNames[ck] || ck) + '</div>';
        html += '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div>';
        html += '<div class="bar-count">' + cv.total + '건 (불만 ' + cv.unsatisfied + ')</div></div></div>';
      }
      html += '</div></div>';

      // 상세 사유
      var reasons = csat.reasons || {};
      var reasonKeys = Object.keys(reasons).sort(function(a,b){ return reasons[b] - reasons[a]; });
      html += '<div class="chart-card">';
      html += '<h3>🔍 불만족 상세 사유</h3>';
      var reasonNames = {
        "slow_response": "응답 느림", "wrong_info": "잘못된 정보", "not_resolved": "문제 미해결",
        "bot_confusing": "봇 답변 혼란", "rude_attitude": "불친절", "too_many_transfers": "잦은 전환",
        "long_shipping": "배송 지연", "refund_delay": "환불 지연", "other": "기타"
      };
      if (reasonKeys.length > 0) {
        html += '<ul class="keyword-list">';
        for (var ri = 0; ri < reasonKeys.length; ri++) {
          html += '<li><span class="kw">' + (reasonNames[reasonKeys[ri]] || reasonKeys[ri]) + '</span><span class="kc">' + reasons[reasonKeys[ri]] + '건</span></li>';
        }
        html += '</ul>';
      } else {
        html += '<div style="color:var(--text-muted);font-size:13px;">아직 사유 데이터가 없습니다.</div>';
      }
      html += '</div></div>';
    }

    // ===== 월별 트렌드 =====
    var monthly = csat.monthly || {};
    var monKeys = Object.keys(monthly).sort();
    if (monKeys.length > 0) {
      html += '<div class="charts"><div class="chart-card full">';
      html += '<h3>📈 월별 만족도 트렌드</h3>';
      html += '<div style="display:flex;gap:16px;align-items:flex-end;height:120px;">';
      var maxMon = Math.max.apply(null, monKeys.map(function(k){ return monthly[k].total; }));
      for (var mi = 0; mi < monKeys.length; mi++) {
        var mk = monKeys[mi];
        var mv = monthly[mk];
        var mRate = mv.total > 0 ? Math.round(mv.satisfied / mv.total * 100) : 0;
        var barH = maxMon > 0 ? Math.max(Math.round(mv.total / maxMon * 100), 10) : 10;
        var mColor = mRate >= 80 ? '#22c55e' : mRate >= 50 ? '#eab308' : '#ef4444';
        html += '<div style="flex:1;text-align:center;">';
        html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">' + mRate + '%</div>';
        html += '<div style="height:' + barH + 'px;background:' + mColor + ';border-radius:4px;margin:0 auto;width:80%;"></div>';
        html += '<div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">' + mk.substring(5) + '월</div>';
        html += '<div style="font-size:10px;color:var(--text-muted);">' + mv.total + '건</div>';
        html += '</div>';
      }
      html += '</div></div></div>';
    }

    // ===== SECTION 2: AI 품질 리뷰 =====
    html += '<div class="section-title" style="margin-top:24px;">🤖 CS 응대 품질 AI 리뷰 <span style="font-size:12px;color:var(--text-muted);font-weight:400;">(Gemini 자동 평가 · ' + (review.totalReviews || 0) + '건)</span></div>';

    // 점수 분포
    var dist = review.scoreDistribution || {};
    html += '<div class="grid">';
    html += card('우수 (20+)', dist.excellent || 0, '건', 'green', '', '총점 25점 만점 중 20점 이상');
    html += card('양호 (15-19)', dist.good || 0, '건', 'blue', '', '');
    html += card('보통 (10-14)', dist.average || 0, '건', 'yellow', '', '');
    html += card('개선필요 (<10)', dist.poor || 0, '건', 'red', '', '');
    html += '</div>';

    // 매니저별 상세
    var mgrs = review.managers || {};
    var mgrKeys = Object.keys(mgrs);
    if (mgrKeys.length > 0) {
      html += '<div class="charts"><div class="chart-card full">';
      html += '<h3>👥 매니저별 AI 품질 점수 (5점 만점 · 5개 항목)</h3>';
      html += '<table><thead><tr><th>매니저</th><th>리뷰 수</th><th>총점 평균</th><th>해결력</th><th>태도</th><th>정확성</th><th>응답성</th><th>전문성</th></tr></thead><tbody>';
      
      var mgrNames = {};
      try {
        var perfData = document.getElementById("managersContent").dataset;
        if (perfData && perfData.names) mgrNames = JSON.parse(perfData.names);
      } catch(e) {}

      for (var gi = 0; gi < mgrKeys.length; gi++) {
        var gk = mgrKeys[gi];
        var gv = mgrs[gk];
        var grade = gv.avgTotal >= 20 ? 'A' : gv.avgTotal >= 15 ? 'B' : gv.avgTotal >= 10 ? 'C' : 'D';
        html += '<tr>';
        html += '<td>' + (mgrNames[gk] || gk) + ' <span class="mgr-badge ' + grade + '">' + grade + '</span></td>';
        html += '<td>' + gv.reviews + '건</td>';
        html += '<td style="font-weight:700;">' + gv.avgTotal + '/25</td>';
        html += tdScore(gv.avgResolution);
        html += tdScore(gv.avgAttitude);
        html += tdScore(gv.avgAccuracy);
        html += tdScore(gv.avgResponsiveness);
        html += tdScore(gv.avgProfessionalism);
        html += '</tr>';

        // 최근 요약
        if (gv.recentSummaries && gv.recentSummaries.length > 0) {
          html += '<tr><td colspan="8" style="font-size:11px;color:var(--text-muted);padding:4px 8px 12px;border-bottom:2px solid var(--border-primary);">';
          html += '💬 최근 리뷰: ' + gv.recentSummaries[0].substring(0, 100) + (gv.recentSummaries[0].length > 100 ? '...' : '');
          html += '</td></tr>';
        }
      }
      html += '</tbody></table></div></div>';
    }

    // ===== 추첨 현황 =====
    var draws = csat.draws || [];
    if (draws.length > 0) {
      html += '<div class="section-title" style="margin-top:24px;">🎁 월별 추첨 현황</div>';
      html += '<div class="charts"><div class="chart-card full">';
      html += '<table><thead><tr><th>월</th><th>추첨일</th><th>참여자</th><th>당첨자</th></tr></thead><tbody>';
      for (var di = 0; di < draws.length; di++) {
        var dv = draws[di];
        var winStr = (dv.winners || []).map(function(w) { return w.rank + ' ' + w.name + ' (' + w.points + 'P)'; }).join(', ');
        html += '<tr><td>' + dv.month + '</td><td>' + (dv.date || '-') + '</td><td>' + dv.totalCandidates + '명</td><td>' + (winStr || '-') + '</td></tr>';
      }
      html += '</tbody></table></div></div>';
    }

    // ===== 최근 피드백 목록 =====
    var recent = csat.recentFeedback || [];
    if (recent.length > 0) {
      html += '<div class="section-title" style="margin-top:24px;">📝 최근 피드백</div>';
      html += '<div style="padding:0 32px 16px;">';
      html += '<table><thead><tr><th>일시</th><th>만족</th><th>카테고리</th><th>사유</th><th>언어</th><th>타입</th><th>추첨</th></tr></thead><tbody>';
      for (var fi = 0; fi < recent.length; fi++) {
        var fv = recent[fi];
        var satIcon = fv.satisfied ? '😊 만족' : '😞 불만족';
        var satStyle = fv.satisfied ? 'color:#22c55e' : 'color:#ef4444';
        html += '<tr>';
        html += '<td>' + (fv.submittedAt || '').substring(0, 16).replace('T', ' ') + '</td>';
        html += '<td style="' + satStyle + ';font-weight:600;">' + satIcon + '</td>';
        html += '<td>' + (fv.category || '-') + '</td>';
        html += '<td>' + (fv.reasons ? fv.reasons.join(', ') : '-') + '</td>';
        html += '<td>' + (fv.lang || '-') + '</td>';
        html += '<td><span class="pill" style="background:' + (fv.type === 'bot' ? 'rgba(59,130,246,0.15);color:#3b82f6' : 'rgba(168,85,247,0.15);color:#a855f7') + '">' + (fv.type || 'bot') + '</span></td>';
        html += '<td>' + (fv.rewardStatus === 'pending_draw' ? '⏳ 대기' : fv.rewardStatus === 'won' ? '🎉 당첨' : fv.rewardStatus || '-') + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table></div>';
    }

    document.getElementById('csatContent').innerHTML = html;
  }).catch(function(err) {
    document.getElementById('csatContent').innerHTML = '<div class="loading" style="color:#ef4444;">오류: ' + err.message + '</div>';
  });
}

function tdScore(val) {
  var color = val >= 4 ? '#22c55e' : val >= 3 ? '#eab308' : '#ef4444';
  return '<td style="color:' + color + ';font-weight:600;">' + val + '</td>';
}

`;

code = code.substring(0, funcStart) + newFunc + code.substring(nextFunc);
fs.writeFileSync(file, code);
console.log("✅ CSAT 탭 v2로 교체 완료 (" + newFunc.length + " bytes)");
