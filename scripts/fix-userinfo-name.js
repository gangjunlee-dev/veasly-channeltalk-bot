var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/routes/webhook.js";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// 1) _userInfo 초기화에 name 추가
var oldInit = "var _userInfo = { member: false, email: '', veaslyId: '' };";
var newInit = "var _userInfo = { member: false, email: '', veaslyId: '', name: '' };";
if (code.indexOf(oldInit) > -1) {
  code = code.replace(oldInit, newInit);
  console.log("  [1] _userInfo 초기화에 name 추가");
  changes++;
}

// 2) _u (cached user) 분기에 name 추가
var oldCachedUser = "            _userInfo.email = _u.email || (_u.profile && _u.profile.email) || '';\n            _userInfo.veaslyId = (_u.profile && _u.profile.veasly_id) || _u.memberId || '';";
var newCachedUser = "            _userInfo.email = _u.email || (_u.profile && _u.profile.email) || '';\n            _userInfo.veaslyId = (_u.profile && _u.profile.veasly_id) || _u.memberId || '';\n            _userInfo.name = _u.name || (_u.profile && _u.profile.name) || '';";
if (code.indexOf(oldCachedUser) > -1) {
  code = code.replace(oldCachedUser, newCachedUser);
  console.log("  [2] cached user에서 name 수집 추가");
  changes++;
}

// 3) _userData (API 조회) 분기에 name 추가
var oldApiUser = "            _userInfo.email = _userData.email || (_userData.profile && _userData.profile.email) || '';\n            _userInfo.veaslyId = (_userData.profile && _userData.profile.veasly_id) || _userData.memberId || '';";
var newApiUser = "            _userInfo.email = _userData.email || (_userData.profile && _userData.profile.email) || '';\n            _userInfo.veaslyId = (_userData.profile && _userData.profile.veasly_id) || _userData.memberId || '';\n            _userInfo.name = _userData.name || (_userData.profile && _userData.profile.name) || '';";
if (code.indexOf(oldApiUser) > -1) {
  code = code.replace(oldApiUser, newApiUser);
  console.log("  [3] API user에서 name 수집 추가");
  changes++;
}

fs.writeFileSync(file, code);
console.log("\n✅ " + changes + "개 변경 완료");
