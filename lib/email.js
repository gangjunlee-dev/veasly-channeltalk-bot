var nodemailer = require("nodemailer");

var transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
  }
  return transporter;
}

function buildHtml(name, rank, points, lang) {
  var pts = points.toLocaleString();
  var t = {
    "zh-TW": { title: "\ud83c\udf89 恭喜中獎！", greet: "親愛的 <b>" + name + "</b> 您好，", thanks: "感謝您參加 VEASLY 客服滿意度問卷！", won: "您在本月的抽獎中獲得了 <b style=\"color:#7c3aed;font-size:20px\">" + rank + "</b>！", prize: "\ud83c\udf81 獎品：<b style=\"color:#7c3aed;font-size:24px\">" + pts + " 點數</b>", note: "點數已自動發放至您的帳戶，有效期限為30天。", btn: "前往 VEASLY" },
    "ko": { title: "\ud83c\udf89 당첨을 축하합니다!", greet: "<b>" + name + "</b>님 안녕하세요,", thanks: "VEASLY 고객 만족도 설문에 참여해주셔서 감사합니다!", won: "이번 달 추첨에서 <b style=\"color:#7c3aed;font-size:20px\">" + rank + "</b>에 당첨되셨습니다!", prize: "\ud83c\udf81 상품：<b style=\"color:#7c3aed;font-size:24px\">" + pts + " 포인트</b>", note: "포인트가 계정에 자동 지급되었으며, 유효기간은 30일입니다.", btn: "VEASLY 바로가기" },
    "en": { title: "\ud83c\udf89 Congratulations!", greet: "Dear <b>" + name + "</b>,", thanks: "Thank you for participating in the VEASLY satisfaction survey!", won: "You won <b style=\"color:#7c3aed;font-size:20px\">" + rank + "</b> in this month's draw!", prize: "\ud83c\udf81 Prize: <b style=\"color:#7c3aed;font-size:24px\">" + pts + " Points</b>", note: "Points have been automatically added to your account (valid for 30 days).", btn: "Go to VEASLY" },
    "ja": { title: "\ud83c\udf89 おめでとうございます！", greet: "<b>" + name + "</b> 様", thanks: "VEASLYアンケートにご参加いただきありがとうございます！", won: "今月の抽選で <b style=\"color:#7c3aed;font-size:20px\">" + rank + "</b> に当選されました！", prize: "\ud83c\udf81 賞品：<b style=\"color:#7c3aed;font-size:24px\">" + pts + " ポイント</b>", note: "ポイントはアカウントに自動付与されました（有効期限30日）。", btn: "VEASLYへ" }
  };
  var d = t[lang] || t["zh-TW"];
  return "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px\">"
    + "<div style=\"background:#7c3aed;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center\">"
    + "<h1 style=\"margin:0\">" + d.title + "</h1></div>"
    + "<div style=\"background:#f9f9f9;padding:20px;border-radius:0 0 12px 12px\">"
    + "<p>" + d.greet + "</p>"
    + "<p>" + d.thanks + "</p>"
    + "<p>" + d.won + "</p>"
    + "<p>" + d.prize + "</p>"
    + "<p>" + d.note + "</p>"
    + "<p style=\"margin-top:20px\"><a href=\"https://www.veasly.com\" style=\"background:#7c3aed;color:white;padding:12px 24px;border-radius:8px;text-decoration:none\">" + d.btn + "</a></p>"
    + "<p style=\"color:#999;font-size:12px;margin-top:20px\">VEASLY Team</p>"
    + "</div></div>";
}

async function sendDrawWinnerEmail(to, name, rank, points, lang) {
  var subjects = {
    "zh-TW": "VEASLY 每月問卷抽獎 - 恭喜您中獎了！",
    "ko": "VEASLY 월간 설문 추첨 - 당첨을 축하합니다!",
    "en": "VEASLY Monthly Survey Draw - Congratulations!",
    "ja": "VEASLY 月間アンケート抽選 - おめでとうございます！"
  };
  var subject = subjects[lang] || subjects["zh-TW"];
  var html = buildHtml(name, rank, points, lang);
  var mailOptions = {
    from: "\"VEASLY\" <" + process.env.EMAIL_USER + ">",
    to: to,
    subject: subject,
    html: html
  };
  var info = await getTransporter().sendMail(mailOptions);
  console.log("[EMAIL] Sent to:", to, "| messageId:", info.messageId);
  return info;
}

// [2026-06-29] 범용 운영 알림 메일 (Gemini 429 등 장애 경보용). 수신: ALERT_EMAIL || EMAIL_USER(자기 자신)
async function sendAlertEmail(subject, text) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) { console.error("[EMAIL] alert skipped - no EMAIL creds"); return; }
  var to = process.env.ALERT_EMAIL || process.env.EMAIL_USER;
  var info = await getTransporter().sendMail({
    from: "\"VEASLY Bot\" <" + process.env.EMAIL_USER + ">",
    to: to,
    subject: subject,
    text: text
  });
  console.log("[EMAIL] Alert sent to:", to, "| messageId:", info.messageId);
  return info;
}

module.exports = { sendDrawWinnerEmail: sendDrawWinnerEmail, sendAlertEmail: sendAlertEmail };