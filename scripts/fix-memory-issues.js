var fs = require('fs');

// === 이슈1: webhook.js 메모리 누수 방지 - 주기적 cleanup 추가 ===
var whFile = '/home/ubuntu/veasly-channeltalk-bot/routes/webhook.js';
var whCode = fs.readFileSync(whFile, 'utf8');

// processedMessages cleanup 뒤에 다른 변수 cleanup 추가
var oldCleanup = "setInterval(function() {\n  var now = Date.now();\n  Object.keys(processedMessages).forEach(function(k) {\n    if (now - processedMessages[k] > 120000) delete processedMessages[k];\n  });\n}, 60000);";

var newCleanup = "setInterval(function() {\n  var now = Date.now();\n  Object.keys(processedMessages).forEach(function(k) {\n    if (now - processedMessages[k] > 120000) delete processedMessages[k];\n  });\n  // 메모리 누수 방지: 24시간 이상 된 항목 정리\n  Object.keys(managerActive).forEach(function(k) {\n    if (now - managerActive[k] > 86400000) delete managerActive[k];\n  });\n  Object.keys(chatLanguage).forEach(function(k) {\n    if (typeof chatLanguage[k] === 'string') {\n      // chatLanguage는 타임스탬프가 없으므로 chatContext 기준으로 정리\n    }\n  });\n  Object.keys(chatContext).forEach(function(k) {\n    if (chatContext[k] && chatContext[k].lastOrderTime && (now - chatContext[k].lastOrderTime > 86400000)) delete chatContext[k];\n  });\n  Object.keys(satisfactionPending).forEach(function(k) {\n    if (satisfactionPending[k] && satisfactionPending[k].time && (now - satisfactionPending[k].time > 3600000)) delete satisfactionPending[k];\n  });\n  Object.keys(pendingEscalations).forEach(function(k) {\n    if (pendingEscalations[k] && pendingEscalations[k].time && (now - pendingEscalations[k].time > 86400000)) delete pendingEscalations[k];\n  });\n  Object.keys(_csatSendLock).forEach(function(k) {\n    if (now - _csatSendLock[k] > 600000) delete _csatSendLock[k];\n  });\n  Object.keys(waitingMessageSent).forEach(function(k) {\n    if (now - waitingMessageSent[k] > 3600000) delete waitingMessageSent[k];\n  });\n}, 60000);";

if (whCode.indexOf(oldCleanup) > -1) {
  whCode = whCode.replace(oldCleanup, newCleanup);
  fs.writeFileSync(whFile, whCode);
  console.log('✅ 이슈1: webhook.js 메모리 cleanup 추가');
} else {
  console.log('⚠️  이슈1: cleanup 패턴 불일치');
}

// === 이슈3: scheduler.js listUserChats limit 증가 ===
var schFile = '/home/ubuntu/veasly-channeltalk-bot/lib/scheduler.js';
var schCode = fs.readFileSync(schFile, 'utf8');

// checkUnresolvedChats에서 listUserChats 호출 부분 찾기
var oldLimit = 'var chats = await channeltalk.listUserChats("opened", 50);';
if (schCode.indexOf(oldLimit) > -1) {
  schCode = schCode.replace(oldLimit, 'var chats = await channeltalk.listUserChats("opened", 200);');
  console.log('✅ 이슈3: scheduler.js listUserChats limit 50→200');
} else {
  // 다른 패턴 시도
  var oldLimit2 = "await channeltalk.listUserChats('opened', 50)";
  if (schCode.indexOf(oldLimit2) > -1) {
    schCode = schCode.replace(oldLimit2, "await channeltalk.listUserChats('opened', 200)");
    console.log('✅ 이슈3: scheduler.js listUserChats limit 50→200 (패턴2)');
  } else {
    console.log('⚠️  이슈3: limit 패턴 불일치 - 수동 확인 필요');
    // 현재 값 출력
    var match = schCode.match(/listUserChats\([^)]+\)/g);
    if (match) match.forEach(function(m) { console.log('  found:', m); });
  }
}

// === 이슈5: close-warning-sent.json 정리 로직 추가 ===
// scheduler의 checkUnresolvedChats 끝에 오래된 기록 정리 추가
var oldDoneLog = 'console.log("[Scheduler] Unresolved check done:';
var cleanupCode = '// 오래된 close-warning-sent 기록 정리 (30일 이상)\n    var _cwNow = Date.now();\n    var _cwChanged = false;\n    Object.keys(closeWarnSent).forEach(function(k) {\n      if (_cwNow - closeWarnSent[k] > 30 * 86400000) { delete closeWarnSent[k]; _cwChanged = true; }\n    });\n    if (_cwChanged) { fs.writeFileSync(closeWarnFile, JSON.stringify(closeWarnSent), "utf8"); }\n    ';
if (schCode.indexOf(oldDoneLog) > -1 && schCode.indexOf('오래된 close-warning-sent') === -1) {
  schCode = schCode.replace(oldDoneLog, cleanupCode + oldDoneLog);
  console.log('✅ 이슈5: close-warning-sent.json 30일 자동 정리 추가');
} else {
  console.log('⚠️  이슈5: 이미 적용됨 또는 패턴 불일치');
}

fs.writeFileSync(schFile, schCode);

// === 이슈6: monthly-draw.js findUserById 수정 ===
// 설문 데이터의 userId는 ChannelTalk userId임
// VEASLY API에서 포인트를 지급하려면 VEASLY userId가 필요
// 설문 URL에 vid 파라미터가 포함되어 있고, survey.js에서 저장하도록 수정 필요
var surveyFile = '/home/ubuntu/veasly-channeltalk-bot/routes/survey.js';
var surveyCode = fs.readFileSync(surveyFile, 'utf8');
if (surveyCode.indexOf('veaslyId') === -1) {
  var oldEntry = "    guestEmail: body.guestEmail || '',";
  var newEntry = "    guestEmail: body.guestEmail || '',\n    veaslyId: body.veaslyId || '',";
  if (surveyCode.indexOf(oldEntry) > -1) {
    surveyCode = surveyCode.replace(oldEntry, newEntry);
    fs.writeFileSync(surveyFile, surveyCode);
    console.log('✅ 이슈6a: survey.js veaslyId 저장 추가');
  }
}

// monthly-draw.js에서 veaslyId 사용하도록 수정
var drawFile = '/home/ubuntu/veasly-channeltalk-bot/scripts/monthly-draw.js';
var drawCode = fs.readFileSync(drawFile, 'utf8');
// winner에 veaslyId 추가
if (drawCode.indexOf('veaslyId') === -1) {
  var oldWP = "        guestEmail: shuffled[idx].guestEmail || ''";
  var newWP = "        guestEmail: shuffled[idx].guestEmail || '',\n        veaslyId: shuffled[idx].veaslyId || ''";
  if (drawCode.indexOf(oldWP) > -1) {
    drawCode = drawCode.replace(oldWP, newWP);
    console.log('✅ 이슈6b: monthly-draw.js winner에 veaslyId 추가');
  }

  // givePoints에서 veaslyId 사용
  var oldGive = "      await givePoints(winner.userId, winner.points, descKR, descTW, descJP, token);";
  var newGive = "      var pointsUserId = winner.veaslyId || winner.userId;\n      await givePoints(pointsUserId, winner.points, descKR, descTW, descJP, token);";
  if (drawCode.indexOf(oldGive) > -1) {
    drawCode = drawCode.replace(oldGive, newGive);
    console.log('✅ 이슈6c: monthly-draw.js givePoints에 veaslyId 우선 사용');
  }

  // findUserById도 veaslyId로 검색
  var oldFind = "    var user = await findUserById(winner.userId, token);";
  var newFind = "    var findId = winner.veaslyId || winner.userId;\n    var user = await findUserById(findId, token);";
  if (drawCode.indexOf(oldFind) > -1) {
    drawCode = drawCode.replace(oldFind, newFind);
    console.log('✅ 이슈6d: monthly-draw.js findUserById에 veaslyId 우선 사용');
  }

  fs.writeFileSync(drawFile, drawCode);
}

console.log('');
console.log('=== 전체 이슈 수정 완료 ===');
