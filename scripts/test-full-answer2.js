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
    var r = await aiEngine.generateAnswer(tests[i], "zh-TW", "full2-" + i, []);
    console.log("===== Q" + (i+1) + ": " + tests[i] + " =====");
    if (r) {
      // 전체 답변을 줄단위로 출력
      console.log("confidence: " + r.confidence.toFixed(3));
      console.log("answer length: " + r.answer.length + " chars");
      console.log("--- FULL ANSWER START ---");
      console.log(r.answer);
      console.log("--- FULL ANSWER END ---");
    } else {
      console.log("NULL");
    }
    console.log("");
  }
}

test().catch(function(e) { console.error("에러:", e.message); });
