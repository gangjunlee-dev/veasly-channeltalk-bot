var path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
var ch = require('../lib/channeltalk');

(async function(){
  var chats = await ch.listUserChats('opened', 3);
  for (var i = 0; i < chats.userChats.length; i++) {
    var c = chats.userChats[i];
    try {
      var user = await ch.getUser(c.userId);
      console.log('=== chatId:', c.id, '===');
      console.log(JSON.stringify(user, null, 2));
      console.log('');
    } catch(e) { console.log('error:', e.message); }
  }
})();
