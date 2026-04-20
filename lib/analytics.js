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
    keywords: ['訂單', '주문', '進度', '狀態', '多久', '等了', '天了', '幾天', 'update', '一個禮拜', '到了嗎', '還沒到', '沒收到', '收到了', '哪裡了', '查詢', '查', '筆', '確認', '消息', '還沒有消息', '幫忙確認'],
    regex: /\d{10,}/,
    priority: 2
  },
  shipping: {
    name: '配送相關',
    nameKo: '배송/물류',
    keywords: ['배송', '物流', '配送', '出貨', '發貨', '寄出', '到貨', '快遞', '順豐', '택배', '도착', '집운', '集運', '寄', '合併', '併單', '합배송', '香港', '寄到', '貨運', '包裹', '多久', '還要多久', '一個禮拜', '禮拜', '取貨', '來得及', '趕', '很急', '延', '延期', '延到', '超商'],
    priority: 3
  },
  shipping_fee: {
    name: '國際運費',
    nameKo: '국제배송비/운임',
    keywords: ['國際運費', '운비', '배송비', '運費', '관세', '稅', '報關', '海關', '관부가세', '退嗎', '會再退', '多收費', '再退', '65元', '金額', '重量'],
    priority: 4
  },
  cancel_refund: {
    name: '取消/退款',
    nameKo: '취소/환불/반품',
    keywords: ['취소', '取消', '退款', '退貨', '환불', '반품', '不要了', '先不要發貨', '退回', '沒有退'],
    priority: 5
  },
  payment: {
    name: '付款相關',
    nameKo: '결제/금액',
    keywords: ['결제', '付款', '刷卡', '金額', '價', '元', '費用', '報價', '얼마', '多少', '匯率'],
    priority: 6
  },
  product: {
    name: '商品諮詢',
    nameKo: '상품문의/불량/교환',
    keywords: ['商品', '상품', '壞', '不能用', '損', '瑕疵', '品質', '색상', '色差', '換貨', '교환', '包包', '사이즈', '찾', '找', '有賣', '還有', '有沒有', '有嗎', '庫存', '재고', '구매', '開箱', '拍照', '影片', '品', '電子', '產品', '買嗎', '缺貨', '補貨', '上架', '連結', '購買', '拆解', '配件', '公克', '公斤', '販售', '化妝', '牽繩', '開團', '星巴克', '限定', '賣家', '壞掉', '記憶卡', '相機', '受損', '變形', '檢查', '這款'],
    priority: 7
  },
  account: {
    name: '帳號問題',
    nameKo: '계정/로그인',
    keywords: ['登', '帳號', '會員', '계정', '密碼', '信箱', 'email', '이메일', '修改', 'EZ WAY', 'EZWAY', '실명', '認證', '申報', '登不了', '填錯', '信箱填錯', '註冊'],
    priority: 8
  },
  howto: {
    name: '使用方式',
    nameKo: '사이트이용/주문방법',
    keywords: ['下訂', '無法', '怎麼', '如何', '방법', '使用', '操作', '어떻게', '下單', '線上', '可以嗎', '교환', '辦法', '代購', '重試', '跳出', '給我', '無法下訂', '何時會改', '顯示'],
    priority: 9
  },
  agent_request: {
    name: '轉接客服',
    nameKo: '상담사 전환요청',
    keywords: ['客服', '真人', '상담', '人工', '幫我', '轉接', '연결', '客房'],
    priority: 10
  },
  complaint: {
    name: '客訴/不滿',
    nameKo: '클레임/불만',
    keywords: ['投訴', '差評', '很爛', '太慢', '太久', '拖了', '별로', '왜', '為什麼', '不滿', '失望', '多收', '被騙', '誇張', '離譜', '生氣', '처리', '問題', '沒有提到', '不知道', '完全沒有', '回覆', '不智能', '傻眼', '混亂', '多收錢', '沒有處理', '不合理', '受害者', '沒有主動', '不太對', '氣死', '太爛', '怎樣啊', '到底', '好久', '卡了'],
    priority: 10.5
  },
  greeting: {
    name: '問候/感謝',
    nameKo: '인사/감사',
    keywords: ['你好', '妳好', '您好', '안녕', 'hello', 'hi', '嗨', '哈囉', '감사', '谢谢', '謝謝', '감사합니다', '고마워', '感謝', '在嗎', '請問', '不好意思', '了解', '好的', '知道了', '好喔', '好哦', '好吧', '嗯', '嗯嗯', '對', '是的', '收到', 'OK', 'ok'],
    priority: 11
  },
  points: {
    name: '點數/優惠',
    nameKo: '포인트/쿠폰',
    keywords: ['포인트', '점수', '優惠', '折扣', '쿠폰', '優惠碼', '點數', 'credit', '仟分', '扣減', '退返'],
    priority: 12
  },
  sticker: {
    name: '貼圖/表情',
    nameKo: '스티커/이모지',
    keywords: ['sticker', '貼圖', '表情', '스티커', '[Image', 'image]', '圖片', '照片', '사진'],
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
  
  // -1순위: 초단문 확인/단답 메시지 → greeting
  var trimmed = text.trim();
  var shortConfirms = ['好','好的','嗯','嗯嗯','對','是','是的','知道了','了解','收到','好喔','好哦','好吧','ok','OK','okok','Ok','謝了','感謝','辛苦了','沒問題','可以','好噢','對啊','明白','沒錯','結束','可以接受','麻煩你','打分','唔好意思'];
  for (var sc = 0; sc < shortConfirms.length; sc++) {
    if (trimmed === shortConfirms[sc] || trimmed.toLowerCase() === shortConfirms[sc].toLowerCase()) return 'greeting';
  }
  // -0.5순위: 시스템 메시지/이메일 인용/봇 메시지 → greeting(노이즈 제거)
  if (/mail\.channel\.io|從我的iPhone傳送|Sent via Channe|Veasly小幫手|VEASLY\s*:|寫道：|寶貴意見|請輸入數字/i.test(text)) return 'greeting';
  // -0.4순위: CSAT 설문 응답 (1非常滿意, 2️⃣滿意 등)
  if (/^[1-5]?\s*(非常滿意|滿意|普通|不滿意|非常不滿意|️⃣)/i.test(trimmed)) return 'greeting';
  // -0.3순위: URL 링크 → 분류 맥락 없으면 product(상품 링크 가능성)
  if (/^https?:\/\//i.test(trimmed)) {
    if (/bunjang|veasly|globalbunjang/i.test(trimmed)) return 'product';
    if (/tappay|pay/i.test(trimmed)) return 'payment';
    return 'product';
  }
  // -0.2순위: 대만 주소/수령인 패턴
  if (/[台臺](北|中|南|東)|新北|桃園|高雄|嘉義|新竹|彰化|屏東|花蓮|宜蘭|基隆|雲林|南投|苗栗|澎湖|收$|號$/i.test(trimmed)) return 'address';
  // -0.1순위: 이메일 주소 포함 → account
  if (/@.*\.(com|io|net|org)/i.test(trimmed)) return 'account';
  // 순수 주문번호만 입력한 경우 → order_status
  if (/^(TW|HK)?\d{6,}$/i.test(trimmed) || /^\d{8}(TW|HK)\d+$/i.test(trimmed)) return 'order_status';
  // 여러 줄 주문번호
  if (/\d{8}(TW|HK)\d+/i.test(text) && text.split('\n').length >= 2) return 'order_status';
  // 순수 숫자/초단문(1자 이하, 의미없는 입력) → other 빠르게 처리
  if (/^[1-5]$/.test(trimmed)) return 'greeting'; // CSAT 숫자응답
  if (trimmed.length <= 1 && !/[\u4e00-\u9fff\uac00-\ud7af]/.test(trimmed)) return 'other';

  // 0순위: 멀티라인 주문번호 감지
  if (/TW\d{6,}|HK\d{6,}|\d{8}TW\d+|\d{8}HK\d+/i.test(text)) return 'order_status';
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
    systemMessages: 0,
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
    }
    if (closedChats && closedChats.userChats) {
      allChats = allChats.concat(closedChats.userChats);
    }

    var sinceTime = Date.now() - (days * 24 * 60 * 60 * 1000);

    for (var i = 0; i < allChats.length; i++) {
      var chat = allChats[i];
      var chatActive = chat.updatedAt || chat.closedAt || chat.createdAt; if (chatActive && chatActive < sinceTime && chat.createdAt < sinceTime) continue;

      var _hadRecentMsg = false; var _hadUserMsg = false; var _tmpTotal = 0; var _tmpUser = 0; var _tmpBot = 0; var _tmpSys = 0; var _tmpMgr = 0;

      // 채널 통계는 아래 _hadUserMsg 체크 후 집계

      try {
        var messagesData = await channeltalk.getChatMessages(chat.id, 50);
        var messages = messagesData.messages || [];

        for (var m = 0; m < messages.length; m++) {
          var msg = messages[m];
          if (msg.createdAt && msg.createdAt < sinceTime) continue;
          _hadRecentMsg = true;
          _tmpTotal++;

          if (msg.personType === 'user') {
            _tmpUser++; _hadUserMsg = true;
            var text = msg.plainText || '';
            {
              var category = text.trim() ? classifyMessage(text) : 'sticker';
              results.categories[category].count++;

              // 키워드 수집 (노이즈 필터링)
              var kwText = text.replace(/https?:\/\/[^\s]+/g, '').replace(/\[Image[^\]]*\]/gi, '').replace(/mail\.channel\.io[^\s]*/g, '').replace(/從我的iPhone[^\n]*/g, '').replace(/寫道[：:]/g, '').replace(/[：:；;！!？?。，,、～~()（）「」【】]/g, ' ');
              // 중국어 2~6자 단어 추출
              var zhWords = kwText.match(/[\u4e00-\u9fff]{2,6}/g) || [];
              // 영문/숫자 단어 추출
              var enWords = kwText.split(/[\s,.\/\n()\[\]]+/).filter(function(w) { return w.length >= 2; });
              var allWords = zhWords.concat(enWords);
              // 불용어 필터
              var stopwords = ['emoji', '再麻煩了', '的部分應該是', '沒有了', '看到', '不知道', '可能', '好像', '覺得', '希望', '需要', '已經',  '了嗎', '我在', '一樣', '因為', '應該', '部分', '這樣', '那邊', '目前', '想說', '想問', '就是', '還有', '之前', '後來', '到底', '怎麼辦',  '感謝回覆', '如附圖', '附圖', '麻煩了', '麻煩您', '辛苦', '拜託', '感恩', '好的謝謝', '謝謝您', '不客氣', '沒關係', '抱歉', '了解了', '知道了', '明白',  '辛苦了', '對嗎', '成功', '因為在下單後', '好的', '了解', '沒問題', '收到', '感謝', '謝謝你', '不好意思', '請問', '你好', '嗯嗯', '哈哈', '是的', '對啊', '好喔', '沒有', '可以', '不是', '怎麼', '這個', '那個', '已經', '但是', '然後', '所以', '如果', '因為', '下單後', '的','了','我','是','有','不','嗎','也','會','要','都','在','這','那','就','跟','很','吧','喔','呢','啊','但','還','可以','沒有','已經','因為','所以','如果','或者','然後','什麼','他們','我們','這個','那個','一下','一個','好的','沒關係','知道','對方','其他','以上','一直','比較','目前','之前','後來','然後','不是','為什麼','VEASLY','veasly','Veasly','team','mail','channel','Channel','Talk','iPhone','傳送','寫道','email','com','via','Sent','Channe','net','org','http','https','www','image','Image','png','jpg','gif','pdf','io','5d7z2','LINE','line','app','from','the','and','for','you','your','this','that','with','have','will','not','are','was','but','can','get','all','been','had','her','his','how','its','may','new','now','old','our','out','own','say','she','too','use','way','who','why','did','do','does','from','go','has','he','him','it','me','my','no','or','so','to','up','us','we','小幫手','寶貴意見','請輸入','數字','非常滿意','滿意','普通','不滿意','감사합니다','고마워','안녕','你好','妳好','您好','嗨','哈囉','hello','hi','Hi','謝謝','感謝','謝謝您','好的謝謝','了解','收到','是的','沒錯','好喔','好哦','好吧','對啊','明白','嗯','嗯嗯','沒問題','麻煩','麻煩你','不好意思','唔好意思','辛苦','打分','結束','對','好','OK','ok','스티커를','전송했습니다','전송','스티커','보냈습니다','이미지를','사진을','好的了解','好的謝謝您','好的感謝','好的收到','請問','謝謝你','不好意思','了解了','知道了','好喔謝謝','好的了','客服','真人客服','真人','人工客服','訂單編號','訂單號碼','訂單號','訂單','請問訂單號'];
              var kwBlacklist = /^\d+$|^[A-Z]{2}\d{6,}|^\d{8}[A-Z]{2}|^TW\d|^HK\d/i;
              
    // === 키워드 동의어 그룹 ===
    var synonymGroups = {
      '訂單(주문)': ['訂單編號', '訂單號碼', '請問訂單號', '訂單號', '訂單', '订单', '單號', '合併訂單', '我要合併訂單', '要合併的訂單', '合併', '拆單', '關於訂單號碼', '關於訂單', '我的訂單', '合併寄送', '一起寄', '合寄'],
      '客服(상담사)': ['客服', '真人客服', '客服人員', '轉接客服', '人工客服'],
      '物流更新(배송현황)': ['物流沒有更新', '怎麼都沒有更新狀態', '怎麼都沒有更', '新狀態', '的進度', '物流更新', '沒有更新', '更新狀態', '更新', '物流進度', '配送進度', '寄出了嗎', '什麼狀況', '什麼狀況嗎', '起寄出', '寄出', '開始配送', '會出貨', '出貨', '出貨了嗎', '已出貨', '發貨', '發往', '指定地', '顯示發往'],
      '退款(환불)': ['退款', '退回', '退錢', '退費', '取消', '無退款', '沒退款', '未退款', '取消訂單', '我想取消訂單', '想取消', '要取消'],
      '運費(배송비)': ['運費', '國際運費', '運送費', '免運', '韓國國內運費', '國內運費', '運費問題', '公斤', '重量'],
      '到貨時間(배송기간)': ['到貨', '幾天', '多久', '來得及', '期了', '什麼時候到', '什麼時候寄', '預計到貨', '到貨時間', '快到了嗎', '還要多久', '是還沒到嗎', '還沒到', '沒到', '還沒收到', '天了', '好幾天', '等很久', '請問什麼時候', '若超過', '超過', '期限'],
      '處理進度(처리현황)': ['處理中', '處理進度', '幫忙確認', '可以幫忙', '確認一下', '麻煩你們確認', '麻煩你們確認一下', '麻煩確認', '想詢問', '我想詢問一下', '請問一下', '方便查詢', '幫我查', '查一下', '查詢一下', '想詢問是否', '想詢問', '詢問'],
            '收費問題(요금문제)': ['被收了', '但我被收了', '多收', '收費', '扣款', '金額不對', '拔卡', '他要求拔卡', '刷卡', '付款失敗', '還是不能用', '不能用', '價格不同', '價格', '兩項產品', '兩筆', '金額', '費用', '韓元', '點數', '折扣', '優惠', '折價券', '折抵'],
      '聯絡方式(연락처)': ['電話', '電話號碼', '聯絡', '聯繫方式', 'email', 'LINE', '信箱', '寄件人', '收件人', '地址', '聯繫我們', '怎麼聯繫', '聯絡方式'],
      '網站(웹사이트)': ['網站', '網頁', '官網'],
      '商品諮詢(상품문의)': ['商品', '購買', '買到', '缺貨', '有貨', '補貨', '上架', '韓國賣', '賣家', '星巴克', '這件', '想買', '能買', '玩具', '系列']
    };
    var synonymMap = {};
    Object.keys(synonymGroups).forEach(function(rep) {
      synonymGroups[rep].forEach(function(w) { synonymMap[w] = rep; });
    });

              for (var w = 0; w < allWords.length; w++) {
                var word = allWords[w].trim();
                if (word.length < 2 || word.length > 10) continue;
                if (stopwords.indexOf(word) > -1) continue;
                if (kwBlacklist.test(word)) continue;
                // 정확 매칭 먼저, 없으면 부분 포함 매칭
                if (synonymMap[word]) {
                  word = synonymMap[word];
                } else {
                  var synKeys = Object.keys(synonymMap);
                  for (var sk = 0; sk < synKeys.length; sk++) {
                    if (word.indexOf(synKeys[sk]) >= 0 || synKeys[sk].indexOf(word) >= 0) {
                      word = synonymMap[synKeys[sk]];
                      break;
                    }
                  }
                }
                results.topKeywords[word] = (results.topKeywords[word] || 0) + 1;
              }
            }

            // 시간대 분포
            if (msg.createdAt) {
              var hour = new Date(msg.createdAt).getUTCHours();
              var twHour = (hour + 8) % 24;
              results.hourlyDistribution[twHour]++;
            }
          } else if (msg.personType === 'bot') {
            var _botText = '';
            if (msg.blocks) _botText = msg.blocks.map(function(b){return b.value||'';}).join(' ');
            else if (msg.plainText) _botText = String(msg.plainText);
            var _sysKW = ['想聽聽您的寶貴意見','超過48小時','自動種료','자동 종료','추가 메시지가 없어','Please leave your contact','感謝您的訪問','感謝您的耐心等待','正在為您轉接','非常困難','非常容易','點數可以使用','您目前有'];
            var _isSys = _sysKW.some(function(kw) { return _botText.indexOf(kw) >= 0; });
            if (_isSys) _tmpSys++;
            else _tmpBot++;
          } else if (msg.personType === 'manager') {
            _tmpMgr++;
          }
        }
        if (_hadUserMsg) {
          results.totalChats++;
          results.totalMessages += _tmpTotal;
          results.userMessages += _tmpUser;
          results.botMessages += _tmpBot;
          results.systemMessages += _tmpSys;
          results.managerMessages += _tmpMgr;
          if (chat.source && chat.source.medium && chat.source.medium.mediumType === "app") results.channelStats.line++;
          else if (chat.source && chat.source.medium && chat.source.medium.mediumType === "native") results.channelStats.web++;
          else results.channelStats.other++;
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
