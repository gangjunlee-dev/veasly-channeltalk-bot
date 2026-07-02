var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/routes/webhook.js";
var code = fs.readFileSync(file, "utf8");

// 현재: if (managerActive[chatId]) { return res.status(200).send('OK'); }
// 변경: managerActive가 2시간 이상이면 자동 해제 (LINE 채팅 대응)

var oldCheck = "    if (managerActive[chatId]) {\n      return res.status(200).send('OK');\n    }";

var newCheck = [
  "    if (managerActive[chatId]) {",
  "      var _mgrElapsed = Date.now() - managerActive[chatId];",
  "      var _mgrTimeoutMs = 2 * 60 * 60 * 1000; // 2시간",
  "      if (_mgrElapsed > _mgrTimeoutMs) {",
  "        // 마지막 매니저 활동 후 2시간 경과 → AI 다시 활성화",
  "        delete managerActive[chatId];",
  "        if (pendingEscalations[chatId]) delete pendingEscalations[chatId];",
  '        console.log("[ManagerActive] Auto-released after 2h for chat:", chatId);',
  "      } else {",
  "        return res.status(200).send('OK');",
  "      }",
  "    }"
].join("\n");

if (code.indexOf(oldCheck) > -1) {
  code = code.replace(oldCheck, newCheck);
  fs.writeFileSync(file, code);
  console.log("✅ managerActive 2시간 자동해제 로직 추가 완료");
} else {
  console.log("❌ 패턴 불일치");
  var i = code.indexOf("if (managerActive[chatId])");
  if (i > -1) console.log("위치:", i, "| 주변:", code.substring(i, i + 150));
}
