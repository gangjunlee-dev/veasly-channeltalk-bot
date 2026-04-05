var cron = require('node-cron');
var channeltalk = require('./channeltalk');
var analytics = require('./analytics');

var ALERT_HOURS = 24;

async function checkUnresolvedChats() {
  try {
    var res = await channeltalk.listUserChats('opened', 100);
    var chats = (res.userChats || []);
    var now = Date.now();
    var unresolvedList = [];

    for (var i = 0; i < chats.length; i++) {
      var chat = chats[i];
      var lastMsgAt = chat.lastMessageAt || chat.updatedAt || chat.createdAt;
      var hoursPassed = (now - lastMsgAt) / (1000 * 60 * 60);
      if (hoursPassed >= ALERT_HOURS) {
        unresolvedList.push({
          id: chat.id,
          hours: Math.floor(hoursPassed),
          userId: chat.userId
        });
      }
    }

    if (unresolvedList.length === 0) return;

    var alertText = '⚠️ 미해결 상담 알림 (' + unresolvedList.length + '건)\n\n';
    for (var j = 0; j < Math.min(unresolvedList.length, 20); j++) {
      var item = unresolvedList[j];
      alertText += (j + 1) + '. Chat: ' + item.id + ' (' + item.hours + '시간 경과)\n';
    }
    if (unresolvedList.length > 20) {
      alertText += '\n... 외 ' + (unresolvedList.length - 20) + '건';
    }

    var managers = await channeltalk.listManagers();
    var managerList = (managers.managers || []);
    for (var k = 0; k < managerList.length; k++) {
      if (managerList[k].operator) {
        console.log('[Scheduler] Unresolved alert: ' + unresolvedList.length + ' chats');
        break;
      }
    }
    console.log('[Scheduler] Unresolved check done: ' + unresolvedList.length + ' overdue chats');
  } catch (err) {
    console.error('[Scheduler] Unresolved check error:', err.message);
  }
}

async function sendWeeklyReport() {
  try {
    var result = await analytics.analyzeRecentChats(7);
    var reportKo = analytics.generateReport(result);
    var reportTw = analytics.generateReportTW(result);
    console.log('[Scheduler] Weekly Report Generated');
    console.log(reportKo);

    var groups = await channeltalk.listGroups(10);
    if (groups.groups && groups.groups.length > 0) {
      var groupId = groups.groups[0].id;
      await channeltalk.sendGroupMessage(groupId, {
        blocks: [{ type: 'text', value: reportKo }]
      });
      console.log('[Scheduler] Weekly report sent to group: ' + groupId);
    }
  } catch (err) {
    console.error('[Scheduler] Weekly report error:', err.message);
  }
}

function startScheduler() {
  cron.schedule('0 9 * * 1', function() {
    console.log('[Scheduler] Running weekly report (Monday 9AM)...');
    sendWeeklyReport();
  }, { timezone: 'Asia/Seoul' });

  cron.schedule('0 */4 * * *', function() {
    console.log('[Scheduler] Checking unresolved chats...');
    checkUnresolvedChats();
  }, { timezone: 'Asia/Seoul' });

  console.log('[Scheduler] Started - Weekly report: Mon 9AM KST, Unresolved check: every 4h');
}

module.exports = { startScheduler: startScheduler, checkUnresolvedChats: checkUnresolvedChats, sendWeeklyReport: sendWeeklyReport };
