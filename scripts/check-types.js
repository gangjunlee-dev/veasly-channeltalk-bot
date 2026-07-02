var path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
var auth = require('../lib/auth');
var axios = require('axios');

(async function(){
  var token = await auth.getToken();
  var h = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  var res = await axios.get('https://api.veasly.com/admin/credits/0/200', {headers:h});
  var types = {};
  res.data.data.forEach(function(c) {
    var key = c.type + '/' + c.subType;
    if (types[key] === undefined) {
      types[key] = { count: 0, sample: c.descriptionKR || c.descriptionTW || '' };
    }
    types[key].count = types[key].count + 1;
  });
  console.log('=== type/subType 분포 ===');
  var keys = Object.keys(types).sort();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    console.log(k + ' (' + types[k].count + ') - ' + types[k].sample);
  }
})();
