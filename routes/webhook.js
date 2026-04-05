var express = require('express');
var router = express.Router();
var channeltalk = require('../lib/channeltalk');
var matcher = require('../lib/matcher');
var lang = require('../lib/language');

var processedMessages = {};
var satisfactionPending = {};
var chatLanguage = {};
var welcomeSent = {};

setInterval(function() {
  var now = Date.now();
  var keys = Object.keys(processedMessages);
  for (var i = 0; i < keys.length; i++) {
    if (now - processedMessages[keys[i]] > 120000) delete processedMessages[keys[i]];
  }
  var wKeys = Object.keys(welcomeSent);
  for (var j = 0; j < wKeys.length; j++) {
    if (now - welcomeSent[wKeys[j]] > 3600000) delete welcomeSent[wKeys[j]];
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

function getWelcomeAndMenu(language) {
  var msgs = {
    'zh-TW': '親愛的顧客您好，這裡是韓國代購 VEASLY！\n\n有什麼問題請輸入數字即可查詢！\n基本上都可以解決您的疑問！\n如果不行都有選項可以聯繫我們！\n\n1️⃣ 第一次使用（新會員指南）\n2️⃣ 已下單（訂單相關）\n3️⃣ 配送/物流\n4️⃣ 費用/運費\n5️⃣ 付款方式\n6️⃣ 取消/退款\n7️⃣ 訂單查詢\n8️⃣ 點數/折扣碼\n9️⃣ 報價/團購\n0️⃣ 轉接真人客服\n\n（真人客服上班時間 平日 9:00~18:00）',
    'ko': '안녕하세요! 한국 대리구매 VEASLY입니다!\n\n번호를 입력하시면 안내해드립니다!\n\n1️⃣ 처음 이용 (신규 회원 가이드)\n2️⃣ 주문 완료 (주문 관련)\n3️⃣ 배송/물류\n4️⃣ 비용/운임\n5️⃣ 결제 방법\n6️⃣ 취소/환불\n7️⃣ 주문 조회\n8️⃣ 포인트/할인\n9️⃣ 견적/공동구매\n0️⃣ 상담사 연결\n\n（상담사 근무시간 평일 9:00~18:00）',
    'en': 'Hello! Welcome to VEASLY - Korean Shopping Service!\n\nEnter a number for help:\n\n1️⃣ First time user guide\n2️⃣ Already ordered\n3️⃣ Shipping\n4️⃣ Fees\n5️⃣ Payment\n6️⃣ Cancel/Refund\n7️⃣ Order Status\n8️⃣ Points/Discount\n9️⃣ Quote/Group Buy\n0️⃣ Human Agent\n\n(Agent hours: weekdays 9:00~18:00 KST)',
    'ja': 'こんにちは！韓国代行購入 VEASLYです！\n\n番号を入力してください：\n\n1️⃣ 初めての方\n2️⃣ 注文済み\n3️⃣ 配送\n4️⃣ 費用\n5️⃣ 支払い\n6️⃣ キャンセル/返金\n7️⃣ 注文確認\n8️⃣ ポイント/割引\n9️⃣ 見積もり/共同購入\n0️⃣ カスタマーサービス\n\n（営業時間：平日 9:00~18:00 KST）'
  };
  return msgs[language] || msgs['zh-TW'];
}

function getMenuText(language) {
  var menus = {
    'zh-TW': '請輸入數字選擇：\n\n1️⃣ 第一次使用（新會員指南）\n2️⃣ 已下單（訂單相關）\n3️⃣ 配送/物流\n4️⃣ 費用/運費\n5️⃣ 付款方式\n6️⃣ 取消/退款\n7️⃣ 訂單查詢\n8️⃣ 點數/折扣碼\n9️⃣ 報價/團購\n0️⃣ 轉接真人客服',
    'ko': '번호를 입력해주세요:\n\n1️⃣ 처음 이용\n2️⃣ 주문 완료\n3️⃣ 배송/물류\n4️⃣ 비용/운임\n5️⃣ 결제 방법\n6️⃣ 취소/환불\n7️⃣ 주문 조회\n8️⃣ 포인트/할인\n9️⃣ 견적/공동구매\n0️⃣ 상담사 연결',
    'en': 'Enter a number:\n\n1️⃣ First time user\n2️⃣ Already ordered\n3️⃣ Shipping\n4️⃣ Fees\n5️⃣ Payment\n6️⃣ Cancel/Refund\n7️⃣ Order Status\n8️⃣ Points/Discount\n9️⃣ Quote/Group Buy\n0️⃣ Human Agent',
    'ja': '番号を入力してください:\n\n1️⃣ 初めての方\n2️⃣ 注文済み\n3️⃣ 配送\n4️⃣ 費用\n5️⃣ 支払い\n6️⃣ キャンセル/返金\n7️⃣ 注文確認\n8️⃣ ポイント/割引\n9️⃣ 見積もり/共同購入\n0️⃣ カスタマーサービス'
  };
  return menus[language] || menus['zh-TW'];
}

var NUMBER_TO_QUERY = {
  '1': '第一次使用',
  '2': '訂單查詢',
  '3': '配送要多久',
  '4': '運費怎麼算',
  '5': '付款方式',
  '6': '取消退款',
  '7': '訂單查詢',
  '8': '點數折扣',
  '9': '報價',
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

function isGreeting(text) {
  var greetings = ['你好','您好','哈囉','嗨','hi','hello','hey','안녕','こんにちは','嘿','早安','午安','晚安'];
  var lower = text.toLowerCase().trim();
  for (var i = 0; i < greetings.length; i++) {
    if (lower === greetings[i] || lower === greetings[i] + '！' || lower === greetings[i] + '!') return true;
  }
  return false;
}

function isSatisfactionResponse(text) {
  var ratings = ['非常滿意','滿意','普通','不太滿意','매우 만족','만족','보통','불만족','very satisfied','satisfied','average','unsatisfied','⭐'];
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

    // Message event
    if (type === 'message' && (event === 'upsert' || event === 'push')) {
      var message = entity;
      if (!message) return res.status(200).send('OK');

      var msgId = message.id || '';
      if (processedMessages[msgId]) return res.status(200).send('OK');
      processedMessages[msgId] = Date.now();

      var personType = message.personType || '';
      var chatType = message.chatType || '';
      var chatId = message.chatId || message.userChatId || '';

      // Ignore bot/manager messages
      if (personType === 'bot' || personType === 'manager') {
        return res.status(200).send('OK');
      }

      // Ignore system messages (log actions like open, close, leave)
      if (message.log) {
        console.log('[Bot] System event: ' + (message.log.action || 'unknown'));
        return res.status(200).send('OK');
      }

      if (chatType !== 'userChat') return res.status(200).send('OK');

      var userText = extractText(message);
      if (!userText || !chatId) return res.status(200).send('OK');

      console.log('[Bot] User: "' + userText + '" chat: ' + chatId);

      // Detect language
      var detectedLang = lang.detectLanguage(userText);
      chatLanguage[chatId] = detectedLang;
      console.log('[Bot] Lang: ' + detectedLang);

      // First message in this chat? Send welcome
      if (!welcomeSent[chatId]) {
        welcomeSent[chatId] = Date.now();
        var welcomeMsg = getWelcomeAndMenu(detectedLang);
        await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: welcomeMsg }] });
        console.log('[Bot] Welcome sent: ' + chatId + ' (' + detectedLang + ')');

        // If greeting, stop here (welcome is enough)
        if (isGreeting(userText)) return res.status(200).send('OK');
      }

      // Satisfaction response
      if (satisfactionPending[chatId] && isSatisfactionResponse(userText)) {
        delete satisfactionPending[chatId];
        var thankMsgs = {
          'ko': '소중한 피드백 감사합니다! 더 나은 서비스로 보답하겠습니다.',
          'en': 'Thank you for your feedback! We will keep improving.',
          'ja': 'フィードバックありがとうございます！',
          'zh-TW': '感謝您的回饋！我們會持續改進服務品質！'
        };
        await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: thankMsgs[detectedLang] || thankMsgs['zh-TW'] }] });
        console.log('[Bot] Satisfaction recorded: ' + chatId);
        return res.status(200).send('OK');
      }

      // Number menu → convert
      var trimmed = userText.trim();
      if (NUMBER_TO_QUERY[trimmed]) {
        userText = NUMBER_TO_QUERY[trimmed];
        console.log('[Bot] Menu: ' + trimmed + ' -> ' + userText);
      }

      // Greeting (already got welcome)
      if (isGreeting(userText)) {
        return res.status(200).send('OK');
      }

      // Escalation
      if (isEscalationRequest(userText)) {
        var escMsg = lang.getMessage(detectedLang, 'escalate');
        await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: escMsg }] });
        try {
          var mgrs = await channeltalk.listManagers();
          var mgrList = (mgrs.managers || []);
          for (var m = 0; m < mgrList.length; m++) {
            if (mgrList[m].operator) {
              await channeltalk.inviteManager(chatId, mgrList[m].id);
              console.log('[Bot] Manager invited: ' + mgrList[m].name);
              break;
            }
          }
        } catch (e) { console.error('[Bot] Invite error:', e.message); }
        return res.status(200).send('OK');
      }

      // INSTANT FAQ response
      var matched = matcher.findBestMatch(userText);

      if (matched) {
        await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: matched.answer }] });
        console.log('[Bot] FAQ: ' + matched.id + ' (' + detectedLang + ')');

        if (matched.escalate) {
          try {
            var mgrs2 = await channeltalk.listManagers();
            for (var n = 0; n < (mgrs2.managers || []).length; n++) {
              if (mgrs2.managers[n].operator) {
                await channeltalk.inviteManager(chatId, mgrs2.managers[n].id);
                break;
              }
            }
          } catch (e2) { console.error('[Bot] Escalate error:', e2.message); }
        }
      } else {
        var fbMsg = lang.getMessage(detectedLang, 'fallback');
        var menuMsg = getMenuText(detectedLang);
        await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: fbMsg + '\n\n' + menuMsg }] });
        console.log('[Bot] Fallback+menu (' + detectedLang + ')');
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
