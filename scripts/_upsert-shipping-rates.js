require('dotenv').config();
var aiEngine = require('../lib/ai-engine');
var { Pinecone } = require('@pinecone-database/pinecone');

var CHUNKS = [
  {
    id: 'official-shipping-rates-tw-2026-05-light',
    category: 'shipping_rate_table',
    weight_range: '0-5kg',
    text: [
      '【台灣國際運費費率表 — 輕量區間 0~5kg】',
      '',
      '寄送至台灣的國際運費依重量階梯計費。以實際重量與材積重量（長×寬×高 cm ÷ 5000）中較大者為準。',
      '',
      '費率表（TWD）：',
      '- 0~1,000g：TWD 295',
      '- 1,000~1,500g：TWD 405',
      '- 1,500~2,000g：TWD 520',
      '- 2,000~2,500g：TWD 630',
      '- 2,500~3,000g：TWD 740',
      '- 3,000~3,500g：TWD 850',
      '- 3,500~4,000g：TWD 965',
      '- 4,000~4,500g：TWD 1,075',
      '- 4,500~5,000g：TWD 1,315',
      '',
      '注意事項：',
      '- 重量等於區間上限時，適用該區間（例如 2,000g 適用 1,500~2,000g 級距 TWD 520；2,001g 進入下一級距 TWD 630）',
      '- 重量介於兩個區間時，向上取整至下一級距（例如 1,200g 適用 1,000~1,500g 級距 TWD 405）',
      '- 免運活動：購買「免運」標示商品達 TWD 4,999 享 5kg 免運、TWD 9,999 享 10kg 免運、TWD 14,999 享 15kg 免運，以此類推每加 TWD 5,000 多 5kg',
      '- 實際應付金額以結帳頁面為準'
    ].join('\n')
  },
  {
    id: 'official-shipping-rates-tw-2026-05-medium',
    category: 'shipping_rate_table',
    weight_range: '5-25kg',
    text: [
      '【台灣國際運費費率表 — 中量區間 5~25kg】',
      '',
      '寄送至台灣的國際運費依重量階梯計費。以實際重量與材積重量（長×寬×高 cm ÷ 5000）中較大者為準。',
      '',
      '費率表（TWD）：',
      '- 5,000~6,000g：TWD 1,570',
      '- 6,000~7,000g：TWD 1,825',
      '- 7,000~8,000g：TWD 2,080',
      '- 8,000~9,000g：TWD 2,335',
      '- 9,000~10,000g：TWD 2,590',
      '- 10,000~11,000g：TWD 2,845',
      '- 11,000~12,000g：TWD 3,100',
      '- 12,000~13,000g：TWD 3,355',
      '- 13,000~14,000g：TWD 3,610',
      '- 14,000~15,000g：TWD 3,865',
      '- 15,000~16,000g：TWD 4,120',
      '- 16,000~17,000g：TWD 4,380',
      '- 17,000~18,000g：TWD 4,635',
      '- 18,000~19,000g：TWD 4,890',
      '- 19,000~20,000g：TWD 5,145',
      '- 20,000~21,000g：TWD 5,400',
      '- 21,000~22,000g：TWD 5,655',
      '- 22,000~23,000g：TWD 5,910',
      '- 23,000~24,000g：TWD 6,165',
      '- 24,000~25,000g：TWD 6,420',
      '',
      '注意事項：',
      '- 重量等於區間上限時，適用該區間（例如 10,000g 適用 9,000~10,000g 級距 TWD 2,590；10,001g 進入下一級距 TWD 2,845）',
      '- 重量介於兩個區間時，向上取整至下一級距（例如 10.5kg 適用 10,000~11,000g 級距 TWD 2,845）',
      '- 免運活動：購買「免運」標示商品達 TWD 4,999 享 5kg 免運、TWD 9,999 享 10kg 免運、TWD 14,999 享 15kg 免運，以此類推每加 TWD 5,000 多 5kg',
      '- 實際應付金額以結帳頁面為準'
    ].join('\n')
  },
  {
    id: 'official-shipping-rates-tw-2026-05-heavy',
    category: 'shipping_rate_table',
    weight_range: '25-50kg',
    text: [
      '【台灣國際運費費率表 — 重量區間 25~50kg】',
      '',
      '寄送至台灣的國際運費依重量階梯計費。25kg 以上的商品請先洽客服確認最終運費。',
      '',
      '費率表（TWD）：',
      '- 25,000~26,000g：TWD 6,675',
      '- 26,000~27,000g：TWD 6,930',
      '- 27,000~28,000g：TWD 7,185',
      '- 28,000~29,000g：TWD 7,440',
      '- 29,000~30,000g：TWD 7,695',
      '- 30,000~31,000g：TWD 7,950',
      '- 31,000~32,000g：TWD 8,205',
      '- 32,000~33,000g：TWD 8,460',
      '- 33,000~34,000g：TWD 8,720',
      '- 34,000~35,000g：TWD 8,975',
      '- 35,000~36,000g：TWD 9,230',
      '- 36,000~37,000g：TWD 9,485',
      '- 37,000~38,000g：TWD 9,740',
      '- 38,000~39,000g：TWD 9,995',
      '- 39,000~40,000g：TWD 10,250',
      '- 40,000~41,000g：TWD 10,505',
      '- 41,000~42,000g：TWD 10,760',
      '- 42,000~43,000g：TWD 11,015',
      '- 43,000~44,000g：TWD 11,270',
      '- 44,000~45,000g：TWD 11,525',
      '- 45,000~46,000g：TWD 11,780',
      '- 46,000~47,000g：TWD 12,035',
      '- 47,000~48,000g：TWD 12,290',
      '- 48,000~49,000g：TWD 12,545',
      '- 49,000~50,000g：TWD 12,800',
      '',
      '注意事項：',
      '- 大型商品（如長羽絨、家具等）運費可能依包裝箱尺寸計算，而非重量',
      '- 25kg 以上商品，建議下單前先洽客服確認最終運費以避免落差',
      '- 實際應付金額以結帳頁面為準'
    ].join('\n')
  },
  {
    id: 'official-shipping-rates-tw-2026-05-extra',
    category: 'shipping_rate_table',
    weight_range: '50-100kg',
    text: [
      '【台灣國際運費費率表 — 高重量區間 50~100kg】',
      '',
      '50kg 以上的商品建議先洽客服取得正式報價，並確認是否屬於可代購範圍。以實際重量與材積重量中較大者為準。',
      '',
      '費率表（TWD，每 1,000g 級距）：',
      '- 50~55kg：TWD 13,060~14,080（每 1kg 約 +TWD 255）',
      '- 55~60kg：TWD 14,335~15,355',
      '- 60~65kg：TWD 15,610~16,630',
      '- 65~70kg：TWD 16,885~17,910',
      '- 70~75kg：TWD 18,165~19,185',
      '- 75~80kg：TWD 19,440~20,460',
      '- 80~85kg：TWD 20,715~21,740',
      '- 85~90kg：TWD 21,995~23,015',
      '- 90~95kg：TWD 23,270~24,290',
      '- 95~100kg：TWD 24,545~25,570',
      '',
      '精確值（以 1kg 為單位）：',
      '- 50,000~51,000g：TWD 13,060',
      '- 60,000~61,000g：TWD 15,610',
      '- 70,000~71,000g：TWD 18,165',
      '- 80,000~81,000g：TWD 20,715',
      '- 90,000~91,000g：TWD 23,270',
      '- 99,000~100,000g：TWD 25,570',
      '',
      '注意事項：',
      '- 50kg 以上請先聯繫客服取得正式運費報價',
      '- 大型/特殊包裝商品運費可能依包裝箱尺寸計算',
      '- 部分大宗商品可能無法寄送，請先確認',
      '- 實際應付金額以結帳頁面為準'
    ].join('\n')
  }
];

(async () => {
  await aiEngine.initializeAI();
  if (!aiEngine.isReady()) { console.error('AI not ready'); process.exit(2); }
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME || 'veasly-cs');
  var idx = pc.index({ host: desc.host });

  var pre = await idx.describeIndexStats();
  console.log('PRE faq count:', (pre.namespaces && pre.namespaces.faq && pre.namespaces.faq.recordCount) || 0);

  for (var i = 0; i < CHUNKS.length; i++) {
    var c = CHUNKS[i];
    console.log('Embedding chunk:', c.id, '(text len:', c.text.length, ')');
    var meta = {
      text: c.text,
      source: 'official-doc-20260527',
      category: c.category,
      weight_range: c.weight_range,
      lang: 'zh-TW',
      version: '2026-05',
      namespace: 'faq'
    };
    // Retry on 502
    var ok = false;
    for (var attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        await aiEngine.addToKnowledgeBase(c.id, c.text, meta);
        ok = true;
      } catch (e) {
        console.error('  Attempt ' + attempt + ' failed:', e.message);
        if (attempt < 3) await new Promise(function(r){setTimeout(r, 2000 * attempt);});
      }
    }
    if (!ok) { console.error('FAILED:', c.id); process.exit(3); }
  }

  await new Promise(function(r){ setTimeout(r, 3000); });
  var post = await idx.describeIndexStats();
  console.log('POST faq count:', (post.namespaces && post.namespaces.faq && post.namespaces.faq.recordCount) || 0);
  console.log('Done.');
})().catch(function(e){ console.error('ERR:', e.message); process.exit(1); });
