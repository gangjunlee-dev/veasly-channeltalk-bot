var path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
var auth = require('../lib/auth');
var axios = require('axios');

(async function(){
  var token = await auth.getToken();
  var h = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  var body = { userId: 63508, type: 'EARNED', subType: 'ADMIN_ADJUSTMENT', amount: 1, expiresAt: '2027-12-31T00:00:00.000Z', descriptionKR: 'test', descriptionTW: 'test', descriptionJP: 'test' };

  // add 엔드포인트도 시도 + 다양한 URL 패턴
  var urls = [
    '/admin/credits/add',
    '/admin/credits/0/add',
    '/admin/credits/0/charge',
    '/admin/credits/earn',
    '/admin/credits/grant',
    '/admin/credits/give',
    '/admin/credit/charge',
    '/admin/credit/add'
  ];

  for (var i = 0; i < urls.length; i++) {
    try {
      var res = await axios.post('https://api.veasly.com' + urls[i], body, { headers: h });
      console.log('OK ' + urls[i] + ': ' + JSON.stringify(res.data).substring(0, 200));
      break;
    } catch(e) {
      var s = e.response ? e.response.status : 'ERR';
      var m = e.response ? JSON.stringify(e.response.data).substring(0, 100) : e.message;
      console.log(s + ' ' + urls[i] + ' → ' + m);
    }
  }
})();
