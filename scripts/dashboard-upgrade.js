var fs = require("fs");
var path = require("path");

// ============================================
// STEP 1: routes/analytics.js에 v2 CSAT API 추가
// ============================================
var analyticsFile = path.join(__dirname, "..", "routes", "analytics.js");
var analyticsCode = fs.readFileSync(analyticsFile, "utf8");

// 이미 추가되어 있는지 확인
if (analyticsCode.indexOf("csat-v2-stats") > -1) {
  console.log("⏭️  csat-v2-stats API 이미 존재 - 스킵");
} else {
  var newAPI = `

// === CSAT v2 설문 통합 API ===
router.get('/csat-v2-stats', function(req, res) {
  try {
    var fbPath = path.join(__dirname, '..', 'data', 'csat-feedback-v2.json');
    var drawPath = path.join(__dirname, '..', 'data', 'csat-draw-log.json');
    var feedback = [];
    var drawLog = [];
    try { feedback = JSON.parse(fs.readFileSync(fbPath, 'utf8')); } catch(e) {}
    try { drawLog = JSON.parse(fs.readFileSync(drawPath, 'utf8')); } catch(e) {}

    var days = parseInt(req.query.days) || 30;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    var filtered = feedback.filter(function(f) {
      return new Date(f.submittedAt || f.timestamp) >= cutoff;
    });

    var satisfied = 0, unsatisfied = 0;
    var categories = {};
    var reasons = {};
    var byType = { bot: 0, manager: 0 };
    var byLang = {};
    var monthly = {};

    for (var i = 0; i < filtered.length; i++) {
      var f = filtered[i];
      if (f.satisfied) satisfied++; else unsatisfied++;
      
      // 카테고리별
      var cat = f.category || 'other';
      if (!categories[cat]) categories[cat] = { total: 0, satisfied: 0, unsatisfied: 0 };
      categories[cat].total++;
      if (f.satisfied) categories[cat].satisfied++; else categories[cat].unsatisfied++;
      
      // 사유별
      var rs = f.reasons || [];
      for (var j = 0; j < rs.length; j++) {
        reasons[rs[j]] = (reasons[rs[j]] || 0) + 1;
      }
      
      // 타입별
      var typ = f.type || 'bot';
      byType[typ] = (byType[typ] || 0) + 1;
      
      // 언어별
      var lng = f.lang || 'unknown';
      byLang[lng] = (byLang[lng] || 0) + 1;
      
      // 월별
      var mon = (f.submittedAt || f.timestamp || '').substring(0, 7);
      if (mon) {
        if (!monthly[mon]) monthly[mon] = { satisfied: 0, unsatisfied: 0, total: 0 };
        monthly[mon].total++;
        if (f.satisfied) monthly[mon].satisfied++; else monthly[mon].unsatisfied++;
      }
    }

    var total = satisfied + unsatisfied;
    var rate = total > 0 ? Math.round(satisfied / total * 100) : 0;

    // 추첨 현황
    var draws = drawLog.map(function(d) {
      return {
        month: d.month,
        date: d.drawDate,
        totalCandidates: d.totalCandidates || 0,
        winners: (d.winners || []).map(function(w) {
          return { rank: w.rank, name: (w.name || '').substring(0, 4) + '***', points: w.points, email: (w.email || '').substring(0, 3) + '***' };
        })
      };
    });

    res.json({
      success: true,
      period: days + ' days',
      total: total,
      satisfied: satisfied,
      unsatisfied: unsatisfied,
      satisfactionRate: rate,
      categories: categories,
      reasons: reasons,
      byType: byType,
      byLang: byLang,
      monthly: monthly,
      draws: draws,
      recentFeedback: filtered.slice(-20).reverse().map(function(f) {
        return {
          chatId: f.chatId,
          satisfied: f.satisfied,
          category: f.category,
          reasons: f.reasons,
          comment: f.comment,
          lang: f.lang,
          type: f.type,
          submittedAt: f.submittedAt || f.timestamp,
          rewardStatus: f.rewardStatus
        };
      }),
      allFeedback: feedback.length,
      thisMonth: filtered.filter(function(f) {
        var now = new Date();
        var fDate = new Date(f.submittedAt || f.timestamp);
        return fDate.getMonth() === now.getMonth() && fDate.getFullYear() === now.getFullYear();
      }).length
    });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === AI 리뷰 점수 수정 API (totalScore 매핑) ===
router.get('/ai-review-summary', function(req, res) {
  try {
    var reviewFile = path.join(__dirname, '..', 'data', 'ai-reviews.json');
    var reviews = [];
    try { reviews = JSON.parse(fs.readFileSync(reviewFile, 'utf8')); } catch(e) {}
    
    var days = parseInt(req.query.days) || 30;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    var filtered = reviews.filter(function(r) {
      return new Date(r.timestamp || r.date) >= cutoff;
    });

    // 매니저별 집계
    var byManager = {};
    for (var i = 0; i < filtered.length; i++) {
      var r = filtered[i];
      var mid = r.managerId || 'unknown';
      var scores = r.scores || {};
      if (!byManager[mid]) {
        byManager[mid] = { reviews: 0, totalScore: 0, resolution: 0, attitude: 0, accuracy: 0, responsiveness: 0, professionalism: 0, summaries: [] };
      }
      byManager[mid].reviews++;
      byManager[mid].totalScore += scores.totalScore || 0;
      byManager[mid].resolution += scores.resolution || 0;
      byManager[mid].attitude += scores.attitude || 0;
      byManager[mid].accuracy += scores.accuracy || 0;
      byManager[mid].responsiveness += scores.responsiveness || 0;
      byManager[mid].professionalism += scores.professionalism || 0;
      if (scores.summary) byManager[mid].summaries.push(scores.summary);
    }

    // 평균 계산
    var managers = {};
    for (var mid in byManager) {
      var m = byManager[mid];
      var cnt = m.reviews;
      managers[mid] = {
        reviews: cnt,
        avgTotal: Math.round(m.totalScore / cnt * 10) / 10,
        avgResolution: Math.round(m.resolution / cnt * 10) / 10,
        avgAttitude: Math.round(m.attitude / cnt * 10) / 10,
        avgAccuracy: Math.round(m.accuracy / cnt * 10) / 10,
        avgResponsiveness: Math.round(m.responsiveness / cnt * 10) / 10,
        avgProfessionalism: Math.round(m.professionalism / cnt * 10) / 10,
        recentSummaries: m.summaries.slice(-3)
      };
    }

    res.json({
      success: true,
      period: days + ' days',
      totalReviews: filtered.length,
      managers: managers,
      scoreDistribution: {
        excellent: filtered.filter(function(r) { return (r.scores && r.scores.totalScore || 0) >= 20; }).length,
        good: filtered.filter(function(r) { var s = r.scores && r.scores.totalScore || 0; return s >= 15 && s < 20; }).length,
        average: filtered.filter(function(r) { var s = r.scores && r.scores.totalScore || 0; return s >= 10 && s < 15; }).length,
        poor: filtered.filter(function(r) { return (r.scores && r.scores.totalScore || 0) < 10; }).length
      }
    });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
`;

  // module.exports 앞에 추가
  var exportIdx = analyticsCode.lastIndexOf("module.exports");
  if (exportIdx > -1) {
    analyticsCode = analyticsCode.substring(0, exportIdx) + newAPI + "\n" + analyticsCode.substring(exportIdx);
  } else {
    analyticsCode += newAPI;
  }
  fs.writeFileSync(analyticsFile, analyticsCode);
  console.log("✅ routes/analytics.js에 csat-v2-stats + ai-review-summary API 추가");
}

console.log("\n=== Step 1 완료: API 추가 ===");
console.log("다음 단계: dashboard.html CSAT 탭 교체");
