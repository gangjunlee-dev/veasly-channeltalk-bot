var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// 에스컬 TD 뒤에 불확실 TD 추가
var oldEscTD = "h += '<td style=\"padding:8px 6px;text-align:center;color:#ef4444;\">' + s.escalated + '</td>';";
var newEscTD = oldEscTD + "\n        h += '<td style=\"padding:8px 6px;text-align:center;color:#f59e0b;\">' + (s.uncertain || 0) + '</td>';";

// 카테고리 테이블 부분만 교체 (catArr 근처에 있는 것)
var searchStart = code.indexOf("catArr.slice(0, 15).forEach");
if (searchStart === -1) {
  console.log("❌ catArr.slice 못 찾음");
  process.exit(1);
}

var escIdx = code.indexOf(oldEscTD, searchStart);
if (escIdx === -1) {
  console.log("❌ 에스컬 TD 못 찾음");
  process.exit(1);
}

// 이미 불확실 TD가 있는지 확인
var nextLines = code.substring(escIdx, escIdx + 300);
if (nextLines.indexOf('s.uncertain') > -1) {
  console.log("⚠️ 이미 불확실 TD가 존재합니다");
} else {
  code = code.substring(0, escIdx) + newEscTD + code.substring(escIdx + oldEscTD.length);
  console.log("✅ [1] 카테고리 테이블 행에 '불확실' TD 추가");
  changes++;
}

// 하단 개선 포인트에도 불확실 수 표시 추가
var oldWeak = "해결률 ' + rate + '% (' + s.escalated + '/' + s.total + '건 에스컬) → FAQ/시나리오 보강 시급";
var newWeak = "해결률 ' + rate + '% (에스컬 ' + s.escalated + ' / 불확실 ' + (s.uncertain||0) + ' / 총 ' + s.total + '건) → FAQ/시나리오 보강 시급";

if (code.indexOf(oldWeak) > -1) {
  code = code.replace(oldWeak, newWeak);
  console.log("✅ [2] 약점 카테고리 설명에 불확실 수 추가");
  changes++;
} else {
  console.log("⚠️ 약점 카테고리 설명 패턴 못 찾음 (이미 변경?)");
}

fs.writeFileSync(file, code, "utf8");
console.log("\n✅ 총 " + changes + "개 변경 완료");
