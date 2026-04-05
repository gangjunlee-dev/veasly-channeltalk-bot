require('dotenv').config();
var channeltalk = require('../lib/channeltalk');

async function setup() {
  console.log('===== Veasly ChannelTalk Bot Setup =====');

  console.log('[1/2] Creating bot...');
  try {
    var botResult = await channeltalk.createBot('Veasly小幫手', '', '#6B4EFF');
    console.log('Bot created: ' + (botResult.bot && botResult.bot.id));
  } catch (err) {
    console.log('Bot creation skipped: ' + err.message);
  }

  var args = process.argv;
  var webhookUrl = null;
  for (var i = 0; i < args.length; i++) {
    if (args[i].indexOf('--webhook-url=') === 0) {
      webhookUrl = args[i].split('=')[1];
    }
  }

  if (webhookUrl) {
    console.log('[2/2] Creating webhook: ' + webhookUrl);
    try {
      var whResult = await channeltalk.createWebhook('Veasly Auto-Response Bot', webhookUrl);
      console.log('Webhook created: ' + (whResult.webhook && whResult.webhook.id));
    } catch (err) {
      console.log('Webhook creation failed: ' + err.message);
    }
  } else {
    console.log('[2/2] No --webhook-url provided, skipping.');
  }

  console.log('\n===== Current Status =====');
  var bots = await channeltalk.listBots();
  console.log('Bots: ' + ((bots.bots && bots.bots.length) || 0));
  var webhooks = await channeltalk.listWebhooks();
  console.log('Webhooks: ' + ((webhooks.webhooks && webhooks.webhooks.length) || 0));

  console.log('\n===== Setup Complete =====');
}

setup().catch(function(e) { console.error(e); });
