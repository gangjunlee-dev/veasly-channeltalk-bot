/**
 * 영업시간 유틸리티 모듈
 * 영업시간: 평일(월~금) KST 10:00~19:00
 * 대만 기준: 평일 09:00~18:00
 */

// 2026년 한국 공휴일 (KST 기준)
var KR_HOLIDAYS_2026 = [
  '2026-01-01', // 신정
  '2026-02-16', '2026-02-17', '2026-02-18', // 설날
  '2026-03-01', // 삼일절
  '2026-05-05', // 어린이날
  '2026-05-24', // 부처님오신날
  '2026-06-06', // 현충일
  '2026-08-15', // 광복절
  '2026-09-24', '2026-09-25', '2026-09-26', // 추석
  '2026-10-03', // 개천절
  '2026-10-09', // 한글날
  '2026-12-25'  // 성탄절
];

// 2026년 대만 공휴일 (참고용, CS는 한국 기준으로 운영)
var TW_HOLIDAYS_2026 = [
  '2026-01-01', // 元旦
  '2026-02-14', '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', // 春節
  '2026-02-28', // 和平紀念日
  '2026-04-04', '2026-04-05', '2026-04-06', // 兒童節+清明
  '2026-05-31', // 端午節
  '2026-10-04', '2026-10-05', // 中秋節
  '2026-10-10'  // 國慶日
];

/**
 * KST 기준 Date 객체 반환
 */
function getKST(timestamp) {
  var d = timestamp ? new Date(timestamp) : new Date();
  return new Date(d.getTime() + 9 * 60 * 60 * 1000);
}

/**
 * KST 날짜 문자열 (YYYY-MM-DD) 반환
 */
function getKSTDateString(timestamp) {
  var kst = getKST(timestamp);
  var y = kst.getUTCFullYear();
  var m = ('0' + (kst.getUTCMonth() + 1)).slice(-2);
  var d = ('0' + kst.getUTCDate()).slice(-2);
  return y + '-' + m + '-' + d;
}

/**
 * 해당 timestamp가 한국 공휴일인지 확인
 */
function isKRHoliday(timestamp) {
  var dateStr = getKSTDateString(timestamp);
  return KR_HOLIDAYS_2026.indexOf(dateStr) >= 0;
}

/**
 * 해당 timestamp가 영업시간인지 확인
 * 평일(월~금) KST 10:00~19:00, 공휴일 제외
 */
function isBusinessHours(timestamp) {
  var kst = getKST(timestamp);
  var day = kst.getUTCDay(); // 0=일, 1=월, ..., 6=토
  var hour = kst.getUTCHours();
  
  // 주말 체크
  if (day === 0 || day === 6) return false;
  // 공휴일 체크
  if (isKRHoliday(timestamp || Date.now())) return false;
  // 시간 체크
  return hour >= 10 && hour < 19;
}

/**
 * 다음 영업시간 시작 시각 (ms) 반환
 * 현재가 영업시간이면 현재 시각 반환
 */
function getNextBusinessStart(timestamp) {
  var ts = timestamp || Date.now();
  
  if (isBusinessHours(ts)) return ts;
  
  var kst = getKST(ts);
  // 오늘 KST 10:00으로 설정
  var candidate = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 10, 0, 0));
  // candidate는 KST 기준이므로 실제 UTC로 변환
  var candidateUTC = candidate.getTime() - 9 * 60 * 60 * 1000;
  
  // 이미 오늘 영업시간이 지났으면 내일부터
  if (ts >= candidateUTC + 9 * 60 * 60 * 1000) {
    candidateUTC += 24 * 60 * 60 * 1000;
  }
  
  // 주말/공휴일이면 다음 영업일까지 넘기기 (최대 10일)
  for (var i = 0; i < 10; i++) {
    var checkKST = getKST(candidateUTC);
    var checkDay = checkKST.getUTCDay();
    if (checkDay >= 1 && checkDay <= 5 && !isKRHoliday(candidateUTC)) {
      return candidateUTC;
    }
    candidateUTC += 24 * 60 * 60 * 1000;
  }
  
  return candidateUTC;
}

/**
 * 두 시각 사이의 "영업시간" 경과 시간 (ms) 계산
 * startMs ~ endMs 사이에서 영업시간에 해당하는 시간만 합산
 */
function getBusinessHoursElapsed(startMs, endMs) {
  if (!startMs || !endMs || endMs <= startMs) return 0;
  
  var elapsed = 0;
  var BIZ_START_HOUR = 10; // KST
  var BIZ_END_HOUR = 19;   // KST
  var ONE_DAY = 24 * 60 * 60 * 1000;
  var ONE_HOUR = 60 * 60 * 1000;
  
  // 하루씩 순회 (최대 30일)
  var current = startMs;
  for (var d = 0; d < 30 && current < endMs; d++) {
    var kst = getKST(current);
    var day = kst.getUTCDay();
    var dateStr = getKSTDateString(current);
    
    // 주말이거나 공휴일이면 스킵
    if (day === 0 || day === 6 || KR_HOLIDAYS_2026.indexOf(dateStr) >= 0) {
      // 다음 날 00:00 KST로 이동
      var nextDay = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1, 0, 0, 0));
      current = nextDay.getTime() - 9 * ONE_HOUR;
      continue;
    }
    
    // 이 날의 영업시간 범위 (UTC)
    var bizStartUTC = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), BIZ_START_HOUR, 0, 0)).getTime() - 9 * ONE_HOUR;
    var bizEndUTC = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), BIZ_END_HOUR, 0, 0)).getTime() - 9 * ONE_HOUR;
    
    // 현재 시점이 영업 종료 이후면 다음 날로
    if (current >= bizEndUTC) {
      var nextDay2 = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1, 0, 0, 0));
      current = nextDay2.getTime() - 9 * ONE_HOUR;
      continue;
    }
    
    // 영업 시작 전이면 영업 시작으로 이동
    var effectiveStart = Math.max(current, bizStartUTC);
    var effectiveEnd = Math.min(endMs, bizEndUTC);
    
    if (effectiveEnd > effectiveStart) {
      elapsed += (effectiveEnd - effectiveStart);
    }
    
    // 다음 날로
    var nextDay3 = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1, 0, 0, 0));
    current = nextDay3.getTime() - 9 * ONE_HOUR;
  }
  
  return elapsed;
}

/**
 * 영업시간 경과를 시간 단위로 반환
 */
function getBusinessHoursElapsedInHours(startMs, endMs) {
  return getBusinessHoursElapsed(startMs, endMs || Date.now()) / (60 * 60 * 1000);
}

module.exports = {
  isBusinessHours: isBusinessHours,
  isKRHoliday: isKRHoliday,
  getKST: getKST,
  getKSTDateString: getKSTDateString,
  getNextBusinessStart: getNextBusinessStart,
  getBusinessHoursElapsed: getBusinessHoursElapsed,
  getBusinessHoursElapsedInHours: getBusinessHoursElapsedInHours,
  KR_HOLIDAYS_2026: KR_HOLIDAYS_2026,
  TW_HOLIDAYS_2026: TW_HOLIDAYS_2026
};
