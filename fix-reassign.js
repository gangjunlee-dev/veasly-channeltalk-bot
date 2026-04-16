var fs = require('fs');
var wbPath = '/home/ubuntu/veasly-channeltalk-bot/routes/webhook.js';
var content = fs.readFileSync(wbPath, 'utf8');
var changes = 0;

// 1. connectManager 함수 정의 추가
var connectFunc = '\nasync function connectManager(chatId, lang) {\n' +
'  try {\n' +
'    var mgrs = await getCachedManagers();\n' +
'    var managers = (mgrs && mgrs.managers) || [];\n' +
'    for (var i = 0; i < managers.length; i++) {\n' +
'      if (managers[i].operator) {\n' +
'        await channeltalk.inviteManager(chatId, managers[i].id);\n' +
'        managerActive[chatId] = Date.now();\n' +
'        pendingEscalations[chatId] = { time: Date.now(), managerId: managers[i].id, lang: lang || "zh-TW" };\n' +
'        break;\n' +
'      }\n' +
'    }\n' +
'  } catch(e) { console.error("[ConnectManager] Error:", e.message); }\n' +
'}\n';

var mergeFunc = 'function isMergeShippingRequest';
if (content.indexOf('async function connectManager') === -1 && content.indexOf(mergeFunc) !== -1) {
  content = content.replace(mergeFunc, connectFunc + '\n' + mergeFunc);
  changes++;
  console.log('1. Added connectManager() function');
}

// 2. pendingEscalations 메모리 객체 추가
var mgrActiveDecl = 'var managerActive = {};';
if (content.indexOf('var pendingEscalations = {};') === -1 && content.indexOf(mgrActiveDecl) !== -1) {
  content = content.replace(mgrActiveDecl, mgrActiveDecl + '\nvar pendingEscalations = {};');
  changes++;
  console.log('2. Added pendingEscalations object');
}

// 3. 15분 미응답 자동 재배정 체커
var reassignChecker = '\n// === 15-min auto-reassign checker ===\n' +
'setInterval(async function() {\n' +
'  var now = Date.now();\n' +
'  var REASSIGN_TIMEOUT = 15 * 60 * 1000;\n' +
'  var chatIds = Object.keys(pendingEscalations);\n' +
'  for (var i = 0; i < chatIds.length; i++) {\n' +
'    var cid = chatIds[i];\n' +
'    var esc = pendingEscalations[cid];\n' +
'    if (now - esc.time >= REASSIGN_TIMEOUT) {\n' +
'      try {\n' +
'        var msgData = await channeltalk.getChatMessages(cid, 5);\n' +
'        var msgs = msgData.messages || [];\n' +
'        var mgrReplied = msgs.some(function(m) {\n' +
'          return m.personType === "manager" && m.createdAt && m.createdAt > esc.time;\n' +
'        });\n' +
'        if (mgrReplied) {\n' +
'          delete pendingEscalations[cid];\n' +
'          continue;\n' +
'        }\n' +
'        var reassignMsg = { "zh-TW": "感謝您的耐心等待！客服人員目前較忙碌，我們已通知其他客服人員，請再稍候一下", "ko": "기다려주셔서 감사합니다! 다른 상담사에게 알림을 보냈습니다. 조금만 더 기다려주세요", "en": "Thanks for your patience! We have notified additional agents. Please hold on", "ja": "お待たせして申し訳ございません！他のスタッフに通知しました" };\n' +
'        var lang = esc.lang || "zh-TW";\n' +
'        await channeltalk.sendMessage(cid, { blocks: [{ type: "text", value: reassignMsg[lang] || reassignMsg["zh-TW"] }] });\n' +
'        var mgrs = await getCachedManagers();\n' +
'        var allMgrIds = ((mgrs && mgrs.managers) || []).filter(function(m) { return !m.bot; }).map(function(m) { return m.id; });\n' +
'        if (allMgrIds.length > 0) {\n' +
'          await channeltalk.addFollowers(cid, allMgrIds).catch(function() {});\n' +
'        }\n' +
'        console.log("[AutoReassign] Chat " + cid + " reassigned after 15min. Notified " + allMgrIds.length + " managers.");\n' +
'        delete pendingEscalations[cid];\n' +
'      } catch(e) {\n' +
'        console.error("[AutoReassign] Error for " + cid + ":", e.message);\n' +
'        delete pendingEscalations[cid];\n' +
'      }\n' +
'    }\n' +
'  }\n' +
'}, 3 * 60 * 1000);\n';

var moduleExport = 'module.exports = router;';
if (content.indexOf('AutoReassign') === -1 && content.indexOf(moduleExport) !== -1) {
  content = content.replace(moduleExport, reassignChecker + '\n' + moduleExport);
  changes++;
  console.log('3. Added 15-min auto-reassign checker');
}

// 4. step2 에스컬레이션에 pendingEscalations 추적
var oldStep2 = "managerActive[chatId] = Date.now();\n              break;";
var newStep2 = "managerActive[chatId] = Date.now();\n              pendingEscalations[chatId] = { time: Date.now(), managerId: managers2[j].id, lang: detectedLang };\n              break;";
if (content.indexOf('pendingEscalations[chatId] = { time: Date.now(), managerId: managers2') === -1) {
  if (content.indexOf(oldStep2) !== -1) {
    content = content.replace(oldStep2, newStep2);
    changes++;
    console.log('4. Added pendingEscalation tracking to step2');
  }
}

// 5. 매니저 응답 시 cleanup
var mgrReply = 'mgrStats.recordReply(mgrPersonId, chatId, mgrText.length);';
var mgrReplyFix = 'mgrStats.recordReply(mgrPersonId, chatId, mgrText.length);\n          if (pendingEscalations[chatId]) { delete pendingEscalations[chatId]; }';
if (content.indexOf('delete pendingEscalations[chatId]') === -1 || content.indexOf('pendingEscalations[chatId]) { delete') === -1) {
  if (content.indexOf(mgrReply) !== -1) {
    content = content.replace(mgrReply, mgrReplyFix);
    changes++;
    console.log('5. Added cleanup on manager reply');
  }
}

fs.writeFileSync(wbPath, content);
console.log('Total changes:', changes);
