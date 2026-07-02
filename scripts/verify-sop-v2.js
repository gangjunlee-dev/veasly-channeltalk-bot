/**
 * SOP v2 검증 테스트 (오프라인) — 지시서 §5의 10개 질문 시뮬레이션
 * 실행: node scripts/verify-sop-v2.js
 */
var matcher = require('../lib/matcher');
var routing = require('../lib/routing');

var pass = 0, fail = 0;

function check(no, question, fn) {
  var result = fn();
  if (result.ok) {
    pass++;
    console.log('PASS #' + no + ' ' + question);
  } else {
    fail++;
    console.log('FAIL #' + no + ' ' + question + ' — ' + result.reason);
  }
}

// 라우팅 규칙이 FAQ보다 먼저 평가되므로, 라우팅 대상 여부 먼저 확인
function botAnswer(text) {
  if (routing.isDisputeMessage(text)) return { route: 'dispute', answer: routing.DISPUTE_REPLY };
  if (routing.isDeclaredAmountInquiry(text)) return { route: 'declared', answer: routing.DECLARED_AMOUNT_REPLY };
  var m = matcher.findBestMatch(text);
  if (m) return { route: 'faq', id: m.id, answer: m.answer, escalate: !!m.escalate };
  return { route: 'fallback', answer: '' };
}

// 1. 為什麼我的訂單顯示無法合併？ → 전부 입고돼서. 免運 무관 명시
check(1, '為什麼我的訂單顯示無法合併？', function() {
  var r = botAnswer('為什麼我的訂單顯示無法合併？');
  if (r.route !== 'faq' || r.id !== 'COMBINE_001') return { ok: false, reason: 'matched ' + r.route + '/' + (r.id || '') };
  if (r.answer.indexOf('都已入倉') === -1 && r.answer.indexOf('全部抵達集運倉') === -1) return { ok: false, reason: 'missing 전부 입고 이유' };
  if (r.answer.indexOf('與是否為免運訂單無關') === -1) return { ok: false, reason: 'missing 免運 무관' };
  return { ok: true };
});

// 2. 合併寄送可以超商取貨嗎？ → 불가, 宅配 전용 + 주소 변경 안내
check(2, '合併寄送可以超商取貨嗎？', function() {
  var r = botAnswer('合併寄送可以超商取貨嗎？');
  if (r.route !== 'faq') return { ok: false, reason: 'route=' + r.route };
  if (r.answer.indexOf('一律宅配到府') === -1) return { ok: false, reason: 'missing 宅配 전용' };
  if (r.answer.indexOf('改為宅配地址') === -1) return { ok: false, reason: 'missing 주소 변경 안내' };
  return { ok: true };
});

// 3. 顯示已送達但我沒收到 → 대리수령 확인 → 기록 조회 → 고객 책임·재배송 200 TWD
check(3, '顯示已送達但我沒收到', function() {
  var r = botAnswer('顯示已送達但我沒收到');
  if (r.route !== 'faq' || r.id !== 'DELIVERED_NOT_RECEIVED_001') return { ok: false, reason: 'matched ' + r.route + '/' + (r.id || '') };
  if (r.answer.indexOf('管理室') === -1) return { ok: false, reason: 'missing 대리수령 확인' };
  if (r.answer.indexOf('200 TWD') === -1) return { ok: false, reason: 'missing 200 TWD' };
  if (!r.escalate) return { ok: false, reason: 'escalate flag not set' };
  return { ok: true };
});

// 4. 可以幫我跟賣家議價嗎？ → 불가, 표시가 기준
check(4, '可以幫我跟賣家議價嗎？', function() {
  var r = botAnswer('可以幫我跟賣家議價嗎？');
  if (r.route !== 'faq' || r.id !== 'BUNJANG_001') return { ok: false, reason: 'matched ' + r.route + '/' + (r.id || '') };
  if (r.answer.indexOf('無法代為向賣家議價') === -1) return { ok: false, reason: 'missing 협상 불가' };
  if (r.answer.indexOf('標示價格為準') === -1) return { ok: false, reason: 'missing 표시가 기준' };
  return { ok: true };
});

// 5. 週六會幫我下單購買嗎？ → 견적만, 발주는 익영업일
check(5, '週六會幫我下單購買嗎？', function() {
  var r = botAnswer('週六會幫我下單購買嗎？');
  if (r.route !== 'faq') return { ok: false, reason: 'route=' + r.route };
  if (r.answer.indexOf('僅受理報價') === -1) return { ok: false, reason: 'missing 견적만' };
  if (r.answer.indexOf('下一個營業日') === -1) return { ok: false, reason: 'missing 익영업일' };
  return { ok: true };
});

// 6. 人在國外沒辦法完成 EZWAY → 수취인 변경 or 취소반송(170/件) 2옵션
check(6, '人在國外沒辦法完成 EZWAY', function() {
  var r = botAnswer('人在國外沒辦法完成 EZWAY');
  if (r.route !== 'faq' || r.id !== 'EZWAY_ABROAD_001') return { ok: false, reason: 'matched ' + r.route + '/' + (r.id || '') };
  if (r.answer.indexOf('親友代收') === -1) return { ok: false, reason: 'missing 수취인 변경' };
  if (r.answer.indexOf('170 TWD') === -1) return { ok: false, reason: 'missing 170 TWD' };
  return { ok: true };
});

// 7. 沒收到 EZWAY 通知 → 설치·실명인증·委任管理 확인 + 정상 3~4영업일
check(7, '沒收到 EZWAY 通知', function() {
  var r = botAnswer('沒收到 EZWAY 通知');
  if (r.route !== 'faq' || r.id !== 'EZWAY_NOTIFY_001') return { ok: false, reason: 'matched ' + r.route + '/' + (r.id || '') };
  if (r.answer.indexOf('實名認證') === -1) return { ok: false, reason: 'missing 실명인증' };
  if (r.answer.indexOf('委任管理') === -1) return { ok: false, reason: 'missing 委任管理' };
  if (r.answer.indexOf('3～4 個工作天') === -1 && r.answer.indexOf('3~4 個工作天') === -1) return { ok: false, reason: 'missing 3~4영업일' };
  return { ok: true };
});

// 8. 同一件商品想買 3 個 → 제한·번장 상품 1개 고정 / 일반은 분할+합배송
check(8, '同一件商品想買 3 個', function() {
  var r = botAnswer('同一件商品想買 3 個');
  if (r.route !== 'faq' || r.id !== 'QTY_LIMIT_001') return { ok: false, reason: 'matched ' + r.route + '/' + (r.id || '') };
  if (r.answer.indexOf('僅能購買 1 件') === -1) return { ok: false, reason: 'missing 1개 고정' };
  if (r.answer.indexOf('合併寄送') === -1) return { ok: false, reason: 'missing 분할+합배송' };
  return { ok: true };
});

// 9. 申報金額怎麼比我付的少？ → 설명 없이 "확인 후 회신" + 상담원 연결
check(9, '申報金額怎麼比我付的少？', function() {
  var r = botAnswer('申報金額怎麼比我付的少？');
  if (r.route !== 'declared') return { ok: false, reason: 'route=' + r.route + ' (라우팅 규칙 미적용)' };
  if (r.answer !== routing.DECLARED_AMOUNT_REPLY) return { ok: false, reason: '고정 문구 불일치' };
  return { ok: true };
});

// 9-b. 변형: 報關金額是不是算錯了
check('9b', '報關金額是不是算錯了', function() {
  var r = botAnswer('報關金額是不是算錯了');
  if (r.route !== 'declared') return { ok: false, reason: 'route=' + r.route };
  return { ok: true };
});

// 10. 我要找消保官檢舉你們 → 즉시 상담원 핸드오프, 내용 반박 없음
check(10, '我要找消保官檢舉你們', function() {
  var r = botAnswer('我要找消保官檢舉你們');
  if (r.route !== 'dispute') return { ok: false, reason: 'route=' + r.route };
  if (r.answer !== routing.DISPUTE_REPLY) return { ok: false, reason: '고정 문구 불일치' };
  return { ok: true };
});

// 10-b. 변형: 你們是詐騙嗎 我要提告
check('10b', '你們是詐騙嗎 我要提告', function() {
  var r = botAnswer('你們是詐騙嗎 我要提告');
  if (r.route !== 'dispute') return { ok: false, reason: 'route=' + r.route };
  return { ok: true };
});

// 추가: 회원 탈퇴 → 포인트 소멸 고지 + escalate
check('11', '我要退會', function() {
  var r = botAnswer('我要退會');
  if (r.route !== 'faq' || r.id !== 'WITHDRAW_001') return { ok: false, reason: 'matched ' + r.route + '/' + (r.id || '') };
  if (r.answer.indexOf('點數將會失效') === -1) return { ok: false, reason: 'missing 포인트 소멸 고지' };
  if (!r.escalate) return { ok: false, reason: 'escalate flag not set' };
  return { ok: true };
});

// 추가: FAQ 전체 이모지 검사 (문서 v2 톤 통일)
check('12', 'FAQ 전체 이모지 미사용 검사', function() {
  var faq = require('../data/faq');
  var emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2705}\u{274C}\u{2049}\u{203C}]/u;
  for (var i = 0; i < faq.length; i++) {
    if (emojiRe.test(faq[i].answer)) return { ok: false, reason: faq[i].id + ' 에 이모지 존재' };
  }
  return { ok: true };
});

// 추가: 통관 검사 단계 소요
check('13', '包裹卡在清關多久', function() {
  var r = botAnswer('包裹卡在清關多久');
  if (r.route !== 'faq') return { ok: false, reason: 'route=' + r.route };
  if (r.answer.indexOf('3～4 個工作天') === -1 && r.answer.indexOf('3~4 個工作天') === -1) return { ok: false, reason: 'missing 3~4영업일' };
  return { ok: true };
});

// 추가: 환불 시효 구분 (운임 과다징수 3~7 / 취소 퇴환 7~14)
check('14', '運費多收了什麼時候退款', function() {
  var r = botAnswer('運費多收了什麼時候退款');
  if (r.route !== 'faq') return { ok: false, reason: 'route=' + r.route };
  if (r.answer.indexOf('3~7 個工作天') === -1) return { ok: false, reason: 'missing 3~7영업일 (운임 과다징수)' };
  return { ok: true };
});

console.log('\n결과: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
