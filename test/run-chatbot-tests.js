// 챗봇 회귀 테스트 러너 - 프롬프트/지식베이스 변경 전후 동작 확인용
// 실행: node test/run-chatbot-tests.js   (프로젝트 루트에서)
//
// 이건 "정답 텍스트"를 검사하는 게 아니라, generateAnswer 가 돌려주는
// confidence / grounded / 답변형태로 "추측하지 않고 적절히 처리하는지"만 본다.
// 회귀 감지용 스모크 테스트.
var path = require('path');
var fs = require('fs');
var ai = require(path.join(__dirname, '..', 'lib', 'ai-engine'));

// 근거 없는 "배송/환불 상태 단정" 패턴 - escalate_or_clarify 케이스에서 이게 나오면 추측 위험
var STATUS_ASSERT = /(已出貨|已發貨|配送中|運送中|已送達|已退款|退款完成|已通關|出庫|발송됨|배송\s*중|환불\s*완료|shipped|delivered|refunded|in transit)/;

function evaluate(tc, r) {
  if (tc.expect === 'answer') {
    if (!r || !r.answer) return { pass: false, why: '답변이 없음' };
    if (r.grounded === false) return { pass: false, why: 'grounded=false (검증 실패)' };
    if ((r.confidence || 0) < 0.25) return { pass: false, why: 'confidence<0.25' };
    return { pass: true, why: '정상 답변' };
  }
  // escalate_or_clarify: 근거 없는 "확정 상태" 단정만 FAIL. 안내/명확화요청/정책설명은 PASS.
  // (LLM 답변은 매번 달라지므로 문구 키워드 대신, 실제 위험인 '상태 날조'만 결정론적으로 검사)
  if (!r || !r.answer) return { pass: true, why: '답변 보류 (정상)' };
  if (r.grounded === false) return { pass: true, why: 'grounded=false → 에스컬레이션' };
  if (STATUS_ASSERT.test(r.answer)) return { pass: false, why: '근거 없이 배송/환불 상태를 단정함 (추측 위험)' };
  return { pass: true, why: '상태 단정 없이 안내/명확화로 처리' };
}

(async function() {
  var cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'chatbot-testset.json'), 'utf8'));
  await ai.initializeAI();
  if (!ai.isReady()) { console.error('AI 엔진 초기화 실패 - .env 확인 필요'); process.exit(1); }

  var pass = 0, fail = 0;
  console.log('=== 챗봇 회귀 테스트 (' + cases.length + '건) ===\n');
  for (var i = 0; i < cases.length; i++) {
    var tc = cases[i];
    var r = null;
    try { r = await ai.generateAnswer(tc.q, tc.lang, 'test-' + tc.id, []); }
    catch (e) { r = null; }
    var ev = evaluate(tc, r);
    if (ev.pass) pass++; else fail++;
    console.log((ev.pass ? '  PASS' : 'X FAIL') + ' [' + tc.id + '] expect=' + tc.expect +
      ' | conf=' + (r ? (r.confidence || 0).toFixed(2) : '-') +
      ' grounded=' + (r ? r.grounded : '-') +
      ' intent=' + (r ? r.category : '-') + ' -> ' + ev.why);
  }
  console.log('\n=== 결과: ' + pass + ' PASS / ' + fail + ' FAIL / ' + cases.length + ' 총 ===');
  process.exit(fail > 0 ? 1 : 0);
})();
