require('dotenv').config();
var fs = require('fs');
var path = require('path');
var { Pinecone } = require('@pinecone-database/pinecone');

(async () => {
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME || 'veasly-cs');
  var idx = pc.index({ host: desc.host });
  var ns = idx.namespace('faq');

  // Enumerate all IDs
  var allIds = [];
  var nextToken;
  do {
    var page = await ns.listPaginated({ limit: 100, paginationToken: nextToken });
    for (var i = 0; i < (page.vectors||[]).length; i++) allIds.push(page.vectors[i].id);
    nextToken = page.pagination && page.pagination.next;
  } while (nextToken);

  var targetIds = allIds.filter(function(id) {
    return id.indexOf('auto_faq') === 0 || id.indexOf('auto_esc') === 0;
  });
  console.log('Total ids:', allIds.length, '| target (auto_*):', targetIds.length);

  // Fetch in chunks of 100
  var records = {};
  for (var off = 0; off < targetIds.length; off += 100) {
    var chunk = targetIds.slice(off, off + 100);
    var r = await ns.fetch({ ids: chunk });
    Object.assign(records, r.records || {});
    process.stdout.write('  fetched ' + (off + chunk.length) + '/' + targetIds.length + '\r');
  }
  console.log('\nTotal records fetched:', Object.keys(records).length);

  var output = {
    backupTime: new Date().toISOString(),
    namespace: 'faq',
    indexName: process.env.PINECONE_INDEX_NAME || 'veasly-cs',
    indexHost: desc.host,
    deletedReason: '2026-05-27 cleanup of auto-generated FAQ pollution (autonomous in auto-upgrade.js cron)',
    totalIds: targetIds.length,
    records: records
  };

  var outPath = path.join(__dirname, '..', 'data', '_backup-auto-faqs-20260527.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log('Backup written to:', outPath);
  var stats = fs.statSync(outPath);
  console.log('File size:', (stats.size / 1024).toFixed(1) + ' KB');
})().catch(function(e){ console.error('ERR:', e.message); process.exit(1); });
