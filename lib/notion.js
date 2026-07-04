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

// 직원이 팀챗에 치는 짧은 코드 → 노션 사유 매핑
var REASON_CODE = {
  '분쟁': '한국어 분쟁(셀러)',
  '정책': '정책 예외',
  '재무': '재무·환불(15일 규칙)',
  '통관': '통관·물류·브랜드 분쟁',
  '시스템': '시스템 오류',
  '기타': '기타'
};

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
  try {
    var res = await axios.post('https://api.notion.com/v1/pages',
      { parent: { database_id: DB_ID }, properties: props },
      { headers: { 'Authorization': 'Bearer ' + NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, timeout: 10000 });
    console.log('[Notion] 넘김 적재 OK:', (res.data && res.data.id) || '?', '| 사유:', reason);
    return res.data;
  } catch (e) {
    console.error('[Notion] 적재 실패:', e.response ? JSON.stringify(e.response.data).slice(0, 300) : e.message);
    return null;
  }
}

module.exports = {
  createHandoffEntry: createHandoffEntry,
  resolveReason: resolveReason,
  isEnabled: isEnabled,
  deskLink: deskLink,
  VALID_REASONS: VALID_REASONS,
  REASON_CODE: REASON_CODE
};
