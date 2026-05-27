var fs = require('fs');
var path = require('path');
var p = path.join(__dirname, '..', 'data', 'ai-conversations.json');
var data = JSON.parse(fs.readFileSync(p, 'utf8'));
var target = process.argv[2] || '6a16a85974559917a8a5';
var hits = data.filter(function(d){ return d.chatId === target; });
console.log('Total entries for chatId ' + target + ':', hits.length);
hits.forEach(function(h, i){
  console.log('\n--- ' + (i+1) + '. ' + h.timestamp + ' | type:' + h.type + ' ---');
  console.log('user :', (h.userMessage || '').substring(0, 200));
  console.log('bot  :', (h.aiResponse || '').substring(0, 400));
  console.log('meta : escalated=' + h.escalated + ' | category=' + h.category + ' | confidence=' + h.confidence + (h.escalationReason ? ' | reason=' + h.escalationReason : ''));
});
