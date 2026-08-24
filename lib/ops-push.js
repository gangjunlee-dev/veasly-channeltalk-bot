/**
 * veasly-ops(통합 업무 플랫폼) 대시보드로 CS 스냅샷 전송. (2026-08-24)
 *
 * 방향: 봇(Oracle) → ops(Cloudflare Pages). push 방식을 쓰는 이유는
 *   ① 봇에 조회 API를 새로 열지 않아도 됨(공격면 증가 없음)
 *   ② ops 는 D1 에서 읽기만 하므로 대시보드가 빠르고 채널톡 API 쿼터를 안 씀.
 * 인증: ops 의 기존 패턴 그대로 X-Ingest-Secret 헤더(TOKEN_INGEST_PATHS 우회).
 * 실패해도 CS 흐름에 영향 없음(best-effort).
 */
var axios = require('axios');

var OPS_BASE = (process.env.OPS_BASE_URL || 'https://veasly-ops.pages.dev').replace(/\/$/, '');
var SECRET = process.env.OPS_INGEST_SECRET || '';

function isEnabled() { return !!SECRET; }

/**
 * @param {Object} o { withHistory: true 면 일별 추이 1행 추가(하루 1회만 호출) }
 */
async function pushSnapshot(o) {
  o = o || {};
  if (!SECRET) { console.log('[OpsPush] skip (OPS_INGEST_SECRET 미설정)'); return null; }
  try {
    var snap = await require('./reply-sla').buildSnapshot();
    snap.withHistory = !!o.withHistory;
    var res = await axios.post(OPS_BASE + '/cs-sla/api/ingest', snap, {
      headers: { 'X-Ingest-Secret': SECRET, 'Content-Type': 'application/json' },
      timeout: 20000, validateStatus: function () { return true; }
    });
    if (res.status >= 400) {
      console.error('[OpsPush] 실패', res.status, JSON.stringify(res.data).slice(0, 150));
      return null;
    }
    console.log('[OpsPush] 스냅샷 전송 OK — 답변필요 ' + snap.awaiting.real + ' / 약속 ' + snap.promises.overdue + (o.withHistory ? ' (추이 기록)' : ''));
    return snap;
  } catch (e) { console.error('[OpsPush] 오류:', e.message); return null; }
}

module.exports = { pushSnapshot: pushSnapshot, isEnabled: isEnabled };
