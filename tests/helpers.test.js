const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  round1, fmtDate, todayStr,
  readJson, writeJson, withFileLock,
  normalizeFoodName, customLookup, isRelevantMatch
} = require('../server.js');

test('round1', async (t) => {
  await t.test('rounds to one decimal place', () => {
    assert.equal(round1(3.14159), 3.1);
    assert.equal(round1(3.15), 3.2);
    assert.equal(round1(0.04), 0);
  });

  await t.test('coerces strings to numbers', () => {
    assert.equal(round1('2.55'), 2.6);
    assert.equal(round1('  1.1  '), 1.1);
  });

  await t.test('returns 0 for null/undefined/NaN/non-numeric strings', () => {
    assert.equal(round1(null), 0);
    assert.equal(round1(undefined), 0);
    assert.equal(round1(NaN), 0);
    assert.equal(round1('not a number'), 0);
  });

  await t.test('handles negatives', () => {
    assert.equal(round1(-2.66), -2.7);
  });
});

test('fmtDate / todayStr', async (t) => {
  await t.test('zero-pads month and day', () => {
    assert.equal(fmtDate(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(fmtDate(new Date(2026, 8, 9)), '2026-09-09');
  });

  await t.test('uses local components (not UTC) so day does not shift', () => {
    // Construct a date that is e.g. midnight local time. toISOString().slice(0,10)
    // would shift in any non-UTC timezone — fmtDate must not.
    const d = new Date(2026, 4, 15, 0, 0, 0);
    assert.equal(fmtDate(d), '2026-05-15');
  });

  await t.test('todayStr matches fmtDate(now) within the same millisecond window', () => {
    const a = todayStr();
    const b = fmtDate(new Date());
    assert.equal(a, b);
  });
});

test('readJson / writeJson roundtrip', async (t) => {
  const tmp = path.join(os.tmpdir(), `calories-test-${Date.now()}-${Math.random()}.json`);
  t.after(() => { try { fs.unlinkSync(tmp); } catch {} });

  await t.test('readJson returns fallback when file missing', () => {
    assert.deepEqual(readJson(tmp, []), []);
    assert.deepEqual(readJson(tmp, { x: 1 }), { x: 1 });
  });

  await t.test('writeJson then readJson roundtrip preserves value', () => {
    writeJson(tmp, { name: 'apple', kcal: 95 });
    assert.deepEqual(readJson(tmp, null), { name: 'apple', kcal: 95 });
  });

  await t.test('readJson returns fallback on parse error', () => {
    fs.writeFileSync(tmp, 'not valid json {');
    assert.deepEqual(readJson(tmp, { fallback: true }), { fallback: true });
  });
});

test('withFileLock', async (t) => {
  await t.test('serializes operations on the same path', async () => {
    const order = [];
    const op = (label, ms) => () => new Promise(resolve => {
      order.push(`start-${label}`);
      setTimeout(() => { order.push(`end-${label}`); resolve(label); }, ms);
    });
    // Fire both without awaiting — they race on the same path.
    // If serial: order is start-A end-A start-B end-B.
    const [a, b] = await Promise.all([
      withFileLock('/test/same', op('A', 30)),
      withFileLock('/test/same', op('B', 10))
    ]);
    assert.equal(a, 'A');
    assert.equal(b, 'B');
    assert.deepEqual(order, ['start-A', 'end-A', 'start-B', 'end-B']);
  });

  await t.test('different paths run in parallel', async () => {
    const order = [];
    const op = (label, ms) => () => new Promise(resolve => {
      order.push(`start-${label}`);
      setTimeout(() => { order.push(`end-${label}`); resolve(label); }, ms);
    });
    // Different paths — both starts should happen before either end.
    await Promise.all([
      withFileLock('/test/path-x', op('X', 25)),
      withFileLock('/test/path-y', op('Y', 25))
    ]);
    // Both starts come before both ends (parallel execution)
    const startX = order.indexOf('start-X');
    const startY = order.indexOf('start-Y');
    const endX = order.indexOf('end-X');
    const endY = order.indexOf('end-Y');
    assert.ok(startX < endY, 'X should start before Y ends');
    assert.ok(startY < endX, 'Y should start before X ends');
  });

  await t.test('a failed operation does not poison the chain', async () => {
    const path = '/test/poison';
    await assert.rejects(
      withFileLock(path, () => Promise.reject(new Error('boom'))),
      /boom/
    );
    // Next op on same path should still run
    const result = await withFileLock(path, () => Promise.resolve('still works'));
    assert.equal(result, 'still works');
  });

  await t.test('returns the value the operation resolved to', async () => {
    const result = await withFileLock('/test/return-val', () => Promise.resolve(42));
    assert.equal(result, 42);
  });
});

test('normalizeFoodName', async (t) => {
  await t.test('lowercases and collapses whitespace', () => {
    assert.equal(normalizeFoodName('  Apple Pie  '), 'apple pie');
    assert.equal(normalizeFoodName('Chicken    Breast'), 'chicken breast');
  });

  await t.test('strips punctuation', () => {
    assert.equal(normalizeFoodName("Mum's apple-pie!"), 'mums applepie');
    assert.equal(normalizeFoodName('Rice (cooked)'), 'rice cooked');
  });

  await t.test('keeps digits', () => {
    assert.equal(normalizeFoodName('2% milk'), '2 milk');
  });
});

test('customLookup', async (t) => {
  const customs = {
    'protein shake': { name: 'Protein Shake', kcal: 200, protein: 30 },
    'chicken breast': { name: 'Chicken Breast', kcal: 165, protein: 31 }
  };

  await t.test('finds exact normalized match', () => {
    assert.equal(customLookup(customs, 'Protein Shake').kcal, 200);
  });

  await t.test('case-insensitive and whitespace-tolerant via normalize', () => {
    assert.equal(customLookup(customs, 'CHICKEN  BREAST').kcal, 165);
    assert.equal(customLookup(customs, '  chicken breast  ').kcal, 165);
  });

  await t.test('returns null when no match', () => {
    assert.equal(customLookup(customs, 'banana'), null);
  });
});

test('isRelevantMatch', async (t) => {
  await t.test('confirms good matches', () => {
    assert.equal(isRelevantMatch('chicken breast', 'Chicken, breast, raw'), true);
    assert.equal(isRelevantMatch('apple', 'Apple, fresh'), true);
  });

  await t.test('rejects bad matches', () => {
    assert.equal(isRelevantMatch('beef steak', 'Emu, full rump'), false);
    assert.equal(isRelevantMatch('chicken', 'beef'), false);
  });

  await t.test('returns false when dbName is empty/null', () => {
    assert.equal(isRelevantMatch('apple', ''), false);
    assert.equal(isRelevantMatch('apple', null), false);
  });

  await t.test('benefit-of-doubt when one side has only stop words', () => {
    // 'a cup of' becomes empty after stop-word filter — give benefit of doubt
    assert.equal(isRelevantMatch('a cup of', 'some food'), true);
  });

  await t.test('substring match works (chicken matches chickenwing)', () => {
    assert.equal(isRelevantMatch('chicken', 'Chicken-wing'), true);
  });
});
