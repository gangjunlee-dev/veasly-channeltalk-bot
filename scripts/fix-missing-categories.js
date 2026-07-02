var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/routes/webhook.js";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// type → category 매핑 (type으로 자동 분류)
var fixes = [
  // 703: csat_feedback
  {
    old: "type: 'csat_feedback', userMessage: reasonText, aiResponse: 'CSAT feedback recorded', escalated: false, confidence: 1.0 }",
    new: "type: 'csat_feedback', userMessage: reasonText, aiResponse: 'CSAT feedback recorded', escalated: false, confidence: 1.0, category: 'other' }"
  },
  // 733: ces_response
  {
    old: "type: 'ces_response', userMessage: cesText, aiResponse: 'CES score: ' + cesNum, escalated: false, confidence: 1.0 }",
    new: "type: 'ces_response', userMessage: cesText, aiResponse: 'CES score: ' + cesNum, escalated: false, confidence: 1.0, category: 'other' }"
  },
  // 885: thank_you
  {
    old: 'type: "thank_you", userMessage: userText, aiResponse: "감사 응답", escalated: false, confidence: 1.0 }',
    new: 'type: "thank_you", userMessage: userText, aiResponse: "감사 응답", escalated: false, confidence: 1.0, category: "greeting" }'
  },
  // 911: greeting
  {
    old: 'type: "greeting", userMessage: userText, aiResponse: "인사 응답 + 메뉴 제공"',
    new: 'type: "greeting", userMessage: userText, category: "greeting", aiResponse: "인사 응답 + 메뉴 제공"'
  },
  // 1180: file_message
  {
    old: 'type: "file_message", userMessage: userText, aiResponse: "파일/이미지 수신 안내", escalated: false, confidence: 0.5 }',
    new: 'type: "file_message", userMessage: userText, aiResponse: "파일/이미지 수신 안내", escalated: false, confidence: 0.5, category: "other" }'
  },
  // 1272: order_lookup (복수)
  {
    old: 'type: "order_lookup", userMessage: userText.substring(0, 200), aiResponse: "복수 주문조회: " + orderMatches.length + "건 (" + successCount + "건 성공)", escalated: false, confidence: 0.8 }',
    new: 'type: "order_lookup", userMessage: userText.substring(0, 200), aiResponse: "복수 주문조회: " + orderMatches.length + "건 (" + successCount + "건 성공)", escalated: false, confidence: 0.8, category: "order" }'
  },
  // 1489: order_list
  {
    old: 'type: "order_list", userMessage: userText, aiResponse: "주문 목록 " + recentOrders.length + "건 조회", escalated: false, confidence: 0.8 }',
    new: 'type: "order_list", userMessage: userText, aiResponse: "주문 목록 " + recentOrders.length + "건 조회", escalated: false, confidence: 0.8, category: "order" }'
  },
  // 1507: order_list fallback
  {
    old: 'type: "order_list", userMessage: userText, aiResponse: "userId fallback 주문조회 " + _fbRecent.length + "건", escalated: false, confidence: 0.8 }',
    new: 'type: "order_list", userMessage: userText, aiResponse: "userId fallback 주문조회 " + _fbRecent.length + "건", escalated: false, confidence: 0.8, category: "order" }'
  },
  // 1535: shipping_status
  {
    old: 'type: "shipping_status", userMessage: userText.substring(0, 200), aiResponse: "실시간 배송추적 " + _activeOrders.length + "건", escalated: false, confidence: 0.9 }',
    new: 'type: "shipping_status", userMessage: userText.substring(0, 200), aiResponse: "실시간 배송추적 " + _activeOrders.length + "건", escalated: false, confidence: 0.9, category: "shipping" }'
  },
  // 1590: ai_answer (오프시간 low-confidence)
  {
    old: 'escalationReason: "off_hour_low_confidence", confidence: confidence }',
    new: 'escalationReason: "off_hour_low_confidence", confidence: confidence, category: (aiResult && aiResult.category) || "other" }'
  },
  // 1632: ai_answer (오프시간 medium-confidence)
  {
    old: 'escalationReason: "off_hour_medium_confidence", confidence: confidence }',
    new: 'escalationReason: "off_hour_medium_confidence", confidence: confidence, category: (aiResult && aiResult.category) || "other" }'
  },
  // 1650: ai_error
  {
    old: 'type: "ai_error", userMessage: userText.substring(0, 200), aiResponse: "AI Error: " + aiErr.message, escalated: false, confidence: 0 }',
    new: 'type: "ai_error", userMessage: userText.substring(0, 200), aiResponse: "AI Error: " + aiErr.message, escalated: false, confidence: 0, category: "other" }'
  }
];

fixes.forEach(function(f, i) {
  if (code.indexOf(f.old) > -1) {
    code = code.replace(f.old, f.new);
    changes++;
    console.log("  ✅ [" + (i+1) + "] category 추가 완료");
  } else {
    console.log("  ⚠️ [" + (i+1) + "] 패턴 못 찾음 (이미 수정?)");
  }
});

// 대시보드 카테고리 매핑 확장 + 병합맵 업데이트
var dashFile = "/home/ubuntu/veasly-channeltalk-bot/public/dashboard.html";
var dash = fs.readFileSync(dashFile, "utf8");
var dashChanges = 0;

// catNameKo 매핑 확장
var oldMapping = "'other':'기타','unknown':'미분류'";
var newMapping = "'other':'기타','unknown':'미분류','payment_mismatch':'결제금액 불일치','price_inquiry':'가격문의','cancel_reason':'취소사유','quote_request':'견적/보가요청','merge_shipping':'합배송요청','file_message':'파일/이미지','shipping_status':'배송추적','order_list':'주문목록조회'";

if (dash.indexOf(oldMapping) > -1) {
  dash = dash.replace(oldMapping, newMapping);
  dashChanges++;
  console.log("\n  ✅ [D1] catNameKo 한글 매핑 확장");
}

// mergeMap에 추가 병합 규칙
var oldMerge = "var mergeMap = {'cancel':'cancel_refund','fee':'shipping_fee','escalation':'agent_request'};";
var newMerge = "var mergeMap = {'cancel':'cancel_refund','fee':'shipping_fee','escalation':'agent_request','shipping_status':'shipping','order_list':'order','order_status':'order','price_inquiry':'product','cancel_reason':'cancel_refund','file_message':'other'};";

if (dash.indexOf(oldMerge) > -1) {
  dash = dash.replace(oldMerge, newMerge);
  dashChanges++;
  console.log("  ✅ [D2] mergeMap 병합 규칙 확장");
}

fs.writeFileSync(file, code, "utf8");
fs.writeFileSync(dashFile, dash, "utf8");
console.log("\n✅ webhook.js: " + changes + "개 category 추가");
console.log("✅ dashboard.html: " + dashChanges + "개 매핑 변경");
