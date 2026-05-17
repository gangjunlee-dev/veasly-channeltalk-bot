var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/data/ai-conversations.json";
var data = JSON.parse(fs.readFileSync(file, "utf8"));

var typeToCategory = {
  "greeting": "greeting",
  "thank_you": "greeting",
  "csat_feedback": "other",
  "ces_response": "other",
  "order_lookup": "order",
  "order_list": "order",
  "shipping_status": "shipping",
  "file_message": "other",
  "ai_answer": "other",
  "ai_error": "other",
  "unanswered": "other",
  "escalation": "agent_request"
};

var fixed = 0;
var total = data.length;
var noCat = 0;

data.forEach(function(d) {
  if (!d.category) {
    noCat++;
    // type 기반 자동 분류
    var cat = typeToCategory[d.type] || "other";
    
    // escalation의 경우 escalationReason으로 더 정확한 분류
    if (d.type === "escalation" && d.escalationReason) {
      if (d.escalationReason === "keyword_request") cat = "agent_request";
      else if (d.escalationReason === "ai_self_escalate") cat = "agent_request";
      else if (d.escalationReason.indexOf("action_request_") === 0) {
        var action = d.escalationReason.replace("action_request_", "");
        if (action === "shipping_delay") cat = "shipping";
        else if (action === "cancel_reason") cat = "cancel_refund";
        else if (action === "price_inquiry") cat = "product";
        else cat = action || "other";
      }
      else cat = "agent_request";
    }
    
    // userMessage 키워드 기반 보조 분류 (중국어)
    var msg = (d.userMessage || "").toLowerCase();
    if (d.type === "escalation" && cat === "agent_request") {
      if (msg.indexOf("運費") > -1 || msg.indexOf("运费") > -1 || msg.indexOf("配送") > -1 || msg.indexOf("寄") > -1) cat = "shipping";
      else if (msg.indexOf("退") > -1 || msg.indexOf("取消") > -1 || msg.indexOf("換") > -1) cat = "cancel_refund";
      else if (msg.indexOf("訂單") > -1 || msg.indexOf("订单") > -1 || msg.indexOf("出貨") > -1) cat = "order";
      else if (msg.indexOf("報價") > -1 || msg.indexOf("报价") > -1) cat = "quote_request";
      else if (msg.indexOf("合併") > -1 || msg.indexOf("合并") > -1 || msg.indexOf("合寄") > -1) cat = "merge_shipping";
      else if (msg.indexOf("帳號") > -1 || msg.indexOf("密碼") > -1 || msg.indexOf("登") > -1) cat = "account";
      else if (msg.indexOf("商品") > -1 || msg.indexOf("不良") > -1 || msg.indexOf("瑕疵") > -1) cat = "product";
      else if (msg.indexOf("付款") > -1 || msg.indexOf("金額") > -1) cat = "payment";
      else if (msg.indexOf("客服") > -1 || msg.indexOf("真人") > -1 || msg.indexOf("人工") > -1) cat = "agent_request";
    }
    
    d.category = cat;
    fixed++;
  }
});

fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
console.log("전체: " + total + "건");
console.log("category 없었음: " + noCat + "건");
console.log("후처리 완료: " + fixed + "건");

// 후처리 결과 분포
var cats = {};
data.forEach(function(d) {
  cats[d.category] = (cats[d.category] || 0) + 1;
});
console.log("\n=== 후처리 후 카테고리 분포 ===");
Object.keys(cats).sort(function(a,b){return cats[b]-cats[a];}).forEach(function(k) {
  console.log("  " + k + ": " + cats[k] + "건");
});

// category 없는 건 확인
var still = data.filter(function(d){return !d.category;}).length;
console.log("\n남은 누락: " + still + "건");
