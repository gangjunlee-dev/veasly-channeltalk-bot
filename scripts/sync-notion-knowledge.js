/**
 * 노션 지식 동기화 (2026-07-05)
 * 노션 문서(SOP/FAQ/용어집/약관)를 당겨 data/knowledge.md 로 생성.
 * 봇은 이 파일을 Claude 캐싱 컨텍스트로 로드해 답변한다. (Pinecone/Gemini 대체)
 *
 * 실행: node scripts/sync-notion-knowledge.js   (서버, .env 로드)
 * 스케줄러에서 1일 1회 호출 예정.
 * 전제: NOTION_TOKEN integration 이 아래 페이지들이 있는 "운영" 페이지에 Connections 연결돼 있어야 함.
 *
 * 서비스개요는 내부 재무(매출·마진·CAC) 유출 방지를 위해 여기서 제외.
 * VOC 요약은 강준이 링크 제공 시 SOURCES 에 추가.
 */
var fs = require('fs');
var path = require('path');
var axios = require('axios');

var NOTION_TOKEN = process.env.NOTION_TOKEN || '';
var OUT = path.join(__dirname, '..', 'data', 'knowledge.md');

// 지식 소스 (순서 = 최종 문서 순서)
var SOURCES = [
  { type: 'page', id: '38dae9b1e41a81cb93ede3a45d89d5a0', title: 'CS SOP (台灣華語) — 답변 규칙·話術·운임표' },
  { type: 'page', id: '38dae9b1e41a81cdb525c07f8a36b3f9', title: 'FAQ (台灣華語) — 고객 공개 Q&A' },
  { type: 'db',   id: '35eae9b1e41a8090a436c2d848f17e8e', title: '도메인 용어집', ds: 'collection://35eae9b1-e41a-8084-80c9-000baee15fa9' },
  { type: 'page', id: '317ae9b1e41a804b911ee1bdc89dd141', title: '약관/정책' }
  // { type: 'page', id: '<VOC 요약 페이지>', title: 'VOC 최근 동향 (참고용, 정책 아님)' }  // 링크 받으면 추가
];

var api = axios.create({
  baseURL: 'https://api.notion.com/v1',
  headers: { 'Authorization': 'Bearer ' + NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
  timeout: 20000
});

function rt(arr) { return (arr || []).map(function (t) { return t.plain_text || ''; }).join(''); }

// 블록 → 텍스트(마크다운 근사). 재귀. child_database 는 rows 렌더, child_page 는 재귀.
async function renderBlocks(blockId, depth) {
  if (depth > 4) return '';
  var out = [], cursor = undefined, guard = 0;
  do {
    var url = '/blocks/' + blockId + '/children?page_size=100' + (cursor ? '&start_cursor=' + cursor : '');
    var res = await api.get(url);
    var blocks = res.data.results || [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i], t = b.type, x = b[t] || {};
      var line = '';
      switch (t) {
        case 'heading_1': line = '\n# ' + rt(x.rich_text); break;
        case 'heading_2': line = '\n## ' + rt(x.rich_text); break;
        case 'heading_3': line = '\n### ' + rt(x.rich_text); break;
        case 'paragraph': line = rt(x.rich_text); break;
        case 'bulleted_list_item': line = '- ' + rt(x.rich_text); break;
        case 'numbered_list_item': line = '1. ' + rt(x.rich_text); break;
        case 'to_do': line = '- [ ] ' + rt(x.rich_text); break;
        case 'quote': line = '> ' + rt(x.rich_text); break;
        case 'callout': line = '> ' + rt(x.rich_text); break;
        case 'toggle': line = '- ' + rt(x.rich_text); break;
        case 'code': line = '```\n' + rt(x.rich_text) + '\n```'; break;
        case 'table_row': line = '| ' + (x.cells || []).map(function (c) { return rt(c); }).join(' | ') + ' |'; break;
        case 'divider': line = '---'; break;
        case 'child_database':
          line = await renderDatabase(b.id, x.title || '');
          break;
        case 'child_page':
          // 하위 페이지(예: 약관의 Policy)도 포함
          line = '\n## ' + (x.title || '(하위 페이지)') + '\n' + (await renderBlocks(b.id, depth + 1));
          break;
        default: line = rt(x.rich_text);
      }
      if (line !== '') out.push(line);
      // 중첩 자식 (테이블/토글/리스트 하위 등) — child_page/child_database 는 위에서 이미 처리
      if (b.has_children && t !== 'child_page' && t !== 'child_database' && t !== 'table') {
        var sub = await renderBlocks(b.id, depth + 1);
        if (sub) out.push(sub);
      }
      if (b.has_children && t === 'table') {
        var rows = await renderBlocks(b.id, depth + 1);
        if (rows) out.push(rows);
      }
    }
    cursor = res.data.has_more ? res.data.next_cursor : undefined;
  } while (cursor && ++guard < 20);
  return out.join('\n');
}

// 데이터소스(DB) rows → 목록 텍스트
async function renderDatabase(dbId, title) {
  var lines = title ? ['\n### ' + title] : [];
  var cursor = undefined, guard = 0;
  do {
    var body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    var res = await api.post('/databases/' + dbId + '/query', body);
    var rows = res.data.results || [];
    for (var i = 0; i < rows.length; i++) {
      var props = rows[i].properties || {};
      var parts = [];
      Object.keys(props).forEach(function (k) {
        var p = props[k], v = '';
        if (p.type === 'title') v = rt(p.title);
        else if (p.type === 'rich_text') v = rt(p.rich_text);
        else if (p.type === 'select') v = p.select ? p.select.name : '';
        else if (p.type === 'multi_select') v = (p.multi_select || []).map(function (s) { return s.name; }).join('/');
        if (v) parts.push(k + ': ' + v);
      });
      if (parts.length) lines.push('- ' + parts.join(' | '));
    }
    cursor = res.data.has_more ? res.data.next_cursor : undefined;
  } while (cursor && ++guard < 20);
  return lines.join('\n');
}

async function main() {
  // 스케줄러에서 모듈로 호출될 수 있으므로 process.exit 금지 — throw 로 처리(봇 프로세스 보호).
  if (!NOTION_TOKEN) throw new Error('NOTION_TOKEN 미설정');
  var parts = ['# Veasly CS 지식베이스 (노션 자동 동기화, ' + new Date().toISOString().slice(0, 10) + ')\n'];
  for (var s = 0; s < SOURCES.length; s++) {
    var src = SOURCES[s];
    process.stdout.write('[sync] ' + src.title + ' ... ');
    try {
      var body = '';
      if (src.type === 'db') body = await renderDatabase(src.id, '');
      else body = await renderBlocks(src.id, 0);
      parts.push('\n\n===== ' + src.title + ' =====\n' + body);
      console.log('OK (' + body.length + ' chars)');
    } catch (e) {
      console.error('FAIL:', e.response ? (e.response.status + ' ' + JSON.stringify(e.response.data).slice(0, 150)) : e.message);
    }
  }
  var doc = parts.join('\n');
  fs.writeFileSync(OUT, doc, 'utf8');
  console.log('\n[sync] 완료 → ' + OUT + ' (' + doc.length + ' chars ≈ ' + Math.round(doc.length / 2.5) + ' tokens 추정)');
}

if (require.main === module) {
  require('dotenv').config();
  main().catch(function (e) { console.error('[sync] error:', e.message); process.exit(1); });
}

module.exports = { main: main, SOURCES: SOURCES };
