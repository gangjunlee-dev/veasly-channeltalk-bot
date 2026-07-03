var path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
var aiEngine = require('../lib/ai-engine');
var { Pinecone } = require('@pinecone-database/pinecone');

(async function(){
  await aiEngine.initializeAI();
  var pc = new Pinecone({apiKey:process.env.PINECONE_API_KEY});
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME||'veasly-cs');
  var idx = pc.index({host:desc.host}).namespace('faq');

  var queries = ['取消退款退貨','運費配送EZ WAY','商品問題瑕疵','帳號付款','合併寄送','二手閃電拍賣','發票稅金關稅','訂單狀態查詢','開箱影片收件','點數優惠碼','VEASLY是什麼','付款方式','地址錯誤'];
  var allIds = {};

  for(var i=0; i<queries.length; i++){
    var vec = await aiEngine.getEmbedding(queries[i]);
    var res = await idx.query({vector:vec, topK:100, includeMetadata:true});
    res.matches.forEach(function(m){
      if(allIds[m.id] === undefined){
        allIds[m.id] = {
          source: (m.metadata && m.metadata.source) || 'unknown',
          text: ((m.metadata && m.metadata.text) || '').substring(0,80)
        };
      }
    });
  }

  var bySource = {};
  var ids = Object.keys(allIds);
  ids.forEach(function(id){
    var s = allIds[id].source;
    if(bySource[s] === undefined) bySource[s] = [];
    bySource[s].push(id);
  });

  console.log('=== source 분포 ===');
  Object.keys(bySource).sort().forEach(function(s){
    console.log(s + ': ' + bySource[s].length);
  });
  console.log('\n총 unique:', ids.length, '/ 318');

  console.log('\n=== 오늘 업서트 (policy-update-20260514) ===');
  var todayIds = bySource['policy-update-20260514'] || [];
  todayIds.forEach(function(id){
    console.log('  ' + id + ' | ' + allIds[id].text);
  });

  console.log('\n=== 기존 유지분 (최대 30개) ===');
  var oldIds = ids.filter(function(id){ return allIds[id].source !== 'policy-update-20260514'; });
  oldIds.slice(0,30).forEach(function(id){
    console.log('  [' + allIds[id].source + '] ' + id);
    console.log('    ' + allIds[id].text);
  });

  process.exit(0);
})();
