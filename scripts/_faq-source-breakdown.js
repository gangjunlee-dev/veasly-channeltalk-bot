require('dotenv').config();
var { Pinecone } = require('@pinecone-database/pinecone');
(async () => {
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME || 'veasly-cs');
  var idx = pc.index({ host: desc.host });
  // List all IDs in faq namespace (paginated)
  var sourceMap = {};
  var prefixMap = {};
  var langMap = {};
  var idList = [];
  var nextToken = undefined;
  var pages = 0;
  do {
    var page = await idx.namespace('faq').listPaginated({ limit: 100, paginationToken: nextToken });
    pages++;
    for (var i = 0; i < (page.vectors||[]).length; i++) { idList.push(page.vectors[i].id); }
    nextToken = page.pagination && page.pagination.next;
    if (pages > 20) break;
  } while (nextToken);
  console.log('Total ids enumerated:', idList.length);
  // ID prefix breakdown
  for (var i = 0; i < idList.length; i++) {
    var prefix = idList[i].split('_').slice(0, 2).join('_');
    prefixMap[prefix] = (prefixMap[prefix] || 0) + 1;
  }
  console.log('\nID prefix distribution:');
  Object.keys(prefixMap).sort(function(a,b){return prefixMap[b]-prefixMap[a];}).forEach(function(k){
    console.log('  ' + k + ': ' + prefixMap[k]);
  });
  // Fetch metadata for ~40 random samples
  if (idList.length > 0) {
    var sampleIds = [];
    var step = Math.max(1, Math.floor(idList.length / 40));
    for (var j = 0; j < idList.length; j += step) sampleIds.push(idList[j]);
    var fetched = await idx.namespace('faq').fetch(sampleIds);
    var records = fetched.records || {};
    Object.keys(records).forEach(function(rid){
      var meta = records[rid].metadata || {};
      var src = meta.source || '(no-source)';
      sourceMap[src] = (sourceMap[src] || 0) + 1;
      var lang = meta.lang || meta.language || '(no-lang)';
      langMap[lang] = (langMap[lang] || 0) + 1;
    });
    console.log('\nSource distribution (sampled ' + sampleIds.length + '):');
    Object.keys(sourceMap).sort(function(a,b){return sourceMap[b]-sourceMap[a];}).forEach(function(k){
      console.log('  ' + k + ': ' + sourceMap[k]);
    });
    console.log('\nLang distribution (sampled):');
    Object.keys(langMap).forEach(function(k){
      console.log('  ' + k + ': ' + langMap[k]);
    });
  }
})().catch(function(e){console.error('ERR:',e.message);});
