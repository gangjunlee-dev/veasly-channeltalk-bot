require('dotenv').config();
var aiEngine = require('../lib/ai-engine');
(async () => {
  await aiEngine.initializeAI();
  if (!aiEngine.isReady()) {
    console.error('AI not ready - aborting'); process.exit(2);
  }
  console.log('--- TEST 1: shipping question (zh-TW) ---');
  var r1 = await aiEngine.generateAnswer('運費怎麼算？', 'zh-TW', 'smoke-test-1', []);
  console.log('answer:', (r1 && r1.answer || '').substring(0, 200));
  console.log('confidence:', r1 && r1.confidence);
  console.log('category:', r1 && r1.category);
  console.log('grounded:', r1 && r1.grounded);

  console.log('--- TEST 2: order status (zh-TW) ---');
  var r2 = await aiEngine.generateAnswer('我想查訂單狀態', 'zh-TW', 'smoke-test-2', []);
  console.log('answer:', (r2 && r2.answer || '').substring(0, 200));
  console.log('confidence:', r2 && r2.confidence);
  console.log('category:', r2 && r2.category);

  console.log('--- TEST 3: refund policy (ko) ---');
  var r3 = await aiEngine.generateAnswer('환불 정책 알려주세요', 'ko', 'smoke-test-3', []);
  console.log('answer:', (r3 && r3.answer || '').substring(0, 200));
  console.log('confidence:', r3 && r3.confidence);
  console.log('category:', r3 && r3.category);
  process.exit(0);
})();
