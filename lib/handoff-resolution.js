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

// ═══════════════════════════════════════════════════════════════════
// [2026-08-24] 일일 스윕 + 주간 SOP 승격 리포트
//   handoffTriage 는 '해결' 판정 건만 작성하므로, 상태와 무관하게 빈칸으로 남는 행이 계속 생긴다.
//   (백필 후 잔여 73건 = 근거부족 스킵 72 + 조회실패 1). 매일 소량 스윕으로 메꾼다.
//   근거부족 건은 재시도 원장(7일 백오프)으로 매일 같은 행에 LLM 을 낭비하지 않게 한다.
// ═══════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var axios = require('axios');
var SKIP_FILE = path.join(__dirname, '..', 'data', 'resolution-skip.json');
var SKIP_BACKOFF_MS = 7 * 86400 * 1000;
var HANDOFF_DB = process.env.NOTION_CS_HANDOFF_DB || '41f0db07e5104a67bb0bbcfb20471250';

function _loadSkip() { try { return JSON.parse(fs.readFileSync(SKIP_FILE, 'utf8')); } catch (e) { return {}; } }
function _saveSkip(o) { try { fs.writeFileSync(SKIP_FILE, JSON.stringify(o), 'utf8'); } catch (e) {} }
function _nh() { return { headers: { Authorization: 'Bearer ' + process.env.NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, timeout: 20000 }; }
function _ch() { return { headers: { 'x-access-key': process.env.CHANNEL_ACCESS_KEY, 'x-access-secret': process.env.CHANNEL_ACCESS_SECRET }, timeout: 20000, validateStatus: function () { return true; } }; }
function _zzz(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function _rt(p, n) { try { return (p.properties[n].rich_text || []).map(function (t) { return t.plain_text; }).join('').trim(); } catch (e) { return ''; } }
function _sel(p, n) { try { return p.properties[n].select.name; } catch (e) { return ''; } }

async function _queryAll() {
  var all = [], cursor;
  do {
    var b = { page_size: 100 }; if (cursor) b.start_cursor = cursor;
    var r = await axios.post('https://api.notion.com/v1/databases/' + HANDOFF_DB + '/query', b, _nh());
    all = all.concat(r.data.results); cursor = r.data.has_more ? r.data.next_cursor : null;
  } while (cursor && all.length < 1000);
  return all;
}

/** 빈칸·자동메모 행을 limit 건까지 채운다. @returns {written, skipped, remaining} */
async function sweep(o) {
  o = o || {};
  var limit = o.limit || 20;
  if (!process.env.NOTION_TOKEN || !llm.isEnabled()) return null;
  var all = await _queryAll();
  var skip = _loadSkip();
  var now = Date.now();
  var targets = all.filter(function (p) {
    if (!isOverwritable(_rt(p, '처리 결과 / 한 줄 규칙'))) return false;
    if (skip[p.id] && (now - skip[p.id]) < SKIP_BACKOFF_MS) return false; // 최근 근거부족 → 백오프
    return true;
  });
  var written = 0, skipped = 0, done = 0;
  for (var i = 0; i < targets.length && done < limit; i++) {
    var p = targets[i];
    var link = ''; try { link = p.properties['채널톡 링크'].url || ''; } catch (e) {}
    var chatId = (link.match(/user_chats\/([a-z0-9]+)/i) || [])[1] || '';
    if (!chatId) { skip[p.id] = now; skipped++; continue; }
    var mr = await axios.get('https://api.channel.io/open/v5/user-chats/' + chatId + '/messages?limit=60&sortOrder=desc', _ch());
    done++;
    if (mr.status >= 400) { skip[p.id] = now; skipped++; await _zzz(150); continue; }
    var line = await generateResolution(mr.data.messages || [], { reason: _sel(p, '넘김 사유') });
    if (!line) { skip[p.id] = now; skipped++; await _zzz(200); continue; }
    try {
      await axios.patch('https://api.notion.com/v1/pages/' + p.id, { properties: { '처리 결과 / 한 줄 규칙': { rich_text: [{ text: { content: line.slice(0, 1900) } }] } } }, _nh());
      written++;
      delete skip[p.id];
    } catch (e) { skip[p.id] = now; skipped++; }
    await _zzz(350);
  }
  _saveSkip(skip);
  console.log('[ResolutionSweep] 작성 ' + written + ' | 근거부족·실패 ' + skipped + ' | 남은 대상 ' + Math.max(0, targets.length - done));
  return { written: written, skipped: skipped, remaining: Math.max(0, targets.length - done) };
}

/**
 * 주간 SOP 승격 후보 — 누적된 「규칙:」들을 LLM 1콜로 주제별 묶어 3건 이상 반복되는 것만 뽑는다.
 * 자유 텍스트라 문자열 완전일치로는 절대 안 묶이므로(=원래 설계가 죽어 있던 이유) 의미 기준으로 묶는다.
 */
async function sopCandidates() {
  if (!process.env.NOTION_TOKEN || !llm.isEnabled()) return null;
  var all = await _queryAll();
  var rules = [];
  all.forEach(function (p) {
    var v = _rt(p, '처리 결과 / 한 줄 규칙');
    var m = v.match(/규칙:\s*(.+)$/);
    if (m) rules.push('[' + (_sel(p, '넘김 사유') || '기타') + '] ' + m[1].trim());
  });
  if (rules.length < 5) return { total: rules.length, text: null };
  var sample = rules.slice(-300); // 최근 것 우선
  var NL = String.fromCharCode(10);
  var prompt = [
    'VEASLY CS 넘김 기록에서 뽑은 「직원 처리 가능 범위」 규칙 목록이다. 의미가 같은 것끼리 묶어서,',
    '3건 이상 반복되는 주제만 SOP 승격 후보로 골라라.',
    '',
    '각 후보는 아래 3줄로:',
    'CANDIDATE: <주제 한 줄>',
    'COUNT: <묶인 건수>',
    'RULE: <SOP 에 넣을 한 줄 규칙(직원이 어디까지 처리 가능한지)>',
    '',
    '최대 6개. 3건 미만 주제는 버린다. 목록에 없는 내용을 만들지 않는다.',
    '',
    '규칙 목록:',
    sample.join(NL)
  ].join(NL);
  try {
    var res = await llm.generate({ user: prompt, maxTokens: 1200 });
    return { total: rules.length, text: (res && res.text) ? res.text.trim() : null };
  } catch (e) { console.error('[SOPCandidates] 오류:', e.message); return { total: rules.length, text: null }; }
}

module.exports.sweep = sweep;
module.exports.sopCandidates = sopCandidates;
