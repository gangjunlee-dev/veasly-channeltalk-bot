/**
 * SOP v2 공식 지식 Pinecone 업서트 (2026-07-02)
 * 실행: node scripts/upsert-sop-v2.js  (서버에서 .env 로드 후)
 * source: official-policy-sop-v2 → ai-engine의 _sourceBoost(+0.05) 적용 대상
 */
var path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
var aiEngine = require('../lib/ai-engine');

var ITEMS = [
  {
    id: 'sop-v2-combine-conditions',
    text: '合併寄送申請條件：只要要合併的訂單中有任一筆尚未抵達集運倉，即可申請合併寄送，並依訂單合計金額重新計算免運額度（例：5,000＋5,000 → 10kg 免運）。訂單全部抵達集運倉後即無法申請，與是否為免運訂單無關。已被拒絕過的組合無法再次申請。未合併的訂單會分別從韓國寄出。想在合併申請中追加訂單時：請先取消原合併申請，再將要合併的訂單一起重新申請（其中任一筆尚未入倉即可）。'
  },
  {
    id: 'sop-v2-combine-home-delivery',
    text: '合併寄送配送方式：合併寄送一律宅配到府；原本選擇超商取貨的訂單，申請合併時需改為宅配地址。合併寄送不能使用超商取貨。'
  },
  {
    id: 'sop-v2-delivered-not-received',
    text: '物流顯示已送達但未收到包裹的處理：請先確認是否由管理室、家人或鄰居代收；若都沒有，請提供訂單編號，我們會協助調閱配送紀錄。依規定，物流顯示已送達後的未領取需由收件人負責；若需要重新安排配送，將收取 200 TWD 重配費用。'
  },
  {
    id: 'sop-v2-customs-check-duration',
    text: '通關前置檢查階段所需時間：訂單狀態「檢查商品／確認EZWAY」為清關前置檢查階段，正常約需 3～4 個工作天，有更新會立刻通知客戶。'
  },
  {
    id: 'sop-v2-ezway-no-notification',
    text: '沒收到 EZWAY 申報通知的處理：請先確認已安裝 EZWAY App 並完成實名認證（未完成認證就不會收到通知），也可以打開 App 的「委任管理」查看是否有待辦申報。抵台後的申報通知正常約需 3～4 個工作天；若超過仍沒有，由客服向物流端確認申報進度。'
  },
  {
    id: 'sop-v2-ezway-abroad',
    text: '客戶人在國外無法完成 EZWAY 委任時的兩個選項：1) 改由在台灣的親友代收（變更收件人資料）；2) 選擇取消退回，每件商品收取 170 TWD 處理費。請客戶告知想採用的方式。'
  },
  {
    id: 'sop-v2-bunjang-three-rules',
    text: '閃電拍賣（BUNJANG）三規則：1) 議價：無法代為向賣家議價，商品以賣場標示價格為準。2) 週末與韓國國定假日期間僅受理報價，代購下單會在下一個營業日依序處理；二手商品數量有限，若期間售出敬請見諒。3) 賣家要求直接聯絡時：請透過客服轉達，我們會代客戶與賣家聯絡確認；未來將推出讓客戶直接與賣家溝通的功能。'
  },
  {
    id: 'sop-v2-quantity-limit',
    text: '同一商品數量限制：有購買限制的商品與閃電拍賣（二手）商品僅能購買 1 件；一般商品若需要多件，可以分次下單後申請合併寄送。'
  },
  {
    id: 'sop-v2-return-exchange',
    text: '退換貨政策（範圍擴大版）：適用於商品瑕疵、寄錯、配送中破損或數量短少，請於收到商品後 7 天內聯絡客服。必須提供在拆封前就開始的全程連續錄影（未拆封外箱 → 物流標籤 → 拆封過程 → 商品本體 → 瑕疵部位），這是判斷責任歸屬的必要依據，缺少完整連續影片可能會影響退換貨處理。'
  },
  {
    id: 'sop-v2-membership-withdrawal',
    text: '會員退會處理：收到退會申請後轉交專人處理。必須事先告知：退會後帳戶剩餘的點數將會失效、無法退還，請客戶確認要繼續再回覆。實際退會處理由客服人員進行。'
  },
  {
    id: 'sop-v2-payment-methods',
    text: 'VEASLY 付款方式僅 3 種：信用卡（TapPay）、PayPal、轉帳（虛擬帳號）。BUNJANG 商品不支援轉帳。'
  },
  {
    id: 'sop-v2-refund-timelines',
    text: '退款時效區分（不可混用）：運費溢收（多收）退款 = 收到商品後約 3~7 個工作天；取消／退回的退刷 = 約 7~14 個工作天退回原付款方式。信用卡依銀行作業可能多 1~2 個帳單週期。'
  },
  {
    id: 'sop-v2-170-twd-processing-fee',
    text: '170 TWD 處理費適用規則：僅適用於買家原因（變心、選錯規格等）的取消退回，每件商品收取 170 TWD。商品瑕疵、寄錯、配送破損、安心交易被拒、運費溢收 → 全額退款，不收取處理費。'
  },
  {
    id: 'sop-v2-shipping-weight-policy',
    text: '國際運費計算：以實際重量與材積重量（長×寬×高 cm ÷ 5000）中較大者為準。免運：訂單金額每滿 TWD 5,000 享 5kg 免運額度。超過免運額度的部分依超額重量表（從 0 開始）計算收費。不提供秤重照片，僅提供包裝箱尺寸供客戶確認。'
  },
  {
    id: 'sop-v2-cancellation-timing',
    text: '取消時點規則：僅在賣家發注（下單購買）前可保證取消；賣家已出貨、國際運單開立後，取消、變更地址、追加商品全部不可。'
  }
];

(async function() {
  console.log('=== SOP v2 official knowledge upsert start ===');
  await aiEngine.initializeAI();
  if (!aiEngine.isReady()) { console.error('AI engine not ready - check .env'); process.exit(1); }
  var ok = 0, ng = 0;
  for (var i = 0; i < ITEMS.length; i++) {
    try {
      await aiEngine.addToKnowledgeBase(ITEMS[i].id, ITEMS[i].text, {
        namespace: 'faq',
        category: 'policy',
        lang: 'zh-TW',
        source: 'official-policy-sop-v2-20260702'
      });
      ok++;
      console.log((i + 1) + '/' + ITEMS.length + ' OK ' + ITEMS[i].id);
    } catch (e) {
      ng++;
      console.log((i + 1) + '/' + ITEMS.length + ' FAIL ' + ITEMS[i].id + ': ' + e.message);
    }
    if (i < ITEMS.length - 1) await new Promise(function(r) { setTimeout(r, 500); });
  }
  console.log('\n=== Done: ' + ok + ' ok, ' + ng + ' fail ===');
  process.exit(ng > 0 ? 1 : 0);
})();
