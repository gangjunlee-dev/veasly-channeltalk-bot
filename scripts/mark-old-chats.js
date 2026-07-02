var path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
var fs = require('fs');
var ch = require('../lib/channeltalk');
(async function(){
  var closeWarnFile = path.join(__dirname, '..', 'data', 'close-warning-sent.json');
  var csatSentFile = path.join(__dirname, '..', 'data', 'csat-sent.json');
  var closeWarnSent = {};
  try { closeWarnSent = JSON.parse(fs.readFileSync(closeWarnFile, 'utf8')); } catch(e){}
  var csatSent = {};
  try { csatSent = JSON.parse(fs.readFileSync(csatSentFile, 'utf8')); } catch(e){}

  var chats = await ch.listUserChats('opened', 100);
  var now = Date.now();
  var marked = 0;
  for (var i = 0; i < chats.userChats.length; i++) {
    var c = chats.userChats[i];
    var hours = (now - c.openedAt) / 3600000;
    if (hours >= 12 && !closeWarnSent[c.id]) {
      closeWarnSent[c.id] = now;
      csatSent[c.id] = { source: 'skip-old', ts: now };
      marked++;
    }
  }
  fs.writeFileSync(closeWarnFile, JSON.stringify(closeWarnSent), 'utf8');
  fs.writeFileSync(csatSentFile, JSON.stringify(csatSent, null, 2), 'utf8');
  console.log('기존 12h+ 채팅 스킵 처리:', marked, '건');
  console.log('앞으로 새로 12h 경과하는 채팅부터 설문 링크 발송됩니다.');
})();
