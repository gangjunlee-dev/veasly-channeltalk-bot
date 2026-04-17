require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
var ai = require('../lib/ai-engine');

var colloquialFAQs = [
  {
    id: 'faq_SHIP_COLLOQUIAL_001',
    text: '東西什麼時候會到？包裹什麼時候到？我的東西寄了嗎？→ 韓國出發後通常7~14天到貨。可以用訂單編號查詢目前配送狀態。追蹤碼會在出貨後通知。',
    metadata: { category: '配送', type: 'colloquial', lang: 'zh-TW' }
  },
  {
    id: 'faq_SHIP_COLLOQUIAL_002',
    text: '可以合在一起寄嗎？能不能併在一起出？一起寄比較省吧？→ 如果多筆訂單尚未從韓國出發，可以合併寄送。合併後按總重量計算運費，通常會比分開寄便宜。請聯繫客服確認是否可合併。',
    metadata: { category: '合併配送', type: 'colloquial', lang: 'zh-TW' }
  },
  {
    id: 'faq_CANCEL_COLLOQUIAL_001',
    text: '我不要了可以退嗎？不想買了怎麼辦？可以取消嗎？→ 如果商品尚未從韓國出發且賣家同意，可以取消並扣除韓國國內來回運費後退款。已出貨的商品無法退貨退款。個人原因（不喜歡、尺寸不合等）不接受退貨。',
    metadata: { category: '取消退貨', type: 'colloquial', lang: 'zh-TW' }
  },
  {
    id: 'faq_PAY_COLLOQUIAL_001',
    text: '可以刷卡嗎？怎麼付錢？能用什麼方式付款？→ 支援信用卡（Visa/Mastercard/JCB）、PayPal、ATM虛擬帳號轉帳。BUNJANG商品僅支援信用卡和PayPal。',
    metadata: { category: '付款', type: 'colloquial', lang: 'zh-TW' }
  },
  {
    id: 'faq_FEE_COLLOQUIAL_001',
    text: '運費怎麼算的？寄過來要多少錢？運費貴不貴？→ 國際運費依實際重量或材積重量計算（取較重者）。首0.5kg TWD 165起，每增加0.5kg約TWD 55~75。標示免運的商品達TWD 4,999以上享5kg免運。',
    metadata: { category: '運費', type: 'colloquial', lang: 'zh-TW' }
  },
  {
    id: 'faq_EZWAY_COLLOQUIAL_001',
    text: 'EZ WAY是什麼？為什麼要裝這個？一定要用嗎？→ EZ WAY是台灣海關規定的實名認證APP，進口包裹都需要完成認證才能通關。請先下載並完成實名認證，收到通關通知時點「確認」即可。',
    metadata: { category: 'EZ WAY', type: 'colloquial', lang: 'zh-TW' }
  },
  {
    id: 'faq_DAMAGE_COLLOQUIAL_001',
    text: '東西壞了怎麼辦？收到是壞的？商品有瑕疵？→ 收貨時請務必全程錄製開箱影片（從外箱到內容物都要拍清楚）。7天內將影片和照片提供給客服，我們會協助處理。沒有開箱影片無法處理瑕疵申訴。',
    metadata: { category: '瑕疵', type: 'colloquial', lang: 'zh-TW' }
  },
  {
    id: 'faq_ORDER_COLLOQUIAL_001',
    text: '要怎麼買？怎麼下單？第一次用不太會？→ 在VEASLY網站找到想要的商品，選好規格後加入購物車，填寫收件資訊和付款就完成了。第一次使用建議先完成EZ WAY實名認證。',
    metadata: { category: '下單', type: 'colloquial', lang: 'zh-TW' }
  },
  {
    id: 'faq_BUNJANG_COLLOQUIAL_001',
    text: '番茄醬是什麼？BUNJANG怎麼買？二手的可以買嗎？→ BUNJANG（번개장터/閃電拍賣）是韓國最大的二手交易平台。VEASLY可以幫您代購BUNJANG上的商品，但因為是個人賣家，一旦購買成功後取消與否完全取決於賣家意願。付款僅支援信用卡和PayPal。',
    metadata: { category: 'BUNJANG', type: 'colloquial', lang: 'zh-TW' }
  },
  {
    id: 'faq_POINT_COLLOQUIAL_001',
    text: '點數怎麼用？我有點數可以折抵嗎？點數會過期嗎？→ 點數可以在下單時折抵消費，1點=1TWD。結帳頁面會顯示可使用的點數。點數相關細節請查看會員中心或聯繫客服。',
    metadata: { category: '點數', type: 'colloquial', lang: 'zh-TW' }
  },
  {
    id: 'faq_FREESHIP_COLLOQUIAL_001',
    text: '買多少免運？怎樣才不用付運費？免運門檻是多少？→ 僅限標示「免運」的商品才適用免運優惠。免運商品買滿TWD 4,999享5kg免運、TWD 9,999享10kg免運，每多TWD 5,000多5kg。非免運商品不適用此優惠。',
    metadata: { category: '免運', type: 'colloquial', lang: 'zh-TW' }
  },
  {
    id: 'faq_TAX_COLLOQUIAL_001',
    text: '要繳稅嗎？會被海關扣嗎？關稅怎麼算？→ 單筆進口商品完稅價格超過TWD 2,000就需要繳關稅（約5~10%不等）。VEASLY會盡量合理申報，但最終由海關判定。EZ WAY認證通過後通關會比較順利。',
    metadata: { category: '關稅', type: 'colloquial', lang: 'zh-TW' }
  }
];

(async function() {
  console.log('Initializing AI engine...');
  await ai.initializeAI();
  console.log('Adding ' + colloquialFAQs.length + ' colloquial FAQs...');
  var added = 0;
  for (var i = 0; i < colloquialFAQs.length; i++) {
    var faq = colloquialFAQs[i];
    try {
      await ai.addToKnowledgeBase(faq.id, faq.text, faq.metadata);
      added++;
      console.log('  [' + (i+1) + '/' + colloquialFAQs.length + '] ' + faq.id + ' ✓');
    } catch(e) {
      console.log('  [' + (i+1) + '/' + colloquialFAQs.length + '] ' + faq.id + ' FAIL: ' + e.message);
    }
  }
  console.log('\nDone: ' + added + '/' + colloquialFAQs.length + ' added');

  // 테스트 쿼리
  console.log('\n=== Test queries ===');
  var testQueries = ['東西什麼時候會到', '可以合在一起寄嗎', '我不要了可以退嗎', '運費怎麼算', 'EZ WAY是什麼'];
  for (var t = 0; t < testQueries.length; t++) {
    try {
      var result = await ai.generateAnswer(testQueries[t], 'zh-TW', 'test', []);
      if (result) {
        console.log('Q: ' + testQueries[t]);
        console.log('A: ' + result.answer.substring(0, 100) + '...');
        console.log('Confidence: ' + result.confidence.toFixed(3) + '\n');
      }
    } catch(e) { console.log('Test error:', e.message); }
  }
})();
