var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// 1) miniCard grid에 overflow:hidden 추가
var oldGrid = "flex:1; display:grid; grid-template-columns:repeat(5,1fr); gap:8px;";
if (code.indexOf(oldGrid) > -1) {
  var newGrid = "flex:1; display:grid; grid-template-columns:repeat(5,1fr); gap:8px; overflow:hidden;";
  code = code.replace(oldGrid, newGrid);
  changes++;
  console.log("✅ [1] miniCard grid에 overflow:hidden 추가");
}

// 2) 혹시 .grid CSS(auto-fit)도 overflow 추가
var oldAutoFit = "grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;";
if (code.indexOf(oldAutoFit) > -1) {
  var newAutoFit = "grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; overflow: hidden;";
  code = code.replace(oldAutoFit, newAutoFit);
  changes++;
  console.log("✅ [2] .grid CSS에도 overflow:hidden 추가");
}

fs.writeFileSync(file, code, "utf8");
console.log("\n✅ 총 " + changes + "개 변경 완료");
