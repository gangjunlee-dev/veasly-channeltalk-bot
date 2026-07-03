require('dotenv').config();
var aiEngine = require('../lib/ai-engine');
var { Pinecone } = require('@pinecone-database/pinecone');
(async () => {
  await aiEngine.initializeAI();
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME || 'veasly-cs');
  var idx = pc.index({ host: desc.host });
  // Get an embedding for a 'cancel' query
  var qv = await aiEngine.getQueryEmbedding('取消訂單');
  var r = await idx.namespace('faq').query({ vector: qv, topK: 10, includeMetadata: true });
  console.log('Top 10 matches for query "取消訂單":');
  for (var i = 0; i < r.matches.length; i++) {
    var m = r.matches[i];
    var meta = m.metadata || {};
    console.log('\n--- ' + (i+1) + '. id=' + m.id + ' score=' + (m.score||0).toFixed(3));
    console.log('source:', meta.source, '| category:', meta.category);
    console.log((meta.text || '').substring(0, 350));
  }
})().catch(function(e){console.error('ERR:',e.message);});
