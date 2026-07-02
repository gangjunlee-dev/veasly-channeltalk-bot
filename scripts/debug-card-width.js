var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");

// 정확한 패턴 찾기
var idx = code.indexOf(".chart-card {");
if (idx === -1) { console.log("❌ 못 찾음"); process.exit(1); }

// 해당 룰의 끝 } 찾기
var endIdx = code.indexOf("}", idx);
var oldRule = code.substring(idx, endIdx + 1);
console.log("기존:", oldRule);

var newRule = oldRule.replace("border: 1px solid var(--border-primary)", "border: 3px solid #ef4444");
code = code.substring(0, idx) + newRule + code.substring(endIdx + 1);

fs.writeFileSync(file, code, "utf8");
console.log("✅ 디버그 테두리 적용");
