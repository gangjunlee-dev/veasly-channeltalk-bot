var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/routes/analytics.js";
var code = fs.readFileSync(file, "utf8");

// ai-review-summary API에서 매니저 이름 매핑 추가
var searchStr = "// 매니저별 집계\n    var byManager = {};";
var replaceStr = "// 매니저 이름 매핑\n    var mgrNameMap = {};\n    try {\n      var perfData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'manager-stats.json'), 'utf8'));\n      if (perfData.managers) {\n        for (var mk in perfData.managers) {\n          var mv = perfData.managers[mk];\n          if (mv && mv.managerId) mgrNameMap[mv.managerId] = mv.name || mv.email || mk;\n        }\n      }\n    } catch(e) {}\n    // 하드코딩 폴백\n    if (!mgrNameMap['622148']) mgrNameMap['622148'] = 'vida890515';\n    if (!mgrNameMap['609410']) mgrNameMap['609410'] = 'mia';\n    if (!mgrNameMap['357940']) mgrNameMap['357940'] = 'gangjun.lee';\n\n    // 매니저별 집계\n    var byManager = {};";

if (code.indexOf(searchStr) > -1) {
  code = code.replace(searchStr, replaceStr);
  
  // managers 객체에 이름 추가
  var oldAvg = "managers[mid] = {\n        reviews: cnt,";
  var newAvg = "managers[mid] = {\n        name: mgrNameMap[mid] || mid,\n        reviews: cnt,";
  code = code.replace(oldAvg, newAvg);
  
  fs.writeFileSync(file, code);
  console.log("✅ ai-review-summary에 매니저 이름 매핑 추가");
} else {
  console.log("패턴 불일치 - 수동 확인 필요");
  var idx = code.indexOf("var byManager = {};");
  if (idx > -1) console.log("위치:", idx, "| 주변:", code.substring(idx - 100, idx + 50));
}
