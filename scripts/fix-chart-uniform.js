var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// 1) 차트 gap을 동적이 아닌 고정값으로
var oldGap = "gap:' + (m.dailyTrend.length > 7 ? '2' : '6') + 'px";
var newGap = "gap:4px";
if (code.indexOf(oldGap) > -1) {
  code = code.replace(oldGap, newGap);
  changes++;
  console.log("✅ [1] 차트 gap 고정(4px)");
}

// 2) 차트 높이를 고정 + 패딩 통일
var oldChartContainer = "position:relative;height:120px;display:flex;align-items:flex-end;gap:4px;padding-bottom:28px;";
var newChartContainer = "position:relative;height:100px;display:flex;align-items:flex-end;gap:4px;padding-bottom:24px;box-sizing:border-box;";
if (code.indexOf(oldChartContainer) > -1) {
  code = code.replace(oldChartContainer, newChartContainer);
  changes++;
  console.log("✅ [2] 차트 높이/패딩 통일(100px)");
}

// 3) 막대 최대 높이를 통일 (80 → 65로 줄여서 차트 안에 깔끔하게)
var oldMaxH = "Math.max(8, Math.round(t.replies / maxReplies * 80))";
var newMaxH = "Math.max(8, Math.round(t.replies / maxReplies * 60))";
if (code.indexOf(oldMaxH) > -1) {
  code = code.replace(oldMaxH, newMaxH);
  changes++;
  console.log("✅ [3] 막대 최대 높이 60px로 통일");
}

// 4) 차트 래퍼 배경/패딩 통일 (모든 매니저 동일)
var oldWrapper = 'margin-top:16px;padding:16px;background:var(--bg-primary);border-radius:12px;';
var newWrapper = 'margin-top:16px;padding:16px 16px 8px;background:var(--bg-primary);border-radius:12px;min-height:180px;';
if (code.indexOf(oldWrapper) > -1) {
  code = code.replace(oldWrapper, newWrapper);
  changes++;
  console.log("✅ [4] 차트 래퍼 min-height 통일(180px)");
}

// 5) 하단 요약 바 마진 통일
var oldSummary = "display:flex;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid var(--border-primary);";
var newSummary = "display:flex;justify-content:space-between;margin-top:4px;padding-top:6px;border-top:1px solid var(--border-primary);";
if (code.indexOf(oldSummary) > -1) {
  code = code.replace(oldSummary, newSummary);
  changes++;
  console.log("✅ [5] 하단 요약 마진 통일");
}

fs.writeFileSync(file, code, "utf8");
console.log("\n✅ 총 " + changes + "개 변경 완료");
