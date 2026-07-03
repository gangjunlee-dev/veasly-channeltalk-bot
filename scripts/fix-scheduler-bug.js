var fs = require('fs');
var file = '/home/ubuntu/veasly-channeltalk-bot/lib/scheduler.js';
var code = fs.readFileSync(file, 'utf8');

// 수정1: warningList push 조건에서 _preWarnSent 제거 → closeWarnSent만 체크
// 기존: if (!_preWarnSent[chat.id]) { warningList.push(...)
// 변경: warningList.push (closeWarnSent는 발송 루프에서 이미 체크함)
var old1 = 'if (!_preWarnSent[chat.id]) { warningList.push({ id: chat.id, hours: Math.floor(hoursPassed), bizHours: Math.floor(bizHoursPassed), userId: chat.userId }); }';
var new1 = 'warningList.push({ id: chat.id, hours: Math.floor(hoursPassed), bizHours: Math.floor(bizHoursPassed), userId: chat.userId });';
if (code.indexOf(old1) === -1) { console.log('ERROR: old1 not found'); process.exit(1); }
code = code.replace(old1, new1);

// 수정2: markSent를 루프 단계에서 제거 (발송 성공 후로 이동)
// 기존: if (!csatHelper.alreadySent(chat.id)) { csatHelper.markSent(chat.id, "warning-csat"); }
var old2 = '        // 12h 경고에 CSAT 포함 → markSent\n        if (!csatHelper.alreadySent(chat.id)) { csatHelper.markSent(chat.id, "warning-csat"); }';
var new2 = '        // markSent는 실제 발송 성공 후에 수행 (발송 루프에서 처리)';
if (code.indexOf(old2) === -1) { console.log('ERROR: old2 not found'); process.exit(1); }
code = code.replace(old2, new2);

// 수정3: 발송 성공 후 markSent 추가
// 기존: console.log("[Scheduler] Close warning sent to chat:", warnChatId);
var old3 = 'console.log("[Scheduler] Close warning sent to chat:", warnChatId);';
var new3 = 'if (!csatHelper.alreadySent(warnChatId)) { csatHelper.markSent(warnChatId, "warning-csat"); }\n        console.log("[Scheduler] Close warning sent to chat:", warnChatId);';
if (code.indexOf(old3) === -1) { console.log('ERROR: old3 not found'); process.exit(1); }
code = code.replace(old3, new3);

fs.writeFileSync(file, code);
console.log('scheduler.js 버그 수정 완료');
