var fs = require('fs');

// === 작업1: webhook.js dead code 제거 ===
var whFile = '/home/ubuntu/veasly-channeltalk-bot/routes/webhook.js';
var whCode = fs.readFileSync(whFile, 'utf8');

// if (false && ...) 블록 찾기 - 시작부터 setTimeout까지 전체 제거
var deadStart = whCode.indexOf('if (false && surveyMsg');
if (deadStart > -1) {
  // 해당 블록의 끝 찾기 (setTimeout 5분 후 메모리 락 해제 포함)
  var deadEnd = whCode.indexOf("delete _csatSendLock[chatId0]; }, 5 * 60 * 1000);", deadStart);
  if (deadEnd > -1) {
    deadEnd = whCode.indexOf('\n', deadEnd) + 1;
    // } else { 블록도 찾기
    var elseBlock = whCode.indexOf('} else {', deadEnd);
    var elseEnd = -1;
    if (elseBlock > -1 && elseBlock - deadEnd < 20) {
      elseEnd = whCode.indexOf('\n', whCode.indexOf('\n', elseBlock) + 1) + 1;
      // closing }
      var closingBrace = whCode.indexOf('}', elseEnd);
      if (closingBrace > -1 && closingBrace - elseEnd < 100) {
        elseEnd = whCode.indexOf('\n', closingBrace) + 1;
      }
    }
    var removeEnd = elseEnd > -1 ? elseEnd : deadEnd;
    var removed = whCode.substring(deadStart, removeEnd);
    whCode = whCode.substring(0, deadStart) + '// CSAT on close: removed (not supported by webhook scope)\n' + whCode.substring(removeEnd);
    fs.writeFileSync(whFile, whCode);
    console.log('webhook.js dead code 제거 완료 (' + removed.length + ' bytes)');
  } else {
    console.log('webhook.js dead code 끝을 찾을 수 없음');
  }
} else {
  console.log('webhook.js dead code 이미 제거됨');
}

// === 작업2: 이메일 발송 모듈 생성 ===
var emailLib = '/home/ubuntu/veasly-channeltalk-bot/lib/email.js';
var emailCode = `var nodemailer = require('nodemailer');

var transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }
  return transporter;
}

async function sendDrawWinnerEmail(to, name, rank, points, lang) {
  var subjects = {
    'zh-TW': 'VEASLY 每月問卷抽獎 - 恭喜您中獎了！',
    'ko': 'VEASLY 월간 설문 추첨 - 당첨을 축하합니다!',
    'en': 'VEASLY Monthly Survey Draw - Congratulations!',
    'ja': 'VEASLY 月間アンケート抽選 - おめでとうございます！'
  };
  var bodies = {
    'zh-TW': '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">'
      + '<div style="background:#7c3aed;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center">'
      + '<h1 style="margin:0">🎉 恭喜中獎！</h1></div>'
      + '<div style="background:#f9f9f9;padding:20px;border-radius:0 0 12px 12px">'
      + '<p>親愛的 <b>' + name + '</b> 您好，</p>'
      + '<p>感謝您參加 VEASLY 客服滿意度問卷！</p>'
      + '<p>您在本月的抽獎中獲得了 <b style="color:#7c3aed;font-size:20px">' + rank + '</b>！</p>'
      + '<p>🎁 獎品：<b style="color:#7c3aed;font-size:24px">' + points.toLocaleString() + ' 點數</b></p>'
      + '<p>點數已自動發放至您的帳戶，有效期限為30天。</p>'
      + '<p style="margin-top:20px"><a href="https://www.veasly.com" style="background:#7c3aed;color:white;padding:12px 24px;border-radius:8px;text-decoration:none">前往 VEASLY</a></p>'
      + '<p style="color:#999;font-size:12px;margin-top:20px">VEASLY Team</p>'
      + '</div></div>',
    'ko': '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">'
      + '<div style="background:#7c3aed;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center">'
      + '<h1 style="margin:0">🎉 당첨을 축하합니다!</h1></div>'
      + '<div style="background:#f9f9f9;padding:20px;border-radius:0 0 12px 12px">'
      + '<p><b>' + name + '</b>님 안녕하세요,</p>'
      + '<p>VEASLY 고객 만족도 설문에 참여해주셔서 감사합니다!</p>'
      + '<p>이번 달 추첨에서 <b style="color:#7c3aed;font-size:20px">' + rank + '</b>에 당첨되셨습니다!</p>'
      + '<p>🎁 상품：<b style="color:#7c3aed;font-size:24px">' + points.toLocaleString() + ' 포인트</b></p>'
      + '<p>포인트가 계정에 자동 지급되었으며, 유효기간은 30일입니다.</p>'
      + '<p style="margin-top:20px"><a href="https://www.veasly.com" style="background:#7c3aed;color:white;padding:12px 24px;border-radius:8px;text-decoration:none">VEASLY 바로가기</a></p>'
      + '<p style="color:#999;font-size:12px;margin-top:20px">VEASLY Team</p>'
      + '</div></div>',
    'en': '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">'
      + '<div style="background:#7c3aed;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center">'
      + '<h1 style="margin:0">🎉 Congratulations!</h1></div>'
      + '<div style="background:#f9f9f9;padding:20px;border-radius:0 0 12px 12px">'
      + '<p>Dear <b>' + name + '</b>,</p>'
      + '<p>Thank you for participating in the VEASLY satisfaction survey!</p>'
      + '<p>You won <b style="color:#7c3aed;font-size:20px">' + rank + '</b> in this month\\'s draw!</p>'
      + '<p>🎁 Prize: <b style="color:#7c3aed;font-size:24px">' + points.toLocaleString() + ' Points</b></p>'
      + '<p>Points have been automatically added to your account (valid for 30 days).</p>'
      + '<p style="margin-top:20px"><a href="https://www.veasly.com" style="background:#7c3aed;color:white;padding:12px 24px;border-radius:8px;text-decoration:none">Go to VEASLY</a></p>'
      + '<p style="color:#999;font-size:12px;margin-top:20px">VEASLY Team</p>'
      + '</div></div>',
    'ja': '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">'
      + '<div style="background:#7c3aed;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center">'
      + '<h1 style="margin:0">🎉 おめでとうございます！</h1></div>'
      + '<div style="background:#f9f9f9;padding:20px;border-radius:0 0 12px 12px">'
      + '<p><b>' + name + '</b> 様</p>'
      + '<p>VEASLYアンケートにご参加いただきありがとうございます！</p>'
      + '<p>今月の抽選で <b style="color:#7c3aed;font-size:20px">' + rank + '</b> に当選されました！</p>'
      + '<p>🎁 賞品：<b style="color:#7c3aed;font-size:24px">' + points.toLocaleString() + ' ポイント</b></p>'
      + '<p>ポイントはアカウントに自動付与されました（有効期限30日）。</p>'
      + '<p style="margin-top:20px"><a href="https://www.veasly.com" style="background:#7c3aed;color:white;padding:12px 24px;border-radius:8px;text-decoration:none">VEASLYへ</a></p>'
      + '<p style="color:#999;font-size:12px;margin-top:20px">VEASLY Team</p>'
      + '</div></div>'
  };
  var subject = subjects[lang] || subjects['zh-TW'];
  var html = bodies[lang] || bodies['zh-TW'];
  var mailOptions = {
    from: '"VEASLY" <' + process.env.EMAIL_USER + '>',
    to: to,
    subject: subject,
    html: html
  };
  var info = await getTransporter().sendMail(mailOptions);
  console.log('[EMAIL] Sent to:', to, '| messageId:', info.messageId);
  return info;
}

module.exports = { sendDrawWinnerEmail: sendDrawWinnerEmail };
`;
fs.writeFileSync(emailLib, emailCode);
console.log('lib/email.js 생성 완료');

// === 작업3: monthly-draw.js에서 sendEmail 연동 ===
var drawFile = '/home/ubuntu/veasly-channeltalk-bot/scripts/monthly-draw.js';
var drawCode = fs.readFileSync(drawFile, 'utf8');

// 기존 sendEmail 함수 교체
var oldSendEmail = "async function sendEmail(email, name, rank, points, lang) { console.log('[EMAIL] To:', email, '| Name:', name, '| Rank:', rank, '| Points:', points, '| Lang:', lang); return true; }";
var newSendEmail = "var emailLib = require('../lib/email');\nasync function sendEmail(email, name, rank, points, lang) {\n  try {\n    await emailLib.sendDrawWinnerEmail(email, name, rank, points, lang);\n    return true;\n  } catch(e) {\n    console.log('[EMAIL] Send failed:', email, e.message);\n    return false;\n  }\n}";

if (drawCode.indexOf(oldSendEmail) > -1) {
  drawCode = drawCode.replace(oldSendEmail, newSendEmail);
  fs.writeFileSync(drawFile, drawCode);
  console.log('monthly-draw.js sendEmail 연동 완료');
} else {
  console.log('monthly-draw.js sendEmail 이미 수정됨 또는 패턴 불일치');
}

