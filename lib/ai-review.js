var fs = require("fs");
var path = require("path");
var REVIEW_FILE = path.join(__dirname, "..", "data", "ai-reviews.json");
var MAX_REVIEWS = 500;

function loadReviews() {
  try {
    if (fs.existsSync(REVIEW_FILE)) return JSON.parse(fs.readFileSync(REVIEW_FILE, "utf8"));
  } catch(e) {}
  return [];
}

function saveReview(review) {
  try {
    var dir = path.dirname(REVIEW_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var reviews = loadReviews();
    reviews.push(review);
    if (reviews.length > MAX_REVIEWS) reviews = reviews.slice(-MAX_REVIEWS);
    fs.writeFileSync(REVIEW_FILE, JSON.stringify(reviews, null, 2), "utf8");
  } catch(e) { console.error("[AIReview] Save error:", e.message); }
}

async function evaluateConversation(chatId, managerId, messages, customerName) {
  try {
    var { GoogleGenerativeAI } = require("@google/generative-ai");
    var genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    var model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Build conversation text
    var convoText = messages.map(function(m) {
      var role = m.role || (m.isManager ? "manager" : "customer");
      return "[" + role + "] " + (m.text || "").substring(0, 300);
    }).join("\n");

    var prompt = "你是VEASLY（韓國商品代購平台）的客服品質評估專家。請分析以下客服對話，針對【客服人員】的表現進行評分。\n\n" +
      "評分標準（每項1-5分）：\n" +
      "1. 問題解決(resolution)：客戶的問題是否被實際解決？\n" +
      "2. 回應態度(attitude)：客服是否禮貌、有同理心、積極？\n" +
      "3. 資訊準確(accuracy)：提供的資訊是否正確（配送7-14天、不接受個人因素退貨、BUNJANG不可取消等）？\n" +
      "4. 回應速度感(responsiveness)：從對話節奏看，客戶是否等待過久？\n" +
      "5. 專業度(professionalism)：回答是否清楚、有條理、沒有推諉？\n\n" +
      "對話內容：\n" + convoText + "\n\n" +
      "請用以下JSON格式回答（不要加其他文字）：\n" +
      "{\n" +
      "  \"resolution\": 分數,\n" +
      "  \"attitude\": 分數,\n" +
      "  \"accuracy\": 分數,\n" +
      "  \"responsiveness\": 分數,\n" +
      "  \"professionalism\": 分數,\n" +
      "  \"totalScore\": 總分(滿分25),\n" +
      "  \"summary\": \"一句話評語\"\n" +
      "}";

    var result = await model.generateContent(prompt);
    var text = result.response.text().trim();

    // Parse JSON from response
    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      var scores = JSON.parse(jsonMatch[0]);
      var review = {
        chatId: chatId,
        managerId: managerId,
        customerName: customerName || '',
        timestamp: new Date().toISOString(),
        scores: scores,
        messageCount: messages.length
      };
      saveReview(review);
      console.log("[AIReview] Chat " + chatId + " scored: " + scores.totalScore + "/25 - " + (scores.summary || ""));
      return review;
    }
    console.log("[AIReview] Failed to parse scores for chat " + chatId);
    return null;
  } catch(e) {
    console.error("[AIReview] Error:", e.message);
    return null;
  }
}

function getReviews(limit, managerId) {
  var reviews = loadReviews();
  if (managerId) reviews = reviews.filter(function(r) { return r.managerId === managerId; });
  return reviews.slice(-(limit || 50)).reverse();
}

function getManagerAvgScores(managerId, days) {
  var reviews = loadReviews();
  var cutoff = Date.now() - (days || 7) * 86400000;
  var filtered = reviews.filter(function(r) {
    return r.managerId === managerId && new Date(r.timestamp).getTime() >= cutoff;
  });
  if (filtered.length === 0) return null;
  var totals = { resolution: 0, attitude: 0, accuracy: 0, responsiveness: 0, professionalism: 0, total: 0 };
  filtered.forEach(function(r) {
    if (r.scores) {
      totals.resolution += r.scores.resolution || 0;
      totals.attitude += r.scores.attitude || 0;
      totals.accuracy += r.scores.accuracy || 0;
      totals.responsiveness += r.scores.responsiveness || 0;
      totals.professionalism += r.scores.professionalism || 0;
      totals.total += r.scores.totalScore || 0;
    }
  });
  var count = filtered.length;
  return {
    count: count,
    avg: {
      resolution: (totals.resolution / count).toFixed(1),
      attitude: (totals.attitude / count).toFixed(1),
      accuracy: (totals.accuracy / count).toFixed(1),
      responsiveness: (totals.responsiveness / count).toFixed(1),
      professionalism: (totals.professionalism / count).toFixed(1),
      totalScore: (totals.total / count).toFixed(1)
    }
  };
}

module.exports = {
  evaluateConversation: evaluateConversation,
  saveReview: saveReview,
  getReviews: getReviews,
  getManagerAvgScores: getManagerAvgScores,
  loadReviews: loadReviews
};
