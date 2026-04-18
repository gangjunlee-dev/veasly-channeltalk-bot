/**
 * Phase 3: 문의 분석 엔진
 * 채널톡 채팅 데이터를 수집하고 분류/분석
 */

var channeltalk = require('./channeltalk');

// 문의 카테고리 분류 키워드
var CATEGORIES = {
  agent_direct: {
    name: '客服(單字)',
    nameKo: '상담사 직접요청',
    keywords: [],
    regex: /^客服$|^상담사$|^상담원$|^真人$|^人工$/i,
    priority: 1
  },
  order_status: {
    name: '訂單查詢',
    nameKo: '주문 상태/조회',
    keywords: ['訂單', '주문', '進度', '狀態', '多久', '等了', '天了', '幾天', 'update', '一個禮拜', '到了嗎', '還沒到', '沒收到', '收到了', '哪裡了'],
    regex: /\d{10,}/,
    priority: 2
  },
  shipping: {
    name: '配送相關',
    nameKo: '배송/물류',
    keywords: ['배송', '物流', '配送', '出貨', '發貨', '寄出', '到貨', '快遞', '順豐', '택배', '도착', '집운', '集運', '寄', '合併', '併單', '합배송', '香港', '寄到'],
    priority: 3
  },
  shipping_fee: {
    name: '國際運費',
    nameKo: '국제배송비/운임',
    keywords: ['國際運費', '운비', '배송비', '運費', '관세', '稅', '報關', '海關', '관부가세'],
    priority: 4
  },
  cancel_refund: {
    name: '取消/退款',
    nameKo: '취소/환불/반품',
    keywords: ['취소', '取消', '退款', '退貨', '환불', '반품', '不要了', '先不要發貨'],
    priority: 5
  },
  payment: {
    name: '付款相關',
    nameKo: '결제/금액',
    keywords: ['결제', '付款', '刷卡', '金額', '價', '元', '費用', '報價', '얼마', '多少'],
    priority: 6
  },
  product: {
    name: '商品諮詢',
    nameKo: '상품문의/불량/교환',
    keywords: ['商品', '상품', '壞', '不能用', '損', '瑕疵', '品質', '색상', '色差', '換貨', '교환', '包包', '사이즈', '찾', '找', '有賣', '還有', '有沒有', '有嗎', '庫存', '재고', '구매'],
    priority: 7
  },
  account: {
    name: '帳號問題',
    nameKo: '계정/로그인',
    keywords: ['登', '帳號', '會員', '계정', '密碼', '信箱', 'email', '이메일', '修改', 'EZ WAY', 'EZWAY', '실명', '認證', '申報'],
    priority: 8
  },
  howto: {
    name: '使用方式',
    nameKo: '사이트이용/주문방법',
    keywords: ['下訂', '無法', '怎麼', '如何', '방법', '使用', '操作', '어떻게', '下單', '線上', '可以嗎', '교환'],
    priority: 9
  },
  agent_request: {
    name: '轉接客服',
    nameKo: '상담사 전환요청',
    keywords: ['客服', '真人', '상담', '人工', '幫我', '轉接', '연결'],
    priority: 10
  },
  greeting: {
    name: '問候/感謝',
    nameKo: '인사/감사',
    keywords: ['你好', '妳好', '您好', '안녕', 'hello', 'hi', '嗨', '哈囉', '감사', '谢谢', '謝謝', '감사합니다', '고마워', '感謝', '在嗎', '請問', '不好意思'],
    priority: 11
  },
  points: {
    name: '點數/優惠',
    nameKo: '포인트/쿠폰',
    keywords: ['포인트', '점수', '優惠', '折扣', '쿠폰', '優惠碼', '點數', 'credit'],
    priority: 12
  },
  sticker: {
    name: '貼圖/表情',
    nameKo: '스티커/이모지',
    keywords: ['sticker', '貼圖', '表情', '스티커'],
    priority: 13
  },
  address: {
    name: '地址/收件',
    nameKo: '주소/수령',
    keywords: ['地址', '주소', '收件', '수령', '배달', '寄送地', '수령지'],
    priority: 14
  },
  other: {
    name: '其他',
    nameKo: '기타',
    keywords: [],
    priority: 99
  }
};

/**
 * 메시지 텍스트를 카테고리로 분류
 */
function classifyMessage(text) {
  if (!text) return 'other';
  var msg = text.toLowerCase();
  
  // 0순위: 멀티라인 주문번호 감지
  if (/TW\d{6,}|\d{8}TW\d+/i.test(text)) return 'order_status';
  // 1순위: regex 매칭 (agent_direct 등)
  var catKeys2 = Object.keys(CATEGORIES);
  for (var p = 0; p < catKeys2.length; p++) {
    var c2 = CATEGORIES[catKeys2[p]];
    if (c2.regex && c2.regex.test(msg.trim())) return catKeys2[p];
  }
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
    channelStats: { line: 0, web: 0, other: 0 },
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
      var now = Date.now(); var realOpened = openedChats.userChats.filter(function(c) { return (now - (c.openedAt || c.createdAt)) < 48 * 60 * 60 * 1000; }); results.unresolvedChats = realOpened.length;
      openedChats.userChats.forEach(function(ch) { if (ch.source && ch.source.medium && ch.source.medium.mediumType === "app") results.channelStats.line++; else if (ch.source && ch.source.medium && ch.source.medium.mediumType === "native") results.channelStats.web++; else results.channelStats.other++; });
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
