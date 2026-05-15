const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// IMPORTANT: env vars must be set BEFORE requiring server.js because constants like
// DATA_DIR / USERS_DIR are captured at module load.
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'calories-api-'));
process.env.CALORIES_DATA_DIR = TMP_DATA;
process.env.SESSION_SECRET = 'test-secret-for-api-tests';
// NODE_ENV stays unset → dev mode → secure-cookie disabled, fail-fast disabled.

const { app, createTestSession } = require('../server.js');

const TEST_USER = { id: 'test-user', username: 'tester', global_name: 'Tester' };
let server;
let baseUrl;
let cookie;

test.before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  cookie = createTestSession(TEST_USER);
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(TMP_DATA, { recursive: true, force: true }); } catch {}
});

async function request(method, urlPath, { body, withAuth = true, raw = false } = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (withAuth) opts.headers.Cookie = cookie;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${baseUrl}${urlPath}`, opts);
  if (raw) return r;
  let data = null;
  const text = await r.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: r.status, data, headers: r.headers };
}

// ---------- Auth gate ----------

test('auth: 401 on protected route without cookie', async () => {
  const r = await request('GET', '/api/log', { withAuth: false });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'not_authenticated');
});

test('auth: 200 on protected route with valid test cookie', async () => {
  // Need a profile first; without one the response shape changes but auth still passes
  await request('POST', '/api/profile', {
    body: { height_cm: 180, weight_kg: 80, age: 30, sex: 'male', activity: 'moderate', goal: 'maintain' }
  });
  const r = await request('GET', '/api/log');
  assert.equal(r.status, 200);
  assert.ok('totals' in r.data, '/api/log response should carry totals');
  assert.ok('entries' in r.data, '/api/log response should carry entries');
});

// ---------- Profile ----------

test('profile: POST then GET roundtrip', async () => {
  const post = await request('POST', '/api/profile', {
    body: { height_cm: 175, weight_kg: 75, age: 25, sex: 'female', activity: 'light', goal: 'steady' }
  });
  assert.equal(post.status, 200);
  assert.equal(post.data.profile.height_cm, 175);
  assert.ok(post.data.stats, 'stats should be computed');
  assert.ok(post.data.stats.kcal_goal > 0);

  const get = await request('GET', '/api/profile');
  assert.equal(get.status, 200);
  // GET returns { profile, stats, activity_options, goal_options }
  assert.equal(get.data.profile.height_cm, 175);
});

test('profile: POST merges (does not overwrite unrelated fields)', async () => {
  // Set a baseline
  await request('POST', '/api/profile', {
    body: { height_cm: 175, weight_kg: 75, age: 25, sex: 'female', activity: 'light', goal: 'steady' }
  });
  // Patch only weight
  await request('POST', '/api/profile', { body: { weight_kg: 73 } });
  const get = await request('GET', '/api/profile');
  assert.equal(get.data.profile.weight_kg, 73);
  assert.equal(get.data.profile.height_cm, 175, 'unrelated field should survive');
});

// ---------- Log ----------

test('log: POST validates name', async () => {
  const r = await request('POST', '/api/log', { body: { kcal: 100 } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /name required/);
});

test('log: full CRUD cycle', async () => {
  // Create
  const created = await request('POST', '/api/log', {
    body: { name: 'banana', kcal: 105, protein: 1.3, fat: 0.4, carb: 27, fiber: 3.1 }
  });
  assert.equal(created.status, 200);
  const entryId = created.data.entry.id;
  assert.ok(entryId);
  assert.equal(created.data.entry.kcal, 105);

  // Read via /api/today
  const today = await request('GET', '/api/log');
  const found = today.data.entries.find(e => e.id === entryId);
  assert.ok(found, 'entry should appear in today');
  assert.equal(found.name, 'banana');

  // PATCH
  const dateKey = today.data.date;
  const patched = await request('PATCH', `/api/log/${dateKey}/${entryId}`, {
    body: { kcal: 120 }
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.entry.kcal, 120);

  // DELETE
  const del = await request('DELETE', `/api/log/${dateKey}/${entryId}`);
  assert.equal(del.status, 200);

  // Confirm gone
  const after = await request('GET', '/api/log');
  assert.equal(after.data.entries.find(e => e.id === entryId), undefined);
});

test('log: PATCH on non-existent date returns 404', async () => {
  const r = await request('PATCH', '/api/log/1999-01-01/some-id', { body: { kcal: 10 } });
  assert.equal(r.status, 404);
});

test('log: PATCH on non-existent entry returns 404', async () => {
  // Log something to ensure today's date exists in the log
  await request('POST', '/api/log', { body: { name: 'temp', kcal: 50 } });
  const today = await request('GET', '/api/log');
  const r = await request('PATCH', `/api/log/${today.data.date}/no-such-id`, { body: { kcal: 10 } });
  assert.equal(r.status, 404);
});

// ---------- Water (the canonical race-condition surface from the audit) ----------

test('water: POST then GET total', async () => {
  // Reset: delete any water from today
  const before = await request('GET', '/api/water');
  for (const e of before.data.entries) {
    await request('DELETE', `/api/water/${e.id}`);
  }
  const post = await request('POST', '/api/water', { body: { ml: 250 } });
  assert.equal(post.status, 200);
  assert.equal(post.data.total_ml, 250);

  const second = await request('POST', '/api/water', { body: { ml: 500 } });
  assert.equal(second.data.total_ml, 750);
});

test('water: 10 concurrent POSTs all persist (race-condition regression)', async () => {
  // Reset
  const before = await request('GET', '/api/water');
  for (const e of before.data.entries) {
    await request('DELETE', `/api/water/${e.id}`);
  }
  // Fire 10 simultaneous requests. Without withFileLock, the read-modify-write race
  // would drop some entries; with it, all 10 must land.
  const N = 10;
  await Promise.all(Array.from({ length: N }, () =>
    request('POST', '/api/water', { body: { ml: 100 } })
  ));
  const after = await request('GET', '/api/water');
  assert.equal(after.data.entries.length, N, `expected all ${N} entries to persist`);
  assert.equal(after.data.total_ml, N * 100);
});

// ---------- Templates ----------

test('templates: create, list, delete', async () => {
  const created = await request('POST', '/api/templates', {
    body: {
      name: 'My Smoothie',
      items: [{ name: 'banana', kcal: 105, protein: 1.3 }, { name: 'milk', kcal: 150, protein: 8 }]
    }
  });
  assert.equal(created.status, 200);
  const id = created.data.id;
  assert.equal(created.data.totals.kcal, 255);

  const list = await request('GET', '/api/templates');
  assert.ok(list.data.find(t => t.id === id), 'template should be listed');

  const del = await request('DELETE', `/api/templates/${id}`);
  assert.equal(del.status, 200);
  const after = await request('GET', '/api/templates');
  assert.equal(after.data.find(t => t.id === id), undefined);
});

test('templates: POST without items returns 400', async () => {
  const r = await request('POST', '/api/templates', { body: { name: 'empty' } });
  assert.equal(r.status, 400);
});

// ---------- Custom foods ----------

test('custom-foods: POST, PATCH, DELETE', async () => {
  const create = await request('POST', '/api/custom-foods', {
    body: { name: 'My Protein Shake', kcal: 200, protein: 30 }
  });
  assert.equal(create.status, 200);
  assert.equal(create.data.kcal, 200);

  // The server's GET returns the keyed dict
  const list = await request('GET', '/api/custom-foods');
  const key = Object.keys(list.data).find(k => list.data[k].name === 'My Protein Shake');
  assert.ok(key, 'custom food should appear');

  // Patch
  const patched = await request('PATCH', `/api/custom-foods/${encodeURIComponent(key)}`, {
    body: { kcal: 220 }
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.kcal, 220);

  // Delete
  const del = await request('DELETE', `/api/custom-foods/${encodeURIComponent(key)}`);
  assert.equal(del.status, 200);
  const after = await request('GET', '/api/custom-foods');
  assert.equal(after.data[key], undefined);
});

test('custom-foods: POST without kcal returns 400', async () => {
  const r = await request('POST', '/api/custom-foods', { body: { name: 'no kcal' } });
  assert.equal(r.status, 400);
});

// ---------- Favorites (cache test) ----------

test('favorites: returns top foods by frequency and is cached', async () => {
  // Seed: log "rice" 3x and "salad" 1x
  for (let i = 0; i < 3; i++) {
    await request('POST', '/api/log', { body: { name: 'rice', kcal: 200, protein: 4 } });
  }
  await request('POST', '/api/log', { body: { name: 'salad', kcal: 100, protein: 2 } });

  const first = await request('GET', '/api/favorites');
  assert.equal(first.status, 200);
  const rice = first.data.find(f => f.name === 'rice');
  assert.ok(rice);
  assert.ok(rice.count >= 3, `rice count ${rice.count} should be ≥3`);

  // Second call within the same mtime should still be fast and consistent
  const second = await request('GET', '/api/favorites');
  assert.deepEqual(first.data, second.data, 'cached response should match first');
});

// ---------- Export ----------

test('export/json: returns a complete bundle', async () => {
  const r = await request('GET', '/api/export/json', { raw: true });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/json/);
  const json = JSON.parse(await r.text());
  assert.ok(json.exported_at);
  assert.equal(json.user_id, TEST_USER.id);
  assert.ok('log' in json);
  assert.ok('profile' in json);
});

test('export/csv: returns text/csv with the header row', async () => {
  const r = await request('GET', '/api/export/csv', { raw: true });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  const text = await r.text();
  assert.match(text, /^date,time,name,kcal,protein_g,fat_g,carb_g,fiber_g,source/);
});
