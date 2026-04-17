// ============================================================
// table.js — European roulette betting table
// Renders the felt table and manages chip placement / bet tracking.
// ============================================================

class BettingTable {
  constructor(container) {
    this.container   = container;
    this.bets        = {};         // { 'straight:5': 100, 'red:red': 50, … }
    this.selectedChip = 10;
    this.enabled     = true;
    this.lastBets    = {};         // For "repeat bet" feature
    this._undoStack  = [];         // For undo history
    this.redNums     = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
    this._render();
  }

  // ── Table Construction ────────────────────────────────

  _render() {
    this.container.innerHTML = '';

    // Grid: 1 (zero) + 12 (numbers) + 1 (column bets) = 14 columns
    //       3 (number rows) + 1 (dozens) + 1 (outside bets) = 5 rows
    this.container.style.cssText = `
      display: grid;
      grid-template-columns: 34px repeat(12, minmax(38px, 44px)) 42px;
      grid-template-rows: repeat(3, 36px) 30px 30px;
      gap: 2px;
    `;

    // ── 0 cell (spans rows 1–3, column 1)
    this._makeCell('straight', '0', '0', 'tc-green', { row: '1/4', col: '1' });

    // ── Number cells (rows 1–3, columns 2–13)
    // Row 1 (top): 3, 6, 9, … 36
    // Row 2 (mid): 2, 5, 8, … 35
    // Row 3 (bot): 1, 4, 7, … 34
    const rowNumbers = [
      [3,  6,  9, 12, 15, 18, 21, 24, 27, 30, 33, 36],  // row 1
      [2,  5,  8, 11, 14, 17, 20, 23, 26, 29, 32, 35],  // row 2
      [1,  4,  7, 10, 13, 16, 19, 22, 25, 28, 31, 34],  // row 3
    ];

    rowNumbers.forEach((row, rowIdx) => {
      row.forEach((num, colIdx) => {
        const colorClass = this.redNums.has(num) ? 'tc-red' : 'tc-black';
        this._makeCell('straight', String(num), String(num), colorClass, {
          row: String(rowIdx + 1),
          col: String(colIdx + 2),
        });
      });
    });

    // ── Column bet cells (right side, rows 1–3, column 14)
    // col3 = numbers 3,6,9,…,36  → row 1
    // col2 = numbers 2,5,8,…,35  → row 2
    // col1 = numbers 1,4,7,…,34  → row 3
    [
      { type: 'column3', label: '2:1', row: '1' },
      { type: 'column2', label: '2:1', row: '2' },
      { type: 'column1', label: '2:1', row: '3' },
    ].forEach(({ type, label, row }) => {
      this._makeCell(type, type, label, 'tc-col-bet', { row, col: '14' });
    });

    // ── Dozen cells (row 4, columns 2–13)
    // 1st dozen covers numbers 1–12  → columns 2–5
    // 2nd dozen covers numbers 13–24 → columns 6–9
    // 3rd dozen covers numbers 25–36 → columns 10–13
    [
      { type: 'dozen1', label: '1ST 12',  col: '2/6'  },
      { type: 'dozen2', label: '2ND 12',  col: '6/10' },
      { type: 'dozen3', label: '3RD 12',  col: '10/14'},
    ].forEach(({ type, label, col }) => {
      this._makeCell(type, type, label, 'tc-outside', { row: '4', col });
    });

    // ── Outside bet cells (row 5)
    const outside = [
      { type: 'low',   val: 'low',   label: '1–18',  col: '2/4',   extra: '' },
      { type: 'even',  val: 'even',  label: 'EVEN',  col: '4/6',   extra: '' },
      { type: 'red',   val: 'red',   label: '●',     col: '6/8',   extra: 'tc-red-outside' },
      { type: 'black', val: 'black', label: '●',     col: '8/10',  extra: 'tc-black-outside' },
      { type: 'odd',   val: 'odd',   label: 'ODD',   col: '10/12', extra: '' },
      { type: 'high',  val: 'high',  label: '19–36', col: '12/14', extra: '' },
    ];

    outside.forEach(({ type, val, label, col, extra }) => {
      this._makeCell(type, val, label, `tc-outside ${extra}`, { row: '5', col });
    });
  }

  _makeCell(betType, betValue, label, cssClass, { row, col }) {
    const el       = document.createElement('div');
    el.className   = `tc ${cssClass}`;
    el.dataset.betType  = betType;
    el.dataset.betValue = betValue;
    el.style.gridRow    = row;
    el.style.gridColumn = col;

    // Label text
    const txt  = document.createElement('span');
    txt.className = 'cell-label';
    txt.textContent = label;
    el.appendChild(txt);

    // Chip overlay container
    const chipArea  = document.createElement('div');
    chipArea.className = 'cell-chips';
    chipArea.id        = `chips-${betType}-${betValue}`;
    el.appendChild(chipArea);

    el.addEventListener('click', () => this._handleClick(betType, betValue));
    this.container.appendChild(el);
  }

  // ── Bet Management ────────────────────────────────────

  _handleClick(type, value) {
    if (!this.enabled) return;

    // Prevent betting more than the current balance
    const balance = this.getBalance ? this.getBalance() : Infinity;
    if (this.getTotalBet() + this.selectedChip > balance) return;

    // Save snapshot for undo (stack, max 20 steps)
    this._undoStack.push({ ...this.bets });
    if (this._undoStack.length > 20) this._undoStack.shift();

    const key          = `${type}:${value}`;
    this.bets[key]     = (this.bets[key] || 0) + this.selectedChip;

    this._updateChipDisplay(type, value);
    this._emitBetChange();
    Sounds.chipPlace();
  }

  _updateChipDisplay(type, value) {
    const key   = `${type}:${value}`;
    const total = this.bets[key] || 0;
    const area  = document.getElementById(`chips-${type}-${value}`);
    if (!area) return;

    if (total === 0) {
      area.innerHTML = '';
      return;
    }

    // Show a single chip with the total value
    area.innerHTML = `<div class="cell-chip-stack">${total >= 1000 ? (total/1000).toFixed(1)+'k' : total}</div>`;
  }

  _emitBetChange() {
    this.container.dispatchEvent(new CustomEvent('betsChanged', {
      bubbles: true,
      detail: { bets: this.getBets(), total: this.getTotalBet() },
    }));
  }

  // ── Public API ────────────────────────────────────────

  /** Return bets as array: [{type, value, amount}] */
  getBets() {
    return Object.entries(this.bets)
      .filter(([, amt]) => amt > 0)
      .map(([key, amt]) => {
        const [type, ...rest] = key.split(':');
        return { type, value: rest.join(':'), amount: amt };
      });
  }

  getTotalBet() {
    return Object.values(this.bets).reduce((s, v) => s + v, 0);
  }

  /** Calculate max potential payout by simulating all 37 possible results */
  getMaxPotentialWin() {
    const PAYOUTS = {
      straight: 35, red: 1, black: 1, odd: 1, even: 1,
      low: 1, high: 1,
      dozen1: 2, dozen2: 2, dozen3: 2,
      column1: 2, column2: 2, column3: 2,
    };
    const bets = this.getBets();
    if (bets.length === 0) return 0;

    let max = 0;
    for (let n = 0; n <= 36; n++) {
      let payout = 0;
      for (const bet of bets) {
        if (this._betWins(bet.type, bet.value, n)) {
          payout += bet.amount * (PAYOUTS[bet.type] + 1);
        }
      }
      if (payout > max) max = payout;
    }
    return max;
  }

  _betWins(type, value, n) {
    const red = this.redNums;
    switch (type) {
      case 'straight': return parseInt(value) === n;
      case 'red':      return red.has(n);
      case 'black':    return n !== 0 && !red.has(n);
      case 'odd':      return n !== 0 && n % 2 !== 0;
      case 'even':     return n !== 0 && n % 2 === 0;
      case 'low':      return n >= 1  && n <= 18;
      case 'high':     return n >= 19 && n <= 36;
      case 'dozen1':   return n >= 1  && n <= 12;
      case 'dozen2':   return n >= 13 && n <= 24;
      case 'dozen3':   return n >= 25 && n <= 36;
      case 'column1':  return n !== 0 && n % 3 === 1;
      case 'column2':  return n !== 0 && n % 3 === 2;
      case 'column3':  return n !== 0 && n % 3 === 0;
      default:         return false;
    }
  }

  undoLastBet() {
    if (!this._undoStack || this._undoStack.length === 0) return false;
    this.bets = this._undoStack.pop();
    this.container.querySelectorAll('.cell-chips').forEach(el => el.innerHTML = '');
    Object.keys(this.bets).forEach(key => {
      const [type, ...rest] = key.split(':');
      this._updateChipDisplay(type, rest.join(':'));
    });
    this._emitBetChange();
    return true;
  }

  clearBets() {
    this.bets = {};
    this._undoStack = [];
    this.container.querySelectorAll('.cell-chips').forEach(el => el.innerHTML = '');
    this._emitBetChange();
  }

  saveBets() {
    this.lastBets = { ...this.bets };
  }

  repeatBets() {
    if (Object.keys(this.lastBets).length === 0) return false;
    const total   = Object.values(this.lastBets).reduce((s, v) => s + v, 0);
    const balance = this.getBalance ? this.getBalance() : Infinity;
    if (total > balance) return 'insufficient';
    this.bets = { ...this.lastBets };
    // Re-render all chip displays
    Object.keys(this.bets).forEach(key => {
      const [type, ...rest] = key.split(':');
      this._updateChipDisplay(type, rest.join(':'));
    });
    this._emitBetChange();
    return true;
  }

  /** Place the currently selected chip on any bet cell */
  placeBet(type, value) {
    this._handleClick(type, value);
  }

  setChipValue(val) {
    this.selectedChip = val;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.container.style.opacity  = enabled ? '1' : '0.6';
    this.container.style.pointerEvents = enabled ? 'auto' : 'none';
  }

  /** Highlight the winning cells after a spin */
  highlightWinners(resultNumber) {
    const redNums = this.redNums;
    const color   = resultNumber === 0 ? 'green' : (redNums.has(resultNumber) ? 'red' : 'black');

    // Build set of winning bet types for this result
    const winners = new Set();
    winners.add(`straight:${resultNumber}`);
    if (color === 'red')   winners.add('red:red');
    if (color === 'black') winners.add('black:black');
    if (resultNumber !== 0 && resultNumber % 2 !== 0) winners.add('odd:odd');
    if (resultNumber !== 0 && resultNumber % 2 === 0) winners.add('even:even');
    if (resultNumber >= 1  && resultNumber <= 18) winners.add('low:low');
    if (resultNumber >= 19 && resultNumber <= 36) winners.add('high:high');
    if (resultNumber >= 1  && resultNumber <= 12) winners.add('dozen1:dozen1');
    if (resultNumber >= 13 && resultNumber <= 24) winners.add('dozen2:dozen2');
    if (resultNumber >= 25 && resultNumber <= 36) winners.add('dozen3:dozen3');
    if (resultNumber !== 0 && resultNumber % 3 === 1) winners.add('column1:column1');
    if (resultNumber !== 0 && resultNumber % 3 === 2) winners.add('column2:column2');
    if (resultNumber !== 0 && resultNumber % 3 === 0) winners.add('column3:column3');

    this.container.querySelectorAll('.tc').forEach(el => {
      const key = `${el.dataset.betType}:${el.dataset.betValue}`;
      if (winners.has(key)) {
        el.classList.add('tc-winning');
        setTimeout(() => el.classList.remove('tc-winning'), 2000);
      }
    });
  }
}
