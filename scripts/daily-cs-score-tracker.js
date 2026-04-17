#!/usr/bin/env node
/**
 * 일일 CS Score 트렌드 기록
 * - 매일 1회 실행하여 CS Score 및 각 지표를 data/cs-score-history.json에 기록
 * - scheduler.js에서 cron으로 호출
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../data/cs-score-history.json');

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch(e) {}
  return [];
}

function saveHistory(data) {
  // 최대 365일치 보관
  if (data.length > 365) data = data.slice(-365);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function fetchCSScore() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000/api/analytics/cs-score-metrics?days=7', (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          resolve(j);
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function record() {
  try {
    const data = await fetchCSScore();
    if (!data.success || !data.integratedScore) {
      console.log('[CS Score Tracker] API 응답 없음, 기록 건너뜀');
      return;
    }
    
    const history = loadHistory();
    const today = new Date().toISOString().split('T')[0];
    
    // 같은 날짜 이미 있으면 덮어쓰기
    const existIdx = history.findIndex(h => h.date === today);
    const entry = {
      date: today,
      timestamp: new Date().toISOString(),
      score: data.integratedScore.score,
      breakdown: {
        frt: data.integratedScore.breakdown.frt.score,
        fcr: data.integratedScore.breakdown.fcr.score,
        csat: data.integratedScore.breakdown.csat.score,
        ces: data.integratedScore.breakdown.ces.score,
        noReply: data.integratedScore.breakdown.noReply.score
      },
      rawMetrics: {
        frtWithin30: data.frt ? data.frt.within30MinRate : null,
        fcrRate: data.fcr ? data.fcr.rate : null,
        csatAvg: data.csat ? data.csat.average : null,
        cesAvg: data.ces ? data.ces.average : null,
        noReplyRate: data.noReplyClose ? data.noReplyClose.rate : null,
        totalChats: data.frt ? data.frt.totalChats : null
      }
    };
    
    if (existIdx >= 0) {
      history[existIdx] = entry;
    } else {
      history.push(entry);
    }
    
    saveHistory(history);
    console.log('[CS Score Tracker] 기록 완료:', today, 'Score:', entry.score);
  } catch(e) {
    console.error('[CS Score Tracker] 오류:', e.message);
  }
}

// 직접 실행 또는 모듈로 사용
if (require.main === module) {
  record();
} else {
  module.exports = { record };
}
