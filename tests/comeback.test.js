const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Env must be set before requiring server.js — DATA_DIR is captured at module load.
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'calories-comeback-'));
process.env.CALORIES_DATA_DIR = TMP_DATA;
process.env.SESSION_SECRET = 'test-secret-for-comeback-tests';

const {
  app, createTestSession, fmtDate,
  computeStats, resetMeta, comebackTier, lastActiveStretch, GOALS, RESET_DAYS
} = require('../server.js');

const TEST_USER = { id: 'comeback-user', username: 'tester', global_name: 'Tester' };
let server, baseUrl, cookie;

test.before(async () => {
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  cookie = createTestSession(TEST_USER);
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(TMP_DATA, { recursive: true, force: true }); } catch {}
});

async function request(method, urlPath, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${baseUrl}${urlPath}`, opts);
  const text = await r.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: r.status, data };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmtDate(d);
}

const userDir = () => path.join(TMP_DATA, 'users', TEST_USER.id);
function writeUserFile(name, contents) {
  fs.mkdirSync(userDir(), { recursive: true });
  fs.writeFileSync(path.join(userDir(), name), JSON.stringify(contents, null, 2));
}
function readUserFile(name) {
  return JSON.parse(fs.readFileSync(path.join(userDir(), name), 'utf8'));
}
function meal(kcal, protein) {
  return [{ id: 'x', name: 'test meal', kcal, protein, fat: 0, carb: 0, fiber: 0, source: 'manual', time: new Date().toISOString() }];
}

const BASE_PROFILE = { height_cm: 178, weight_kg: 81.25, age: 24, sex: 'male', activity: 'moderate', goal: 'steady' };

// ---------- comebackTier ----------

test('comebackTier: buckets by gap length', () => {
  assert.equal(comebackTier(0), 'none');
  assert.equal(comebackTier(6), 'none');   // a missed weekend is not a comeback
  assert.equal(comebackTier(7), 'short');
  assert.equal(comebackTier(20), 'short');
  assert.equal(comebackTier(21), 'long');
  assert.equal(comebackTier(89), 'long');
  assert.equal(comebackTier(90), 'dormant');
  assert.equal(comebackTier(400), 'dormant');
});

// ---------- lastActiveStretch ----------

test('lastActiveStretch: tolerates small holes, breaks on real gaps', async (t) => {
  await t.test('contiguous run returns the whole run', () => {
    const dates = ['2026-05-01', '2026-05-02', '2026-05-03'];
    assert.deepEqual(lastActiveStretch(dates, '2026-05-03'), { start: '2026-05-01', end: '2026-05-03' });
  });

  await t.test('a single skipped day does not split the stretch', () => {
    // 05-02 missing — one day off inside an otherwise solid week.
    const dates = ['2026-05-01', '2026-05-03', '2026-05-04'];
    assert.deepEqual(lastActiveStretch(dates, '2026-05-04'), { start: '2026-05-01', end: '2026-05-04' });
  });

  await t.test('a gap longer than the slack starts a new stretch', () => {
    // 10-day hole between April and May — that's a lapse, not a skipped day.
    const dates = ['2026-04-10', '2026-04-11', '2026-04-21', '2026-04-22'];
    assert.deepEqual(lastActiveStretch(dates, '2026-04-22'), { start: '2026-04-21', end: '2026-04-22' });
  });

  await t.test('empty input returns null', () => {
    assert.equal(lastActiveStretch([], '2026-05-01'), null);
  });

  await t.test('single day returns that day', () => {
    assert.deepEqual(lastActiveStretch(['2026-05-01'], '2026-05-01'), { start: '2026-05-01', end: '2026-05-01' });
  });
});

// ---------- resetMeta ----------

test('resetMeta: tracks the seven-day clock', async (t) => {
  await t.test('null unless the goal is reset with a start date', () => {
    assert.equal(resetMeta(null, '2026-05-10'), null);
    assert.equal(resetMeta({ goal: 'steady', reset_started: '2026-05-01' }, '2026-05-10'), null);
    assert.equal(resetMeta({ goal: 'reset' }, '2026-05-10'), null);
  });

  await t.test('day 1 on the start date', () => {
    const m = resetMeta({ goal: 'reset', reset_started: '2026-05-01' }, '2026-05-01');
    assert.equal(m.day, 1);
    assert.equal(m.of, RESET_DAYS);
    assert.equal(m.expired, false);
    assert.equal(m.days_left, 7);
    assert.equal(m.ends, '2026-05-07');
  });

  await t.test('day 7 is the last non-expired day', () => {
    const m = resetMeta({ goal: 'reset', reset_started: '2026-05-01' }, '2026-05-07');
    assert.equal(m.day, 7);
    assert.equal(m.expired, false);
    assert.equal(m.days_left, 1);
  });

  await t.test('day 8 expires', () => {
    const m = resetMeta({ goal: 'reset', reset_started: '2026-05-01' }, '2026-05-08');
    assert.equal(m.expired, true);
    assert.equal(m.days_left, 0);
    assert.equal(m.day, 7, 'day caps at 7 so the UI never says "day 42 of 7"');
  });

  await t.test('day stays clamped long after expiry', () => {
    const m = resetMeta({ goal: 'reset', reset_started: '2026-01-01' }, '2026-09-07');
    assert.equal(m.day, 7);
    assert.equal(m.expired, true);
  });
});

// ---------- computeStats under reset ----------

test('computeStats: reset goal eats at TDEE with no deficit', () => {
  const steady = computeStats({ ...BASE_PROFILE, goal: 'steady' });
  const reset = computeStats({ ...BASE_PROFILE, goal: 'reset', reset_started: fmtDate(new Date()) });

  assert.equal(GOALS.reset.delta, 0);
  assert.equal(reset.kcal_goal, reset.tdee, 'reset target IS maintenance — that is the point');
  assert.ok(reset.kcal_goal > steady.kcal_goal, 'reset must not silently keep the old deficit');
  assert.ok(reset.reset_meta, 'stats carry the reset clock so the client can draw the strip');
  assert.equal(reset.reset_meta.day, 1);
  assert.match(reset.explainer, /reset/i);
  assert.match(reset.explainer, /log/i, 'the explainer names logging as the objective');
});

test('computeStats: reset protein stays high enough to defend muscle', () => {
  const reset = computeStats({ ...BASE_PROFILE, goal: 'reset', reset_started: fmtDate(new Date()) });
  // Not the cutting ratio (2.0) since there is no deficit, but well above the 0.8 RDA.
  const perKg = reset.protein_g / BASE_PROFILE.weight_kg;
  assert.ok(perKg > 1.5 && perKg < 2.0, `expected ~1.76 g/kg, got ${perKg.toFixed(2)}`);
});

test('computeStats: no reset_meta on ordinary goals', () => {
  for (const g of ['mild', 'steady', 'aggressive', 'maintain', 'gain']) {
    const s = computeStats({ ...BASE_PROFILE, goal: g });
    assert.equal(s.reset_meta, null, `${g} should not carry reset state`);
  }
});

// ---------- /api/comeback ----------

test('comeback: hidden when there is no profile', async () => {
  const r = await request('GET', '/api/comeback');
  assert.equal(r.data.show, false);
  assert.equal(r.data.reason, 'no_profile');
});

test('comeback: hidden when the user has never logged', async () => {
  await request('POST', '/api/profile', BASE_PROFILE);
  const r = await request('GET', '/api/comeback');
  assert.equal(r.data.show, false);
  assert.equal(r.data.reason, 'never_logged');
});

test('comeback: hidden for a short break', async () => {
  writeUserFile('log.json', { [daysAgo(3)]: meal(2000, 150) });
  const r = await request('GET', '/api/comeback');
  assert.equal(r.data.show, false);
  assert.equal(r.data.tier, 'none');
  assert.equal(r.data.gap_days, 3);
});

test('comeback: shown after a real gap, with a recap of the last stretch', async () => {
  // Four days logged in a row, then a 120-day silence — the user's actual situation.
  writeUserFile('log.json', {
    [daysAgo(123)]: meal(2100, 160),
    [daysAgo(122)]: meal(1900, 140),
    [daysAgo(121)]: meal(2300, 155),
    [daysAgo(120)]: meal(2000, 150)
  });
  writeUserFile('weight.json', [
    { date: daysAgo(123), kg: 83.5 },
    { date: daysAgo(120), kg: 81.25 }
  ]);
  writeUserFile('profile.json', BASE_PROFILE);

  const r = await request('GET', '/api/comeback');
  assert.equal(r.data.show, true);
  assert.equal(r.data.tier, 'dormant');
  assert.equal(r.data.gap_days, 120);
  assert.equal(r.data.last_logged, daysAgo(120));

  const recap = r.data.recap;
  assert.equal(recap.days_logged, 4, 'the whole pre-gap run is the recap window');
  assert.equal(recap.avg_kcal, 2075);
  assert.equal(recap.weight_delta_kg, -2.25, 'shows the loss they earned, not the lapse');

  assert.equal(r.data.weight_age_days, 120);
  assert.equal(r.data.last_weight.kg, 81.25);
});

test('comeback: flags a stale hand-calibrated TDEE but does not drop it', async () => {
  writeUserFile('profile.json', { ...BASE_PROFILE, tdee_override: 2900 });
  const r = await request('GET', '/api/comeback');
  assert.ok(r.data.stale_tdee, 'a 120-day-old calibration should be surfaced');
  assert.equal(r.data.stale_tdee.override, 2900);
  assert.ok(r.data.stale_tdee.predicted > 0);
  assert.equal(r.data.stale_tdee.diff, 2900 - r.data.stale_tdee.predicted);
  assert.equal(readUserFile('profile.json').tdee_override, 2900, 'flagging must not mutate the profile');
});

test('comeback: a short gap does not flag the calibration', async () => {
  writeUserFile('log.json', { [daysAgo(10)]: meal(2000, 150) });
  writeUserFile('profile.json', { ...BASE_PROFILE, tdee_override: 2900 });
  const r = await request('GET', '/api/comeback');
  assert.equal(r.data.tier, 'short');
  assert.equal(r.data.stale_tdee, null, '10 days away does not invalidate a calibration');
});

// ---------- /api/comeback/complete ----------

test('comeback/complete: records weight, starts the reset, stamps the ack', async () => {
  const lastLogged = daysAgo(120);
  writeUserFile('log.json', { [lastLogged]: meal(2000, 150) });
  writeUserFile('weight.json', [{ date: lastLogged, kg: 81.25 }]);
  writeUserFile('profile.json', BASE_PROFILE);

  const r = await request('POST', '/api/comeback/complete', {
    weight_kg: 84.2, goal: 'reset', keep_tdee_override: true, last_logged: lastLogged
  });
  assert.equal(r.status, 200);

  const p = readUserFile('profile.json');
  assert.equal(p.weight_kg, 84.2);
  assert.equal(p.goal, 'reset');
  assert.equal(p.reset_started, fmtDate(new Date()), 'the clock starts today, not at the last log');
  assert.equal(p.pre_reset_goal, 'steady', 'remembers what they were on for the day-8 prompt');
  assert.equal(p.comeback_ack, lastLogged);

  const weights = readUserFile('weight.json');
  assert.equal(weights[weights.length - 1].kg, 84.2);
  assert.equal(weights[weights.length - 1].date, fmtDate(new Date()));

  // Targets must be rebuilt on the new weight, not the four-month-old one.
  assert.equal(r.data.stats.weight_kg, 84.2);
  assert.equal(r.data.stats.kcal_goal, r.data.stats.tdee);
});

test('comeback: stays hidden once acknowledged, re-arms on a fresh gap', async () => {
  const r1 = await request('GET', '/api/comeback');
  assert.equal(r1.data.acked, true);
  assert.equal(r1.data.show, false, 'a reload the same day must not re-prompt');

  // They log again, lapse again — a different last_logged date, so a new comeback.
  writeUserFile('log.json', { [daysAgo(120)]: meal(2000, 150), [daysAgo(30)]: meal(2000, 150) });
  const r2 = await request('GET', '/api/comeback');
  assert.equal(r2.data.acked, false);
  assert.equal(r2.data.show, true, 'a later lapse earns a fresh welcome-back');
  assert.equal(r2.data.gap_days, 30);
});

test('comeback/complete: same-day weigh-in overwrites rather than duplicating', async () => {
  writeUserFile('weight.json', [{ date: fmtDate(new Date()), kg: 84.2 }]);
  await request('POST', '/api/comeback/complete', { weight_kg: 84.9 });
  const weights = readUserFile('weight.json');
  const todayEntries = weights.filter(w => w.date === fmtDate(new Date()));
  assert.equal(todayEntries.length, 1);
  assert.equal(todayEntries[0].kg, 84.9);
});

test('comeback/complete: rejects an implausible weight instead of poisoning targets', async () => {
  const before = readUserFile('profile.json').weight_kg;
  for (const bad of [12, 900, 'heavy']) {
    const r = await request('POST', '/api/comeback/complete', { weight_kg: bad });
    assert.equal(r.status, 400, `${bad} should be refused`);
  }
  assert.equal(readUserFile('profile.json').weight_kg, before, 'a rejected weight changes nothing');
});

test('comeback/complete: rejects an unknown goal', async () => {
  const r = await request('POST', '/api/comeback/complete', { goal: 'shred-mode' });
  assert.equal(r.status, 400);
});

test('comeback/complete: dropping the TDEE override falls back to prediction', async () => {
  writeUserFile('profile.json', { ...BASE_PROFILE, tdee_override: 2900 });
  const r = await request('POST', '/api/comeback/complete', { keep_tdee_override: false });
  assert.equal(readUserFile('profile.json').tdee_override, undefined);
  assert.equal(r.data.stats.tdee, r.data.stats.tdee_predicted);
  assert.equal(r.data.stats.tdee_calibrated, false);
});

test('comeback/complete: a skip (no weight, no goal) still stamps the ack', async () => {
  const lastLogged = daysAgo(45);
  writeUserFile('log.json', { [lastLogged]: meal(2000, 150) });
  writeUserFile('profile.json', BASE_PROFILE);

  await request('POST', '/api/comeback/complete', { last_logged: lastLogged });
  const p = readUserFile('profile.json');
  assert.equal(p.comeback_ack, lastLogged);
  assert.equal(p.goal, 'steady', 'skipping must not change their goal');
  assert.equal((await request('GET', '/api/comeback')).data.show, false);
});

// ---------- reset lifecycle via /api/profile ----------

test('profile: selecting reset anywhere starts its clock', async () => {
  writeUserFile('profile.json', BASE_PROFILE);
  const r = await request('POST', '/api/profile', { goal: 'reset' });
  assert.equal(readUserFile('profile.json').reset_started, fmtDate(new Date()));
  assert.ok(r.data.stats.reset_meta, 'a reset picked from Profile draws the strip too');
  assert.equal(r.data.stats.reset_meta.day, 1);
});

test('profile: leaving reset stops the clock', async () => {
  const r = await request('POST', '/api/profile', { goal: 'steady' });
  const p = readUserFile('profile.json');
  assert.equal(p.reset_started, undefined);
  assert.equal(p.pre_reset_goal, undefined);
  assert.equal(r.data.stats.reset_meta, null);
  assert.ok(r.data.stats.kcal_goal < r.data.stats.tdee, 'the deficit is back');
});

test('profile: an unrelated edit mid-reset does not restart the clock', async () => {
  writeUserFile('profile.json', { ...BASE_PROFILE, goal: 'reset', reset_started: daysAgo(3) });
  const r = await request('POST', '/api/profile', { activity: 'active' });
  assert.equal(readUserFile('profile.json').reset_started, daysAgo(3), 'still day 4, not day 1');
  assert.equal(r.data.stats.reset_meta.day, 4);
});

test('profile: an expired reset is reported, never silently switched', async () => {
  writeUserFile('profile.json', { ...BASE_PROFILE, goal: 'reset', reset_started: daysAgo(30) });
  const r = await request('GET', '/api/profile');
  assert.equal(r.data.profile.goal, 'reset', 'the goal is the user\'s to change, not ours');
  assert.equal(r.data.stats.reset_meta.expired, true);
  assert.equal(r.data.stats.kcal_goal, r.data.stats.tdee, 'still at maintenance until they choose');
});

test('log: today response carries reset state for the strip', async () => {
  writeUserFile('profile.json', { ...BASE_PROFILE, goal: 'reset', reset_started: daysAgo(2) });
  const r = await request('GET', '/api/log');
  assert.equal(r.data.stats.reset_meta.day, 3);
  assert.equal(r.data.stats.reset_meta.expired, false);
});
