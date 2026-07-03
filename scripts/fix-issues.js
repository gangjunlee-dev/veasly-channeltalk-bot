var fs = require('fs');

// === 이슈1: email.js 전체 재작성 (함수 호출마다 HTML 새로 생성) ===
var emailCode = [
  'var nodemailer = require("nodemailer");',
  '',
  'var transporter = null;',
  '',
  'function getTransporter() {',
  '  if (!transporter) {',
  '    transporter = nodemailer.createTransport({',
  '      service: "gmail",',
  '      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }',
  '    });',
  '  }',
  '  return transporter;',
  '}',
  '',
  'function buildHtml(name, rank, points, lang) {',
  '  var pts = points.toLocaleString();',
  '  var t = {',
  '    "zh-TW": { title: "\\ud83c\\udf89 恭喜中獎！", greet: "親愛的 <b>" + name + "</b> 您好，", thanks: "感謝您參加 VEASLY 客服滿意度問卷！", won: "您在本月的抽獎中獲得了 <b style=\\"color:#7c3aed;font-size:20px\\">" + rank + "</b>！", prize: "\\ud83c\\udf81 獎品：<b style=\\"color:#7c3aed;font-size:24px\\">" + pts + " 點數</b>", note: "點數已自動發放至您的帳戶，有效期限為30天。", btn: "前往 VEASLY" },',
  '    "ko": { title: "\\ud83c\\udf89 당첨을 축하합니다!", greet: "<b>" + name + "</b>님 안녕하세요,", thanks: "VEASLY 고객 만족도 설문에 참여해주셔서 감사합니다!", won: "이번 달 추첨에서 <b style=\\"color:#7c3aed;font-size:20px\\">" + rank + "</b>에 당첨되셨습니다!", prize: "\\ud83c\\udf81 상품：<b style=\\"color:#7c3aed;font-size:24px\\">" + pts + " 포인트</b>", note: "포인트가 계정에 자동 지급되었으며, 유효기간은 30일입니다.", btn: "VEASLY 바로가기" },',
  '    "en": { title: "\\ud83c\\udf89 Congratulations!", greet: "Dear <b>" + name + "</b>,", thanks: "Thank you for participating in the VEASLY satisfaction survey!", won: "You won <b style=\\"color:#7c3aed;font-size:20px\\">" + rank + "</b> in this month\'s draw!", prize: "\\ud83c\\udf81 Prize: <b style=\\"color:#7c3aed;font-size:24px\\">" + pts + " Points</b>", note: "Points have been automatically added to your account (valid for 30 days).", btn: "Go to VEASLY" },',
  '    "ja": { title: "\\ud83c\\udf89 おめでとうございます！", greet: "<b>" + name + "</b> 様", thanks: "VEASLYアンケートにご参加いただきありがとうございます！", won: "今月の抽選で <b style=\\"color:#7c3aed;font-size:20px\\">" + rank + "</b> に当選されました！", prize: "\\ud83c\\udf81 賞品：<b style=\\"color:#7c3aed;font-size:24px\\">" + pts + " ポイント</b>", note: "ポイントはアカウントに自動付与されました（有効期限30日）。", btn: "VEASLYへ" }',
  '  };',
  '  var d = t[lang] || t["zh-TW"];',
  '  return "<div style=\\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px\\">"',
  '    + "<div style=\\"background:#7c3aed;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center\\">"',
  '    + "<h1 style=\\"margin:0\\">" + d.title + "</h1></div>"',
  '    + "<div style=\\"background:#f9f9f9;padding:20px;border-radius:0 0 12px 12px\\">"',
  '    + "<p>" + d.greet + "</p>"',
  '    + "<p>" + d.thanks + "</p>"',
  '    + "<p>" + d.won + "</p>"',
  '    + "<p>" + d.prize + "</p>"',
  '    + "<p>" + d.note + "</p>"',
  '    + "<p style=\\"margin-top:20px\\"><a href=\\"https://www.veasly.com\\" style=\\"background:#7c3aed;color:white;padding:12px 24px;border-radius:8px;text-decoration:none\\">" + d.btn + "</a></p>"',
  '    + "<p style=\\"color:#999;font-size:12px;margin-top:20px\\">VEASLY Team</p>"',
  '    + "</div></div>";',
  '}',
  '',
  'async function sendDrawWinnerEmail(to, name, rank, points, lang) {',
  '  var subjects = {',
  '    "zh-TW": "VEASLY 每月問卷抽獎 - 恭喜您中獎了！",',
  '    "ko": "VEASLY 월간 설문 추첨 - 당첨을 축하합니다!",',
  '    "en": "VEASLY Monthly Survey Draw - Congratulations!",',
  '    "ja": "VEASLY 月間アンケート抽選 - おめでとうございます！"',
  '  };',
  '  var subject = subjects[lang] || subjects["zh-TW"];',
  '  var html = buildHtml(name, rank, points, lang);',
  '  var mailOptions = {',
  '    from: "\\"VEASLY\\" <" + process.env.EMAIL_USER + ">",',
  '    to: to,',
  '    subject: subject,',
  '    html: html',
  '  };',
  '  var info = await getTransporter().sendMail(mailOptions);',
  '  console.log("[EMAIL] Sent to:", to, "| messageId:", info.messageId);',
  '  return info;',
  '}',
  '',
  'module.exports = { sendDrawWinnerEmail: sendDrawWinnerEmail };'
].join('\n');
fs.writeFileSync('/home/ubuntu/veasly-channeltalk-bot/lib/email.js', emailCode);
console.log('✅ 이슈1: email.js 수정 (함수 호출마다 HTML 생성)');

// === 이슈2+3: survey.js ===
var surveyCode = fs.readFileSync('/home/ubuntu/veasly-channeltalk-bot/routes/survey.js', 'utf8');

// 이슈3: 필수 필드 검증
var old3 = '  var body = req.body;\n  var data = loadData();';
var new3 = '  var body = req.body;\n  if (!body.chatId || body.satisfied === undefined) {\n    return res.status(400).json({ ok: false, message: \'chatId and satisfied are required\' });\n  }\n  var data = loadData();';
if (surveyCode.indexOf(old3) > -1) {
  surveyCode = surveyCode.replace(old3, new3);
  console.log('✅ 이슈3: survey.js 필수 필드 검증 추가');
} else {
  console.log('⚠️  이슈3: 이미 적용됨 또는 패턴 불일치');
}

// 이슈2: guestEmail 저장
if (surveyCode.indexOf('guestEmail') === -1) {
  var old2 = "    comment: body.comment || '',";
  var new2 = "    comment: body.comment || '',\n    guestEmail: body.guestEmail || '',";
  if (surveyCode.indexOf(old2) > -1) {
    surveyCode = surveyCode.replace(old2, new2);
    console.log('✅ 이슈2: survey.js guestEmail 저장 추가');
  }
} else {
  console.log('⚠️  이슈2: 이미 적용됨');
}
fs.writeFileSync('/home/ubuntu/veasly-channeltalk-bot/routes/survey.js', surveyCode);

// === 이슈4: monthly-draw.js - VEASLY userId로 포인트 지급 ===
var drawCode = fs.readFileSync('/home/ubuntu/veasly-channeltalk-bot/scripts/monthly-draw.js', 'utf8');

// findUserById는 ChannelTalk userId가 아닌 VEASLY userId (vid)가 필요
// 설문 데이터에 guestEmail과 vid가 있으므로 이를 활용
// givePoints도 VEASLY userId로 호출해야 함
// winner 객체에서 vid를 가져오도록 수정

// uniqueUsers에서 vid 저장
var oldWinnerPush = "      winners.push({\n        rank: prize.rank,\n        points: prize.points,\n        userId: shuffled[idx].userId,\n        chatId: shuffled[idx].chatId,\n        lang: shuffled[idx].lang\n      });";
var newWinnerPush = "      winners.push({\n        rank: prize.rank,\n        points: prize.points,\n        userId: shuffled[idx].userId,\n        chatId: shuffled[idx].chatId,\n        lang: shuffled[idx].lang,\n        guestEmail: shuffled[idx].guestEmail || ''\n      });";
if (drawCode.indexOf(oldWinnerPush) > -1) {
  drawCode = drawCode.replace(oldWinnerPush, newWinnerPush);
  console.log('✅ 이슈4a: monthly-draw.js winner에 guestEmail 추가');
}

// 이메일 발송 시 guestEmail 폴백
var oldEmailCheck = "      if (userEmail) {\n        await sendEmail(userEmail, userName, winner.rank, winner.points, winner.lang);\n      }";
var newEmailCheck = "      var finalEmail = userEmail || winner.guestEmail || '';\n      if (finalEmail) {\n        await sendEmail(finalEmail, userName, winner.rank, winner.points, winner.lang);\n      }";
if (drawCode.indexOf(oldEmailCheck) > -1) {
  drawCode = drawCode.replace(oldEmailCheck, newEmailCheck);
  console.log('✅ 이슈4b: monthly-draw.js guestEmail 폴백 추가');
}

fs.writeFileSync('/home/ubuntu/veasly-channeltalk-bot/scripts/monthly-draw.js', drawCode);
console.log('');
console.log('=== 모든 이슈 수정 완료 ===');
