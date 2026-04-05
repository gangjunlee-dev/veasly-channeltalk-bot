/**
 * Phase 3: 문의 분석 엔진
 * 채널톡 채팅 데이터를 수집하고 분류/분석
 */

var channeltalk = require('./channeltalk');

// 문의 카테고리 분류 키워드
var CATEGORIES = {
  shipping: {
    name: '配送相關',
    nameKo: '배송 관련',
    keywords: ['配送', '到貨', '物流', '追蹤', '包裹', '寄到', '沒收到', '超商', '全家', '取貨', 'EZ WAY', '海關', '報關', '實名']
  },
  fee: {
    name: '費用相關',
    nameKo: '비용 관련',
    keywords: ['運費', '費用', '多少錢', '怎麼算', '價格', '太貴', '關稅', '手續費']
  },
  payment: {
    name: '付款相關',
    nameKo: '결제 관련',
    keywords: ['付款', '支付', '信用卡', '刷卡', 'PayPal', 'ATM', '付款失敗', '刷不過', '無法付款']
  },
  cancel: {
    name: '取消/退款',
    nameKo: '취소/환불',
    keywords: ['取消', '退款', '退貨', '取消訂單', '退錢']
  },
  order: {
    name: '訂單查詢',
    nameKo: '주문 조회',
    keywords: ['訂單', '查詢', '狀態', '進度', '沒有更新', '報價', '到哪了']
  },
  howto: {
    name: '使用方式',
    nameKo: '사용 방법',
    keywords: ['怎麼用', '怎麼買', '教學', '如何', '步驟', '代購', '新手', '閃電拍賣', 'BUNJANG']
  },
  points: {
    name: '點數/優惠',
    nameKo: '포인트/쿠폰',
    keywords: ['點數', '折扣', '優惠', '折扣碼', '點數不見', '消失', '團購']
  },
  account: {
    name: '帳號問題',
    nameKo: '계정 문제',
    keywords: ['密碼', '登入', '忘記密碼', '帳號', '無法登入']
  },
  escalation: {
    name: '客服轉接',
    nameKo: '상담사 연결',
    keywords: ['客服', '聯繫', '真人', '人工']
  },
  other: {
    name: '其他',
    nameKo: '기타',
    keywords: []
  }
};

/**
 * 메시지 텍스트를 카테고리로 분류
 */
function classifyMessage(text) {
  if (!text) return 'other';
  var lowerText = text.toLowerCase();
  var bestCategory = 'other';
  var highestScore = 0;

  var catKeys = Object.keys(CATEGORIES);
  for (var i = 0; i < catKeys.length; i++) {
    var cat = catKeys[i];
    if (cat === 'other') continue;
    var score = 0;
    var keywords = CATEGORIES[cat].keywords;
    for (var j = 0; j < keywords.length; j++) {
      if (lowerText.includes(keywords[j].toLowerCase())) {
        score += keywords[j].length;
      }
    }
    if (score > highestScore) {
      highestScore = score;
      bestCategory = cat;
    }
  }
  return bestCategory;
}

/**
 * 최근 채팅 데이터 수집 및 분석
 */
async function analyzeRecentChats(days) {
  days = days || 7;
  var results = {
    totalChats: 0,
    totalMessages: 0,
    userMessages: 0,
    botMessages: 0,
    managerMessages: 0,
    categories: {},
    hourlyDistribution: {},
    avgResponseTime: 0,
    unresolvedChats: 0,
    topKeywords: {},
    period: days + ' days'
  };

  // 카테고리 초기화
  var catKeys = Object.keys(CATEGORIES);
  for (var c = 0; c < catKeys.length; c++) {
    results.categories[catKeys[c]] = { count: 0, name: CATEGORIES[catKeys[c]].name, nameKo: CATEGORIES[catKeys[c]].nameKo };
  }

  // 시간대 초기화
  for (var h = 0; h < 24; h++) {
    results.hourlyDistribution[h] = 0;
  }

  try {
    // 열린 채팅 수집
    var openedChats = await channeltalk.listUserChats('opened', 100);
    var closedChats = await channeltalk.listUserChats('closed', 100);

    var allChats = [];
    if (openedChats && openedChats.userChats) {
      allChats = allChats.concat(openedChats.userChats);
      results.unresolvedChats = openedChats.userChats.length;
    }
    if (closedChats && closedChats.userChats) {
      allChats = allChats.concat(closedChats.userChats);
    }

    var sinceTime = Date.now() - (days * 24 * 60 * 60 * 1000);

    for (var i = 0; i < allChats.length; i++) {
      var chat = allChats[i];
      if (chat.createdAt && chat.createdAt < sinceTime) continue;

      results.totalChats++;

      try {
        var messagesData = await channeltalk.getChatMessages(chat.id, 50);
        var messages = messagesData.messages || [];

        for (var m = 0; m < messages.length; m++) {
          var msg = messages[m];
          results.totalMessages++;

          if (msg.personType === 'user') {
            results.userMessages++;
            var text = msg.plainText || '';
            if (text) {
              var category = classifyMessage(text);
              results.categories[category].count++;

              // 키워드 수집
              var words = text.split(/[\s,.\n]+/);
              for (var w = 0; w < words.length; w++) {
                var word = words[w].trim();
                if (word.length >= 2) {
                  results.topKeywords[word] = (results.topKeywords[word] || 0) + 1;
                }
              }
            }

            // 시간대 분포
            if (msg.createdAt) {
              var hour = new Date(msg.createdAt).getUTCHours();
              var twHour = (hour + 8) % 24;
              results.hourlyDistribution[twHour]++;
            }
          } else if (msg.personType === 'bot') {
            results.botMessages++;
          } else if (msg.personType === 'manager') {
            results.managerMessages++;
          }
        }
      } catch (msgErr) {
        console.error('[Analytics] Error fetching messages for chat ' + chat.id + ':', msgErr.message);
      }
    }

    // 상위 키워드 정렬
    var keywordArray = Object.keys(results.topKeywords).map(function(k) {
      return { word: k, count: results.topKeywords[k] };
    });
    keywordArray.sort(function(a, b) { return b.count - a.count; });
    results.topKeywords = keywordArray.slice(0, 20);

  } catch (err) {
    console.error('[Analytics] Error:', err.message);
  }

  return results;
}

/**
 * 분석 결과를 읽기 쉬운 리포트 텍스트로 변환
 */
function generateReport(results) {
  var report = '=== VEASLY 고객 문의 분석 리포트 ===\n';
  report += '기간: 최근 ' + results.period + '\n';
  report += '생성일: ' + new Date().toISOString().split('T')[0] + '\n\n';

  report += '--- 전체 현황 ---\n';
  report += '총 상담 건수: ' + results.totalChats + '\n';
  report += '총 메시지 수: ' + results.totalMessages + '\n';
  report += '  고객 메시지: ' + results.userMessages + '\n';
  report += '  봇 응답: ' + results.botMessages + '\n';
  report += '  매니저 응답: ' + results.managerMessages + '\n';
  report += '미해결 상담: ' + results.unresolvedChats + '\n\n';

  report += '--- 문의 카테고리 분포 ---\n';
  var catKeys = Object.keys(results.categories);
  var catArray = catKeys.map(function(k) {
    return { key: k, count: results.categories[k].count, name: results.categories[k].nameKo, nameTw: results.categories[k].name };
  });
  catArray.sort(function(a, b) { return b.count - a.count; });
  for (var i = 0; i < catArray.length; i++) {
    if (catArray[i].count > 0) {
      report += '  ' + catArray[i].name + ' (' + catArray[i].nameTw + '): ' + catArray[i].count + '건\n';
    }
  }

  report += '\n--- 시간대별 문의 분포 (대만 시간) ---\n';
  var peakHour = 0;
  var peakCount = 0;
  for (var h = 0; h < 24; h++) {
    var count = results.hourlyDistribution[h] || 0;
    if (count > peakCount) {
      peakCount = count;
      peakHour = h;
    }
    if (count > 0) {
      var bar = '';
      for (var b = 0; b < Math.min(count, 20); b++) bar += '█';
      report += '  ' + (h < 10 ? '0' : '') + h + ':00  ' + bar + ' (' + count + ')\n';
    }
  }
  report += '  피크 시간: ' + peakHour + ':00 (' + peakCount + '건)\n\n';

  report += '--- 자주 언급된 키워드 TOP 10 ---\n';
  var topKw = results.topKeywords.slice(0, 10);
  for (var k = 0; k < topKw.length; k++) {
    report += '  ' + (k + 1) + '. ' + topKw[k].word + ' (' + topKw[k].count + '회)\n';
  }

  report += '\n--- 인사이트 ---\n';
  if (catArray.length > 0 && catArray[0].count > 0) {
    report += '가장 많은 문의: ' + catArray[0].name + ' (' + catArray[0].count + '건)\n';
  }
  if (results.unresolvedChats > 5) {
    report += '⚠️ 미해결 상담 ' + results.unresolvedChats + '건 — 우선 처리 필요\n';
  }
  var botRate = results.totalMessages > 0 ? Math.round((results.botMessages / results.totalMessages) * 100) : 0;
  report += '봇 응답 비율: ' + botRate + '%\n';

  return report;
}

/**
 * 분석 결과를 繁體中文 리포트로도 생성
 */
function generateReportTW(results) {
  var report = '=== VEASLY 客服分析報告 ===\n';
  report += '期間：最近 ' + results.period + '\n';
  report += '產出日：' + new Date().toISOString().split('T')[0] + '\n\n';

  report += '--- 整體概況 ---\n';
  report += '總對話數：' + results.totalChats + '\n';
  report += '總訊息數：' + results.totalMessages + '\n';
  report += '  顧客訊息：' + results.userMessages + '\n';
  report += '  機器人回覆：' + results.botMessages + '\n';
  report += '  客服回覆：' + results.managerMessages + '\n';
  report += '未解決對話：' + results.unresolvedChats + '\n\n';

  report += '--- 問題類別分佈 ---\n';
  var catKeys = Object.keys(results.categories);
  var catArray = catKeys.map(function(k) {
    return { key: k, count: results.categories[k].count, name: results.categories[k].name };
  });
  catArray.sort(function(a, b) { return b.count - a.count; });
  for (var i = 0; i < catArray.length; i++) {
    if (catArray[i].count > 0) {
      report += '  ' + catArray[i].name + '：' + catArray[i].count + ' 則\n';
    }
  }

  return report;
}

module.exports = {
  classifyMessage: classifyMessage,
  analyzeRecentChats: analyzeRecentChats,
  generateReport: generateReport,
  generateReportTW: generateReportTW,
  CATEGORIES: CATEGORIES
};
