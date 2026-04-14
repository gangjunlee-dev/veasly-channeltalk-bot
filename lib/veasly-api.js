require('dotenv').config();
var axios = require('axios');

var client = axios.create({
  baseURL: process.env.VEASLY_API_URL || 'https://api.veasly.com',
  headers: {
    'Authorization': 'Bearer ' + (process.env.VEASLY_API_TOKEN || ''),
    'Content-Type': 'application/json'
  }
});

async function findUserByEmail(email) {
  if (!email) return null;
  try {
    var res = await client.get('/admin/users/0/20?query=' + encodeURIComponent(email) + '&queryType=USER_EMAIL');
    if (res.data && res.data.data && res.data.data.length > 0) {
      return res.data.data[0];
    }
    return null;
  } catch(e) {
    console.error('[VEASLY API] findUserByEmail error:', e.message);
    return null;
  }
}

async function findUserByName(name) {
  if (!name) return null;
  try {
    var res = await client.get('/admin/users/0/20?query=' + encodeURIComponent(name) + '&queryType=USER_NAME');
    if (res.data && res.data.data && res.data.data.length > 0) {
      return res.data.data[0];
    }
    return null;
  } catch(e) {
    console.error('[VEASLY API] findUserByName error:', e.message);
    return null;
  }
}

function formatUserInfo(user, lang) {
  if (!user) return '';
  var templates = {
    'zh-TW': '[會員資訊] ' + user.name + ' | 訂單: ' + (user.requestCount || 0) + '筆 | 點數: TWD ' + (user.credit || 0) + ' | 加入: ' + (user.createdAt || '').substring(0, 10),
    'ko': '[회원정보] ' + user.name + ' | 주문: ' + (user.requestCount || 0) + '건 | 크레딧: TWD ' + (user.credit || 0) + ' | 가입: ' + (user.createdAt || '').substring(0, 10),
    'en': '[Member Info] ' + user.name + ' | Orders: ' + (user.requestCount || 0) + ' | Credit: TWD ' + (user.credit || 0) + ' | Joined: ' + (user.createdAt || '').substring(0, 10),
    'ja': '[会員情報] ' + user.name + ' | 注文: ' + (user.requestCount || 0) + '件 | クレジット: TWD ' + (user.credit || 0) + ' | 登録: ' + (user.createdAt || '').substring(0, 10)
  };
  return templates[lang] || templates['zh-TW'];
}

module.exports = { findUserByEmail: findUserByEmail, findUserByName: findUserByName, formatUserInfo: formatUserInfo };
