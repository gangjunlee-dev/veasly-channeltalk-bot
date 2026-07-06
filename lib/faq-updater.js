// [2026-07-06] 노션 단일소스 전환으로 Pinecone FAQ 자동생성/정리 기능 전면 폐기.
// 기존 exports는 no-op 스텁으로 유지(스케줄러/대시보드 등 잔여 호출 안전). Gemini/Pinecone require 없음.
require("dotenv").config();

async function runFAQUpdate() {
  console.log("[FAQ] 비활성 — 노션 전환(Gemini/Pinecone 폐기)");
  return { status: "disabled", reason: "notion_transition" };
}
async function fetchManagerKnowledge() { return []; }
async function generateFAQFromReplies() { return []; }
async function updateFAQNamespace() { return 0; }
async function cleanupOldManagerEntries() { return 0; }
function loadPendingReviews() { return []; }
async function generateCorrectedFAQs() { return []; }

module.exports = {
  fetchManagerKnowledge: fetchManagerKnowledge,
  generateFAQFromReplies: generateFAQFromReplies,
  updateFAQNamespace: updateFAQNamespace,
  cleanupOldManagerEntries: cleanupOldManagerEntries,
  runFAQUpdate: runFAQUpdate,
  loadPendingReviews: loadPendingReviews,
  generateCorrectedFAQs: generateCorrectedFAQs
};
