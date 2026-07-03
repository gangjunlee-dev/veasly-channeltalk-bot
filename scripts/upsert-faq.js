var path = require('path');
var fs = require('fs');
var aiEngine = require('../lib/ai-engine');
var faqs = JSON.parse(fs.readFileSync(path.join(__dirname, 'faq-data.json'), 'utf8'));

(async function() {
  console.log('=== Pinecone FAQ upsert start ===');
  await aiEngine.initializeAI();
  console.log('AI engine ready. Items:', faqs.length);
  var ok = 0, ng = 0;
  for (var i = 0; i < faqs.length; i++) {
    try {
      await aiEngine.addToKnowledgeBase(faqs[i].id, faqs[i].text, {
        namespace: 'faq',
        category: faqs[i].id.split('-')[1],
        lang: 'zh-TW',
        source: 'policy-update-20260514'
      });
      ok++;
      console.log((i+1) + '/' + faqs.length + ' OK ' + faqs[i].id);
    } catch(e) {
      ng++;
      console.log((i+1) + '/' + faqs.length + ' FAIL ' + faqs[i].id + ': ' + e.message);
    }
    if (i < faqs.length - 1) await new Promise(function(r) { setTimeout(r, 500); });
  }
  console.log('=== Done: ' + ok + ' ok, ' + ng + ' fail ===');
  process.exit(0);
})();
