const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const SERVER = path.join(__dirname, '..', 'server.js');

// Spawn server.js with controlled env. Returns { status, stdout, stderr }.
// Use spawnSync for tests that expect the process to exit quickly.
function runServerSync(env, timeoutMs = 3000) {
  return spawnSync(process.execPath, [SERVER], {
    env: { ...env, PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true
  });
}

test('startup: SESSION_SECRET fail-fast in production', async (t) => {
  // Isolate any side-effect writes into a tmpdir so this test doesn't pollute data/.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calories-startup-'));
  t.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

  await t.test('exits with non-zero status when SESSION_SECRET is missing in prod', () => {
    const r = runServerSync({
      NODE_ENV: 'production',
      CALORIES_DATA_DIR: tmp,
      // SESSION_SECRET deliberately unset
    });
    assert.notEqual(r.status, 0, 'process should fail to boot');
    assert.match(r.stderr, /SESSION_SECRET/, 'stderr should explain why');
  });

  await t.test('starts successfully when SESSION_SECRET is set in prod', async () => {
    // Spawn async so we can let it bind, then kill it.
    const child = spawn(process.execPath, [SERVER], {
      env: {
        NODE_ENV: 'production',
        SESSION_SECRET: 'test-secret-do-not-use-in-real-deploys',
        CALORIES_DATA_DIR: tmp,
        PORT: '0', // ignored by the app (PORT is captured as a number), but harmless
        PATH: process.env.PATH
      },
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    // Give it 500ms to boot or crash.
    await new Promise(r => setTimeout(r, 500));
    // If it exited already, that's a failure.
    if (child.exitCode !== null) {
      throw new Error(`Server exited prematurely (code=${child.exitCode}). stderr: ${stderr}`);
    }
    child.kill();
    // Wait for full shutdown so the next test can reuse the port.
    await new Promise(r => child.on('exit', r));
    assert.doesNotMatch(stderr, /FATAL/, 'should not have logged a FATAL message');
    assert.match(stdout, /Calorie tracker running/, 'should have logged a startup banner');
  });

  await t.test('does NOT fail-fast in development even without SESSION_SECRET', async () => {
    const child = spawn(process.execPath, [SERVER], {
      env: {
        // NODE_ENV unset → not production → SESSION_SECRET fallback is OK in dev
        CALORIES_DATA_DIR: tmp,
        PATH: process.env.PATH
      },
      windowsHide: true
    });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    await new Promise(r => setTimeout(r, 500));
    const exitedEarly = child.exitCode !== null;
    child.kill();
    await new Promise(r => child.on('exit', r));
    assert.equal(exitedEarly, false, 'dev mode should not fail-fast');
    assert.doesNotMatch(stderr, /FATAL/);
  });
});
