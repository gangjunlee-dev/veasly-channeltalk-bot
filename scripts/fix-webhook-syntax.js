var fs = require('fs');
var file = '/home/ubuntu/veasly-channeltalk-bot/routes/webhook.js';
var code = fs.readFileSync(file, 'utf8');

// 깨진 코드 블록 제거
var broken = '        // CSAT on close: removed (not supported by webhook scope)\n            "| lock:", !!_csatSendLock[chatId0],\n            "| alreadySent:", csatHelper.alreadySent(chatId0));\n        }\n';

if (code.indexOf(broken) > -1) {
  code = code.replace(broken, '        // CSAT on close: removed (not supported by webhook scope)\n');
  fs.writeFileSync(file, code);
  console.log('webhook.js 문법 수정 완료');
} else {
  console.log('패턴 불일치 - 수동 확인 필요');
  // 대안: 455-462 라인 영역 확인
  var lines = code.split('\n');
  for (var i = 454; i < 465 && i < lines.length; i++) {
    console.log((i+1) + ': ' + lines[i]);
  }
}
