/**
 * 팔로워 정책 (SOP v2, 2026-07-03 개정):
 * - 팔로워 = MIA, 우선 — 모든 채팅에 팔로워로 추가
 * - 담당자 = 강준 — 봇 핸드오프 시 담당자로 초대
 * - 채널톡 표시 이름이 전부 브랜드명(veasly 등)이라 이름 매칭 불가 → 이메일 기준 매칭 (이름은 보조)
 * - 환경변수로 재정의 가능:
 *   DEFAULT_FOLLOWER_EMAILS=mia@newndy.com,vida890515@newndy.com
 *   ADMIN_MANAGER_EMAIL=gangjun.lee@newndy.com
 *   DEFAULT_FOLLOWER_NAMES=MIA,우선  /  ADMIN_MANAGER_NAME=강준  (이메일 매칭 실패 시 보조)
 */

var channeltalk = require('./channeltalk');

var FOLLOWER_EMAILS = (process.env.DEFAULT_FOLLOWER_EMAILS || 'mia@newndy.com,vida890515@newndy.com')
  .split(',')
  .map(function(s) { return s.trim(); })
  .filter(function(s) { return s.length > 0; });

var FOLLOWER_NAMES = (process.env.DEFAULT_FOLLOWER_NAMES || 'MIA,우선')
  .split(',')
  .map(function(s) { return s.trim(); })
  .filter(function(s) { return s.length > 0; });

var ADMIN_EMAIL = (process.env.ADMIN_MANAGER_EMAIL || 'gangjun.lee@newndy.com').trim();
var ADMIN_NAME = (process.env.ADMIN_MANAGER_NAME || '강준').trim();

var CACHE_TTL = 10 * 60 * 1000; // 10분
var cache = { at: 0, managers: [] };

async function getManagers() {
  var now = Date.now();
  if (cache.managers.length > 0 && now - cache.at < CACHE_TTL) {
    return cache.managers;
  }
  var res = await channeltalk.listManagers();
  cache.managers = (res && res.managers) || [];
  cache.at = now;
  return cache.managers;
}

function norm(s) {
  return (s || '').toString().trim().toLowerCase();
}

// 표시 이름이 "MIA 🌸", "강준 Lee" 처럼 꾸며져 있어도 매칭되도록 부분 일치 허용
function nameMatches(managerName, target) {
  var m = norm(managerName);
  var t = norm(target);
  if (!m || !t) return false;
  return m === t || m.indexOf(t) !== -1 || t.indexOf(m) !== -1;
}

function emailMatches(managerEmail, target) {
  var m = norm(managerEmail);
  var t = norm(target);
  if (!m || !t) return false;
  return m === t;
}

// targets: [{ email, name }] — 이메일 정확 일치 우선, 실패 시 이름 부분 일치
async function resolveIds(targets) {
  var list = await getManagers();
  var ids = [];
  for (var i = 0; i < targets.length; i++) {
    var found = null;
    for (var j = 0; j < list.length; j++) {
      if (targets[i].email && emailMatches(list[j].email, targets[i].email)) { found = list[j]; break; }
    }
    if (!found && targets[i].name) {
      for (var k = 0; k < list.length; k++) {
        if (nameMatches(list[k].name, targets[i].name)) { found = list[k]; break; }
      }
    }
    if (found) {
      if (ids.indexOf(found.id) === -1) ids.push(found.id);
    } else {
      console.warn('[Managers] Manager not found: ' + (targets[i].email || targets[i].name));
    }
  }
  return ids;
}

function followerTargets() {
  var t = [];
  var n = Math.max(FOLLOWER_EMAILS.length, FOLLOWER_NAMES.length);
  for (var i = 0; i < n; i++) {
    t.push({ email: FOLLOWER_EMAILS[i] || '', name: FOLLOWER_NAMES[i] || '' });
  }
  return t;
}

// 기본 팔로워 (MIA·우선) — 모든 채팅에 팔로워로 추가
async function getFollowerIds() {
  return resolveIds(followerTargets());
}

// 관리자 (강준) — 핸드오프 시 담당자
async function getAdminIds() {
  return resolveIds([{ email: ADMIN_EMAIL, name: ADMIN_NAME }]);
}

// 팀 전체 (MIA·우선 + 강준) — 15분 무응답 재배정 알림 등에 사용.
// 매칭이 전부 실패하면 안전장치로 첫 operator 1명만 반환 (전원 폴백 금지 — 팔로워 폭증 방지).
async function getTeamManagerIds() {
  var followers = await getFollowerIds();
  var admins = await getAdminIds();
  var all = followers.concat(admins);
  var uniq = [];
  for (var i = 0; i < all.length; i++) {
    if (uniq.indexOf(all[i]) === -1) uniq.push(all[i]);
  }
  if (uniq.length === 0) {
    console.warn('[Managers] Matching failed entirely - fallback to first operator');
    var list = await getManagers();
    for (var j = 0; j < list.length; j++) {
      if (list[j].operator && !list[j].bot) return [list[j].id];
    }
    return [];
  }
  return uniq;
}

module.exports = {
  getManagers: getManagers,
  getFollowerIds: getFollowerIds,
  getAdminIds: getAdminIds,
  getTeamManagerIds: getTeamManagerIds,
  FOLLOWER_EMAILS: FOLLOWER_EMAILS,
  FOLLOWER_NAMES: FOLLOWER_NAMES,
  ADMIN_EMAIL: ADMIN_EMAIL,
  ADMIN_NAME: ADMIN_NAME
};
