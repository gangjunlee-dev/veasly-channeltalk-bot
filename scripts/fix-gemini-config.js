var fs = require("fs");
var file = "/home/ubuntu/veasly-channeltalk-bot/lib/ai-engine.js";
var code = fs.readFileSync(file, "utf8");
var changes = 0;

// 1) 모델 초기화에 generationConfig 추가
var oldModel = "model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });";
var newModel = "model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0.15, topP: 0.8, topK: 20, maxOutputTokens: 500 } });";

if (code.indexOf(oldModel) > -1) {
  code = code.replace(oldModel, newModel);
  changes++;
  console.log("✅ [1] Gemini generationConfig 추가 (temperature:0.15, topP:0.8, topK:20)");
}

// 2) 프롬프트에 Chain-of-Thought 답변 흐름 삽입 (zh-TW 규칙 앞에)
var oldRules = "【回答規則】\\n1.";
var cotFlow = "【答題流程-必須遵守】\\n" +
  "Step 1: 判斷客戶問題屬於哪個類別\\n" +
  "Step 2: 在本prompt的政策說明和下方參考資料中尋找相關規定\\n" +
  "Step 3: 如果找到明確規定 → 僅根據該規定回答，不添加任何額外資訊\\n" +
  "Step 4: 如果找不到明確規定 → 必須回答「這部分我幫您確認一下，先為您轉接客服人員喔」\\n" +
  "⚠️ 絕對禁止跳過Step 2直接回答。沒有根據的回答等於欺騙客戶。\\n\\n" +
  "【回答規則】\\n1.";

if (code.indexOf(oldRules) > -1) {
  code = code.replace(oldRules, cotFlow);
  changes++;
  console.log("✅ [2] Chain-of-Thought 답변 흐름(答題流程) 추가");
}

// 3) 참고자료 삽입 부분에 "근거 없으면 답하지 마라" 강조 추가
var oldRef = "'\\n\\n參考資料:\\n'";
var newRef = "'\\n\\n【重要提醒】以下參考資料是你唯一可引用的外部資訊。如果參考資料和上方政策說明都沒有提到的內容，你絕對不可以自行回答。\\n\\n參考資料:\\n'";

if (code.indexOf(oldRef) > -1) {
  code = code.replace(oldRef, newRef);
  changes++;
  console.log("✅ [3] 참고자료 앞에 근거 제한 경고 추가");
}

fs.writeFileSync(file, code, "utf8");
console.log("\n✅ 총 " + changes + "개 변경 완료");
