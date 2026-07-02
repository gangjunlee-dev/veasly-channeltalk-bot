var path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
var fs = require('fs');
var ch = require('../lib/channeltalk');
(async function(){
  var closeWarnSent = {};
  try { closeWarnSent = JSON.parse(fs.readFileSync('data/close-warning-sent.json','utf8')); } catch(e){}
  var csatSent = {};
  try { csatSent = JSON.parse(fs.readFileSync('data/csat-sent.json','utf8')); } catch(e){}
  
  var chats = await ch.listUserChats('opened', 50);
  var now = Date.now();
  var candidates = [];
  var alreadySent = [];
  for (var i = 0; i < chats.userChats.length; i++) {
    var c = chats.userChats[i];
    var hours = (now - c.openedAt) / 3600000;
    if (hours >= 12) {
      if (closeWarnSent[c.id] || csatSent[c.id]) {
        alreadySent.push({ chatId: c.id, hours: Math.round(hours) });
      } else {
        candidates.push({ chatId: c.id, userId: c.userId, hours: Math.round(hours) });
      }
    }
  }
  console.log('12h+ 총 채팅:', candidates.length + alreadySent.length);
  console.log('이미 발송됨:', alreadySent.length);
  console.log('미발송 (다음 발송 대상):', candidates.length);
  if (candidates.length > 0) {
    console.log('--- 미발송 목록 (최대 10건) ---');
    candidates.slice(0,10).forEach(function(c){ console.log('  ' + c.chatId + ' | ' + c.hours + 'h'); });
  }
})();
