var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");

// 차트 블록에서 dailyTrend 사용 직전에 빈 날짜 채우기 코드 삽입
var oldTrendCheck = "if (m.dailyTrend && m.dailyTrend.length > 1) {";
var idx = code.indexOf(oldTrendCheck);
if (idx === -1) { console.log("❌ dailyTrend 체크 못 찾음"); process.exit(1); }

// 기존 체크를 빈 날짜 채우기 로직으로 교체
var newTrendBlock = `if (m.dailyTrend && m.dailyTrend.length > 0) {
        // 빈 날짜 채우기 (선택 기간 전체 표시)
        var _today = new Date();
        var _daysNum = parseInt(days) || 7;
        var _allDates = [];
        for (var _di = _daysNum - 1; _di >= 0; _di--) {
          var _d = new Date(_today);
          _d.setDate(_d.getDate() - _di);
          _allDates.push(_d.toISOString().substring(0, 10));
        }
        var _trendMap = {};
        m.dailyTrend.forEach(function(t) { _trendMap[t.date] = t; });
        var _filledTrend = _allDates.map(function(date) {
          return _trendMap[date] || { date: date, replies: 0, avgRT: 0 };
        });
        m.dailyTrend = _filledTrend;`;

code = code.substring(0, idx) + newTrendBlock + code.substring(idx + oldTrendCheck.length);
console.log("✅ [1] 빈 날짜 채우기 로직 삽입");

// 막대 최소 높이 조정 (0건이면 2px로)
var oldMinBar = "var barH = maxReplies > 0 ? Math.max(8, Math.round(t.replies / maxReplies * 80)) : 8;";
var newMinBar = "var barH = maxReplies > 0 ? (t.replies > 0 ? Math.max(8, Math.round(t.replies / maxReplies * 80)) : 2) : 2;";

if (code.indexOf(oldMinBar) > -1) {
  code = code.replace(oldMinBar, newMinBar);
  console.log("✅ [2] 0건 막대 최소 높이(2px) 적용");
}

// 0건일 때 막대 색상을 흐리게
var oldBarStyle = "background:linear-gradient(180deg,#60a5fa,#3b82f6)";
var newBarStyle = "background:linear-gradient(180deg,' + (t.replies > 0 ? '#60a5fa,#3b82f6' : 'rgba(96,165,250,0.15),rgba(59,130,246,0.15)') + ')";

if (code.indexOf(oldBarStyle) > -1) {
  code = code.replace(oldBarStyle, newBarStyle);
  console.log("✅ [3] 0건 막대 흐림 처리");
}

// 0건일 때 숫자 숨기기
var oldCountLabel = "font-weight:700;color:var(--text-primary);white-space:nowrap;\">' + t.replies + '</div>';";
var newCountLabel = "font-weight:700;color:var(--text-primary);white-space:nowrap;\">' + (t.replies > 0 ? t.replies : '') + '</div>';";

if (code.indexOf(oldCountLabel) > -1) {
  code = code.replace(oldCountLabel, newCountLabel);
  console.log("✅ [4] 0건 숫자 숨김");
}

// 0건일 때 응답시간 점 숨기기
var oldDot = "width:8px;height:8px;border-radius:50%;background:' + rtColor2 + '";
var newDot = "width:8px;height:8px;border-radius:50%;background:' + (t.replies > 0 ? rtColor2 : 'transparent') + '";

if (code.indexOf(oldDot) > -1) {
  code = code.replace(oldDot, newDot);
  console.log("✅ [5] 0건 응답시간 점 숨김");
}

fs.writeFileSync(file, code, "utf8");
console.log("\n✅ 총 변경 완료 - 모든 매니저가 동일 날짜 축을 공유합니다");
