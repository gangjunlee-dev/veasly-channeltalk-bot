var path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
var ch = require('../lib/channeltalk');

(async function(){
  var chats = await ch.listUserChats('opened', 10);
  for (var i = 0; i < chats.userChats.length; i++) {
    var c = chats.userChats[i];
    try {
      var user = await ch.getUser(c.userId);
      console.log('---');
      console.log('chatId:', c.id);
      console.log('userId:', c.userId);
      console.log('name:', user.name || 'N/A');
      console.log('email:', user.email || 'N/A');
      console.log('phone:', user.mobileNumber || 'N/A');
      console.log('memberId:', user.memberId || 'N/A');
      console.log('hasProfile:', !!user.profile);
      console.log('profileKeys:', user.profile ? Object.keys(user.profile).join(', ') : 'none');
    } catch(e) { console.log('error:', e.message); }
  }
})();
