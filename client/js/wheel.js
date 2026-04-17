// ============================================================
// wheel.js — European roulette wheel canvas renderer & animator
// ============================================================

class RouletteWheel {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');

    // Physical pocket order — European standard (clockwise)
    this.wheelOrder = [
       0, 32, 15, 19,  4, 21,  2, 25, 17, 34,  6, 27, 13, 36,
      11, 30,  8, 23, 10,  5, 24, 16, 33,  1, 20, 14, 31,  9,
      22, 18, 29,  7, 28, 12, 35,  3, 26
    ];
    this.numPockets  = 37;
    this.pocketAngle = (2 * Math.PI) / this.numPockets;

    this.redNums = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

    // Render state
    this.wheelAngle        = 0;
    this.ballAngle         = 0;
    this.ballRadius        = 0;
    this.ballVisible       = false;
    this.isSpinning        = false;
    this.spinData          = null;
    this._ballWheelOffset  = 0;  // ball angle relative to wheel (used after landing)
    this._hideBallTimer    = null;

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._loop(0);
  }

  // ── Geometry ────────────────────────────────────────
  _resize() {
    const parent    = this.canvas.parentElement;
    const size      = Math.min(parent.offsetWidth, 420);
    this.canvas.width  = size;
    this.canvas.height = size;

    const r = size / 2;
    this.cx          = r;
    this.cy          = r;
    this.outerR      = r * 0.93;
    this.trackR      = r * 0.85;   // Ball outer track
    this.innerR      = r * 0.54;   // Inner cone edge
    this.landingR    = r * 0.72;   // Ball landing radius (inside track)
    this.numberR     = r * 0.79;   // Number text placement radius
  }

  // ── Color helpers ────────────────────────────────────
  _pocketColor(n) {
    if (n === 0) return { fill: '#0d4a0d', stroke: '#1a7a1a' };
    if (this.redNums.has(n)) return { fill: '#7a1515', stroke: '#c0392b' };
    return { fill: '#121212', stroke: '#444' };
  }

  _ballColor() {
    return { fill: '#f0f0f0', glow: '#fff' };
  }

  // ── Main draw ────────────────────────────────────────
  draw() {
    const { ctx, cx, cy, outerR, innerR, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // --- Outer bezel (ring) ---
    ctx.save();
    ctx.translate(cx, cy);

    // Outer metallic ring
    const bezelGrad = ctx.createRadialGradient(0, 0, outerR * 0.96, 0, 0, outerR * 1.02);
    bezelGrad.addColorStop(0, '#5a4a1a');
    bezelGrad.addColorStop(0.5, '#c9a84c');
    bezelGrad.addColorStop(1, '#3a2e08');
    ctx.beginPath();
    ctx.arc(0, 0, outerR * 1.04, 0, Math.PI * 2);
    ctx.fillStyle = bezelGrad;
    ctx.fill();

    // --- Wheel (rotates) ---
    ctx.save();
    ctx.rotate(this.wheelAngle);

    // Draw pockets (sectors)
    this.wheelOrder.forEach((num, idx) => {
      const startA = idx * this.pocketAngle - Math.PI / 2;
      const endA   = startA + this.pocketAngle;
      const col    = this._pocketColor(num);

      // Pocket fill
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, outerR, startA, endA);
      ctx.closePath();
      ctx.fillStyle = col.fill;
      ctx.fill();

      // Pocket border (thin gold divider)
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, outerR, startA, endA);
      ctx.closePath();
      ctx.strokeStyle = '#c9a84c';
      ctx.lineWidth   = 0.8;
      ctx.stroke();

      // Number text
      const midA   = startA + this.pocketAngle / 2;
      const tx     = Math.cos(midA) * this.numberR;
      const ty     = Math.sin(midA) * this.numberR;
      const fSize  = Math.max(8, this.outerR * 0.075);

      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(midA + Math.PI / 2);
      ctx.fillStyle    = num === 0 ? '#4eff4e' : '#fff';
      ctx.font         = `900 ${fSize}px 'Segoe UI', Arial, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur   = 3;
      ctx.fillText(num.toString(), 0, 0);
      ctx.shadowBlur   = 0;
      ctx.restore();
    });

    // --- Diamond pins (frets) along the inner border ---
    for (let i = 0; i < 8; i++) {
      const a  = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const pr = outerR * 0.91;
      const px = Math.cos(a) * pr;
      const py = Math.sin(a) * pr;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(4, 0);
      ctx.lineTo(0, 5);
      ctx.lineTo(-4, 0);
      ctx.closePath();
      ctx.fillStyle = '#c9a84c';
      ctx.fill();
      ctx.restore();
    }

    ctx.restore(); // end wheel rotation

    // --- Inner cone (non-rotating) ---
    const coneGrad = ctx.createRadialGradient(0, -10, 0, 0, 0, innerR);
    coneGrad.addColorStop(0, '#3a2a0a');
    coneGrad.addColorStop(0.6, '#251a05');
    coneGrad.addColorStop(1, '#1a1200');
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.fillStyle = coneGrad;
    ctx.fill();

    // Inner ring decoration
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.strokeStyle = '#c9a84c';
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, innerR * 0.85, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(201,168,76,0.3)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Hub center
    const hubGrad = ctx.createRadialGradient(-3, -5, 0, 0, 0, innerR * 0.18);
    hubGrad.addColorStop(0, '#f0d878');
    hubGrad.addColorStop(0.5, '#c9a84c');
    hubGrad.addColorStop(1, '#7a5a10');
    ctx.beginPath();
    ctx.arc(0, 0, innerR * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = hubGrad;
    ctx.fill();
    ctx.strokeStyle = '#f0d060';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore(); // end translate to cx,cy

    // --- Ball ---
    if (this.ballVisible) {
      const bx  = cx + Math.cos(this.ballAngle) * this.ballRadius;
      const by  = cy + Math.sin(this.ballAngle) * this.ballRadius;
      const br  = Math.max(4, this.outerR * 0.038);

      const ballGrad = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.4, 0, bx, by, br);
      ballGrad.addColorStop(0, '#ffffff');
      ballGrad.addColorStop(0.5, '#dddddd');
      ballGrad.addColorStop(1, '#999999');

      ctx.save();
      ctx.shadowColor = 'rgba(255,255,255,0.5)';
      ctx.shadowBlur  = 8;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad;
      ctx.fill();
      ctx.strokeStyle = '#aaaaaa';
      ctx.lineWidth   = 0.5;
      ctx.stroke();
      ctx.restore();
    }

    // --- Pointer marker (12 o'clock, outside the wheel, fixed) ---
    ctx.save();
    ctx.translate(cx, cy - outerR * 1.07);
    ctx.beginPath();
    ctx.moveTo(0, -1);
    ctx.lineTo(-6, -12);
    ctx.lineTo(6, -12);
    ctx.closePath();
    ctx.fillStyle = '#f0d060';
    ctx.fill();
    ctx.restore();
  }

  // ── Animation loop ────────────────────────────────────
  _loop(ts) {
    if (this.isSpinning && this.spinData) {
      this._tickSpin(ts);
    } else {
      // Idle: slow drift
      this.wheelAngle += 0.003;
      // Ball tracks the wheel so it doesn't slide after landing
      if (this.ballVisible) {
        this.ballAngle = this.wheelAngle + this._ballWheelOffset;
      }
    }
    this.draw();
    requestAnimationFrame(t => this._loop(t));
  }

  _tickSpin(ts) {
    const d        = this.spinData;
    const elapsed  = ts - d.startTime;
    const t        = Math.min(elapsed / d.duration, 1);

    // Wheel uses ease-out quint (starts fast, slows dramatically at end)
    const we  = this._easeOutQuint(t);
    this.wheelAngle = d.startWheelAngle + (d.finalWheelAngle - d.startWheelAngle) * we;

    // Ball: slightly ahead of wheel deceleration, then locks to wheel
    const bt  = Math.min(elapsed / (d.duration * 0.93), 1);
    const be  = this._easeOutCubic(bt);
    if (bt < 1) {
      this.ballAngle        = d.startBallAngle + (d.finalBallAngle - d.startBallAngle) * be;
      this._ballWheelOffset = this.ballAngle - this.wheelAngle;
    } else {
      // Locked to wheel — moves with it seamlessly
      this.ballAngle = this.wheelAngle + this._ballWheelOffset;
    }

    // Ball spirals inward in the last 35%
    if (t > 0.65) {
      const rt = this._easeOutCubic((t - 0.65) / 0.35);
      this.ballRadius = d.startBallRadius + (d.endBallRadius - d.startBallRadius) * rt;
    }

    if (t >= 1) {
      this.isSpinning    = false;
      this.wheelAngle    = d.finalWheelAngle;
      this.ballRadius    = d.endBallRadius;
      this.spinData      = null;
      if (d.onComplete) d.onComplete();
      this._hideBallTimer = setTimeout(() => { this.ballVisible = false; }, 1800);
    }
  }

  // ── Public API ────────────────────────────────────────

  /**
   * Animate the wheel to land on targetNumber.
   * @param {number} targetNumber  0–36
   * @param {function} onComplete  Called after animation ends
   */
  spin(targetNumber, onComplete) {
    const PA  = this.pocketAngle;
    const idx = this.wheelOrder.indexOf(targetNumber);

    // Pick a random landing angle on screen where the ball will visually rest
    const landingAngle = (Math.random() * 2 - 1) * Math.PI;  // -π … π
    const jitter       = (Math.random() - 0.5) * PA * 0.6;   // small offset within the pocket
    const ballLanding  = landingAngle + jitter;

    // Wheel must rotate so that pocket idx aligns with ballLanding
    // Pocket idx centre is at: wheelAngle + (idx+0.5)*PA - π/2  (screen coords)
    // We want that to equal ballLanding:
    //   finalWheelAngle = ballLanding + π/2 - (idx+0.5)*PA
    const baseTarget = ballLanding + Math.PI / 2 - (idx + 0.5) * PA;
    let finalWheelAngle = baseTarget;
    // Ensure at least 6 full clockwise rotations beyond current
    while (finalWheelAngle < this.wheelAngle + 6 * 2 * Math.PI) {
      finalWheelAngle += 2 * Math.PI;
    }

    // Ball spins counter-clockwise, ends at ballLanding
    const startBallAngle = this.ballVisible ? this.ballAngle : (Math.PI * (0.5 + Math.random()));
    let   finalBallAngle = ballLanding;
    while (finalBallAngle > startBallAngle - 7 * 2 * Math.PI) {
      finalBallAngle -= 2 * Math.PI;
    }

    // Cancel any pending hide-ball timer from the previous spin
    if (this._hideBallTimer) { clearTimeout(this._hideBallTimer); this._hideBallTimer = null; }

    this.ballVisible = true;
    this.ballRadius  = this.trackR;

    this.spinData = {
      startTime:        performance.now(),
      duration:         6200,
      startWheelAngle:  this.wheelAngle,
      finalWheelAngle,
      startBallAngle,
      finalBallAngle,
      startBallRadius:  this.trackR,
      endBallRadius:    this.landingR,
      onComplete,
    };

    this.isSpinning = true;
  }

  /** Reset ball visibility (e.g., between rounds) */
  hideBall() {
    this.ballVisible = false;
  }

  // ── Easing functions ──────────────────────────────────
  _easeOutQuint(t)  { return 1 - Math.pow(1 - t, 5); }
  _easeOutCubic(t)  { return 1 - Math.pow(1 - t, 3); }
}
