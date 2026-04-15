var axios = require('axios');
var dotenv = require('dotenv');
dotenv.config();

var ADMIN_URL = 'https://admin.veasly.com';
var LOGIN_EMAIL = process.env.VEASLY_LOGIN_EMAIL || 'support@newndy.com';
var LOGIN_PASSWORD = process.env.VEASLY_LOGIN_PASSWORD || 'abcd1234';

var currentToken = process.env.VEASLY_API_TOKEN || '';
var tokenExpiry = 0;

async function refreshToken() {
  try {
    // Step 1: Get CSRF token + cookie
    var csrfRes = await axios.get(ADMIN_URL + '/api/auth/csrf', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    var csrfToken = csrfRes.data.csrfToken;
    var csrfCookies = (csrfRes.headers['set-cookie'] || []).map(function(c) { return c.split(';')[0]; }).join('; ');

    // Step 2: Login with credentials
    var body = 'providerId=' + encodeURIComponent(LOGIN_EMAIL) + '&password=' + encodeURIComponent(LOGIN_PASSWORD) + '&redirect=false&csrfToken=' + csrfToken + '&callbackUrl=' + encodeURIComponent(ADMIN_URL + '/auth/sign-in') + '&json=true';
    var loginRes = await axios.post(ADMIN_URL + '/api/auth/callback/credentials', body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': csrfCookies,
        'User-Agent': 'Mozilla/5.0',
        'Origin': ADMIN_URL,
        'Referer': ADMIN_URL + '/auth/sign-in'
      },
      maxRedirects: 0,
      validateStatus: function(s) { return true; }
    });

    var allCookies = (loginRes.headers['set-cookie'] || []).map(function(c) { return c.split(';')[0]; });
    var hasSess = allCookies.some(function(c) { return c.indexOf('session-token') > -1; });
    if (!hasSess) throw new Error('Login failed - no session token');

    // Step 3: Get session to extract accessToken
    var merged = csrfCookies + '; ' + allCookies.join('; ');
    var sessRes = await axios.get(ADMIN_URL + '/api/auth/session', {
      headers: { Cookie: merged }
    });

    var session = sessRes.data;
    if (!session.account || !session.account.accessToken) throw new Error('No accessToken in session');

    currentToken = session.account.accessToken;
    // Token expires in 1 day, refresh every 20 hours
    tokenExpiry = Date.now() + 20 * 60 * 60 * 1000;

    console.log('[Auth] Token refreshed successfully. User:', session.user.name, '| Expires:', new Date(tokenExpiry).toISOString());
    return currentToken;
  } catch (err) {
    console.error('[Auth] Token refresh failed:', err.message);
    throw err;
  }
}

async function getToken() {
  if (!currentToken || Date.now() > tokenExpiry) {
    await refreshToken();
  }
  return currentToken;
}

// Auto-refresh every 20 hours
var refreshInterval = null;
function startAutoRefresh() {
  refreshToken().then(function() {
    refreshInterval = setInterval(function() {
      refreshToken().catch(function(e) { console.error('[Auth] Auto-refresh failed:', e.message); });
    }, 20 * 60 * 60 * 1000);
    console.log('[Auth] Auto-refresh scheduled every 20 hours');
  }).catch(function(e) {
    console.error('[Auth] Initial refresh failed, using .env token:', e.message);
    tokenExpiry = Date.now() + 60 * 60 * 1000; // retry in 1 hour
  });
}

module.exports = {
  getToken: getToken,
  refreshToken: refreshToken,
  startAutoRefresh: startAutoRefresh,
  getCurrentToken: function() { return currentToken; }
};
