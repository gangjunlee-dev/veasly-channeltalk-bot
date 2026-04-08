var express = require('express');
var router = express.Router();
var channeltalk = require('../lib/channeltalk');
var matcher = require('../lib/matcher');
var lang = require('../lib/language');

var processedMessages = {};
var satisfactionPending = {};
var chatLanguage = {};
var managerActive = {};
var chatContext = {};

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
    'zh-TW': '請輸入數字查詢：\n1️⃣ 第一次使用（新會員指南）\n2️⃣ 已下單（訂單相關）\n3️⃣ 配送/物流\n4️⃣ 費用/運費\n5️⃣ 付款方式\n6️⃣ 取消/退款\n7️⃣ 訂單查詢\n8️⃣ 怎麼下單\n9️⃣ 點數/折扣碼\n\n💡 以上都無法解決？輸入「客服」轉接真人',
    'ko': '번호를 입력해주세요：\n1️⃣ 처음 이용\n2️⃣ 주문 완료\n3️⃣ 배송/물류\n4️⃣ 비용/운임\n5️⃣ 결제 방법\n6️⃣ 취소/환불\n7️⃣ 주문 조회\n8️⃣ 주문 방법\n9️⃣ 포인트/할인\n\n💡 해결이 안 되시면 「상담사」를 입력해주세요',
    'en': 'Enter a number:\n1️⃣ First time\n2️⃣ Already ordered\n3️⃣ Shipping\n4️⃣ Fees\n5️⃣ Payment\n6️⃣ Cancel/Refund\n7️⃣ Order tracking\n8️⃣ How to order\n9️⃣ Points/Coupons\n\n💡 Still need help? Type "agent"',
    'ja': '番号を入力してください：\n1️⃣ 初めての方\n2️⃣ 注文済み\n3️⃣ 配送\n4️⃣ 費用\n5️⃣ お支払い\n6️⃣ キャンセル/返金\n7️⃣ 注文確認\n8️⃣ 注文方法\n9️⃣ ポイント/割引\n\n💡 解決しない場合は「オペレーター」と入力'
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
  '9': '點數折扣'
};

function isBusinessHours() {
  var now = new Date();
  var kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  var day = kst.getUTCDay();
  var hour = kst.getUTCHours();
  return day >= 1 && day <= 5 && hour >= 10 && hour < 19;
}

function isEscalationRequest(text) {
  var keywords = ['客服', '真人', '真人客服', '人工客服', '人工', '找客服', '聯繫我們', '聯繫', '상담사', '상담원', '사람', 'agent', 'human', 'operator', 'help me', 'オペレーター', '담당자', '轉接', '轉人工'];
  var lower = text.toLowerCase().trim();
  for (var i = 0; i < keywords.length; i++) {
    if (lower === keywords[i].toLowerCase()) return true;
  }
  if (lower === '0') return true;
  return false;
}

function isGreeting(text) {
  var lower = text.toLowerCase().trim();
  var exactGreetings = ['你好', '您好', '哈囉', 'hi', 'hello', '안녕', '안녕하세요', 'hey', 'こんにちは', '嗨', 'halo', '早安', '午安', '晚安'];
  for (var i = 0; i < exactGreetings.length; i++) {
    if (lower === exactGreetings[i]) return true;
  }
  if (/^(你好|您好|哈囉|嗨|hi|hello|hey|안녕)[!！~～？?。.]*$/i.test(lower)) return true;
  return false;
}

function isThankYou(text) {
  var lower = text.toLowerCase().trim();
  var thanks = ['謝謝', '感謝', '谢谢', '感谢', '太好了', '好的謝謝', '好的感謝', '知道了感謝', '非常感謝', '太感謝了', '好的', '了解', '知道了', '明白', '收到', 'ok', 'thanks', 'thank you', 'thx', 'ありがとう', '감사합니다', '감사', '고마워'];
  for (var i = 0; i < thanks.length; i++) {
    if (lower === thanks[i] || lower === thanks[i] + '!' || lower === thanks[i] + '~' || lower === thanks[i] + '！' || lower === thanks[i] + '～') return true;
  }
  if (/^(謝|感謝|谢|thanks|thx|감사|ありがとう)/i.test(lower)) return true;
  return false;
}

function isSatisfactionResponse(text) {
  var ratings = ['⭐', '👍', '👎', '1', '2', '3', '4', '5'];
  var keywords = ['좋아', '좋았', '만족', '감사', '고마', 'good', 'great', 'thank', 'satisfied', '很好', '滿意', '感謝', '謝謝', '不好', '不滿', '差', 'bad', 'poor', '별로', '나빠'];
  var lower = text.toLowerCase().trim();
  for (var i = 0; i < ratings.length; i++) {
    if (lower === ratings[i]) return true;
  }
  for (var j = 0; j < keywords.length; j++) {
    if (lower.indexOf(keywords[j]) !== -1) return true;
  }
  return false;
}

function isSystemEvent(text) {
  var lower = text.toLowerCase().trim();
  if (/^(joined|left|opened|closed|assigned|snoozed|unsnoozed)$/i.test(lower)) return true;
  if (lower.indexOf('스티커를 전송했습니다') !== -1) return true;
  if (lower.indexOf('sticker') !== -1 && lower.length < 30) return true;
  return false;
}

function looksLikeOrderNumber(text) {
  var lines = text.trim().split(/[\n\r,\s]+/);
  for (var i = 0; i < lines.length; i++) {
    if (/^\d{8}TW\d+$/i.test(lines[i].trim())) return true;
  }
  return false;
}

function extractOrderNumbers(text) {
  var matches = text.match(/\d{8}TW\d+/gi);
  return matches || [];
}

function getEscalationStep(chatId) {
  if (!chatContext[chatId]) chatContext[chatId] = {};
  return chatContext[chatId].escalationStep || 0;
}

function setEscalationStep(chatId, step) {
  if (!chatContext[chatId]) chatContext[chatId] = {};
  chatContext[chatId].escalationStep = step;
}

router.post('/channeltalk', async function(req, res) {
  try {
    var body = req.body || {};
    var event = body.event || '';
    var type = (body.type || '').toLowerCase();
    var entity = body.entity;

    if (type === 'userchat' && event === 'update') {
      var closedChat = entity;
      if (closedChat && closedChat.state === 'closed') {
        var chatId0 = closedChat.id;
        var surveyLang = chatLanguage[chatId0] || 'zh-TW';
        var surveyMsg;
        if (managerActive[chatId0]) {
          var csSurveys = {
            'zh-TW': '💬 感謝您的諮詢！請為這次的客服體驗評分：\n\n⭐⭐⭐⭐⭐ 非常滿意 → 輸入 5\n⭐⭐⭐⭐ 滿意 → 輸入 4\n⭐⭐⭐ 普通 → 輸入 3\n⭐⭐ 不太滿意 → 輸入 2\n⭐ 不滿意 → 輸入 1\n\n您的回饋是我們進步的動力！',
            'ko': '💬 상담이 종료되었습니다. 평가해주세요：\n\n⭐⭐⭐⭐⭐ 매우 만족 → 5\n⭐⭐⭐⭐ 만족 → 4\n⭐⭐⭐ 보통 → 3\n⭐⭐ 불만족 → 2\n⭐ 매우 불만족 → 1',
            'en': '💬 Please rate your experience:\n\n⭐⭐⭐⭐⭐ Excellent → 5\n⭐⭐⭐⭐ Good → 4\n⭐⭐⭐ Average → 3\n⭐⭐ Poor → 2\n⭐ Very Poor → 1',
            'ja': '💬 今回の対応を評価してください：\n\n⭐⭐⭐⭐⭐ 大満足 → 5\n⭐⭐⭐⭐ 満足 → 4\n⭐⭐⭐ 普通 → 3\n⭐⭐ 不満 → 2\n⭐ 大不満 → 1'
          };
          surveyMsg = csSurveys[surveyLang] || csSurveys['zh-TW'];
        } else {
          var botSurveys = {
            'zh-TW': '💬 這次的自動回覆有幫助到您嗎？\n\n👍 有幫助 → 輸入「感謝」\n👎 沒幫助 → 輸入「不好」',
            'ko': '💬 자동 응답이 도움이 되셨나요?\n\n👍 도움이 됨 → 「감사」\n👎 도움 안 됨 → 「별로」',
            'en': '💬 Was the auto-reply helpful?\n\n👍 Helpful → "thanks"\n👎 Not helpful → "bad"',
            'ja': '💬 自動返信はお役に立ちましたか？\n\n👍 役立った → 「感謝」\n👎 役立たなかった → 「不満」'
          };
          surveyMsg = botSurveys[surveyLang] || botSurveys['zh-TW'];
        }
        satisfactionPending[chatId0] = Date.now();
        setTimeout(async function() {
          try {
            await channeltalk.sendMessage(chatId0, { blocks: [{ type: 'text', value: surveyMsg }] });
          } catch(e) {}
        }, 3000);
        delete managerActive[chatId0];
        delete chatContext[chatId0];
      }
      return res.status(200).send('OK');
    }

    if (type !== 'message') return res.status(200).send('OK');
    if (!['upsert', 'push'].includes(event)) return res.status(200).send('OK');

    var message = entity;
    if (!message) return res.status(200).send('OK');
    var msgId = message.id || '';
    if (processedMessages[msgId]) return res.status(200).send('OK');
    processedMessages[msgId] = Date.now();

    var personType = (message.personType || '').toLowerCase();
    var chatType = (message.chatType || '').toLowerCase();
    var chatId = message.chatId || message.userChatId || '';

    if (personType === 'manager') {
      if (chatId) {
        managerActive[chatId] = Date.now();
      }
      return res.status(200).send('OK');
    }
    if (personType === 'bot') return res.status(200).send('OK');
    if (chatType !== 'userchat') return res.status(200).send('OK');

    var userText = extractText(message);
    if (!userText || !chatId) return res.status(200).send('OK');
    if (isSystemEvent(userText)) return res.status(200).send('OK');

    if (managerActive[chatId]) {
      return res.status(200).send('OK');
    }

    var detectedLang = lang.detectLanguage(userText);
    chatLanguage[chatId] = detectedLang;

    // Satisfaction response
    if (satisfactionPending[chatId] && isSatisfactionResponse(userText)) {
      delete satisfactionPending[chatId];
      var thanks = {
        'zh-TW': '感謝您的回饋！我們會持續改進！😊',
        'ko': '소중한 피드백 감사합니다! 😊',
        'en': 'Thank you for your feedback! 😊',
        'ja': 'フィードバックありがとうございます！😊'
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: thanks[detectedLang] || thanks['zh-TW'] }] });
      return res.status(200).send('OK');
    }

    // Thank you response
    if (isThankYou(userText)) {
      var thankReply = {
        'zh-TW': '不客氣！還有其他問題歡迎隨時詢問 😊\n\n' + getMenuText('zh-TW'),
        'ko': '천만에요! 다른 질문 있으시면 언제든 물어보세요 😊\n\n' + getMenuText('ko'),
        'en': "You're welcome! Feel free to ask anything else 😊\n\n" + getMenuText('en'),
        'ja': 'どういたしまして！他にご質問があればお気軽にどうぞ 😊\n\n' + getMenuText('ja')
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: thankReply[detectedLang] || thankReply['zh-TW'] }] });
      return res.status(200).send('OK');
    }

    // Greeting
    if (isGreeting(userText)) {
      var greetReply = {
        'zh-TW': '您好！歡迎來到 VEASLY 🇰🇷\n請問有什麼可以幫您的呢？\n\n' + getMenuText('zh-TW'),
        'ko': '안녕하세요! VEASLY에 오신 걸 환영합니다 🇰🇷\n무엇을 도와드릴까요?\n\n' + getMenuText('ko'),
        'en': 'Hello! Welcome to VEASLY 🇰🇷\nHow can I help you?\n\n' + getMenuText('en'),
        'ja': 'こんにちは！VEASLYへようこそ 🇰🇷\nどうぞお気軽にご質問ください。\n\n' + getMenuText('ja')
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: greetReply[detectedLang] || greetReply['zh-TW'] }] });
      return res.status(200).send('OK');
    }

    // Order number detection (multiple orders supported)
    if (looksLikeOrderNumber(userText)) {
      var orderNums = extractOrderNumbers(userText);
      var orderList = orderNums.join(', ');
      var orderMsg = {
        'zh-TW': '📋 已收到您的訂單編號：' + orderList + '\n\n我們的客服人員確認後會盡快回覆您！\n💡 客服時間：平日 10:00~19:00（韓國時間）\n⏰ 非上班時間的訊息會在上班後優先處理',
        'ko': '📋 주문번호 확인: ' + orderList + '\n\n담당자 확인 후 빠르게 답변드리겠습니다!\n💡 상담시간: 평일 10:00~19:00 (한국시간)',
        'en': '📋 Order received: ' + orderList + '\n\nOur team will check and respond ASAP!\n💡 Hours: Weekdays 10:00~19:00 (KST)',
        'ja': '📋 注文番号確認：' + orderList + '\n\n確認後すぐにご返信いたします！\n💡 対応時間：平日 10:00~19:00（韓国時間）'
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: orderMsg[detectedLang] || orderMsg['zh-TW'] }] });
      try {
        var mgrs = await channeltalk.listManagers();
        var managers = (mgrs && mgrs.managers) || [];
        for (var i = 0; i < managers.length; i++) {
          if (managers[i].operator) {
            await channeltalk.inviteManager(chatId, managers[i].id);
            managerActive[chatId] = Date.now();
            break;
          }
        }
      } catch(e) {}
      return res.status(200).send('OK');
    }

    // Number menu (0 removed from here - escalation handled separately)
    var trimmed = userText.trim();
    if (NUMBER_TO_QUERY[trimmed]) {
      userText = NUMBER_TO_QUERY[trimmed];
    }

    // Escalation request - multi-step process
    if (isEscalationRequest(userText) || trimmed === '0') {
      var step = getEscalationStep(chatId);

      if (step === 0) {
        // Step 1: Ask what they need help with
        var step1Msgs = {
          'zh-TW': '💡 在轉接客服前，也許我可以幫到您！\n\n請簡單描述您的問題，例如：\n・「我要查訂單進度」\n・「運費怎麼計算」\n・「怎麼申請退款」\n・「免運活動的規則」\n\n或者直接輸入數字查詢：\n' + getMenuText('zh-TW') + '\n\n🔸 仍需真人客服？請再輸入一次「客服」',
          'ko': '💡 상담사 연결 전에 제가 도움드릴 수 있을지 확인해볼게요!\n\n질문을 간단히 설명해주세요:\n・「주문 진행 상태 확인」\n・「운임 계산 방법」\n・「환불 신청 방법」\n\n또는 번호를 입력하세요:\n' + getMenuText('ko') + '\n\n🔸 그래도 상담사가 필요하시면 「상담사」를 한 번 더 입력해주세요',
          'en': '💡 Before connecting to an agent, maybe I can help!\n\nDescribe your issue briefly, or enter a number:\n' + getMenuText('en') + '\n\n🔸 Still need a human? Type "agent" again',
          'ja': '💡 オペレーターに接続する前に、お手伝いできるかもしれません！\n\n質問を簡単に説明するか、番号を入力してください：\n' + getMenuText('ja') + '\n\n🔸 それでも必要な場合は「オペレーター」をもう一度入力'
        };
        setEscalationStep(chatId, 1);
        await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: step1Msgs[detectedLang] || step1Msgs['zh-TW'] }] });
        return res.status(200).send('OK');
      } else {
        // Step 2: Actually connect
        setEscalationStep(chatId, 0);
        var bizOpen = isBusinessHours();
        var escMsgs;
        if (bizOpen) {
          escMsgs = {
            'zh-TW': '👨‍💼 正在為您轉接真人客服，請稍候！\n\n💡 目前客服人員正依序處理中，請稍候，我們會盡快回覆您！',
            'ko': '👨‍💼 상담사를 연결해 드리겠습니다. 잠시만 기다려주세요!\n\n💡 순차적으로 상담을 진행하고 있습니다. 잠시만 기다려주세요!',
            'en': '👨‍💼 Connecting you to a live agent, please wait!\n\n💡 Our agents are assisting customers in order. Please wait, we will get to you soon!',
            'ja': '👨‍💼 オペレーターにお繋ぎします。少々お待ちください！'
          };
        } else {
          escMsgs = {
            'zh-TW': '👨‍💼 目前非客服時間（平日 10:00~19:00 韓國時間）\n\n📝 請留下您的問題，我們會在上班後優先回覆！\n・訂單問題請附上訂單號碼\n・其他問題請簡單描述\n\n我們一定會回覆您！😊',
            'ko': '👨‍💼 현재 상담 시간이 아닙니다 (평일 10:00~19:00 한국시간)\n\n📝 메시지를 남겨주시면 업무 시작 후 우선 답변드리겠습니다!',
            'en': '👨‍💼 Outside business hours (Weekdays 10:00~19:00 KST)\n\n📝 Leave your message and we\'ll reply first thing!',
            'ja': '👨‍💼 現在営業時間外です（平日 10:00~19:00 韓国時間）\n\n📝 メッセージを残してください。営業開始後すぐにご返信します！'
          };
        }
        await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: escMsgs[detectedLang] || escMsgs['zh-TW'] }] });
        try {
          var mgrs2 = await channeltalk.listManagers();
          var managers2 = (mgrs2 && mgrs2.managers) || [];
          for (var j = 0; j < managers2.length; j++) {
            if (managers2[j].operator) {
              await channeltalk.inviteManager(chatId, managers2[j].id);
              managerActive[chatId] = Date.now();
              break;
            }
          }
        } catch(e) {}
        return res.status(200).send('OK');
      }
    }

    // Reset escalation step if user asks something else
    setEscalationStep(chatId, 0);

    // FAQ matching
    var matched = matcher.findBestMatch(userText);
    if (matched) {
      var answerText = matched.answer;
      // Add "still need help?" footer
      var footers = {
        'zh-TW': '\n\n💡 還有其他問題嗎？輸入數字繼續查詢，或輸入「客服」轉接真人',
        'ko': '\n\n💡 다른 질문이 있으신가요? 번호를 입력하거나 「상담사」를 입력해주세요',
        'en': '\n\n💡 Need more help? Enter a number or type "agent"',
        'ja': '\n\n💡 他にご質問は？番号を入力するか「オペレーター」と入力'
      };
      answerText += footers[detectedLang] || footers['zh-TW'];
      await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: answerText }] });

      if (matched.escalate) {
        try {
          var mgrs3 = await channeltalk.listManagers();
          var managers3 = (mgrs3 && mgrs3.managers) || [];
          for (var k = 0; k < managers3.length; k++) {
            if (managers3[k].operator) {
              await channeltalk.inviteManager(chatId, managers3[k].id);
              managerActive[chatId] = Date.now();
              break;
            }
          }
        } catch(e) {}
      }
      return res.status(200).send('OK');
    }

    // Fallback
    var fallbackMsgs = {
      'zh-TW': '抱歉，我還在學習中 📚\n\n您可以試試以下方式：\n1️⃣ 用不同的關鍵字描述問題\n2️⃣ 輸入數字選擇分類查詢\n3️⃣ 輸入「客服」轉接真人\n\n',
      'ko': '죄송합니다, 아직 학습 중입니다 📚\n\n다음 방법을 시도해보세요:\n1️⃣ 다른 키워드로 질문\n2️⃣ 번호를 입력해서 조회\n3️⃣ 「상담사」를 입력해서 연결\n\n',
      'en': "Sorry, I'm still learning 📚\n\nTry:\n1️⃣ Rephrase your question\n2️⃣ Enter a number\n3️⃣ Type \"agent\" for live help\n\n",
      'ja': '申し訳ございません、まだ学習中です 📚\n\n以下をお試しください：\n1️⃣ 別のキーワードで質問\n2️⃣ 番号を入力\n3️⃣ 「オペレーター」と入力\n\n'
    };
    var fbMenu = getMenuText(detectedLang);
    await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: (fallbackMsgs[detectedLang] || fallbackMsgs['zh-TW']) + fbMenu }] });

    res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook Error]', error.message);
    res.status(200).send('OK');
  }
});

module.exports = router;
