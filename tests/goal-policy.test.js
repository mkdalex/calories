const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../public/js/goal-policy');
test('calendar arithmetic remains stable across DST, leap days and year changes', () => {
  assert.equal(policy.shiftDate('2026-10-04', -1), '2026-10-03');
  assert.equal(policy.daysBetween('2026-10-01', '2026-10-15'), 14);
  assert.equal(policy.shiftDate('2024-03-01', -1), '2024-02-29');
  assert.equal(policy.shiftDate('2026-01-01', -1), '2025-12-31');
});
for (const goal of ['mild', 'steady', 'aggressive', 'maintain', 'gain', 'reset']) {
  test(goal + ': past days use a bounded target; today and missing days stay unscored', () => {
    const context = { goal, kcal_goal: 2500 };
    assert.equal(policy.assess('2026-10-15', '2026-10-15', 500, context, true), 'in_progress');
    assert.equal(policy.assess('2026-10-14', '2026-10-15', 0, context, false), 'missing');
    assert.equal(policy.assess('2026-10-14', '2026-10-15', 2400, null, true), 'unknown');
    for (const [kcal, expected] of [[500,'below'],[2300,'within'],[2700,'within'],[4000,'above']]) {
      assert.equal(policy.assess('2026-10-14', '2026-10-15', kcal, context, true), goal === 'reset' ? 'reset' : expected);
    }
  });
}
test('context lookup preserves old goals and leaves earlier unknown targets unknown', () => {
  const history = [{ effective_from:'2026-10-01', goal:'steady', kcal_goal:2000 }, { effective_from:'2026-10-10', goal:'gain', kcal_goal:2800 }];
  assert.equal(policy.contextAt(history, '2026-09-30'), null);
  assert.equal(policy.contextAt(history, '2026-10-09').goal, 'steady');
  assert.equal(policy.contextAt(history, '2026-10-10').goal, 'gain');
});
function fixture() {
  const log = {};
  for (let i=0; i<21; i++) log[policy.shiftDate('2026-09-24', i)] = [{ kcal:2500 }];
  const weights = [0,7,14,21].map(i => ({ date:policy.shiftDate('2026-09-24', i), kg:80 }));
  return { log, weights };
}
test('recent consistent records can support a provisional calibration; today is excluded', () => {
  const { log, weights } = fixture();
  log['2026-10-15'] = [{ kcal:9000 }];
  const result = policy.calibrationWindow(log, weights, '2026-10-15', '2026-09-01');
  assert.equal(result.can_calibrate, true);
  assert.equal(result.tdee_implied, 2500);
  assert.equal(result.days_logged, 21);
  assert.match(result.caveat, /cannot confirm/);
});
test('calibration rejects holiday gaps, stale weigh-ins, short spans and previous goals', () => {
  const { log, weights } = fixture();
  for (let i=7; i<14; i++) delete log[policy.shiftDate('2026-09-24', i)];
  assert.equal(policy.calibrationWindow(log, weights, '2026-10-15').can_calibrate, false);
  const complete = fixture();
  assert.equal(policy.calibrationWindow(complete.log, complete.weights, '2026-10-25').can_calibrate, false);
  assert.equal(policy.calibrationWindow(complete.log, complete.weights, '2026-10-15', '2026-10-10').can_calibrate, false);
  const short = [0,1,2,3].map(i => ({date:policy.shiftDate('2026-10-10', i),kg:80}));
  assert.equal(policy.calibrationWindow(complete.log, short, '2026-10-15').can_calibrate, false);
});

// ---------- Trend-based calibration, low-day detection, running estimate, nudges ----------
function losingFixture({ noisyLast = 0 } = {}) {
  // 28 days at 2000 kcal while losing 0.5 kg/week -> maintenance = 2000 + 0.5*7700/7 = 2550.
  const start = '2026-09-17', log = {}, weights = [];
  for (let i = 0; i < 28; i++) log[policy.shiftDate(start, i)] = [{ kcal: 2000 }];
  for (let i = 0; i <= 28; i += 2) weights.push({ date: policy.shiftDate(start, i), kg: 80 - 0.5 * i / 7 });
  if (noisyLast) weights[weights.length - 1].kg += noisyLast;
  return { log, weights, today: policy.shiftDate(start, 28) };
}

test('trend fit recovers a steady rate of loss', () => {
  const { weights } = losingFixture();
  const t = policy.weightTrend(weights);
  assert.ok(Math.abs(t.slope * 7 - -0.5) < 1e-9);
  assert.ok(t.residual_sd < 1e-9);
});

test('calibration uses every weigh-in, so one water-weight spike barely moves it', () => {
  const clean = losingFixture();
  assert.equal(policy.calibrationWindow(clean.log, clean.weights, clean.today).tdee_implied, 2550);
  const noisy = losingFixture({ noisyLast: 1 });
  const r = policy.calibrationWindow(noisy.log, noisy.weights, noisy.today);
  assert.equal(r.can_calibrate, true);
  // First-vs-last would be off by 1 kg * 7700 / 28 = 275 kcal; the trend is far less sensitive.
  assert.ok(Math.abs(r.tdee_implied - 2550) < 120, 'got ' + r.tdee_implied);
  // ...and the estimate's range widens to reflect the noise.
  assert.ok(r.estimate.range > policy.calibrationWindow(clean.log, clean.weights, clean.today).estimate.range);
});

test('days far below typical intake are flagged and left out until confirmed', () => {
  const { log, weights, today } = losingFixture();
  const missed = ['2026-09-20', '2026-09-27'];
  for (const d of missed) log[d] = [{ kcal: 600 }];
  const r = policy.calibrationWindow(log, weights, today);
  assert.deepEqual(r.low_days.map(d => d.date), missed);
  assert.equal(r.low_days[0].typical_kcal, 2000);
  assert.equal(r.days_used, 26);
  assert.equal(r.tdee_implied, 2550);
  const confirmed = policy.calibrationWindow(log, weights, today, null, { confirmed: missed });
  assert.equal(confirmed.low_days.length, 0);
  assert.equal(confirmed.days_used, 28);
  assert.ok(confirmed.tdee_implied < 2550);
});

test('too many incomplete-looking days blocks applying a calibration', () => {
  const { log, weights } = losingFixture();
  const short = weights.filter(w => w.date <= '2026-10-01'); // 14-day span, 14 logged days
  for (let i = 0; i < 14; i += 2) log[policy.shiftDate('2026-09-17', i)] = [{ kcal: 500 }]; // 7 low, 7 normal
  const r = policy.calibrationWindow(log, short, '2026-10-01');
  assert.equal(r.low_days.length, 7);
  assert.equal(r.can_calibrate, false);
  assert.match(r.reason, /incomplete/);
});

test('a running estimate with a range appears before calibration is allowed', () => {
  const { log, weights } = losingFixture();
  const early = weights.slice(0, 5); // 8 days of data
  const r = policy.calibrationWindow(log, early, early[early.length - 1].date);
  assert.equal(r.can_calibrate, false);
  assert.ok(r.estimate);
  assert.ok(r.estimate.low <= r.estimate.tdee && r.estimate.tdee <= r.estimate.high);
  assert.ok(['high', 'medium', 'low'].includes(r.estimate.confidence));
  assert.equal(policy.calibrationWindow(log, weights.slice(0, 2), weights[1].date).estimate, null);
});

test('nudges: ready only when the difference is worth acting on; review when stale; none in reset', () => {
  const ready = { can_calibrate: true, tdee_implied: 2550, low_days: [] };
  assert.equal(policy.calibrationNudge({ tdee: 2300, goal: 'steady' }, ready).type, 'ready');
  assert.equal(policy.calibrationNudge({ tdee: 2300, goal: 'steady' }, ready).diff, 250);
  assert.equal(policy.calibrationNudge({ tdee: 2500, goal: 'steady' }, ready), null);
  assert.equal(policy.calibrationNudge({ tdee: 2500, goal: 'steady', override_review: true }, ready).type, 'review');
  assert.equal(policy.calibrationNudge({ tdee: 2300, goal: 'reset' }, ready), null);
  assert.equal(policy.calibrationNudge({ tdee: 2500, goal: 'steady' }, { can_calibrate: false, weigh_ins: 5, low_days: [{}] }).type, 'low_days');
});
