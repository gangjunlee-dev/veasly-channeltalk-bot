var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// 1) forEach 루프 진입 전에 글로벌 maxReplies 삽입
var oldForEach = ".filter(function(m) { return m.status === 'active'; }).forEach(function(m) {";
var forEachIdx = code.indexOf(oldForEach);
if (forEachIdx === -1) { console.log("❌ forEach 못 찾음"); process.exit(1); }

var globalMaxCode = "// 전체 매니저 중 일별 최대 답변수 (차트 스케일 통일)\n    var _globalMaxReplies = 0;\n    mgrPerf.managers.forEach(function(mgr) {\n      if (mgr.dailyTrend) mgr.dailyTrend.forEach(function(t) {\n        if (t.replies > _globalMaxReplies) _globalMaxReplies = t.replies;\n      });\n    });\n\n    mgrPerf.managers";

var insertPoint = code.lastIndexOf("mgrPerf.managers", forEachIdx);
if (insertPoint === -1) { console.log("❌ 삽입 지점 못 찾음"); process.exit(1); }

code = code.substring(0, insertPoint) + globalMaxCode + code.substring(insertPoint + "mgrPerf.managers".length);
changes++;
console.log("✅ [1] _globalMaxReplies 계산 삽입");

// 2) 로컬 maxReplies를 글로벌로 교체
var oldLocalMax = "var maxReplies = 0; var maxRT = 0;";
if (code.indexOf(oldLocalMax) > -1) {
  code = code.replace(oldLocalMax, "var maxReplies = _globalMaxReplies; var maxRT = 0;");
  changes++;
  console.log("✅ [2] maxReplies → _globalMaxReplies");
}

// 3) 로컬 maxReplies 계산 루프에서 replies 부분 제거
var oldMaxCalc = "m.dailyTrend.forEach(function(t) { if (t.replies > maxReplies) maxReplies = t.replies; if (t.avgRT > maxRT) maxRT = t.avgRT; });";
if (code.indexOf(oldMaxCalc) > -1) {
  code = code.replace(oldMaxCalc, "m.dailyTrend.forEach(function(t) { if (t.avgRT > maxRT) maxRT = t.avgRT; });");
  changes++;
  console.log("✅ [3] 로컬 maxReplies 계산 제거");
}

fs.writeFileSync(file, code, "utf8");
console.log("\n✅ 총 " + changes + "개 변경");
