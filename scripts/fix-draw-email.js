var fs = require('fs');
var file = '/home/ubuntu/veasly-channeltalk-bot/scripts/monthly-draw.js';
var code = fs.readFileSync(file, 'utf8');

// 기존 sendEmail 함수 찾기 (정확한 현재 코드)
var oldLines = code.split('\n');
var startIdx = -1;
var endIdx = -1;
for (var i = 0; i < oldLines.length; i++) {
  if (oldLines[i].indexOf('async function sendEmail(email, name, rank, points, lang)') > -1) startIdx = i;
  if (startIdx > -1 && i > startIdx && oldLines[i].trim() === '}') { endIdx = i; break; }
}

if (startIdx > -1 && endIdx > -1) {
  var newFunc = [
    "var emailLib = require('../lib/email');",
    "async function sendEmail(email, name, rank, points, lang) {",
    "  if (!email) { console.log('[EMAIL] No email, skip'); return false; }",
    "  try {",
    "    await emailLib.sendDrawWinnerEmail(email, name, rank, points, lang);",
    "    return true;",
    "  } catch(e) {",
    "    console.log('[EMAIL] Send failed:', email, e.message);",
    "    return false;",
    "  }",
    "}"
  ];
  oldLines.splice(startIdx, endIdx - startIdx + 1, newFunc.join('\n'));
  fs.writeFileSync(file, oldLines.join('\n'));
  console.log('monthly-draw.js sendEmail 교체 완료 (line ' + (startIdx+1) + '-' + (endIdx+1) + ')');
} else {
  console.log('sendEmail 함수를 찾을 수 없음. startIdx:', startIdx, 'endIdx:', endIdx);
}
