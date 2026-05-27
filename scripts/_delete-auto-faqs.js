require('dotenv').config();
var fs = require('fs');
var path = require('path');
var { Pinecone } = require('@pinecone-database/pinecone');

(async () => {
  var backupPath = path.join(__dirname, '..', 'data', '_backup-auto-faqs-20260527.json');
  if (!fs.existsSync(backupPath)) {
    console.error('ABORT: backup file not found at', backupPath);
    process.exit(1);
  }
  var backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  var ids = Object.keys(backup.records || {});
  if (ids.length !== backup.totalIds) {
    console.error('ABORT: backup record count mismatch', ids.length, 'vs', backup.totalIds);
    process.exit(1);
  }
  console.log('Will delete', ids.length, 'ids from faq namespace');

  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME || 'veasly-cs');
  var idx = pc.index({ host: desc.host });
  var ns = idx.namespace('faq');

  var pre = await idx.describeIndexStats();
  console.log('PRE counts:', JSON.stringify(pre.namespaces, null, 2));

  // Delete in chunks
  for (var off = 0; off < ids.length; off += 100) {
    var chunk = ids.slice(off, off + 100);
    try {
      await ns.deleteMany(chunk);
    } catch (e1) {
      try { await ns.deleteMany({ ids: chunk }); }
      catch (e2) { throw new Error('deleteMany failed: ' + e1.message + ' | ' + e2.message); }
    }
    process.stdout.write('  deleted ' + (off + chunk.length) + '/' + ids.length + '\r');
  }
  console.log('\nDelete calls issued.');

  // Wait briefly for eventual consistency, then re-check
  await new Promise(function(r){ setTimeout(r, 3000); });
  var post = await idx.describeIndexStats();
  console.log('POST counts:', JSON.stringify(post.namespaces, null, 2));
  var faqPre = (pre.namespaces && pre.namespaces.faq && pre.namespaces.faq.recordCount) || 0;
  var faqPost = (post.namespaces && post.namespaces.faq && post.namespaces.faq.recordCount) || 0;
  console.log('faq namespace: ' + faqPre + ' → ' + faqPost + ' (delta: ' + (faqPre - faqPost) + ')');
})().catch(function(e){ console.error('ERR:', e.message); process.exit(1); });
