var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");

// 기존: rd.scores.forEach로 직접 평균 계산하는 블록
var oldBlock = [
  "      // AI Quality Scores (if available)",
  "      if (rd && rd.count > 0) {",
  "        var avg = { resolution: 0, attitude: 0, accuracy: 0, responsiveness: 0, professionalism: 0, total: 0 };",
  "        rd.scores.forEach(function(s) {",
  "          avg.resolution += (s.resolution || 0);",
  "          avg.attitude += (s.attitude || 0);",
  "          avg.accuracy += (s.accuracy || 0);",
  "          avg.responsiveness += (s.responsiveness || 0);",
  "          avg.professionalism += (s.professionalism || 0);",
  "          avg.total += (s.totalScore || 0);",
  "        });",
  "        var n = rd.count;",
  "        html += '<div style=\"margin-top:16px;padding-top:16px;border-top:1px solid var(--border-primary);\">';",
  "        html += '<div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;\"><span style=\"color:var(--text-secondary);font-size:13px;\">AI 품질 채점 (' + n + '건 분석)</span>';",
  "        var aiTotal = (avg.total / n);",
  "        var aiClass = aiTotal >= 20 ? 'score-high' : aiTotal >= 15 ? 'score-mid' : 'score-low';",
  "        html += '<span class=\"score-badge ' + aiClass + '\">' + aiTotal.toFixed(1) + '/25</span></div>';",
  "        html += '<div class=\"radar-scores\">';",
  "        html += radarItem('문제해결 💡', (avg.resolution/n).toFixed(1));",
  "        html += radarItem('응대태도 🤝', (avg.attitude/n).toFixed(1));",
  "        html += radarItem('정보정확 ✅', (avg.accuracy/n).toFixed(1));",
  "        html += radarItem('응답속도 ⏱️', (avg.responsiveness/n).toFixed(1));",
  "        html += radarItem('전문성 🎓', (avg.professionalism/n).toFixed(1));",
  "        html += '</div></div>';",
  "      } else {",
  "        html += '<div style=\"margin-top:12px;padding:12px;background:var(--bg-primary);border-radius:8px;color:var(--text-secondary);font-size:13px;text-align:center;\">AI 품질 채점 데이터 수집 중...</div>';",
  "      }"
].join("\n");

// 새 버전: 이미 계산된 평균값 직접 사용
var newBlock = [
  "      // AI Quality Scores (from ai-review-summary API)",
  "      if (rd && rd.count > 0) {",
  "        var aiTotal = rd.avgTotal || 0;",
  "        var aiClass = aiTotal >= 20 ? 'score-high' : aiTotal >= 15 ? 'score-mid' : 'score-low';",
  "        html += '<div style=\"margin-top:16px;padding-top:16px;border-top:1px solid var(--border-primary);\">';",
  "        html += '<div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;\"><span style=\"color:var(--text-secondary);font-size:13px;\">AI 품질 채점 (' + rd.count + '건 분석)</span>';",
  "        html += '<span class=\"score-badge ' + aiClass + '\">' + aiTotal.toFixed(1) + '/25</span></div>';",
  "        html += '<div class=\"radar-scores\">';",
  "        html += radarItem('문제해결 💡', (rd.avgResolution || 0).toFixed(1));",
  "        html += radarItem('응대태도 🤝', (rd.avgAttitude || 0).toFixed(1));",
  "        html += radarItem('정보정확 ✅', (rd.avgAccuracy || 0).toFixed(1));",
  "        html += radarItem('응답속도 ⏱️', (rd.avgResponsiveness || 0).toFixed(1));",
  "        html += radarItem('전문성 🎓', (rd.avgProfessionalism || 0).toFixed(1));",
  "        html += '</div></div>';",
  "      } else {",
  "        html += '<div style=\"margin-top:12px;padding:12px;background:var(--bg-primary);border-radius:8px;color:var(--text-secondary);font-size:13px;text-align:center;\">AI 품질 채점 데이터 수집 중...</div>';",
  "      }"
].join("\n");

if (code.indexOf(oldBlock) > -1) {
  code = code.replace(oldBlock, newBlock);
  fs.writeFileSync(file, code);
  console.log("✅ 매니저 카드 AI 점수 표시 수정 완료");
} else {
  console.log("❌ 패턴 불일치 - 수동 확인 필요");
  // 디버깅: 핵심 패턴 존재 확인
  console.log("  rd.scores.forEach 존재:", code.indexOf("rd.scores.forEach") > -1);
  console.log("  AI Quality Scores 존재:", code.indexOf("// AI Quality Scores") > -1);
}
