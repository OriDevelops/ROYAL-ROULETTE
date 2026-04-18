// ============================================================
// ui.js — UI helpers: toasts, confetti, result overlay,
//          stats panel, live feed, leaderboard, achievements
// ============================================================

const UI = (() => {

  // ── Toasts ────────────────────────────────────────────

  function toast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    const el        = document.createElement('div');
    el.className    = `toast ${type}`;

    const icons = { success: '✓', error: '✕', info: 'ℹ', 'big-win': '🎉' };
    el.innerHTML = `<span style="font-size:16px">${icons[type] || 'ℹ'}</span><span>${message}</span>`;

    container.appendChild(el);
    setTimeout(() => el.remove(), duration + 400);
  }

  // ── Result Overlay ────────────────────────────────────

  function showResult(number, color, netResult) {
    const overlay = document.getElementById('result-overlay');
    const numEl   = document.getElementById('result-number');
    const colEl   = document.getElementById('result-color');
    const amtEl   = document.getElementById('result-amount');

    const colorMap = { red: '#e74c3c', black: '#ccc', green: '#2ecc71' };
    numEl.textContent  = number;
    numEl.style.color  = colorMap[color] || '#fff';
    colEl.textContent  = color.toUpperCase();
    colEl.style.color  = colorMap[color] || '#fff';

    if (netResult > 0) {
      amtEl.textContent  = `+${fmt(netResult)} CR`;
      amtEl.className    = 'res-amount win';
    } else if (netResult < 0) {
      amtEl.textContent  = `${fmt(netResult)} CR`;
      amtEl.className    = 'res-amount lose';
    } else {
      amtEl.textContent  = '± 0 CR';
      amtEl.className    = 'res-amount';
    }

    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('hidden'), 3500);
  }

  // ── Balance display ───────────────────────────────────

  function updateBalance(amount) {
    const el = document.getElementById('balance-display');
    if (!el) return;
    el.textContent = fmtBalance(amount);
  }

  function flashBalance(type) {  // type: 'win' | 'lose'
    const el = document.getElementById('balance-display');
    if (!el) return;
    el.classList.remove('balance-win', 'balance-lose');
    void el.offsetWidth; // reflow
    el.classList.add(type === 'win' ? 'balance-win' : 'balance-lose');
    setTimeout(() => el.classList.remove('balance-win', 'balance-lose'), 600);
  }

  // ── Stats Panel ───────────────────────────────────────

  function updateStats(stats, colorCounts = {}, hotNumber = null, hotCount = 0, lastNumbers = []) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    const spins   = stats?.spins    || 0;
    const wins    = stats?.wins     || 0;
    const net     = stats?.netPL || 0;
    const rate    = spins > 0 ? ((wins / spins) * 100).toFixed(1) + '%' : '—';

    set('s-spins',  spins);
    set('s-wins',   wins);
    set('s-rate',   rate);
    set('s-best',   fmt(stats?.maxWin || 0));
    set('s-streak', stats?.maxStreak || 0);

    const netEl = document.getElementById('s-net');
    if (netEl) {
      netEl.textContent = (net >= 0 ? '+' : '') + fmt(net);
      netEl.style.color = net >= 0 ? '#2ecc71' : '#e74c3c';
    }

    // Last 10 spins bubbles
    const histRow = document.getElementById('spin-history');
    if (histRow && lastNumbers.length) {
      histRow.innerHTML = lastNumbers.map(({ number, color }) =>
        `<div class="spin-bubble ${color}">${number}</div>`
      ).join('');
    }

    // Distribution bars
    const total = (colorCounts.red || 0) + (colorCounts.black || 0) + (colorCounts.green || 0);
    if (total > 0) {
      const pct = (n) => Math.round((n / total) * 100) + '%';
      const setBar = (id, cnt, pctId) => {
        const el = document.getElementById(id);
        if (el) el.style.width = cnt > 0 ? pct(cnt) : '0%';
        const c = document.getElementById(pctId);
        if (c) c.textContent = cnt || 0;
      };
      setBar('dist-red',   colorCounts.red   || 0, 'cnt-red');
      setBar('dist-black', colorCounts.black || 0, 'cnt-black');
      setBar('dist-green', colorCounts.green || 0, 'cnt-green');
    }

    // Hot number
    const hotEl = document.getElementById('hot-number');
    if (hotEl) {
      hotEl.textContent = (hotNumber !== null && hotCount > 1)
        ? `🔥 Hot: #${hotNumber} (${hotCount}×)`
        : '';
    }
  }

  // ── Achievements Panel ────────────────────────────────

  const ALL_ACHIEVEMENTS = {
    first_win:    { icon: '🏆', name: 'First Win',      desc: 'Win your first bet' },
    hot_streak:   { icon: '🔥', name: 'Hot Streak',     desc: 'Win 3 spins in a row' },
    high_roller:  { icon: '💰', name: 'High Roller',    desc: 'Bet 500+ in one round' },
    lucky_zero:   { icon: '🍀', name: 'Zero Hero',      desc: 'Straight win on 0' },
    lucky_seven:  { icon: '7️⃣', name: 'Lucky Seven',   desc: 'Straight win on 7' },
    comeback:     { icon: '💪', name: 'Comeback Kid',   desc: 'Recover from under 100' },
    century:      { icon: '💯', name: 'Century',        desc: 'Complete 100 spins' },
    big_winner:   { icon: '💎', name: 'Big Winner',     desc: 'Win 1,000+ CR in one spin' },
  };

  function renderAchievements(unlockedIds = []) {
    const container = document.getElementById('achievements-list');
    if (!container) return;

    const unlocked = new Set(unlockedIds);
    container.innerHTML = Object.entries(ALL_ACHIEVEMENTS).map(([id, def]) => {
      const locked = !unlocked.has(id);
      return `
        <div class="achievement-item ${locked ? 'ach-locked' : ''}">
          <div class="ach-icon">${def.icon}</div>
          <div class="ach-text">
            <div class="ach-name">${def.name}</div>
            <div class="ach-desc">${def.desc}</div>
          </div>
        </div>`;
    }).join('');
  }

  function showAchievementUnlock(achievement) {
    const el   = document.createElement('div');
    el.className = 'achievement-popup';
    el.innerHTML = `
      <div class="ach-popup-icon">${achievement.icon}</div>
      <div class="ach-popup-text">
        <div class="ach-popup-label">Achievement Unlocked!</div>
        <div class="ach-popup-name">${achievement.name}</div>
        <div class="ach-popup-desc">${achievement.desc}</div>
      </div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // ── Live Feed ─────────────────────────────────────────

  function addFeedEntry(username, number, color, netResult) {
    const feed = document.getElementById('live-feed');
    if (!feed) return;

    const won   = netResult > 0;
    const abst  = Math.abs(netResult);
    const item  = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = `
      <div class="feed-dot ${color}">${number}</div>
      <span class="feed-name">${escHtml(username)}</span>
      <span class="feed-result ${won ? 'feed-win' : 'feed-lose'}">
        ${won ? '+' + fmt(abst) : '-' + fmt(abst)}
      </span>`;

    feed.insertBefore(item, feed.firstChild);

    // Keep only 20 entries
    while (feed.children.length > 20) feed.removeChild(feed.lastChild);
  }

  function populateFeed(entries) {
    entries.forEach(e => addFeedEntry(e.username || 'Player', e.number, e.color, e.netResult || 0));
  }

  // ── Leaderboard ───────────────────────────────────────

  function updateLeaderboard(entries) {
    const el = document.getElementById('leaderboard');
    if (!el) return;

    const medals = ['🥇','🥈','🥉'];
    el.innerHTML = entries.map((e, i) => `
      <div class="lb-item">
        <span class="lb-rank ${i < 3 ? 'top' + (i+1) : ''}">${medals[i] || i + 1}</span>
        <span class="lb-name">${escHtml(e.username)}</span>
        <span class="lb-balance">${fmtBalance(e.balance)}</span>
      </div>`).join('');
  }

  // ── Confetti ──────────────────────────────────────────

  let confettiAnimId = null;

  function launchConfetti(duration = 3000, particleCount = 120) {
    const canvas  = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx     = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors   = ['#f0d060', '#e74c3c', '#2ecc71', '#3498db', '#9b59b6', '#fff'];
    const particles = Array.from({ length: particleCount }, () => ({
      x:  Math.random() * canvas.width,
      y:  -10 - Math.random() * 100,
      r:  3 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.2,
    }));

    const end = performance.now() + duration;

    function frame(now) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const alive = [];
      particles.forEach(p => {
        p.x   += p.vx;
        p.y   += p.vy;
        p.rot += p.rotV;
        p.vy  += 0.08; // gravity

        if (p.y < canvas.height + 20) {
          alive.push(p);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
          ctx.restore();
        }
      });
      particles.length = 0;
      particles.push(...alive);

      if (now < end && particles.length > 0) {
        confettiAnimId = requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
    requestAnimationFrame(frame);
  }

  // ── Level display ─────────────────────────────────────

  const LEVEL_THRESHOLDS = [0, 100, 250, 500, 1000, 2000, 3500, 5500, 8000, 12000];

  function updateLevel(xp, level) {
    const lvlEl  = document.getElementById('player-level');
    const fillEl = document.getElementById('level-xp-fill');
    const txtEl  = document.getElementById('level-xp-text');
    if (!lvlEl) return;

    lvlEl.textContent = level;
    const curThresh  = LEVEL_THRESHOLDS[level - 1] || 0;
    const nextThresh = LEVEL_THRESHOLDS[level] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    const pct        = level >= LEVEL_THRESHOLDS.length
      ? 100
      : Math.min(100, Math.round(((xp - curThresh) / (nextThresh - curThresh)) * 100));
    if (fillEl) fillEl.style.width = pct + '%';
    if (txtEl)  txtEl.textContent  = level >= LEVEL_THRESHOLDS.length ? 'MAX' : `${xp - curThresh}/${nextThresh - curThresh}`;
  }

  function showLevelUp(level, bonus) {
    const el = document.createElement('div');
    el.className = 'levelup-popup';
    el.innerHTML = `
      <div class="levelup-title">Level Up!</div>
      <div class="levelup-num">${level}</div>
      <div class="levelup-bonus">+${bonus} CR bonus!</div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  // ── Bet history ───────────────────────────────────────

  const BET_LABELS = {
    red: 'Red', black: 'Black', odd: 'Odd', even: 'Even',
    low: '1-18', high: '19-36',
    dozen1: '1st 12', dozen2: '2nd 12', dozen3: '3rd 12',
    column1: 'Col 1', column2: 'Col 2', column3: 'Col 3',
  };

  function addHistoryEntry(number, color, netResult, betResults, totalBet, totalPayout) {
    const list = document.getElementById('hist-list');
    if (!list) return;

    const sign     = netResult >= 0 ? '+' : '';
    const betLines = (betResults || []).map(b => {
      const label = b.type === 'straight' ? `#${b.value}` : (BET_LABELS[b.type] || b.type);
      return `${label} <span class="hist-bet-amt">${fmtBalance(b.amount)}</span>`;
    }).join('  ');

    const item = document.createElement('div');
    item.className = 'hist-item hist-item-clickable';
    item.dataset.spin = JSON.stringify({ number, color, netResult, betResults, totalBet, totalPayout });
    item.innerHTML = `
      <div class="hist-bubble ${color}">${number}</div>
      <div class="hist-detail">
        <div class="hist-net ${netResult > 0 ? 'win' : netResult < 0 ? 'lose' : ''}">${sign}${fmt(netResult)} CR</div>
        <div class="hist-bets">${betLines}</div>
      </div>`;

    item.addEventListener('click', () => _showHistModal(JSON.parse(item.dataset.spin)));

    list.insertBefore(item, list.firstChild);
    while (list.children.length > 20) list.removeChild(list.lastChild);
  }

  function _showHistModal({ number, color, netResult, betResults, totalBet, totalPayout }) {
    const modal = document.getElementById('hist-modal');
    if (!modal) return;

    const colorHex = { red: '#e74c3c', black: '#ccc', green: '#2ecc71' };
    document.getElementById('hm-result').innerHTML =
      `<span style="font-size:36px;font-weight:900;color:${colorHex[color]||'#fff'}">${number}</span>
       <span style="font-size:13px;font-weight:700;color:${colorHex[color]||'#fff'};letter-spacing:2px;text-transform:uppercase">${color}</span>`;

    const body = document.getElementById('hm-bets-body');
    body.innerHTML = (betResults || []).map(b => {
      const label = b.type === 'straight' ? `#${b.value}` : (BET_LABELS[b.type] || b.type);
      const winCls = b.win ? 'hm-win' : 'hm-lose';
      return `<div class="hm-bet-row ${winCls}">
        <span>${label}</span>
        <span>${fmtBalance(b.amount)}</span>
        <span>${b.win ? '✓ Win' : '✗ Loss'}</span>
        <span>${b.win ? fmtBalance(b.payout) : '—'}</span>
      </div>`;
    }).join('');

    const netEl = document.getElementById('hm-net');
    netEl.textContent = (netResult >= 0 ? '+' : '') + fmtBalance(netResult) + ' CR';
    netEl.style.color = netResult > 0 ? '#2ecc71' : netResult < 0 ? '#e74c3c' : '#fff';

    document.getElementById('hm-total-bet').textContent    = fmtBalance(totalBet)    + ' CR';
    document.getElementById('hm-total-payout').textContent = fmtBalance(totalPayout) + ' CR';

    modal.classList.remove('hidden');
  }

  // ── Formatting ────────────────────────────────────────

  function fmt(n) {
    if (typeof n !== 'number') return '0';
    return Math.abs(n) >= 1000
      ? (n / 1000).toFixed(1) + 'k'
      : String(Math.round(n));
  }

  function fmtBalance(n) {
    if (typeof n !== 'number') return '0';
    return n.toLocaleString('en-US');
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loadHistory(entries) {
    const list = document.getElementById('hist-list');
    if (!list) return;
    list.innerHTML = '';
    (entries || []).slice().reverse().forEach(e => {
      addHistoryEntry(e.number, e.color, e.netResult, e.bets, e.totalBet, e.totalPayout);
    });
  }

  // ── Exports ───────────────────────────────────────────

  return {
    toast,
    showResult,
    updateBalance,
    flashBalance,
    updateStats,
    renderAchievements,
    showAchievementUnlock,
    addFeedEntry,
    populateFeed,
    updateLeaderboard,
    launchConfetti,
    addHistoryEntry,
    loadHistory,
    initHistModal: () => {
      const close = () => document.getElementById('hist-modal').classList.add('hidden');
      document.getElementById('hist-modal-close').addEventListener('click', close);
      document.querySelector('.hist-modal-backdrop').addEventListener('click', close);
    },
    fmt,
    fmtBalance,
  };
})();
