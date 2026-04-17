// ============================================================
// api.js — HTTP client wrapper
// All server communication goes through this module.
// ============================================================

const API = (() => {
  const BASE = '/api';
  let sessionToken = localStorage.getItem('casino_token') || null;

  function getToken()       { return sessionToken; }
  function setToken(tok)    { sessionToken = tok; localStorage.setItem('casino_token', tok); }
  function clearToken()     { sessionToken = null; localStorage.removeItem('casino_token'); }

  async function request(method, endpoint, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;

    const opts = { method, headers };
    if (body !== null) opts.body = JSON.stringify(body);

    const res  = await fetch(BASE + endpoint, opts);
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      clearToken();
      window.location.reload();
      return;
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const get  = (ep)          => request('GET',  ep);
  const post = (ep, body)    => request('POST', ep, body);

  return {
    getToken,
    setToken,
    clearToken,

    // Auth
    register: (username, password) => post('/register', { username, password }),
    login:    (username, password) => post('/login',    { username, password }),
    logout:   ()            => post('/logout'),
    me:       ()            => get('/me'),

    // Game
    spin:        (bets, clientSeed) => post('/spin', { bets, clientSeed }),
    history:     ()                 => get('/history'),
    stats:       ()                 => get('/stats'),
    balance:     ()                 => get('/balance'),
    leaderboard: ()                 => get('/leaderboard'),
    liveFeed:    ()                 => get('/live-feed'),
    dailyReward: ()                 => post('/daily-reward'),
    reset:       ()                 => post('/reset'),
  };
})();
