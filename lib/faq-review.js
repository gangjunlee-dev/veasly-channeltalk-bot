// [2026-07-06] 노션 단일소스 전환으로 Pinecone FAQ 검토 큐(faq_review) 폐기.
// exports는 no-op 스텁으로 유지(대시보드/라우트 잔여 호출 안전). Pinecone require 없음.
async function listPending() { return { items: [], total: 0 }; }
async function approve() { return false; }
async function reject() { return false; }

module.exports = { listPending: listPending, approve: approve, reject: reject };
