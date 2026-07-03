require('dotenv').config();
var { Pinecone } = require('@pinecone-database/pinecone');
(async () => {
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME || 'veasly-cs');
  var idx = pc.index({ host: desc.host });
  var ns = idx.namespace('faq');
  var allIds = [];
  var nextToken;
  do {
    var page = await ns.listPaginated({ limit: 100, paginationToken: nextToken });
    for (var i = 0; i < (page.vectors||[]).length; i++) allIds.push(page.vectors[i].id);
    nextToken = page.pagination && page.pagination.next;
  } while (nextToken);
  console.log('Total ids:', allIds.length);
  var hits310 = [];
  for (var off = 0; off < allIds.length; off += 100) {
    var chunk = allIds.slice(off, off + 100);
    var r = await ns.fetch({ ids: chunk });
    var recs = r.records || {};
    Object.keys(recs).forEach(function(id){
      var text = (recs[id].metadata && recs[id].metadata.text) || '';
      if (/310/.test(text) && /(運費|kg|公斤|배송비)/.test(text)) {
        var snippet = (text.match(/.{0,40}310.{0,80}/) || [''])[0];
        hits310.push({ id: id, source: (recs[id].metadata && recs[id].metadata.source) || '', snippet: snippet });
      }
    });
  }
  console.log('\nIds mentioning 310 in shipping-fee context:', hits310.length);
  hits310.forEach(function(h){
    console.log('  ' + h.id + ' [' + h.source + ']');
    console.log('     ...' + h.snippet + '...');
  });
})().catch(function(e){console.error('ERR:',e.message);});
