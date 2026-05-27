// Unit test for isActionRequest classification after refund_delay addition
var fs = require('fs');
var path = require('path');
var webhookSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'webhook.js'), 'utf8');
// Extract isActionRequest function source via regex
var m = webhookSrc.match(/function isActionRequest\(text\)[\s\S]*?\n\}\n/);
if (!m) { console.error('isActionRequest not found'); process.exit(2); }
var fnSrc = m[0];
// Build a runnable harness
var harness = fnSrc + '\nmodule.exports = isActionRequest;';
var tmpFile = path.join(__dirname, '_isActionRequest-harness.js');
fs.writeFileSync(tmpFile, harness, 'utf8');
var fn = require(tmpFile);

var cases = [
  { input: '訂單編號：20260223TW317228870\n到現在還沒收到運費退款，也太久了吧', expect: 'refund_delay', desc: 'Original bug case: refund delay (was misclassified as shipping_delay)' },
  { input: '我的包裹還沒到', expect: 'shipping_delay', desc: 'Pure shipping delay still works' },
  { input: '운임 환불 언제 받을 수 있어요?', expect: 'refund_delay', desc: 'Korean refund delay' },
  { input: 'still no refund after a week', expect: 'refund_delay', desc: 'English refund delay' },
  { input: '訂單什麼時候出貨', expect: 'shipping_delay', desc: 'Shipping question, no refund' },
  { input: '取消原因是什麼？', expect: 'cancel_reason', desc: 'Cancel reason still works' },
  { input: '想修改地址', expect: 'order_modify', desc: 'Order modify still works' },
  { input: '你好 我想問問', expect: null, desc: 'Generic greeting - no action_request' },
  { input: '退款還沒到帳', expect: 'refund_delay', desc: 'Refund not yet credited' },
  { input: '退費沒收到', expect: 'refund_delay', desc: 'Refund not received (alt term)' }
];
var pass = 0, fail = 0;
cases.forEach(function(c, i){
  var got = fn(c.input);
  var ok = got === c.expect;
  console.log((ok ? '✅' : '❌') + ' [' + (i+1) + '] ' + c.desc);
  console.log('   input  : ' + c.input.replace(/\n/g, ' / '));
  console.log('   expect : ' + c.expect + '  got: ' + got);
  if (ok) pass++; else fail++;
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
fs.unlinkSync(tmpFile);
process.exit(fail > 0 ? 1 : 0);
