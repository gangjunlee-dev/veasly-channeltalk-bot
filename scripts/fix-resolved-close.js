var fs = require('fs');
var file = '/home/ubuntu/veasly-channeltalk-bot/lib/scheduler.js';
var content = fs.readFileSync(file, 'utf8');

// resolved 시 continue 대신 → 종료 처리로 이동 (긴급 알림 건너뛰기만)
var old = `        var resolveResult = chatResolver.isChatResolved(recentMsgs);
        if (resolveResult.resolved) {
          console.log("[Scheduler] Chat " + closeChatId + " resolved by bot (" + resolveResult.reason + "), skipping manager alert");
          // 정상 종료 처리 (긴급 알림 없이)
          continue;
        }`;

var replacement = `        var resolveResult = chatResolver.isChatResolved(recentMsgs);
        var _isResolved = resolveResult.resolved;
        if (_isResolved) {
          console.log("[Scheduler] Chat " + closeChatId + " resolved by bot (" + resolveResult.reason + "), closing without manager alert");
        }`;

if (content.includes(old)) {
  content = content.replace(old, replacement);
  
  // 매니저 미응답 체크를 !_isResolved 조건으로 감싸기
  var oldMgrCheck = `        // 매니저 미응답 체크 - 한 번도 답변 안 한 채팅은 종료하지 않고 긴급 알림
        try {`;
  var newMgrCheck = `        // 매니저 미응답 체크 - resolved가 아닌 경우에만
        if (!_isResolved) { try {`;
  content = content.replace(oldMgrCheck, newMgrCheck);
  
  // 매니저 미응답 체크 끝나는 부분 찾아서 닫기
  var oldMgrEnd = `        } catch(_closeChkErr) { console.log("[Scheduler] Close check error:", _closeChkErr.message); }`;
  var newMgrEnd = `        } catch(_closeChkErr) { console.log("[Scheduler] Close check error:", _closeChkErr.message); } }`;
  content = content.replace(oldMgrEnd, newMgrEnd);
  
  fs.writeFileSync(file, content, 'utf8');
  console.log('✅ resolved 채팅도 종료+설문 발송하도록 수정 완료');
} else {
  console.log('❌ 패턴 불일치');
  var lines = content.split('\n');
  for (var i = 284; i < 292; i++) {
    console.log('Line ' + (i+1) + ':', lines[i]);
  }
}
