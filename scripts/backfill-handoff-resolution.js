/**
 * CS 넘김 "처리 결과 / 한 줄 규칙" 백필. (2026-08-24)
 * 사용: node scripts/backfill-handoff-resolution.js [--limit N] [--apply]
 *   기본은 dry-run(생성만 하고 노션에 안 씀). --apply 로 실제 기록.
 * 사람이 직접 쓴 값은 건드리지 않는다(handoff-resolution.isOverwritable).
 */
require('dotenv').config();
var axios = require('axios');
var hr = require('../lib/handoff-resolution');

var args = process.argv.slice(2);
var APPLY = args.indexOf('--apply') !== -1;
var LIMIT = (function () { var i = args.indexOf('--limit'); return i !== -1 ? parseInt(args[i + 1], 10) : 5; })();
var NH = { headers: { Authorization: 'Bearer ' + process.env.NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, timeout: 20000 };
var CH = { headers: { 'x-access-key': process.env.CHANNEL_ACCESS_KEY, 'x-access-secret': process.env.CHANNEL_ACCESS_SECRET }, timeout: 20000, validateStatus: function () { return true; } };
var DB = process.env.NOTION_CS_HANDOFF_DB || '41f0db07e5104a67bb0bbcfb20471250';
function zzz(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function rt(p, n) { try { return (p.properties[n].rich_text || []).map(function (t) { return t.plain_text; }).join('').trim(); } catch (e) { return ''; } }
function sel(p, n) { try { return p.properties[n].select.name; } catch (e) { return ''; } }

(async function () {
  var all = [], cursor;
  do {
    var b = { page_size: 100 }; if (cursor) b.start_cursor = cursor;
    var r = await axios.post('https://api.notion.com/v1/databases/' + DB + '/query', b, NH);
    all = all.concat(r.data.results); cursor = r.data.has_more ? r.data.next_cursor : null;
  } while (cursor);

  // 대상: 처리결과가 비어있거나 자동메모인 건 (해결/처리 중/신규 전부 — 기록 자체가 자산)
  var targets = all.filter(function (p) { return hr.isOverwritable(rt(p, '처리 결과 / 한 줄 규칙')); });
  console.log('전체 ' + all.length + '건 | 백필 대상 ' + targets.length + '건 | 이번 실행 ' + Math.min(LIMIT, targets.length) + '건 (' + (APPLY ? 'APPLY' : 'dry-run') + ')');

  var done = 0, skipped = 0, written = 0;
  for (var i = 0; i < targets.length && done < LIMIT; i++) {
    var p = targets[i];
    var link = ''; try { link = p.properties['채널톡 링크'].url || ''; } catch (e) {}
    var chatId = (link.match(/user_chats\/([a-z0-9]+)/i) || [])[1] || '';
    if (!chatId) { skipped++; continue; }
    var mr = await axios.get('https://api.channel.io/open/v5/user-chats/' + chatId + '/messages?limit=60&sortOrder=desc', CH);
    if (mr.status >= 400) { skipped++; await zzz(120); continue; }
    var msgs = mr.data.messages || [];
    var line = await hr.generateResolution(msgs, { reason: sel(p, '넘김 사유') });
    done++;
    if (!line) { console.log('[' + done + '] (근거 부족 — 건너뜀) ' + sel(p, '넘김 사유') + ' ' + chatId); skipped++; await zzz(200); continue; }
    console.log('[' + done + '] ' + sel(p, '넘김 사유') + ' | 기존:「' + rt(p, '처리 결과 / 한 줄 규칙').slice(0, 24) + '」\n      → ' + line);
    if (APPLY) {
      try {
        await axios.patch('https://api.notion.com/v1/pages/' + p.id, { properties: { '처리 결과 / 한 줄 규칙': { rich_text: [{ text: { content: line.slice(0, 1900) } }] } } }, NH);
        written++;
      } catch (e) { console.error('      기록 실패:', e.response ? e.response.status : e.message); }
      await zzz(350);
    }
    await zzz(250);
  }
  console.log('\n처리 ' + done + '건 | 기록 ' + written + '건 | 건너뜀(근거부족·조회실패) ' + skipped + '건 | 남은 대상 약 ' + Math.max(0, targets.length - done) + '건');
})().catch(function (e) { console.error('FAIL:', e.response ? e.response.status + ' ' + JSON.stringify(e.response.data).slice(0, 200) : e.message); });
