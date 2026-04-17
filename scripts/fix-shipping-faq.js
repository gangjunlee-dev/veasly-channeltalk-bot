#!/usr/bin/env node
/**
 * 배송비 FAQ 긴급 수정
 * 1) 기존 잘못된 배송비 벡터 삭제
 * 2) 정확한 배송비 정보 벡터 등록
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ai = require('../lib/ai-engine');

const WRONG_IDS = [
  // 기존에 등록된 배송비 관련 벡터 ID들 (가능한 패턴 모두 커버)
  'faq_SHIP_COLLOQUIAL_001',
  'faq_shipping_fee',
  'faq_shipping_cost',
  'faq_shipping',
  'faq_delivery_fee',
  'faq_international_shipping',
  'faq_운송비',
  'faq_배송비',
  'faq_國際運費'
];

const CORRECT_FAQS = [
  {
    id: 'faq_SHIPPING_FEE_MAIN_001',
    text: `VEASLY 國際運費計算方式：
- 0~1kg：TWD 310（固定費用）
- 沒有0.5kg的計費單位，最小單位是1kg起算TWD 310
- 超過1kg後，每增加1kg費用會依物流費率累加
- 費用以「實際重量」和「體積重量（材積重量）」中較高的為準
- 合併配送（合配）的運費計算方式相同，沒有額外折扣或不同費率
- 沒有最大重量限制
- 離島（外島）沒有額外費用
- 配送時間：從韓國出發後約7~14天（依通關速度而異）
- VEASLY根據合作物流公司的費率透明計算運費，不從中賺取額外利潤
- 結帳時的運費是預估重量計算，到達轉運倉後若實際重量有較大差異，可能會退還差額或額外收取

VEASLY International Shipping Fee:
- 0~1kg: TWD 310 (flat rate)
- No 0.5kg billing unit, minimum is 1kg = TWD 310
- Fee is based on the higher of actual weight vs volumetric weight
- Combined shipping uses the same fee structure
- No maximum weight limit, no surcharge for outlying islands
- Delivery: approximately 7-14 days after departure from Korea (varies by customs clearance speed)
- VEASLY calculates shipping transparently based on partner logistics rates, no markup`
  },
  {
    id: 'faq_SHIPPING_FEE_ZH_TW_002',
    text: `運費怎麼算？國際運費多少？寄到台灣運費多少？
VEASLY的國際運費是 0~1公斤 TWD 310。這是固定費率，以實際重量和材積重量中較重的為計算基準。沒有0.5公斤的計費方式。合併配送的運費計算方式也一樣。配送時間大約韓國出發後7到14天，依照通關速度有所不同。VEASLY不會在運費中賺取額外利潤。`
  },
  {
    id: 'faq_SHIPPING_FEE_ZH_TW_003',
    text: `배송비 얼마예요? 국제배송비 어떻게 계산해요?
VEASLY 국제배송비는 0~1kg TWD 310입니다. 0.5kg 단위 과금은 없습니다. 실제 중량과 부피 중량 중 큰 값을 기준으로 계산합니다. 합배송도 동일한 요금 체계입니다. 한국 출발 후 약 7~14일 소요되며 통관 속도에 따라 다릅니다. VEASLY는 배송비에서 추가 이익을 취하지 않습니다.`
  },
  {
    id: 'faq_SHIPPING_COLLOQUIAL_TW_004',
    text: `寄到台灣要多久？多久會到？什麼時候到？運費貴嗎？
韓國出發後大約7到14天就會到台灣，不過實際到貨時間要看通關速度。運費的話0到1公斤是TWD 310，算是蠻透明合理的價格。`
  },
  {
    id: 'faq_SHIPPING_COLLOQUIAL_TW_005',
    text: `可以合併寄送嗎？合配運費怎麼算？
可以合併配送！合配的運費計算方式和一般訂單一樣，0~1kg是TWD 310，以實際重量和材積重量中較高的為準。合配可以幫你省下多筆訂單各別計算運費的情況喔！`
  },
  {
    id: 'faq_FREE_SHIPPING_006',
    text: `有免運嗎？免運費條件？免國際運費？
VEASLY有「免國際運費專區」，部分團購商品或活動商品會提供免國際運費的優惠。另外VEASLY會不定期舉辦限時免運活動。建議隨時關注VEASLY官網和Instagram (@veasly.official) 的最新活動消息。此外，累積的點數可以折抵現金，等於間接省運費！`
  }
];

async function main() {
  console.log('=== 배송비 FAQ 긴급 수정 시작 ===\n');
  
  // AI 초기화 대기
  await ai.initializeAI();
  console.log('AI 초기화 완료\n');
  
  // 1) 잘못된 벡터 삭제 시도
  console.log('[1단계] 잘못된 배송비 벡터 삭제 시도...');
  try {
    const { Pinecone } = require('@pinecone-database/pinecone');
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const index = pinecone.index(process.env.PINECONE_INDEX || 'veasly-faq');
    
    for (const id of WRONG_IDS) {
      try {
        await index.deleteOne(id);
        console.log('  삭제 시도:', id);
      } catch(e) {
        console.log('  삭제 스킵 (없거나 오류):', id, e.message ? e.message.substring(0, 50) : '');
      }
    }
    console.log('잘못된 벡터 삭제 완료\n');
  } catch(e) {
    console.log('Pinecone 직접 삭제 실패, addToKnowledgeBase로 덮어쓰기 진행:', e.message);
  }
  
  // 2) 정확한 벡터 등록
  console.log('[2단계] 정확한 배송비 FAQ 등록...');
  for (const faq of CORRECT_FAQS) {
    try {
      await ai.addToKnowledgeBase(faq.text, 'shipping', faq.id);
      console.log('  등록 완료:', faq.id);
    } catch(e) {
      console.error('  등록 실패:', faq.id, e.message);
    }
  }
  
  // 3) 테스트
  console.log('\n[3단계] 배송비 질문 테스트...');
  const testQuestions = [
    '運費怎麼算',
    '寄到台灣多少錢',
    '국제배송비 얼마예요',
    '有免運嗎',
    '合配運費'
  ];
  
  for (const q of testQuestions) {
    try {
      const result = await ai.generateAnswer(q, 'zh-TW', []);
      console.log('  Q:', q);
      console.log('  A:', result.answer ? result.answer.substring(0, 100) + '...' : 'N/A');
      console.log('  Confidence:', result.confidence);
      
      // TWD 310이 포함되는지 확인
      if (result.answer && result.answer.includes('310')) {
        console.log('  ✅ TWD 310 정확히 포함');
      } else {
        console.log('  ⚠️ 경고: TWD 310이 답변에 없음! 시스템 프롬프트로 보정 필요');
      }
      console.log('');
    } catch(e) {
      console.log('  테스트 오류:', q, e.message);
    }
  }
  
  console.log('=== 배송비 FAQ 수정 완료 ===');
}

main().catch(console.error);
