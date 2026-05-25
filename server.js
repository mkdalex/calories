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
  // Serialize the trimmed-list write so concurrent AI calls don't clobber each other.
  withFileLock(USAGE_FILE, () => {
    const arr = readJson(USAGE_FILE, []);
    arr.push(entry);
    if (arr.length > 1000) arr.splice(0, arr.length - 1000);
    writeJson(USAGE_FILE, arr);
  });
  // Append-only log — can't race, can't be lost by trimming
  try {
    fs.appendFileSync(AI_LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (e) { console.warn('[AI] failed to append ai_calls.log:', e.message); }
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
const IS_PROD = process.env.NODE_ENV === 'production';
if (IS_PROD && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set in production. Generate one with:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  process.exit(1);
}
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
// Snapshot under the lock so we serialize concurrent writes. The in-memory map is
// the source of truth; the file just persists it.
function saveSessions(s) {
  return withFileLock(SESSIONS_FILE, () => {
    try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(s)); }
    catch (e) { console.warn('[sessions] write failed:', e.message); }
  });
}
const sessions = loadSessions();

function newSessionId() { return crypto.randomBytes(24).toString('hex'); }
function setSession(res, user) {
  const sid = newSessionId();
  sessions[sid] = { user, expires: Date.now() + SESSION_MS };
  saveSessions(sessions);
  res.cookie(COOKIE_NAME, sid, { signed: true, httpOnly: true, secure: IS_PROD, sameSite: 'lax', maxAge: SESSION_MS });
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

// Test-only helper. Mints a session and returns the signed cookie string suitable
// for a `Cookie:` request header. Don't call from production code paths.
function createTestSession(user) {
  const sid = newSessionId();
  sessions[sid] = { user, expires: Date.now() + SESSION_MS };
  // Match the signing format that cookie-parser expects on read.
  const signed = 's:' + require('cookie-signature').sign(sid, SESSION_SECRET);
  return `${COOKIE_NAME}=${encodeURIComponent(signed)}`;
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
    res.status(500).send('Authentication failed. Please try again.');
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
    profile:       path.join(userDir, 'profile.json'),
    log:           path.join(userDir, 'log.json'),
    weight:        path.join(userDir, 'weight.json'),
    templates:     path.join(userDir, 'templates.json'),
    custom_foods:  path.join(userDir, 'custom_foods.json'),
    water:         path.join(userDir, 'water.json'),
    loader_stats:  path.join(userDir, 'loader_stats.json')
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
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
// Per-file mutex. Read-modify-write blocks should wrap themselves in this so two
// concurrent requests for the same file don't clobber each other's update.
const fileLocks = new Map();
function withFileLock(filePath, fn) {
  const prev = fileLocks.get(filePath) || Promise.resolve();
  const next = prev.then(() => fn(), () => fn());
  const stored = next.catch(() => undefined);
  fileLocks.set(filePath, stored);
  // Clean up only if no later caller has appended to this path's chain.
  stored.finally(() => {
    if (fileLocks.get(filePath) === stored) fileLocks.delete(filePath);
  });
  return next;
}
function todayStr(req) {
  // Prefer the client's IANA timezone (e.g. "Australia/Sydney") so "today" is the
  // user's calendar day, not the server's UTC day. Falls back to server-local time.
  const tz = req && req.headers && req.headers['x-client-tz'];
  if (tz) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch (_) { /* invalid TZ — fall through */ }
  }
  return fmtDate(new Date());
}
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Round to 1 decimal place. Coerces non-numbers to 0.
function round1(x) {
  const n = Number(x) || 0;
  return Math.round(n * 10) / 10;
}
// Walk every calendar day from startD to endD inclusive (forward, +1 day per step).
// Calls fn with the local-time yyyy-mm-dd string for each day. Doesn't mutate inputs.
function forEachDateInRange(startD, endD, fn) {
  const d = new Date(startD);
  while (d <= endD) {
    fn(fmtDate(d));
    d.setDate(d.getDate() + 1);
  }
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
  // Protein: cutting needs HIGHER per-kg intake (preserve muscle in deficit), and
  // pegged to goal weight (when set) so the target doesn't drift down as you lose.
  // Maintain/gain keep the standard active-adult ratio against current weight.
  const cutting = goal.delta < 0;
  const goalKg = Number(profile.goal_weight_kg) || null;
  const proteinBasisKg = cutting && goalKg && goalKg < weight_kg ? goalKg : weight_kg;
  const proteinPerKg   = cutting ? 2.0 : 1.76;
  const protein_g = Math.round(proteinBasisKg * proteinPerKg);
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
    (cutting && goalKg && goalKg < weight_kg
      ? `Your protein target is ${protein_g}g — pegged to your goal weight (${goalKg} kg × 2.0 g/kg) so it doesn't drift down as you lose. Defending muscle during a cut.`
      : cutting
      ? `Your protein target is ${protein_g}g (2.0 g/kg of current weight) — higher ratio while cutting to preserve muscle. Set a goal weight in Profile to lock it.`
      : `Your protein target is ${protein_g}g — this protects your muscle while you change weight.`);

  return { bmr, tdee, tdee_predicted, tdee_calibrated, kcal_goal, protein_g, fat_g, carb_g, fiber_g, weight_kg, activity: act, goal_meta: goal, explainer };
}

// ---------- /api/profile ----------
app.get('/api/profile', (req, res) => {
  const profile = readJson(req.dataFiles.profile, null);
  res.json({ profile, stats: computeStats(profile), activity_options: ACTIVITY, goal_options: GOALS });
});
app.post('/api/profile', async (req, res) => {
  const profile = await withFileLock(req.dataFiles.profile, () => {
    const existing = readJson(req.dataFiles.profile, {}) || {};
    const merged = { ...existing, ...(req.body || {}) };
    writeJson(req.dataFiles.profile, merged);
    return merged;
  });
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
  let totalKcal = 0, daysLogged = 0;
  forEachDateInRange(firstD, lastD, ds => {
    const entries = log[ds] || [];
    if (entries.length) {
      totalKcal += entries.reduce((a, e) => a + (e.kcal || 0), 0);
      daysLogged += 1;
    }
  });

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
    const ds = fmtDate(d);
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
    const ds = fmtDate(d);
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
  const date = req.query.date || todayStr(req);
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
  const isToday = !req.query.date || req.query.date === todayStr(req);
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

app.post('/api/log', async (req, res) => {
  const { name, kcal, protein, fat, carb, fiber, source, items, date, time, idempotency_key } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const d = date || todayStr(req);
  const result = await withFileLock(req.dataFiles.log, () => {
    const log = readJson(req.dataFiles.log, {});
    // Idempotency: if any existing entry already carries this client-supplied key,
    // return it instead of creating a duplicate. Survives client retries after a
    // crash because the key is persisted on the entry itself.
    if (idempotency_key) {
      for (const [, entries] of Object.entries(log)) {
        for (const e of entries) {
          if (e.idempotency_key === idempotency_key) {
            return { entry: e, deduped: true };
          }
        }
      }
    }
    if (!log[d]) log[d] = [];
    const e = {
      id: newId(),
      name: String(name).slice(0, 200),
      kcal: Math.round(Number(kcal) || 0),
      protein: round1(protein),
      fat: round1(fat),
      carb: round1(carb),
      fiber: round1(fiber),
      source: source || 'manual',
      items: items || null,
      time: time || new Date().toISOString(),
      ...(idempotency_key ? { idempotency_key } : {})
    };
    log[d].push(e);
    writeJson(req.dataFiles.log, log);
    return { entry: e };
  });
  res.json(result);
});

app.patch('/api/log/:date/:id', async (req, res) => {
  const { date, id } = req.params;
  const { name, kcal, protein, fat, carb, fiber, time } = req.body || {};
  const result = await withFileLock(req.dataFiles.log, () => {
    const log = readJson(req.dataFiles.log, {});
    if (!log[date]) return { error: 'date not found', status: 404 };
    const idx = log[date].findIndex(e => e.id === id);
    if (idx < 0) return { error: 'entry not found', status: 404 };
    if (name !== undefined) log[date][idx].name = String(name).slice(0, 200);
    if (kcal !== undefined) log[date][idx].kcal = Math.round(Number(kcal) || 0);
    if (protein !== undefined) log[date][idx].protein = round1(protein);
    if (fat !== undefined) log[date][idx].fat = round1(fat);
    if (carb !== undefined) log[date][idx].carb = round1(carb);
    if (fiber !== undefined) log[date][idx].fiber = round1(fiber);
    if (time !== undefined) log[date][idx].time = time;
    writeJson(req.dataFiles.log, log);
    return { entry: log[date][idx] };
  });
  if (result.status) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.delete('/api/log/:date/:id', async (req, res) => {
  const { date, id } = req.params;
  await withFileLock(req.dataFiles.log, () => {
    const log = readJson(req.dataFiles.log, {});
    if (log[date]) {
      log[date] = log[date].filter(e => e.id !== id);
      writeJson(req.dataFiles.log, log);
    }
  });
  res.json({ ok: true });
});

// ---------- /api/weight ----------
app.get('/api/weight', (req, res) => {
  res.json(readJson(req.dataFiles.weight, []));
});
app.post('/api/weight', async (req, res) => {
  const { kg, date } = req.body || {};
  if (!kg) return res.status(400).json({ error: 'kg required' });
  const d = date || todayStr(req);
  const entry = { date: d, kg: Number(kg) };
  const isLatest = await withFileLock(req.dataFiles.weight, () => {
    const arr = readJson(req.dataFiles.weight, []);
    const existing = arr.findIndex(w => w.date === d);
    if (existing >= 0) arr[existing] = entry;
    else arr.push(entry);
    arr.sort((a, b) => a.date.localeCompare(b.date));
    writeJson(req.dataFiles.weight, arr);
    return arr[arr.length - 1].date === d;
  });
  // Only push to profile if this is the most recent weight (don't break TDEE if user backfills an old entry)
  if (isLatest) {
    await withFileLock(req.dataFiles.profile, () => {
      const profile = readJson(req.dataFiles.profile, null);
      if (profile) { profile.weight_kg = Number(kg); writeJson(req.dataFiles.profile, profile); }
    });
  }
  res.json({ entry });
});

// ---------- /api/loader-stats ----------
// Per-user rolling window of AI loader durations (ms). Used client-side to
// show "Usually ~Xs" + a calibrated progress bar that follows the user across
// devices (phone, PC, Electron) instead of starting fresh per browser.
const LOADER_STATS_MAX = 20;
function _medianOf(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
app.get('/api/loader-stats', (req, res) => {
  const stats = readJson(req.dataFiles.loader_stats, { samples: [] });
  const samples = Array.isArray(stats.samples) ? stats.samples : [];
  res.json({
    samples_count: samples.length,
    median_ms: samples.length >= 4 ? _medianOf(samples) : null
  });
});
app.post('/api/loader-stats', async (req, res) => {
  const ms = Number(req.body && req.body.duration_ms);
  // Under 300ms = probably a cached response; over 60s = broken. Either drags the median.
  if (!Number.isFinite(ms) || ms < 300 || ms > 60000) {
    return res.status(400).json({ error: 'invalid duration' });
  }
  const stats = await withFileLock(req.dataFiles.loader_stats, () => {
    const cur = readJson(req.dataFiles.loader_stats, { samples: [] });
    if (!Array.isArray(cur.samples)) cur.samples = [];
    cur.samples.push(Math.round(ms));
    while (cur.samples.length > LOADER_STATS_MAX) cur.samples.shift();
    writeJson(req.dataFiles.loader_stats, cur);
    return cur;
  });
  res.json({
    samples_count: stats.samples.length,
    median_ms: stats.samples.length >= 4 ? _medianOf(stats.samples) : null
  });
});
app.delete('/api/weight/:date', async (req, res) => {
  const { date } = req.params;
  const latestKg = await withFileLock(req.dataFiles.weight, () => {
    const arr = readJson(req.dataFiles.weight, []);
    const filtered = arr.filter(w => w.date !== date);
    writeJson(req.dataFiles.weight, filtered);
    return filtered.length ? Number(filtered[filtered.length - 1].kg) : null;
  });
  if (latestKg !== null) {
    await withFileLock(req.dataFiles.profile, () => {
      const profile = readJson(req.dataFiles.profile, null);
      if (profile) { profile.weight_kg = latestKg; writeJson(req.dataFiles.profile, profile); }
    });
  }
  res.json({ ok: true });
});

// ---------- /api/favorites ----------
// Per-user cache keyed by mtime of the log file: recompute only when the log actually changes.
// The full-log scan is O(entries) per call; with a year of history this is ~thousands of items.
const favoritesCache = new Map(); // userId -> { mtimeMs, favs }
const FAV_MACROS = ['kcal', 'protein', 'fat', 'carb', 'fiber'];
function computeFavorites(log) {
  const counts = {};
  // Iterate dates oldest-first so `c.last` ends up holding the newest entry.
  for (const [date, entries] of Object.entries(log).sort()) {
    for (const e of entries) {
      if (!e.name) continue;
      const key = e.name.trim().toLowerCase();
      const c = counts[key] ??= { name: e.name, count: 0, sums: { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 }, last: e, last_date: date };
      c.count++;
      for (const m of FAV_MACROS) c.sums[m] += e[m] || 0;
      c.last = e;
      c.last_date = date;
    }
  }
  return Object.values(counts)
    .sort((a, b) => b.count - a.count)
    .map(f => ({
      name: f.name,
      count: f.count,
      kcal: Math.round(f.sums.kcal / f.count),
      protein: round1(f.sums.protein / f.count),
      last_kcal: f.last.kcal || 0,
      last_protein: f.last.protein || 0,
      last_fat: f.last.fat || 0,
      last_carb: f.last.carb || 0,
      last_fiber: f.last.fiber || 0,
      last_text: f.last.name,
      last_date: f.last_date
    }));
}

app.get('/api/favorites', (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 8));
  const logFile = req.dataFiles.log;
  const stat = fs.statSync(logFile, { throwIfNoEntry: false });
  const mtimeMs = stat ? stat.mtimeMs : 0;
  const cached = favoritesCache.get(req.userId);
  let favs;
  if (cached && cached.mtimeMs === mtimeMs) {
    favs = cached.favs;
  } else {
    favs = computeFavorites(readJson(logFile, {}));
    favoritesCache.set(req.userId, { mtimeMs, favs });
  }
  res.json(favs.slice(0, limit));
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
  const startD = new Date(start + 'T00:00:00');
  const endD = new Date(end + 'T00:00:00');
  forEachDateInRange(startD, endD, ds => {
    const entries = log[ds] || [];
    if (!entries.length) return;
    const kcal = entries.reduce((a, e) => a + (e.kcal || 0), 0);
    const protein = round1(entries.reduce((a, e) => a + (e.protein || 0), 0));
    result[ds] = { kcal, protein, goal, protein_goal: stats ? stats.protein_g : null, entries_count: entries.length };
  });
  res.json(result);
});

app.get('/api/source-breakdown', (req, res) => {
  const log = readJson(req.dataFiles.log, {});
  const start = req.query.start;
  const end = req.query.end || todayStr(req);
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
  const today = todayStr(req);
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
    const ds = fmtDate(d);
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

function compute7DayBlock(log, weights, stats, startStr, endStr) {
  const startD = new Date(startStr + 'T00:00:00');
  const endD = new Date(endStr + 'T00:00:00');
  const dayTotals = [];
  forEachDateInRange(startD, endD, ds => {
    const entries = log[ds] || [];
    if (!entries.length) return;
    const t = entries.reduce((a, e) => ({
      kcal: a.kcal + (e.kcal || 0),
      protein: a.protein + (e.protein || 0),
      fat: a.fat + (e.fat || 0),
      carb: a.carb + (e.carb || 0),
      fiber: a.fiber + (e.fiber || 0)
    }), { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 });
    dayTotals.push({ date: ds, ...t, entries });
  });
  if (!dayTotals.length) return { days_logged: 0, empty: true };

  const goal = stats ? stats.kcal_goal : null;
  const proteinT = stats ? stats.protein_g : null;
  const totalK = dayTotals.reduce((a, d) => a + d.kcal, 0);
  const totalP = dayTotals.reduce((a, d) => a + d.protein, 0);
  const daysHitGoal = goal ? dayTotals.filter(d => d.kcal >= goal - 200 && d.kcal <= goal + 200).length : 0;

  const weightsInWindow = weights.filter(w => w.date >= startStr && w.date <= endStr);
  const weight_start = weightsInWindow[0] ? weightsInWindow[0].kg : null;
  const weight_end = weightsInWindow.length ? weightsInWindow[weightsInWindow.length - 1].kg : null;
  const weight_delta = weight_start !== null && weight_end !== null && weightsInWindow.length >= 2
    ? Math.round((weight_end - weight_start) * 100) / 100
    : null;

  return {
    days_logged: dayTotals.length,
    avg_kcal: Math.round(totalK / dayTotals.length),
    avg_protein: round1(totalP / dayTotals.length),
    days_hit_goal: daysHitGoal,
    weight_delta_kg: weight_delta,
    weight_start,
    weight_end,
    dayTotals
  };
}

app.get('/api/weekly-review', (req, res) => {
  const log = readJson(req.dataFiles.log, {});
  const weights = readJson(req.dataFiles.weight, []);
  const profile = readJson(req.dataFiles.profile, null);
  const stats = computeStats(profile);

  const endStr = req.query.end || todayStr(req);
  const endD = new Date(endStr + 'T00:00:00');
  const startD = new Date(endD); startD.setDate(startD.getDate() - 6);
  const startStr = fmtDate(startD);
  // Previous 7-day window for comparison
  const prevEndD = new Date(startD); prevEndD.setDate(prevEndD.getDate() - 1);
  const prevStartD = new Date(prevEndD); prevStartD.setDate(prevStartD.getDate() - 6);
  const prevStartStr = fmtDate(prevStartD);
  const prevEndStr = fmtDate(prevEndD);

  const current = compute7DayBlock(log, weights, stats, startStr, endStr);
  const previous = compute7DayBlock(log, weights, stats, prevStartStr, prevEndStr);

  if (current.empty) {
    return res.json({ start: startStr, end: endStr, days_logged: 0, empty: true });
  }

  const goal = stats ? stats.kcal_goal : null;
  const proteinT = stats ? stats.protein_g : null;
  const fatT = stats ? stats.fat_g : null;
  const carbT = stats ? stats.carb_g : null;
  const fiberT = stats ? stats.fiber_g : null;

  const inRange = (val, target) => target && val >= target * 0.8 && val <= target * 1.2;
  const macro_hit_days = {
    protein: proteinT ? current.dayTotals.filter(d => inRange(d.protein, proteinT)).length : 0,
    fat: fatT ? current.dayTotals.filter(d => inRange(d.fat, fatT)).length : 0,
    carb: carbT ? current.dayTotals.filter(d => inRange(d.carb, carbT)).length : 0,
    fiber: fiberT ? current.dayTotals.filter(d => d.fiber >= fiberT * 0.8).length : 0
  };

  // Top foods (most logged by name, normalized)
  const foodCounts = {};
  current.dayTotals.forEach(d => d.entries.forEach(e => {
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

  // Best/worst day
  const sorted = [...current.dayTotals].sort((a, b) => a.kcal - b.kcal);
  const lightestDay = sorted[0];
  const heaviestDay = sorted[sorted.length - 1];

  res.json({
    start: startStr,
    end: endStr,
    days_logged: current.days_logged,
    avg_kcal: current.avg_kcal,
    avg_protein: current.avg_protein,
    total_kcal: current.dayTotals.reduce((a, d) => a + d.kcal, 0),
    goal_kcal: goal,
    days_hit_goal: current.days_hit_goal,
    macro_hit_days,
    macro_targets: { protein: proteinT, fat: fatT, carb: carbT, fiber: fiberT },
    top_foods,
    weight_delta_kg: current.weight_delta_kg,
    weight_start: current.weight_start,
    weight_end: current.weight_end,
    lightest_day: { date: lightestDay.date, kcal: lightestDay.kcal },
    heaviest_day: { date: heaviestDay.date, kcal: heaviestDay.kcal },
    previous: previous.empty ? null : {
      days_logged: previous.days_logged,
      avg_kcal: previous.avg_kcal,
      avg_protein: previous.avg_protein,
      days_hit_goal: previous.days_hit_goal,
      weight_delta_kg: previous.weight_delta_kg
    }
  });
});

// ---------- /api/templates ----------
app.get('/api/templates', (req, res) => {
  res.json(readJson(req.dataFiles.templates, []));
});

app.post('/api/templates', async (req, res) => {
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
  const computed = templateTotals || templateItems.reduce((a, i) => ({
    kcal: a.kcal + (i.kcal || 0), protein: a.protein + (i.protein || 0),
    fat: a.fat + (i.fat || 0), carb: a.carb + (i.carb || 0), fiber: a.fiber + (i.fiber || 0)
  }), { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 });
  const tmpl = { id: newId(), name: String(name).trim().slice(0, 100), items: templateItems, totals: computed, created: new Date().toISOString() };
  await withFileLock(req.dataFiles.templates, () => {
    const templates = readJson(req.dataFiles.templates, []);
    templates.push(tmpl);
    writeJson(req.dataFiles.templates, templates);
  });
  res.json(tmpl);
});

app.patch('/api/templates/:id', async (req, res) => {
  const result = await withFileLock(req.dataFiles.templates, () => {
    const templates = readJson(req.dataFiles.templates, []);
    const idx = templates.findIndex(t => t.id === req.params.id);
    if (idx < 0) return { error: 'not found', status: 404 };
    if (req.body.name) templates[idx].name = String(req.body.name).trim().slice(0, 100);
    writeJson(req.dataFiles.templates, templates);
    return { template: templates[idx] };
  });
  if (result.status) return res.status(result.status).json({ error: result.error });
  res.json(result.template);
});

app.delete('/api/templates/:id', async (req, res) => {
  await withFileLock(req.dataFiles.templates, () => {
    const templates = readJson(req.dataFiles.templates, []);
    writeJson(req.dataFiles.templates, templates.filter(t => t.id !== req.params.id));
  });
  res.json({ ok: true });
});

app.post('/api/log-template/:id', async (req, res) => {
  const templates = readJson(req.dataFiles.templates, []);
  const tmpl = templates.find(t => t.id === req.params.id);
  if (!tmpl) return res.status(404).json({ error: 'template not found' });
  const d = req.query.date || todayStr(req);
  const now = new Date().toISOString();
  const entries = (tmpl.items || []).map(item => ({
    id: newId(),
    name: String(item.name || '').slice(0, 200),
    kcal: Math.round(item.kcal || 0),
    protein: round1(item.protein),
    fat: round1(item.fat),
    carb: round1(item.carb),
    fiber: round1(item.fiber),
    source: 'custom',
    time: now
  }));
  await withFileLock(req.dataFiles.log, () => {
    const log = readJson(req.dataFiles.log, {});
    if (!log[d]) log[d] = [];
    log[d].push(...entries);
    writeJson(req.dataFiles.log, log);
  });
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
  // Local-time cutoff to stay consistent with how dates are keyed in the log file.
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = fmtDate(cutoff);
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
const MACRO_SUGGEST_SYSTEM = require('./prompts/macro-suggest');
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
    const data = await aiJson('macro-suggest', MACRO_SUGGEST_SYSTEM, `User needs roughly ${rounded}g more ${macroNames[macro] || macro} today. Suggest 3 practical foods/combos.`, 8000);
    macroSuggestCache.set(cacheKey, { ts: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- /api/gap-suggest ----------
const GAP_SUGGEST_SYSTEM = require('./prompts/gap-suggest');
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
    const behindDesc = behind.map(m => {
      const n = { protein: 'protein', fat: 'fat', carb: 'carbs', fiber: 'fiber' };
      return `${n[m] || m}: ~${remaining[m] !== undefined ? Math.round(remaining[m]) : '?'}g needed`;
    }).join(', ');
    const data = await aiJson('gap-suggest', GAP_SUGGEST_SYSTEM, `User has ${rem.kcal} kcal left today. Key gaps: ${behindDesc}. Suggest 3 practical foods/combos that help close these gaps.`, 5000);
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

app.post('/api/custom-foods', async (req, res) => {
  const { name, kcal, protein, fat, carb, fiber } = req.body || {};
  if (!name || kcal == null) return res.status(400).json({ error: 'name and kcal required' });
  const key = normalizeFoodName(name);
  const food = {
    name: String(name).trim(),
    kcal: Math.round(Number(kcal)),
    protein: round1(protein),
    fat: round1(fat),
    carb: round1(carb),
    fiber: round1(fiber),
    updated: todayStr()
  };
  await withFileLock(req.dataFiles.custom_foods, () => {
    const customs = readJson(req.dataFiles.custom_foods, {});
    customs[key] = food;
    writeJson(req.dataFiles.custom_foods, customs);
  });
  res.json(food);
});

app.patch('/api/custom-foods/:key', async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const { kcal, protein, fat, carb, fiber } = req.body || {};
  const result = await withFileLock(req.dataFiles.custom_foods, () => {
    const customs = readJson(req.dataFiles.custom_foods, {});
    if (!customs[key]) return { error: 'not found', status: 404 };
    if (kcal != null) customs[key].kcal = Math.round(Number(kcal));
    if (protein != null) customs[key].protein = round1(protein);
    if (fat != null) customs[key].fat = round1(fat);
    if (carb != null) customs[key].carb = round1(carb);
    if (fiber != null) customs[key].fiber = round1(fiber);
    customs[key].updated = todayStr();
    writeJson(req.dataFiles.custom_foods, customs);
    return { food: customs[key] };
  });
  if (result.status) return res.status(result.status).json({ error: result.error });
  res.json(result.food);
});

app.delete('/api/custom-foods/:key', async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  await withFileLock(req.dataFiles.custom_foods, () => {
    const customs = readJson(req.dataFiles.custom_foods, {});
    delete customs[key];
    writeJson(req.dataFiles.custom_foods, customs);
  });
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
  res.setHeader('Content-Disposition', `attachment; filename="calories-backup-${todayStr(req)}.json"`);
  res.send(JSON.stringify(bundle, null, 2));
});

app.post('/api/import', async (req, res) => {
  const body = req.body || {};
  const mode = body.mode || 'replace'; // 'replace' | 'merge'
  let written = [];
  for (const k of BACKUP_KEYS) {
    const incoming = body[k];
    if (incoming === undefined || incoming === null) continue;
    await withFileLock(req.dataFiles[k], () => {
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
    });
    written.push(k);
  }
  res.json({ written, mode });
});

// ---------- Food data sources ----------

// 1. Open Food Facts (uses v2 search API — more reliable than legacy cgi/search.pl)
// OFF nutriments → result shape. Returns null if the product lacks usable energy data.
// `fallbackName` is used when the product itself has no name; `fallbackBarcode` is
// returned when the product has no .code (the barcode endpoint can substitute the
// requested barcode here so the response is always self-describing).
function offProductToResult(product, fallbackName, fallbackBarcode = null) {
  const n = product.nutriments || {};
  const kcal100 = n['energy-kcal_100g'] || (n['energy_100g'] ? n['energy_100g'] / 4.184 : null);
  if (!kcal100) return null;
  const serving = product.serving_quantity ? Number(product.serving_quantity) : null;
  const protein100 = n.proteins_100g || 0;
  const kcalRounded = Math.round(kcal100);
  const proteinRounded = round1(protein100);
  return {
    name: product.product_name || product.product_name_en || fallbackName,
    brand: product.brands || null,
    serving_g: serving || 100,
    kcal_per_serving: serving ? Math.round(kcal100 * serving / 100) : kcalRounded,
    protein_per_serving: serving ? round1(protein100 * serving / 100) : proteinRounded,
    kcal_100g: kcalRounded,
    protein_100g: proteinRounded,
    source: 'openfoodfacts',
    barcode: product.code || fallbackBarcode
  };
}

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
      const result = offProductToResult(p, name);
      if (result) return result;
    }
    return null;
  } catch {
    // OFF endpoint is flaky — fail silent, lookup chain continues to next source
    return null;
  }
}

async function offBarcode(barcode) {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`, { timeout: 5000 });
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    return offProductToResult(j.product, barcode, barcode);
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

  if (isPer100g) return { kcal: kcalVal, protein: proteinVal, fat: fatVal, carb: carbVal, per100g: true };
  if (servingGrams) {
    const k = 100 / servingGrams;
    return { kcal: Math.round(kcalVal * k), protein: round1(proteinVal * k), fat: round1(fatVal * k), carb: round1(carbVal * k), per100g: true };
  }
  return { kcal: kcalVal, protein: proteinVal, fat: fatVal, carb: carbVal, per100g: false };
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
      // Round once; mirror into both per-serving and per-100g fields (when applicable).
      const kcal = Math.round(parsed.kcal);
      const protein = round1(parsed.protein);
      const fat = round1(parsed.fat || 0);
      const carb = round1(parsed.carb || 0);
      const per100 = parsed.per100g;
      return {
        name: f.food_name,
        brand: f.brand_name || null,
        serving_g: per100 ? 100 : null,
        kcal_per_serving: kcal, protein_per_serving: protein, fat_per_serving: fat, carb_per_serving: carb,
        kcal_100g: per100 ? kcal : null,
        protein_100g: per100 ? protein : null,
        fat_100g: per100 ? fat : null,
        carb_100g: per100 ? carb : null,
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
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(name)}&${dataTypeParams}&pageSize=10`;
    const r = await fetch(url, { timeout: 6000, headers: { 'X-Api-Key': process.env.USDA_API_KEY } });
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
    const kcal = Math.round(kcal100);
    const protein = round1(protein100);
    return {
      name: f.description,
      brand: f.brandOwner || null,
      serving_g: 100,
      kcal_per_serving: kcal, protein_per_serving: protein,
      kcal_100g: kcal, protein_100g: protein,
      fat_100g: round1(fat100), carb_100g: round1(carb100), fiber_100g: round1(fiber100),
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
const PARSE_SYSTEM = require('./prompts/parse');
const VERIFY_SYSTEM = require('./prompts/verify');

// --- /api/parse helpers ---

// AI-only initial finals + flagged baseline. Used as the starting point before custom/DB/sanity overrides.
function initialFinals(item) {
  return {
    kcal: Math.round(item.kcal_total || 0),
    protein: round1(item.protein_g),
    fat: round1(item.fat_g),
    carb: round1(item.carb_g),
    fiber: round1(item.fiber_g),
    source: 'ai-estimate',
    confidence: item.confidence || 'medium',
    usda: null,
    flagged: null
  };
}

// Apply a user-verified custom food match. qty=0 is honored as zero serving (only null/undefined falls back to 1).
function applyCustomFood(custom, item, f) {
  const qty = item.qty ?? 1;
  f.kcal = Math.round(custom.kcal * qty);
  f.protein = round1(custom.protein * qty);
  f.fat = round1((custom.fat || 0) * qty);
  f.carb = round1((custom.carb || 0) * qty);
  f.fiber = round1((custom.fiber || 0) * qty);
  f.source = 'custom';
  f.confidence = 'high';
}

// Try USDA + FatSecret in parallel. Mutates `f` if a relevant match wins per the resolution rules.
async function applyDbSources(item, f) {
  const category = item.category || 'generic';
  const isGram = item.unit === 'g' || item.unit === 'ml';
  const aiLow = item.kcal_low || f.kcal * 0.6;
  const aiHigh = item.kcal_high || f.kcal * 1.4;
  // USDA is only reliable for whole foods — branded items match wrong (e.g. "Emu, full rump" for beef steak)
  const tryUsda = isGram && category === 'whole-food';
  const dbQuery = item.search_name || item.name;

  const [usdaResult, fsResult] = await Promise.all([
    tryUsda ? usdaSearch(dbQuery).catch(() => null) : Promise.resolve(null),
    fsSearch(dbQuery).catch(() => null)
  ]);

  // USDA branch: whole-food gram items, full macros including fiber
  if (usdaResult && isRelevantMatch(item.name, usdaResult.name)) {
    const usdaTotal = Math.round(usdaResult.kcal_100g * item.qty / 100);
    const scaled = {
      kcal: usdaTotal,
      protein: round1(usdaResult.protein_100g * item.qty / 100),
      fat: round1((usdaResult.fat_100g || 0) * item.qty / 100),
      carb: round1((usdaResult.carb_100g || 0) * item.qty / 100),
      fiber: round1((usdaResult.fiber_100g || 0) * item.qty / 100)
    };
    f.usda = {
      name: usdaResult.name, kcal_100g: usdaResult.kcal_100g, protein_100g: usdaResult.protein_100g,
      fat_100g: usdaResult.fat_100g, carb_100g: usdaResult.carb_100g, fiber_100g: usdaResult.fiber_100g,
      total: usdaTotal
    };
    const inRange = usdaTotal >= aiLow * 0.5 && usdaTotal <= aiHigh * 1.5;
    if (inRange) {
      f.usda.status = 'confirmed';
      Object.assign(f, scaled, { source: 'usda+ai', confidence: 'high' });
    } else if (category === 'whole-food') {
      // On conflict, trust USDA lab data for whole foods
      f.usda.status = 'conflict';
      Object.assign(f, scaled, { source: 'usda', confidence: 'high' });
    } else {
      // On conflict for branded/generic, USDA probably found wrong food — fall through to FatSecret
      f.usda.status = 'conflict';
    }
  }

  // FatSecret branch: runs only if USDA didn't resolve (or wasn't tried)
  if (f.source !== 'ai-estimate' || !fsResult || !isRelevantMatch(item.name, fsResult.name)) return;
  let fsKcal, fsProtein, fsFat, fsCarb;
  if (isGram && fsResult.kcal_100g) {
    fsKcal    = Math.round(fsResult.kcal_100g * item.qty / 100);
    fsProtein = round1((fsResult.protein_100g || 0) * item.qty / 100);
    fsFat     = round1((fsResult.fat_100g || 0) * item.qty / 100);
    fsCarb    = round1((fsResult.carb_100g || 0) * item.qty / 100);
  } else if (!isGram && !fsResult.serving_g) {
    fsKcal    = Math.round(fsResult.kcal_per_serving * item.qty);
    fsProtein = round1((fsResult.protein_per_serving || 0) * item.qty);
    fsFat     = round1((fsResult.fat_per_serving || 0) * item.qty);
    fsCarb    = round1((fsResult.carb_per_serving || 0) * item.qty);
  }
  if (fsKcal && fsKcal > 0) {
    // fiber stays as AI estimate — FatSecret basic search doesn't provide it
    Object.assign(f, { kcal: fsKcal, protein: fsProtein, fat: fsFat, carb: fsCarb, source: 'fatsecret' });
    f.confidence = (fsKcal >= aiLow * 0.5 && fsKcal <= aiHigh * 1.5) ? 'high' : 'medium';
  }
}

// Defensive caps for physically-impossible values from upstream sources.
function applySanityCaps(item, f) {
  if ((item.unit === 'g' || item.unit === 'ml') && item.qty > 0 && f.kcal / item.qty * 100 > 900) {
    // Physically impossible — fall back to AI range midpoint
    f.kcal = Math.round(((item.kcal_low || 0) + (item.kcal_high || item.kcal_total || 0)) / 2);
    f.source = 'ai-estimate';
    f.flagged = 'sanity-cap';
  }
  if (item.qty > 0 && f.kcal / item.qty > 1500) {
    f.flagged = f.flagged || 'high-kcal';
  }
  // Protein cap: protein can't exceed 0.45× kcal (pure protein = 4 kcal/g)
  if (f.kcal > 0 && f.protein > f.kcal * 0.45) {
    f.protein = round1(f.kcal * 0.25);
    f.flagged = f.flagged || 'protein-capped';
  }
}

async function resolveItem(item, customs) {
  const f = initialFinals(item);

  const custom = customLookup(customs, item.name);
  if (custom) applyCustomFood(custom, item, f);
  else await applyDbSources(item, f);

  applySanityCaps(item, f);

  return {
    item: { name: item.name, qty: item.qty, unit: item.unit, kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb, fiber: f.fiber, source: f.source, confidence: f.confidence },
    trace: {
      name: item.name, qty: item.qty, unit: item.unit,
      category: item.category || 'generic', confidence: f.confidence, reasoning: item.reasoning || '',
      ai_kcal_total: Math.round(item.kcal_total || 0),
      ai_kcal_low: Math.round(item.kcal_low || 0),
      ai_kcal_high: Math.round(item.kcal_high || 0),
      ai_protein: round1(item.protein_g),
      ai_fat: round1(item.fat_g),
      ai_carb: round1(item.carb_g),
      ai_fiber: round1(item.fiber_g),
      usda: f.usda, source: f.source,
      final_kcal: f.kcal, final_protein: f.protein, final_fat: f.fat, final_carb: f.carb, final_fiber: f.fiber,
      flagged: f.flagged
    }
  };
}

// AI second-pass: reviews DB-sourced items only (pure AI estimates are already the AI's best guess —
// re-asking just adds noise). Mutates `items` and `trace` in place on accepted corrections.
async function verifyItems(items, trace) {
  const verifyTargets = items.map((it, i) => ({ i, it })).filter(({ it }) =>
    it.source === 'fatsecret' || it.source === 'usda' || it.source === 'usda+ai'
  );
  if (!openai || !verifyTargets.length) return;
  try {
    const verifyPrompt = verifyTargets.map(({ it }, n) =>
      `Item ${n + 1}: "${it.name}" · ${it.qty} ${it.unit} · source: ${it.source}\n` +
      `  ${it.kcal} kcal / ${it.protein}g P / ${it.fat}g F / ${it.carb}g C / ${it.fiber}g Fib`
    ).join('\n\n');
    const vResult = await aiJson('verify', VERIFY_SYSTEM, verifyPrompt, 8000);
    const corrections = vResult.items || [];
    verifyTargets.forEach(({ i }, n) => {
      const c = corrections[n];
      if (!c || c.ok !== false || !c.kcal) return;
      items[i] = {
        ...items[i],
        kcal:    Math.round(c.kcal),
        protein: round1(c.protein || items[i].protein),
        fat:     round1(c.fat     || items[i].fat),
        carb:    round1(c.carb    || items[i].carb),
        fiber:   round1(c.fiber   || items[i].fiber),
        source:  'ai-verified',
        confidence: 'high'
      };
      if (trace[i]) {
        trace[i].verify_note = c.note || '';
        trace[i].source = 'ai-verified';
        // Update trace's "Final" line to reflect post-verify values
        trace[i].final_kcal    = items[i].kcal;
        trace[i].final_protein = items[i].protein;
        trace[i].final_fat     = items[i].fat;
        trace[i].final_carb    = items[i].carb;
        trace[i].final_fiber   = items[i].fiber;
      }
    });
  } catch (e) {
    console.warn('[parse] verify pass failed (non-fatal):', e.message);
  }
}

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

    const customs = readJson(req.dataFiles.custom_foods, {});
    const resolved = await Promise.all((parsed.items || []).map(item => resolveItem(item, customs)));
    const items = resolved.map(r => r.item);
    const trace = resolved.map(r => r.trace);

    await verifyItems(items, trace);

    const totals = items.reduce((a, i) => ({
      kcal: a.kcal + i.kcal,
      protein: a.protein + i.protein,
      fat: round1(a.fat + i.fat),
      carb: round1(a.carb + i.carb),
      fiber: round1(a.fiber + i.fiber)
    }), { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 });
    res.json({ items, totals, raw_text: text, trace, suggested_extras: parsed.suggested_extras || [] });
  } catch (e) {
    console.error('Parse error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- /api/health ----------
// Run one source check: short-circuit when missing config, wrap user fn in try/catch.
async function runCheck(configured, missingDetail, fn) {
  if (!configured) return { status: 'missing', detail: missingDetail };
  try { return await fn(); }
  catch (e) { return { status: 'error', detail: e.message }; }
}

app.get('/api/health', async (req, res) => {
  const fsConfigured = !!(process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET);
  // Run all four checks in parallel — each has its own ~3-4s timeout, so sequential
  // worst-case is ~12s vs ~4s parallel.
  const [openaiRes, offRes, fsRes, usdaRes, public_ip] = await Promise.all([
    runCheck(!!process.env.OPENAI_API_KEY, 'No OPENAI_API_KEY in .env', async () => {
      const r = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: 'Reply with the JSON {"ok":true}' }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 500
      });
      const c = r.choices[0].message.content;
      return c && c.trim()
        ? { status: 'ok', detail: `Model ${r.model} responded` }
        : { status: 'warn', detail: 'Model returned empty content (try bigger token budget)' };
    }),
    runCheck(true, '', async () => {
      const r = await fetch('https://world.openfoodfacts.org/api/v2/product/737628064502.json', { timeout: 4000 });
      const ct = r.headers.get('content-type') || '';
      return r.ok && ct.includes('json')
        ? { status: 'ok', detail: 'Reachable' }
        : { status: 'warn', detail: `HTTP ${r.status}` };
    }),
    runCheck(fsConfigured, 'FATSECRET_CLIENT_ID / SECRET not in .env', async () => {
      const tok = await fsToken();
      if (!tok) return { status: 'error', detail: 'OAuth token request failed' };
      const r = await fetch(`https://platform.fatsecret.com/rest/server.api?method=foods.search&search_expression=apple&format=json&max_results=1`, { headers: { 'Authorization': `Bearer ${tok}` }, timeout: 4000 });
      const j = await r.json();
      return j.error
        ? { status: 'error', detail: j.error.message }
        : { status: 'ok', detail: 'Search returned results' };
    }),
    runCheck(!!process.env.USDA_API_KEY, 'No USDA_API_KEY in .env', async () => {
      const r = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=apple&pageSize=1`, { timeout: 4000, headers: { 'X-Api-Key': process.env.USDA_API_KEY } });
      const j = await r.json();
      if (j.error) return { status: 'error', detail: j.error.message || JSON.stringify(j.error) };
      return j.foods && j.foods.length
        ? { status: 'ok', detail: 'Search returned results' }
        : { status: 'warn', detail: 'No results for test query' };
    }),
    fetchPublicIp()
  ]);

  res.json({
    checks: {
      openai:        { configured: !!process.env.OPENAI_API_KEY, model: OPENAI_MODEL, ...openaiRes },
      openfoodfacts: { configured: true, ...offRes },
      fatsecret:     { configured: fsConfigured, ...fsRes },
      usda:          { configured: !!process.env.USDA_API_KEY, ...usdaRes }
    },
    public_ip
  });
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
  const today = todayStr(req);
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

app.delete('/api/usage', async (req, res) => {
  await withFileLock(USAGE_FILE, () => writeJson(USAGE_FILE, []));
  res.json({ ok: true });
});

// ---------- water ----------
app.get('/api/water', (req, res) => {
  const date = req.query.date || todayStr(req);
  const w = readJson(req.dataFiles.water, {});
  const entries = w[date] || [];
  res.json({ date, entries, total_ml: entries.reduce((s, e) => s + e.ml, 0) });
});

app.post('/api/water', async (req, res) => {
  const date = req.body.date || todayStr(req);
  const ml = Number(req.body.ml) || 250;
  const entries = await withFileLock(req.dataFiles.water, () => {
    const w = readJson(req.dataFiles.water, {});
    if (!w[date]) w[date] = [];
    w[date].push({ id: crypto.randomUUID(), ml, ts: new Date().toISOString() });
    writeJson(req.dataFiles.water, w);
    return w[date];
  });
  res.json({ ok: true, date, entries, total_ml: entries.reduce((s, e) => s + e.ml, 0) });
});

app.delete('/api/water/:id', async (req, res) => {
  const date = req.query.date || todayStr(req);
  const entries = await withFileLock(req.dataFiles.water, () => {
    const w = readJson(req.dataFiles.water, {});
    if (w[date]) w[date] = w[date].filter(e => e.id !== req.params.id);
    writeJson(req.dataFiles.water, w);
    return w[date] || [];
  });
  res.json({ ok: true, date, entries, total_ml: entries.reduce((s, e) => s + e.ml, 0) });
});

// ---------- start ----------
// Only listen when run directly (`node server.js`). When required from tests,
// expose pure helpers so they can be unit-tested without booting the server.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Calorie tracker running at http://localhost:${PORT}`);
    console.log(`(or on your phone: http://<your-LAN-IP>:${PORT})`);
  });
} else {
  module.exports = {
    app, createTestSession,
    round1, fmtDate, todayStr, forEachDateInRange,
    readJson, writeJson, withFileLock,
    normalizeFoodName, customLookup, isRelevantMatch,
    initialFinals, applyCustomFood, applySanityCaps,
    computeFavorites
  };
}
