/**
 * VEASLY AI 자동 업그레이드 시스템
 * 
 * 기능:
 * 1. FAQ 후보 자동 분석 → 고빈도 질문 패턴 → Pinecone FAQ 자동 추가
 * 2. AI 리뷰(bad/fix) 즉시 반영 → 수정 FAQ 즉시 Pinecone 업데이트
 * 3. 에스컬레이션 사유 클러스터링 → 신규 FAQ 자동 제안
 * 4. confidence 기반 자동 threshold 조정
 * 5. 주간 자동 업그레이드 리포트
 */

require("dotenv").config();
var fs = require("fs");
var path = require("path");
var aiEngine = require("./ai-engine");
var faqQueue = require("./faq-queue");
var { GoogleGenerativeAI } = require("@google/generative-ai");

var DATA_DIR = path.join(__dirname, "..", "data");
var UPGRADE_LOG = path.join(DATA_DIR, "auto-upgrade-log.json");
var PROCESSED_CANDIDATES = path.join(DATA_DIR, "processed-candidates.json");

// ================================================================
// 1. FAQ 후보 자동 분석 & Pinecone 추가
// ================================================================
async function processEscalationCandidates() {
  console.log("[AutoUpgrade] Processing escalation candidates...");

  var queue = faqQueue.loadQueue();
  var pending = (queue.candidates || []).filter(function(c) {
    return c.status === "pending";
  });

  if (pending.length < 5) {
    console.log("[AutoUpgrade] Not enough candidates:", pending.length);
    return { processed: 0, added: 0, skipped: pending.length };
  }

  // "客服", "轉客服" 같은 단순 에스컬레이션 요청 필터링
  var agentKeywords = ["客服", "轉客服", "真人客服", "轉接客服", "人工", "轉做人工", "聯繫客服", "聯絡客服"];
  var meaningful = pending.filter(function(c) {
    var msg = (c.userMessage || "").trim();
    // 단순 에스컬레이션 요청만 있는 건 제외
    if (msg.length < 5) return false;
    if (agentKeywords.indexOf(msg) !== -1) return false;
    if (c.escalationReason === "agent_request" && msg.length < 10) return false;
    return true;
  });

  console.log("[AutoUpgrade] Meaningful candidates:", meaningful.length, "/ total:", pending.length);

  // 카테고리별 그룹핑
  var grouped = {};
  meaningful.forEach(function(c) {
    var reason = c.escalationReason || "unclassified";
    if (!grouped[reason]) grouped[reason] = [];
    grouped[reason].push(c);
  });

  // 3건 이상 있는 카테고리만 FAQ 생성 대상
  var targetGroups = {};
  Object.keys(grouped).forEach(function(k) {
    if (grouped[k].length >= 3) targetGroups[k] = grouped[k];
  });

  if (Object.keys(targetGroups).length === 0) {
    console.log("[AutoUpgrade] No category with 3+ candidates");
    return { processed: meaningful.length, added: 0, categories: 0 };
  }

  // Gemini로 FAQ 생성
  var genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  var model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  var totalAdded = 0;
  var processedIds = loadProcessedIds();

  for (var category in targetGroups) {
    var items = targetGroups[category];
    var samples = items.slice(0, 10).map(function(c, i) {
      return (i + 1) + ". [" + c.lang + "] " + c.userMessage;
    }).join("\n");

    var prompt = "你是VEASLY（韓國代購平台，主要服務台灣客戶）的客服AI改善專家。\n\n" +
      "以下是被歸類為「" + category + "」的客戶提問，這些問題導致了AI無法回答而轉接人工客服：\n\n" +
      samples + "\n\n" +
      "請分析這些問題的共同模式，生成1~3個FAQ來改善AI的回答能力。\n\n" +
      "規則：\n" +
      "1. 答案必須用繁體中文，語氣親切但專業\n" +
      "2. 答案要具體實用，不要空泛\n" +
      "3. 如果問題需要查詢個人訂單資料，答案應引導客戶提供訂單號碼\n" +
      "4. 如果問題確實需要人工處理（如報價、議價、修改訂單），答案應說明會轉接客服\n" +
      "5. 包含VEASLY的實際政策（國際運費0~1kg TWD 310、配送3~7工作天、EZ WAY認證等）\n\n" +
      "回傳JSON格式：[{\"question\":\"用戶可能會問的問題\", \"answer\":\"完整答案\", \"category\":\"" + category + "\", \"keywords\":[\"關鍵詞1\",\"關鍵詞2\"]}]\n" +
      "只回傳JSON，不要其他文字。";

    try {
      var result = await model.generateContent(prompt);
      var text = result.response.text().replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      var jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (!jsonMatch) continue;

      var faqs = JSON.parse(jsonMatch[0]);

      for (var fi = 0; fi < faqs.length; fi++) {
        var faq = faqs[fi];
        var faqText = "Q: " + faq.question + "\nA: " + faq.answer;
        var faqId = "auto_esc_" + category + "_" + Date.now() + "_" + fi;

        await aiEngine.addToKnowledgeBase(faqId, faqText, {
          namespace: "faq",
          source: "auto_escalation_analysis",
          category: category,
          question: faq.question,
          keywords: (faq.keywords || []).join(","),
          timestamp: new Date().toISOString()
        });
        totalAdded++;
        console.log("[AutoUpgrade] Added FAQ:", faqId, "- Q:", faq.question.substring(0, 50));
      }

      // 처리된 후보들 상태 업데이트
      items.forEach(function(c) {
        var cid = c.chatId + "_" + c.timestamp;
        if (!processedIds[cid]) {
          processedIds[cid] = { processedAt: new Date().toISOString(), category: category };
          faqQueue.updateCandidateStatus(c.chatId, c.timestamp, "added");
        }
      });

    } catch(e) {
      console.error("[AutoUpgrade] FAQ generation error for", category, ":", e.message);
    }
  }

  saveProcessedIds(processedIds);

  var result = {
    processed: meaningful.length,
    added: totalAdded,
    categories: Object.keys(targetGroups).length,
    skippedSimple: pending.length - meaningful.length
  };

  console.log("[AutoUpgrade] Escalation processing done:", JSON.stringify(result));
  return result;
}

// ================================================================
// 2. AI 리뷰 즉시 반영
// ================================================================
async function processReviewFeedback() {
  console.log("[AutoUpgrade] Processing review feedback...");

  var reviewFile = path.join(DATA_DIR, "ai-reviews.json");
  var processedFile = path.join(DATA_DIR, "reviews-processed.json");

  var reviews = [];
  var processed = [];
  try { reviews = JSON.parse(fs.readFileSync(reviewFile, "utf8")); } catch(e) {}
  try { processed = JSON.parse(fs.readFileSync(processedFile, "utf8")); } catch(e) {}

  var pending = reviews.filter(function(r) {
    return (r.rating === "bad" || r.rating === "fix") && processed.indexOf(r.reviewedAt) === -1;
  });

  if (pending.length === 0) {
    console.log("[AutoUpgrade] No pending reviews");
    return { processed: 0 };
  }

  var genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  var model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  var totalFixed = 0;

  for (var ri = 0; ri < pending.length; ri++) {
    var review = pending[ri];

    var prompt = "你是VEASLY客服AI品質專家。以下AI回覆被管理員評為需要修正：\n\n" +
      "客戶問題: " + (review.userMessage || "") + "\n" +
      "AI原始回覆: " + (review.aiResponse || "") + "\n" +
      "管理員評價: " + review.rating + "\n" +
      "管理員備註: " + (review.comment || "無") + "\n\n" +
      "請生成修正後的FAQ。規則：\n" +
      "1. 如有管理員備註，務必以備註為準\n" +
      "2. 答案用繁體中文，親切專業\n" +
      "3. 번개장터 翻譯為「閃電拍賣」，당근마켓 翻譯為「胡蘿蔔市場」\n" +
      "4. 包含實際VEASLY政策\n\n" +
      "回傳JSON：{\"question\":\"..\", \"answer\":\"..\", \"category\":\"..\", \"priority\":\"high\"}\n" +
      "只回傳JSON。";

    try {
      var result = await model.generateContent(prompt);
      var text = result.response.text().replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      var faq = JSON.parse(text);

      var faqText = "Q: " + faq.question + "\nA: " + faq.answer;
      var faqId = "review_fix_" + Date.now() + "_" + ri;

      await aiEngine.addToKnowledgeBase(faqId, faqText, {
        namespace: "faq",
        source: "admin_review_immediate",
        category: faq.category || "general",
        priority: "high",
        originalRating: review.rating,
        timestamp: new Date().toISOString()
      });

      totalFixed++;
      console.log("[AutoUpgrade] Review fix added:", faqId);

      // Mark as processed
      processed.push(review.reviewedAt);

    } catch(e) {
      console.error("[AutoUpgrade] Review fix error:", e.message);
    }
  }

  if (processed.length > 500) processed = processed.slice(-500);
  fs.writeFileSync(processedFile, JSON.stringify(processed));

  console.log("[AutoUpgrade] Review feedback done:", totalFixed, "fixes applied");
  return { processed: pending.length, fixed: totalFixed };
}

// ================================================================
// 3. Confidence 기반 자동 임계값 조정
// ================================================================
function analyzeConfidenceDistribution() {
  var convFile = path.join(DATA_DIR, "ai-conversations.json");
  var convs = [];
  try { convs = JSON.parse(fs.readFileSync(convFile, "utf8")); } catch(e) { return null; }

  var recent = convs.filter(function(c) {
    return c.timestamp && c.timestamp >= new Date(Date.now() - 7 * 86400000).toISOString();
  });

  var escalated = recent.filter(function(c) { return c.escalated; });
  var answered = recent.filter(function(c) { return !c.escalated && c.confidence; });

  // Confidence 분포 분석
  var confBuckets = { low: 0, mid: 0, high: 0 };
  var escConfidences = [];

  answered.forEach(function(c) {
    if (c.confidence < 0.3) confBuckets.low++;
    else if (c.confidence < 0.7) confBuckets.mid++;
    else confBuckets.high++;
  });

  escalated.forEach(function(c) {
    if (c.confidence) escConfidences.push(c.confidence);
  });

  var avgEscConf = escConfidences.length > 0 ?
    escConfidences.reduce(function(a, b) { return a + b; }, 0) / escConfidences.length : 0;

  return {
    total: recent.length,
    answered: answered.length,
    escalated: escalated.length,
    escalationRate: recent.length > 0 ? Math.round((escalated.length / recent.length) * 100) : 0,
    confidenceDistribution: confBuckets,
    avgEscalatedConfidence: Math.round(avgEscConf * 1000) / 1000,
    recommendation: avgEscConf > 0.5 ?
      "에스컬레이션된 질문의 confidence가 높음(" + avgEscConf.toFixed(2) + ") → FAQ 내용 품질 개선 필요" :
      "에스컬레이션된 질문의 confidence가 낮음(" + avgEscConf.toFixed(2) + ") → FAQ 커버리지 확대 필요"
  };
}

// ================================================================
// 4. 종합 자동 업그레이드 실행
// ================================================================
async function runAutoUpgrade() {
  console.log("[AutoUpgrade] ========= Starting Auto Upgrade =========");
  var startTime = Date.now();

  if (!aiEngine.isReady()) {
    try { await aiEngine.initializeAI(); } catch(e) {
      console.error("[AutoUpgrade] AI init failed:", e.message);
      return { status: "error", reason: "ai_not_ready" };
    }
  }

  // Step 1: FAQ 후보 업데이트
  var queueResult = faqQueue.updateCandidates();
  console.log("[AutoUpgrade] Queue updated:", JSON.stringify(queueResult));

  // Step 2: 에스컬레이션 후보 → FAQ 자동 생성
  var escResult = await processEscalationCandidates();

  // Step 3: 리뷰 피드백 즉시 반영
  var reviewResult = await processReviewFeedback();

  // Step 4: Confidence 분석
  var confAnalysis = analyzeConfidenceDistribution();

  var upgradeResult = {
    timestamp: new Date().toISOString(),
    status: "completed",
    durationMs: Date.now() - startTime,
    queueUpdate: queueResult,
    escalationFAQs: escResult,
    reviewFixes: reviewResult,
    confidenceAnalysis: confAnalysis
  };

  // 로그 저장
  saveUpgradeLog(upgradeResult);

  console.log("[AutoUpgrade] ========= Upgrade Complete =========");
  console.log("[AutoUpgrade] Duration:", upgradeResult.durationMs, "ms");
  console.log("[AutoUpgrade] FAQs added:", escResult.added);
  console.log("[AutoUpgrade] Reviews fixed:", reviewResult.fixed || 0);

  return upgradeResult;
}

// ================================================================
// 5. 주간 업그레이드 리포트
// ================================================================
function generateUpgradeReport() {
  var logs = loadUpgradeLogs();
  var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  var recent = logs.filter(function(l) { return l.timestamp >= weekAgo; });

  var totalFAQs = 0;
  var totalFixes = 0;
  var totalProcessed = 0;

  recent.forEach(function(l) {
    totalFAQs += (l.escalationFAQs ? l.escalationFAQs.added : 0);
    totalFixes += (l.reviewFixes ? l.reviewFixes.fixed : 0);
    totalProcessed += (l.escalationFAQs ? l.escalationFAQs.processed : 0);
  });

  var confAnalysis = analyzeConfidenceDistribution();

  var report = "🤖 VEASLY AI 자동 업그레이드 주간 리포트\n";
  report += "═══════════════════════════════\n";
  report += "📅 기간: 최근 7일 (" + recent.length + "회 실행)\n\n";

  report += "📊 성과 요약\n";
  report += "  • 처리된 에스컬레이션 후보: " + totalProcessed + "건\n";
  report += "  • 자동 생성 FAQ: " + totalFAQs + "건\n";
  report += "  • 리뷰 기반 수정: " + totalFixes + "건\n\n";

  if (confAnalysis) {
    report += "📈 AI 성능 현황\n";
    report += "  • 총 대화: " + confAnalysis.total + "건\n";
    report += "  • AI 응답: " + confAnalysis.answered + "건\n";
    report += "  • 에스컬레이션: " + confAnalysis.escalated + "건 (" + confAnalysis.escalationRate + "%)\n";
    report += "  • 에스컬 평균 confidence: " + confAnalysis.avgEscalatedConfidence + "\n";
    report += "  • 진단: " + confAnalysis.recommendation + "\n";
  }

  report += "\n═══════════════════════════════";
  return report;
}

// ================================================================
// Helper functions
// ================================================================
function loadProcessedIds() {
  try { return JSON.parse(fs.readFileSync(PROCESSED_CANDIDATES, "utf8")); } catch(e) { return {}; }
}

function saveProcessedIds(data) {
  fs.writeFileSync(PROCESSED_CANDIDATES, JSON.stringify(data));
}

function loadUpgradeLogs() {
  try { return JSON.parse(fs.readFileSync(UPGRADE_LOG, "utf8")); } catch(e) { return []; }
}

function saveUpgradeLog(result) {
  var logs = loadUpgradeLogs();
  logs.push(result);
  if (logs.length > 100) logs = logs.slice(-100);
  fs.writeFileSync(UPGRADE_LOG, JSON.stringify(logs, null, 2));
}

module.exports = {
  runAutoUpgrade: runAutoUpgrade,
  processEscalationCandidates: processEscalationCandidates,
  processReviewFeedback: processReviewFeedback,
  analyzeConfidenceDistribution: analyzeConfidenceDistribution,
  generateUpgradeReport: generateUpgradeReport
};
