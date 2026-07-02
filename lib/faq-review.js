// [2026-06-30] FAQ 검토 큐 관리 — 격리된 AI 생성 FAQ(faq_review)를 사람이 승인/거절.
// 승인 시 라이브 'faq' 네임스페이스로 재임베딩 업서트(source: human_approved) + faq_review에서 제거.
require('dotenv').config();
var { Pinecone } = require('@pinecone-database/pinecone');
var aiEngine = require('./ai-engine');

var _pc = null, _idxPromise = null;
function getIndex() {
  if (!_pc) _pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  if (!_idxPromise) {
    _idxPromise = (async function () {
      var name = process.env.PINECONE_INDEX_NAME || 'veasly-cs';
      var desc = await _pc.describeIndex(name);
      return _pc.index({ host: desc.host });
    })();
  }
  return _idxPromise;
}

// text("Q: ..\nA: ..")에서 q/a 분리
function splitQA(text, fallbackQ) {
  var t = text || '';
  var ai = t.indexOf('A:');
  var q = fallbackQ || '', a = '';
  if (ai >= 0) {
    a = t.slice(ai + 2).trim();
    if (!q) { var qi = t.indexOf('Q:'); q = t.slice(qi >= 0 ? qi + 2 : 0, ai).trim(); }
  } else if (!q) { q = t.trim(); }
  return { question: q, answer: a };
}

async function listPending(limit) {
  limit = limit || 60;
  var idx = await getIndex();
  var listed = await idx.namespace('faq_review').listPaginated({ limit: limit });
  var ids = (listed.vectors || []).map(function (v) { return v.id; });
  if (!ids.length) return { items: [], total: 0 };
  var fetched = await idx.namespace('faq_review').fetch({ ids: ids });
  var recs = fetched.records || fetched.vectors || {};
  var items = ids.map(function (id) {
    var md = (recs[id] && recs[id].metadata) || {};
    var qa = splitQA(md.text, md.question);
    return { id: id, question: qa.question, answer: qa.answer, category: md.category || '', source: md.source || '', createdAt: md.timestamp || '' };
  });
  return { items: items, total: ids.length };
}

async function approve(id, question, answer, category) {
  if (!id) throw new Error('id required');
  var idx = await getIndex();
  var text;
  if (question && answer) {
    text = 'Q: ' + String(question).trim() + '\nA: ' + String(answer).trim();
  } else {
    var f = await idx.namespace('faq_review').fetch({ ids: [id] });
    var rec = (f.records || f.vectors || {})[id];
    text = rec && rec.metadata && rec.metadata.text;
    category = category || (rec && rec.metadata && rec.metadata.category);
    if (!text) throw new Error('entry not found: ' + id);
  }
  // 라이브 faq로 재임베딩 업서트 (사람 승인 출처)
  await aiEngine.addToKnowledgeBase('approved_' + Date.now() + '_' + Math.floor(id.length), text, {
    namespace: 'faq', source: 'human_approved', category: category || 'general',
    question: question || '', approvedAt: new Date().toISOString()
  });
  // 검토 큐에서 제거
  await idx.namespace('faq_review').deleteMany({ ids: [id] });
  return true;
}

async function reject(id) {
  if (!id) throw new Error('id required');
  var idx = await getIndex();
  await idx.namespace('faq_review').deleteMany({ ids: [id] });
  return true;
}

module.exports = { listPending: listPending, approve: approve, reject: reject };
