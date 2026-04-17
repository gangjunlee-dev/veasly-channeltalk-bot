#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
var ai = require('../lib/ai-engine');

var cancelRefundFAQs = [
  {
    id: 'faq_CANCEL_POLICY_001',
    text: '訂單可以取消嗎？怎麼取消訂單？我要取消→ 取消政策要看商品目前的狀態：1) 韓國賣家尚未出貨：可以申請取消，但需要賣家同意才行。2) 已經在韓國國內配送中（ORDER_PROCESSING）：這時候已經買好了，基本上無法取消。3) 已經到VEASLY倉庫或已寄出：無法取消。如果需要取消，請直接聯繫客服，我們會幫您跟賣家確認！',
    metadata: { category: 'cancel', type: 'policy', lang: 'zh-TW' }
  },
  {
    id: 'faq_CANCEL_BUNJANG_002',
    text: '閃電拍賣(BUNJANG)可以取消嗎？번개장터 取消→ BUNJANG（閃電拍賣/번개장터）是個人賣家平台，自動代購商品一旦購買完成，取消與否完全取決於賣家意願。如果賣家不同意取消，就絕對無法取消訂單喔。這點請您下單前要特別留意！',
    metadata: { category: 'cancel', type: 'policy', lang: 'zh-TW' }
  },
  {
    id: 'faq_REFUND_POLICY_003',
    text: '可以退貨嗎？退款？退錢？不想要了→ 因為是國際代購，客戶個人原因（不喜歡、尺寸不合、色差等）的退貨一律不接受喔。唯一可以退款的情況：商品尚未從韓國出發，而且品牌或賣家同意的情況下，扣除韓國國內來回運費後退款。已經從韓國寄出的商品就無法退款了。',
    metadata: { category: 'refund', type: 'policy', lang: 'zh-TW' }
  },
  {
    id: 'faq_SHIPPING_FEE_REFUND_004',
    text: '運費會退嗎？國際運費退還？運費差額？部分取消運費？→ 如果訂單中有商品被取消，實際出貨的重量跟原本預估的不一樣的話，多收的國際運費差額會退還給您。退還的金額會根據實際出貨重量重新計算。如果差額很小的話，VEASLY會直接幫您吸收喔！',
    metadata: { category: 'shipping_fee', type: 'policy', lang: 'zh-TW' }
  },
  {
    id: 'faq_DEFECT_POLICY_005',
    text: '收到壞的？瑕疵品？破損？商品有問題？→ 如果收到的商品有瑕疵或損壞，一定要有全程開箱錄影影片才能處理喔！影片要從外包裝開始拍，拍到內容物清楚可見。有影片的話請聯繫客服，我們會幫您確認處理方式。沒有開箱影片的話很抱歉無法處理瑕疵申報。',
    metadata: { category: 'defect', type: 'policy', lang: 'zh-TW' }
  },
  {
    id: 'faq_PARTIAL_CANCEL_006',
    text: '部分商品取消了怎麼辦？有些商品被取消？為什麼被取消？→ 有時候韓國賣家的商品會缺貨或無法出貨，這種情況下該商品會被取消並退款。其他正常的商品會繼續配送。被取消商品的退款和運費差額會一併處理喔！',
    metadata: { category: 'cancel', type: 'scenario', lang: 'zh-TW' }
  },
  {
    id: 'faq_EZWAY_HELP_007',
    text: 'EZ WAY怎麼用？什麼是EZ WAY？要怎麼申報？通關怎麼弄？→ EZ WAY是台灣海關的實名認證APP。包裹到台灣後，您會在APP收到通知，請點「申報相符」就可以了。如果沒有按申報相符，包裹可能會卡在海關無法通關喔！第一次使用需要先下載APP並完成實名認證。',
    metadata: { category: 'customs', type: 'guide', lang: 'zh-TW' }
  },
  {
    id: 'faq_EZWAY_STUCK_008',
    text: 'EZ WAY已經申報了但很久沒收到？申報相符後多久？通關很慢→ EZ WAY申報相符後，通常海關會在1-3個工作天內完成通關。通關後還要經過台灣國內物流配送，所以整體可能再需要1-3天。如果申報相符超過一週還沒收到，建議聯繫客服幫您確認物流狀態！',
    metadata: { category: 'customs', type: 'scenario', lang: 'zh-TW' }
  }
];

async function main() {
  console.log('=== 취소/환불/통관 FAQ 등록 시작 ===');
  await ai.initializeAI();
  
  for (var i = 0; i < cancelRefundFAQs.length; i++) {
    var faq = cancelRefundFAQs[i];
    try {
      await ai.addToKnowledgeBase(faq.text, faq.metadata.category, faq.id);
      console.log('등록 완료:', faq.id);
    } catch(e) {
      console.error('등록 실패:', faq.id, e.message);
    }
  }
  
  // 테스트
  console.log('\n=== 테스트 ===');
  var tests = ['訂單可以取消嗎', '收到瑕疵品', 'EZ WAY申報很久了', '運費會退嗎', '閃電拍賣能取消嗎'];
  for (var t = 0; t < tests.length; t++) {
    try {
      var r = await ai.generateAnswer(tests[t], 'zh-TW', 'test', []);
      console.log('Q:', tests[t]);
      console.log('A:', (r.answer || '').substring(0, 120) + '...');
      console.log('C:', r.confidence, '\n');
    } catch(e) { console.log('Test error:', tests[t], e.message); }
  }
  console.log('=== 완료 ===');
}

main().catch(console.error);
