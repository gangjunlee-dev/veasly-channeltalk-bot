var path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
var { Pinecone } = require('@pinecone-database/pinecone');

(async function(){
  var pc = new Pinecone({apiKey:process.env.PINECONE_API_KEY});
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME||'veasly-cs');
  var host = desc.host;
  var apiKey = process.env.PINECONE_API_KEY;

  var todayIds = [
    'faq-cancel-before-payment','faq-cancel-after-payment','faq-cancel-arrived-warehouse',
    'faq-cancel-bunjang','faq-refund-method','faq-refund-coupon','faq-return-policy',
    'faq-return-defect','faq-shipping-cost','faq-shipping-time','faq-free-shipping',
    'faq-free-shipping-non-eligible','faq-ezway','faq-customs-tax','faq-payment-methods',
    'faq-order-flow','faq-what-is-veasly','faq-service-fee','faq-used-goods',
    'faq-limited-items','faq-address-error','faq-invoice','faq-credit-points',
    'faq-checkout-mismatch','faq-combined-shipping'
  ];

  console.log('Host:', host);
  console.log('Deleting', todayIds.length, 'vectors via HTTP API...');

  var url = 'https://' + host + '/vectors/delete';
  var resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ids: todayIds,
      namespace: 'faq'
    })
  });

  console.log('Status:', resp.status, resp.statusText);
  var body = await resp.text();
  if(body) console.log('Response:', body);

  if(resp.ok){
    console.log('OK - Deleted', todayIds.length, 'vectors');
  } else {
    console.log('FAIL - trying one by one...');
    var ok = 0, fail = 0;
    for(var i = 0; i < todayIds.length; i++){
      var r2 = await fetch(url, {
        method: 'POST',
        headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [todayIds[i]], namespace: 'faq' })
      });
      if(r2.ok){ ok++; } else { fail++; console.log('  FAIL:', todayIds[i], r2.status); }
    }
    console.log('Individual: OK:', ok, 'FAIL:', fail);
  }

  // 확인
  var idx = pc.index({host:host});
  var stats = await idx.describeIndexStats();
  console.log('FAQ namespace now:', stats.namespaces.faq.recordCount, 'vectors');
  process.exit(0);
})();
