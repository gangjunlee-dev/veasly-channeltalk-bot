/**
 * Claude(Anthropic) 답변 생성 래퍼 (2026-07-05)
 * - 기존 axios 사용(새 패키지 없음). Messages API 직접 호출.
 * - 모델: env CLAUDE_MODEL (기본 claude-haiku-4-5). 테스트 후 별로면 env만 claude-sonnet-5로 변경.
 * - 프롬프트 캐싱: 안정적인 지식/시스템 블록에 cache_control 부여 → 반복 트래픽 비용 절감.
 * - ANTHROPIC_API_KEY 없으면 isEnabled()=false, generate()=null (호출측이 폴백).
 */
var axios = require('axios');

var API_URL = 'https://api.anthropic.com/v1/messages';
var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
var MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';

function isEnabled() { return !!ANTHROPIC_API_KEY; }

/**
 * @param {Object} o
 *   o.systemStable : (선택) 캐싱할 안정적 시스템/지식 블록 (프롬프트+노션지식). cache_control 부여.
 *   o.systemVolatile: (선택) 캐싱 안 하는 시스템 블록 (매 요청 바뀌는 소량 컨텍스트).
 *   o.user         : 사용자 메시지 문자열 (필수)
 *   o.maxTokens    : 기본 1024
 *   o.model        : 기본 env MODEL
 * @returns {Promise<{text, usage, stopReason}|null>}
 */
async function generate(o) {
  o = o || {};
  if (!ANTHROPIC_API_KEY) { console.log('[LLM] skip (ANTHROPIC_API_KEY 미설정)'); return null; }
  var system = [];
  if (o.systemStable) {
    // 안정 블록: 캐싱(기본 5분 ephemeral). render 순서상 앞에 둬야 캐시 프리픽스가 됨.
    system.push({ type: 'text', text: String(o.systemStable), cache_control: { type: 'ephemeral' } });
  }
  if (o.systemVolatile) {
    system.push({ type: 'text', text: String(o.systemVolatile) });
  }
  var body = {
    model: o.model || MODEL,
    max_tokens: o.maxTokens || 1024,
    messages: [{ role: 'user', content: String(o.user || '') }]
  };
  if (system.length) body.system = system;
  // 429/529/5xx·네트워크 오류는 일시적 → 최대 2회 재시도(짧은 백오프). 그 외/최종 실패는 null(호출측 폴백).
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var res = await axios.post(API_URL, body, {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        timeout: 30000
      });
      var d = res.data || {};
      var text = ((d.content || []).filter(function(b) { return b.type === 'text'; })
        .map(function(b) { return b.text || ''; }).join('')).trim();
      // 캐시 히트 관찰용(가끔 로깅)
      if (d.usage) {
        var cw = d.usage.cache_creation_input_tokens || 0;
        if (cw > 0) console.log('[LLM] cache write:', cw, '| in:', d.usage.input_tokens, '| out:', d.usage.output_tokens);
      }
      return { text: text, usage: d.usage || null, stopReason: d.stop_reason || null };
    } catch (e) {
      var st = e.response && e.response.status;
      var retryable = !e.response || st === 429 || st === 529 || (st >= 500 && st < 600);
      if (retryable && attempt < 2) {
        await new Promise(function (r) { setTimeout(r, 700 * (attempt + 1)); });
        continue;
      }
      console.error('[LLM] Claude error:', e.response ? JSON.stringify(e.response.data).slice(0, 300) : e.message);
      return null;
    }
  }
  return null;
}

module.exports = { generate: generate, isEnabled: isEnabled, MODEL: MODEL };
