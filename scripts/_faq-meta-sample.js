require('dotenv').config();
var { Pinecone } = require('@pinecone-database/pinecone');
(async () => {
  try {
    var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME || 'veasly-cs');
    var idx = pc.index({ host: desc.host });
    // Query with zero vector to get random samples
    var zero = new Array(3072).fill(0);
    var r = await idx.namespace('faq').query({ vector: zero, topK: 8, includeMetadata: true });
    var sourceCounts = {};
    var langCounts = {};
    var idPrefixes = {};
    for (var i = 0; i < r.matches.length; i++) {
      var m = r.matches[i];
      var meta = m.metadata || {};
      var src = meta.source || '(no-source)';
      var lang = meta.lang || meta.language || '(no-lang)';
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
      langCounts[lang] = (langCounts[lang] || 0) + 1;
      var prefix = (m.id || '').split('_')[0];
      idPrefixes[prefix] = (idPrefixes[prefix] || 0) + 1;
      console.log('--- match ' + (i+1) + ' id=' + m.id + ' score=' + (m.score||0).toFixed(3));
      console.log('  source:', src, '| lang:', lang, '| category:', meta.category || '(none)');
      var text = (meta.text || '').substring(0, 120);
      console.log('  text:', text + (meta.text && meta.text.length > 120 ? '...' : ''));
    }
    console.log('\n=== Sample stats ===');
    console.log('source distribution:', JSON.stringify(sourceCounts));
    console.log('lang distribution:', JSON.stringify(langCounts));
    console.log('id-prefix distribution:', JSON.stringify(idPrefixes));
  } catch (e) { console.error('ERR:', e.message); }
})();
