require("dotenv").config();
var fs = require("fs");
var aiEngine = require("./ai-engine");
var { Pinecone } = require("@pinecone-database/pinecone");
var { GoogleGenerativeAI } = require("@google/generative-ai");

var FAQ_LOG_FILE = require("path").join(__dirname, "..", "data", "faq-update-log.json");

// Load all manager replies from Pinecone
async function fetchManagerKnowledge(limit) {
  limit = limit || 100;
  try {
    if (!aiEngine.isReady()) { console.log("[FAQ] AI not ready"); return []; }

    // Use a dummy vector to fetch manager namespace entries
    var dummyVector = new Array(3072).fill(0);
    dummyVector[0] = 0.01;

    var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    var indexList = await pc.listIndexes();
    var indexName = (indexList.indexes && indexList.indexes[0]) ? indexList.indexes[0].name : "veasly-cs";
    var desc = await pc.describeIndex(indexName);
    var index = pc.index({ host: desc.host });

    var result = await index.namespace("manager").query({
      vector: dummyVector,
      topK: limit,
      includeMetadata: true
    });

    var entries = (result.matches || []).map(function(m) {
      return {
        id: m.id,
        text: m.metadata ? m.metadata.text : "",
        score: m.score,
        timestamp: m.metadata ? m.metadata.timestamp : "",
        source: m.metadata ? m.metadata.source : ""
      };
    }).filter(function(e) { return e.text && e.text.length > 10; });

    console.log("[FAQ] Fetched", entries.length, "manager replies");
    return entries;
  } catch(e) {
    console.error("[FAQ] fetchManagerKnowledge error:", e.message);
    return [];
  }
}

// Use Gemini to cluster and generate FAQ entries
async function generateFAQFromReplies(managerReplies) {
  if (!managerReplies || managerReplies.length === 0) return [];

  try {
    var genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    var model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    var repliesText = managerReplies.map(function(r, i) {
      return (i + 1) + ". " + r.text.substring(0, 200);
    }).join("\n");

    var prompt = `你是VEASLY客服FAQ整理專家。以下是客服人員的回覆紀錄，請分析並整理成FAQ格式。

客服回覆紀錄：
${repliesText}

請執行以下任務：
1. 找出重複或相似的主題，合併為一個FAQ
2. 每個FAQ包含一個「問題」和一個「答案」
3. 答案要完整、準確，使用繁體中文
4. 忽略太短或無意義的回覆
5. 最多產生15個FAQ

請用以下JSON格式回覆（只回覆JSON，不要其他文字）：
[
  {"question": "問題內容", "answer": "答案內容", "category": "分類（shipping/payment/cancel/product/general）"}
]`;

    var result = await model.generateContent(prompt);
    var text = result.response.text();

    // Extract JSON from response
    var jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!jsonMatch) {
      console.error("[FAQ] Could not parse Gemini response");
      return [];
    }

    var faqs = JSON.parse(jsonMatch[0]);
    console.log("[FAQ] Generated", faqs.length, "FAQ entries from", managerReplies.length, "replies");
    return faqs;
  } catch(e) {
    console.error("[FAQ] generateFAQFromReplies error:", e.message);
    return [];
  }
}

// Update Pinecone FAQ namespace with new entries
async function updateFAQNamespace(faqs) {
  if (!faqs || faqs.length === 0) return 0;
  var count = 0;

  for (var i = 0; i < faqs.length; i++) {
    try {
      var faq = faqs[i];
      var faqText = "Q: " + faq.question + "\nA: " + faq.answer;
      var faqId = "auto_faq_" + faq.category + "_" + Date.now() + "_" + i;

      await aiEngine.addToKnowledgeBase(faqId, faqText, {
        namespace: "faq",
        source: "auto_generated",
        category: faq.category,
        question: faq.question,
        timestamp: new Date().toISOString()
      });
      count++;
    } catch(e) {
      console.error("[FAQ] upsert error:", e.message);
    }
  }

  console.log("[FAQ] Updated", count, "FAQ entries in Pinecone");
  return count;
}

// Clean up old/duplicate manager entries
async function cleanupOldManagerEntries(entries, keepDays) {
  keepDays = keepDays || 30;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  var cutoffStr = cutoff.toISOString();

  var toDelete = entries.filter(function(e) {
    return e.timestamp && e.timestamp < cutoffStr;
  });

  if (toDelete.length === 0) {
    console.log("[FAQ] No old manager entries to clean");
    return 0;
  }

  try {
    var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    var indexList = await pc.listIndexes();
    var indexName = (indexList.indexes && indexList.indexes[0]) ? indexList.indexes[0].name : "veasly-cs";
    var desc = await pc.describeIndex(indexName);
    var index = pc.index({ host: desc.host });

    var ids = toDelete.map(function(e) { return e.id; });
    // Delete in batches of 100
    for (var i = 0; i < ids.length; i += 100) {
      var batch = ids.slice(i, i + 100);
      await index.namespace("manager").deleteMany(batch);
    }

    console.log("[FAQ] Cleaned up", toDelete.length, "old manager entries (>" + keepDays + " days)");
    return toDelete.length;
  } catch(e) {
    console.error("[FAQ] cleanup error:", e.message);
    return 0;
  }
}

// Save update log
function saveUpdateLog(result) {
  try {
    var dir = require("path").dirname(FAQ_LOG_FILE);
    if (!require("fs").existsSync(dir)) require("fs").mkdirSync(dir, { recursive: true });
    var logs = [];
    if (require("fs").existsSync(FAQ_LOG_FILE)) {
      logs = JSON.parse(require("fs").readFileSync(FAQ_LOG_FILE, "utf8"));
    }
    logs.push(result);
    // Keep last 50 logs
    if (logs.length > 50) logs = logs.slice(-50);
    require("fs").writeFileSync(FAQ_LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
  } catch(e) {}
}

// Main update function

// Load bad/fix reviews for FAQ improvement
function loadPendingReviews() {
  var reviewFile = require("path").join(__dirname, "..", "data", "ai-reviews.json");
  var processedFile = require("path").join(__dirname, "..", "data", "reviews-processed.json");
  var reviews = [];
  var processed = [];
  try { reviews = JSON.parse(fs.readFileSync(reviewFile, "utf8")); } catch(e) {}
  try { processed = JSON.parse(fs.readFileSync(processedFile, "utf8")); } catch(e) {}

  // Filter: only bad/fix ratings, not yet processed
  var pending = reviews.filter(function(r) {
    return (r.rating === "bad" || r.rating === "fix") && processed.indexOf(r.reviewedAt) === -1;
  });
  return pending;
}

function markReviewsProcessed(reviews) {
  var processedFile = require("path").join(__dirname, "..", "data", "reviews-processed.json");
  var processed = [];
  try { processed = JSON.parse(fs.readFileSync(processedFile, "utf8")); } catch(e) {}
  reviews.forEach(function(r) { processed.push(r.reviewedAt); });
  if (processed.length > 500) processed = processed.slice(-500);
  fs.writeFileSync(processedFile, JSON.stringify(processed));
}

async function generateCorrectedFAQs(pendingReviews) {
  if (pendingReviews.length === 0) return [];
  var genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  var model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  var reviewText = pendingReviews.map(function(r, i) {
    return (i + 1) + ". 고객질문: " + (r.userMessage || "") + "\n   AI답변(부정확): " + (r.aiResponse || "") + "\n   관리자코멘트: " + (r.comment || "없음") + "\n   평가: " + r.rating;
  }).join("\n\n");

  var prompt = "你是 VEASLY 客服AI的品質改善專家。以下是被管理員評為「不正確」或「需修正」的AI回覆：\n\n" + reviewText +
    "\n\n請根據以上資料，生成修正後的FAQ。規則：\n" +
    "1. 每個問題生成一個修正FAQ\n" +
    "2. 如果管理員有留言，以留言內容為準\n" +
    "3. 如果沒有留言，根據問題推測正確答案\n" +
    "4. 回覆使用繁體中文，語氣親切專業\n" +
    "5. 回傳JSON格式：[{\"question\":\"..\", \"answer\":\"..\", \"category\":\"..\"}]\n" +
    "只回傳JSON，不要其他文字。";

  try {
    var result = await model.generateContent(prompt);
    var text = result.response.text().replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(text);
  } catch(e) {
    console.error("[FAQ] Review-based FAQ generation error:", e.message);
    return [];
  }
}

async function runFAQUpdate() {
  console.log("[FAQ] Starting automatic FAQ update...");
  if (!aiEngine.isReady()) {
    try { await aiEngine.initializeAI(); } catch(e) { console.error("[FAQ] AI init failed:", e.message); return { status: "error", reason: "ai_not_ready" }; }
  }
  var startTime = Date.now();

  // 1. Fetch manager replies
  var replies = await fetchManagerKnowledge(100);
  if (replies.length < 3) {
    console.log("[FAQ] Not enough manager replies to generate FAQs");
    return { status: "skipped", reason: "insufficient_data", replies: replies.length };
  }

  // 2. Generate FAQs using Gemini
  var faqs = await generateFAQFromReplies(replies);

  // 3. Update Pinecone FAQ namespace
  var updated = await updateFAQNamespace(faqs);

  // 3.5 Process admin reviews (bad/fix) to improve AI
  var pendingReviews = loadPendingReviews();
  var correctedFaqs = 0;
  if (pendingReviews.length > 0) {
    console.log("[FAQ] Processing", pendingReviews.length, "admin reviews for AI improvement...");
    var corrections = await generateCorrectedFAQs(pendingReviews);
    for (var ci = 0; ci < corrections.length; ci++) {
      var corr = corrections[ci];
      var corrId = "review_fix_" + Date.now() + "_" + ci;
      var corrText = "Q: " + corr.question + "\nA: " + corr.answer;
      await aiEngine.addToKnowledgeBase(corrId, corrText, { namespace: "faq", source: "admin_review_fix", category: corr.category || "general", timestamp: new Date().toISOString() });
      console.log("[FAQ] Added review correction:", corrId);
      correctedFaqs++;
    }
    markReviewsProcessed(pendingReviews);
    console.log("[FAQ] Processed", pendingReviews.length, "reviews ->", correctedFaqs, "corrections");
  }

  // 4. Clean up old manager entries (>30 days)
  var cleaned = await cleanupOldManagerEntries(replies, 30);

  var result = {
    timestamp: new Date().toISOString(),
    status: "completed",
    managerReplies: replies.length,
    faqsGenerated: faqs.length,
    faqsUpdated: updated,
    reviewsProcessed: pendingReviews.length,
    correctedFaqs: correctedFaqs,
    managerCleaned: cleaned,
    durationMs: Date.now() - startTime
  };

  saveUpdateLog(result);
  console.log("[FAQ] Update completed:", JSON.stringify(result));
  return result;
}

module.exports = {
  fetchManagerKnowledge: fetchManagerKnowledge,
  generateFAQFromReplies: generateFAQFromReplies,
  updateFAQNamespace: updateFAQNamespace,
  cleanupOldManagerEntries: cleanupOldManagerEntries,
  runFAQUpdate: runFAQUpdate,
  loadPendingReviews: loadPendingReviews,
  generateCorrectedFAQs: generateCorrectedFAQs,

};
