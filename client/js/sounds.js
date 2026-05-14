// ============================================================
// sounds.js — Programmatic sound effects via Web Audio API
// No audio files needed; all sounds generated in real-time.
// ============================================================

const Sounds = (() => {
  let ctx    = null;
  let muted  = false;
  let volume = 0.5;

  function init() {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {
      console.warn('Web Audio API not supported');
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function masterGain() {
    if (!ctx) return null;
    const g = ctx.createGain();
    g.gain.value = muted ? 0 : volume;
    g.connect(ctx.destination);
    return g;
  }

  function ramp(param, start, end, startT, endT) {
    param.setValueAtTime(start, startT);
    param.exponentialRampToValueAtTime(Math.max(end, 0.001), endT);
  }

  // ── Chip Click ──────────────────────────────────────
  function chipPlace() {
    if (!ctx) return;
    resume();
    const now  = ctx.currentTime;
    const mg   = masterGain();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(500, now + 0.06);

    ramp(gain.gain, 0.25, 0.001, now, now + 0.08);

    osc.connect(gain);
    gain.connect(mg);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  // ── Wheel Spin (mechanical clicks like real roulette ball) ──
  let spinIntervals = [];

  function wheelSpin() {
    if (!ctx) return;
    resume();
    stopSpin();

    const totalDuration = 6.5;  // seconds
    const startInterval = 0.045; // fast clicks at start
    const endInterval   = 0.38;  // slow clicks at end

    let elapsed = 0;
    let clickIndex = 0;

    function scheduleClicks() {
      if (elapsed >= totalDuration) return;

      // interval grows exponentially (ball slows down)
      const t = elapsed / totalDuration;
      const interval = startInterval * Math.pow(endInterval / startInterval, t);

      const clickTime = ctx.currentTime + 0.01;
      _playClick(clickTime, t);

      elapsed += interval;
      clickIndex++;

      const id = setTimeout(scheduleClicks, interval * 1000);
      spinIntervals.push(id);
    }

    scheduleClicks();
  }

  function _playClick(when, progress) {
    if (!ctx) return;
    const mg   = masterGain();

    // Pitch drops as wheel slows
    const freq = 1400 - progress * 900;

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, when);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, when + 0.025);

    // Volume rises slightly mid-spin, then fades at end
    const vol = progress < 0.8
      ? 0.18 + progress * 0.05
      : 0.22 * (1 - (progress - 0.8) / 0.2);

    gain.gain.setValueAtTime(vol, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.04);

    osc.connect(gain);
    gain.connect(mg);
    osc.start(when);
    osc.stop(when + 0.05);
  }

  function stopSpin() {
    spinIntervals.forEach(id => clearTimeout(id));
    spinIntervals = [];
  }

  // ── Win Fanfare ──────────────────────────────────────
  function win(amount = 0) {
    if (!ctx) return;
    resume();
    const now = ctx.currentTime;
    const mg  = masterGain();

    // C major arpeggio — extend for big wins
    const notes = amount > 200
      ? [523, 659, 784, 1047, 1319, 1568]
      : amount > 50
        ? [523, 659, 784, 1047]
        : [523, 784];

    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type   = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq;

      const t = now + i * 0.1;
      ramp(gain.gain, 0.3, 0.001, t, t + 0.45);

      osc.connect(gain);
      gain.connect(mg);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  }

  // ── Lose Sound ───────────────────────────────────────
  function lose() {
    if (!ctx) return;
    resume();
    const now = ctx.currentTime;
    const mg  = masterGain();

    const notes = [392, 349, 261];
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type   = 'triangle';
      osc.frequency.value = freq;

      const t = now + i * 0.18;
      ramp(gain.gain, 0.2, 0.001, t, t + 0.5);

      osc.connect(gain);
      gain.connect(mg);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }

  // ── Button Click ─────────────────────────────────────
  function click() {
    if (!ctx) return;
    resume();
    const now  = ctx.currentTime;
    const mg   = masterGain();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type   = 'square';
    osc.frequency.setValueAtTime(300, now);
    ramp(gain.gain, 0.08, 0.001, now, now + 0.06);
    osc.connect(gain);
    gain.connect(mg);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  // ── Achievement Unlock ───────────────────────────────
  function achievement() {
    if (!ctx) return;
    resume();
    const now  = ctx.currentTime;
    const mg   = masterGain();
    const seq  = [784, 1047, 1319, 1568];
    seq.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type   = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.08;
      ramp(gain.gain, 0.35, 0.001, t, t + 0.35);
      osc.connect(gain);
      gain.connect(mg);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  init();

  return {
    chipPlace,
    wheelSpin,
    stopSpin,
    win,
    lose,
    click,
    achievement,
    setMuted: (v) => { muted = v; },
    isMuted:  ()  => muted,
    setVolume: (v) => { volume = Math.max(0, Math.min(1, v)); },
    resume,
  };
})();
