var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// 1) managersContent에 max-width + width 강제 지정
var oldMC = '<div id="managersContent" >';
var newMC = '<div id="managersContent" style="max-width:900px;width:100%;margin:0 auto;">';
if (code.indexOf(oldMC) > -1) {
  code = code.replace(oldMC, newMC);
  changes++;
  console.log("✅ [1] managersContent에 max-width:900px, width:100% 추가");
} else {
  // 이미 style이 있을 수 있음
  var mcIdx = code.indexOf('id="managersContent"');
  if (mcIdx > -1) {
    var lineEnd = code.indexOf('>', mcIdx);
    var oldTag = code.substring(mcIdx - 5, lineEnd + 1);
    console.log("기존 태그:", oldTag);
  }
}

// 2) 카드 외부 래퍼에 width:100% + box-sizing 강제
var oldWrap = "html += '<div style=\"padding:0 16px 16px;\">';";
var newWrap = "html += '<div style=\"padding:0 16px 16px;width:100%;box-sizing:border-box;\">';";
if (code.indexOf(oldWrap) > -1) {
  code = code.replace(new RegExp(oldWrap.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newWrap);
  changes++;
  console.log("✅ [2] 카드 래퍼에 width:100% + box-sizing 추가");
}

// 3) miniCard grid에 overflow:hidden 추가하여 내부가 부모를 밀지 못하게
var oldGrid = "style=\"display:grid;grid-template-columns:repeat(5,1fr);gap:8px;width:100%;box-sizing:border-box;";
var newGrid = "style=\"display:grid;grid-template-columns:repeat(5,1fr);gap:8px;width:100%;box-sizing:border-box;overflow:hidden;";
if (code.indexOf(oldGrid) > -1) {
  code = code.replace(oldGrid, newGrid);
  changes++;
  console.log("✅ [3] miniCard grid에 overflow:hidden 추가");
} else {
  // 다른 grid 패턴 찾기
  var gridPatterns = [
    "grid-template-columns:repeat(5,1fr)",
    "repeat(auto-fit, minmax(200px, 1fr))"
  ];
  gridPatterns.forEach(function(p) {
    var gi = code.indexOf(p);
    if (gi > -1) {
      console.log("grid 패턴 발견:", code.substring(gi - 30, gi + p.length + 10));
    }
  });
}

// 4) chart-card에 max-width 추가 (부모 범위 넘지 못하게)
var oldCC = ".chart-card { background: var(--bg-secondary); border-radius: 12px; padding: 20px; border: 1px solid var(--border-primary); box-shadow: var(--shadow-sm); width: 100%; box-sizing: border-box; }";
var newCC = ".chart-card { background: var(--bg-secondary); border-radius: 12px; padding: 20px; border: 1px solid var(--border-primary); box-shadow: var(--shadow-sm); width: 100%; max-width: 100%; box-sizing: border-box; overflow: hidden; }";
if (code.indexOf(oldCC) > -1) {
  code = code.replace(oldCC, newCC);
  changes++;
  console.log("✅ [4] chart-card에 max-width:100% + overflow:hidden 추가");
}

// 5) miniCard 함수 내부의 .card에 min-width 제거 / overflow 추가
//    card 클래스 자체에 overflow:hidden 추가
var oldCardCSS = ".card { background: var(--bg-secondary); border-radius: 12px; padding: 20px; border: 1px solid var(--border-primary); box-shadow: var(--shadow-sm);";
var newCardCSS = ".card { background: var(--bg-secondary); border-radius: 12px; padding: 20px; border: 1px solid var(--border-primary); box-shadow: var(--shadow-sm); overflow: hidden; min-width: 0;";
if (code.indexOf(oldCardCSS) > -1) {
  code = code.replace(oldCardCSS, newCardCSS);
  changes++;
  console.log("✅ [5] .card에 overflow:hidden + min-width:0 추가");
}

fs.writeFileSync(file, code, "utf8");
console.log("\n✅ 총 " + changes + "개 변경 완료");
