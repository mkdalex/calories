const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const SERVER = path.join(__dirname, '..', 'server.js');
const READY_BANNER = /Calorie tracker running/;

function runServerSync(env, timeoutMs = 3000) {
  return spawnSync(process.execPath, [SERVER], {
    env: { ...env, PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true
  });
}

// Spawn the server and resolve as soon as it prints the ready banner or exits.
// Returns { kind: 'started' | 'exited', child, stdout, stderr, code? }.
function spawnAndWait(env, timeoutMs = 3000) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...env, PATH: process.env.PATH },
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: 'timeout', child, stdout, stderr }), timeoutMs);
    child.stdout.on('data', d => {
      stdout += d;
      if (READY_BANNER.test(stdout)) {
        clearTimeout(timer);
        resolve({ kind: 'started', child, stdout, stderr });
      }
    });
    child.stderr.on('data', d => { stderr += d; });
    child.once('exit', code => {
      clearTimeout(timer);
      resolve({ kind: 'exited', child, stdout, stderr, code });
    });
  });
}

async function killAndWait(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise(r => child.once('exit', r));
}

test('startup: SESSION_SECRET fail-fast in production', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calories-startup-'));
  t.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

  await t.test('exits with non-zero status when SESSION_SECRET is missing in prod', () => {
    const r = runServerSync({ NODE_ENV: 'production', CALORIES_DATA_DIR: tmp });
    assert.notEqual(r.status, 0, 'process should fail to boot');
    assert.match(r.stderr, /SESSION_SECRET/, 'stderr should explain why');
  });

  await t.test('starts successfully when SESSION_SECRET is set in prod', async () => {
    const result = await spawnAndWait({
      NODE_ENV: 'production',
      SESSION_SECRET: 'test-secret-do-not-use-in-real-deploys',
      CALORIES_DATA_DIR: tmp
    });
    await killAndWait(result.child);
    assert.equal(result.kind, 'started', `expected boot banner; got ${result.kind} (stderr: ${result.stderr})`);
    assert.doesNotMatch(result.stderr, /FATAL/);
  });

  await t.test('does NOT fail-fast in development even without SESSION_SECRET', async () => {
    // NODE_ENV unset → not production → fallback secret is allowed
    const result = await spawnAndWait({ CALORIES_DATA_DIR: tmp });
    await killAndWait(result.child);
    assert.equal(result.kind, 'started', `dev mode should boot; got ${result.kind} (stderr: ${result.stderr})`);
    assert.doesNotMatch(result.stderr, /FATAL/);
  });
});
