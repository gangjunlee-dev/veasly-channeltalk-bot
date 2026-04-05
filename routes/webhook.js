var express = require('express');
var router = express.Router();
var channeltalk = require('../lib/channeltalk');
var matcher = require('../lib/matcher');
var lang = require('../lib/language');

var processedMessages = {};
var satisfactionPending = {};
var chatLanguage = {};

setInterval(function() {
  var now = Date.now();
  var keys = Object.keys(processedMessages);
  for (var i = 0; i < keys.length; i++) {
    if (now - processedMessages[keys[i]] > 120000) delete processedMessages[keys[i]];
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

function getMenuText(language) {
  var menus = {
    'zh-TW': '請輸入數字選擇：\n\n1️⃣ 配送/物流\n2️⃣ 費用/運費\n3️⃣ 付款方式\n4️⃣ 取消/退款\n5️⃣ 訂單查詢\n6️⃣ 怎麼下單\n7️⃣ 點數/折扣\n8️⃣ 報價代購\n9️⃣ 團購\n0️⃣ 轉接客服',
    'ko': '번호를 입력해주세요:\n\n1️⃣ 배송/물류\n2️⃣ 비용/운임\n3️⃣ 결제 방법\n4️⃣ 취소/환불\n5️⃣ 주문 조회\n6️⃣ 주문 방법\n7️⃣ 포인트/할인\n8️⃣ 견적/대리구매\n9️⃣ 공동구매\n0️⃣ 상담사 연결',
    'en': 'Enter a number:\n\n1️⃣ Shipping\n2️⃣ Fees\n3️⃣ Payment\n4️⃣ Cancel/Refund\n5️⃣ Order Status\n6️⃣ How to Order\n7️⃣ Points/Discount\n8️⃣ Quote\n9️⃣ Group Buy\n0️⃣ Agent',
    'ja': '番号を入力してください:\n\n1️⃣ 配送\n2️⃣ 費用\n3️⃣ 支払い\n4️⃣ キャンセル/返金\n5️⃣ 注文確認\n6️⃣ 注文方法\n7️⃣ ポイント/割引\n8️⃣ 見積もり\n9️⃣ 共同購入\n0️⃣ カスタマーサービス'
  };
  return menus[language] || menus['zh-TW'];
}

var NUMBER_TO_QUERY = {
  '1': '配送要多久',
  '2': '運費怎麼算',
  '3': '付款方式',
  '4': '取消退款',
  '5': '訂單查詢',
  '6': '怎麼下單',
  '7': '點數折扣',
  '8': '報價',
  '9': '團購',
  '0': '客服'
};

function isEscalationRequest(text) {
  var keywords = ['客服','真人','人工','轉接','聯繫我們','聯繫客服','고객센터','상담사','상담원','사람','연결','agent','human','support','real person','カスタマーサービス','担当者'];
  var lower = text.toLowerCase().trim();
  for (var i = 0; i < keywords.length; i++) {
    if (lower.includes(keywords[i].toLowerCase())) return true;
  }
  if (lower === '0') return true;
  return false;
}

function isSatisfactionResponse(text) {
  var ratings = ['非常滿意','滿意','普通','不太滿意','매우 만족','만족','보통','불만족','very satisfied','satisfied','average','unsatisfied','⭐','1점','2점','3점','4점','5점'];
  var lower = text.toLowerCase().trim();
  for (var i = 0; i < ratings.length; i++) {
    if (lower.includes(ratings[i].toLowerCase())) return true;
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

    // New chat - welcome + menu
    if (type === 'userchat' && event === 'push') {
      var chatId = entity && entity.id;
      if (chatId) {
        var welcome = lang.getMessage('zh-TW', 'welcome');
        var menu = getMenuText('zh-TW');
        chatLanguage[chatId] = 'zh-TW';
        await channeltalk.sendMessage(chatId, {
          blocks: [{ type: 'text', value: welcome + '\n\n' + menu }]
        });
        console.log('[Bot] Welcome sent: ' + chatId);
      }
      return res.status(200).send('OK');
    }

    // Message
    if (type === 'message' && (event === 'upsert' || event === 'push')) {
      var message = entity;
      if (!message) return res.status(200).send('OK');

      var msgId = message.id || '';
      if (processedMessages[msgId]) return res.status(200).send('OK');
      processedMessages[msgId] = Date.now();

      var personType = message.personType || '';
      var chatType = message.chatType || '';
      var chatId2 = message.chatId || message.userChatId || '';

      // Ignore bot/manager messages
      if (personType === 'bot' || personType === 'manager') {
        return res.status(200).send('OK');
      }

      if (chatType === 'userChat' || chatType === 'userchat' || chatType === 'UserChat') {
        var userText = extractText(message);
        console.log('[Bot] User: "' + userText + '" chat: ' + chatId2);
        if (!userText || !chatId2) return res.status(200).send('OK');

        // Detect language
        var detectedLang = lang.detectLanguage(userText);
        chatLanguage[chatId2] = detectedLang;
        console.log('[Bot] Lang: ' + detectedLang);

        // Satisfaction response
        if (satisfactionPending[chatId2] && isSatisfactionResponse(userText)) {
          delete satisfactionPending[chatId2];
          var thankMsgs = {
            'ko': '소중한 피드백 감사합니다! 더 나은 서비스로 보답하겠습니다.',
            'en': 'Thank you for your feedback! We will keep improving.',
            'ja': 'フィードバックありがとうございます！',
            'zh-TW': '感謝您的回饋！我們會持續改進服務品質！'
          };
          await channeltalk.sendMessage(chatId2, { blocks: [{ type: 'text', value: thankMsgs[detectedLang] || thankMsgs['zh-TW'] }] });
          console.log('[Bot] Satisfaction recorded: ' + chatId2);
          return res.status(200).send('OK');
        }

        // Number menu → convert
        var trimmed = userText.trim();
        if (NUMBER_TO_QUERY[trimmed]) {
          userText = NUMBER_TO_QUERY[trimmed];
          console.log('[Bot] Menu: ' + trimmed + ' -> ' + userText);
        }

        // Escalation
        if (isEscalationRequest(userText)) {
          var escMsg = lang.getMessage(detectedLang, 'escalate');
          await channeltalk.sendMessage(chatId2, { blocks: [{ type: 'text', value: escMsg }] });
          try {
            var mgrs = await channeltalk.listManagers();
            var mgrList = (mgrs.managers || []);
            for (var m = 0; m < mgrList.length; m++) {
              if (mgrList[m].operator) {
                await channeltalk.inviteManager(chatId2, mgrList[m].id);
                console.log('[Bot] Manager invited: ' + mgrList[m].name);
                break;
              }
            }
          } catch (e) { console.error('[Bot] Invite error:', e.message); }
          return res.status(200).send('OK');
        }

        // INSTANT FAQ response (no ALF wait)
        var matched = matcher.findBestMatch(userText);

        if (matched) {
          await channeltalk.sendMessage(chatId2, { blocks: [{ type: 'text', value: matched.answer }] });
          console.log('[Bot] FAQ: ' + matched.id + ' (' + detectedLang + ')');

          if (matched.escalate) {
            try {
              var mgrs2 = await channeltalk.listManagers();
              for (var n = 0; n < (mgrs2.managers || []).length; n++) {
                if (mgrs2.managers[n].operator) {
                  await channeltalk.inviteManager(chatId2, mgrs2.managers[n].id);
                  break;
                }
              }
            } catch (e2) { console.error('[Bot] Escalate error:', e2.message); }
          }
        } else {
          // Fallback + menu
          var fbMsg = lang.getMessage(detectedLang, 'fallback');
          var menuMsg = getMenuText(detectedLang);
          await channeltalk.sendMessage(chatId2, { blocks: [{ type: 'text', value: fbMsg + '\n\n' + menuMsg }] });
          console.log('[Bot] Fallback+menu (' + detectedLang + ')');
        }
      }
      return res.status(200).send('OK');
    }

    // Chat closed - satisfaction survey
    if (type === 'userchat' && event === 'update') {
      var closedChat = entity;
      if (closedChat && closedChat.state === 'closed') {
        var surveyLang = chatLanguage[closedChat.id] || 'zh-TW';
        var surveyMsg = lang.getMessage(surveyLang, 'satisfaction');
        satisfactionPending[closedChat.id] = Date.now();
        setTimeout(async function() {
          try {
            await channeltalk.sendMessage(closedChat.id, { blocks: [{ type: 'text', value: surveyMsg }] });
            console.log('[Bot] Survey sent: ' + closedChat.id);
          } catch (e) { console.error('[Bot] Survey error:', e.message); }
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
