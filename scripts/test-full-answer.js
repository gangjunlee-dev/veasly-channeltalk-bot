require('dotenv').config({ path: '/home/ubuntu/veasly-channeltalk-bot/.env' });

async function test() {
  var aiEngine = require('/home/ubuntu/veasly-channeltalk-bot/lib/ai-engine');
  await aiEngine.initializeAI();

  var tests = [
    "可以用點數換現金嗎？",
    "國際運費怎麼算？",
    "退貨的話退款要多久？",
    "我的訂單什麼時候會到？",
    "合併配送怎麼申請？"
  ];

  for (var i = 0; i < tests.length; i++) {
    var r = await aiEngine.generateAnswer(tests[i], "zh-TW", "full-" + i, []);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Q: " + tests[i]);
    console.log("A: " + (r ? r.answer : "NULL"));
    console.log("score: " + (r ? r.confidence.toFixed(3) : "N/A"));
    console.log("");
  }
}

test().catch(function(e) { console.error("에러:", e.message); });
