require('dotenv').config({ path: '/home/ubuntu/veasly-channeltalk-bot/.env' });

async function test() {
  var aiEngine = require('/home/ubuntu/veasly-channeltalk-bot/lib/ai-engine');
  await aiEngine.initializeAI();

  var tests = [
    "可以用點數換現金嗎？",
    "國際運費怎麼算？",
    "合併配送怎麼申請？"
  ];

  for (var i = 0; i < tests.length; i++) {
    var r = await aiEngine.generateAnswer(tests[i], "zh-TW", "token-fix-" + i, []);
    console.log("===== Q" + (i+1) + ": " + tests[i] + " =====");
    if (r) {
      console.log("길이: " + r.answer.length + "자 | score: " + r.confidence.toFixed(3));
      console.log(r.answer);
    } else {
      console.log("NULL");
    }
    console.log("");
  }
}

test().catch(function(e) { console.error("에러:", e.message); });
