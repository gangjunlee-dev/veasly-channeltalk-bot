/**
 * 팔로워 정책 (SOP v2, 2026-07-02):
 * - 기본 팔로워 = MIA, 우선 (채널톡 매니저 표시 이름 기준)
 * - 관리자 = 강준 — 봇이 엉뚱하게 답할 수 있으므로 모든 채팅에 팔로워로 초대
 * - 기존 "전체 매니저 팔로워 추가"를 이 3인으로 축소
 * - 이름은 환경변수로 재정의 가능:
 *   DEFAULT_FOLLOWER_NAMES=MIA,우선  /  ADMIN_MANAGER_NAME=강준
 */

var channeltalk = require('./channeltalk');

var FOLLOWER_NAMES = (process.env.DEFAULT_FOLLOWER_NAMES || 'MIA,우선')
  .split(',')
  .map(function(s) { return s.trim(); })
  .filter(function(s) { return s.length > 0; });

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

async function resolveIdsByNames(names) {
  var list = await getManagers();
  var ids = [];
  for (var i = 0; i < names.length; i++) {
    var found = null;
    for (var j = 0; j < list.length; j++) {
      if (nameMatches(list[j].name, names[i])) {
        found = list[j];
        break;
      }
    }
    if (found) {
      ids.push(found.id);
    } else {
      console.warn('[Managers] Manager not found by name: ' + names[i]);
    }
  }
  return ids;
}

// 기본 팔로워 (MIA·우선) — 상담 배정 대상
async function getFollowerIds() {
  return resolveIdsByNames(FOLLOWER_NAMES);
}

// 관리자 (강준)
async function getAdminIds() {
  return resolveIdsByNames([ADMIN_NAME]);
}

// 모든 채팅에 팔로워로 넣을 대상: MIA·우선 + 강준.
// 이름 매칭이 전부 실패하면 안전장치로 operator 전체(기존 동작) 반환.
async function getTeamManagerIds() {
  var followers = await getFollowerIds();
  var admins = await getAdminIds();
  var all = followers.concat(admins);
  var uniq = [];
  for (var i = 0; i < all.length; i++) {
    if (uniq.indexOf(all[i]) === -1) uniq.push(all[i]);
  }
  if (uniq.length === 0) {
    console.warn('[Managers] Name matching failed entirely - fallback to all operators');
    var list = await getManagers();
    return list.filter(function(m) { return m.operator && !m.bot; }).map(function(m) { return m.id; });
  }
  return uniq;
}

module.exports = {
  getManagers: getManagers,
  getFollowerIds: getFollowerIds,
  getAdminIds: getAdminIds,
  getTeamManagerIds: getTeamManagerIds,
  FOLLOWER_NAMES: FOLLOWER_NAMES,
  ADMIN_NAME: ADMIN_NAME
};
