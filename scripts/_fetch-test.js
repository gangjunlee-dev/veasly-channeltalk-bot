require('dotenv').config();
var { Pinecone } = require('@pinecone-database/pinecone');
(async () => {
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME || 'veasly-cs');
  var idx = pc.index({ host: desc.host });
  var ns = idx.namespace('faq');
  var p = await ns.listPaginated({ limit: 5 });
  var ids = (p.vectors||[]).map(function(v){return v.id;});
  console.log('Testing fetch with ids:', ids);
  // Form 1: positional array
  try {
    var r1 = await ns.fetch(ids);
    console.log('Form 1 (array):', Object.keys(r1.records || {}).length, 'records');
  } catch(e){ console.log('Form 1 ERR:', e.message); }
  // Form 2: object with ids
  try {
    var r2 = await ns.fetch({ ids: ids });
    console.log('Form 2 (object):', Object.keys(r2.records || {}).length, 'records');
  } catch(e){ console.log('Form 2 ERR:', e.message); }
})();
