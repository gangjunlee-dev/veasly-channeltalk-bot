var fs = require("fs");

// ============================================
// PART 1: survey.js - 제출 시 고객 정보 저장 강화
// ============================================
var surveyFile = "/home/ubuntu/veasly-channeltalk-bot/routes/survey.js";
var surveyCode = fs.readFileSync(surveyFile, "utf8");

// 기존 entry 객체에 customerName, email, isMember 추가
var oldEntry = [
  "  var entry = {",
  "    chatId: body.chatId || '',",
  "    userId: body.userId || '',",
  "    lang: body.lang || 'zh-TW',",
  "    type: body.type || 'bot',",
  "    satisfied: body.satisfied,",
  "    category: body.category || '',",
  "    reasons: body.reasons || [],",
  "    comment: body.comment || '',",
  "    guestEmail: body.guestEmail || '',",
  "    veaslyId: body.veaslyId || '',",
  "    submittedAt: body.submittedAt || new Date().toISOString(),",
  "    surveyVersion: body.surveyVersion || 'v3',",
  "    rewardStatus: 'pending_draw'",
  "  };"
].join("\n");

var newEntry = [
  "  var entry = {",
  "    chatId: body.chatId || '',",
  "    userId: body.userId || '',",
  "    lang: body.lang || 'zh-TW',",
  "    type: body.type || 'bot',",
  "    satisfied: body.satisfied,",
  "    category: body.category || '',",
  "    reasons: body.reasons || [],",
  "    comment: body.comment || '',",
  "    email: body.email || body.guestEmail || '',",
  "    veaslyId: body.veaslyId || '',",
  "    isMember: body.isMember || false,",
  "    submittedAt: body.submittedAt || new Date().toISOString(),",
  "    surveyVersion: body.surveyVersion || 'v3',",
  "    rewardStatus: 'pending_draw'",
  "  };"
].join("\n");

if (surveyCode.indexOf(oldEntry) > -1) {
  surveyCode = surveyCode.replace(oldEntry, newEntry);
  fs.writeFileSync(surveyFile, surveyCode);
  console.log("  [1] survey.js - email, isMember 필드 추가 완료");
} else {
  console.log("  [1] ❌ survey.js 패턴 불일치");
}

// ============================================
// PART 2: survey.html - URL에서 고객 이름도 전달
// ============================================
// survey.html은 이미 email, veaslyId, isMember를 보내고 있으므로 OK
// 단, URL params에서 name을 추가로 파싱

var htmlFile = "/home/ubuntu/veasly-channeltalk-bot/public/survey.html";
var htmlCode = fs.readFileSync(htmlFile, "utf8");

var oldParams = "var chatId = params.get('cid') || '';\nvar userId = params.get('uid') || '';\nvar lang = params.get('lang') || 'zh-TW';";
var newParams = "var chatId = params.get('cid') || '';\nvar userId = params.get('uid') || '';\nvar lang = params.get('lang') || 'zh-TW';\nvar customerName = decodeURIComponent(params.get('name') || '');";

if (htmlCode.indexOf(oldParams) > -1) {
  htmlCode = htmlCode.replace(oldParams, newParams);
  console.log("  [2a] survey.html - customerName 파라미터 파싱 추가");
}

// submitSurvey에 customerName 추가
var oldSubmitData = "    veaslyId: veaslyId,\n    isMember: isMember";
var newSubmitData = "    veaslyId: veaslyId,\n    isMember: isMember,\n    customerName: customerName";
if (htmlCode.indexOf(oldSubmitData) > -1) {
  htmlCode = htmlCode.replace(oldSubmitData, newSubmitData);
  console.log("  [2b] survey.html - submitSurvey에 customerName 추가");
}

fs.writeFileSync(htmlFile, htmlCode);

// ============================================
// PART 3: webhook.js - 설문 링크에 name 파라미터 추가
// ============================================
var webhookFile = "/home/ubuntu/veasly-channeltalk-bot/routes/webhook.js";
var webhookCode = fs.readFileSync(webhookFile, "utf8");

// 설문 링크 생성 부분에 &name= 추가
var oldSurveyUrl = '+ "&vid=" + encodeURIComponent(_userInfo.veaslyId)';
var newSurveyUrl = '+ "&vid=" + encodeURIComponent(_userInfo.veaslyId) + "&name=" + encodeURIComponent(_userInfo.name || _userInfo.email || "")';

if (webhookCode.indexOf(oldSurveyUrl) > -1) {
  webhookCode = webhookCode.replace(oldSurveyUrl, newSurveyUrl);
  console.log("  [3a] webhook.js - 설문 링크에 name 파라미터 추가");
}

// _userInfo에 name 필드가 있는지 확인 후 추가
// _userInfo.email은 이미 설정됨, name도 추가
var oldUserInfo = "_userInfo.email = _userData.email || (_userData.profile && _userData.profile.email) || '';";
var newUserInfo = "_userInfo.email = _userData.email || (_userData.profile && _userData.profile.email) || '';\n            _userInfo.name = _userData.name || (_userData.profile && _userData.profile.name) || '';";

if (webhookCode.indexOf(oldUserInfo) > -1 && webhookCode.indexOf("_userInfo.name") === -1) {
  webhookCode = webhookCode.replace(oldUserInfo, newUserInfo);
  console.log("  [3b] webhook.js - _userInfo.name 수집 추가");
}

fs.writeFileSync(webhookCode.length > 0 ? webhookFile : '', webhookCode);

// ============================================
// PART 4: survey.js - entry에 customerName 저장
// ============================================
var surveyCode2 = fs.readFileSync(surveyFile, "utf8");
var oldEntry2 = "    email: body.email || body.guestEmail || '',";
var newEntry2 = "    customerName: body.customerName || '',\n    email: body.email || body.guestEmail || '',";

if (surveyCode2.indexOf("customerName") === -1 && surveyCode2.indexOf(oldEntry2) > -1) {
  surveyCode2 = surveyCode2.replace(oldEntry2, newEntry2);
  fs.writeFileSync(surveyFile, surveyCode2);
  console.log("  [4] survey.js - customerName 필드 저장 추가");
}

// ============================================
// PART 5: dashboard.html - 고객 피드백 탭에 고객 정보 표시
// ============================================
var dashFile = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var dashCode = fs.readFileSync(dashFile, "utf8");

// 최근 피드백 테이블 헤더에 고객 정보 추가
var oldFeedbackHeader = "<th>일시</th><th>만족</th><th>카테고리</th><th>사유</th><th>언어</th><th>타입</th><th>추첨</th>";
var newFeedbackHeader = "<th>일시</th><th>고객</th><th>만족</th><th>카테고리</th><th>사유</th><th>코멘트</th><th>추첨</th>";

if (dashCode.indexOf(oldFeedbackHeader) > -1) {
  dashCode = dashCode.replace(oldFeedbackHeader, newFeedbackHeader);
  console.log("  [5a] dashboard.html - 피드백 테이블 헤더 변경");
}

// 테이블 행에 고객 정보 추가
var oldFeedbackRow = "        var satIcon = fv.satisfied ? '😊 만족' : '😞 불만족';\n        var satStyle = fv.satisfied ? 'color:#22c55e' : 'color:#ef4444';";

// 기존 행 렌더링 부분을 찾아서 대체
var feedbackRowStart = dashCode.indexOf(oldFeedbackRow);
if (feedbackRowStart > -1) {
  // 기존 행 끝 찾기 (</tr> 까지)
  var feedbackRowEnd = dashCode.indexOf("</tr>';", feedbackRowStart);
  if (feedbackRowEnd > -1) {
    feedbackRowEnd += "</tr>';".length;
    var oldFeedbackBlock = dashCode.substring(feedbackRowStart, feedbackRowEnd);
    
    var newFeedbackBlock = [
      "        var satIcon = fv.satisfied ? '😊' : '😞';",
      "        var satStyle = fv.satisfied ? 'color:#22c55e' : 'color:#ef4444';",
      "        var _custName = fv.customerName || fv.email || fv.veaslyId || fv.userId || '-';",
      "        if (_custName.length > 20) _custName = _custName.substring(0, 18) + '..';",
      "        var _custBadge = fv.isMember ? '<span style=\"background:#7c3aed;color:#fff;padding:1px 5px;border-radius:4px;font-size:9px;margin-left:4px;\">회원</span>' : '<span style=\"background:#6b7280;color:#fff;padding:1px 5px;border-radius:4px;font-size:9px;margin-left:4px;\">비회원</span>';",
      "        var _comment = (fv.comment || '-');",
      "        if (_comment.length > 30) _comment = _comment.substring(0, 28) + '..';",
      "        var _reasonStr = (fv.reasons || []).join(', ') || '-';",
      "        var _drawBadge = fv.rewardStatus === 'won' ? '<span style=\"color:#f59e0b\">🏆 당첨</span>' : fv.rewardStatus === 'pending_draw' ? '⏳ 대기' : fv.rewardStatus || '-';",
      "        html += '<tr>';",
      "        html += '<td style=\"font-size:11px;white-space:nowrap;\">' + new Date(fv.submittedAt).toLocaleString('ko-KR', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) + '</td>';",
      "        html += '<td style=\"font-size:11px;\">' + _custName + _custBadge + '</td>';",
      "        html += '<td style=\"' + satStyle + ';font-weight:600;\">' + satIcon + '</td>';",
      "        html += '<td><span style=\"padding:2px 8px;border-radius:8px;font-size:11px;background:rgba(99,102,241,0.15);color:#818cf8;\">' + (fv.category || '-') + '</span></td>';",
      "        html += '<td style=\"font-size:11px;\">' + _reasonStr + '</td>';",
      "        html += '<td style=\"font-size:11px;color:var(--text-secondary);\">' + _comment + '</td>';",
      "        html += '<td style=\"font-size:11px;\">' + _drawBadge + '</td>';",
      "        html += '</tr>';"
    ].join("\n");
    
    dashCode = dashCode.substring(0, feedbackRowStart) + newFeedbackBlock + dashCode.substring(feedbackRowEnd);
    console.log("  [5b] dashboard.html - 피드백 테이블 행에 고객 정보 추가");
  }
}

fs.writeFileSync(dashFile, dashCode);

console.log("\n✅ 고객 정보 표시 기능 추가 완료");
console.log("- survey.js: customerName, email, isMember 저장");
console.log("- survey.html: URL에서 name 파싱 + 제출 데이터에 포함");
console.log("- webhook.js: 설문 링크에 &name= 파라미터 추가");
console.log("- dashboard.html: 피드백 목록에 고객명, 회원여부, 코멘트 표시");
