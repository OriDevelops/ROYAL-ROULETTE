'use strict';

// ============================================================
// Royal Roulette Casino - Backend Server (MongoDB Edition)
// ============================================================

const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const crypto     = require('crypto');
const path       = require('path');
const { MongoClient } = require('mongodb');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

const PORT         = process.env.PORT || 3000;
const MONGODB_URI  = process.env.MONGODB_URI || 'mongodb+srv://iroheroboy_db_user:1kkc8CNoI5WyEHnQ@cluster0.dhkanec.mongodb.net/?appName=Cluster0';

// ============================================================
// MongoDB connection
// ============================================================
let db, usersCol, sessionsCol;

async function connectDB() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db          = client.db('royal-roulette');
  usersCol    = db.collection('users');
  sessionsCol = db.collection('sessions');
  console.log('[DB] Connected to MongoDB Atlas');
}

// ============================================================
// In-memory state (non-persistent)
// ============================================================
let roundHistory = [];
let wsClients    = new Set();

// ============================================================
// Helpers
// ============================================================
function defaultStats() {
  return { spins: 0, wins: 0, totalWon: 0, totalBet: 0, netPL: 0, maxWin: 0, currentStreak: 0, maxStreak: 0 };
}

const ADMIN_USERNAME = 'ori';
const ADMIN_PASSWORD = '911';

// ── Bonus / Challenge config ───────────────────────────
const BONUS_5MIN_AMOUNT   = 1000;
const BONUS_5MIN_INTERVAL = 5 * 60 * 1000;   // 5 minutes
const DAILY_STREAK_REWARDS = [10000, 10000, 10000, 10000, 10000, 10000, 10000];  // fixed 10,000 daily

// Daily-challenge templates (rolled from these every day)
const CHALLENGE_POOL = [
  { id: 'win_spins_5',     desc: 'Win 5 spins today',               target: 5,   reward: 500,   metric: 'wins' },
  { id: 'win_spins_10',    desc: 'Win 10 spins today',              target: 10,  reward: 1500,  metric: 'wins' },
  { id: 'spin_20',         desc: 'Complete 20 spins today',         target: 20,  reward: 750,   metric: 'spins' },
  { id: 'spin_50',         desc: 'Complete 50 spins today',         target: 50,  reward: 2500,  metric: 'spins' },
  { id: 'bet_red_5',       desc: 'Win 5 RED bets today',            target: 5,   reward: 1000,  metric: 'red_wins' },
  { id: 'bet_black_5',     desc: 'Win 5 BLACK bets today',          target: 5,   reward: 1000,  metric: 'black_wins' },
  { id: 'bet_green',       desc: 'Hit GREEN (0) once today',        target: 1,   reward: 3000,  metric: 'green_hits' },
  { id: 'straight_win',    desc: 'Win a straight-up (35×) bet',     target: 1,   reward: 2000,  metric: 'straight_wins' },
  { id: 'big_win',         desc: 'Win 500+ CR in a single spin',    target: 1,   reward: 1500,  metric: 'big_wins' },
  { id: 'streak_3',        desc: 'Get a 3-win streak today',        target: 1,   reward: 1200,  metric: 'streak_3' },
  { id: 'total_bet_5k',    desc: 'Wager 5,000 CR total today',      target: 5000, reward: 1000, metric: 'total_bet' },
  { id: 'total_bet_25k',   desc: 'Wager 25,000 CR total today',     target: 25000, reward: 5000, metric: 'total_bet' },
];

function todayKey() { return new Date().toISOString().slice(0, 10); }  // YYYY-MM-DD

function rollDailyChallenges() {
  // Pick 3 random challenges from pool
  const shuffled = [...CHALLENGE_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3).map(c => ({
    ...c, progress: 0, completed: false, claimed: false,
  }));
}

function ensureChallenges(user) {
  const today = todayKey();
  if (user.challengeDate !== today || !Array.isArray(user.dailyChallenges) || user.dailyChallenges.length === 0) {
    user.challengeDate    = today;
    user.dailyChallenges  = rollDailyChallenges();
  }
  return user.dailyChallenges;
}

function updateChallengeProgress(user, event) {
  ensureChallenges(user);
  const updated = [];
  for (const ch of user.dailyChallenges) {
    if (ch.completed) continue;
    const delta = event[ch.metric] || 0;
    if (delta > 0) {
      ch.progress = Math.min(ch.target, ch.progress + delta);
      if (ch.progress >= ch.target) {
        ch.completed = true;
        updated.push(ch);
      }
    }
  }
  return updated;
}

function generateId()     { return crypto.randomBytes(16).toString('hex'); }
function hashPassword(p)  { return crypto.createHash('sha256').update(p).digest('hex'); }
function generateSeed()   { return crypto.randomBytes(32).toString('hex'); }

// ── DB helpers ─────────────────────────────────────────────
async function getUserById(id)       { return usersCol.findOne({ id }); }
async function getUserByUsername(u)  { return usersCol.findOne({ username: { $regex: new RegExp(`^${u}$`, 'i') } }); }
async function saveUser(user)        { return usersCol.replaceOne({ id: user.id }, user, { upsert: true }); }
async function getSession(token)     { return sessionsCol.findOne({ token }); }
async function saveSession(token, userId) { return sessionsCol.replaceOne({ token }, { token, userId }, { upsert: true }); }
async function deleteSession(token)  { return sessionsCol.deleteOne({ token }); }
async function deleteUserSessions(userId) { return sessionsCol.deleteMany({ userId }); }

// ── Seed admin ─────────────────────────────────────────────
async function seedAdmin() {
  const existing = await getUserByUsername(ADMIN_USERNAME);
  if (!existing) {
    const nextSeed = generateSeed();
    const admin = {
      id: generateId(), username: ADMIN_USERNAME,
      passwordHash: hashPassword(ADMIN_PASSWORD),
      balance: 0, history: [], achievements: [],
      stats: defaultStats(), createdAt: Date.now(),
      lastDailyReward: null, lowPoint: 0,
      nextServerSeed: nextSeed,
      nextServerSeedHash: crypto.createHash('sha256').update(nextSeed).digest('hex'),
      xp: 0,
      loginStreak: 0, lastBonusClaim: 0,
      dailyChallenges: [], challengeDate: null,
    };
    await saveUser(admin);
    console.log('[Admin] Created admin user: ori 911');
  }
}

// ============================================================
// European Roulette Logic
// ============================================================
const WHEEL_ORDER = [
  0, 32, 15, 19,  4, 21,  2, 25, 17, 34,  6, 27, 13, 36,
  11, 30,  8, 23, 10,  5, 24, 16, 33,  1, 20, 14, 31,  9,
  22, 18, 29,  7, 28, 12, 35,  3, 26
];

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function getNumberColor(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

function getWheelIndex(n) { return WHEEL_ORDER.indexOf(n); }

function computeSpinResult(serverSeed, clientSeed) {
  const combined = `${serverSeed}:${clientSeed}`;
  const hash     = crypto.createHash('sha256').update(combined).digest('hex');
  const num      = parseInt(hash.slice(0, 8), 16);
  return { number: num % 37, hash, serverSeed, clientSeed };
}

function isBetWin(bet, n) {
  switch (bet.type) {
    case 'straight': return parseInt(bet.value) === n;
    case 'red':      return getNumberColor(n) === 'red';
    case 'black':    return getNumberColor(n) === 'black';
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

const PAYOUTS = {
  straight: 35, red: 1, black: 1, odd: 1, even: 1,
  low: 1, high: 1,
  dozen1: 2, dozen2: 2, dozen3: 2,
  column1: 2, column2: 2, column3: 2,
};

const VALID_BET_TYPES = new Set(Object.keys(PAYOUTS));

const LEVEL_THRESHOLDS = [0, 100, 250, 500, 1000, 2000, 3500, 5500, 8000, 12000];
function getLevel(xp) {
  xp = xp || 0;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

const ACHIEVEMENT_DEFS = {
  first_win:    { name: 'First Win',      desc: 'Win your first bet',               icon: '🏆' },
  hot_streak:   { name: 'Hot Streak',     desc: 'Win 3 spins in a row',             icon: '🔥' },
  high_roller:  { name: 'High Roller',    desc: 'Bet 500+ in a single round',       icon: '💰' },
  lucky_zero:   { name: 'Zero Hero',      desc: 'Win with number 0 (Straight)',     icon: '🍀' },
  lucky_seven:  { name: 'Lucky Seven',    desc: 'Win with number 7 (Straight)',     icon: '7️⃣' },
  comeback:     { name: 'Comeback Kid',   desc: 'Recover from under 100 to 500+',  icon: '💪' },
  century:      { name: 'Century',        desc: 'Complete 100 spins',              icon: '💯' },
  big_winner:   { name: 'Big Winner',     desc: 'Win 1,000+ CR in a single spin',  icon: '💎' },
};

function checkAchievements(user, resultNumber, bets, netResult) {
  if (!user.achievements) user.achievements = [];
  const newAchievements = [];
  const has   = id => user.achievements.includes(id);
  const grant = id => { if (!has(id)) { user.achievements.push(id); newAchievements.push({ id, ...ACHIEVEMENT_DEFS[id] }); } };

  const won      = netResult > 0;
  const totalBet = bets.reduce((s, b) => s + b.amount, 0);

  if (won)                                               grant('first_win');
  if (resultNumber === 0 && won)                         grant('lucky_zero');
  if (resultNumber === 7 && won)                         grant('lucky_seven');
  if (totalBet >= 500)                                   grant('high_roller');
  if (user.stats.currentStreak >= 3)                     grant('hot_streak');
  if (user.stats.spins >= 100)                           grant('century');
  if (netResult >= 1000)                                 grant('big_winner');
  if (user.lowPoint !== undefined && user.lowPoint < 100 && user.balance >= 500) grant('comeback');

  return newAchievements;
}

// ============================================================
// Auth Middleware
// ============================================================
async function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const session = await getSession(token);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  const user = await getUserById(session.userId);
  if (!user) { await deleteSession(token); return res.status(401).json({ error: 'User not found' }); }
  req.user = user;
  next();
}

// Rate limiter
const rateLimits = {};
function rateLimit(req, res, next) {
  const ip  = req.ip || 'local';
  const now = Date.now();
  if (!rateLimits[ip]) rateLimits[ip] = [];
  rateLimits[ip] = rateLimits[ip].filter(t => now - t < 1000);
  if (rateLimits[ip].length > 10) return res.status(429).json({ error: 'Too many requests' });
  rateLimits[ip].push(now);
  next();
}

function sanitizeUser(u) {
  return {
    id:           u.id,
    username:     u.username,
    balance:      u.balance,
    stats:        u.stats,
    achievements: u.achievements || [],
    history:      (u.history || []).slice(0, 20),
    xp:           u.xp    || 0,
    level:        getLevel(u.xp || 0),
  };
}

function isAdminUser(user) {
  return user && user.username.toLowerCase() === ADMIN_USERNAME.toLowerCase();
}

// ============================================================
// API Routes — Auth
// ============================================================

app.post('/api/register', rateLimit, async (req, res) => {
  try {
    const raw      = (req.body.username || '').toString().trim().slice(0, 20);
    const password = (req.body.password || '').toString();

    if (raw.length < 2) return res.status(400).json({ error: 'Username must be 2–20 characters' });
    if (!/^[a-zA-Z0-9_\- ]+$/.test(raw)) return res.status(400).json({ error: 'Username may only contain letters, numbers, spaces, _ or -' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const existing = await getUserByUsername(raw);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const userId   = generateId();
    const token    = generateId();
    const nextSeed = generateSeed();

    const newUser = {
      id: userId, username: raw,
      passwordHash: hashPassword(password),
      balance: 1000, history: [], achievements: [],
      stats: defaultStats(), createdAt: Date.now(),
      lastDailyReward: null, lowPoint: 1000,
      nextServerSeed: nextSeed,
      nextServerSeedHash: crypto.createHash('sha256').update(nextSeed).digest('hex'),
      xp: 0,
      loginStreak: 0, lastBonusClaim: 0,
      dailyChallenges: [], challengeDate: null,
    };

    await saveUser(newUser);
    await saveSession(token, userId);

    res.json({ token, user: sanitizeUser(newUser), nextRoundHash: newUser.nextServerSeedHash, isAdmin: isAdminUser(newUser) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', rateLimit, async (req, res) => {
  try {
    const raw      = (req.body.username || '').toString().trim();
    const password = (req.body.password || '').toString();
    const user     = await getUserByUsername(raw);

    if (!user) return res.status(404).json({ error: 'User not found — please register first' });
    if (user.passwordHash && user.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    await deleteUserSessions(user.id);
    const token = generateId();
    await saveSession(token, user.id);

    if (!user.nextServerSeed) {
      const s = generateSeed();
      user.nextServerSeed     = s;
      user.nextServerSeedHash = crypto.createHash('sha256').update(s).digest('hex');
      await saveUser(user);
    }

    res.json({ token, user: sanitizeUser(user), nextRoundHash: user.nextServerSeedHash, isAdmin: isAdminUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/logout', requireAuth, async (req, res) => {
  await deleteSession(req.headers['x-session-token']);
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user), nextRoundHash: req.user.nextServerSeedHash, isAdmin: isAdminUser(req.user) });
});

app.get('/api/balance', requireAuth, (req, res) => {
  res.json({ balance: req.user.balance });
});

// ============================================================
// API Routes — Game
// ============================================================

app.post('/api/spin', requireAuth, rateLimit, async (req, res) => {
  try {
    const user = req.user;
    const { bets, clientSeed } = req.body;

    if (!Array.isArray(bets) || bets.length === 0) return res.status(400).json({ error: 'No bets placed' });
    if (bets.length > 100) return res.status(400).json({ error: 'Too many individual bets' });

    for (const bet of bets) {
      if (!VALID_BET_TYPES.has(bet.type))                        return res.status(400).json({ error: `Invalid bet type: ${bet.type}` });
      if (!Number.isInteger(bet.amount) || bet.amount < 1)       return res.status(400).json({ error: 'Bet amount must be a positive integer' });
      if (bet.type === 'straight') {
        const v = parseInt(bet.value);
        if (isNaN(v) || v < 0 || v > 36)                        return res.status(400).json({ error: 'Invalid straight number' });
      }
    }

    const totalBet = bets.reduce((s, b) => s + b.amount, 0);
    if (totalBet > user.balance) return res.status(400).json({ error: 'Insufficient balance' });

    const serverSeed = user.nextServerSeed || generateSeed();
    const safeClient = (typeof clientSeed === 'string' && clientSeed.trim().length > 0)
      ? clientSeed.trim().slice(0, 64)
      : generateId();

    const result        = computeSpinResult(serverSeed, safeClient);
    const { number: N } = result;
    const color         = getNumberColor(N);

    user.balance -= totalBet;

    let totalPayout = 0;
    const betResults = bets.map(bet => {
      const win    = isBetWin(bet, N);
      const payout = win ? bet.amount * (PAYOUTS[bet.type] + 1) : 0;
      totalPayout += payout;
      return { ...bet, win, payout };
    });

    user.balance += totalPayout;
    const netResult = totalPayout - totalBet;

    const s = user.stats;
    s.spins++;
    s.totalBet += totalBet;
    s.netPL     = (s.netPL || 0) + netResult;
    if (netResult > 0) {
      s.wins++;
      s.totalWon       += netResult;
      s.currentStreak++;
      s.maxStreak       = Math.max(s.maxStreak, s.currentStreak);
      s.maxWin          = Math.max(s.maxWin, netResult);
    } else {
      s.currentStreak = 0;
    }

    if (user.balance < (user.lowPoint || Infinity)) user.lowPoint = user.balance;

    const entry = {
      number: N, color, totalBet, totalPayout, netResult,
      bets: betResults, timestamp: Date.now(),
      serverSeed, clientSeed: safeClient, hash: result.hash,
    };
    user.history.unshift(entry);
    if (user.history.length > 200) user.history = user.history.slice(0, 200);

    const newAchievements = checkAchievements(user, N, bets, netResult);

    // Challenge progress
    const won = netResult > 0;
    const challengeEvent = {
      spins: 1,
      wins: won ? 1 : 0,
      total_bet: totalBet,
      big_wins: netResult >= 500 ? 1 : 0,
      red_wins:   (won && betResults.some(b => b.win && b.type === 'red'))    ? 1 : 0,
      black_wins: (won && betResults.some(b => b.win && b.type === 'black'))  ? 1 : 0,
      green_hits: (N === 0) ? 1 : 0,
      straight_wins: betResults.some(b => b.win && b.type === 'straight') ? 1 : 0,
      streak_3: (user.stats.currentStreak >= 3) ? 1 : 0,
    };
    const completedChallenges = updateChallengeProgress(user, challengeEvent);

    const oldLevel = getLevel(user.xp || 0);
    const xpGained = 5 + (netResult > 0 ? 10 : 0) + (netResult > 100 ? 10 : 0) + (netResult > 500 ? 15 : 0);
    user.xp        = (user.xp || 0) + xpGained;
    const newLevel = getLevel(user.xp);
    let levelUp    = null;
    if (newLevel > oldLevel) {
      const bonus   = newLevel * 100;
      user.balance += bonus;
      levelUp       = { level: newLevel, bonus };
    }

    const nextSeed          = generateSeed();
    user.nextServerSeed     = nextSeed;
    user.nextServerSeedHash = crypto.createHash('sha256').update(nextSeed).digest('hex');

    roundHistory.unshift({ number: N, color, timestamp: Date.now(), username: user.username, netResult });
    if (roundHistory.length > 200) roundHistory = roundHistory.slice(0, 200);

    await saveUser(user);

    broadcast({ type: 'spin_result', number: N, color, username: user.username, netResult, timestamp: Date.now() });

    res.json({
      result:        { number: N, color, wheelIndex: getWheelIndex(N) },
      betResults, totalBet, totalPayout, netResult,
      balance:       user.balance,
      proof:         { serverSeed, clientSeed: safeClient, hash: result.hash },
      nextRoundHash: user.nextServerSeedHash,
      newAchievements, stats: user.stats,
      xp: user.xp, xpGained, level: getLevel(user.xp), levelUp,
      challenges:    user.dailyChallenges,
      completedChallenges,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/history', requireAuth, (req, res) => {
  res.json({ history: (req.user.history || []).slice(0, 50) });
});

app.get('/api/stats', requireAuth, (req, res) => {
  const hist   = req.user.history || [];
  const colors = { red: 0, black: 0, green: 0 };
  const nums   = {};
  hist.slice(0, 100).forEach(h => {
    colors[h.color] = (colors[h.color] || 0) + 1;
    nums[h.number]  = (nums[h.number]  || 0) + 1;
  });
  let hotNumber = null, hotCount = 0;
  Object.entries(nums).forEach(([n, c]) => { if (c > hotCount) { hotCount = c; hotNumber = +n; } });
  res.json({ stats: req.user.stats, colorCounts: colors, hotNumber, hotCount, lastNumbers: hist.slice(0, 10).map(h => ({ number: h.number, color: h.color })) });
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const allUsers = await usersCol.find({}).toArray();
    const board = allUsers
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5)
      .map(u => ({ username: u.username, balance: u.balance, spins: u.stats?.spins || 0 }));
    res.json({ leaderboard: board });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Daily Bonus (with login streak) ───────────────────
app.get('/api/bonus-status', requireAuth, async (req, res) => {
  const user  = req.user;
  const today = new Date().toDateString();

  // Daily
  const dailyClaimed = user.lastDailyReward === today;
  const streak       = user.loginStreak || 0;
  const nextStreakDay = (streak % 7) + 1;  // day you'd be on after claiming
  const nextReward   = DAILY_STREAK_REWARDS[(streak % 7)];

  // 5-min bonus
  const now       = Date.now();
  const last      = user.lastBonusClaim || 0;
  const elapsed   = now - last;
  const remaining = Math.max(0, BONUS_5MIN_INTERVAL - elapsed);
  const canClaim5 = remaining === 0;

  res.json({
    daily: {
      canClaim: !dailyClaimed,
      streak,
      nextStreakDay,
      nextReward,
      rewards: DAILY_STREAK_REWARDS,
    },
    bonus5min: {
      canClaim: canClaim5,
      remainingMs: remaining,
      amount: BONUS_5MIN_AMOUNT,
      intervalMs: BONUS_5MIN_INTERVAL,
    },
  });
});

app.post('/api/daily-reward', requireAuth, async (req, res) => {
  try {
    const user  = req.user;
    const today = new Date().toDateString();
    if (user.lastDailyReward === today) return res.status(400).json({ error: 'Already claimed today — come back tomorrow!' });

    // Check streak: was yesterday? if yes continue, else reset
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const prevStreak = user.loginStreak || 0;
    const newStreak  = (user.lastDailyReward === yesterday) ? (prevStreak + 1) : 1;

    // Reward depends on where in the 7-day cycle we land
    const dayIndex = ((newStreak - 1) % 7);
    const reward   = DAILY_STREAK_REWARDS[dayIndex];

    user.balance        += reward;
    user.lastDailyReward = today;
    user.loginStreak     = newStreak;

    await saveUser(user);
    res.json({ reward, balance: user.balance, streak: newStreak, dayInCycle: dayIndex + 1 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── 5-minute recurring bonus ─────────────────────────
app.post('/api/bonus-5min', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const now  = Date.now();
    const last = user.lastBonusClaim || 0;
    if (now - last < BONUS_5MIN_INTERVAL) {
      const remaining = BONUS_5MIN_INTERVAL - (now - last);
      return res.status(400).json({ error: 'Not ready yet', remainingMs: remaining });
    }
    user.balance       += BONUS_5MIN_AMOUNT;
    user.lastBonusClaim = now;
    await saveUser(user);
    res.json({
      reward:  BONUS_5MIN_AMOUNT,
      balance: user.balance,
      nextAvailable: now + BONUS_5MIN_INTERVAL,
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Daily challenges ─────────────────────────────────
app.get('/api/challenges', requireAuth, async (req, res) => {
  try {
    const user   = req.user;
    const before = user.challengeDate;
    ensureChallenges(user);
    if (before !== user.challengeDate) await saveUser(user);
    res.json({ challenges: user.dailyChallenges, date: user.challengeDate });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/challenges/claim', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    ensureChallenges(user);
    const id   = req.body.id;
    const ch   = user.dailyChallenges.find(c => c.id === id);
    if (!ch)           return res.status(404).json({ error: 'Challenge not found' });
    if (!ch.completed) return res.status(400).json({ error: 'Not yet completed' });
    if (ch.claimed)    return res.status(400).json({ error: 'Already claimed' });

    ch.claimed   = true;
    user.balance += ch.reward;
    await saveUser(user);
    res.json({ reward: ch.reward, balance: user.balance, challenges: user.dailyChallenges });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Advanced stats for charts ────────────────────────
app.get('/api/advanced-stats', requireAuth, async (req, res) => {
  try {
    const user  = req.user;
    const hist  = user.history || [];

    // Net balance progression (last 50 spins, oldest to newest)
    const recent = hist.slice(0, 50).reverse();
    let cumulative = 0;
    const progression = recent.map((h, i) => {
      cumulative += h.netResult || 0;
      return { i, net: h.netResult || 0, cumulative };
    });

    // Number heatmap (how often each 0-36 has come up)
    const numCounts = new Array(37).fill(0);
    hist.forEach(h => { if (typeof h.number === 'number') numCounts[h.number]++; });

    // Bet-type distribution
    const byType = {};
    hist.forEach(h => (h.bets || []).forEach(b => { byType[b.type] = (byType[b.type] || 0) + (b.amount || 0); }));

    // Biggest win & loss
    let biggestWin  = 0, biggestLoss = 0;
    hist.forEach(h => {
      if (h.netResult > biggestWin)  biggestWin  = h.netResult;
      if (h.netResult < biggestLoss) biggestLoss = h.netResult;
    });

    res.json({
      progression,
      numCounts,
      betTypeDistribution: byType,
      biggestWin,
      biggestLoss,
      totalSpins: hist.length,
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/reset', requireAuth, async (req, res) => {
  try {
    const user    = req.user;
    user.balance  = 1000;
    user.history  = [];
    user.stats    = defaultStats();
    user.lowPoint = 1000;
    await saveUser(user);
    res.json({ balance: user.balance });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// Admin Panel Routes
// ============================================================

async function requireAdmin(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const session = await getSession(token);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  const user = await getUserById(session.userId);
  if (!isAdminUser(user)) return res.status(403).json({ error: 'Forbidden' });
  req.user = user;
  next();
}

app.get('/admin/api/users', requireAdmin, async (req, res) => {
  try {
    const allUsers = await usersCol.find({}).toArray();
    const list = allUsers
      .filter(u => !isAdminUser(u))
      .map(u => ({
        id: u.id, username: u.username, balance: u.balance,
        spins: u.stats?.spins || 0, wins: u.stats?.wins || 0,
        totalBet: u.stats?.totalBet || 0, totalWon: u.stats?.totalWon || 0,
        netPL: u.stats?.netPL || 0, createdAt: u.createdAt,
      }));
    res.json({ users: list });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/admin/api/users/:id/add-funds', requireAdmin, async (req, res) => {
  try {
    const user   = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const amount = parseInt(req.body.amount);
    if (!amount || amount < 1 || amount > 1000000) return res.status(400).json({ error: 'Invalid amount' });
    user.balance += amount;
    if (!user.stats) user.stats = defaultStats();
    user.stats.netPL = (user.stats.netPL || 0) + amount;
    await saveUser(user);
    broadcast({ type: 'balance_update', userId: user.id, balance: user.balance });
    res.json({ balance: user.balance });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/admin/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await deleteUserSessions(req.params.id);
    await usersCol.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/admin/api/users/:id/login-as', requireAdmin, async (req, res) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const token = generateId();
    await saveSession(token, user.id);
    res.json({ token, username: user.username });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// WebSocket
// ============================================================
async function activePlayerCount() {
  return (await sessionsCol.distinct('userId')).length;
}

wss.on('connection', async ws => {
  wsClients.add(ws);
  ws.send(JSON.stringify({
    type:         'connected',
    recentRounds: roundHistory.slice(0, 15),
    playerCount:  await activePlayerCount(),
  }));
  broadcast({ type: 'player_count', count: await activePlayerCount() });

  ws.on('close', async () => {
    wsClients.delete(ws);
    broadcast({ type: 'player_count', count: await activePlayerCount() });
  });
  ws.on('error', () => wsClients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wsClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
}

// ============================================================
// Start
// ============================================================
connectDB().then(async () => {
  await seedAdmin();
  server.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║   🎰  Royal Roulette Casino           ║');
    console.log(`║   Server: http://localhost:${PORT}      ║`);
    console.log('╚══════════════════════════════════════╝\n');
  });
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});
