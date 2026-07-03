var path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
var ch = require('../lib/channeltalk');
(async function(){
  var chatId = '6a06af277ee55a4ecf6e';
  var userId = '693bbde633e3d94b05d6';
  
  var userInfo = { member: false, email: '', veaslyId: '' };
  try {
    var userData = await ch.getUser(userId);
    var u = (userData && userData.user) ? userData.user : userData;
    if (u) {
      userInfo.member = u.member === true;
      userInfo.email = u.email || (u.profile && u.profile.email) || '';
      userInfo.veaslyId = (u.profile && u.profile.veasly_id) || u.memberId || '';
    }
  } catch(e) { console.log('User info error:', e.message); }
  
  console.log('userInfo:', JSON.stringify(userInfo));

  var baseUrl = 'https://veasly-dashboard.gangjun-lee.workers.dev/survey.html';
  var surveyUrl = baseUrl + '?cid=test-self-' + Date.now() + '&uid=' + userId + '&lang=zh-TW&type=bot&ts=' + Math.floor(Date.now()/1000) + '&member=' + (userInfo.member ? '1' : '0') + '&email=' + encodeURIComponent(userInfo.email) + '&vid=' + encodeURIComponent(userInfo.veaslyId);
  
  var msg = '\u23f0 提醒您，此對話即將結束。\n\n如果沒有其他問題，此對話將在稍後自動結束。\n如需繼續諮詢，請回覆任何訊息即可！\n\n\ud83d\udcac 最後想請您花30秒填個小問卷，有機會參加每月抽獎 \ud83c\udf81\n\n\ud83d\udc49 <link type="url">' + surveyUrl + '</link>';
  
  console.log('발송 중...');
  await ch.sendMessage(chatId, { blocks: [{ type: 'text', value: msg }] });
  console.log('SENT OK');
  console.log('surveyUrl:', surveyUrl);
})();
