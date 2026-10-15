/* Shared by Express and the browser. Calendar dates are handled without DST arithmetic. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GoalPolicy = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TOLERANCE = 200;
  const LABELS = { mild: 'Lose fat', steady: 'Lose fat', aggressive: 'Lose fat', maintain: 'Maintain', gain: 'Build muscle', reset: 'Reset week' };
  function shiftDate(date, offset) {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }
  function contextAt(history, date) {
    return (history || []).filter(x => x.effective_from <= date)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from)).pop() || null;
  }
  function assess(date, today, kcal, context, logged) {
    if (date > today) return 'future';
    if (date === today) return 'in_progress';
    if (!logged) return 'missing';
    if (!context || !Number.isFinite(context.kcal_goal)) return 'unknown';
    if (context.goal === 'reset') return 'reset';
    if (kcal < context.kcal_goal - TOLERANCE) return 'below';
    if (kcal > context.kcal_goal + TOLERANCE) return 'above';
    return 'within';
  }
  function coverage(log, start, end) {
    let days = 0, logged = 0, gap = 0, longestGap = 0;
    // End is exclusive: the end weigh-in happens before that day's food intake.
    for (let date = start; date < end; date = shiftDate(date, 1)) {
      days++;
      if ((log[date] || []).length) { logged++; gap = 0; }
      else { gap++; longestGap = Math.max(longestGap, gap); }
    }
    return { days, logged, ratio: days ? logged / days : 0, longest_gap: longestGap };
  }
  function calibrationWindow(log, weights, today, since) {
    const cutoff = [shiftDate(today, -42), since || '0000-00-00'].sort().pop();
    const recent = weights.filter(w => w.date >= cutoff && w.date <= today && Number.isFinite(w.kg) && w.kg > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const result = { can_calibrate: false, window_start: cutoff, window_end: today };
    if (recent.length < 4) return { ...result, reason: 'Need at least 4 recent weigh-ins in the current goal period (last 42 days).' };
    const first = recent[0], last = recent[recent.length - 1];
    const span = daysBetween(first.date, last.date);
    const c = coverage(log, first.date, last.date);
    Object.assign(result, { days_span: span, days_logged: c.logged, coverage: c.ratio,
      weight_start: first.kg, weight_end: last.kg, weight_start_date: first.date, weight_end_date: last.date });
    if (daysBetween(last.date, today) > 7) return { ...result, reason: 'The latest weigh-in is more than 7 days old. Add a recent measurement before reviewing maintenance.' };
    if (span < 14) return { ...result, reason: 'Need at least 14 days between recent weigh-ins.' };
    if (c.logged < 14 || c.ratio < 0.9 || c.longest_gap > 2) return { ...result, reason: 'Need food logs on at least 90% of this recent period, including 14 past days and no gap longer than 2 days. Missing intake is unknown.' };
    let total = 0;
    for (let date = first.date; date < last.date; date = shiftDate(date, 1)) {
      total += (log[date] || []).reduce((sum, e) => sum + (Number(e.kcal) || 0), 0);
    }
    const average = total / c.logged;
    const implied = Math.round(average - (last.kg - first.kg) * 7700 / span);
    if (implied < 1200 || implied > 5000) return { ...result, reason: 'This estimate falls outside the review range. Check the food and weight records before applying it.' };
    return { ...result, can_calibrate: true, avg_kcal: Math.round(average), tdee_implied: implied,
      weight_delta_kg: Math.round((last.kg - first.kg) * 100) / 100,
      caveat: 'Logging coverage cannot confirm that every meal was recorded. This is an approximate estimate; missing intake and short-term weight changes can affect it.' };
  }
  return { TOLERANCE, LABELS, shiftDate, daysBetween, contextAt, assess, coverage, calibrationWindow };
});
