// ============================================================
// app.js — Main application controller
// ============================================================

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────
  let wheel    = null;
  let table    = null;
  let ws       = null;
  let user     = null;
  let spinning = false;

  // Auto-spin state
  let autoSpinActive    = false;
  let autoSpinRemaining = 0;
  let autoSessionNet    = 0;
  let autoStopWin       = 0;
  let autoStopLoss      = 0;

  // ── Initialise ────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    _initAuth();

    // Auto-login if token stored
    const token = API.getToken();
    if (token) {
      API.me()
        .then(data => {
          if (data.isAdmin) { window.location.href = '/admin.html'; return; }
          _enterGame(data.user, data.nextRoundHash);
        })
        .catch(() => { API.clearToken(); });
    }
  });

  // ══════════════════════════════════════════════════════
  // AUTH
  // ══════════════════════════════════════════════════════

  function _initAuth() {
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`${tab.dataset.tab}-form`).classList.add('active');
        document.getElementById('auth-error').textContent = '';
      });
    });

    document.getElementById('login-btn').addEventListener('click', async () => {
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      if (!username) return _authError('Please enter a username');
      if (!password) return _authError('Please enter a password');
      try {
        const data = await API.login(username, password);
        API.setToken(data.token);
        if (data.isAdmin) { window.location.href = '/admin.html'; return; }
        _enterGame(data.user, data.nextRoundHash);
      } catch (e) {
        _authError(e.message);
      }
    });

    document.getElementById('login-password').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('login-btn').click();
    });

    document.getElementById('register-btn').addEventListener('click', async () => {
      const username = document.getElementById('register-username').value.trim();
      const password = document.getElementById('register-password').value;
      if (!username) return _authError('Please enter a username');
      if (password.length < 4) return _authError('Password must be at least 4 characters');
      try {
        const data = await API.register(username, password);
        API.setToken(data.token);
        _enterGame(data.user, data.nextRoundHash);
      } catch (e) {
        _authError(e.message);
      }
    });

    document.getElementById('register-password').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('register-btn').click();
    });
  }

  function _authError(msg) {
    document.getElementById('auth-error').textContent = msg;
  }

  // ══════════════════════════════════════════════════════
  // GAME INIT
  // ══════════════════════════════════════════════════════

  function _enterGame(userData, nextHash) {
    user = userData;

    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');

    document.getElementById('header-username').textContent = user.username;
    UI.updateBalance(user.balance);

    if (!wheel) {
      wheel = new RouletteWheel(document.getElementById('wheel-canvas'));
    }

    if (!table) {
      table = new BettingTable(document.getElementById('betting-table'));
      table.getBalance = () => user.balance;
      document.getElementById('betting-table').addEventListener('betsChanged', _onBetsChanged);
    } else {
      table.getBalance = () => user.balance;
    }

    // Chip selector
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        table.setChipValue(parseInt(chip.dataset.val));
      });
    });

    document.getElementById('spin-btn').addEventListener('click', () => {
      if (autoSpinActive) return; // manual spin blocked during auto
      _onSpin();
    });

    document.getElementById('undo-btn').addEventListener('click', () => {
      if (!table.undoLastBet()) UI.toast('Nothing to undo', 'info');
    });

    document.getElementById('clear-btn').addEventListener('click', () => table.clearBets());

document.getElementById('logout-btn').addEventListener('click', _onLogout);

    document.getElementById('fair-toggle').addEventListener('click', () => {
      const body   = document.getElementById('fair-body');
      const header = document.getElementById('fair-toggle');
      const hidden = body.classList.toggle('hidden');
      header.classList.toggle('open', !hidden);
    });

    // Custom chip
    const customInput = document.getElementById('custom-chip-input');
    const applyCustomChip = () => {
      let val = parseInt(customInput.value);
      if (!val || val < 1) return;
      val = Math.min(val, user.balance);
      customInput.value = val;
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      customInput.classList.add('custom-chip-active');
      table.setChipValue(val);
    };
    document.getElementById('custom-chip-btn').addEventListener('click', applyCustomChip);
    customInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyCustomChip(); });
    customInput.addEventListener('focus', () => customInput.max = user.balance);

    // Deactivate custom chip when a regular chip is selected
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => customInput.classList.remove('custom-chip-active'));
    });

    // Quick bets
    document.getElementById('qb-lucky').addEventListener('click', () => {
      const num = Math.floor(Math.random() * 36) + 1;
      table.placeBet('straight', String(num));
    });

    // Auto-spin
    document.getElementById('auto-btn').addEventListener('click', () => {
      document.getElementById('auto-config').classList.toggle('hidden');
    });
    document.getElementById('auto-start').addEventListener('click', _startAutoSpin);
    document.getElementById('auto-stop').addEventListener('click',  () => _stopAutoSpin('Auto-spin stopped'));
    document.querySelectorAll('.auto-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.auto-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    _setFairnessHash(nextHash);
    _refreshStats();
    _refreshLeaderboard();
    UI.renderAchievements(user.achievements || []);
    UI.initHistModal();
    API.history().then(data => UI.loadHistory(data.history)).catch(() => {});
    _connectWS();
  }

  // ══════════════════════════════════════════════════════
  // SPIN
  // ══════════════════════════════════════════════════════

  async function _onSpin() {
    if (spinning) return;

    const bets = table.getBets();
    if (bets.length === 0) {
      UI.toast('Place at least one bet!', 'error');
      return;
    }

    if (table.getTotalBet() > user.balance) {
      UI.toast('Insufficient balance!', 'error');
      return;
    }

    spinning = true;
    _setSpinUI(true);
    table.setEnabled(false);
    table.saveBets();

    const clientSeed = document.getElementById('client-seed').value.trim() || null;

    try {
      const data = await API.spin(bets, clientSeed);
      wheel.spin(data.result.number, () => _onSpinComplete(data));
    } catch (e) {
      UI.toast(e.message || 'Spin failed', 'error');
      spinning = false;
      _setSpinUI(false);
      table.setEnabled(true);
    }
  }

  function _onSpinComplete(data) {
    const { result, netResult, balance, proof, nextRoundHash, newAchievements, stats,
            betResults, totalBet, totalPayout } = data;

    user.balance = balance;
    user.stats   = stats;

    UI.updateBalance(balance);
    UI.showResult(result.number, result.color, netResult);
    table.highlightWinners(result.number);

    // History entry
    UI.addHistoryEntry(result.number, result.color, netResult, betResults, totalBet, totalPayout);

    if (netResult > 0) {
      UI.flashBalance('win');
      _launchConfettiForWin(netResult);
      UI.toast(`+${UI.fmt(netResult)} CR — You won!`, 'success');
    } else if (netResult < 0) {
      UI.flashBalance('lose');
      UI.toast(`-${UI.fmt(Math.abs(netResult))} CR — Better luck next time`, 'error');
    } else {
      UI.toast('Break even — no change', 'info');
    }

    _showLastProof(proof, result.number, result.color);
    _setFairnessHash(nextRoundHash);

    if (newAchievements && newAchievements.length) {
      newAchievements.forEach(ach => UI.showAchievementUnlock(ach));
      const allIds = [...(user.achievements || []), ...newAchievements.map(a => a.id)];
      user.achievements = [...new Set(allIds)];
      UI.renderAchievements(user.achievements);
    }

    _refreshStats();

    spinning = false;
    _setSpinUI(false);
    table.setEnabled(true);
    table.clearBets();

    if (autoSpinActive) {
      _checkAutoSpin(netResult);
    } else {
      table.repeatBets();
    }
  }

  function _launchConfettiForWin(netResult) {
    if (netResult < 50)        return;
    if (netResult < 300)       UI.launchConfetti(2000, 55);
    else if (netResult < 1500) UI.launchConfetti(3500, 130);
    else                       UI.launchConfetti(6000, 290);
  }

  // ══════════════════════════════════════════════════════
  // AUTO-SPIN
  // ══════════════════════════════════════════════════════

  function _startAutoSpin() {
    const count    = Math.max(1, Math.min(500, parseInt(document.getElementById('auto-count').value)  || 10));
    const stopWin  = parseInt(document.getElementById('auto-win').value)  || 0;
    const stopLoss = parseInt(document.getElementById('auto-loss').value) || 0;
    const mode     = document.querySelector('.auto-mode-btn.active')?.dataset.mode || 'watch';

    const bets = table.getBets();
    if (bets.length === 0) { UI.toast('Place bets first', 'error'); return; }

    autoSpinActive    = true;
    autoSpinRemaining = count;
    autoSessionNet    = 0;
    autoStopWin       = stopWin;
    autoStopLoss      = stopLoss;

    document.getElementById('auto-config').classList.add('hidden');
    document.getElementById('auto-status').classList.remove('hidden');
    document.getElementById('auto-btn').textContent = '⟳ Auto (running)';
    _updateAutoStatus();

    if (mode === 'fast') {
      _runFastAutoSpin(count, stopWin, stopLoss, bets);
    } else {
      _onSpin();
    }
  }

  async function _runFastAutoSpin(total, stopWin, stopLoss, bets) {
    table.setEnabled(false);
    _setSpinUI(true);
    let done = 0;

    while (autoSpinActive && done < total) {
      const totalBet = bets.reduce((s, b) => s + b.amount, 0);
      if (totalBet > user.balance) { _stopAutoSpin('Insufficient balance'); break; }

      try {
        const data = await API.spin(bets, null);
        user.balance = data.balance;
        user.stats   = data.stats;
        UI.updateBalance(data.balance);
        UI.addHistoryEntry(data.result.number, data.result.color, data.netResult,
                           data.betResults, data.totalBet, data.totalPayout);

        autoSessionNet    += data.netResult;
        autoSpinRemaining--;
        done++;
        _updateAutoStatus();

        if (stopWin  > 0 && autoSessionNet >=  stopWin)  { _stopAutoSpin(`Win target reached (+${UI.fmt(autoSessionNet)} CR)`);  break; }
        if (stopLoss > 0 && autoSessionNet <= -stopLoss)  { _stopAutoSpin(`Loss limit reached (${UI.fmt(autoSessionNet)} CR)`); break; }

        if (data.newAchievements?.length) {
          data.newAchievements.forEach(a => UI.showAchievementUnlock(a));
        }
      } catch (e) {
        UI.toast(e.message || 'Spin failed', 'error');
        break;
      }
    }

    if (autoSpinActive) _stopAutoSpin(`Done — ${done} spins, net ${autoSessionNet >= 0 ? '+' : ''}${UI.fmt(autoSessionNet)} CR`);
    _setSpinUI(false);
    table.setEnabled(true);
    _refreshStats();
  }

  function _stopAutoSpin(reason) {
    autoSpinActive = false;
    document.getElementById('auto-status').classList.add('hidden');
    document.getElementById('auto-btn').textContent = '⟳ Auto';
    if (reason) UI.toast(reason, 'info');
  }

  function _updateAutoStatus() {
    document.getElementById('auto-remaining').textContent = `${autoSpinRemaining} left`;
  }

  function _checkAutoSpin(netResult) {
    autoSessionNet    += netResult;
    autoSpinRemaining--;
    _updateAutoStatus();

    if (autoSpinRemaining <= 0) { _stopAutoSpin('Auto-spin complete'); return; }
    if (autoStopWin  > 0 && autoSessionNet >=  autoStopWin)  { _stopAutoSpin(`Win target reached (+${UI.fmt(autoSessionNet)} CR)`);  return; }
    if (autoStopLoss > 0 && autoSessionNet <= -autoStopLoss) { _stopAutoSpin(`Loss limit reached (${UI.fmt(autoSessionNet)} CR)`); return; }

    // Repeat bets and spin again
    setTimeout(() => {
      const result = table.repeatBets();
      if (!result || result === 'insufficient') {
        _stopAutoSpin(result === 'insufficient' ? 'Insufficient balance' : 'No bets to repeat');
        return;
      }
      _onSpin();
    }, 1200);
  }

  function _setSpinUI(active) {
    const btn = document.getElementById('spin-btn');
    btn.disabled = active;
    btn.classList.toggle('spinning', active);
    btn.textContent = active ? 'SPINNING…' : 'SPIN';
  }

  // ══════════════════════════════════════════════════════
  // BET SUMMARY
  // ══════════════════════════════════════════════════════

  function _onBetsChanged(e) {
    const { total } = e.detail;
    document.getElementById('bet-total').textContent  = UI.fmtBalance(total);
    document.getElementById('bet-maxwin').textContent = UI.fmtBalance(table.getMaxPotentialWin());
  }

  // ══════════════════════════════════════════════════════
  // PROVABLY FAIR
  // ══════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════
  // PROVABLY FAIR
  // ══════════════════════════════════════════════════════

  function _setFairnessHash(hash) {
    const el = document.getElementById('fair-hash');
    if (el) el.textContent = hash || '—';
  }

  function _showLastProof(proof, number, color) {
    const panel = document.getElementById('last-proof');
    if (!panel) return;
    panel.classList.remove('hidden');
    document.getElementById('proof-ss').textContent   = proof.serverSeed || '—';
    document.getElementById('proof-cs').textContent   = proof.clientSeed || '—';
    document.getElementById('proof-hash').textContent = proof.hash       || '—';
    document.getElementById('proof-res').textContent  = `${number} (${color})`;
  }

  // ══════════════════════════════════════════════════════
  // HEADER ACTIONS
  // ══════════════════════════════════════════════════════

  async function _onReset() {
    if (!confirm('Reset your account to 1,000 credits? All history will be cleared.')) return;
    try {
      const data = await API.reset();
      user.balance = data.balance;
      UI.updateBalance(data.balance);
      UI.toast('Account reset to 1,000 credits', 'info');
      _refreshStats();
    } catch (e) {
      UI.toast('Reset failed', 'error');
    }
  }

  async function _onLogout() {
    try { await API.logout(); } catch (_) {}
    API.clearToken();
    user              = null;
    spinning          = false;
    autoSpinActive    = false;
    document.getElementById('game-screen').classList.remove('active');
    document.getElementById('auth-screen').classList.add('active');
    if (ws) { ws.close(); ws = null; }
    document.getElementById('login-username').value    = '';
    document.getElementById('login-password').value    = '';
    document.getElementById('register-username').value = '';
    document.getElementById('register-password').value = '';
  }

  // ══════════════════════════════════════════════════════
  // DATA REFRESH
  // ══════════════════════════════════════════════════════

  async function _refreshStats() {
    try {
      const data = await API.stats();
      UI.updateStats(data.stats, data.colorCounts, data.hotNumber, data.hotCount, data.lastNumbers);
    } catch (_) {}
  }

  async function _refreshLeaderboard() {
    try {
      const data = await API.leaderboard();
      UI.updateLeaderboard(data.leaderboard);
    } catch (_) {}
  }

  setInterval(_refreshLeaderboard, 30000);

  // ══════════════════════════════════════════════════════
  // WEBSOCKET — player count only
  // ══════════════════════════════════════════════════════

  function _connectWS() {
    if (ws && ws.readyState <= 1) return;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);

    ws.onopen = () => console.log('[WS] Connected');

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'connected' || msg.type === 'player_count') {
          const el = document.getElementById('online-count');
          if (el) el.textContent = msg.playerCount || msg.count || 0;
        }
        if (msg.type === 'balance_update' && user && msg.userId === user.id) {
          user.balance = msg.balance;
          UI.updateBalance(msg.balance);
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      setTimeout(() => {
        if (document.getElementById('game-screen').classList.contains('active')) _connectWS();
      }, 5000);
    };

    ws.onerror = () => ws.close();
  }

})();
