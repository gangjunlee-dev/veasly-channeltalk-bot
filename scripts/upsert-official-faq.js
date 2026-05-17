var path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
var fs = require('fs');
var aiEngine = require('../lib/ai-engine');
var faqs = JSON.parse(fs.readFileSync(path.join(__dirname, 'faq-data-official.json'), 'utf8'));

(async function(){
  console.log('=== Official FAQ upsert start ===');
  await aiEngine.initializeAI();
  console.log('AI engine ready. Items:', faqs.length);
  var ok = 0, ng = 0;
  for(var i = 0; i < faqs.length; i++){
    try {
      await aiEngine.addToKnowledgeBase(faqs[i].id, faqs[i].text, {
        namespace: 'faq',
        category: faqs[i].id.indexOf('policy') > -1 ? 'policy' : 'faq',
        lang: 'zh-TW',
        source: 'official-doc-20260514'
      });
      ok++;
      console.log((i+1) + '/' + faqs.length + ' OK ' + faqs[i].id);
    } catch(e) {
      ng++;
      console.log((i+1) + '/' + faqs.length + ' FAIL ' + faqs[i].id + ': ' + e.message);
    }
    if(i < faqs.length - 1) await new Promise(function(r){ setTimeout(r, 500); });
  }
  console.log('\n=== Done: ' + ok + ' ok, ' + ng + ' fail ===');
  process.exit(0);
})();
