var express = require('express');
var router = express.Router();
var channeltalk = require('../lib/channeltalk');
var matcher = require('../lib/matcher');

var FALLBACK_TEXT = '感謝您的訊息！我正在為您查詢中。\n\n您可以嘗試用關鍵字描述問題（例如：配送、退款、點數）\n或輸入「客服」轉接真人客服\n\n我們會盡快回覆您！';

var ESCALATE_TEXT = '正在為您轉接真人客服，請稍候...';

// 최근 처리한 메시지 ID 저장 (중복 방지)
var processedMessages = {};

// ALF 응답 대기 큐
var pendingChats = {};

function extractText(message) {
  if (!message) return '';
  if (message.plainText) return message.plainText;
  if (message.blocks) {
    var texts = [];
    for (var i = 0; i < message.blocks.length; i++) {
      if (message.blocks[i].type === 'text' && message.blocks[i].value) {
        texts.push(message.blocks[i].value);
      }
    }
    return texts.join(' ').trim();
  }
  return '';
}

// 오래된 처리 기록 정리 (메모리 관리)
setInterval(function() {
  var now = Date.now();
  var keys = Object.keys(processedMessages);
  for (var i = 0; i < keys.length; i++) {
    if (now - processedMessages[keys[i]] > 60000) {
      delete processedMessages[keys[i]];
    }
  }
  var pkeys = Object.keys(pendingChats);
  for (var j = 0; j < pkeys.length; j++) {
    if (now - pendingChats[pkeys[j]].time > 60000) {
      delete pendingChats[pkeys[j]];
    }
  }
}, 60000);

router.post('/channeltalk', async function(req, res) {
  try {
    var body = req.body;
    var event = body.event;
    var type = (body.type || '').toLowerCase();
    var entity = body.entity;

    console.log('[Webhook] event=' + event + ', type=' + type);

    // 메시지 이벤트만 처리
    if (type === 'message' && (event === 'upsert' || event === 'push')) {
      var message = entity;
      if (!message) return res.status(200).send('OK');

      var messageId = message.id || '';
      var personType = message.personType || '';
      var chatType = message.chatType || '';
      var chatId = message.chatId || message.userChatId || '';

      // 중복 메시지 방지
      if (messageId && processedMessages[messageId]) {
        return res.status(200).send('OK');
      }
      if (messageId) processedMessages[messageId] = Date.now();

      // ALF/봇 응답 감지 → 해당 채팅의 대기 취소
      if (personType === 'bot' || personType === 'manager') {
        if (pendingChats[chatId]) {
          console.log('[Bot] ALF/manager already responded to chat: ' + chatId + ', cancelling bot reply');
          clearTimeout(pendingChats[chatId].timer);
          delete pendingChats[chatId];
        }
        return res.status(200).send('OK');
      }

      // 고객 메시지 처리
      if (personType === 'user' && (chatType === 'userChat' || chatType === 'userchat' || chatType === 'UserChat')) {
        var userText = extractText(message);
        console.log('[Bot] User says: "' + userText + '" in chat: ' + chatId);

        if (!userText || !chatId) return res.status(200).send('OK');

        // 기존 대기 중인 타이머 취소
        if (pendingChats[chatId]) {
          clearTimeout(pendingChats[chatId].timer);
          delete pendingChats[chatId];
        }

        // "客服" 키워드는 즉시 매니저 연결 (ALF 대기 안함)
        var isEscalate = userText.includes('客服') || userText.includes('聯繫') || userText.includes('真人') || userText.includes('人工');
        
        if (isEscalate) {
          console.log('[Bot] Escalation requested, inviting manager immediately');
          try {
            await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: ESCALATE_TEXT }] });
            var managers = await channeltalk.listManagers();
            if (managers && managers.managers && managers.managers.length > 0) {
              // 온라인 매니저 우선
              var onlineIds = [];
              if (managers.onlines) {
                for (var o = 0; o < managers.onlines.length; o++) {
                  onlineIds.push(managers.onlines[o].personId);
                }
              }
              var targetManager = onlineIds.length > 0 ? onlineIds[0] : managers.managers[0].id;
              await channeltalk.inviteManager(chatId, targetManager);
              console.log('[Bot] Manager invited: ' + targetManager);
            }
          } catch (e) {
            console.error('[Bot] Escalation failed:', e.message);
          }
          return res.status(200).send('OK');
        }

        // ALF에게 10초 시간을 줌
        var matched = matcher.findBestMatch(userText);
        
        pendingChats[chatId] = {
          time: Date.now(),
          userText: userText,
          matched: matched,
          timer: setTimeout(async function() {
            try {
              // 10초 후에도 pendingChats에 남아있으면 = ALF가 응답 안 한 것
              if (pendingChats[chatId]) {
                delete pendingChats[chatId];
                
                if (matched) {
                  await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: matched.answer }] });
                  console.log('[Bot] FAQ answered (ALF timeout): ' + matched.id);
                } else {
                  await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: FALLBACK_TEXT }] });
                  console.log('[Bot] Fallback sent (ALF timeout)');
                }
              }
            } catch (err) {
              console.error('[Bot] Delayed response error:', err.message);
            }
          }, 15000)
        };
        
        console.log('[Bot] Waiting 15s for ALF to respond first...');
      }

      return res.status(200).send('OK');
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook Error]', error.message);
    res.status(200).send('OK');
  }
});

module.exports = router;
