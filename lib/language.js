function detectLanguage(text) {
  if (!text) return 'zh-TW';
  var ko = 0, zh = 0, en = 0, ja = 0;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code >= 0xAC00 && code <= 0xD7AF) ko++;
    else if (code >= 0x4E00 && code <= 0x9FFF) zh++;
    else if (code >= 0x3040 && code <= 0x30FF) ja++;
    else if (code >= 0x41 && code <= 0x7A) en++;
  }
  var max = Math.max(ko, zh, en, ja);
  if (max === 0) return 'zh-TW';
  if (max === ko) return 'ko';
  if (max === ja) return 'ja';
  if (max === en) return 'en';
  return 'zh-TW';
}

var MESSAGES = {
  'zh-TW': {
    welcome: '哈囉！歡迎來到 VEASLY！\n\n我是 Veasly小幫手，很高興為您服務！\n請選擇您想了解的問題：',
    fallback: '感謝您的訊息！目前無法找到相關資訊。\n請輸入「客服」轉接真人客服，我們會盡快回覆！',
    escalate: '好的！正在為您轉接真人客服，請稍候...',
    satisfaction: '感謝您的諮詢！請問這次的服務滿意嗎？\n\n⭐ 非常滿意\n⭐⭐ 滿意\n⭐⭐⭐ 普通\n⭐⭐⭐⭐ 不太滿意\n\n您的回饋是我們進步的動力！',
    menuTitle: '請選擇您想了解的問題：'
  },
  'ko': {
    welcome: '안녕하세요! VEASLY에 오신 것을 환영합니다!\n\n저는 Veasly 도우미입니다. 아래에서 궁금한 사항을 선택해주세요:',
    fallback: '죄송합니다. 관련 정보를 찾지 못했습니다.\n"고객센터"를 입력하시면 상담사와 연결해드리겠습니다.',
    escalate: '네! 상담사를 연결해 드리겠습니다. 잠시만 기다려주세요...',
    satisfaction: '상담이 도움이 되셨나요?\n\n⭐ 매우 만족\n⭐⭐ 만족\n⭐⭐⭐ 보통\n⭐⭐⭐⭐ 불만족\n\n피드백 감사합니다!',
    menuTitle: '궁금한 사항을 선택해주세요:'
  },
  'en': {
    welcome: 'Hello! Welcome to VEASLY!\n\nI\'m the Veasly Assistant. Please select your question:',
    fallback: 'Thanks for your message! I couldn\'t find related info.\nType "agent" to connect with a human agent.',
    escalate: 'Sure! Connecting you to a human agent, please wait...',
    satisfaction: 'Was this helpful?\n\n⭐ Very satisfied\n⭐⭐ Satisfied\n⭐⭐⭐ Average\n⭐⭐⭐⭐ Unsatisfied\n\nThank you for your feedback!',
    menuTitle: 'Please select your question:'
  },
  'ja': {
    welcome: 'こんにちは！VEASLYへようこそ！\n\nVeaslyアシスタントです。ご質問を選択してください：',
    fallback: 'お問い合わせありがとうございます。関連情報が見つかりませんでした。\n「カスタマーサービス」と入力すると担当者に接続します。',
    escalate: 'はい！担当者におつなぎしますので、少々お待ちください...',
    satisfaction: 'ご相談は参考になりましたか？\n\n⭐ とても満足\n⭐⭐ 満足\n⭐⭐⭐ 普通\n⭐⭐⭐⭐ 不満\n\nフィードバックありがとうございます！',
    menuTitle: 'ご質問を選択してください：'
  }
};

function getMessage(lang, key) {
  var langMsgs = MESSAGES[lang] || MESSAGES['zh-TW'];
  return langMsgs[key] || MESSAGES['zh-TW'][key];
}

module.exports = { detectLanguage: detectLanguage, getMessage: getMessage, MESSAGES: MESSAGES };
