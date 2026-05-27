require('dotenv').config();
var aiEngine = require('../lib/ai-engine');
(async () => {
  await aiEngine.initializeAI();
  var tests = [
    { q: '請問運費多少？', lang: 'zh-TW', expect: '295' },
    { q: '10公斤運費要多少TWD？', lang: 'zh-TW', expect: '2,845' },
    { q: '50kg 보내면 운임 얼마인가요?', lang: 'ko', expect: '13,060' },
    { q: '2kg 運費', lang: 'zh-TW', expect: '630' }
  ];
  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    console.log('\n=== TEST ' + (i+1) + ': "' + t.q + '" (' + t.lang + ') ===');
    var r = await aiEngine.generateAnswer(t.q, t.lang, 'smoke-shipping-' + i, []);
    if (!r) { console.log('NO ANSWER'); continue; }
    var matched = (r.answer || '').indexOf(t.expect) !== -1;
    console.log('confidence:', r.confidence && r.confidence.toFixed(3));
    console.log('expected substring "' + t.expect + '":', matched ? '✅ FOUND' : '❌ MISSING');
    console.log('answer:', (r.answer || '').substring(0, 300));
  }
  process.exit(0);
})().catch(function(e){console.error('ERR:',e.message);process.exit(1);});
