/**
 * 노션 "🚨 CS 넘김 (직원 처리 불가)" DB 자동적재 (2026-07-04)
 * - NOTION_TOKEN 없으면 조용히 no-op (봇 CS 흐름을 절대 막지 않음)
 * - 노션 오류는 삼켜서 로그만 남김 (best-effort)
 * 준비: notion.so integration 생성 → 해당 DB에 Connections 추가 → .env NOTION_TOKEN=ntn_...
 */
var axios = require('axios');

var NOTION_TOKEN = process.env.NOTION_TOKEN || '';
var DB_ID = process.env.NOTION_CS_HANDOFF_DB || '41f0db07e5104a67bb0bbcfb20471250';
// 채널톡 데스크 상담 링크 베이스 (예: https://desk.channel.io/#/channels/<channelId>/user_chats/)
var DESK_BASE = process.env.CHANNELTALK_DESK_BASE || '';

// 노션 select 옵션과 1:1 (채널톡 태그 = SOP 넘김 기준)
var VALID_REASONS = ['한국어 분쟁(셀러)', '정책 예외', '재무·환불(15일 규칙)', '통관·물류·브랜드 분쟁', '시스템 오류', '기타'];

// 직원이 팀챗에 치는 짧은 코드 → 노션 사유 매핑 (숫자·中文·한국어 모두 허용)
var REASON_CODE = {
  // 1) 한국어 분쟁(셀러)
  '1': '한국어 분쟁(셀러)', '賣家': '한국어 분쟁(셀러)', '賣家糾紛': '한국어 분쟁(셀러)', '糾紛': '한국어 분쟁(셀러)', '분쟁': '한국어 분쟁(셀러)',
  // 2) 정책 예외
  '2': '정책 예외', '政策': '정책 예외', '政策例外': '정책 예외', '정책': '정책 예외',
  // 3) 재무·환불(15일 규칙)
  '3': '재무·환불(15일 규칙)', '財務': '재무·환불(15일 규칙)', '退款': '재무·환불(15일 규칙)', '財務退款': '재무·환불(15일 규칙)', '재무': '재무·환불(15일 규칙)',
  // 4) 통관·물류·브랜드 분쟁
  '4': '통관·물류·브랜드 분쟁', '通關': '통관·물류·브랜드 분쟁', '物流': '통관·물류·브랜드 분쟁', '通關物流': '통관·물류·브랜드 분쟁', '통관': '통관·물류·브랜드 분쟁',
  // 5) 시스템 오류
  '5': '시스템 오류', '系統': '시스템 오류', '系統錯誤': '시스템 오류', '系统': '시스템 오류', '시스템': '시스템 오류',
  // 6) 기타
  '6': '기타', '其他': '기타', '其它': '기타', '기타': '기타'
};

// 채널톡 매니저 이메일 → 노션 사용자 ID.
// PAT 토큰은 /v1/users 조회가 막혀 있어(restricted_resource) 런타임 매핑 불가 →
// 노션 멤버에서 1회 수확해 하드코딩. 신규 직원 추가 시 여기에 한 줄 추가.
var NOTION_USER_BY_EMAIL = {
  'gangjun.lee@newndy.com': 'acf1e5e9-449e-47fb-9b9f-0d60263cd88f', // 강준
  'mia@newndy.com':         '2fbd872b-594c-81c6-84c8-0002e978e1ff', // MIA
  'vida890515@newndy.com':  '38ad872b-594c-813d-ad9c-00027e3ce237', // 우선
  'ashley0630@newndy.com':  '1cad872b-594c-812b-a207-00020251953a',
  'hb.pyo@newndy.com':      '46f9fbf7-a2b7-4d36-9354-a56cb860dbb0',
  'mg.song@newndy.com':     '9ec2550f-8a0b-4705-a398-8ec56aa325f9'
};

function notionUserId(email) {
  if (!email) return null;
  return NOTION_USER_BY_EMAIL[String(email).trim().toLowerCase()] || null;
}

function resolveReason(input) {
  if (!input) return '기타';
  var s = String(input).trim();
  if (REASON_CODE[s]) return REASON_CODE[s];
  if (VALID_REASONS.indexOf(s) !== -1) return s;
  return '기타';
}

function isEnabled() { return !!NOTION_TOKEN; }

function kstDateStr() {
  var d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

function deskLink(channelId, chatId) {
  if (DESK_BASE) return DESK_BASE.replace(/\/$/, '') + '/' + chatId;
  if (channelId && chatId) return 'https://desk.channel.io/#/channels/' + channelId + '/user_chats/' + chatId;
  return '';
}

/**
 * @param {Object} o { reason, title, orderNo, chatLink, memo }
 *   reason: 짧은 코드('재무') 또는 전체 사유명. 없으면 '기타'
 */
async function createHandoffEntry(o) {
  o = o || {};
  if (!NOTION_TOKEN) { console.log('[Notion] skip (NOTION_TOKEN 미설정)'); return null; }
  var reason = resolveReason(o.reason);
  var props = {};
  props['제목'] = { title: [{ text: { content: (o.title || 'CS 넘김').slice(0, 200) } }] };
  props['넘김 사유'] = { select: { name: reason } };
  props['상태'] = { select: { name: '신규' } };
  props['발생일'] = { date: { start: kstDateStr() } };
  if (o.orderNo) props['주문번호'] = { rich_text: [{ text: { content: String(o.orderNo).slice(0, 100) } }] };
  if (o.chatLink) props['채널톡 링크'] = { url: o.chatLink };
  if (o.memo) props['처리 결과 / 한 줄 규칙'] = { rich_text: [{ text: { content: String(o.memo).slice(0, 1900) } }] };
  // 넘긴 사람(person): 채널톡 매니저 이메일 → 노션 사용자 ID 매핑되면 자동 세팅
  var _escId = o.escalatorUserId || notionUserId(o.escalatorEmail);
  if (_escId) props['넘긴 사람'] = { people: [{ object: 'user', id: _escId }] };
  // 담당자(person): 모든 넘김 건의 담당자는 강준 (env NOTION_ASSIGNEE_EMAIL로 재정의 가능)
  var _assigneeId = o.assigneeUserId || notionUserId(process.env.NOTION_ASSIGNEE_EMAIL || 'gangjun.lee@newndy.com');
  if (_assigneeId) props['담당자'] = { people: [{ object: 'user', id: _assigneeId }] };
  // 본문: AI 상황 요약 (제목 클릭 시 페이지 안에 표시)
  var children = [];
  if (o.bodyText) {
    children.push({ object: 'block', type: 'callout', callout: {
      icon: { emoji: '🤖' },
      rich_text: [{ text: { content: 'AI 상황 요약\n' + String(o.bodyText).slice(0, 1900) } }]
    }});
  }
  var body = { parent: { database_id: DB_ID }, properties: props };
  if (children.length) body.children = children;
  try {
    var res = await axios.post('https://api.notion.com/v1/pages', body,
      { headers: { 'Authorization': 'Bearer ' + NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, timeout: 10000 });
    console.log('[Notion] 넘김 적재 OK:', (res.data && res.data.id) || '?', '| 사유:', reason);
    return res.data;
  } catch (e) {
    console.error('[Notion] 적재 실패:', e.response ? JSON.stringify(e.response.data).slice(0, 300) : e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// [2026-08-24] 고객 약속 추적 — DB "📌 고객 약속 추적" (CS 職員專區 하위)
// 약속(확인 후 회신 등)이 말해진 순간 자동 기록 → 매 영업일 아침 미이행 건 슬랙 독촉.
// Kim James 사례(약속이 기록 없이 증발, 20일 방치)의 재발 방지 장치. best-effort(실패해도 CS 무영향).
// ═══════════════════════════════════════════════════════════════════
var PROMISE_DB = process.env.NOTION_PROMISE_DB || '2d5dd49f0db04e0e8eac3be9928e200f';
var bizHoursP = require('./business-hours');

function _nh() { return { headers: { 'Authorization': 'Bearer ' + NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, timeout: 10000 }; }

// 기한 기본값(강준 결정: 당일 마감): 영업시간 중 약속 → 당일 KST 19:00(台灣 18:00),
// 오프타임 약속 → 다음 영업일 19:00. 노션에서 건별 조정 가능.
function defaultDueIso() {
  var now = Date.now();
  var base = bizHoursP.isBusinessHours(now) ? now : bizHoursP.getNextBusinessStart(now);
  var kst = new Date(base + 9 * 3600 * 1000);
  var due = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 19, 0, 0) - 9 * 3600 * 1000;
  if (due <= now) { // 18:59 약속 등 경계 → 다음 영업일 19:00
    var nb = new Date(bizHoursP.getNextBusinessStart(due + 3600 * 1000) + 9 * 3600 * 1000);
    due = Date.UTC(nb.getUTCFullYear(), nb.getUTCMonth(), nb.getUTCDate(), 19, 0, 0) - 9 * 3600 * 1000;
  }
  return new Date(due).toISOString();
}

// chatId의 열린(대기중) 약속 1건 조회 → {id, reinquiry, url} | null
async function findOpenPromise(chatId) {
  if (!NOTION_TOKEN || !chatId) return null;
  try {
    var res = await axios.post('https://api.notion.com/v1/databases/' + PROMISE_DB + '/query', {
      filter: { and: [
        { property: 'chatId', rich_text: { equals: String(chatId) } },
        { property: '상태', select: { equals: '대기중' } }
      ] }, page_size: 1 }, _nh());
    var row = (res.data.results || [])[0];
    if (!row) return null;
    var re = 0; try { re = row.properties['재문의'].number || 0; } catch (e) {}
    return { id: row.id, reinquiry: re, url: row.url };
  } catch (e) { console.error('[Notion][promise] find 실패:', e.response ? e.response.status : e.message); return null; }
}

// 약속 등록. 같은 상담에 열린 약속이 있으면 새로 만들지 않고 기한만 오늘 기준으로 갱신(dedup).
// o: { chatId, channelId, customer, text, source('매니저 약속'|'봇 약속'|'재문의'|'수동'), managerEmail }
async function createPromise(o) {
  o = o || {};
  if (!NOTION_TOKEN || !o.chatId) return null;
  try {
    var existing = await findOpenPromise(o.chatId);
    if (existing) {
      await axios.patch('https://api.notion.com/v1/pages/' + existing.id,
        { properties: { '기한': { date: { start: o.dueIso || defaultDueIso() } } } }, _nh());
      console.log('[Notion][promise] 기존 약속 기한 갱신:', o.chatId);
      return existing;
    }
    var props = {
      '제목': { title: [{ text: { content: ((o.customer || '상담 ' + String(o.chatId).slice(-6)) + ' — ' + (o.text || '약속')).slice(0, 120) } }] },
      '상태': { select: { name: '대기중' } },
      '기한': { date: { start: o.dueIso || defaultDueIso() } }, // dueIso 지정 시 즉시 기한 등 강제 가능
      '출처': { select: { name: o.source || '수동' } },
      '재문의': { number: 0 },
      'chatId': { rich_text: [{ text: { content: String(o.chatId) } }] }
    };
    if (o.customer) props['고객'] = { rich_text: [{ text: { content: String(o.customer).slice(0, 100) } }] };
    if (o.text) props['약속 내용'] = { rich_text: [{ text: { content: String(o.text).slice(0, 1900) } }] };
    var link = deskLink(o.channelId, o.chatId);
    if (link) props['상담 링크'] = { url: link };
    var owner = notionUserId(o.managerEmail) || notionUserId(process.env.NOTION_ASSIGNEE_EMAIL || 'gangjun.lee@newndy.com');
    if (owner) props['담당자'] = { people: [{ object: 'user', id: owner }] };
    var res = await axios.post('https://api.notion.com/v1/pages', { parent: { database_id: PROMISE_DB }, properties: props }, _nh());
    console.log('[Notion][promise] 약속 등록:', o.chatId, '|', String(o.text || '').slice(0, 40));
    return { id: res.data.id, reinquiry: 0, url: res.data.url };
  } catch (e) { console.error('[Notion][promise] 등록 실패:', e.response ? JSON.stringify(e.response.data).slice(0, 200) : e.message); return null; }
}

// 고객 재문의: 재문의 +1, 기한 즉시 도래(다음 아침 알림에 무조건 포함). 열린 약속 없으면 null.
async function bumpPromiseReinquiry(chatId) {
  var p = await findOpenPromise(chatId);
  if (!p) return null;
  try {
    await axios.patch('https://api.notion.com/v1/pages/' + p.id, { properties: {
      '재문의': { number: (p.reinquiry || 0) + 1 },
      '기한': { date: { start: new Date().toISOString() } }
    } }, _nh());
    console.log('[Notion][promise] 재문의 +1:', chatId);
    return p;
  } catch (e) { return null; }
}

// 완료 처리(팀챗 /완료). 열린 약속 없으면 false.
async function completePromise(chatId) {
  var p = await findOpenPromise(chatId);
  if (!p) return false;
  try {
    await axios.patch('https://api.notion.com/v1/pages/' + p.id, { properties: { '상태': { select: { name: '완료' } } } }, _nh());
    console.log('[Notion][promise] 완료 처리:', chatId);
    return true;
  } catch (e) { return false; }
}

// 기한 지난 대기중 약속 목록 (아침 독촉용)
async function listOverduePromises() {
  if (!NOTION_TOKEN) return [];
  try {
    var res = await axios.post('https://api.notion.com/v1/databases/' + PROMISE_DB + '/query', {
      filter: { and: [
        { property: '상태', select: { equals: '대기중' } },
        { property: '기한', date: { on_or_before: new Date().toISOString() } }
      ] }, page_size: 50 }, _nh());
    return (res.data.results || []).map(function (r) {
      var P = r.properties || {};
      function rt(name) { try { return (P[name].rich_text || []).map(function (t) { return t.plain_text; }).join(''); } catch (e) { return ''; } }
      var title = ''; try { title = (P['제목'].title || []).map(function (t) { return t.plain_text; }).join(''); } catch (e) {}
      var due = null; try { due = P['기한'].date.start; } catch (e) {}
      var rq = 0; try { rq = P['재문의'].number || 0; } catch (e) {}
      var link = ''; try { link = P['상담 링크'].url || ''; } catch (e) {}
      return { pageUrl: r.url, title: title, customer: rt('고객'), chatId: rt('chatId'), due: due, reinquiry: rq, chatLink: link };
    });
  } catch (e) { console.error('[Notion][promise] overdue 조회 실패:', e.response ? e.response.status : e.message); return []; }
}

module.exports = {
  createHandoffEntry: createHandoffEntry,
  createPromise: createPromise,
  findOpenPromise: findOpenPromise,
  bumpPromiseReinquiry: bumpPromiseReinquiry,
  completePromise: completePromise,
  listOverduePromises: listOverduePromises,
  defaultDueIso: defaultDueIso,
  resolveReason: resolveReason,
  notionUserId: notionUserId,
  isEnabled: isEnabled,
  deskLink: deskLink,
  VALID_REASONS: VALID_REASONS,
  REASON_CODE: REASON_CODE,
  NOTION_USER_BY_EMAIL: NOTION_USER_BY_EMAIL
};
