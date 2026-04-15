var express = require('express');
var router = express.Router();
var channeltalk = require('../lib/channeltalk');
var matcher = require('../lib/matcher');
var aiEngine = require('../lib/ai-engine');
var veaslyApi = require("../lib/veasly-api");
var lang = require('../lib/language');
var scheduler = require('../lib/scheduler');
var mgrStats = require('../lib/manager-stats');
var aiLog = require('../lib/ai-log');
var errorAlert = require('../lib/error-alert');
var analytics = require('../lib/analytics');

var processedMessages = {};
// Dedup cleanup handled below (120s TTL)
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
    'zh-TW': '請輸入數字查詢：\n1️⃣ 第一次使用（新會員指南）\n2️⃣ 已下單（訂單相關）\n3️⃣ 配送/物流\n4️⃣ 費用/運費\n5️⃣ 付款方式\n6️⃣ 取消/退款\n7️⃣ 訂單查詢\n8️⃣ 怎麼下單\n9️⃣ 點數/折扣碼\n\n💡 也可以直接用文字描述問題，AI會為您解答喔！',
    'ko': '번호를 입력해주세요：\n1️⃣ 처음 이용\n2️⃣ 주문 완료\n3️⃣ 배송/물류\n4️⃣ 비용/운임\n5️⃣ 결제 방법\n6️⃣ 취소/환불\n7️⃣ 주문 조회\n8️⃣ 주문 방법\n9️⃣ 포인트/할인\n\n💡 번호 외에 직접 질문을 입력하셔도 AI가 답변해드려요!',
    'en': 'Enter a number:\n1️⃣ First time\n2️⃣ Already ordered\n3️⃣ Shipping\n4️⃣ Fees\n5️⃣ Payment\n6️⃣ Cancel/Refund\n7️⃣ Order tracking\n8️⃣ How to order\n9️⃣ Points/Coupons\n\n💡 You can also type your question directly!',
    'ja': '番号を入力してください：\n1️⃣ 初めての方\n2️⃣ 注文済み\n3️⃣ 配送\n4️⃣ 費用\n5️⃣ お支払い\n6️⃣ キャンセル/返金\n7️⃣ 注文確認\n8️⃣ 注文方法\n9️⃣ ポイント/割引\n\n💡 そのままご質問を入力いただければAIがお答えします！'
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
  text = text.replace(/[\\\s]+$/g, '').trim(); // clean trailing backslash/spaces
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

    if (personType === "manager") {
      if (chatId) {
        managerActive[chatId] = Date.now();
        var mgrPersonId = message.personId || "unknown";
        var mgrText = extractText(message);
        // Record manager performance stats
        if (mgrText) {
          mgrStats.recordReply(mgrPersonId, chatId, mgrText.length);
        }
        if (mgrText && mgrText.length > 10 && aiEngine.isReady()) {
          aiEngine.addToKnowledgeBase(
            "mgr_" + chatId + "_" + Date.now(),
            mgrText,
            { namespace: "manager", source: "manager_reply", chatId: chatId, timestamp: new Date().toISOString() }
          ).catch(function(e){ console.error("[Learn] manager save error:", e.message); });
          console.log("[Learn] Manager reply saved:", mgrText.substring(0, 50));
        }
      }
      return res.status(200).send("OK");
    }
    if (personType === 'bot') return res.status(200).send('OK');
    if (chatType !== 'userchat') return res.status(200).send('OK');

    var userText = extractText(message);
    if (!userText || !chatId) return res.status(200).send('OK');
    mgrStats.recordUserMessage(chatId);
    if (isSystemEvent(userText)) return res.status(200).send('OK');

    if (managerActive[chatId]) {
      return res.status(200).send('OK');
    }

    // VEASLY member lookup
    var veaslyUser = null;
    var personId = message.personId || "";
    if (personId) {
      try {
        var chUser = await channeltalk.getUser(personId);
        var userProfile = (chUser && chUser.user) || chUser || {};
        var memberEmail = userProfile.email || (userProfile.profile && userProfile.profile.email) || "";
        var userLang = userProfile.language || (userProfile.profile && userProfile.profile.language) || "";
        var memberId = userProfile.memberId || "";
        if (memberId) {
          veaslyUser = await veaslyApi.findUserById(memberId, memberEmail);
        } else if (memberEmail) {
          veaslyUser = await veaslyApi.findUserByEmail(memberEmail);
        }
        if (veaslyUser) {
          console.log("[Member] Matched:", veaslyUser.name, "| ID:", veaslyUser.id, "| Orders:", veaslyUser.requestCount, "| Credit:", veaslyUser.credit);
          // Sync VEASLY info + auto-tags to ChannelTalk profile
          try {
            var orderCount = veaslyUser.requestCount || 0;
            var credit = veaslyUser.credit || 0;

            // Calculate customer tier tag
            var tierTag = "새회원";
            if (orderCount >= 20) tierTag = "VIP";
            else if (orderCount >= 10) tierTag = "우수회원";
            else if (orderCount >= 5) tierTag = "단골회원";
            else if (orderCount >= 2) tierTag = "재구매";
            else if (orderCount >= 1) tierTag = "첫구매완료";

            // Calculate shipping status from recent orders
            var shippingTag = "";
            try {
              var recentOrders = await veaslyApi.getUserOrders(veaslyUser.email, 5, memberId);
              if (recentOrders && recentOrders.length > 0) {
                var activeItems = [];
                for (var oi = 0; oi < recentOrders.length; oi++) {
                  var orderItems = recentOrders[oi].items || [];
                  for (var oj = 0; oj < orderItems.length; oj++) {
                    if (orderItems[oj].status && orderItems[oj].status !== "COMPLETED" && orderItems[oj].status !== "CANCEL_COMPLETED") {
                      activeItems.push(orderItems[oj].status);
                    }
                  }
                }
                if (activeItems.indexOf("SHIPPING_TO_HOME") > -1) shippingTag = "국제배송중";
                else if (activeItems.indexOf("SHIPPING_TO_BDJ") > -1) shippingTag = "물류센터이동";
                else if (activeItems.indexOf("ORDER_PROCESSING") > -1) shippingTag = "주문처리중";
                else if (activeItems.indexOf("PAYMENT_COMPLETED") > -1) shippingTag = "결제완료";
              }
            } catch(tagErr) {}

            // Point status tag
            var pointTag = "";
            if (credit >= 10000) pointTag = "포인트VIP";
            else if (credit >= 5000) pointTag = "포인트많음";
            else if (credit >= 1000) pointTag = "포인트보유";

            var profileData = {
              "veasly_id": String(veaslyUser.id),
              "veasly_orders": orderCount,
              "veasly_points": credit,
              "veasly_provider": veaslyUser.provider || "",
              "veasly_role": veaslyUser.role || "",
              "veasly_joined": (veaslyUser.createdAt || "").substring(0, 10),
              "veasly_tier": tierTag,
              "veasly_shipping": shippingTag,
              "veasly_point_tier": pointTag
            };

            await channeltalk.updateUser(personId, profileData);
            console.log("[Sync] Profile updated for", personId, "| Tier:", tierTag, shippingTag ? "| Ship:" + shippingTag : "");
          } catch(syncErr) { console.error("[Sync] Error:", syncErr.message); }
        }
      } catch(mErr) { console.error("[Member] Lookup error:", mErr.message); }
    }
    var detectedLang = lang.detectLanguage(userText);
    // Override with ChannelTalk user language if text is ambiguous (numbers, order numbers, etc.)
    if (userLang && /^[a-zA-Z0-9\s\-\.\,\/\@\#]+$/.test(userText)) {
      var langMap = {"ko": "ko", "ja": "ja", "en": "en", "zh": "zh-TW", "zh-TW": "zh-TW", "zh-CN": "zh-TW"};
      if (langMap[userLang]) detectedLang = langMap[userLang];
    }
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
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "thank_you", userMessage: userText, aiResponse: "감사 응답", escalated: false });
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
      var greetText = greetReply[detectedLang] || greetReply['zh-TW'];
      // Add point reminder to greeting
      if (veaslyUser && veaslyUser.credit >= 500) {
        var pointHints = {
          "zh-TW": "\n\n🎁 您目前有 " + veaslyUser.credit + " 點數可以使用喔！下單時可折抵消費～",
          "ko": "\n\n🎁 현재 " + veaslyUser.credit + " 포인트 보유 중! 주문 시 할인에 사용하세요~",
          "en": "\n\n🎁 You have " + veaslyUser.credit + " points! Use them on your next order~",
          "ja": "\n\n🎁 現在 " + veaslyUser.credit + " ポイントをお持ちです！ご注文時にご利用ください～"
        };
        greetText += pointHints[detectedLang] || pointHints["zh-TW"];
      }
      await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: greetText }] });
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "greeting", userMessage: userText, aiResponse: "인사 응답 + 메뉴 제공" + (veaslyUser && veaslyUser.credit >= 500 ? " (포인트:" + veaslyUser.credit + ")" : ""), escalated: false });
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
        aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || '', userName: veaslyUser ? veaslyUser.name : '', lang: detectedLang, type: 'escalation', userMessage: userText, aiResponse: '에스컬레이션 - 매니저 연결', escalated: true });
        return res.status(200).send('OK');
      }
    }


    // CSAT response handler
    if (scheduler.isCSATPending(chatId)) {
      var csatScore = scheduler.parseCSATResponse(userText);
      if (csatScore !== null) {
        // Record CSAT score
        scheduler.saveCSATResult ? scheduler.saveCSATResult({
          chatId: chatId,
          score: csatScore,
          timestamp: Date.now(),
          userId: memberId || ""
        }) : null;

        var csatThanks = {
          "zh-TW": "感謝您的回饋！您的評分：" + csatScore + "/5 ⭐\n我們會持續改善服務品質！",
          "ko": "피드백 감사합니다! 평점: " + csatScore + "/5 ⭐\n더 나은 서비스를 위해 노력하겠습니다!",
          "en": "Thank you for your feedback! Rating: " + csatScore + "/5 ⭐\nWe'll keep improving!",
          "ja": "フィードバックありがとうございます！評価：" + csatScore + "/5 ⭐\nサービス改善に努めます！"
        };

        var thankMsg = csatThanks[detectedLang] || csatThanks["zh-TW"];
        await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: thankMsg }] });
        console.log("[CSAT] Score recorded:", csatScore, "for chat:", chatId);
        mgrStats.linkCSATToManager(chatId, csatScore);

        // Clear CSAT pending
        // Clear CSAT pending from file
        try { var csatFile = require("path").join(__dirname, "..", "data", "csat-sent.json"); var csatData = JSON.parse(require("fs").readFileSync(csatFile, "utf8")); delete csatData[chatId]; require("fs").writeFileSync(csatFile, JSON.stringify(csatData), "utf8"); } catch(ce) {}
        return res.status(200).send("OK");
      }
    }

    // Reset escalation step only if NOT an escalation keyword
    if (!isEscalationRequest(userText)) { setEscalationStep(chatId, 0); }

    // Point promotion - notify users with available points
    if (veaslyUser && veaslyUser.credit >= 500) {
      var chatPointKey = "pointNotified_" + chatId;
      if (!global._pointNotified) global._pointNotified = {};
      if (!global._pointNotified[chatPointKey]) {
        global._pointNotified[chatPointKey] = true;
        var pts = veaslyUser.credit;
        var pointMsgs = {
          "zh-TW": "🎁 " + veaslyUser.name + " 您好！您目前有 " + pts + " 點數可以使用喔！下單時可折抵消費，別忘了使用～",
          "ko": "🎁 " + veaslyUser.name + "님! 현재 " + pts + " 포인트 보유 중이에요! 주문 시 할인에 사용할 수 있어요~",
          "en": "🎁 Hi " + veaslyUser.name + "! You have " + pts + " points available! Use them for discounts on your next order~",
          "ja": "🎁 " + veaslyUser.name + "さん！現在 " + pts + " ポイントをお持ちです！注文時にご利用いただけます～"
        };
        // Send as a separate message after a short delay
        setTimeout(async function() {
          try {
            await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: pointMsgs[detectedLang] || pointMsgs["zh-TW"] }] });
            console.log("[Promo] Point reminder sent:", pts, "points for", veaslyUser.name);
          } catch(e) { console.error("[Promo] Error:", e.message); }
        }, 2000);
      }
    }

        // Skip greeting/sticker messages - no bot response needed
    var skipPatterns = ['스티커를 전송했습니다', '스티커를 보냈습니다'];
    // Handle image/file messages with a helpful response
    var filePatterns = ['사진을 전송했습니다', '파일을 전송했습니다', '이미지를 전송했습니다', '동영상을 전송했습니다'];
    var isFileMsg = filePatterns.some(function(p) { return userText.indexOf(p) > -1; });
    if (isFileMsg) {
      var fileMsgs = {
        "zh-TW": "📷 收到您傳送的檔案了！\n\n不好意思，AI助手目前還無法讀取圖片或檔案。請用文字描述您的問題，我會盡力幫您處理喔！\n\n例如：\n・「我的包裹外觀有損壞」\n・「商品跟網站圖片不一樣」\n・「付款畫面出現錯誤」",
        "ko": "📷 파일을 확인했습니다!\n\nAI 도우미가 아직 이미지/파일을 읽지 못합니다. 텍스트로 문제를 설명해 주시면 도와드릴게요!\n\n예시:\n・「택배 외관이 손상됐어요」\n・「상품이 사진과 달라요」\n・「결제 화면 오류가 났어요」",
        "en": "📷 Got your file!\n\nSorry, the AI assistant can't read images/files yet. Please describe your issue in text and I'll do my best to help!",
        "ja": "📷 ファイルを確認しました！\n\nAIアシスタントはまだ画像/ファイルを読み取れません。テキストで問題をご説明いただければ対応いたします！"
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: fileMsgs[detectedLang] || fileMsgs["zh-TW"] }] });
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", lang: detectedLang, type: "file_message", userMessage: userText, aiResponse: "파일/이미지 수신 안내", escalated: false });
      return res.status(200).send("OK");
    }
    var isSticker = skipPatterns.some(function(p) { return userText.indexOf(p) > -1; });
    var greetWords = ['謝謝', '感謝', '好的', '收到', '了解', '沒關係', '不用了', '掰掰', '再見', 'ok收到', '감사합니다', '알겠습니다', '고마워'];
    var isThankMsg = greetWords.some(function(g) { return userText.indexOf(g) > -1; }) && userText.length < 15;
    if (isSticker) {
      return res.status(200).send('OK');
    }
    if (isThankMsg) {
      var greetReplies = {
        "zh-TW": "不客氣！有需要隨時找我喔～ 😊",
        "ko": "천만에요! 필요하시면 언제든 말씀해주세요~ 😊",
        "en": "You're welcome! Let me know if you need anything~ 😊",
        "ja": "どういたしまして！何かあればいつでもどうぞ～ 😊"
      };
      await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: greetReplies[detectedLang] || greetReplies["zh-TW"] }] });
      return res.status(200).send('OK');
    }

        // Order number detection - real-time API lookup
    var orderMatches = userText.match(/\d{8}TW\d{9}/g) || [];
    if (orderMatches.length > 1) {
      // Multi-order lookup
      console.log("[Order] Detected", orderMatches.length, "order numbers");
      try {
        var multiReply = "";
        var successCount = 0;
        for (var oi = 0; oi < Math.min(orderMatches.length, 5); oi++) {
          var oNum = orderMatches[oi];
          try {
            var oItems = await veaslyApi.getOrderDetail(oNum);
            if (oItems && oItems.length > 0) {
              var oInfo = veaslyApi.formatOrderInfo(oItems, detectedLang);
              var mainSt = (oItems[0] && oItems[0].status) || "";
              multiReply += "📦 " + oNum + "\n" + oInfo + "\n\n";
              successCount++;
            } else {
              multiReply += "❌ " + oNum + " - " + (detectedLang === "ko" ? "주문 정보 없음" : detectedLang === "en" ? "Not found" : detectedLang === "ja" ? "注文情報なし" : "找不到此訂單") + "\n\n";
            }
          } catch(oErr) {
            multiReply += "❌ " + oNum + " - " + (detectedLang === "ko" ? "조회 실패" : "查詢失敗") + "\n\n";
          }
        }
        var multiHeaders = {
          "zh-TW": "為您查詢了 " + orderMatches.length + " 筆訂單：\n\n",
          "ko": orderMatches.length + "건의 주문을 조회했습니다:\n\n",
          "en": "Found " + orderMatches.length + " orders:\n\n",
          "ja": orderMatches.length + "件の注文を確認しました：\n\n"
        };
        multiReply = (multiHeaders[detectedLang] || multiHeaders["zh-TW"]) + multiReply;
        multiReply += "💡 " + (detectedLang === "ko" ? "더 궁금한 점이 있으면 입력해주세요!" : detectedLang === "en" ? "Any questions?" : detectedLang === "ja" ? "ご質問があればどうぞ！" : "還有問題嗎？直接輸入問題，或輸入「客服」轉接真人客服喔！");
        await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: multiReply }] });
        aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "order_lookup", userMessage: userText.substring(0, 200), aiResponse: "복수 주문조회: " + orderMatches.length + "건 (" + successCount + "건 성공)", escalated: false });
        return res.status(200).send("OK");
      } catch(multiErr) { console.error("[Order] Multi-order error:", multiErr.message); return res.status(200).send("OK"); }
    }
    if (orderMatches.length === 1) {
      var orderNum = orderMatches[0];
      console.log("[Order] Detected order number:", orderNum);
      try {
        var orderItems = await veaslyApi.getOrderDetail(orderNum);
        if (orderItems && orderItems.length > 0) {
          var orderInfo = veaslyApi.formatOrderInfo(orderItems, detectedLang);
          var orderHeaders = {
            "zh-TW": "訂單 " + orderNum + " 的狀態：",
            "ko": "주문 " + orderNum + " 상태:",
            "en": "Order " + orderNum + " status:",
            "ja": "注文 " + orderNum + " の状況："
          };
          var header = orderHeaders[detectedLang] || orderHeaders["zh-TW"];
          var orderReply = header + "\n" + orderInfo;
          // Add status-specific tips
          var mainStatus = (orderItems[0] && orderItems[0].status) || "";
          var tipMap = {
            "PAYMENT_WAITING": { "zh-TW": "請盡快完成付款，以免訂單被取消喔！", "ko": "빠른 결제 부탁드립니다!", "en": "Please complete payment soon!", "ja": "お早めにお支払いをお願いします！" },
            "PAYMENT_COMPLETED": { "zh-TW": "已收到付款，我們會盡快處理您的訂單！", "ko": "결제 확인! 빠르게 처리하겠습니다!", "en": "Payment received! We will process your order soon!", "ja": "お支払い確認済み！早速処理いたします！" },
            "ORDER_PROCESSING": { "zh-TW": "商品正在韓國國內配送中，寄往VEASLY倉庫，通常需要1-3個工作天喔！", "ko": "한국 내 배송 중입니다. VEASLY 창고로 이동 중이며 보통 1-3 영업일 소요됩니다!", "en": "Shipping within Korea to VEASLY warehouse, usually takes 1-3 business days!", "ja": "韓国国内配送中です。VEASLY倉庫へ通常1-3営業日かかります！" },
            "SHIPPING_TO_BDJ": { "zh-TW": "商品已到達VEASLY倉庫！正在準備國際包裹，即將為您寄出！", "ko": "VEASLY 창고에 도착했습니다! 국제 배송 준비 중입니다!", "en": "Arrived at VEASLY warehouse! Preparing international shipment!", "ja": "VEASLY倉庫に到着しました！国際発送の準備中です！" },
            "SHIPPING_TO_HOME": { "zh-TW": "包裹已從韓國寄出！國際配送通常需要5-10個工作天，收到 EZ WAY 通知時，請記得按「申報相符」才能順利通關喔！", "ko": "한국에서 출발! 국제 배송은 보통 5-10 영업일 소요됩니다!", "en": "Shipped from Korea! International delivery takes 5-10 business days!", "ja": "韓国から発送済み！国際配送は通常5-10営業日かかります！" },
            "COMPLETED": { "zh-TW": "訂單已完成！感謝您的購買～", "ko": "주문 완료! 감사합니다~", "en": "Order completed! Thank you!", "ja": "注文完了！ありがとうございます！" },
            "CANCEL_COMPLETED": { "zh-TW": "此訂單已取消，退款會在3-5個工作天內處理喔！", "ko": "주문이 취소되었습니다. 환불은 3-5 영업일 내 처리됩니다!", "en": "Order cancelled. Refund will be processed in 3-5 business days!", "ja": "注文キャンセル済み。返金は3-5営業日以内に処理されます！" }
          };
          var tip = (tipMap[mainStatus] && tipMap[mainStatus][detectedLang]) || (tipMap[mainStatus] && tipMap[mainStatus]["zh-TW"]) || "";
          if (tip) orderReply += "\n\n📋 " + tip;
          orderReply += "\n\n💡 " + (detectedLang === "ko" ? "더 궁금한 점이 있으면 입력해주세요! 「상담사」 입력 시 담당자를 연결해드려요." : detectedLang === "en" ? "Any questions? Type or enter 'agent' for live support!" : detectedLang === "ja" ? "ご質問があればどうぞ！「agent」と入力で担当者に接続します！" : "還有問題嗎？直接輸入問題，或輸入「客服」轉接真人客服喔！");
          await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: orderReply }] });
          console.log("[Order] Replied with", orderItems.length, "items for", orderNum);
          aiLog.saveConversation({
            timestamp: new Date().toISOString(),
            chatId: chatId,
            userId: memberId || "",
            userName: veaslyUser ? veaslyUser.name : "",
            lang: detectedLang,
            type: "order_lookup",
            userMessage: userText.substring(0, 200),
            aiResponse: "주문조회: " + orderNum + " (" + orderItems.length + "개 아이템)",
            escalated: false,
            category: "order"
          });
          return res.status(200).send("OK");
        } else {
          var notFoundMsgs = {
            "zh-TW": "找不到訂單 " + orderNum + " 的資料，請確認訂單編號是否正確喔！",
            "ko": "주문 " + orderNum + " 정보를 찾을 수 없습니다. 주문번호를 확인해주세요!",
            "en": "Order " + orderNum + " not found. Please check the order number!",
            "ja": "注文 " + orderNum + " が見つかりません。注文番号をご確認ください！"
          };
          await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: notFoundMsgs[detectedLang] || notFoundMsgs["zh-TW"] }] });
          return res.status(200).send("OK");
        }
      } catch(orderErr) { console.error("[Order] Lookup error:", orderErr.message); }
    }

    // Order status keyword - show user's recent orders
    var orderKeywords = ["訂單", "주문", "order", "注文", "배송", "配送", "出貨"];
    var isOrderQuery = orderKeywords.some(function(kw) { return userText.toLowerCase().indexOf(kw) !== -1; });
    if (isOrderQuery && veaslyUser && veaslyUser.email) {
      try {
        var userOrders = await veaslyApi.getUserOrders(veaslyUser.email, 500, memberId);
        if (userOrders.length > 0) {
          var recentOrders = userOrders.slice(0, 5);
          var listHeaders = {
            "zh-TW": "您最近的訂單：",
            "ko": "최근 주문 내역:",
            "en": "Your recent orders:",
            "ja": "最近のご注文："
          };
          var listHeader = listHeaders[detectedLang] || listHeaders["zh-TW"];
          var orderLines = recentOrders.map(function(o, i) {
            var providerTag = o._provider ? " [" + o._provider + "]" : ""; var currentTag = o._isCurrentAccount === false ? " ⚠" : ""; return (i + 1) + ". " + o.orderNumber + " (" + veaslyApi.getStatusText(o.status, detectedLang) + ")" + providerTag + currentTag;
          });
          var listReply = listHeader + "\n" + orderLines.join("\n");
          var hasMultiAccount = recentOrders.some(function(o) { return o._isCurrentAccount === false; }); if (hasMultiAccount) { listReply += "\n\n" + (detectedLang === "ko" ? "⚠ = 다른 로그인 방식으로 주문한 건입니다" : detectedLang === "en" ? "⚠ = ordered from a different login method" : detectedLang === "ja" ? "⚠ = 別のログイン方法での注文です" : "⚠ = 透過其他登入方式下的訂單"); } listReply += "\n\n" + (detectedLang === "ko" ? "주문번호를 입력하시면 상세 상태를 확인할 수 있어요!" : detectedLang === "en" ? "Enter an order number for details!" : detectedLang === "ja" ? "注文番号を入力すると詳細が確認できます！" : "輸入完整訂單編號可查看詳細狀態喔！");
          await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: listReply }] });
          console.log("[Order] Listed", recentOrders.length, "orders for", veaslyUser.email);
          
      aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "order_list", userMessage: userText, aiResponse: "주문 목록 " + recentOrders.length + "건 조회", escalated: false });
      return res.status(200).send("OK");
        }
      } catch(olErr) { console.error("[Order] List error:", olErr.message); }
    }

    // AI-first, then FAQ fallback
    var aiAnswer = null;
    if (aiEngine.isReady()) {
      try {
      var memberContext = veaslyUser ? "[회원: " + veaslyUser.name + ", 주문 " + (veaslyUser.requestCount || 0) + "건, 포인트 " + (veaslyUser.credit || 0) + "]" : "";
        // Fetch recent chat history for context
        var chatHistory = [];
        try {
          var recentMsgs = await channeltalk.getChatMessages(chatId, 10);
          var msgs = (recentMsgs.messages || []).reverse();
          for (var hi = 0; hi < msgs.length; hi++) {
            var hMsg = msgs[hi];
            if (!hMsg.plainText || hMsg.plainText.trim().length === 0) continue;
            var hRole = (hMsg.personType || "").toLowerCase() === "user" ? "user" : "bot";
            var hText = hMsg.plainText.trim();
            if (hText.length > 200) hText = hText.substring(0, 200) + "...";
            chatHistory.push({ role: hRole, text: hText });
          }
          // Remove the current message (last user message) to avoid duplication
          if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === "user") {
            chatHistory.pop();
          }
          // Keep last 5 exchanges
          if (chatHistory.length > 10) chatHistory = chatHistory.slice(-10);
        } catch(histErr) { console.error("[Context] History fetch error:", histErr.message); }
        var aiResult = await aiEngine.generateAnswer(memberContext ? memberContext + " " + userText : userText, detectedLang, chatId, chatHistory);
        if (aiResult && typeof aiResult === "object") {
          aiAnswer = aiResult.answer;
          var confidence = aiResult.confidence || 0;
          console.log("[AI] Confidence:", confidence.toFixed(3));
          if (confidence < 0.3) {
            console.log("[AI] Low confidence - skipping AI answer");
            aiAnswer = null;
          }
        } else {
          aiAnswer = aiResult;
        }
      } catch(aiErr) {
        console.error("[AI] Error:", aiErr.message);
      }
    }
    if (aiAnswer) {
      var footers = {
        "zh-TW": "\n\n💡 還有其他問題嗎？直接輸入問題，AI會為您解答喔！",
        "ko": "\n\n💡 다른 질문이 있으신가요? 직접 질문을 입력하시면 AI가 답변해드려요!",
        "en": "\n\n💡 Need more help? Just type your question!",
        "ja": "\n\n💡 他にご質問がございましたら、そのままご入力ください！"
      };
      aiAnswer += footers[detectedLang] || footers["zh-TW"];
      await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: aiAnswer }] });

      // Log AI conversation
      var aiEscalated = false;
      var escalateKeywords = ["轉接客服", "轉接", "客服確認", "客服人員", "為您確認", "幫您確認", "담당자를 연결", "담당자에게", "상담사", "connect you with", "support team", "担当者におつなぎ", "担当者に"];
      var needEscalate = false;
      for (var ek = 0; ek < escalateKeywords.length; ek++) {
        if (aiAnswer.indexOf(escalateKeywords[ek]) !== -1) { needEscalate = true; break; }
      }
      aiEscalated = needEscalate;
      aiLog.saveConversation({
        timestamp: new Date().toISOString(),
        chatId: chatId,
        userId: memberId || personId || "",
        userName: veaslyUser ? veaslyUser.name : "",
        lang: detectedLang,
        type: "ai_answer",
        userMessage: userText.substring(0, 200),
        aiResponse: aiAnswer.substring(0, 500),
        escalated: needEscalate,
        category: analytics.classifyMessage(userText)
      });

      if (needEscalate) {
        try {
          var mgrList = await channeltalk.listManagers();
          var mgrArr = (mgrList && mgrList.managers) || [];
          for (var mi = 0; mi < mgrArr.length; mi++) {
            if (mgrArr[mi].operator) {
              await channeltalk.inviteManager(chatId, mgrArr[mi].id);
              managerActive[chatId] = Date.now();
              console.log("[Escalate] AI auto-escalated chat:", chatId);
              break;
            }
          }
          var allMgrIds = mgrArr.map(function(m){ return m.id; });
          await channeltalk.addFollowers(chatId, allMgrIds).catch(function(fe){ console.error("[Follower] Error:", fe.message); });
          console.log("[Follower] All managers added as followers:", allMgrIds.length);
        } catch(escErr) { console.error("[Escalate] Error:", escErr.message); }
      }
      return res.status(200).send("OK");
    }
    var matched = matcher.findBestMatch(userText);
    if (matched) {
      var answerText = matched.answer;
      var footers2 = {
        "zh-TW": "\n\n💡 還有其他問題嗎？直接輸入問題，AI會為您解答喔！",
        "ko": "\n\n💡 다른 질문이 있으신가요? 직접 질문을 입력하시면 AI가 답변해드려요!",
        "en": "\n\n💡 Need more help? Just type your question!",
        "ja": "\n\n💡 他にご質問がございましたら、そのままご入力ください！"
      };
      answerText += footers2[detectedLang] || footers2["zh-TW"];
      await channeltalk.sendMessage(chatId, { blocks: [{ type: "text", value: answerText }] });
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
      
          aiLog.saveConversation({ timestamp: new Date().toISOString(), chatId: chatId, userId: memberId || personId || "", userName: veaslyUser ? veaslyUser.name : "", lang: detectedLang, type: "escalation", userMessage: userText, aiResponse: "매니저 에스컬레이션 (수동)", escalated: true });
          return res.status(200).send("OK");
    }
    // Fallback
    // Save unanswered question for learning
    if (userText && userText.length > 2 && aiEngine.isReady()) {
      aiEngine.addToKnowledgeBase(
        "unanswered_" + chatId + "_" + Date.now(),
        userText,
        { namespace: "unanswered", source: "user_fallback", chatId: chatId, language: detectedLang, timestamp: new Date().toISOString() }
      ).catch(function(e){ console.error("[Learn] unanswered save error:", e.message); });
      console.log("[Learn] Unanswered question saved:", userText.substring(0, 50));
    }
    var fallbackMsgs = {
      'zh-TW': '抱歉，我還在學習中 📚\n\n您可以試試以下方式：\n1️⃣ 用不同的關鍵字描述問題\n2️⃣ 輸入數字選擇分類查詢\n3️⃣ 輸入「客服」轉接真人\n\n',
      'ko': '죄송합니다, 아직 학습 중입니다 📚\n\n다음 방법을 시도해보세요:\n1️⃣ 다른 키워드로 질문\n2️⃣ 번호를 입력해서 조회\n3️⃣ 「상담사」를 입력해서 연결\n\n',
      'en': "Sorry, I'm still learning 📚\n\nTry:\n1️⃣ Rephrase your question\n2️⃣ Enter a number\n3️⃣ Type \"agent\" for live help\n\n",
      'ja': '申し訳ございません、まだ学習中です 📚\n\n以下をお試しください：\n1️⃣ 別のキーワードで質問\n2️⃣ 番号を入力\n3️⃣ 「オペレーター」と入力\n\n'
    };
    aiLog.saveConversation({
      timestamp: new Date().toISOString(),
      chatId: chatId,
      userId: memberId || '',
      lang: detectedLang,
      type: 'unanswered',
      userMessage: userText.substring(0, 200),
      aiResponse: 'AI 답변 실패 - fallback 메시지',
      escalated: false,
      category: analytics.classifyMessage(userText)
    });
    var fbMenu = getMenuText(detectedLang);
    await channeltalk.sendMessage(chatId, { blocks: [{ type: 'text', value: (fallbackMsgs[detectedLang] || fallbackMsgs['zh-TW']) + fbMenu }] });

    res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook Error]', error.message, error.stack);
    errorAlert.sendAlert('Webhook Error', error.message);
    res.status(200).send('OK');
  }
});

module.exports = router;
