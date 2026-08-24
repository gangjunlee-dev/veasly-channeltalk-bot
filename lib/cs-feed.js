/**
 * CS 피드 — 통합 업무 플랫폼에 넣을 CS 회신 데이터를 만들어 보관·발행. (2026-08-24)
 *
 * 왜 이 구조인가:
 * - Oracle 봇 서버는 외부 직접 접근이 막혀 있고(3000 차단), 공개 경로는 cloudflared 터널(URL 가변)
 *   + Worker 프록시뿐이다. 그래서 "플랫폼이 봇을 당겨오는" 구조에만 의존하면 취약하다.
 * - 그래서 3가지를 동시에 지원한다. 플랫폼 쪽에서 편한 하나만 고르면 된다:
 *     ① push  : CS_FEED_WEBHOOK_URL 로 POST (플랫폼 ingest 엔드포인트가 준비되면 env만 채우면 흐름)
 *     ② pull  : routes/cs-feed.js 의 토큰 인증 GET API
 *     ③ 파일  : data/cs-snapshot.json (같은 서버/사이드카에서 직접 읽기)
 * - 스냅샷은 10분 스윕에서 한 번만 계산해 재사용한다(채널톡·노션 API 부담·쿼터 절약).
 */
var fs = require('fs');
var path = require('path');
var axios = require('axios');

var SNAP_FILE = path.join(__dirname, '..', 'data', 'cs-snapshot.json');
var HIST_FILE = path.join(__dirname, '..', 'data', 'cs-snapshot-history.json');
var HIST_MAX = 120; // 영업일 기준 약 6개월

function readJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; } }
function writeJson(f, o) { try { fs.writeFileSync(f, JSON.stringify(o), 'utf8'); return true; } catch (e) { console.error('[CSFeed] write 실패', f, e.message); return false; } }

function getSnapshot() { return readJson(SNAP_FILE, null); }
function getHistory() { return readJson(HIST_FILE, []) || []; }

/** 일별 추이 1행 추가(같은 날 재호출이면 덮어쓰기) */
function appendHistory(snap) {
  var hist = getHistory();
  var date = String(snap.generatedAt).slice(0, 10);
  var row = {
    date: date,
    awaitingReal: (snap.awaiting && snap.awaiting.real) || 0,
    stale: (snap.awaiting && snap.awaiting.stale) || 0,
    ghosts: (snap.awaiting && snap.awaiting.ghosts) || 0,
    promisesOverdue: (snap.promises && snap.promises.overdue) || 0,
    firstReplyMedianH: (snap.metrics && snap.metrics.firstReplyMedianH) != null ? snap.metrics.firstReplyMedianH : null,
    firstReplyP90H: (snap.metrics && snap.metrics.firstReplyP90H) != null ? snap.metrics.firstReplyP90H : null,
    openedTotal: snap.openedTotal || 0
  };
  hist = hist.filter(function (h) { return h && h.date !== date; });
  hist.push(row);
  if (hist.length > HIST_MAX) hist = hist.slice(-HIST_MAX);
  writeJson(HIST_FILE, hist);
  return row;
}

/** 플랫폼 ingest 엔드포인트로 push (URL 미설정이면 조용히 스킵) */
async function pushToPlatform(snap) {
  var url = process.env.CS_FEED_WEBHOOK_URL;
  if (!url) return { skipped: 'CS_FEED_WEBHOOK_URL 미설정' };
  var headers = { 'Content-Type': 'application/json' };
  var tok = process.env.CS_FEED_TOKEN;
  if (tok) { headers['Authorization'] = 'Bearer ' + tok; headers['X-Feed-Token'] = tok; } // 플랫폼이 어느 쪽을 읽어도 되게 둘 다
  try {
    var res = await axios.post(url, snap, { headers: headers, timeout: 20000, validateStatus: function () { return true; } });
    if (res.status >= 400) { console.error('[CSFeed] push 실패', res.status, String(JSON.stringify(res.data)).slice(0, 150)); return { ok: false, status: res.status }; }
    return { ok: true, status: res.status };
  } catch (e) { console.error('[CSFeed] push 오류:', e.message); return { ok: false, error: e.message }; }
}

/**
 * 스냅샷 생성 → 파일 저장 → (선택)추이 기록 → (선택)플랫폼 push
 * @param {Object} o { withHistory: 하루 1회 true }
 */
async function refresh(o) {
  o = o || {};
  var snap;
  try { snap = await require('./reply-sla').buildSnapshot(); }
  catch (e) { console.error('[CSFeed] 스냅샷 생성 실패:', e.message); return null; }
  snap.source = 'veasly-channeltalk-bot';
  snap.schema = 1;
  writeJson(SNAP_FILE, snap);
  if (o.withHistory) appendHistory(snap);
  var pushed = await pushToPlatform(snap);
  console.log('[CSFeed] refresh — 답변필요 ' + snap.awaiting.real + ' / 약속 ' + snap.promises.overdue +
    (o.withHistory ? ' (추이기록)' : '') + ' | push: ' + (pushed.ok ? 'OK' : (pushed.skipped || 'fail')));
  return snap;
}

module.exports = {
  refresh: refresh,
  getSnapshot: getSnapshot,
  getHistory: getHistory,
  appendHistory: appendHistory,
  pushToPlatform: pushToPlatform,
  SNAP_FILE: SNAP_FILE
};
