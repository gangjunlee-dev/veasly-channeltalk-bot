/**
 * 회신 SLA — "고객이 답을 기다리는 중"인 상담을 채널톡 실제 상태로 추적. (2026-08-24)
 *
 * 배경(실측): 열린 상담 2,093건 중 미회신 168건인데 그 90%가 유령(스티커 108·감사 44)이라
 *   목록이 신호를 잃었고, 진짜 16건이 3~24영업일 방치됐다. 알림을 더 붙이는 게 아니라
 *   ① 유령을 큐에서 없애고 ② 남은 진짜 건에 단계적 압력을 주는 구조가 필요하다.
 *
 * 설계 원칙:
 * - 상태 기반(in-memory 금지): pendingEscalations 는 배포마다 날아가고 봇 넘김 건만 커버했다.
 *   여기서는 매 스윕마다 채널톡에서 "마지막 발화=고객"을 다시 계산하므로 재시작에 영향받지 않고
 *   매니저가 직접 응대한 상담도 포함된다.
 * - 약속 추적과 역할 분리: 이 모듈=고객이 답을 기다림(마지막=고객) / promise=우리가 약속을 안 지킴(마지막=매니저).
 * - 영업시간 경과 기준. 스윕도 영업시간에만.
 */
var axios = require('axios');
var fs = require('fs');
var path = require('path');
var bizHours = require('./business-hours');

var CH = {
  headers: { 'x-access-key': process.env.CHANNEL_ACCESS_KEY, 'x-access-secret': process.env.CHANNEL_ACCESS_SECRET },
  timeout: 20000, validateStatus: function () { return true; }
};
var DESK = 'https://desk.channel.io/#/channels/138710/user_chats/';
var STAGE_FILE = path.join(__dirname, '..', 'data', 'reply-sla-stage.json');

// 유령 판정: 고객의 마지막 메시지가 스티커·이미지·감사/확인어 → 답변 불필요(종료 대상)
var GHOST_ATTACH_RE = /스티커를 전송|사진을 전송|파일을 전송|동영상을 전송|^\[Image|^\[File/i;
var GHOST_THANKS_RE = /謝謝|感謝|好的|好喔|好哦|了解|收到|知道了|明白|辛苦|感恩|不用了|沒事|ok|thank|감사|알겠/i;
function isGhostText(t) {
  t = String(t || '').trim();
  if (!t) return true;
  if (GHOST_ATTACH_RE.test(t)) return true;
  if (t.length < 30 && GHOST_THANKS_RE.test(t)) return true;
  if (t.length <= 2 && !/[?？]/.test(t)) return true; // 「👌」「ok」 등 단문 리액션
  return false;
}

function loadStages() { try { return JSON.parse(fs.readFileSync(STAGE_FILE, 'utf8')); } catch (e) { return {}; } }
function saveStages(o) { try { fs.writeFileSync(STAGE_FILE, JSON.stringify(o), 'utf8'); } catch (e) {} }

// 분류 캐시: 같은 마지막 메시지면 재조회 없이 재사용(스윕이 10분마다 돌아도 API 부담 없게)
var _clsCache = {};

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function pageOpened(limitPages) {
  var all = [], since = null, seen = {}, pages = 0;
  while (pages < (limitPages || 60)) {
    var r = await axios.get('https://api.channel.io/open/v5/user-chats?state=opened&limit=50' + (since ? '&since=' + encodeURIComponent(since) : ''), CH);
    if (r.status >= 400) break;
    var cs = r.data.userChats || [];
    if (!cs.length) break;
    cs.forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; all.push(c); } });
    pages++;
    if (!r.data.next || r.data.next === since) break;
    since = r.data.next;
  }
  return all;
}

function lastActivityAt(c) { return Math.max(c.frontUpdatedAt || 0, c.deskUpdatedAt || 0) || c.openedAt || c.createdAt || 0; }

/**
 * 미회신 상담을 real(답변 필요) / ghosts(종료 대상)로 분류.
 * @returns {{real: Array, ghosts: Array, openedTotal: number}}
 */
async function classifyAwaiting() {
  var all = await pageOpened();
  var awaiting = all.filter(function (c) { return c.userLastMessageId && c.userLastMessageId === c.frontMessageId; });
  var real = [], ghosts = [];
  for (var i = 0; i < awaiting.length; i++) {
    var c = awaiting[i];
    var cacheKey = c.id + '|' + c.frontMessageId;
    var cls = _clsCache[cacheKey];
    if (cls === undefined) {
      var mr = await axios.get('https://api.channel.io/open/v5/user-chats/' + c.id + '/messages?limit=5&sortOrder=desc', CH);
      if (mr.status >= 400) { await sleep(110); continue; }
      var lastUser = (mr.data.messages || []).filter(function (m) { return m.personType === 'user'; })[0];
      var txt = lastUser ? String(lastUser.plainText || '') : '';
      cls = { ghost: isGhostText(txt), txt: txt.replace(/\s+/g, ' ').slice(0, 70) };
      _clsCache[cacheKey] = cls;
      if (Object.keys(_clsCache).length > 3000) _clsCache = {};
      await sleep(110);
    }
    var item = {
      id: c.id, name: c.name || '(익명)', link: DESK + c.id, text: cls.txt,
      bizH: bizHours.getBusinessHoursElapsedInHours(lastActivityAt(c), Date.now()),
      assigneeId: c.assigneeId || null
    };
    if (cls.ghost) ghosts.push(item); else real.push(item);
  }
  real.sort(function (a, b) { return b.bizH - a.bizH; });
  ghosts.sort(function (a, b) { return b.bizH - a.bizH; });
  return { real: real, ghosts: ghosts, openedTotal: all.length };
}

// 단계 정의: 영업시간 경과 → 압력 상승. 같은 상담은 단계가 올라갈 때만 다시 알린다.
var STAGES = [
  { n: 1, minBizH: 0.5, label: '30분 경과', mention: '' },
  { n: 2, minBizH: 2, label: '2영업시간 경과', mention: '' },
  { n: 3, minBizH: 4, label: '4영업시간 경과 — SLA 위반', mention: '<!here> ' },
  { n: 4, minBizH: 8, label: '당일 마감 초과(1영업일+)', mention: '<!here> ' }
];
function stageFor(bizH) {
  var s = 0;
  for (var i = 0; i < STAGES.length; i++) if (bizH >= STAGES[i].minBizH) s = STAGES[i].n;
  return s;
}

async function notifySlack(text) {
  var url = process.env.SLACK_WEBHOOK_URL;
  if (!url) { console.warn('[ReplySLA] SLACK_WEBHOOK_URL 미설정 — 알림 스킵'); return false; }
  try { await axios.post(url, { text: text }, { timeout: 10000 }); return true; }
  catch (e) { console.error('[ReplySLA] Slack 오류:', e.message); return false; }
}

/**
 * SLA 래더 스윕 — 영업시간 중 주기 실행. 단계가 올라간 상담만 알린다(도배 방지).
 * 24영업시간 초과 건은 아침 09:30 목록이 담당하므로 여기서는 제외.
 */
async function slaLadderSweep() {
  if (!bizHours.isBusinessHours(Date.now())) return { skipped: 'offhours' };
  var res = await classifyAwaiting();
  var stages = loadStages();
  var fresh = {}, alerts = [];
  res.real.forEach(function (r) {
    fresh[r.id] = true;
    if (r.bizH >= 24) return; // 묵은 건은 아침 독촉 담당
    var want = stageFor(r.bizH);
    if (!want) return;
    var had = stages[r.id] || 0;
    if (want > had) { stages[r.id] = want; alerts.push({ r: r, stage: want }); }
  });
  // 답변된 상담은 기록 삭제(다음에 다시 밀리면 처음부터)
  Object.keys(stages).forEach(function (k) { if (!fresh[k]) delete stages[k]; });
  saveStages(stages);

  if (alerts.length) {
    alerts.sort(function (a, b) { return b.stage - a.stage; });
    var top = STAGES.filter(function (s) { return s.n === alerts[0].stage; })[0];
    var lines = alerts.map(function (a) {
      var sd = STAGES.filter(function (s) { return s.n === a.stage; })[0];
      return '• [' + sd.label + '] ' + a.r.name.slice(0, 16) + ' — 「' + a.r.text.slice(0, 45) + '」\n  ' + a.r.link;
    });
    await notifySlack(top.mention + '⏱ 회신 대기 ' + alerts.length + '건\n' + lines.join('\n'));
  }
  console.log('[ReplySLA] sweep — 답변필요:' + res.real.length + ' 유령:' + res.ghosts.length + ' 신규알림:' + alerts.length);
  return { real: res.real.length, ghosts: res.ghosts.length, alerted: alerts.length };
}

/**
 * 마감 확인(영업 종료 1시간 전) — 오늘 미회신 현황. 0건이면 축하.
 */
async function eodSummary() {
  if (bizHours.isKRHoliday(Date.now())) return null;
  var res = await classifyAwaiting();
  var today = res.real.filter(function (r) { return r.bizH < 8; });   // 오늘 안에 들어온 것
  var older = res.real.filter(function (r) { return r.bizH >= 8; });  // 어제 이전 이월
  if (!res.real.length) {
    await notifySlack('✅ 마감 확인: 미회신 0건 — 오늘 들어온 문의 전부 회신 완료했습니다!');
  } else {
    var lines = res.real.slice(0, 12).map(function (r) {
      return '• ' + (r.bizH >= 8 ? '[이월 ' + Math.round(r.bizH / 8) + '영업일] ' : '[' + Math.round(r.bizH * 10) / 10 + '영업h] ') +
        r.name.slice(0, 16) + ' — 「' + r.text.slice(0, 40) + '」\n  ' + r.link;
    });
    await notifySlack('🔔 마감 확인: 미회신 ' + res.real.length + '건 (오늘 ' + today.length + ' / 이월 ' + older.length + ')\n퇴근 전 오늘 건은 정리해 주세요!\n' + lines.join('\n') +
      (res.real.length > 12 ? '\n…외 ' + (res.real.length - 12) + '건' : ''));
  }
  console.log('[ReplySLA] EOD — 미회신 ' + res.real.length + '건(오늘 ' + today.length + '/이월 ' + older.length + ')');
  return { real: res.real.length, today: today.length, older: older.length };
}

/**
 * 유령 상담 종료 — 고객 마지막 메시지가 스티커·감사인 건. 고객에게 아무 메시지도 보내지 않는다.
 * @param {Object} o { minBizH: 최소 경과(기본 8=1영업일), max: 최대 건수, dryRun: true면 목록만 }
 */
async function closeGhosts(o) {
  o = o || {};
  var minBizH = o.minBizH != null ? o.minBizH : 8;
  var res = await classifyAwaiting();
  var targets = res.ghosts.filter(function (g) { return g.bizH >= minBizH; });
  if (o.max) targets = targets.slice(0, o.max);
  if (o.dryRun) return { total: res.ghosts.length, targets: targets.length, sample: targets.slice(0, 10) };
  var closed = 0, failed = 0;
  for (var i = 0; i < targets.length; i++) {
    var r = await axios.patch('https://api.channel.io/open/v5/user-chats/' + targets[i].id + '/close?botName=' + encodeURIComponent('Veasly小幫手'), null, CH);
    if (r.status < 400) closed++; else { failed++; if (failed <= 3) console.error('[ReplySLA] close 실패', targets[i].id, r.status); }
    await sleep(250);
  }
  console.log('[ReplySLA] 유령 종료: ' + closed + '건 (실패 ' + failed + ')');
  return { closed: closed, failed: failed, remainingGhosts: res.ghosts.length - closed };
}

module.exports = {
  classifyAwaiting: classifyAwaiting,
  slaLadderSweep: slaLadderSweep,
  eodSummary: eodSummary,
  closeGhosts: closeGhosts,
  isGhostText: isGhostText
};
