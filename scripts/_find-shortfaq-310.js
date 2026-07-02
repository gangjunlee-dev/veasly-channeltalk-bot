require('dotenv').config();
var { Pinecone } = require('@pinecone-database/pinecone');
(async () => {
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME || 'veasly-cs');
  var idx = pc.index({ host: desc.host });
  var r = await idx.namespace('faq').fetch({ ids: ['faq_TAX_001','faq_TAX_002','faq_HOLIDAY_001','faq_GROUP_001'] });
  Object.keys(r.records || {}).forEach(function(id){
    var t = r.records[id].metadata && r.records[id].metadata.text;
    console.log('--- ' + id + ' ---\n' + (t || '').substring(0,400) + '\n');
  });
})().catch(function(e){console.error('ERR:',e.message);});
