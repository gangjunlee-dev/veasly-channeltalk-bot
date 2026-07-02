var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");

// 매니저 ID 대신 name 필드 사용
var oldLine = "html += '<td>' + (mgrNames[gk] || gk) + ' <span class=\"mgr-badge ' + grade + '\">' + grade + '</span></td>';";
var newLine = "html += '<td>' + (gv.name || gk) + ' <span class=\"mgr-badge ' + grade + '\">' + grade + '</span></td>';";

if (code.indexOf(oldLine) > -1) {
  code = code.replace(oldLine, newLine);
  fs.writeFileSync(file, code);
  console.log("✅ 대시보드 매니저 이름 표시 수정");
} else {
  console.log("패턴 불일치");
  var idx = code.indexOf("mgrNames[gk]");
  if (idx > -1) console.log("위치:", idx);
}
