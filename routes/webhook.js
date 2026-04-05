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
  Object.keys(processedMessages).forEach(function(k) {
    if (now - processedMessages[k] > 120000) delete processedMessages[k];
  });
}, 60000);

function extractText(message) {
  if (!message) return '';
  if (message.plainText) return message.plainText.trim();
  if (message.blocks && Array.isArray(message.blocks)) {
    return message.blocks
      .filter(function(b) { return b.type === 'text'; })
      .map(function(b) { return b.value || ''; })
      .join(' ')
      .trim();
  }
  if (message.message) return message.message.trim();
  return '';
}

function getMenuText(language) {
  var menus = {
    'zh-TW': '請輸入數字查詢：\n1️⃣ 第一次使用（新會員指南）\n2️⃣ 已下單（訂單相關）\n3️⃣ 配送/物流\n4️⃣ 費用/運費\n5️⃣ 付款方式\n6️⃣ 取消/退款\n7️⃣ 訂單查詢\n8️⃣ 怎麼下單\n9️⃣ 點數/折扣碼\n0️⃣ 轉接真人客服',
    'ko': '번호를 입력해주세요：\n1️⃣ 처음 이용 (신규회원)\n2️⃣ 주문 완료 회원\n3️⃣ 배송/물류\n4️⃣ 비용/운임\n5️⃣ 결제 방법\n6️⃣ 취소/환불\n7️⃣ 주문 조회\n8️⃣ 주문 방법\n9️⃣ 포인트/할인\n0️⃣ 상담사 연결',
    'en': 'Enter a number:\n1️⃣ First time (New member guide)\n2️⃣ Already ordered\n3️⃣ Shipping/Delivery\n4️⃣ Fees\n5️⃣ Payment methods\n6️⃣ Cancel/Refund\n7️⃣ Order tracking\n8️⃣ How to order\n9️⃣ Points/Coupons\n0️⃣ Talk to agent',
    'ja': '番号を入力してください：\n1️⃣ 初めての方\n2️⃣ 注文済みの方\n3️⃣ 配送/物流\n4️⃣ 費用/送料\n5️⃣ お支払い方法\n6️⃣ キャンセル/返金\n7️⃣ 注文確認\n8️⃣ 注文方法\n9️⃣ ポイント/割引\n0️⃣ オペレーター接続'
  };
  return menus[language] || menus['zh-TW'];
}

var NUMBER_TO_QUERY = {
  '1': '第一次使用',
  '2': '已下單',
  '3': '配送要多久',
  '4': '運費怎麼算',
  '5': '付款方式',
  '6': '取消退款',
  '7': '訂單查詢',
  '8': '怎麼下單',
  '9': '點數折扣',
  '0': '客服'
};

function isEscalationRequest(text) {
  var keywords = ['客服', '真人', '상담사', '상담원', '사람', 'agent', 'human', 'operator', 'help me', 'オペレーター', '담당자'];
  var lower = text.toLowerCase().trim();
  if (lower === '0') return true;
  for (var i = 0; i < keywords.length; i++) {
    if (lower.indexOf(keywords[i].toLowerCase()) !== -1) return true;
  }
  return false;
}

function isGreeting(text) {
  var greetings = ['你好', '您好', '哈囉', 'hi', 'hello', '안녕', 'hey', 'こんにちは', '嗨', 'halo'];
  var lower = text.toLowerCase().trim();
  for (var i = 0; i < greetings.length; i++) {
    if (lower === greetings[i] || lower === greetings[i] + '!' || lower === greetings[i] + '~') return true;
  }
  return false;
}

function isSatisfactionResponse(text) {
  var keywords = ['좋아', '좋았', '만족', '감사', '고마', 'good', 'great', 'thank', 'satisfied', '很好', '滿意', '感謝', '謝謝', '不好', '不滿', '差', 'bad', 'poor', '별로', '나빠', '⭐', '👍', '👎', '1', '2', '3', '4', '5'];
  var lower = text.toLowerCase().trim();
  for (var i = 0; i < keywords.length; i++) {
    if (lower.indexOf(keywords[i]) !== -1) return true;
  }
  return false;
}

function isSystemEvent(text) {
  var sysKeywords = ['joined', 'left', 'opened', 'closed', 'assigned', 'snoozed', 'unsnoozed'];
  var lower = text.toLowerCase().trim();
  for (var i = 0; i < sysKeywords.length; i++) {
    if (lower === sysKeywords[i]) return true;
  }
  return false;
}

router.post('/channeltalk', async function(req, res) {
  try {
    var body = req.body || {};
    var event = body.event || '';
    var type = (body.type || '').toLowerCase();
    var entity = body.entity;

    console.log('[Webhook] event=' + event + ', type=' + type);

    // Chat closed -> satisfaction survey
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
          } catch(e) {
            console.error('[Bot] Survey error:', e.message);
          }
        }, 3000);
      }
      return res.status(200).send('OK');
    }

    // Only process message events
    if (type !== 'message') return res.status(200).send('OK');
    if (!['upsert', 'push'].includes(event)) return res.status(200).send('OK');

    var message = entity;
    if (!message) return res.status(200).send('OK');

    var msgId = message.id || '';
    if (processedMessages[msgId]) return res.status(200).send('OK');
    processedMessages[msgId] = Date.now();

    var personType = (message.personType || '').toLowerCase();
    if (personType === 'bot' || personType === 'manager') return res.status(200).send('OK');

    var chatType = (message.chatType || '').toLowerCase();
    if (chatType !== 'userchat') return res.status(200).send('OK');

    var chatId = message.chatId || message.userChatId || '';
    var userText = extractText(message);
    if (!userText || !chatId) return res.status(200).send('OK');
    if (isSystemEvent(userText)) return res.status(200).send('OK');

    var detectedLang = lang.detectLanguage(userText);
    chatLanguage[chatId] = detectedLang;
    console.log('[Bot] User: "' + userText + '" lang=' + detectedLang + ' chat=' + chatId);

    // Satisfaction response
    if (satisfactionPending[chatId] && isSatisfactionResponse(userText)) {
      delete satisfactionPending[chatId];
      var thanks = {
        'zh-TW': '感謝您的回饋！我們會持續改進服務品質！',
        'ko': '소중한 피드백 감사합니다! 더 나은 서비스로 보답하겠습니다.',
        'en': 'Thank you for your feedback! We will keep improving.',
        'ja': 'フィードバックありがとうございます！'
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: thanks[detectedLang] || thanks['zh-TW'] }] });
      return res.status(200).send('OK');
    }

    // Greeting -> just show menu (no duplicate welcome)
    if (isGreeting(userText)) {
      var greetReply = {
        'zh-TW': '您好！請輸入數字即可查詢 👇',
        'ko': '안녕하세요! 아래 번호를 입력해주세요 👇',
        'en': 'Hello! Please enter a number below 👇',
        'ja': 'こんにちは！番号を入力してください 👇'
      };
      var menu = getMenuText(detectedLang);
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: (greetReply[detectedLang] || greetReply['zh-TW']) + '\n\n' + menu }] });
      console.log('[Bot] Greeting+menu (' + detectedLang + ')');
      return res.status(200).send('OK');
    }

    // Number menu conversion
    var trimmed = userText.trim();
    if (NUMBER_TO_QUERY[trimmed]) {
      userText = NUMBER_TO_QUERY[trimmed];
    }

    // Escalation
    if (isEscalationRequest(userText)) {
      var escMsgs = {
        'zh-TW': '正在為您轉接真人客服，請稍候！\n💡 客服時間：平日 10:00~19:00（韓國時間）\n⏰ 非上班時間留言，我們會盡快回覆！',
        'ko': '상담사를 연결해 드리겠습니다. 잠시만 기다려주세요!\n💡 상담 시간: 평일 10:00~19:00 (한국시간)\n⏰ 업무 외 시간에는 메시지를 남겨주시면 빠르게 답변드리겠습니다!',
        'en': 'Connecting you to a live agent, please wait!\n💡 Hours: Weekdays 10:00~19:00 (KST)\n⏰ Outside hours, leave a message and we\'ll reply ASAP!',
        'ja': 'オペレーターにお繋ぎします。少々お待ちください！\n💡 対応時間：平日 10:00~19:00（韓国時間）\n⏰ 時間外はメッセージを残してください！'
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: escMsgs[detectedLang] || escMsgs['zh-TW'] }] });
      try {
        var mgrs = await channeltalk.listManagers();
        var managers = (mgrs && mgrs.managers) || [];
        for (var i = 0; i < managers.length; i++) {
          if (managers[i].operator) {
            await channeltalk.inviteManager(chatId, managers[i].id);
            console.log('[Bot] Manager invited: ' + (managers[i].name || managers[i].id));
            break;
          }
        }
      } catch(e) {
        console.error('[Bot] Invite error:', e.message);
      }
      return res.status(200).send('OK');
    }

    // FAQ matching - instant response
    var matched = matcher.findBestMatch(userText);
    if (matched) {
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: matched.answer }] });
      console.log('[Bot] FAQ: ' + matched.id + ' (' + detectedLang + ')');
      if (matched.escalate) {
        try {
          var mgrs2 = await channeltalk.listManagers();
          var managers2 = (mgrs2 && mgrs2.managers) || [];
          for (var j = 0; j < managers2.length; j++) {
            if (managers2[j].operator) {
              await channeltalk.inviteManager(chatId, managers2[j].id);
              break;
            }
          }
        } catch(e) {
          console.error('[Bot] Escalate error:', e.message);
        }
      }
      return res.status(200).send('OK');
    }

    // No match -> fallback + menu
    var fallbackMsgs = {
      'zh-TW': '抱歉，目前找不到相關資訊。請重新選擇或輸入 0 轉接客服：',
      'ko': '죄송합니다. 관련 정보를 찾지 못했습니다. 다시 선택하시거나 0을 입력해 상담사를 연결하세요:',
      'en': 'Sorry, I couldn\'t find relevant info. Please choose again or enter 0 for an agent:',
      'ja': '申し訳ございません。該当する情報が見つかりませんでした。再度選択するか、0でオペレーターに接続します：'
    };
    var fbMenu = getMenuText(detectedLang);
    await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: (fallbackMsgs[detectedLang] || fallbackMsgs['zh-TW']) + '\n\n' + fbMenu }] });
    console.log('[Bot] Fallback+menu (' + detectedLang + ')');

    res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook Error]', error.message);
    res.status(200).send('OK');
  }
});

module.exports = router;
