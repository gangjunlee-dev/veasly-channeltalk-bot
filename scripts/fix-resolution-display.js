var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// 1) 테이블 헤더에 '불확실' 컬럼 추가
var oldTH = "      h += '<th style=\"padding:8px 6px;color:var(--text-secondary);text-align:center;\">에스컬</th>';";
// AI 모니터링 탭 것만 (1346행 근처)
var thIdx = code.indexOf(oldTH);
if (thIdx > -1) {
  var nearTH = code.substring(thIdx - 300, thIdx);
  if (nearTH.indexOf('카테고리') > -1 || nearTH.indexOf('catArr') > -1 || nearTH.indexOf('총건수') > -1) {
    var newTH = oldTH + "\n      h += '<th style=\"padding:8px 6px;color:var(--text-secondary);text-align:center;\">불확실</th>';";
    code = code.substring(0, thIdx) + newTH + code.substring(thIdx + oldTH.length);
    console.log("  [1] 테이블 헤더에 '불확실' 컬럼 추가");
    changes++;
  }
}

// 2) 테이블 행에 불확실 수 추가
var oldEscTD = "        h += '<td style=\"padding:8px 6px;text-align:center;color:#ef4444;\">' + s.escalated + '</td>';";
var escTDIdx = code.indexOf(oldEscTD);
if (escTDIdx > -1) {
  var nearEsc = code.substring(escTDIdx - 400, escTDIdx);
  if (nearEsc.indexOf('catStats') > -1 || nearEsc.indexOf('catArr') > -1) {
    var newEscTD = oldEscTD + "\n        h += '<td style=\"padding:8px 6px;text-align:center;color:#f59e0b;\">' + (s.uncertain || 0) + '</td>';";
    code = code.substring(0, escTDIdx) + newEscTD + code.substring(escTDIdx + oldEscTD.length);
    console.log("  [2] 테이블 행에 '불확실' 데이터 추가");
    changes++;
  }
}

// 3) 상단 AI 자동해결률 카드 - chatGroups 기반으로 교체
var oldResolve = [
  "    var aiResolved = totalConv - escCount;",
  "    var resolveRate = totalConv > 0 ? Math.round((aiResolved / totalConv) * 100) : 0;"
].join("\n");

var newResolve = [
  "    // chatGroups 기반 해결률 (v2)",
  "    var _cgKeys = Object.keys(chatGroups || {});",
  "    var _cgTotal = 0, _cgResolved = 0, _cgEsc = 0, _cgUncertain = 0;",
  "    var _skipT = ['greeting','thank_you','csat_feedback','ces_response','sticker'];",
  "    _cgKeys.forEach(function(ck) {",
  "      var cg = chatGroups[ck];",
  "      var hasReal = cg.msgs.some(function(m){ return _skipT.indexOf(m.type) === -1; });",
  "      if (!hasReal) return;",
  "      _cgTotal++;",
  "      if (cg.escalated) { _cgEsc++; return; }",
  "      var aiM = cg.msgs.filter(function(m){ return m.type==='ai_answer'||m.type==='faq_answer'; });",
  "      var realM = cg.msgs.filter(function(m){ return _skipT.indexOf(m.type)===-1; }).length;",
  "      var confM = cg.msgs.filter(function(m){ return m.confidence && m.confidence>0; });",
  "      var avgC = confM.length>0 ? confM.reduce(function(s,m){return s+m.confidence;},0)/confM.length : 0;",
  "      if (realM<=2 && avgC>=0.6) _cgResolved++;",
  "      else _cgUncertain++;",
  "    });",
  "    var aiResolved = _cgResolved;",
  "    var resolveRate = _cgTotal > 0 ? Math.round((_cgResolved / _cgTotal) * 100) : 0;"
].join("\n");

if (code.indexOf(oldResolve) > -1) {
  code = code.replace(oldResolve, newResolve);
  console.log("  [3] 상단 AI 자동해결률 → chatGroups 기반 v2로 교체");
  changes++;
}

// 4) AI 자동해결률 카드 설명 업데이트
var oldCard = "h += card('AI 자동해결률', resolveRate + '%', '', resolveRate >= 70 ? 'green' : resolveRate >= 50 ? 'yellow' : 'red', aiResolved + '/' + totalConv + '건 해결', '에스컬레이션 없이 AI가 직접 해결한 비율. 70% 이상이 목표');";
var newCard = "h += card('AI 자동해결률', resolveRate + '%', '', resolveRate >= 70 ? 'green' : resolveRate >= 50 ? 'yellow' : 'red', '해결 ' + _cgResolved + ' / 에스컬 ' + _cgEsc + ' / 불확실 ' + _cgUncertain, '채팅 단위 판정: 1~2회+고신뢰=해결, 에스컬=미해결, 재질문+저신뢰=불확실');";

if (code.indexOf(oldCard) > -1) {
  code = code.replace(oldCard, newCard);
  console.log("  [4] AI 자동해결률 카드 설명 업데이트");
  changes++;
}

// 5) 요약 카드에도 불확실 반영
var oldBadCats = "      var badCats = catArr.filter(function(k){return Math.round((catStats[k].resolved/catStats[k].total)*100) < 50;}).length;";
var newBadCats = "      var badCats = catArr.filter(function(k){return catStats[k].total > 0 && Math.round((catStats[k].resolved/catStats[k].total)*100) < 50;}).length;";
if (code.indexOf(oldBadCats) > -1) {
  code = code.replace(oldBadCats, newBadCats);
  console.log("  [5] 요약 카드 badCats 계산 안전화");
  changes++;
}

fs.writeFileSync(file, code);
console.log("\n✅ 총 " + changes + "개 변경 완료");
