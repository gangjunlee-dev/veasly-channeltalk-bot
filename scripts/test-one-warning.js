var path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
var fs = require('fs');
var ch = require('../lib/channeltalk');
(async function(){
  // 미발송 채팅 중 하나 선택
  var chatId = '6a08d9d2d2a5e3d9a267';
  
  // listUserChats에서 해당 채팅 찾기
  var chats = await ch.listUserChats('opened', 50);
  var target = null;
  for (var i = 0; i < chats.userChats.length; i++) {
    if (chats.userChats[i].id === chatId) {
      target = chats.userChats[i];
      break;
    }
  }
  if (!target) { console.log('채팅을 찾을 수 없음:', chatId); return; }
  var userId = target.userId || '';
  console.log('chatId:', chatId, '| userId:', userId);

  // 유저 정보 조회
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
  var surveyUrl = baseUrl + '?cid=' + chatId + '&uid=' + userId + '&lang=zh-TW&type=bot&ts=' + Math.floor(Date.now()/1000) + '&member=' + (userInfo.member ? '1' : '0') + '&email=' + encodeURIComponent(userInfo.email) + '&vid=' + encodeURIComponent(userInfo.veaslyId);
  
  console.log('');
  console.log('surveyUrl:', surveyUrl);
  console.log('');
  var msg = '\u23f0 提醒您，此對話即將結束。\n\n如果沒有其他問題，此對話將在稍後自動結束。\n如需繼續諮詢，請回覆任何訊息即可！\n\n\ud83d\udcac 最後想請您花30秒填個小問卷，有機會參加每月抽獎 \ud83c\udf81\n\n\ud83d\udc49 ' + surveyUrl;
  console.log('--- 발송될 메시지 미리보기 ---');
  console.log(msg);
  console.log('');
  console.log('(실제 발송 안 함 - 미리보기만)');
})();
