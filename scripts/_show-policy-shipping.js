require('dotenv').config();
var { Pinecone } = require('@pinecone-database/pinecone');
(async () => {
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME || 'veasly-cs');
  var idx = pc.index({ host: desc.host });
  var r = await idx.namespace('faq').fetch({ ids: ['official-policy-shipping-fee', 'official-faq-06-free-shipping-limit', 'official-faq-04-combine-cheaper'] });
  Object.keys(r.records || {}).forEach(function(id){
    console.log('\n=== ' + id + ' ===');
    console.log('source:', r.records[id].metadata && r.records[id].metadata.source);
    console.log('TEXT:');
    console.log(r.records[id].metadata && r.records[id].metadata.text);
  });
})().catch(function(e){console.error('ERR:',e.message);});
