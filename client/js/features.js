// ============================================================
// features.js — Bonuses & Daily Challenges
// ============================================================

const Features = (() => {
  'use strict';

  // ── State ─────────────────────────────────────────────
  let bonus5Timer       = null;
  let bonus5NextAvail   = 0;
  let bonus5IntervalMs  = 5 * 60 * 1000;
  let bonus5Amount      = 1000;

  let dailyStreak       = 0;
  let dailyCanClaim     = false;
  let dailyRewards      = [250, 500, 750, 1000, 1500, 2500, 5000];
  let dailyNextMs       = 0;   // ms until next daily reset

  let challenges        = [];
  let challengeTimer    = null;

  // ══════════════════════════════════════════════════════
  // BONUSES
  // ══════════════════════════════════════════════════════

  async function refreshBonusStatus() {
    try {
      const data = await API.bonusStatus();
      _updateDaily(data.daily);
      _updateBonus5(data.bonus5min);
    } catch (e) {
      console.error('[Bonus] refresh failed', e);
    }
  }

  function _updateDaily(d) {
    dailyStreak   = d.streak || 0;
    dailyCanClaim = d.canClaim;
    dailyRewards  = d.rewards || dailyRewards;

    // ms until midnight (next daily reset)
    const now       = new Date();
    const midnight  = new Date(now); midnight.setHours(24, 0, 0, 0);
    dailyNextMs     = midnight - now;

    document.getElementById('daily-streak').textContent = dailyStreak;

    const btn = document.getElementById('daily-btn');
    const txt = document.getElementById('daily-btn-text');
    if (dailyCanClaim) {
      btn.disabled    = false;
      txt.textContent = `CLAIM +${UI.fmt(d.nextReward)}`;
      btn.classList.add('bonus-ready');
    } else {
      btn.disabled    = true;
      txt.textContent = '✓ Claimed';
      btn.classList.remove('bonus-ready');
    }

    _startDailyTimer();

    // Render 7-day cycle
    const days = document.getElementById('daily-streak-days');
    const cur  = dailyStreak % 7;
    days.innerHTML = dailyRewards.map((r, i) => {
      const claimed = i < cur && dailyStreak > 0;
      const next    = i === cur && dailyCanClaim;
      return `<div class="streak-day ${claimed ? 'claimed' : ''} ${next ? 'next' : ''}" title="Day ${i+1}: ${r} CR">
        <div class="sd-num">${i+1}</div>
        <div class="sd-rew">${UI.fmt(r)}</div>
      </div>`;
    }).join('');
  }

  function _startDailyTimer() {
    if (bonus5Timer) return; // reuse same interval tick
    // already ticking via bonus5 timer
  }

  function _tickDailyTimer() {
    const fill = document.getElementById('daily-timer-fill');
    const txt  = document.getElementById('daily-btn-text');
    const btn  = document.getElementById('daily-btn');
    const now      = new Date();
    const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
    const remain   = Math.max(0, midnight - now);
    const dayMs    = 24 * 60 * 60 * 1000;
    const pct      = 100 - (remain / dayMs) * 100;
    if (fill) fill.style.width = pct + '%';
    if (!dailyCanClaim && txt && btn && btn.disabled) {
      const h = Math.floor(remain / 3600000);
      const m = Math.floor((remain % 3600000) / 60000);
      const s = Math.floor((remain % 60000) / 1000);
      txt.textContent = `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }
  }

  function _updateBonus5(b) {
    bonus5NextAvail  = Date.now() + (b.remainingMs || 0);
    bonus5IntervalMs = b.intervalMs || bonus5IntervalMs;
    bonus5Amount     = b.amount || bonus5Amount;
    document.getElementById('b5-amount').textContent = UI.fmtBalance(bonus5Amount);
    _startBonus5Timer();
  }

  function _startBonus5Timer() {
    if (bonus5Timer) clearInterval(bonus5Timer);
    _tickAll();
    bonus5Timer = setInterval(_tickAll, 500);
  }

  function _tickAll() {
    _tickBonus5();
    _tickDailyTimer();
    _tickChallengesTimer();
  }

  function _tickBonus5() {
    const btn     = document.getElementById('b5-btn');
    const txt     = document.getElementById('b5-btn-text');
    const fill    = document.getElementById('b5-timer-fill');
    if (!btn || !txt || !fill) return;

    const now    = Date.now();
    const remain = Math.max(0, bonus5NextAvail - now);

    if (remain <= 0) {
      btn.disabled    = false;
      txt.textContent = `CLAIM +${UI.fmt(bonus5Amount)}`;
      btn.classList.add('bonus-ready');
      fill.style.width = '100%';
    } else {
      btn.disabled    = true;
      btn.classList.remove('bonus-ready');
      const m = Math.floor(remain / 60000);
      const s = Math.floor((remain % 60000) / 1000);
      txt.textContent = `${m}:${String(s).padStart(2, '0')}`;
      const pct = 100 - (remain / bonus5IntervalMs) * 100;
      fill.style.width = pct + '%';
    }
  }

  async function claimBonus5() {
    try {
      const data = await API.claimBonus5min();
      bonus5NextAvail = data.nextAvailable;
      UI.updateBalance(data.balance);
      UI.toast(`+${UI.fmt(data.reward)} CR — Quick bonus claimed!`, 'success');
      UI.flashBalance('win');
      UI.launchConfetti(1500, 40);
      _tickBonus5();
    } catch (e) {
      UI.toast(e.message || 'Bonus not ready', 'error');
    }
  }

  async function claimDailyBonus() {
    try {
      const data = await API.dailyReward();
      UI.updateBalance(data.balance);
      UI.toast(`+${UI.fmt(data.reward)} CR — Day ${data.dayInCycle} streak bonus!`, 'success');
      UI.flashBalance('win');
      UI.launchConfetti(2500, 80);
      _showStreakPopup(data.streak, data.reward);
      await refreshBonusStatus();
    } catch (e) {
      UI.toast(e.message || 'Daily bonus failed', 'error');
    }
  }

  function _showStreakPopup(streak, reward) {
    const el = document.createElement('div');
    el.className = 'levelup-popup streak-popup';
    el.innerHTML = `
      <div class="levelup-title">🔥 ${streak}-Day Streak!</div>
      <div class="levelup-num">+${UI.fmt(reward)}</div>
      <div class="levelup-bonus">CR bonus claimed</div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  // ══════════════════════════════════════════════════════
  // CHALLENGES
  // ══════════════════════════════════════════════════════

  async function refreshChallenges() {
    try {
      const data = await API.getChallenges();
      challenges = data.challenges || [];
      _renderChallenges();
    } catch (e) {
      console.error('[Chal] refresh failed', e);
    }
  }

  function updateChallengesFromSpin(data) {
    if (Array.isArray(data.challenges)) {
      challenges = data.challenges;
      _renderChallenges();
    }
    if (Array.isArray(data.completedChallenges) && data.completedChallenges.length > 0) {
      data.completedChallenges.forEach(ch => {
        UI.toast(`🏆 Challenge done: ${ch.desc} → +${UI.fmt(ch.reward)} CR to claim!`, 'success');
      });
    }
  }

  function _renderChallenges() {
    const el = document.getElementById('challenges-list');
    if (!el) return;

    if (!challenges.length) {
      el.innerHTML = '<div class="chal-empty">No challenges yet</div>';
      return;
    }

    el.innerHTML = challenges.map(c => {
      const pct = Math.min(100, Math.round((c.progress / c.target) * 100));
      let statusClass = '';
      let actionHtml  = '';

      if (c.claimed) {
        statusClass = 'chal-claimed';
        actionHtml  = `<span class="chal-status">✓ Claimed</span>`;
      } else if (c.completed) {
        statusClass = 'chal-ready';
        actionHtml  = `<button class="btn-claim-chal" data-id="${c.id}">Claim +${UI.fmt(c.reward)}</button>`;
      } else {
        actionHtml  = `<span class="chal-reward">+${UI.fmt(c.reward)} CR</span>`;
      }

      return `
        <div class="chal-item ${statusClass}">
          <div class="chal-head">
            <div class="chal-desc">${_esc(c.desc)}</div>
            ${actionHtml}
          </div>
          <div class="chal-progress-row">
            <div class="chal-track"><div class="chal-fill" style="width:${pct}%"></div></div>
            <div class="chal-count">${c.progress}/${c.target}</div>
          </div>
        </div>`;
    }).join('');

    // Attach claim listeners
    el.querySelectorAll('.btn-claim-chal').forEach(btn => {
      btn.addEventListener('click', () => _claimChallenge(btn.dataset.id));
    });
  }

  async function _claimChallenge(id) {
    try {
      const data = await API.claimChallenge(id);
      UI.updateBalance(data.balance);
      UI.flashBalance('win');
      UI.toast(`+${UI.fmt(data.reward)} CR claimed!`, 'success');
      UI.launchConfetti(1800, 60);
      challenges = data.challenges;
      _renderChallenges();
    } catch (e) {
      UI.toast(e.message || 'Claim failed', 'error');
    }
  }

  function _tickChallengesTimer() {
    const el = document.getElementById('challenges-timer');
    if (!el) return;
    const now      = new Date();
    const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
    const remain   = Math.max(0, midnight - now);
    const h = Math.floor(remain / 3600000);
    const m = Math.floor((remain % 3600000) / 60000);
    const s = Math.floor((remain % 60000) / 1000);
    el.textContent = `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  // ══════════════════════════════════════════════════════
  // ADVANCED STATS / CHARTS (kept for reference, not shown)
  // ══════════════════════════════════════════════════════

  async function refreshAdvancedStats() {
    try {
      advData = await API.advancedStats();
      _renderChart();
    } catch (e) {
      console.error('[Adv] refresh failed', e);
    }
  }

  function _renderChart() {
    if (!advData) return;
    const canvas = document.getElementById('adv-chart');
    const sum    = document.getElementById('adv-summary');
    if (!canvas || !sum) return;

    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (activeChart === 'progression') {
      _drawProgression(ctx, W, H);
      sum.innerHTML = `
        <span>Best: <strong class="pos">+${UI.fmt(advData.biggestWin)}</strong></span>
        <span>Worst: <strong class="neg">${UI.fmt(advData.biggestLoss)}</strong></span>
        <span>Spins: <strong>${advData.totalSpins}</strong></span>`;
    } else if (activeChart === 'heatmap') {
      _drawHeatmap(ctx, W, H);
      const max = Math.max(...advData.numCounts);
      const hot = advData.numCounts.indexOf(max);
      sum.innerHTML = max > 0
        ? `<span>🔥 Hottest: <strong>#${hot}</strong> (${max}×)</span><span>Total: <strong>${advData.totalSpins}</strong></span>`
        : `<span>No spins yet</span>`;
    } else if (activeChart === 'distribution') {
      _drawDistribution(ctx, W, H);
      const total = Object.values(advData.betTypeDistribution).reduce((a, b) => a + b, 0);
      sum.innerHTML = `<span>Total wagered: <strong>${UI.fmt(total)} CR</strong></span>`;
    }
  }

  function _drawProgression(ctx, W, H) {
    const pts = advData.progression || [];
    if (pts.length === 0) { _noData(ctx, W, H); return; }

    const padL = 6, padR = 6, padT = 8, padB = 18;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const values = pts.map(p => p.cumulative);
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (min === max) { min -= 10; max += 10; }
    const range = max - min;

    // Zero line
    const zeroY = padT + innerH - ((0 - min) / range) * innerH;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, zeroY);
    ctx.lineTo(W - padR, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Area fill
    const finalVal = values[values.length - 1];
    const positive = finalVal >= 0;
    ctx.fillStyle = positive ? 'rgba(46, 204, 113, 0.25)' : 'rgba(231, 76, 60, 0.25)';
    ctx.beginPath();
    ctx.moveTo(padL, zeroY);
    pts.forEach((p, i) => {
      const x = padL + (i / Math.max(1, pts.length - 1)) * innerW;
      const y = padT + innerH - ((p.cumulative - min) / range) * innerH;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(padL + innerW, zeroY);
    ctx.closePath();
    ctx.fill();

    // Line
    ctx.strokeStyle = positive ? '#2ecc71' : '#e74c3c';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = padL + (i / Math.max(1, pts.length - 1)) * innerW;
      const y = padT + innerH - ((p.cumulative - min) / range) * innerH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font      = '10px system-ui, sans-serif';
    ctx.fillText(`${max >= 0 ? '+' : ''}${UI.fmt(max)}`, padL + 2, padT + 10);
    ctx.fillText(`${min >= 0 ? '+' : ''}${UI.fmt(min)}`, padL + 2, H - padB + 12);
    ctx.fillText(`${pts.length} spins`, W - 60, H - padB + 12);
  }

  function _drawHeatmap(ctx, W, H) {
    const counts = advData.numCounts || [];
    const max    = Math.max(...counts, 1);

    // Grid: 0 at top (solo), then 1-36 in 4 rows x 9 cols
    const pad   = 6;
    const cols  = 12;
    const rows  = 4;  // 0 (row 0), 1-12, 13-24, 25-36
    const gap   = 2;
    const cellW = (W - pad * 2 - gap * (cols - 1)) / cols;
    const cellH = (H - pad * 2 - gap * (rows - 1)) / rows;

    function heatColor(v) {
      if (v === 0) return 'rgba(255,255,255,0.08)';
      const t = v / max;
      // gradient from dark red → orange → yellow
      const r = Math.round(180 + 75 * t);
      const g = Math.round(40 + 180 * t * t);
      const b = 40;
      return `rgb(${r},${g},${b})`;
    }

    function drawCell(num, row, col) {
      const x = pad + col * (cellW + gap);
      const y = pad + row * (cellH + gap);
      const cnt = counts[num] || 0;
      ctx.fillStyle = heatColor(cnt);
      _roundRect(ctx, x, y, cellW, cellH, 3);
      ctx.fill();
      ctx.fillStyle = cnt > max * 0.5 ? '#000' : 'rgba(255,255,255,0.85)';
      ctx.font      = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(num), x + cellW / 2, y + cellH / 2);
    }

    // Row 0: 0 (green)
    drawCell(0, 0, 0);

    // Rows 1-3: 1-12, 13-24, 25-36
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 12; c++) {
        const num = r * 12 + c + 1;
        drawCell(num, r + 1, c);
      }
    }

    ctx.textAlign    = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function _drawDistribution(ctx, W, H) {
    const dist = advData.betTypeDistribution || {};
    const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) { _noData(ctx, W, H); return; }

    const total = entries.reduce((s, [, v]) => s + v, 0);
    const colors = {
      red: '#e74c3c', black: '#777', odd: '#3498db', even: '#9b59b6',
      low: '#1abc9c', high: '#e67e22', dozen1: '#f1c40f', dozen2: '#e84393',
      dozen3: '#00b894', column1: '#fd79a8', column2: '#74b9ff', column3: '#a29bfe',
      straight: '#f0d060',
    };

    // Horizontal bars
    const pad   = 8;
    const barH  = Math.min(16, (H - pad * 2) / Math.min(entries.length, 8));
    let y       = pad;
    const show  = entries.slice(0, 8);
    const maxV  = show[0][1];

    ctx.font = '11px system-ui';
    show.forEach(([type, val]) => {
      const pct = (val / maxV);
      const labelW = 52;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(type, pad, y + barH * 0.7);
      const barX = pad + labelW;
      const barW = (W - barX - pad - 40) * pct;
      ctx.fillStyle = colors[type] || '#888';
      _roundRect(ctx, barX, y, Math.max(2, barW), barH - 3, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(UI.fmt(val), barX + barW + 4, y + barH * 0.7);
      y += barH;
    });
  }

  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function _noData(ctx, W, H) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font      = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('No data yet — play a few spins!', W / 2, H / 2);
    ctx.textAlign = 'start';
  }

  // ══════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════

  function init() {
    const b5Btn = document.getElementById('b5-btn');
    if (b5Btn) b5Btn.addEventListener('click', claimBonus5);
    const dailyBtn = document.getElementById('daily-btn');
    if (dailyBtn) dailyBtn.addEventListener('click', claimDailyBonus);

    // Reset state on each init (e.g. after re-login)
    bonus5NextAvail = Date.now() + bonus5IntervalMs;
    dailyCanClaim   = false;

    // Start challenges timer immediately (doesn't need server data)
    _tickChallengesTimer();
    setInterval(_tickChallengesTimer, 1000);

    refreshBonusStatus();
    refreshChallenges();

    setInterval(refreshBonusStatus, 60000);
  }

  function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function destroy() {
    if (bonus5Timer) { clearInterval(bonus5Timer); bonus5Timer = null; }
    bonus5NextAvail = 0;
    dailyCanClaim   = false;
    const fill  = document.getElementById('b5-timer-fill');
    const txt   = document.getElementById('b5-btn-text');
    const btn   = document.getElementById('b5-btn');
    if (fill) fill.style.width = '0%';
    if (txt)  txt.textContent  = '—';
    if (btn)  { btn.disabled = true; btn.classList.remove('bonus-ready'); }
  }

  return {
    init,
    destroy,
    refreshBonusStatus,
    refreshChallenges,
    refreshAdvancedStats: () => {},
    updateChallengesFromSpin,
  };
})();
