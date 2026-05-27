require('dotenv').config();
var { Pinecone } = require('@pinecone-database/pinecone');
(async () => {
  try {
    var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    var indexName = process.env.PINECONE_INDEX_NAME || 'veasly-cs';
    var desc = await pc.describeIndex(indexName);
    console.log('Index:', indexName);
    console.log('Host:', desc.host);
    console.log('Dim:', desc.dimension, 'Metric:', desc.metric);
    var idx = pc.index({ host: desc.host });
    var stats = await idx.describeIndexStats();
    console.log('Total vectors:', stats.totalRecordCount);
    console.log('Namespaces:', JSON.stringify(stats.namespaces, null, 2));
  } catch (e) { console.error('ERR:', e.message); }
})();
