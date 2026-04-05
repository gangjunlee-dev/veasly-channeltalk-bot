var express = require('express');
var router = express.Router();
var channeltalk = require('../lib/channeltalk');
var matcher = require('../lib/matcher');
var lang = require('../lib/language');

var processedMessages = {};
var pendingChats = {};
var satisfactionPending = {};

setInterval(function() {
  var now = Date.now();
  var keys = Object.keys(processedMessages);
  for (var i = 0; i < keys.length; i++) {
    if (now - processedMessages[keys[i]] > 120000) delete processedMessages[keys[i]];
  }
  var pKeys = Object.keys(pendingChats);
  for (var j = 0; j < pKeys.length; j++) {
    if (now - pendingChats[pKeys[j]].time > 60000) delete pendingChats[pKeys[j]];
  }
}, 60000);

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

function buildMenuMessage(language) {
  var title = lang.getMessage(language, 'menuTitle');
  var menuItems = {
    'zh-TW': [
      { label: '📦 配送/物流', value: '配送要多久' },
      { label: '💰 費用/運費', value: '運費怎麼算' },
      { label: '💳 付款方式', value: '付款方式' },
      { label: '🔄 取消/退款', value: '取消退款' },
      { label: '📋 訂單查詢', value: '訂單查詢' },
      { label: '🛒 怎麼下單', value: '怎麼下單' },
      { label: '🎁 點數/折扣', value: '點數折扣' },
      { label: '📝 報價代購', value: '報價' },
      { label: '👥 團購', value: '團購' },
      { label: '👤 轉接客服', value: '客服' }
    ],
    'ko': [
      { label: '📦 배송/물류', value: '배송 얼마나' },
      { label: '💰 비용/운임', value: '운임 계산' },
      { label: '💳 결제 방법', value: '결제 방법' },
      { label: '🔄 취소/환불', value: '취소 환불' },
      { label: '📋 주문 조회', value: '주문 조회' },
      { label: '🛒 주문 방법', value: '주문 방법' },
      { label: '🎁 포인트/할인', value: '포인트' },
      { label: '📝 견적/대리구매', value: '견적' },
      { label: '👥 공동구매', value: '공동구매' },
      { label: '👤 상담사 연결', value: '고객센터' }
    ],
    'en': [
      { label: '📦 Shipping', value: 'shipping time' },
      { label: '💰 Fees', value: 'shipping fee' },
      { label: '💳 Payment', value: 'payment method' },
      { label: '🔄 Cancel/Refund', value: 'cancel refund' },
      { label: '📋 Order Status', value: 'order status' },
      { label: '🛒 How to Order', value: 'how to order' },
      { label: '🎁 Points/Discount', value: 'points discount' },
      { label: '📝 Quote', value: 'quote' },
      { label: '👥 Group Buy', value: 'group buy' },
      { label: '👤 Agent', value: 'agent' }
    ],
    'ja': [
      { label: '📦 配送', value: '配送時間' },
      { label: '💰 費用', value: '送料計算' },
      { label: '💳 支払い', value: '支払い方法' },
      { label: '🔄 キャンセル', value: 'キャンセル' },
      { label: '📋 注文確認', value: '注文確認' },
      { label: '🛒 注文方法', value: '注文方法' },
      { label: '👤 カスタマーサービス', value: 'カスタマーサービス' }
    ]
  };

  var items = menuItems[language] || menuItems['zh-TW'];
  var buttonText = title + '\n\n';
  for (var i = 0; i < items.length; i++) {
    buttonText += items[i].label + '\n';
  }
  return buttonText;
}

function isSatisfactionResponse(text) {
  var ratings = ['非常滿意','滿意','普通','不太滿意','매우 만족','만족','보통','불만족',
    'very satisfied','satisfied','average','unsatisfied','とても満足','満足','普通','不満',
    '⭐','1','2','3','4','5'];
  var lower = text.toLowerCase().trim();
  for (var i = 0; i < ratings.length; i++) {
    if (lower.includes(ratings[i].toLowerCase())) return true;
  }
  return false;
}

function isEscalationRequest(text, language) {
  var keywords = {
    'zh-TW': ['客服','真人','人工','轉接','聯繫我們','聯繫客服'],
    'ko': ['고객센터','상담사','상담원','사람','연결'],
    'en': ['agent','human','support','help me','real person'],
    'ja': ['カスタマーサービス','担当者','人間']
  };
  var lower = text.toLowerCase().trim();
  var kwList = keywords[language] || keywords['zh-TW'];
  for (var i = 0; i < kwList.length; i++) {
    if (lower.includes(kwList[i].toLowerCase())) return true;
  }
  return false;
}

router.post('/channeltalk', async function(req, res) {
  try {
    var body = req.body;
    var event = body.event;
    var type = (body.type || '').toLowerCase();
    var entity = body.entity;

    console.log('[Webhook] event=' + event + ', type=' + type);

    // New chat created - send welcome + menu
    if (type === 'userchat' && event === 'push') {
      var chatId = entity && entity.id;
      if (chatId) {
        var welcomeMsg = lang.getMessage('zh-TW', 'welcome');
        var menuMsg = buildMenuMessage('zh-TW');
        await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: welcomeMsg + '\n\n' + menuMsg }] });
        console.log('[Bot] Welcome + menu sent to: ' + chatId);
      }
      return res.status(200).send('OK');
    }

    // Message event
    if (type === 'message' && (event === 'upsert' || event === 'push')) {
      var message = entity;
      if (!message) return res.status(200).send('OK');

      var msgId = message.id || '';
      if (processedMessages[msgId]) return res.status(200).send('OK');
      processedMessages[msgId] = Date.now();

      var personType = message.personType || '';
      var chatType = message.chatType || '';
      var chatId2 = message.chatId || message.userChatId || '';

      // Cancel pending bot reply if ALF/manager responded
      if ((personType === 'bot' || personType === 'manager') && pendingChats[chatId2]) {
        clearTimeout(pendingChats[chatId2].timer);
        delete pendingChats[chatId2];
        console.log('[Bot] ALF/manager responded to: ' + chatId2 + ', bot reply cancelled');
        return res.status(200).send('OK');
      }

      if (personType === 'bot' || personType === 'manager') {
        return res.status(200).send('OK');
      }

      if (chatType === 'userChat' || chatType === 'userchat' || chatType === 'UserChat') {
        var userText = extractText(message);
        console.log('[Bot] User says: "' + userText + '" in chat: ' + chatId2);

        if (!userText || !chatId2) return res.status(200).send('OK');

        var detectedLang = lang.detectLanguage(userText);
        console.log('[Bot] Language: ' + detectedLang);

        // Check satisfaction response
        if (satisfactionPending[chatId2] && isSatisfactionResponse(userText)) {
          delete satisfactionPending[chatId2];
          var thankMsg = detectedLang === 'ko' ? '소중한 피드백 감사합니다! 더 나은 서비스로 보답하겠습니다.' :
            detectedLang === 'en' ? 'Thank you for your feedback! We will improve our service.' :
            detectedLang === 'ja' ? 'フィードバックありがとうございます！サービス向上に努めます。' :
            '感謝您的回饋！我們會持續改進服務品質！';
          await channeltalk.sendMessage(chatId2, { blocks: [{ type: 'text', value: thankMsg }] });
          console.log('[Bot] Satisfaction recorded for: ' + chatId2);
          return res.status(200).send('OK');
        }

        // Check escalation
        if (isEscalationRequest(userText, detectedLang)) {
          var escMsg = lang.getMessage(detectedLang, 'escalate');
          await channeltalk.sendMessage(chatId2, { blocks: [{ type: 'text', value: escMsg }] });
          try {
            var managers = await channeltalk.listManagers();
            var managerList = (managers.managers || []);
            for (var m = 0; m < managerList.length; m++) {
              if (managerList[m].operator) {
                await channeltalk.inviteManager(chatId2, managerList[m].id);
                console.log('[Bot] Manager invited: ' + managerList[m].name);
                break;
              }
            }
          } catch (e) {
            console.error('[Bot] Manager invite error:', e.message);
          }
          return res.status(200).send('OK');
        }

        // ALF-first: wait 15s
        if (pendingChats[chatId2]) {
          clearTimeout(pendingChats[chatId2].timer);
        }

        pendingChats[chatId2] = {
          time: Date.now(),
          timer: setTimeout(async function() {
            try {
              delete pendingChats[chatId2];
              var matched = matcher.findBestMatch(userText);

              if (matched) {
                await channeltalk.sendMessage(chatId2, { blocks: [{ type: 'text', value: matched.answer }] });
                console.log('[Bot] FAQ answered (' + detectedLang + '): ' + matched.id);

                if (matched.escalate) {
                  var mgrs = await channeltalk.listManagers();
                  var mgrList = (mgrs.managers || []);
                  for (var n = 0; n < mgrList.length; n++) {
                    if (mgrList[n].operator) {
                      await channeltalk.inviteManager(chatId2, mgrList[n].id);
                      break;
                    }
                  }
                }
              } else {
                var fbMsg = lang.getMessage(detectedLang, 'fallback');
                var menu = buildMenuMessage(detectedLang);
                await channeltalk.sendMessage(chatId2, { blocks: [{ type: 'text', value: fbMsg + '\n\n' + menu }] });
                console.log('[Bot] Fallback + menu sent (' + detectedLang + ')');
              }
            } catch (err) {
              console.error('[Bot] Reply error:', err.message);
            }
          }, 15000)
        };
        console.log('[Bot] Waiting 15s for ALF (' + detectedLang + ')...');
      }

      return res.status(200).send('OK');
    }

    // Chat closed - send satisfaction survey
    if (type === 'userchat' && event === 'update') {
      var closedChat = entity;
      if (closedChat && closedChat.state === 'closed') {
        var surveyLang = 'zh-TW';
        var surveyMsg = lang.getMessage(surveyLang, 'satisfaction');
        satisfactionPending[closedChat.id] = Date.now();

        setTimeout(async function() {
          try {
            await channeltalk.sendMessage(closedChat.id, { blocks: [{ type: 'text', value: surveyMsg }] });
            console.log('[Bot] Satisfaction survey sent to: ' + closedChat.id);
          } catch (e) {
            console.error('[Bot] Survey send error:', e.message);
          }
        }, 3000);
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook Error]', error.message);
    res.status(200).send('OK');
  }
});

module.exports = router;
