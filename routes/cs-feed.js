/**
 * CS 피드 pull API — 통합 업무 플랫폼이 당겨가는 읽기 전용 엔드포인트. (2026-08-24)
 *
 * 인증: Authorization: Bearer <CS_FEED_TOKEN>  또는  X-Feed-Token: <CS_FEED_TOKEN>
 *   토큰 미설정 시 전부 503(기본 잠금 — 고객명·문의내용이 담기므로 무인증 노출 금지).
 * CORS: CS_FEED_ALLOW_ORIGIN(쉼표 구분, * 가능)에 등록된 오리진만 허용. 미설정이면 브라우저 직접호출 불가
 *   (플랫폼 서버에서 호출하는 걸 권장 — 토큰이 브라우저에 노출되지 않음).
 * 데이터는 10분 주기로 갱신된 스냅샷 파일을 그대로 서빙한다(채널톡·노션 재조회 없음 → 빠르고 쿼터 안전).
 */
var express = require('express');
var router = express.Router();
var csFeed = require('../lib/cs-feed');

function allowOrigin(req, res) {
  var conf = (process.env.CS_FEED_ALLOW_ORIGIN || '').trim();
  if (!conf) return;
  var origin = req.headers.origin || '';
  var list = conf.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (list.indexOf('*') !== -1) { res.setHeader('Access-Control-Allow-Origin', '*'); }
  else if (origin && list.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-Feed-Token, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

function requireToken(req, res, next) {
  allowOrigin(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  var want = process.env.CS_FEED_TOKEN || '';
  if (!want) return res.status(503).json({ error: 'feed_disabled', hint: 'CS_FEED_TOKEN 미설정' });
  var auth = req.headers.authorization || '';
  var bearer = auth.indexOf('Bearer ') === 0 ? auth.slice(7).trim() : '';
  var got = bearer || req.headers['x-feed-token'] || '';
  if (got !== want) return res.status(401).json({ error: 'unauthorized' });
  next();
}

/** 인증 없이도 되는 상태 확인 — 비밀 정보 없음(갱신 시각·건수만) */
router.get('/health', function (req, res) {
  allowOrigin(req, res);
  var s = csFeed.getSnapshot();
  res.json({
    ok: true,
    tokenConfigured: !!process.env.CS_FEED_TOKEN,
    lastUpdated: s ? s.generatedAt : null,
    ageMinutes: s ? Math.round((Date.now() - new Date(s.generatedAt).getTime()) / 60000) : null,
    awaitingReal: s ? s.awaiting.real : null
  });
});

/** 전체 스냅샷 (대시보드 한 번에 렌더용) */
router.get('/snapshot', requireToken, function (req, res) {
  var s = csFeed.getSnapshot();
  if (!s) return res.status(404).json({ error: 'no_snapshot_yet', hint: '영업시간 10분 스윕 후 생성됩니다' });
  res.json(s);
});

/** KPI 카드용 요약만 (가벼움) */
router.get('/metrics', requireToken, function (req, res) {
  var s = csFeed.getSnapshot();
  if (!s) return res.status(404).json({ error: 'no_snapshot_yet' });
  res.json({
    generatedAt: s.generatedAt, openedTotal: s.openedTotal,
    awaiting: { real: s.awaiting.real, today: s.awaiting.today, carried: s.awaiting.carried, stale: s.awaiting.stale, ghosts: s.awaiting.ghosts },
    promisesOverdue: s.promises.overdue, metrics: s.metrics, handoff: s.handoff
  });
});

/** 답변 대기 목록 — ?stale=1 이면 3영업일+ 만 */
router.get('/awaiting', requireToken, function (req, res) {
  var s = csFeed.getSnapshot();
  if (!s) return res.status(404).json({ error: 'no_snapshot_yet' });
  var items = s.awaiting.items || [];
  if (req.query.stale) items = items.filter(function (x) { return x.bizH >= 24; });
  res.json({ generatedAt: s.generatedAt, count: items.length, items: items });
});

/** 미이행 약속 목록 */
router.get('/promises', requireToken, function (req, res) {
  var s = csFeed.getSnapshot();
  if (!s) return res.status(404).json({ error: 'no_snapshot_yet' });
  res.json({ generatedAt: s.generatedAt, count: s.promises.overdue, items: s.promises.items || [] });
});

/** 일별 추이 — ?days=30 */
router.get('/history', requireToken, function (req, res) {
  var h = csFeed.getHistory();
  var d = parseInt(req.query.days, 10);
  if (d > 0) h = h.slice(-d);
  res.json({ count: h.length, rows: h });
});

/** 즉시 재계산(운영용, 느림 ~1분). 플랫폼 정기 호출용은 아님 */
router.post('/refresh', requireToken, async function (req, res) {
  try {
    var s = await csFeed.refresh({ withHistory: !!req.query.history });
    if (!s) return res.status(500).json({ error: 'refresh_failed' });
    res.json({ ok: true, generatedAt: s.generatedAt, awaitingReal: s.awaiting.real });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
