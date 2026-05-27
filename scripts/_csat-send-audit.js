var fs = require('fs');
var path = require('path');
var sent = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'csat-sent.json'), 'utf8'));
var events = [];
try { events = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'csat-events.json'), 'utf8')); } catch(e) {}
var results = [];
try { results = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'csat-results.json'), 'utf8')); } catch(e) {}

var now = Date.now();
var DAY = 86400000;
function summarize(records, recentMs, label) {
  var total = 0, recent = 0, today = 0, sources = {};
  Object.keys(records).forEach(function(k){
    var r = records[k];
    if (!r) return;
    total++;
    var t = r.sentAt || r.ts || (typeof r === 'number' ? r : 0);
    if (t > 0 && now - t < recentMs) recent++;
    if (t > 0 && (now - t) < DAY) today++;
    var src = r.source || (r.skipped ? '(skipped)' : (r.warning ? '(warning-only)' : '(unknown)'));
    sources[src] = (sources[src] || 0) + 1;
  });
  console.log(label);
  console.log('  total records:', total);
  console.log('  last 24h:', today);
  console.log('  last 7d:', recent);
  console.log('  by source:', JSON.stringify(sources, null, 2));
}

summarize(sent, 7 * DAY, '=== csat-sent.json ===');
console.log('\n=== csat-results.json (responses received) ===');
console.log('  total:', results.length);
var recentResp = results.filter(function(r){ var t = r.timestamp || r.ts || 0; return t > now - 7*DAY; });
console.log('  last 7d responses:', recentResp.length);
console.log('  last 5 entries:');
results.slice(-5).forEach(function(r){
  var dt = r.timestamp ? new Date(r.timestamp).toISOString() : '(no ts)';
  console.log('    ' + dt + ' chat:' + r.chatId + ' score:' + r.score);
});

console.log('\n=== csat-events.json (link clicks) ===');
console.log('  total:', events.length);
events.slice(-3).forEach(function(e){ console.log('    ' + (e.at || '?') + ' chat:' + e.chatId); });

// Recent send timestamps
console.log('\n=== Recent sent (last 5) ===');
var recentSent = Object.keys(sent).map(function(k){ return { id: k, t: (sent[k] && sent[k].sentAt) || 0, src: (sent[k] && sent[k].source) || '?' }; }).filter(function(x){return x.t > 0;}).sort(function(a,b){return b.t - a.t;}).slice(0, 5);
recentSent.forEach(function(r){
  console.log('  ' + new Date(r.t).toISOString() + ' chat:' + r.id + ' src:' + r.src);
});
