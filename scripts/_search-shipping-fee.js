require('dotenv').config();
var aiEngine = require('../lib/ai-engine');
var { Pinecone } = require('@pinecone-database/pinecone');
(async () => {
  await aiEngine.initializeAI();
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME || 'veasly-cs');
  var idx = pc.index({ host: desc.host });
  var queries = ['國際運費 多少', '運費 計算 公斤', '0~1kg 運費', 'TWD 310'];
  for (var qi = 0; qi < queries.length; qi++) {
    var qv = await aiEngine.getQueryEmbedding(queries[qi]);
    var r = await idx.namespace('faq').query({ vector: qv, topK: 5, includeMetadata: true });
    console.log('\n=== query: ' + queries[qi] + ' ===');
    for (var i = 0; i < r.matches.length; i++) {
      var m = r.matches[i];
      var text = (m.metadata && m.metadata.text) || '';
      var src = (m.metadata && m.metadata.source) || '';
      var mentions310 = /310/.test(text);
      var mentions295 = /295/.test(text);
      console.log('  ' + (i+1) + '. ' + m.id + ' (' + (m.score||0).toFixed(3) + ') [src:' + src + ']');
      if (mentions310 || mentions295) {
        console.log('     >> ' + (mentions310 ? 'CONTAINS 310 ' : '') + (mentions295 ? 'CONTAINS 295' : ''));
        // print relevant snippet
        var match = text.match(/.{0,40}(310|295).{0,80}/);
        if (match) console.log('     >> ...' + match[0] + '...');
      }
    }
  }
})().catch(function(e){console.error('ERR:',e.message);});
