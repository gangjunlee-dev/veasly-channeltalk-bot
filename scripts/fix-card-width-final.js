var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// 1) max-width 960px 제거 (너무 좁음)
code = code.replace('style="max-width:960px;margin:0 auto;"', '');
changes++;
console.log("✅ [1] 960px 제한 제거");

// 2) 매니저 카드 래퍼에 고정 너비 대신, 모든 카드가 동일하게 되도록
// chart-card CSS에 width:100% + box-sizing 추가
var oldCSS = ".chart-card { background: var(--bg-secondary); border-radius: 12px; padding: 20px; border: 1px solid var(--border-primary); box-shadow: var(--shadow-sm); }";
var newCSS = ".chart-card { background: var(--bg-secondary); border-radius: 12px; padding: 20px; border: 1px solid var(--border-primary); box-shadow: var(--shadow-sm); width: 100%; box-sizing: border-box; }";
if (code.indexOf(oldCSS) > -1) {
  code = code.replace(oldCSS, newCSS);
  changes++;
  console.log("✅ [2] chart-card width:100% 추가");
}

// 3) 핵심 수정: miniCard grid의 auto-fit이 문제
// 매니저 카드용 grid는 이미 repeat(5,1fr)로 바꿨지만
// 전체 .grid CSS의 auto-fit이 다른 곳에서 영향줄 수 있음
// 매니저 카드 외부 div에 overflow:hidden 추가
var oldWrap = "html += '<div style=\"padding:0 32px 16px;width:100%;box-sizing:border-box;\">';";
var newWrap = "html += '<div style=\"padding:0 16px 16px;\">';";
if (code.indexOf(oldWrap) > -1) {
  code = code.replace(oldWrap, newWrap);
  changes++;
  console.log("✅ [3] 래퍼 패딩 축소");
}

// 4) miniCard grid에 max-width 추가하여 넘치지 않게
var oldMiniGrid = "html += '<div style=\"display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:16px 0 0;\">';";
var newMiniGrid = "html += '<div style=\"display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:16px 0 0;width:100%;box-sizing:border-box;\">';";
if (code.indexOf(oldMiniGrid) > -1) {
  code = code.replace(oldMiniGrid, newMiniGrid);
  changes++;
  console.log("✅ [4] miniCard grid width:100% + gap 축소");
}

// 5) miniCard 함수 확인 - minWidth 제거
var miniCardIdx = code.indexOf("function miniCard");
if (miniCardIdx > -1) {
  var miniEnd = code.indexOf("}", miniCardIdx + 10);
  var miniFunc = code.substring(miniCardIdx, miniEnd + 1);
  console.log("\n현재 miniCard 함수:\n" + miniFunc.substring(0, 300));
}

fs.writeFileSync(file, code, "utf8");
console.log("\n✅ 총 " + changes + "개 변경");
