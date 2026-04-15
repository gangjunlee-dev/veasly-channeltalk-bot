var channeltalk = require('./channeltalk');

var ALERT_CHAT_ID = process.env.ALERT_CHAT_ID || "";
var lastAlert = 0;
var COOLDOWN = 300000; // 5 min cooldown

async function sendAlert(type, message) {
  if (!ALERT_CHAT_ID) return;
  if (Date.now() - lastAlert < COOLDOWN) return;
  lastAlert = Date.now();
  var text = "🚨 VEASLY Bot Alert\n\n" + "Type: " + type + "\n" + "Time: " + new Date().toISOString().substring(0, 19).replace("T", " ") + "\n" + "Detail: " + message;
  try {
    await channeltalk.sendMessage(ALERT_CHAT_ID, { blocks: [{ type: "text", value: text }] });
    console.log("[Alert] Sent:", type);
  } catch(e) { console.error("[Alert] Send failed:", e.message); }
}

module.exports = { sendAlert: sendAlert };
