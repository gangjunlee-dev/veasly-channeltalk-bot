var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var code = fs.readFileSync(file, "utf8");

// 기존 차트 블록 찾기
var oldStart = "html += '<div style=\"color:var(--text-secondary);font-size:13px;margin-bottom:12px;\">📈 일별 추이 (답변수 / 평균응답시간)</div>';";
var oldEnd = "html += '</div></div>';\n      }";

var startIdx = code.indexOf(oldStart);
if (startIdx === -1) { console.log("❌ 차트 시작 못 찾음"); process.exit(1); }

// oldEnd를 startIdx 이후에서 찾기
var searchFrom = startIdx + oldStart.length;
var endIdx = code.indexOf(oldEnd, searchFrom);
if (endIdx === -1) { console.log("❌ 차트 끝 못 찾음"); process.exit(1); }

var oldBlock = code.substring(startIdx, endIdx + oldEnd.length);
console.log("✅ 기존 차트 블록 찾음 (" + oldBlock.length + "bytes)");

var newBlock = `html += '<div style="margin-top:16px;padding:16px;background:var(--bg-primary);border-radius:12px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
        html += '<span style="color:var(--text-secondary);font-size:13px;font-weight:600;">📈 일별 추이</span>';
        html += '<div style="display:flex;gap:12px;font-size:11px;color:var(--text-secondary);">';
        html += '<span>🟦 답변수</span><span style="color:#22c55e;">● 응답시간</span></div></div>';
        
        var maxReplies = 0; var maxRT = 0;
        m.dailyTrend.forEach(function(t) { if (t.replies > maxReplies) maxReplies = t.replies; if (t.avgRT > maxRT) maxRT = t.avgRT; });
        
        // 차트 영역
        html += '<div style="position:relative;height:120px;display:flex;align-items:flex-end;gap:' + (m.dailyTrend.length > 7 ? '2' : '6') + 'px;padding-bottom:28px;">';
        
        m.dailyTrend.forEach(function(t, idx) {
          var barH = maxReplies > 0 ? Math.max(8, Math.round(t.replies / maxReplies * 80)) : 8;
          var rtColor2 = t.avgRT > 120 ? '#ef4444' : t.avgRT > 60 ? '#f59e0b' : '#22c55e';
          var dateLabel = t.date.substring(5);
          
          html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;position:relative;">';
          
          // 막대 위 답변수 (hover 효과용 title만)
          html += '<div style="width:100%;height:' + barH + 'px;background:linear-gradient(180deg,#60a5fa,#3b82f6);border-radius:4px 4px 2px 2px;position:relative;cursor:pointer;transition:opacity 0.2s;" title="' + dateLabel + ' | ' + t.replies + '건 | 응답 ' + t.avgRT + '분">';
          html += '<div style="position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:700;color:var(--text-primary);white-space:nowrap;">' + t.replies + '</div>';
          html += '</div>';
          
          // 응답시간 점 표시 (막대 아래)
          html += '<div style="width:8px;height:8px;border-radius:50%;background:' + rtColor2 + ';margin-top:4px;border:1.5px solid var(--bg-primary);" title="응답시간 ' + t.avgRT + '분"></div>';
          
          // 날짜 라벨 (간격 조절 - 7일 이상이면 짝수만)
          var showLabel = m.dailyTrend.length <= 7 || idx % 2 === 0 || idx === m.dailyTrend.length - 1;
          html += '<div style="position:absolute;bottom:-24px;font-size:' + (m.dailyTrend.length > 10 ? '9' : '10') + 'px;color:var(--text-secondary);white-space:nowrap;' + (showLabel ? '' : 'visibility:hidden;') + '">' + dateLabel + '</div>';
          
          html += '</div>';
        });
        
        html += '</div>';
        
        // 하단 요약 바
        var totalReplies = 0; var totalRT = 0; var rtCount = 0;
        m.dailyTrend.forEach(function(t) { totalReplies += t.replies; if (t.avgRT > 0) { totalRT += t.avgRT; rtCount++; } });
        var avgRT = rtCount > 0 ? Math.round(totalRT / rtCount) : 0;
        var rtSumColor = avgRT > 120 ? '#ef4444' : avgRT > 60 ? '#f59e0b' : '#22c55e';
        
        html += '<div style="display:flex;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid var(--border-primary);font-size:11px;color:var(--text-secondary);">';
        html += '<span>총 <strong style="color:var(--text-primary);">' + totalReplies + '</strong>건</span>';
        html += '<span>평균 응답 <strong style="color:' + rtSumColor + ';">' + avgRT + '분</strong></span>';
        html += '</div>';
        html += '</div>';
      }`;

code = code.substring(0, startIdx) + newBlock + code.substring(endIdx + oldEnd.length);
console.log("✅ 차트 블록 교체 완료");

fs.writeFileSync(file, code, "utf8");
console.log("✅ 파일 저장 완료");
