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
