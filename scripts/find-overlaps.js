var { Pinecone } = require('@pinecone-database/pinecone');
var fs = require('fs');
var aiEngine = require('../lib/ai-engine');

(async function() {
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME || 'veasly-cs');
  var index = pc.index({ host: desc.host });
  var ns = index.namespace('faq');
  await aiEngine.initializeAI();

  var queries = ['取消退款退貨','運費配送EZ WAY','付款方式信用卡','BUNJANG二手商品','免運優惠折扣','帳戶註冊發票','合併配送寄送','商品報價購買','開箱影片瑕疵','客服營業時間'];
  var allIds = {};

  for (var i = 0; i < queries.length; i++) {
    var vec = await aiEngine.getEmbedding(queries[i]);
    var res = await ns.query({ vector: vec, topK: 100, includeMetadata: true });
    res.matches.forEach(function(m) {
      if (allIds[m.id] === undefined) {
        allIds[m.id] = {
          source: (m.metadata && m.metadata.source) || 'unknown',
          text: ((m.metadata && m.metadata.text) || '').substring(0, 80)
        };
      }
    });
  }

  var all = Object.entries(allIds);
  var today = all.filter(function(e) { return e[1].source === 'policy-update-20260514'; });
  var old = all.filter(function(e) { return e[1].source !== 'policy-update-20260514'; });

  console.log('Total unique:', all.length, '| Today:', today.length, '| Old:', old.length);

  var bySource = {};
  old.forEach(function(e) {
    var s = e[1].source;
    if (bySource[s] === undefined) bySource[s] = [];
    bySource[s].push(e[0]);
  });
  console.log('\n=== Old by source ===');
  Object.entries(bySource).sort(function(a,b){return b[1].length-a[1].length;}).forEach(function(e) {
    console.log(e[0] + ': ' + e[1].length);
  });

  var kwMap = {
    cancel: ['取消','cancel'],
    refund: ['退款','refund'],
    return_item: ['退貨','return','瑕疵','defect','開箱'],
    shipping: ['運費','shipping','配送','寄送','物流','到貨'],
    free_shipping: ['免運','free ship'],
    ezway: ['ez way','ezway','易利委'],
    customs: ['關稅','customs','tax','稅費'],
    payment: ['付款','payment','信用卡','atm','paypal','匯款'],
    invoice: ['發票','invoice','收據'],
    combined: ['合併','combine','merge'],
    bunjang: ['bunjang','二手','番茄'],
    points: ['點數','credit'],
    checkout: ['結帳','金額不符']
  };

  var deleteIds = [];
  var keepIds = [];

  old.forEach(function(e) {
    var txt = (e[1].text + ' ' + e[0]).toLowerCase();
    var matched = false;
    for (var cat in kwMap) {
      if (kwMap[cat].some(function(kw) { return txt.indexOf(kw.toLowerCase()) >= 0; })) {
        deleteIds.push(e[0]);
        matched = true;
        break;
      }
    }
    if (matched === false) keepIds.push(e[0]);
  });

  console.log('\n=== DELETE (overlapping): ' + deleteIds.length + ' ===');
  deleteIds.forEach(function(id) { console.log('  DEL: ' + id + ' | ' + allIds[id].text.substring(0,50)); });

  console.log('\n=== KEEP (unique): ' + keepIds.length + ' ===');
  keepIds.forEach(function(id) { console.log('  KEEP: ' + id + ' | ' + allIds[id].text.substring(0,50)); });

  fs.writeFileSync('scripts/faq-delete-ids.json', JSON.stringify(deleteIds, null, 2));
  console.log('\nSaved to scripts/faq-delete-ids.json');
})();
