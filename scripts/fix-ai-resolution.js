var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");

// 기존: 단순 escalated 여부로 판정
var oldCalc = [
  "    var catStats = {};",
  "    convs.forEach(function(c) {",
  "      var cat = c.category || 'unknown';",
  "      if (typeof cat === 'object') cat = cat.category || 'unknown';",
  "      if (!catStats[cat]) catStats[cat] = {total:0, resolved:0, escalated:0, confSum:0, confCount:0};",
  "      catStats[cat].total++;",
  "      if (!c.escalated) catStats[cat].resolved++;",
  "      else catStats[cat].escalated++;",
  "      if (c.confidence && c.confidence > 0) { catStats[cat].confSum += c.confidence; catStats[cat].confCount++; }",
  "    });"
].join("\n");

// 새로운: 채팅 단위로 해결 여부 판정
var newCalc = [
  "    // === 채팅 단위 해결률 계산 (v2) ===",
  "    // Step 1: chatId별로 메시지 그룹핑",
  "    var chatGroups = {};",
  "    convs.forEach(function(c) {",
  "      var cid = c.chatId || ('_' + Math.random());",
  "      if (!chatGroups[cid]) chatGroups[cid] = { msgs: [], escalated: false, categories: {}, types: {} };",
  "      chatGroups[cid].msgs.push(c);",
  "      if (c.escalated) chatGroups[cid].escalated = true;",
  "      var cat = c.category || 'unknown';",
  "      if (typeof cat === 'object') cat = cat.category || 'unknown';",
  "      chatGroups[cid].categories[cat] = (chatGroups[cid].categories[cat] || 0) + 1;",
  "      chatGroups[cid].types[c.type || '?'] = true;",
  "    });",
  "",
  "    // Step 2: 채팅별 해결 판정",
  "    var catStats = {};",
  "    Object.keys(chatGroups).forEach(function(cid) {",
  "      var g = chatGroups[cid];",
  "      var mainCat = Object.keys(g.categories).sort(function(a,b){ return g.categories[b]-g.categories[a]; })[0] || 'unknown';",
  "      // greeting, thank_you, csat_feedback, ces_response 제외",
  "      var skipTypes = ['greeting','thank_you','csat_feedback','ces_response','sticker'];",
  "      var hasRealMsg = g.msgs.some(function(m){ return skipTypes.indexOf(m.type) === -1; });",
  "      if (!hasRealMsg) return;",
  "",
  "      if (!catStats[mainCat]) catStats[mainCat] = {total:0, resolved:0, escalated:0, uncertain:0, confSum:0, confCount:0};",
  "      catStats[mainCat].total++;",
  "",
  "      if (g.escalated) {",
  "        // 에스컬레이션 발생 → 미해결",
  "        catStats[mainCat].escalated++;",
  "      } else {",
  "        var aiMsgs = g.msgs.filter(function(m){ return m.type === 'ai_answer' || m.type === 'faq_answer'; });",
  "        var msgCount = g.msgs.filter(function(m){ return skipTypes.indexOf(m.type) === -1; }).length;",
  "        var avgConf = 0;",
  "        var confMsgs = g.msgs.filter(function(m){ return m.confidence && m.confidence > 0; });",
  "        if (confMsgs.length > 0) avgConf = confMsgs.reduce(function(s,m){ return s+m.confidence; }, 0) / confMsgs.length;",
  "",
  "        if (msgCount <= 2 && avgConf >= 0.6) {",
  "          // 1~2회 메시지 + 높은 신뢰도 → 해결",
  "          catStats[mainCat].resolved++;",
  "        } else if (msgCount <= 2 && avgConf < 0.6 && avgConf > 0) {",
  "          // 1~2회 메시지 + 낮은 신뢰도 → 불확실",
  "          catStats[mainCat].uncertain++;",
  "        } else if (msgCount >= 3) {",
  "          // 3회 이상 재질문 → 불확실 (완전 해결 아닐 가능성)",
  "          catStats[mainCat].uncertain++;",
  "        } else {",
  "          catStats[mainCat].resolved++;",
  "        }",
  "      }",
  "",
  "      // 신뢰도 합산",
  "      g.msgs.forEach(function(m) {",
  "        if (m.confidence && m.confidence > 0) { catStats[mainCat].confSum += m.confidence; catStats[mainCat].confCount++; }",
  "      });",
  "    });"
].join("\n");

if (code.indexOf(oldCalc) > -1) {
  code = code.replace(oldCalc, newCalc);
  console.log("✅ 카테고리 해결률 계산 로직 v2 적용");
} else {
  console.log("❌ 패턴 불일치");
}

// 테이블 헤더에 '불확실' 컬럼 추가
var oldHeader = "<th style=\"padding:8px 6px;color:var(--text-secondary);text-align:center;\">에스컬</th>";
var newHeader = "<th style=\"padding:8px 6px;color:var(--text-secondary);text-align:center;\">에스컬</th>\n      h += '<th style=\"padding:8px 6px;color:var(--text-secondary);text-align:center;\">불확실</th>';";
if (code.indexOf(oldHeader) > -1) {
  // 첫번째만 교체 (AI 모니터링 탭)
  var headerIdx = code.indexOf(oldHeader);
  // AI 모니터링 섹션인지 확인 (카테고리별 해결률 근처)
  var nearContext = code.substring(headerIdx - 200, headerIdx);
  if (nearContext.indexOf('카테고리') > -1) {
    code = code.substring(0, headerIdx) + newHeader + code.substring(headerIdx + oldHeader.length);
    console.log("✅ 테이블 헤더에 '불확실' 컬럼 추가");
  }
}

// 테이블 행에 불확실 수 추가
var oldEscCol = "h += '<td style=\"padding:8px 6px;text-align:center;color:#ef4444;\">' + s.escalated + '</td>';";
var newEscCol = "h += '<td style=\"padding:8px 6px;text-align:center;color:#ef4444;\">' + s.escalated + '</td>';\n        h += '<td style=\"padding:8px 6px;text-align:center;color:#f59e0b;\">' + (s.uncertain || 0) + '</td>';";

// AI 모니터링 탭의 것만 교체
var escColIdx = code.indexOf(oldEscCol);
if (escColIdx > -1) {
  var nearEsc = code.substring(escColIdx - 300, escColIdx);
  if (nearEsc.indexOf('catStats') > -1 || nearEsc.indexOf('catArr') > -1) {
    code = code.substring(0, escColIdx) + newEscCol + code.substring(escColIdx + oldEscCol.length);
    console.log("✅ 테이블 행에 '불확실' 데이터 추가");
  }
}

// 해결률 계산도 수정: resolved / (total - uncertain) 대신 resolved / total 유지하되 표시 방식 변경
// 해결률 = resolved / total (에스컬+불확실 모두 미해결로 간주)

// 상단 요약 카드 기준도 수정
var oldGoodCats = "var goodCats = catArr.filter(function(k){return Math.round((catStats[k].resolved/catStats[k].total)*100) >= 70;}).length;";
var newGoodCats = "var goodCats = catArr.filter(function(k){return catStats[k].total > 0 && Math.round((catStats[k].resolved/catStats[k].total)*100) >= 70;}).length;";
if (code.indexOf(oldGoodCats) > -1) {
  code = code.replace(oldGoodCats, newGoodCats);
}

fs.writeFileSync(file, code);
console.log("\n✅ AI 해결률 계산 개선 완료");
console.log("- 채팅 단위 그룹핑 → 해결/에스컬/불확실 3단계 판정");
console.log("- 해결: 1~2회 메시지 + 신뢰도 0.6+ + 에스컬 없음");
console.log("- 불확실: 재질문 3회+ 또는 신뢰도 낮음");
console.log("- 에스컬: 에스컬레이션 발생");
