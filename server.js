require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OpenAI = require('openai');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.CALORIES_DATA_DIR || path.join(__dirname, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// Per-user data files are resolved per-request by attachUser middleware.
// See req.dataFiles.{profile|log|weight|templates|custom_foods|water}

// Pricing per 1M tokens
const PRICING = {
  'gpt-5-nano':   { in: 0.05, out: 0.40 },
  'gpt-5-mini':   { in: 0.25, out: 2.00 },
  'gpt-5':        { in: 1.25, out: 10.00 },
  'gpt-4.1-nano': { in: 0.10, out: 0.40 },
  'gpt-4.1-mini': { in: 0.40, out: 1.60 },
  'gpt-4o-mini':  { in: 0.15, out: 0.60 }
};
function priceFor(model) {
  const key = Object.keys(PRICING).find(k => model.startsWith(k));
  return PRICING[key] || { in: 0.10, out: 0.40 };
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-nano';

const AI_LOG_FILE = path.join(DATA_DIR, 'ai_calls.log');
const DAILY_TOKEN_CAP = Number(process.env.DAILY_TOKEN_CAP || 500_000);  // hard stop past 500k tokens/day default
const DAILY_COST_CAP_USD = Number(process.env.DAILY_COST_CAP_USD || 2);   // hard stop past $2/day default
const AI_DISABLED = process.env.AI_DISABLED === '1';

function todayUsage() {
  const arr = readJson(USAGE_FILE, []);
  const today = todayStr();
  let tokens = 0, cost = 0, calls = 0;
  for (const x of arr) {
    if (x.ts.slice(0, 10) !== today) continue;
    tokens += (x.in || 0) + (x.out || 0);
    cost += (x.cost || 0);
    calls += 1;
  }
  return { tokens, cost, calls };
}

function checkAiAllowed() {
  if (AI_DISABLED) return { ok: false, reason: 'AI_DISABLED env var is set' };
  const u = todayUsage();
  if (u.tokens >= DAILY_TOKEN_CAP) return { ok: false, reason: `Daily token cap (${DAILY_TOKEN_CAP.toLocaleString()}) hit — ${u.tokens.toLocaleString()} used. Raise DAILY_TOKEN_CAP env var to allow more.` };
  if (u.cost >= DAILY_COST_CAP_USD) return { ok: false, reason: `Daily cost cap ($${DAILY_COST_CAP_USD}) hit — $${u.cost.toFixed(4)} spent. Raise DAILY_COST_CAP_USD env var to allow more.` };
  return { ok: true };
}

function recordUsage(endpoint, model, usage) {
  if (!usage) return;
  const arr = readJson(USAGE_FILE, []);
  const p = priceFor(model);
  const inT = usage.prompt_tokens || 0;
  const outT = usage.completion_tokens || 0;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens || 0;
  const cost = (inT * p.in + outT * p.out) / 1_000_000;
  const entry = {
    ts: new Date().toISOString(),
    endpoint,
    model,
    in: inT,
    out: outT,
    reasoning,
    cost: Math.round(cost * 1_000_000) / 1_000_000
  };
  arr.push(entry);
  if (arr.length > 1000) arr.splice(0, arr.length - 1000);
  writeJson(USAGE_FILE, arr);
  // Append-only log — can't race, can't be lost by trimming
  try {
    fs.appendFileSync(AI_LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (e) { /* ignore log failures */ }
  // Console-print each call so we can SEE what's happening
  console.log(`[AI] ${entry.ts} ${endpoint} model=${model} in=${inT} out=${outT} reasoning=${reasoning} cost=$${entry.cost.toFixed(4)}`);
}

async function aiJson(endpoint, systemPrompt, userPrompt, maxTokens = 4000) {
  const allowed = checkAiAllowed();
  if (!allowed.ok) {
    console.warn(`[AI] BLOCKED ${endpoint}: ${allowed.reason}`);
    throw new Error(`AI call blocked: ${allowed.reason}`);
  }
  const r = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_completion_tokens: maxTokens
  });
  recordUsage(endpoint, r.model || OPENAI_MODEL, r.usage);
  const content = r.choices[0].message.content;
  if (!content || !content.trim()) {
    const reasoning = r.usage?.completion_tokens_details?.reasoning_tokens || 0;
    throw new Error(`Empty response from model (used ${reasoning} reasoning tokens of ${maxTokens} budget — try increasing maxTokens)`);
  }
  return JSON.parse(content);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------- Auth: Discord OAuth + signed cookie sessions ----------
const cookieParser = require('cookie-parser');
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-env-please';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const ALLOWED_DISCORD_IDS = (process.env.ALLOWED_DISCORD_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 86400 * 1000;
const COOKIE_NAME = 'calories_sid';

app.use(cookieParser(SESSION_SECRET));

// Sessions persisted to disk so they survive restarts (in-memory map for speed, file for durability)
function loadSessions() { try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch { return {}; } }
function saveSessions(s) { try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(s)); } catch (_) {} }
const sessions = loadSessions();

function newSessionId() { return crypto.randomBytes(24).toString('hex'); }
function setSession(res, user) {
  const sid = newSessionId();
  sessions[sid] = { user, expires: Date.now() + SESSION_MS };
  saveSessions(sessions);
  res.cookie(COOKIE_NAME, sid, { signed: true, httpOnly: true, secure: true, sameSite: 'lax', maxAge: SESSION_MS });
}
function clearSession(res, req) {
  const sid = req.signedCookies[COOKIE_NAME];
  if (sid && sessions[sid]) { delete sessions[sid]; saveSessions(sessions); }
  res.clearCookie(COOKIE_NAME);
}
function getSession(req) {
  const sid = req.signedCookies[COOKIE_NAME];
  if (!sid) return null;
  const s = sessions[sid];
  if (!s) return null;
  if (s.expires < Date.now()) { delete sessions[sid]; saveSessions(sessions); return null; }
  return s.user;
}

// ---------- Discord OAuth routes ----------
app.get('/auth/discord', (req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) return res.status(500).send('Discord OAuth not configured (set DISCORD_CLIENT_ID + DISCORD_REDIRECT_URI in .env)');
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    prompt: 'none'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: DISCORD_REDIRECT_URI
      }).toString()
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) return res.status(401).send('Discord token exchange failed');
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` }
    });
    const u = await userRes.json();
    if (!u.id) return res.status(401).send('Could not load Discord profile');
    if (!ALLOWED_DISCORD_IDS.includes(u.id)) {
      return res.status(403).send(`<html><body style="font-family:system-ui;background:#0e1116;color:#e6edf3;padding:40px;text-align:center;"><h1 style="color:#f87171;">Not authorized</h1><p>Discord user <strong>${u.username}</strong> (id: ${u.id}) is not on the allow-list for this app.</p><p style="color:#8b949e;font-size:13px;">If you should have access, ask the owner to add your Discord ID.</p></body></html>`);
    }
    setSession(res, { id: u.id, username: u.username, global_name: u.global_name || u.username, avatar: u.avatar });
    res.redirect('/');
  } catch (e) {
    console.error('Discord OAuth error:', e);
    res.status(500).send('OAuth error: ' + e.message);
  }
});

app.post('/auth/logout', (req, res) => { clearSession(res, req); res.json({ ok: true }); });

// ---------- Auth middleware for all /api routes ----------
function attachUser(req, res, next) {
  const user = getSession(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  req.user = user;
  req.userId = user.id;
  const userDir = path.join(USERS_DIR, req.userId);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  req.dataFiles = {
    profile:      path.join(userDir, 'profile.json'),
    log:          path.join(userDir, 'log.json'),
    weight:       path.join(userDir, 'weight.json'),
    templates:    path.join(userDir, 'templates.json'),
    custom_foods: path.join(userDir, 'custom_foods.json'),
    water:        path.join(userDir, 'water.json')
  };
  next();
}
app.use('/api', attachUser);

// /api/me — who is the current user
app.get('/api/me', (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, global_name: req.user.global_name, avatar: req.user.avatar });
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- JSON file helpers ----------
function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function newId() {
  return crypto.randomBytes(6).toString('hex');
}

// ---------- BMR / TDEE math ----------
const ACTIVITY = {
  sedentary: { mult: 1.2, label: 'Sedentary', desc: 'Desk job, no exercise' },
  light:     { mult: 1.375, label: 'Light', desc: 'Walk often, gym 1-3x/wk' },
  moderate:  { mult: 1.55, label: 'Moderate', desc: 'Gym 3-5x/wk' },
  active:    { mult: 1.725, label: 'Active', desc: 'Gym 6-7x/wk hard' },
  athlete:   { mult: 1.9, label: 'Athlete', desc: '2-a-days or physical job' }
};
const GOALS = {
  mild:        { delta: -250, label: 'Slow loss',     desc: '~0.25 kg / week' },
  steady:      { delta: -500, label: 'Steady loss',   desc: '~0.5 kg / week' },
  aggressive:  { delta: -750, label: 'Aggressive',    desc: '~0.75 kg / week' },
  maintain:    { delta: 0,    label: 'Maintain',      desc: 'Stay current weight' },
  gain:        { delta: 300,  label: 'Gain',          desc: 'Slow muscle gain' }
};

function computeStats(profile) {
  if (!profile || !profile.weight_kg || !profile.height_cm || !profile.age || !profile.sex) {
    return null;
  }
  const { weight_kg, height_cm, age, sex } = profile;
  const sexAdj = sex === 'male' ? 5 : -161;
  const bmr = Math.round(10 * weight_kg + 6.25 * height_cm - 5 * age + sexAdj);
  const act = ACTIVITY[profile.activity] || ACTIVITY.moderate;
  const goal = GOALS[profile.goal] || GOALS.steady;
  const tdee_predicted = Math.round(bmr * act.mult);
  const tdee = profile.tdee_override ? Math.round(profile.tdee_override) : tdee_predicted;
  const tdee_calibrated = !!profile.tdee_override;
  const kcal_goal = Math.max(1200, tdee + goal.delta);
  const protein_g = Math.round(weight_kg * 1.76);
  const fat_g = Math.round(kcal_goal * 0.25 / 9);
  const carb_g = Math.round((kcal_goal - protein_g * 4 - fat_g * 9) / 4);
  const fiber_g = Math.round(kcal_goal * 14 / 1000);

  const lossPerWeek = goal.delta < 0 ? Math.round(Math.abs(goal.delta) * 7 / 7700 * 100) / 100 : 0;
  const explainer = `Your body burns about ${tdee.toLocaleString()} calories a day just existing and moving around — that's your TDEE. ` +
    (goal.delta < 0
      ? `To lose roughly ${lossPerWeek} kg a week, eat ${kcal_goal.toLocaleString()} — that creates a ${Math.abs(goal.delta)}-calorie gap each day, and 7,700 calories ≈ 1 kg of fat. `
      : goal.delta > 0
      ? `To slowly gain muscle, eat ${kcal_goal.toLocaleString()} — that's ${goal.delta} calories above what you burn. `
      : `To stay at your current weight, eat ${kcal_goal.toLocaleString()}. `) +
    `Your protein target is ${protein_g}g — this protects your muscle while you change weight.`;

  return { bmr, tdee, tdee_predicted, tdee_calibrated, kcal_goal, protein_g, fat_g, carb_g, fiber_g, weight_kg, activity: act, goal_meta: goal, explainer };
}

// ---------- /api/profile ----------
app.get('/api/profile', (req, res) => {
  const profile = readJson(req.dataFiles.profile, null);
  res.json({ profile, stats: computeStats(profile), activity_options: ACTIVITY, goal_options: GOALS });
});
app.post('/api/profile', (req, res) => {
  const existing = readJson(req.dataFiles.profile, {}) || {};
  const profile = { ...existing, ...(req.body || {}) };
  writeJson(req.dataFiles.profile, profile);
  res.json({ profile, stats: computeStats(profile) });
});

app.get('/api/calibrate', (req, res) => {
  const profile = readJson(req.dataFiles.profile, null);
  const stats = computeStats(profile);
  if (!stats) return res.json({ can_calibrate: false, reason: 'Set up your profile first.' });

  const log = readJson(req.dataFiles.log, {});
  const weights = readJson(req.dataFiles.weight, []);
  if (weights.length < 2) {
    return res.json({ can_calibrate: false, reason: 'Need at least 2 weight entries.', tdee_predicted: stats.tdee_predicted, tdee_current: stats.tdee, calibrated: stats.tdee_calibrated });
  }

  // Use weight entries spanning the longest window with kcal log coverage (min 14 days)
  const sortedW = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const first = sortedW[0];
  const last = sortedW[sortedW.length - 1];
  const firstD = new Date(first.date + 'T00:00:00');
  const lastD = new Date(last.date + 'T00:00:00');
  const daysSpan = Math.round((lastD - firstD) / 86400000);

  if (daysSpan < 14) {
    return res.json({ can_calibrate: false, reason: `Need at least 14 days between weight entries (currently ${daysSpan}).`, tdee_predicted: stats.tdee_predicted, tdee_current: stats.tdee, calibrated: stats.tdee_calibrated });
  }

  // Sum kcal logged in the window
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const d = new Date(firstD);
  let totalKcal = 0, daysLogged = 0;
  while (d <= lastD) {
    const ds = fmt(d);
    const entries = log[ds] || [];
    if (entries.length) {
      totalKcal += entries.reduce((a, e) => a + (e.kcal || 0), 0);
      daysLogged += 1;
    }
    d.setDate(d.getDate() + 1);
  }

  if (daysLogged < 10) {
    return res.json({ can_calibrate: false, reason: `Need at least 10 logged days in the window (have ${daysLogged} of ${daysSpan}).`, tdee_predicted: stats.tdee_predicted, tdee_current: stats.tdee, calibrated: stats.tdee_calibrated });
  }

  const avgKcal = totalKcal / daysLogged;
  const weightDeltaKg = last.kg - first.kg;
  // TDEE = avg_eaten - (weight_change_kg * 7700 / days). If lost weight, weight_delta is negative → TDEE > eaten.
  const impliedTdee = Math.round(avgKcal - (weightDeltaKg * 7700 / daysSpan));

  // Sanity guards
  const safeImplied = Math.max(1200, Math.min(5000, impliedTdee));
  const diff = safeImplied - stats.tdee_predicted;

  res.json({
    can_calibrate: true,
    tdee_predicted: stats.tdee_predicted,
    tdee_current: stats.tdee,
    tdee_implied: safeImplied,
    diff,
    calibrated: stats.tdee_calibrated,
    days_span: daysSpan,
    days_logged: daysLogged,
    weight_start: first.kg,
    weight_end: last.kg,
    weight_delta_kg: Math.round(weightDeltaKg * 100) / 100,
    avg_kcal: Math.round(avgKcal),
    weight_start_date: first.date,
    weight_end_date: last.date
  });
});

// ---------- Streak + weekly avg ----------
function computeStreak(log, stats) {
  if (!stats) return 0;
  let streak = 0;
  const d = new Date();
  for (let i = 0; i <= 60; i++) {
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const entries = log[ds] || [];
    if (!entries.length) {
      if (i === 0) { d.setDate(d.getDate() - 1); continue; } // today may have no entries yet
      break;
    }
    const total = entries.reduce((a, e) => a + (e.kcal || 0), 0);
    if (total > stats.kcal_goal) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function computeWeeklyAvg(log) {
  let totalKcal = 0, days = 0;
  const d = new Date();
  for (let i = 0; i < 7; i++) {
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const entries = log[ds] || [];
    if (entries.length) {
      totalKcal += entries.reduce((a, e) => a + (e.kcal || 0), 0);
      days++;
    }
    d.setDate(d.getDate() - 1);
  }
  return days > 0 ? Math.round(totalKcal / days) : null;
}

// ---------- /api/log ----------
app.get('/api/log', (req, res) => {
  const date = req.query.date || todayStr();
  const log = readJson(req.dataFiles.log, {});
  const entries = log[date] || [];
  const totals = entries.reduce((a, e) => ({
    kcal: a.kcal + (e.kcal || 0),
    protein: a.protein + (e.protein || 0),
    fat: a.fat + (e.fat || 0),
    carb: a.carb + (e.carb || 0),
    fiber: a.fiber + (e.fiber || 0)
  }), { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 });
  const profile = readJson(req.dataFiles.profile, null);
  const stats = computeStats(profile);
  const isToday = !req.query.date || req.query.date === todayStr();
  res.json({
    date,
    entries,
    totals,
    remaining_kcal: stats ? stats.kcal_goal - totals.kcal : null,
    remaining_protein: stats ? stats.protein_g - totals.protein : null,
    remaining_fat: stats ? stats.fat_g - totals.fat : null,
    remaining_carb: stats ? stats.carb_g - totals.carb : null,
    remaining_fiber: stats ? stats.fiber_g - totals.fiber : null,
    stats,
    streak: isToday ? computeStreak(log, stats) : undefined,
    weekly_avg_kcal: isToday ? computeWeeklyAvg(log) : undefined
  });
});

app.post('/api/log', (req, res) => {
  const { name, kcal, protein, fat, carb, fiber, source, items, date, time } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const d = date || todayStr();
  const log = readJson(req.dataFiles.log, {});
  if (!log[d]) log[d] = [];
  const entry = {
    id: newId(),
    name: String(name).slice(0, 200),
    kcal: Math.round(Number(kcal) || 0),
    protein: Math.round((Number(protein) || 0) * 10) / 10,
    fat: Math.round((Number(fat) || 0) * 10) / 10,
    carb: Math.round((Number(carb) || 0) * 10) / 10,
    fiber: Math.round((Number(fiber) || 0) * 10) / 10,
    source: source || 'manual',
    items: items || null,
    time: time || new Date().toISOString()
  };
  log[d].push(entry);
  writeJson(req.dataFiles.log, log);
  res.json({ entry });
});

app.patch('/api/log/:date/:id', (req, res) => {
  const { date, id } = req.params;
  const { name, kcal, protein, fat, carb, fiber, time } = req.body || {};
  const log = readJson(req.dataFiles.log, {});
  if (!log[date]) return res.status(404).json({ error: 'date not found' });
  const idx = log[date].findIndex(e => e.id === id);
  if (idx < 0) return res.status(404).json({ error: 'entry not found' });
  if (name !== undefined) log[date][idx].name = String(name).slice(0, 200);
  if (kcal !== undefined) log[date][idx].kcal = Math.round(Number(kcal) || 0);
  if (protein !== undefined) log[date][idx].protein = Math.round((Number(protein) || 0) * 10) / 10;
  if (fat !== undefined) log[date][idx].fat = Math.round((Number(fat) || 0) * 10) / 10;
  if (carb !== undefined) log[date][idx].carb = Math.round((Number(carb) || 0) * 10) / 10;
  if (fiber !== undefined) log[date][idx].fiber = Math.round((Number(fiber) || 0) * 10) / 10;
  if (time !== undefined) log[date][idx].time = time;
  writeJson(req.dataFiles.log, log);
  res.json({ entry: log[date][idx] });
});

app.delete('/api/log/:date/:id', (req, res) => {
  const { date, id } = req.params;
  const log = readJson(req.dataFiles.log, {});
  if (log[date]) {
    log[date] = log[date].filter(e => e.id !== id);
    writeJson(req.dataFiles.log, log);
  }
  res.json({ ok: true });
});

// ---------- /api/weight ----------
app.get('/api/weight', (req, res) => {
  res.json(readJson(req.dataFiles.weight, []));
});
app.post('/api/weight', (req, res) => {
  const { kg, date } = req.body || {};
  if (!kg) return res.status(400).json({ error: 'kg required' });
  const arr = readJson(req.dataFiles.weight, []);
  const d = date || todayStr();
  const existing = arr.findIndex(w => w.date === d);
  const entry = { date: d, kg: Number(kg) };
  if (existing >= 0) arr[existing] = entry;
  else arr.push(entry);
  arr.sort((a, b) => a.date.localeCompare(b.date));
  writeJson(req.dataFiles.weight, arr);
  // Only push to profile if this is the most recent weight (don't break TDEE if user backfills an old entry)
  const profile = readJson(req.dataFiles.profile, null);
  if (profile && arr[arr.length - 1].date === d) {
    profile.weight_kg = Number(kg);
    writeJson(req.dataFiles.profile, profile);
  }
  res.json({ entry });
});
app.delete('/api/weight/:date', (req, res) => {
  const { date } = req.params;
  const arr = readJson(req.dataFiles.weight, []);
  const filtered = arr.filter(w => w.date !== date);
  writeJson(req.dataFiles.weight, filtered);
  // If we deleted the latest weight, sync profile back to the new latest
  const profile = readJson(req.dataFiles.profile, null);
  if (profile && filtered.length) {
    profile.weight_kg = Number(filtered[filtered.length - 1].kg);
    writeJson(req.dataFiles.profile, profile);
  }
  res.json({ ok: true });
});

// ---------- /api/favorites ----------
app.get('/api/favorites', (req, res) => {
  const log = readJson(req.dataFiles.log, {});
  const counts = {};
  for (const [date, entries] of Object.entries(log).sort()) {
    for (const e of entries) {
      if (!e.name) continue;
      const key = e.name.trim().toLowerCase();
      if (!counts[key]) counts[key] = {
        name: e.name, count: 0, kcal_sum: 0, protein_sum: 0, fat_sum: 0, carb_sum: 0, fiber_sum: 0,
        last_kcal: 0, last_protein: 0, last_fat: 0, last_carb: 0, last_fiber: 0, last_text: e.name, last_date: ''
      };
      counts[key].count++;
      counts[key].kcal_sum += e.kcal || 0;
      counts[key].protein_sum += e.protein || 0;
      counts[key].fat_sum += e.fat || 0;
      counts[key].carb_sum += e.carb || 0;
      counts[key].fiber_sum += e.fiber || 0;
      if (date >= counts[key].last_date) {
        counts[key].last_date = date;
        counts[key].last_kcal = e.kcal || 0;
        counts[key].last_protein = e.protein || 0;
        counts[key].last_fat = e.fat || 0;
        counts[key].last_carb = e.carb || 0;
        counts[key].last_fiber = e.fiber || 0;
        counts[key].last_text = e.name;
      }
    }
  }
  const favs = Object.values(counts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map(f => ({
      name: f.name,
      count: f.count,
      kcal: Math.round(f.kcal_sum / f.count),
      protein: Math.round((f.protein_sum / f.count) * 10) / 10,
      last_kcal: f.last_kcal,
      last_protein: f.last_protein,
      last_fat: f.last_fat || 0,
      last_carb: f.last_carb || 0,
      last_fiber: f.last_fiber || 0,
      last_text: f.last_text
    }));
  res.json(favs);
});

// ---------- /api/log-range ----------
app.get('/api/log-range', (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });
  const log = readJson(req.dataFiles.log, {});
  const profile = readJson(req.dataFiles.profile, null);
  const stats = computeStats(profile);
  const goal = stats ? stats.kcal_goal : null;
  const result = {};
  const d = new Date(start + 'T00:00:00');
  const endD = new Date(end + 'T00:00:00');
  while (d <= endD) {
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const entries = log[ds] || [];
    if (entries.length) {
      const kcal = entries.reduce((a, e) => a + (e.kcal || 0), 0);
      const protein = Math.round(entries.reduce((a, e) => a + (e.protein || 0), 0) * 10) / 10;
      result[ds] = { kcal, protein, goal, protein_goal: stats ? stats.protein_g : null, entries_count: entries.length };
    }
    d.setDate(d.getDate() + 1);
  }
  res.json(result);
});

app.get('/api/source-breakdown', (req, res) => {
  const log = readJson(req.dataFiles.log, {});
  const start = req.query.start;
  const end = req.query.end || todayStr();
  const breakdown = {};
  Object.entries(log).forEach(([date, entries]) => {
    if (start && date < start) return;
    if (date > end) return;
    entries.forEach(e => {
      const src = e.source || 'manual';
      if (!breakdown[src]) breakdown[src] = { count: 0, kcal: 0 };
      breakdown[src].count += 1;
      breakdown[src].kcal += (e.kcal || 0);
    });
  });
  res.json(breakdown);
});

app.get('/api/logging-stats', (req, res) => {
  const log = readJson(req.dataFiles.log, {});
  const today = todayStr();
  // Current streak — count back from today, allow today to be empty
  let streak = 0;
  let bestStreak = 0;
  let curStreak = 0;
  const sortedDates = Object.keys(log).filter(d => (log[d] || []).length > 0).sort();
  // best streak ever
  for (let i = 0; i < sortedDates.length; i++) {
    if (i === 0) { curStreak = 1; }
    else {
      const prev = new Date(sortedDates[i-1] + 'T00:00:00');
      const cur = new Date(sortedDates[i] + 'T00:00:00');
      const dayDiff = Math.round((cur - prev) / 86400000);
      if (dayDiff === 1) curStreak += 1;
      else curStreak = 1;
    }
    if (curStreak > bestStreak) bestStreak = curStreak;
  }
  // current streak — walk back from today
  const d = new Date(today + 'T00:00:00');
  for (let i = 0; i < 365; i++) {
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const has = (log[ds] || []).length > 0;
    if (!has) {
      if (i === 0) { d.setDate(d.getDate() - 1); continue; } // today not logged yet is OK
      break;
    }
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  // meals per day (last 30 days that had any log)
  const last30 = sortedDates.slice(-30);
  let mealsTotal = 0;
  last30.forEach(ds => mealsTotal += (log[ds] || []).length);
  const mealsPerDay = last30.length ? Math.round((mealsTotal / last30.length) * 10) / 10 : 0;
  // Total days logged ever
  const totalDaysLogged = sortedDates.length;
  res.json({ current_streak: streak, best_streak: bestStreak, meals_per_day: mealsPerDay, total_days_logged: totalDaysLogged });
});

app.get('/api/weekly-review', (req, res) => {
  const log = readJson(req.dataFiles.log, {});
  const weights = readJson(req.dataFiles.weight, []);
  const profile = readJson(req.dataFiles.profile, null);
  const stats = computeStats(profile);

  const endStr = req.query.end || todayStr();
  const endD = new Date(endStr + 'T00:00:00');
  const startD = new Date(endD); startD.setDate(startD.getDate() - 6);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const startStr = fmt(startD);

  // Walk dates in window
  const dayTotals = []; // { date, kcal, protein, fat, carb, fiber, entries }
  const d = new Date(startD);
  while (d <= endD) {
    const ds = fmt(d);
    const entries = log[ds] || [];
    if (entries.length) {
      const t = entries.reduce((a, e) => ({
        kcal: a.kcal + (e.kcal || 0),
        protein: a.protein + (e.protein || 0),
        fat: a.fat + (e.fat || 0),
        carb: a.carb + (e.carb || 0),
        fiber: a.fiber + (e.fiber || 0)
      }), { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 });
      dayTotals.push({ date: ds, ...t, entries });
    }
    d.setDate(d.getDate() + 1);
  }

  if (!dayTotals.length) {
    return res.json({ start: startStr, end: endStr, days_logged: 0, empty: true });
  }

  const goal = stats ? stats.kcal_goal : null;
  const proteinT = stats ? stats.protein_g : null;
  const fatT = stats ? stats.fat_g : null;
  const carbT = stats ? stats.carb_g : null;
  const fiberT = stats ? stats.fiber_g : null;

  const totalK = dayTotals.reduce((a, d) => a + d.kcal, 0);
  const avgK = Math.round(totalK / dayTotals.length);
  const daysHitGoal = goal ? dayTotals.filter(d => d.kcal >= goal - 200 && d.kcal <= goal + 200).length : 0;

  const inRange = (val, target) => target && val >= target * 0.8 && val <= target * 1.2;
  const macro_hit_days = {
    protein: proteinT ? dayTotals.filter(d => inRange(d.protein, proteinT)).length : 0,
    fat: fatT ? dayTotals.filter(d => inRange(d.fat, fatT)).length : 0,
    carb: carbT ? dayTotals.filter(d => inRange(d.carb, carbT)).length : 0,
    fiber: fiberT ? dayTotals.filter(d => d.fiber >= fiberT * 0.8).length : 0
  };

  // Top foods (most logged by name, normalized)
  const foodCounts = {};
  dayTotals.forEach(d => d.entries.forEach(e => {
    const key = String(e.name || '').toLowerCase().trim().slice(0, 60);
    if (!key) return;
    if (!foodCounts[key]) foodCounts[key] = { name: e.name, count: 0, total_kcal: 0 };
    foodCounts[key].count += 1;
    foodCounts[key].total_kcal += e.kcal || 0;
  }));
  const top_foods = Object.values(foodCounts)
    .filter(f => f.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(f => ({ name: f.name, count: f.count, avg_kcal: Math.round(f.total_kcal / f.count) }));

  // Weight delta in window
  const weightsInWindow = weights.filter(w => w.date >= startStr && w.date <= endStr);
  const weight_start = weightsInWindow[0] ? weightsInWindow[0].kg : null;
  const weight_end = weightsInWindow.length ? weightsInWindow[weightsInWindow.length - 1].kg : null;
  const weight_delta = weight_start !== null && weight_end !== null && weightsInWindow.length >= 2
    ? Math.round((weight_end - weight_start) * 100) / 100
    : null;

  // Best/worst day
  const sorted = [...dayTotals].sort((a, b) => a.kcal - b.kcal);
  const lightestDay = sorted[0];
  const heaviestDay = sorted[sorted.length - 1];

  res.json({
    start: startStr,
    end: endStr,
    days_logged: dayTotals.length,
    avg_kcal: avgK,
    total_kcal: totalK,
    goal_kcal: goal,
    days_hit_goal: daysHitGoal,
    macro_hit_days,
    macro_targets: { protein: proteinT, fat: fatT, carb: carbT, fiber: fiberT },
    top_foods,
    weight_delta_kg: weight_delta,
    weight_start,
    weight_end,
    lightest_day: { date: lightestDay.date, kcal: lightestDay.kcal },
    heaviest_day: { date: heaviestDay.date, kcal: heaviestDay.kcal }
  });
});

// ---------- /api/templates ----------
app.get('/api/templates', (req, res) => {
  res.json(readJson(req.dataFiles.templates, []));
});

app.post('/api/templates', (req, res) => {
  const { name, items, totals, from_log_entry_id, date } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  let templateItems = items;
  let templateTotals = totals;
  if (from_log_entry_id && date) {
    const log = readJson(req.dataFiles.log, {});
    const entry = (log[date] || []).find(e => e.id === from_log_entry_id);
    if (entry) {
      templateItems = entry.items && entry.items.length
        ? entry.items
        : [{ name: entry.name, kcal: entry.kcal, protein: entry.protein, fat: entry.fat || 0, carb: entry.carb || 0, fiber: entry.fiber || 0 }];
      templateTotals = { kcal: entry.kcal, protein: entry.protein, fat: entry.fat || 0, carb: entry.carb || 0, fiber: entry.fiber || 0 };
    }
  }
  if (!templateItems || !templateItems.length) return res.status(400).json({ error: 'items required' });
  const templates = readJson(req.dataFiles.templates, []);
  const computed = templateTotals || templateItems.reduce((a, i) => ({
    kcal: a.kcal + (i.kcal || 0), protein: a.protein + (i.protein || 0),
    fat: a.fat + (i.fat || 0), carb: a.carb + (i.carb || 0), fiber: a.fiber + (i.fiber || 0)
  }), { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 });
  const tmpl = { id: newId(), name: String(name).trim().slice(0, 100), items: templateItems, totals: computed, created: new Date().toISOString() };
  templates.push(tmpl);
  writeJson(req.dataFiles.templates, templates);
  res.json(tmpl);
});

app.patch('/api/templates/:id', (req, res) => {
  const templates = readJson(req.dataFiles.templates, []);
  const idx = templates.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  if (req.body.name) templates[idx].name = String(req.body.name).trim().slice(0, 100);
  writeJson(req.dataFiles.templates, templates);
  res.json(templates[idx]);
});

app.delete('/api/templates/:id', (req, res) => {
  const templates = readJson(req.dataFiles.templates, []);
  writeJson(req.dataFiles.templates, templates.filter(t => t.id !== req.params.id));
  res.json({ ok: true });
});

app.post('/api/log-template/:id', (req, res) => {
  const templates = readJson(req.dataFiles.templates, []);
  const tmpl = templates.find(t => t.id === req.params.id);
  if (!tmpl) return res.status(404).json({ error: 'template not found' });
  const d = req.query.date || todayStr();
  const log = readJson(req.dataFiles.log, {});
  if (!log[d]) log[d] = [];
  const now = new Date().toISOString();
  const entries = (tmpl.items || []).map(item => ({
    id: newId(),
    name: String(item.name || '').slice(0, 200),
    kcal: Math.round(item.kcal || 0),
    protein: Math.round((item.protein || 0) * 10) / 10,
    fat: Math.round((item.fat || 0) * 10) / 10,
    carb: Math.round((item.carb || 0) * 10) / 10,
    fiber: Math.round((item.fiber || 0) * 10) / 10,
    source: 'custom',
    time: now
  }));
  log[d].push(...entries);
  writeJson(req.dataFiles.log, log);
  res.json({ logged: entries.length, entries });
});

// ---------- /api/suggest ----------
app.get('/api/suggest', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q || q.length < 2) return res.json([]);
  const results = [];
  const seen = new Set();

  const customs = readJson(req.dataFiles.custom_foods, {});
  for (const food of Object.values(customs)) {
    if (food.name.toLowerCase().includes(q) && !seen.has(food.name.toLowerCase())) {
      seen.add(food.name.toLowerCase());
      results.push({ name: food.name, kcal: food.kcal, protein: food.protein, fat: food.fat || 0, carb: food.carb || 0, fiber: food.fiber || 0, source: 'custom' });
    }
  }

  const templates = readJson(req.dataFiles.templates, []);
  for (const t of templates) {
    if (t.name.toLowerCase().includes(q) && !seen.has(t.name.toLowerCase())) {
      seen.add(t.name.toLowerCase());
      results.push({ name: t.name, kcal: t.totals.kcal, protein: t.totals.protein, fat: t.totals.fat || 0, carb: t.totals.carb || 0, fiber: t.totals.fiber || 0, source: 'template', template_id: t.id });
    }
  }

  const log = readJson(req.dataFiles.log, {});
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const histMap = {};
  for (const [date, entries] of Object.entries(log)) {
    if (date < cutoffStr) continue;
    for (const e of entries) {
      if (!e.name || !e.name.toLowerCase().includes(q)) continue;
      const key = e.name.toLowerCase();
      if (!histMap[key]) histMap[key] = { name: e.name, kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, count: 0 };
      histMap[key].kcal += e.kcal || 0;
      histMap[key].protein += e.protein || 0;
      histMap[key].fat += e.fat || 0;
      histMap[key].carb += e.carb || 0;
      histMap[key].fiber += e.fiber || 0;
      histMap[key].count++;
    }
  }
  for (const [key, entry] of Object.entries(histMap)) {
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ name: entry.name, kcal: Math.round(entry.kcal / entry.count), protein: Math.round((entry.protein / entry.count) * 10) / 10, fat: Math.round((entry.fat / entry.count) * 10) / 10, carb: Math.round((entry.carb / entry.count) * 10) / 10, fiber: Math.round((entry.fiber / entry.count) * 10) / 10, source: 'history' });
    }
  }
  res.json(results.slice(0, 6));
});

// ---------- /api/macro-suggest ----------
const macroSuggestCache = new Map();

app.get('/api/macro-suggest', async (req, res) => {
  if (!openai) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
  const { macro, remaining } = req.query;
  if (!macro || remaining == null) return res.status(400).json({ error: 'macro and remaining required' });
  const rounded = Math.round(Number(remaining) / 5) * 5;
  const cacheKey = `${macro}:${rounded}`;
  const cached = macroSuggestCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return res.json(cached.data);
  const macroNames = { protein: 'protein', fat: 'fat', carb: 'carbohydrates', fiber: 'fiber' };
  try {
    const system = `You suggest simple foods to help someone hit a remaining macro target. Output STRICT JSON only:
{"suggestions":[{"name":"<food>","kcal":<number>,"protein":<g>,"fat":<g>,"carb":<g>,"fiber":<g>,"note":"<one sentence why>"}]}
Return exactly 3. Practical, common in Australia. Mix: one single food, one combo, one that slightly overshoots. Output ONLY the JSON.`;
    const data = await aiJson('macro-suggest', system, `User needs roughly ${rounded}g more ${macroNames[macro] || macro} today. Suggest 3 practical foods/combos.`, 8000);
    macroSuggestCache.set(cacheKey, { ts: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- /api/gap-suggest ----------
const gapSuggestCache = new Map();

app.post('/api/gap-suggest', async (req, res) => {
  if (!openai) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
  const { remaining, behind } = req.body || {};
  if (!remaining || !behind || !behind.length) return res.status(400).json({ error: 'remaining and behind required' });
  const rem = {
    kcal: Math.round((remaining.kcal || 0) / 50) * 50,
    protein: Math.round((remaining.protein || 0) / 5) * 5,
    fat: Math.round((remaining.fat || 0) / 5) * 5,
    carb: Math.round((remaining.carb || 0) / 10) * 10,
    fiber: Math.round((remaining.fiber || 0) / 2) * 2
  };
  const cacheKey = JSON.stringify({ rem, behind: [...behind].sort() });
  const cached = gapSuggestCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 10 * 60 * 1000) return res.json(cached.data);
  try {
    const system = `You suggest practical foods to close macro gaps for someone tracking calories. Output STRICT JSON only:
{"suggestions":[{"name":"<food description>","kcal":<number>,"protein":<g>,"fat":<g>,"carb":<g>,"fiber":<g>}]}
Return exactly 3. Each must fit within the kcal budget (no more than 10% over). Prioritise foods that close MULTIPLE gaps. Common in Australia, simple to prepare. Output ONLY the JSON.`;
    const behindDesc = behind.map(m => {
      const n = { protein: 'protein', fat: 'fat', carb: 'carbs', fiber: 'fiber' };
      return `${n[m] || m}: ~${remaining[m] !== undefined ? Math.round(remaining[m]) : '?'}g needed`;
    }).join(', ');
    const data = await aiJson('gap-suggest', system, `User has ${rem.kcal} kcal left today. Key gaps: ${behindDesc}. Suggest 3 practical foods/combos that help close these gaps.`, 5000);
    gapSuggestCache.set(cacheKey, { ts: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- /api/custom-foods ----------
function normalizeFoodName(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function customLookup(customs, name) {
  return customs[normalizeFoodName(name)] || null;
}

app.get('/api/custom-foods', (req, res) => {
  res.json(readJson(req.dataFiles.custom_foods, {}));
});

app.post('/api/custom-foods', (req, res) => {
  const { name, kcal, protein, fat, carb, fiber } = req.body || {};
  if (!name || kcal == null) return res.status(400).json({ error: 'name and kcal required' });
  const customs = readJson(req.dataFiles.custom_foods, {});
  const key = normalizeFoodName(name);
  customs[key] = {
    name: String(name).trim(),
    kcal: Math.round(Number(kcal)),
    protein: Math.round((Number(protein) || 0) * 10) / 10,
    fat: Math.round((Number(fat) || 0) * 10) / 10,
    carb: Math.round((Number(carb) || 0) * 10) / 10,
    fiber: Math.round((Number(fiber) || 0) * 10) / 10,
    updated: todayStr()
  };
  writeJson(req.dataFiles.custom_foods, customs);
  res.json(customs[key]);
});

app.patch('/api/custom-foods/:key', (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const { kcal, protein, fat, carb, fiber } = req.body || {};
  const customs = readJson(req.dataFiles.custom_foods, {});
  if (!customs[key]) return res.status(404).json({ error: 'not found' });
  if (kcal != null) customs[key].kcal = Math.round(Number(kcal));
  if (protein != null) customs[key].protein = Math.round((Number(protein) || 0) * 10) / 10;
  if (fat != null) customs[key].fat = Math.round((Number(fat) || 0) * 10) / 10;
  if (carb != null) customs[key].carb = Math.round((Number(carb) || 0) * 10) / 10;
  if (fiber != null) customs[key].fiber = Math.round((Number(fiber) || 0) * 10) / 10;
  customs[key].updated = todayStr();
  writeJson(req.dataFiles.custom_foods, customs);
  res.json(customs[key]);
});

app.delete('/api/custom-foods/:key', (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const customs = readJson(req.dataFiles.custom_foods, {});
  delete customs[key];
  writeJson(req.dataFiles.custom_foods, customs);
  res.json({ ok: true });
});

// ---------- /api/export/csv ----------
app.get('/api/export/csv', (req, res) => {
  const log = readJson(req.dataFiles.log, {});
  const rows = ['date,time,name,kcal,protein_g,fat_g,carb_g,fiber_g,source'];
  for (const [date, entries] of Object.entries(log).sort()) {
    for (const e of entries) {
      const t = e.time ? new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const name = `"${(e.name || '').replace(/"/g, '""')}"`;
      rows.push([date, t, name, e.kcal || 0, e.protein || 0, e.fat || 0, e.carb || 0, e.fiber || 0, e.source || ''].join(','));
    }
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="calorie-log.csv"');
  res.send(rows.join('\n'));
});

// ---------- Backup / Restore ----------
const BACKUP_KEYS = ['log', 'profile', 'weight', 'templates', 'water', 'custom_foods'];

app.get('/api/export/json', (req, res) => {
  const bundle = { exported_at: new Date().toISOString(), user_id: req.userId };
  for (const k of BACKUP_KEYS) {
    bundle[k] = readJson(req.dataFiles[k], null);
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="calories-backup-${todayStr()}.json"`);
  res.send(JSON.stringify(bundle, null, 2));
});

app.post('/api/import', (req, res) => {
  const body = req.body || {};
  const mode = body.mode || 'replace'; // 'replace' | 'merge'
  let written = [];
  for (const k of BACKUP_KEYS) {
    const incoming = body[k];
    if (incoming === undefined || incoming === null) continue;
    if (mode === 'merge' && k === 'log') {
      // merge log: combine date-keyed entries (existing + incoming), dedupe by id
      const existing = readJson(req.dataFiles.log, {});
      for (const [date, entries] of Object.entries(incoming)) {
        if (!existing[date]) existing[date] = [];
        const seen = new Set(existing[date].map(e => e.id));
        for (const e of entries) if (!seen.has(e.id)) existing[date].push(e);
      }
      writeJson(req.dataFiles.log, existing);
    } else if (mode === 'merge' && k === 'weight') {
      const existing = readJson(req.dataFiles.weight, []);
      const byDate = {};
      for (const w of existing) byDate[w.date] = w;
      for (const w of incoming) byDate[w.date] = w; // incoming overrides for same date
      const merged = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
      writeJson(req.dataFiles.weight, merged);
    } else if (mode === 'merge' && (k === 'templates' || k === 'custom_foods')) {
      const existing = readJson(req.dataFiles[k], k === 'templates' ? [] : {});
      if (Array.isArray(existing) && Array.isArray(incoming)) {
        const seen = new Set(existing.map(x => x.id));
        const combined = [...existing, ...incoming.filter(x => !seen.has(x.id))];
        writeJson(req.dataFiles[k], combined);
      } else if (typeof existing === 'object' && typeof incoming === 'object') {
        writeJson(req.dataFiles[k], { ...existing, ...incoming });
      } else {
        writeJson(req.dataFiles[k], incoming);
      }
    } else {
      // replace mode (or profile/water which are simpler — just overwrite)
      writeJson(req.dataFiles[k], incoming);
    }
    written.push(k);
  }
  res.json({ written, mode });
});

// ---------- Food data sources ----------

// 1. Open Food Facts (uses v2 search API — more reliable than legacy cgi/search.pl)
async function offSearch(name) {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(name)}&fields=code,product_name,product_name_en,brands,serving_quantity,nutriments&page_size=5`;
    const r = await fetch(url, { timeout: 5000, headers: { 'User-Agent': 'CalorieTracker/1.0 (personal use)' } });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) return null; // OFF sometimes returns HTML maintenance pages
    const j = await r.json();
    if (!j.products || !j.products.length) return null;
    // Pick the first product with usable energy data
    for (const p of j.products) {
      const n = p.nutriments || {};
      const kcal100 = n['energy-kcal_100g'] || (n['energy_100g'] ? n['energy_100g'] / 4.184 : null);
      if (!kcal100) continue;
      return {
        name: p.product_name || p.product_name_en || name,
        brand: p.brands || null,
        serving_g: p.serving_quantity ? Number(p.serving_quantity) : 100,
        kcal_per_serving: p.serving_quantity ? Math.round(kcal100 * Number(p.serving_quantity) / 100) : Math.round(kcal100),
        protein_per_serving: p.serving_quantity ? Math.round(((n.proteins_100g || 0) * Number(p.serving_quantity) / 100) * 10) / 10 : Math.round((n.proteins_100g || 0) * 10) / 10,
        kcal_100g: Math.round(kcal100),
        protein_100g: Math.round((n.proteins_100g || 0) * 10) / 10,
        source: 'openfoodfacts',
        barcode: p.code || null
      };
    }
    return null;
  } catch (e) {
    // OFF endpoint is flaky — fail silent, lookup chain continues to next source
    return null;
  }
}

async function offBarcode(barcode) {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`, { timeout: 5000 });
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const p = j.product;
    const n = p.nutriments || {};
    const kcal100 = n['energy-kcal_100g'] || (n['energy_100g'] ? n['energy_100g'] / 4.184 : null);
    if (!kcal100) return null;
    return {
      name: p.product_name || p.product_name_en || barcode,
      brand: p.brands || null,
      serving_g: p.serving_quantity ? Number(p.serving_quantity) : 100,
      kcal_per_serving: p.serving_quantity ? Math.round(kcal100 * Number(p.serving_quantity) / 100) : Math.round(kcal100),
      protein_per_serving: p.serving_quantity ? Math.round(((n.proteins_100g || 0) * Number(p.serving_quantity) / 100) * 10) / 10 : Math.round((n.proteins_100g || 0) * 10) / 10,
      kcal_100g: Math.round(kcal100),
      protein_100g: Math.round((n.proteins_100g || 0) * 10) / 10,
      source: 'openfoodfacts',
      barcode: p.code || barcode
    };
  } catch (e) {
    console.error('OFF barcode error:', e.message);
    return null;
  }
}

// 2. FatSecret (OAuth 2.0 client credentials)
let _fsToken = null;
let _fsTokenExp = 0;

async function fsToken() {
  if (!process.env.FATSECRET_CLIENT_ID || !process.env.FATSECRET_CLIENT_SECRET) return null;
  if (_fsToken && Date.now() < _fsTokenExp) return _fsToken;
  try {
    const auth = Buffer.from(`${process.env.FATSECRET_CLIENT_ID}:${process.env.FATSECRET_CLIENT_SECRET}`).toString('base64');
    const r = await fetch('https://oauth.fatsecret.com/connect/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials&scope=basic'
    });
    const j = await r.json();
    if (!j.access_token) return null;
    _fsToken = j.access_token;
    _fsTokenExp = Date.now() + (j.expires_in - 60) * 1000;
    return _fsToken;
  } catch (e) {
    console.error('FatSecret auth error:', e.message);
    return null;
  }
}

function parseFsServingDescription(desc) {
  // "Per 100g - Calories: 165kcal | Fat: 3.57g | Carbs: 0g | Protein: 31g"
  // "Per 1 muffin - Calories: 400kcal | ..."
  // "Per 1 serving (85g) - Calories: 340kcal | ..."
  if (!desc) return null;
  const kcal = desc.match(/Calories:\s*([\d.]+)\s*kcal/i);
  const protein = desc.match(/Protein:\s*([\d.]+)\s*g/i);
  if (!kcal) return null;
  const kcalVal = Number(kcal[1]);
  const proteinVal = protein ? Number(protein[1]) : 0;
  const fatMatch = desc.match(/Fat:\s*([\d.]+)\s*g/i);
  const carbMatch = desc.match(/Carbs:\s*([\d.]+)\s*g/i);
  const fatVal = fatMatch ? Number(fatMatch[1]) : 0;
  const carbVal = carbMatch ? Number(carbMatch[1]) : 0;

  const isPer100g = /per\s+100\s*g/i.test(desc);
  const servingGramsMatch = desc.match(/per\s+[^-]+\((\d+)\s*g\)/i);
  const servingGrams = servingGramsMatch ? Number(servingGramsMatch[1]) : null;

  if (isPer100g) {
    return { kcal: kcalVal, protein: proteinVal, fat: fatVal, carb: carbVal, per100g: true };
  } else if (servingGrams) {
    return {
      kcal: Math.round(kcalVal * 100 / servingGrams),
      protein: Math.round(proteinVal * 100 / servingGrams * 10) / 10,
      fat: Math.round(fatVal * 100 / servingGrams * 10) / 10,
      carb: Math.round(carbVal * 100 / servingGrams * 10) / 10,
      per100g: true
    };
  } else {
    return { kcal: kcalVal, protein: proteinVal, fat: fatVal, carb: carbVal, per100g: false };
  }
}

async function fsSearch(name) {
  const token = await fsToken();
  if (!token) return null;
  try {
    const url = `https://platform.fatsecret.com/rest/server.api?method=foods.search&search_expression=${encodeURIComponent(name)}&format=json&max_results=5`;
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` }, timeout: 5000 });
    const j = await r.json();
    const foods = j.foods && j.foods.food;
    if (!foods) return null;
    const list = Array.isArray(foods) ? foods : [foods];
    for (const f of list) {
      const parsed = parseFsServingDescription(f.food_description);
      if (!parsed) continue;
      // Sanity: >900 kcal/100g is impossible (pure fat ~900). >2000 per-serving = bad data.
      if (parsed.per100g && parsed.kcal > 900) continue;
      if (!parsed.per100g && parsed.kcal > 2000) continue;
      return {
        name: f.food_name,
        brand: f.brand_name || null,
        serving_g: parsed.per100g ? 100 : null,
        kcal_per_serving: Math.round(parsed.kcal),
        protein_per_serving: Math.round(parsed.protein * 10) / 10,
        fat_per_serving: Math.round((parsed.fat || 0) * 10) / 10,
        carb_per_serving: Math.round((parsed.carb || 0) * 10) / 10,
        kcal_100g: parsed.per100g ? Math.round(parsed.kcal) : null,
        protein_100g: parsed.per100g ? Math.round(parsed.protein * 10) / 10 : null,
        fat_100g: parsed.per100g ? Math.round((parsed.fat || 0) * 10) / 10 : null,
        carb_100g: parsed.per100g ? Math.round((parsed.carb || 0) * 10) / 10 : null,
        source: 'fatsecret',
        food_id: f.food_id
      };
    }
    return null;
  } catch (e) {
    console.error('FatSecret search error:', e.message);
    return null;
  }
}

// 3. USDA FoodData Central
async function usdaSearch(name) {
  if (!process.env.USDA_API_KEY) return null;
  try {
    // Filter to lab-quality data only — Branded foods are vendor-submitted noise (e.g. "Potato patty")
    // USDA's dataType param expects multiple separate query keys, not comma-joined
    const dataTypeParams = ['Foundation', 'SR Legacy', 'Survey (FNDDS)']
      .map(t => `dataType=${encodeURIComponent(t)}`).join('&');
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(name)}&${dataTypeParams}&pageSize=10&api_key=${process.env.USDA_API_KEY}`;
    const r = await fetch(url, { timeout: 6000 });
    const j = await r.json();
    if (!j.foods || !j.foods.length) return null;

    // Score candidates: prefer Foundation > SR Legacy > Survey, prefer raw/plain, demote processed variants
    const dataTypeBonus = { 'Foundation': 40, 'SR Legacy': 25, 'Survey (FNDDS)': 15 };
    const bad  = /\b(patty|patties|breaded|battered|fried|nuggets?|fingers?|wings?|tenders?|sticks?|sausage|bacon|cured|smoked|canned\s+with|in\s+oil|frozen\s+meals?|with\s+sauce|with\s+gravy|stuffed|skin)\b/i;
    const good = /\b(raw|uncooked|plain|whole|fresh|skinless|boneless|meat\s+only)\b/i;
    const queryWords = name.toLowerCase().split(/\s+/).filter(w => w.length >= 3);

    const scored = j.foods.map(f => {
      let score = dataTypeBonus[f.dataType] || 0;
      const desc = (f.description || '').toLowerCase();
      score += queryWords.filter(w => desc.includes(w)).length * 8;
      if (bad.test(desc))  score -= 35;
      if (good.test(desc)) score += 12;
      return { f, score };
    }).sort((a, b) => b.score - a.score);
    const f = scored[0].f;
    const nut = (id) => {
      const found = (f.foodNutrients || []).find(n => n.nutrientId === id || n.nutrientNumber === String(id));
      return found ? Number(found.value) : 0;
    };
    const kcal100 = nut(1008);   // Energy kcal
    const protein100 = nut(1003); // Protein g
    const fat100 = nut(1004);     // Total fat g
    const carb100 = nut(1005);    // Carbohydrate g
    const fiber100 = nut(1079);   // Dietary fiber g
    if (!kcal100) return null;
    return {
      name: f.description,
      brand: f.brandOwner || null,
      serving_g: 100,
      kcal_per_serving: Math.round(kcal100),
      protein_per_serving: Math.round(protein100 * 10) / 10,
      kcal_100g: Math.round(kcal100),
      protein_100g: Math.round(protein100 * 10) / 10,
      fat_100g: Math.round(fat100 * 10) / 10,
      carb_100g: Math.round(carb100 * 10) / 10,
      fiber_100g: Math.round(fiber100 * 10) / 10,
      source: 'usda',
      fdc_id: f.fdcId
    };
  } catch (e) {
    console.error('USDA error:', e.message);
    return null;
  }
}

// Relevance check: does the DB result actually refer to the food we searched for?
function isRelevantMatch(searchName, dbName) {
  if (!dbName) return false;
  // Generic words that appear in many food names — not useful for matching
  const stop = new Set(['and','or','the','a','an','with','in','of','per','for','to','from',
    'slice','piece','serving','raw','cooked','plain','whole','half','cup','tbsp','tsp',
    'large','small','medium','fresh','dried','frozen','canned','diced','chopped',
    'classic','original','regular','style','brand','homestyle','homemade']);
  const words = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !stop.has(w));
  const sw = words(searchName);
  const dw = words(dbName);
  if (!sw.length || !dw.length) return true; // can't tell — give benefit of doubt
  for (const a of sw) for (const b of dw) {
    if (a === b || a.includes(b) || b.includes(a)) return true;
  }
  return false;
}

// offSearch, fsSearch kept for future barcode use — not called from typed-meal flow

// ---------- /api/barcode/:code ----------
app.get('/api/barcode/:code', async (req, res) => {
  const result = await offBarcode(req.params.code);
  if (!result) return res.status(404).json({ error: 'not found' });
  res.json(result);
});

// ---------- /api/search ----------
app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ results: [] });
  const [off, fs, usda] = await Promise.all([offSearch(q), fsSearch(q), usdaSearch(q)]);
  res.json({ results: [off, fs, usda].filter(Boolean) });
});

// ---------- /api/parse ----------
const PARSE_SYSTEM = `You parse casually-typed meal descriptions into structured food items and estimate nutrition. The user is Australian.

SPLITTING RULE: If the input contains multiple distinct foods, split them into separate items. "eggs and toast" → 2 items. "steak with chips and salad" → 3 items. "coffee with milk" → 1 item (coffee is the base, milk is part of it).

QUANTITY RULE: When a gram weight is explicitly stated (even in parentheses), ALWAYS use it as the qty/unit. "2 steaks (350g)" → qty:350, unit:g. "3 eggs (180g)" → qty:180, unit:g. Only use piece/slice when NO gram weight is given at all.

Return STRICT JSON only:
{"items":[{
  "name": "<clean display name — no store names>",
  "search_name": "<generic database-friendly name, stripped of all brand/store names, e.g. 'chicken breast', 'greek yogurt', 'instant noodles', 'white rice'>",
  "qty": <number>,
  "unit": "<g|ml|piece|slice|cup|tbsp|can>",
  "category": "<whole-food|chain|branded|generic|home-cooked>",
  "kcal_total": <kcal for the FULL qty>,
  "kcal_low": <realistic low end for full qty>,
  "kcal_high": <realistic high end for full qty>,
  "protein_g": <protein grams for FULL qty>,
  "fat_g": <fat grams for FULL qty>,
  "carb_g": <carb grams for FULL qty>,
  "fiber_g": <fiber grams for FULL qty>,
  "confidence": "<high|medium|low>",
  "reasoning": "<one short sentence explaining your estimate>"
}],
"suggested_extras": ["<short description like '1 tbsp olive oil' or 'butter on bread'>"]}

CATEGORY rules:
- whole-food: raw ingredients with well-known nutrition (chicken breast, oats, eggs, broccoli, rice, banana). Confidence usually HIGH.
- chain: identifiable restaurant chain item (Domino's pizza, KFC zinger, Maccas big mac, Subway footlong, Hungry Jack's whopper, Guzman burrito, Nando's chicken). Use published AU chain nutrition if you know it precisely. Confidence HIGH if known, MEDIUM if approximate.
- branded: packaged product with known nutrition (Mountain Dew can, Tim Tam, Vegemite, Weet-Bix, Up&Go, Shapes, Milo, Bundaberg). Confidence HIGH for well-known SKUs.
- generic: nonspecific prepared food where size/recipe varies a lot (a muffin, a sandwich, pasta, stir fry, curry). Confidence LOW — these vary 2x easily. Give a WIDE range.
- home-cooked: user's own recipe or family dish ("mum's lasagna", "my usual brekky"). Confidence MEDIUM. Wide range.

HONESTY rules:
- If uncertain, use LOW confidence with a wide range. NEVER invent a confident number when unsure.
- For chain items: only use HIGH confidence if you know the exact published AU nutrition. Otherwise MEDIUM.
- For generic items: default to LOW confidence regardless.

NAME rules:
- Strip supermarket/store names (Woolies, Woolworths, Coles, IGA, ALDI, Costco) from display name — they say WHERE, not WHAT.
  "Woolies extra tasty cheese slice" → name: "extra tasty cheese slice", search_name: "cheddar cheese slice"
  "Coles brand yoghurt" → name: "plain yoghurt", search_name: "plain yogurt"
- Keep brand names that ARE the product: Four'N Twenty, Vegemite, Weet-Bix, Tim Tam, Shapes, Milo, Up&Go, Bega, Bundaberg.
- search_name should always be the most generic searchable version: "Coles free range eggs" → search_name: "eggs". "Heinz tomato soup can" → search_name: "tomato soup". "ALDI frozen stir fry vegetables" → search_name: "stir fry vegetables".
- Translate Aussie slang: chook→chicken, snags→sausages, bikkie→biscuit, avo→avocado, brekky→breakfast, servo pie→meat pie, flat white→flat white coffee, rissole→beef rissole.

SUGGESTED EXTRAS rules:
- Return 1–3 extras that are commonly added to THIS specific meal but NOT already mentioned by the user.
- Think: cooking fat (oil, butter), condiments, sauces, toppings, sides typically eaten together.
- Each extra must be a short, actionable string like "1 tbsp olive oil", "butter on toast", "tomato sauce", "soy sauce marinade".
- Only suggest things that add meaningful calories (>20 kcal). Skip salt, herbs, spices.
- If nothing sensible to suggest, return an empty array [].

Output ONLY the JSON object. No markdown fences, no explanation.`;

const VERIFY_SYSTEM = `You are an Australian nutrition fact-checker. You are given food items with their current calorie and macro values (from database lookup or AI estimate). Your job: verify each item looks nutritionally plausible for an Australian diet.

Return STRICT JSON only:
{"items":[{"ok":true}]}
or for corrections:
{"items":[{"ok":false,"kcal":X,"protein":X,"fat":X,"carb":X,"fiber":X,"note":"<one short reason>"}]}

RULES:
- Approve (ok:true) if values are within 30% of what you'd expect for this food. When in doubt, approve.
- Correct (ok:false) only if values are clearly wrong: wrong food matched by database, impossible macros, fat wildly high for a lean cut, etc.
- Never correct custom foods or chain items with published nutrition.
- Output exactly one entry per item in order. No extra fields.

Output ONLY the JSON object. No markdown fences.`;

app.post('/api/parse', async (req, res) => {
  if (!openai) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
  const text = (req.body && req.body.text) || '';
  if (!text.trim()) return res.status(400).json({ error: 'text required' });

  try {
    let parsed;
    try {
      parsed = await aiJson('parse', PARSE_SYSTEM, text, 8000);
    } catch (e) {
      return res.status(502).json({ error: 'AI parse failed: ' + e.message });
    }

    // Load user's custom foods once for this request
    const customs = readJson(req.dataFiles.custom_foods, {});

    const resolved = await Promise.all((parsed.items || []).map(async (item) => {
      const category = item.category || 'generic';
      let finalKcal = Math.round(item.kcal_total || 0);
      let finalProtein = Math.round((item.protein_g || 0) * 10) / 10;
      let finalFat = Math.round((item.fat_g || 0) * 10) / 10;
      let finalCarb = Math.round((item.carb_g || 0) * 10) / 10;
      let finalFiber = Math.round((item.fiber_g || 0) * 10) / 10;
      let source = 'ai-estimate';
      let confidence = item.confidence || 'medium';
      let usda = null;
      let flagged = null;

      // 1. Custom foods first — user-verified, always wins
      const custom = customLookup(customs, item.name);
      if (custom) {
        finalKcal = Math.round(custom.kcal * (item.qty || 1));
        finalProtein = Math.round(custom.protein * (item.qty || 1) * 10) / 10;
        finalFat = Math.round((custom.fat || 0) * (item.qty || 1) * 10) / 10;
        finalCarb = Math.round((custom.carb || 0) * (item.qty || 1) * 10) / 10;
        finalFiber = Math.round((custom.fiber || 0) * (item.qty || 1) * 10) / 10;
        source = 'custom';
        confidence = 'high';
      } else {
        // 2. USDA (gram items only — has fiber, lab-quality) + FatSecret (all units) in parallel
        const isGram = item.unit === 'g' || item.unit === 'ml';
        const aiLow = item.kcal_low || finalKcal * 0.6;
        const aiHigh = item.kcal_high || finalKcal * 1.4;

        // USDA is only reliable for whole foods — branded items get wrong matches (e.g. "Emu, full rump" for beef steak)
        const tryUsda = isGram && category === 'whole-food';
        // Use search_name (generic, brand-stripped) for better DB hit rates
        const dbQuery = item.search_name || item.name;

        const [usdaResult, fsResult] = await Promise.all([
          tryUsda ? usdaSearch(dbQuery).catch(() => null) : Promise.resolve(null),
          fsSearch(dbQuery).catch(() => null)
        ]);

        // USDA branch: whole-food gram items, full macros including fiber
        if (usdaResult && isRelevantMatch(item.name, usdaResult.name)) {
          const usdaTotal = Math.round(usdaResult.kcal_100g * item.qty / 100);
          const usdaProtein = Math.round(usdaResult.protein_100g * item.qty / 100 * 10) / 10;
          const usdaFat = Math.round((usdaResult.fat_100g || 0) * item.qty / 100 * 10) / 10;
          const usdaCarb = Math.round((usdaResult.carb_100g || 0) * item.qty / 100 * 10) / 10;
          const usdaFiber = Math.round((usdaResult.fiber_100g || 0) * item.qty / 100 * 10) / 10;
          usda = { name: usdaResult.name, kcal_100g: usdaResult.kcal_100g, protein_100g: usdaResult.protein_100g, fat_100g: usdaResult.fat_100g, carb_100g: usdaResult.carb_100g, fiber_100g: usdaResult.fiber_100g, total: usdaTotal };
          const inRange = usdaTotal >= aiLow * 0.5 && usdaTotal <= aiHigh * 1.5;
          if (inRange) {
            usda.status = 'confirmed';
            finalKcal = usdaTotal; finalProtein = usdaProtein;
            finalFat = usdaFat; finalCarb = usdaCarb; finalFiber = usdaFiber;
            source = 'usda+ai'; confidence = 'high';
          } else if (category === 'whole-food') {
            // On conflict, trust USDA lab data for whole foods
            usda.status = 'conflict';
            finalKcal = usdaTotal; finalProtein = usdaProtein;
            finalFat = usdaFat; finalCarb = usdaCarb; finalFiber = usdaFiber;
            source = 'usda'; confidence = 'high';
          } else {
            // On conflict for branded/generic, USDA probably found wrong food — fall through to FatSecret
            usda.status = 'conflict';
          }
        }

        // FatSecret branch: runs if USDA didn't resolve (or wasn't tried for non-gram items)
        if (source === 'ai-estimate' && fsResult && isRelevantMatch(item.name, fsResult.name)) {
          let fsKcal, fsProtein, fsFat, fsCarb;
          if (isGram && fsResult.kcal_100g) {
            // per-100g scaling
            fsKcal    = Math.round(fsResult.kcal_100g * item.qty / 100);
            fsProtein = Math.round((fsResult.protein_100g || 0) * item.qty / 100 * 10) / 10;
            fsFat     = Math.round((fsResult.fat_100g || 0) * item.qty / 100 * 10) / 10;
            fsCarb    = Math.round((fsResult.carb_100g || 0) * item.qty / 100 * 10) / 10;
          } else if (!isGram && !fsResult.serving_g) {
            // per-serving × qty (piece/slice/cup units)
            fsKcal    = Math.round(fsResult.kcal_per_serving * item.qty);
            fsProtein = Math.round((fsResult.protein_per_serving || 0) * item.qty * 10) / 10;
            fsFat     = Math.round((fsResult.fat_per_serving || 0) * item.qty * 10) / 10;
            fsCarb    = Math.round((fsResult.carb_per_serving || 0) * item.qty * 10) / 10;
          }
          if (fsKcal && fsKcal > 0) {
            finalKcal = fsKcal; finalProtein = fsProtein;
            finalFat = fsFat; finalCarb = fsCarb;
            // fiber stays as AI estimate — FatSecret basic search doesn't provide it
            const inRange = fsKcal >= aiLow * 0.5 && fsKcal <= aiHigh * 1.5;
            source = 'fatsecret';
            confidence = inRange ? 'high' : 'medium';
          }
        }
      }

      // 3. Sanity caps
      if ((item.unit === 'g' || item.unit === 'ml') && item.qty > 0) {
        const per100 = finalKcal / item.qty * 100;
        if (per100 > 900) {
          // Physically impossible — fall back to AI range midpoint
          finalKcal = Math.round(((item.kcal_low || 0) + (item.kcal_high || item.kcal_total || 0)) / 2);
          source = 'ai-estimate';
          flagged = 'sanity-cap';
        }
      }
      if (item.qty > 0 && finalKcal / item.qty > 1500) {
        flagged = flagged || 'high-kcal';
      }
      // Protein cap: protein can't exceed 0.45× kcal (pure protein = 4 kcal/g)
      if (finalKcal > 0 && finalProtein > finalKcal * 0.45) {
        finalProtein = Math.round(finalKcal * 0.25 * 10) / 10;
        flagged = flagged || 'protein-capped';
      }

      return {
        item: { name: item.name, qty: item.qty, unit: item.unit, kcal: finalKcal, protein: finalProtein, fat: finalFat, carb: finalCarb, fiber: finalFiber, source, confidence },
        trace: {
          name: item.name, qty: item.qty, unit: item.unit,
          category,
          confidence,
          reasoning: item.reasoning || '',
          ai_kcal_total: Math.round(item.kcal_total || 0),
          ai_kcal_low: Math.round(item.kcal_low || 0),
          ai_kcal_high: Math.round(item.kcal_high || 0),
          ai_protein: Math.round((item.protein_g || 0) * 10) / 10,
          ai_fat: Math.round((item.fat_g || 0) * 10) / 10,
          ai_carb: Math.round((item.carb_g || 0) * 10) / 10,
          ai_fiber: Math.round((item.fiber_g || 0) * 10) / 10,
          usda,
          source,
          final_kcal: finalKcal,
          final_protein: finalProtein,
          final_fat: finalFat,
          final_carb: finalCarb,
          final_fiber: finalFiber,
          flagged
        }
      };
    }));

    let items = resolved.map(r => r.item);
    const trace = resolved.map(r => r.trace);

    // Verification pass: AI reviews DB-sourced items only — pure AI estimates are already the AI's best guess
    // and re-asking just introduces noise. Only verify fatsecret/usda results to catch bad DB matches.
    const verifyTargets = items.map((it, i) => ({ i, it })).filter(({ it }) =>
      it.source === 'fatsecret' || it.source === 'usda' || it.source === 'usda+ai'
    );
    if (openai && verifyTargets.length > 0) {
      try {
        const verifyPrompt = verifyTargets.map(({ it }, n) =>
          `Item ${n + 1}: "${it.name}" · ${it.qty} ${it.unit} · source: ${it.source}\n` +
          `  ${it.kcal} kcal / ${it.protein}g P / ${it.fat}g F / ${it.carb}g C / ${it.fiber}g Fib`
        ).join('\n\n');
        const vResult = await aiJson('verify', VERIFY_SYSTEM, verifyPrompt, 8000);
        const corrections = vResult.items || [];
        verifyTargets.forEach(({ i }, n) => {
          const c = corrections[n];
          if (c && c.ok === false && c.kcal) {
            items[i] = {
              ...items[i],
              kcal:    Math.round(c.kcal),
              protein: Math.round((c.protein || items[i].protein) * 10) / 10,
              fat:     Math.round((c.fat     || items[i].fat)     * 10) / 10,
              carb:    Math.round((c.carb    || items[i].carb)    * 10) / 10,
              fiber:   Math.round((c.fiber   || items[i].fiber)   * 10) / 10,
              source:  'ai-verified',
              confidence: 'high'
            };
            if (trace[i]) {
              trace[i].verify_note = c.note || '';
              trace[i].source = 'ai-verified';
              // Update trace's "Final" line to reflect post-verify values (was showing pre-verify before)
              trace[i].final_kcal    = items[i].kcal;
              trace[i].final_protein = items[i].protein;
              trace[i].final_fat     = items[i].fat;
              trace[i].final_carb    = items[i].carb;
              trace[i].final_fiber   = items[i].fiber;
            }
          }
        });
      } catch (_) { /* verification failure is non-fatal */ }
    }

    const totals = items.reduce((a, i) => ({
      kcal: a.kcal + i.kcal,
      protein: a.protein + i.protein,
      fat: Math.round((a.fat + i.fat) * 10) / 10,
      carb: Math.round((a.carb + i.carb) * 10) / 10,
      fiber: Math.round((a.fiber + i.fiber) * 10) / 10
    }), { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 });
    res.json({ items, totals, raw_text: text, trace, suggested_extras: parsed.suggested_extras || [] });
  } catch (e) {
    console.error('Parse error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- /api/recipe ----------
const RECIPE_SYSTEM = `You write recipes for someone who has never cooked before. Be patient and explicit. Output STRICT JSON only.

Format:
{
  "name": "<recipe name>",
  "total_kcal": <number>,
  "protein_g": <number>,
  "fat_g": <number>,
  "carb_g": <number>,
  "fiber_g": <number>,
  "servings": <number>,
  "time_min": <number>,
  "narrative": "<2-3 sentence plain-English story of what you'll make and why it fits the budget>",
  "ingredients": [{"item": "...", "qty": "...", "note": "<optional, e.g. 'or any leafy green'>"}],
  "tools": ["<each pan/bowl/utensil needed>"],
  "prep": ["<each prep task as its own bullet, before any cooking starts>"],
  "steps": [
    {"n": 1, "do": "<one action only>", "watch_for": "<visual cue, e.g. 'edges turn golden brown'>", "time": "<e.g. '3 min' or null>", "why": "<optional, only if non-obvious>"}
  ]
}

Hard rules:
- Every action gets its own step. "Heat pan and add oil" is TWO steps.
- Always include a "time" or "watch_for" so the user knows when to move on.
- Define any tool the first time it appears in steps ("a spatula — the flat flexible thing").
- Round kcal to nearest 10. Hit the calorie budget within ±15%.
- Output ONLY the JSON object. No markdown fences, no explanation outside JSON.`;

app.post('/api/recipe', async (req, res) => {
  if (!openai) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
  const { ingredients, kcal_budget, protein_target, mood } = req.body || {};
  const userPrompt = `I want a recipe.
Ingredients I have: ${ingredients || 'whatever is normal'}.
Calorie budget: around ${kcal_budget || 600} kcal.
Protein target: at least ${protein_target || 30}g.
Mood / preference: ${mood || 'simple and quick'}.

Write the recipe as JSON.`;

  try {
    const recipe = await aiJson('recipe', RECIPE_SYSTEM, userPrompt, 16000);
    res.json(recipe);
  } catch (e) {
    console.error('Recipe error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- /api/recipe-ideas ----------
const RECIPE_IDEAS_SYSTEM = `You suggest 3 quick recipe IDEAS (not full recipes). Output STRICT JSON only:
{"ideas":[{"name":"<short, 5 words max>","emoji":"<one food emoji>","kcal":<number>,"protein_g":<number>,"time_min":<number>,"summary":"<one sentence what it is>","uses":["<ingredient 1>","<ingredient 2>"]}]}
- Each idea uses primarily the ingredients listed by the user.
- Match the requested effort and time band.
- Stay near the calorie budget (within ±15%).
- Pick varied styles (e.g. one bowl, one wrap/sandwich, one stir-fry) — not three of the same.
- Output ONLY the JSON, no prose.`;

app.post('/api/recipe-ideas', async (req, res) => {
  if (!openai) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
  const { ingredients, kcal_budget, protein_target, effort, mood } = req.body || {};
  const effortMap = {
    low: 'low effort, under 10 minutes, one pan or no cooking',
    medium: 'medium effort, 10-20 minutes, a few steps',
    high: 'proper meal, 30+ minutes, multiple components'
  };
  const effortDesc = effortMap[effort] || effortMap.medium;
  const userPrompt = `Suggest 3 different recipe ideas.
Ingredients I have: ${ingredients || 'standard kitchen staples'}.
Calorie budget: around ${kcal_budget || 600} kcal.
Protein target: at least ${protein_target || 30}g.
Effort: ${effortDesc}.
${mood ? `Vibe: ${mood}.` : ''}

Return JSON with 3 ideas.`;
  try {
    const data = await aiJson('recipe-ideas', RECIPE_IDEAS_SYSTEM, userPrompt, 4000);
    res.json(data);
  } catch (e) {
    console.error('Recipe ideas error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- /api/snack ----------
const SNACK_SYSTEM = `You suggest 3 snack ideas for someone tracking calories. Output STRICT JSON only:
{"snacks":[{"name":"...","kcal":<number>,"protein_g":<number>,"fat_g":<number>,"carb_g":<number>,"fiber_g":<number>,"why":"<one short sentence on why it's a good pick>"}]}
- Each snack must be under the user's kcal cap.
- Mix high-protein options with at least one easy/no-prep option.
- Output ONLY the JSON.`;

app.post('/api/snack', async (req, res) => {
  if (!openai) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
  const cap = (req.body && req.body.kcal_cap) || 200;
  try {
    const data = await aiJson('snack', SNACK_SYSTEM, `Suggest 3 snacks under ${cap} kcal.`, 3000);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- /api/health ----------
app.get('/api/health', async (req, res) => {
  const checks = {
    openai: { configured: !!process.env.OPENAI_API_KEY, model: OPENAI_MODEL, status: 'unknown', detail: '' },
    openfoodfacts: { configured: true, status: 'unknown', detail: '' },
    fatsecret: { configured: !!(process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET), status: 'unknown', detail: '' },
    usda: { configured: !!process.env.USDA_API_KEY, status: 'unknown', detail: '' }
  };

  // OpenAI
  if (checks.openai.configured) {
    try {
      const r = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: 'Reply with the JSON {"ok":true}' }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 500
      });
      const c = r.choices[0].message.content;
      if (c && c.trim()) {
        checks.openai.status = 'ok';
        checks.openai.detail = `Model ${r.model} responded`;
      } else {
        checks.openai.status = 'warn';
        checks.openai.detail = 'Model returned empty content (try bigger token budget)';
      }
    } catch (e) {
      checks.openai.status = 'error';
      checks.openai.detail = e.message;
    }
  } else { checks.openai.status = 'missing'; checks.openai.detail = 'No OPENAI_API_KEY in .env'; }

  // OFF
  try {
    const r = await fetch('https://world.openfoodfacts.org/api/v2/product/737628064502.json', { timeout: 4000 });
    const ct = r.headers.get('content-type') || '';
    if (r.ok && ct.includes('json')) { checks.openfoodfacts.status = 'ok'; checks.openfoodfacts.detail = 'Reachable'; }
    else { checks.openfoodfacts.status = 'warn'; checks.openfoodfacts.detail = `HTTP ${r.status}`; }
  } catch (e) { checks.openfoodfacts.status = 'error'; checks.openfoodfacts.detail = e.message; }

  // FatSecret
  if (checks.fatsecret.configured) {
    try {
      const tok = await fsToken();
      if (!tok) { checks.fatsecret.status = 'error'; checks.fatsecret.detail = 'OAuth token request failed'; }
      else {
        const r = await fetch(`https://platform.fatsecret.com/rest/server.api?method=foods.search&search_expression=apple&format=json&max_results=1`, { headers: { 'Authorization': `Bearer ${tok}` }, timeout: 4000 });
        const j = await r.json();
        if (j.error) { checks.fatsecret.status = 'error'; checks.fatsecret.detail = j.error.message; }
        else { checks.fatsecret.status = 'ok'; checks.fatsecret.detail = 'Search returned results'; }
      }
    } catch (e) { checks.fatsecret.status = 'error'; checks.fatsecret.detail = e.message; }
  } else { checks.fatsecret.status = 'missing'; checks.fatsecret.detail = 'FATSECRET_CLIENT_ID / SECRET not in .env'; }

  // USDA
  if (checks.usda.configured) {
    try {
      const r = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=apple&pageSize=1&api_key=${process.env.USDA_API_KEY}`, { timeout: 4000 });
      const j = await r.json();
      if (j.error) { checks.usda.status = 'error'; checks.usda.detail = j.error.message || JSON.stringify(j.error); }
      else if (j.foods && j.foods.length) { checks.usda.status = 'ok'; checks.usda.detail = 'Search returned results'; }
      else { checks.usda.status = 'warn'; checks.usda.detail = 'No results for test query'; }
    } catch (e) { checks.usda.status = 'error'; checks.usda.detail = e.message; }
  } else { checks.usda.status = 'missing'; checks.usda.detail = 'No USDA_API_KEY in .env'; }

  res.json({ checks, public_ip: await fetchPublicIp() });
});

async function fetchPublicIp() {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { timeout: 3000 });
    const j = await r.json();
    return j.ip;
  } catch { return null; }
}

// ---------- /api/usage ----------
app.get('/api/usage', (req, res) => {
  const arr = readJson(USAGE_FILE, []);
  const today = todayStr();
  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);

  const sum = (filter) => {
    const subset = arr.filter(filter);
    return {
      calls: subset.length,
      in_tokens: subset.reduce((a, x) => a + (x.in || 0), 0),
      out_tokens: subset.reduce((a, x) => a + (x.out || 0), 0),
      reasoning_tokens: subset.reduce((a, x) => a + (x.reasoning || 0), 0),
      cost_usd: Math.round(subset.reduce((a, x) => a + (x.cost || 0), 0) * 10000) / 10000
    };
  };

  const by_endpoint = {};
  for (const x of arr) {
    if (!by_endpoint[x.endpoint]) by_endpoint[x.endpoint] = { calls: 0, cost_usd: 0 };
    by_endpoint[x.endpoint].calls++;
    by_endpoint[x.endpoint].cost_usd += (x.cost || 0);
  }
  for (const k in by_endpoint) by_endpoint[k].cost_usd = Math.round(by_endpoint[k].cost_usd * 10000) / 10000;

  res.json({
    today: sum(x => x.ts.slice(0, 10) === today),
    last_7_days: sum(x => x.ts.slice(0, 10) >= weekAgo),
    all_time: sum(() => true),
    by_endpoint,
    recent: arr.slice(-20).reverse(),
    pricing_per_1m: priceFor(OPENAI_MODEL),
    model: OPENAI_MODEL
  });
});

app.delete('/api/usage', (req, res) => {
  writeJson(USAGE_FILE, []);
  res.json({ ok: true });
});

// ---------- water ----------
app.get('/api/water', (req, res) => {
  const date = req.query.date || todayStr();
  const w = readJson(req.dataFiles.water, {});
  const entries = w[date] || [];
  res.json({ date, entries, total_ml: entries.reduce((s, e) => s + e.ml, 0) });
});

app.post('/api/water', (req, res) => {
  const date = req.body.date || todayStr();
  const ml = Number(req.body.ml) || 250;
  const w = readJson(req.dataFiles.water, {});
  if (!w[date]) w[date] = [];
  const entry = { id: crypto.randomUUID(), ml, ts: new Date().toISOString() };
  w[date].push(entry);
  writeJson(req.dataFiles.water, w);
  const entries = w[date];
  res.json({ ok: true, date, entries, total_ml: entries.reduce((s, e) => s + e.ml, 0) });
});

app.delete('/api/water/:id', (req, res) => {
  const date = req.query.date || todayStr();
  const w = readJson(req.dataFiles.water, {});
  if (w[date]) w[date] = w[date].filter(e => e.id !== req.params.id);
  writeJson(req.dataFiles.water, w);
  const entries = w[date] || [];
  res.json({ ok: true, date, entries, total_ml: entries.reduce((s, e) => s + e.ml, 0) });
});

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`Calorie tracker running at http://localhost:${PORT}`);
  console.log(`(or on your phone: http://<your-LAN-IP>:${PORT})`);
});
