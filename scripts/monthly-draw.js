var path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
var fs = require('fs');
var auth = require('../lib/auth');
var axios = require('axios');

var DATA_FILE = path.join(__dirname, '..', 'data', 'csat-feedback-v2.json');
var DRAW_LOG_FILE = path.join(__dirname, '..', 'data', 'csat-draw-log.json');

// 추첨 설정
var PRIZES = [
  { rank: '1등', count: 1, points: 10000 },
  { rank: '2등', count: 3, points: 5000 },
  { rank: '3등', count: 10, points: 1000 }
];

function loadJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch(e) { return []; }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Fisher-Yates shuffle
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

async function findUserById(userId, token) {
  try {
    var h = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
    var res = await axios.get('https://api.veasly.com/admin/users/0/1?query=' + userId + '&queryType=USER_ID', { headers: h });
    var users = res.data.data || res.data.content || [];
    return users.length > 0 ? users[0] : null;
  } catch(e) { return null; }
}

async function givePoints(userId, points, descKR, descTW, descJP, token) {
  var h = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  var expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  var expStr = expiresAt.getFullYear() + '-' + String(expiresAt.getMonth()+1).padStart(2,'0') + '-' + String(expiresAt.getDate()).padStart(2,'0') + ' 23:59:59';

  var res = await axios.post('https://api.veasly.com/admin/credits/' + userId, {
    type: 'EARNED',
    subType: 'ADMIN_ADJUSTMENT',
    amount: points,
    expiresAt: expStr,
    descriptionKR: descKR,
    descriptionTW: descTW,
    descriptionJP: descJP
  }, { headers: h });
  return res.data;
}

var emailLib = require('../lib/email');
async function sendEmail(email, name, rank, points, lang) {
  if (!email) { console.log('[EMAIL] No email, skip'); return false; }
  try {
    await emailLib.sendDrawWinnerEmail(email, name, rank, points, lang);
    return true;
  } catch(e) {
    console.log('[EMAIL] Send failed:', email, e.message);
    return false;
  }
}

async function main() {
  // 전월 계산
  var now = new Date();
  var prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var monthKey = prevMonth.getFullYear() + '-' + String(prevMonth.getMonth() + 1).padStart(2, '0');
  var monthLabel = monthKey;

  console.log('========================================');
  console.log('VEASLY CSAT 월별 추첨 - ' + monthLabel);
  console.log('========================================\n');

  // 전월 설문 데이터 필터링
  var allData = loadJSON(DATA_FILE);
  var monthData = allData.filter(function(d) {
    return d.submittedAt && d.submittedAt.substring(0, 7) === monthKey;
  });

  console.log('전월(' + monthLabel + ') 설문 참여자: ' + monthData.length + '명\n');

  if (monthData.length === 0) {
    console.log('참여자가 없어 추첨을 종료합니다.');
    return;
  }

  // userId 기준 중복 제거 (1인 1회 응모)
  var uniqueUsers = {};
  monthData.forEach(function(d) {
    if (d.userId && !uniqueUsers[d.userId]) {
      uniqueUsers[d.userId] = d;
    }
  });
  var candidates = Object.values(uniqueUsers);
  console.log('중복 제거 후 응모자: ' + candidates.length + '명\n');

  // 셔플 후 추첨
  var shuffled = shuffle(candidates);
  var winners = [];
  var idx = 0;

  for (var p = 0; p < PRIZES.length; p++) {
    var prize = PRIZES[p];
    var count = Math.min(prize.count, shuffled.length - idx);
    for (var c = 0; c < count; c++) {
      winners.push({
        rank: prize.rank,
        points: prize.points,
        userId: shuffled[idx].userId,
        chatId: shuffled[idx].chatId,
        lang: shuffled[idx].lang,
        guestEmail: shuffled[idx].guestEmail || '',
        veaslyId: shuffled[idx].veaslyId || ''
      });
      idx++;
    }
  }

  console.log('당첨자 ' + winners.length + '명:\n');

  // 포인트 지급 + 이메일 발송
  var token = await auth.getToken();
  var drawLog = { month: monthLabel, drawnAt: new Date().toISOString(), totalCandidates: candidates.length, winners: [] };

  for (var w = 0; w < winners.length; w++) {
    var winner = winners[w];
    var findId = winner.veaslyId || winner.userId;
    var user = await findUserById(findId, token);
    var userName = user ? user.name : 'Unknown';
    var userEmail = user ? user.email : '';

    var descKR = 'CSAT 설문 ' + monthLabel + ' ' + winner.rank + ' 당첨 포인트';
    var descTW = 'CSAT問卷 ' + monthLabel + ' ' + winner.rank + ' 中獎點數';
    var descJP = 'CSATアンケート ' + monthLabel + ' ' + winner.rank + ' 当選ポイント';

    try {
      var pointsUserId = winner.veaslyId || winner.userId;
      await givePoints(pointsUserId, winner.points, descKR, descTW, descJP, token);
      console.log('  ' + winner.rank + ' | ' + userName + ' (ID:' + winner.userId + ') | ' + winner.points + 'P | ✅ 지급 완료');

      var finalEmail = userEmail || winner.guestEmail || '';
      if (finalEmail) {
        await sendEmail(finalEmail, userName, winner.rank, winner.points, winner.lang);
      }

      drawLog.winners.push({
        rank: winner.rank,
        userId: winner.userId,
        userName: userName,
        email: userEmail,
        points: winner.points,
        lang: winner.lang,
        pointsGranted: true
      });
    } catch(e) {
      console.log('  ' + winner.rank + ' | ' + userName + ' (ID:' + winner.userId + ') | ❌ 지급 실패: ' + e.message);
      drawLog.winners.push({
        rank: winner.rank,
        userId: winner.userId,
        userName: userName,
        points: winner.points,
        pointsGranted: false,
        error: e.message
      });
    }
  }

  // 로그 저장
  var logs = loadJSON(DRAW_LOG_FILE);
  logs.push(drawLog);
  saveJSON(DRAW_LOG_FILE, logs);

  // 설문 데이터에 추첨 상태 업데이트
  var winnerIds = winners.map(function(w) { return w.userId; });
  allData.forEach(function(d) {
    if (d.submittedAt && d.submittedAt.substring(0, 7) === monthKey) {
      d.rewardStatus = winnerIds.indexOf(d.userId) > -1 ? 'winner' : 'not_selected';
    }
  });
  saveJSON(DATA_FILE, allData);

  console.log('\n========================================');
  console.log('추첨 완료! 로그: data/csat-draw-log.json');
  console.log('========================================');
}

main().catch(function(e) { console.error('추첨 에러:', e); });
