/**
 * CS 넘김 "처리 결과 / 한 줄 규칙" 자동 작성. (2026-08-24)
 *
 * 이 필드의 목적(DB 스키마 설명): "해결 시 기록 — 이 경우 직원이 어디까지 처리 가능한지 한 줄
 *   → 3회 반복 시 SOP 승격 원천". 즉 SOP 개선 파이프라인의 입력이다.
 *   실측: 392건 중 빈칸 159 + 자동메모(봇 자동 감지…) 74 = 233건이 비어 있어 파이프라인이 안 돌고 있었다.
 *
 * 설계:
 * - 사람이 쓴 기존 항목이 짧은 한국어 메모("위빙 배송 안됨 전대언 연락함")라 같은 톤·언어를 따른다.
 * - 출력은 JSON 대신 **라인 기반**. (2026-08 classifyHandoff 에서 JSON 파싱이 잘려 깨진 이력이 있어
 *   REASON:/SUMMARY: 방식으로 바꿨고, 여기도 동일 패턴을 쓴다.)
 * - 대화에 근거가 없으면 생성하지 않는다(빈 값 반환) — 없는 처리 내용을 지어내면 SOP 원천이 오염된다.
 */
var llm = require('./llm');

var PLACEHOLDER_RE = /^(봇 자동 감지|직원 넘김|CS넘김|자동 감지|\[봇\]|테스트)/;

/** 기존 값이 비어있거나 자동메모면 덮어써도 되는 값으로 본다(사람이 쓴 건 절대 건드리지 않음) */
function isOverwritable(cur) {
  var v = String(cur || '').trim();
  if (!v) return true;
  if (PLACEHOLDER_RE.test(v)) return true;
  if (v.length < 12) return true;
  return false;
}

/** 채널톡 메시지 배열 → LLM 입력용 대화 텍스트 */
function toConversationText(msgs, maxChars) {
  var lines = (msgs || [])
    .slice()
    .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); })
    .map(function (m) {
      var who = m.personType === 'manager' ? '직원' : (m.personType === 'user' ? '고객' : '봇');
      var t = String(m.plainText || '').replace(/\s+/g, ' ').trim();
      return t ? (who + ': ' + t.slice(0, 300)) : '';
    })
    .filter(Boolean);
  var text = lines.join('\n');
  var cap = maxChars || 6000;
  return text.length > cap ? text.slice(-cap) : text; // 뒷부분(=해결 과정)이 더 중요하므로 끝에서 자름
}

/**
 * @param {Array} msgs 채널톡 메시지 배열
 * @param {Object} meta { reason: 넘김 사유, title: 제목 }
 * @returns {Promise<string>} "처리: … / 규칙: …" 또는 '' (근거 부족)
 */
async function generateResolution(msgs, meta) {
  if (!llm.isEnabled()) return '';
  var convo = toConversationText(msgs);
  if (!convo || convo.length < 40) return '';
  meta = meta || {};
  var prompt =
    'VEASLY(한국→대만 구매대행) CS 넘김 건의 대화 기록이다. 내부 관리용으로 두 가지를 한국어로 짧게 정리해라.\n' +
    '넘김 사유: ' + (meta.reason || '(없음)') + '\n\n' +
    '1) RESULT: 이 건이 실제로 어떻게 처리됐는지 한 줄(40자 이내). 예: "위빙 배송 누락 확인, 재발송 요청함"\n' +
    '2) RULE: 같은 상황이 또 오면 직원이 어디까지 스스로 처리 가능한지 한 줄(50자 이내). 예: "송장 누락은 위빙에 재발송 요청까지 직원 처리 가능"\n\n' +
    '엄격한 규칙:\n' +
    '- 대화에 실제로 나온 내용만 쓴다. 추측·일반론 금지.\n' +
    '- 처리 결과가 대화에서 확인되지 않으면 두 줄 모두 정확히 "확인 불가" 라고만 쓴다.\n' +
    '- 고객 이름·전화·이메일 등 개인정보는 쓰지 않는다. 주문번호는 필요하면 써도 된다.\n' +
    '- 문장 끝 마침표 없이 명사형으로 끝낸다(기존 메모 스타일).\n\n' +
    '대화 기록:\n' + convo + '\n\n' +
    '아래 형식으로 정확히 두 줄만 출력. JSON·따옴표·다른 문장 금지:\n' +
    'RESULT: <한 줄>\n' +
    'RULE: <한 줄>';
  try {
    var res = await llm.generate({ user: prompt, maxTokens: 400 });
    var raw = (res && res.text) || '';
    if (!raw) return '';
    var result = '', rule = '';
    raw.split(/\r?\n/).forEach(function (line) {
      var m1 = line.match(/^\s*RESULT\s*[:：]\s*(.+)$/i);
      var m2 = line.match(/^\s*RULE\s*[:：]\s*(.+)$/i);
      if (m1) result = m1[1].trim();
      if (m2) rule = m2[1].trim();
    });
    if (!result || /^확인\s*불가$/.test(result)) return '';
    var out = '처리: ' + result.slice(0, 80);
    if (rule && !/^확인\s*불가$/.test(rule)) out += ' / 규칙: ' + rule.slice(0, 100);
    return out;
  } catch (e) {
    console.error('[HandoffResolution] 생성 오류:', e.message);
    return '';
  }
}

module.exports = {
  generateResolution: generateResolution,
  isOverwritable: isOverwritable,
  toConversationText: toConversationText,
  PLACEHOLDER_RE: PLACEHOLDER_RE
};
