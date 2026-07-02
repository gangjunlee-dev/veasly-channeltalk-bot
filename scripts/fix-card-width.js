var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// 1) 디버그 테두리 원복
var debugBorder = "border: 3px solid #ef4444";
if (code.indexOf(debugBorder) > -1) {
  code = code.replace(debugBorder, "border: 1px solid var(--border-primary)");
  changes++;
  console.log("✅ [0] 디버그 테두리 원복");
} else {
  var debugBorder2 = "border: 2px solid red";
  if (code.indexOf(debugBorder2) > -1) {
    code = code.replace(debugBorder2, "border: 1px solid var(--border-primary)");
    changes++;
    console.log("✅ [0] 디버그 테두리 원복");
  }
}

// 2) managersContent에 max-width 추가
var oldMgrContent = '<div id="managersContent">';
var newMgrContent = '<div id="managersContent" style="max-width:960px;margin:0 auto;">';
if (code.indexOf(newMgrContent) === -1 && code.indexOf(oldMgrContent) > -1) {
  code = code.replace(oldMgrContent, newMgrContent);
  changes++;
  console.log("✅ [1] managersContent max-width:960px 추가");
}

// 3) 매니저 카드 내부 grid를 5컬럼 고정
var oldGrid = 'html += \'<div class="grid" style="padding:16px 0 0;margin:0;">\';';
var newGrid = 'html += \'<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:16px 0 0;">\';';
if (code.indexOf(oldGrid) > -1) {
  code = code.replace(oldGrid, newGrid);
  changes++;
  console.log("✅ [2] miniCard 그리드 5컬럼 고정");
}

// 4) 카드 외부 래퍼에 width:100% 명시
var oldWrapper = "html += '<div style=\"padding:0 32px 16px;\">';";
// 매니저 카드용만 (1028행 근처)
var wrapIdx = code.indexOf(oldWrapper);
if (wrapIdx > -1) {
  // 근처에 chart-card가 있는지 확인 (매니저 카드인지)
  var nearCode = code.substring(wrapIdx, wrapIdx + 200);
  if (nearCode.indexOf('chart-card') > -1) {
    var newWrapper = "html += '<div style=\"padding:0 32px 16px;width:100%;box-sizing:border-box;\">';";
    code = code.substring(0, wrapIdx) + newWrapper + code.substring(wrapIdx + oldWrapper.length);
    changes++;
    console.log("✅ [3] 카드 래퍼 width:100% 추가");
  }
}

fs.writeFileSync(file, code, "utf8");
console.log("\n✅ 총 " + changes + "개 변경");
