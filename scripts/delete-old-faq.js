require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
var path = require('path');
var fs = require('fs');
var { Pinecone } = require('@pinecone-database/pinecone');

(async function() {
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var desc = await pc.describeIndex(process.env.PINECONE_INDEX_NAME || 'veasly-cs');
  var index = pc.index({ host: desc.host });
  var ns = index.namespace('faq');

  var ids = JSON.parse(fs.readFileSync(path.join(__dirname, 'faq-delete-ids.json'), 'utf8'));
  console.log('Total IDs to delete:', ids.length);

  // Try deleteMany with ids property first, fallback to individual
  var batchSize = 50;
  var deleted = 0;
  var errors = 0;

  for (var i = 0; i < ids.length; i += batchSize) {
    var batch = ids.slice(i, i + batchSize);
    try {
      await ns.deleteMany({ ids: batch });
      deleted += batch.length;
    } catch(e) {
      // fallback: delete one by one
      for (var j = 0; j < batch.length; j++) {
        try {
          await ns.deleteOne(batch[j]);
          deleted++;
        } catch(e2) {
          errors++;
        }
      }
    }
    console.log('Progress: ' + deleted + '/' + ids.length + (errors > 0 ? ' (errors: ' + errors + ')' : ''));
  }

  console.log('\nDone. Deleted: ' + deleted + ', Errors: ' + errors);

  var stats = await index.describeIndexStats();
  console.log('FAQ namespace now:', stats.namespaces.faq.recordCount, 'vectors');
})();
