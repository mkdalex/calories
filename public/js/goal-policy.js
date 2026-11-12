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
  const KCAL_PER_KG = 7700;
  // A logged day below this share of the period's median intake looks like a
  // forgotten meal rather than a real low day.
  const LOW_DAY_RATIO = 0.55;

  // Least-squares line through every weigh-in. One noisy reading (water, salt,
  // a late meal) barely moves it, unlike a first-vs-last comparison.
  function weightTrend(points) {
    const n = points.length;
    if (n < 2) return null;
    const origin = points[0].date;
    const xs = points.map(p => daysBetween(origin, p.date)), ys = points.map(p => p.kg);
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
    if (!sxx) return null;
    const slope = sxy / sxx, intercept = my - slope * mx;
    let sse = 0;
    for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
    const residualSd = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
    return { origin, slope, intercept, residual_sd: residualSd, slope_se: n > 2 ? residualSd / Math.sqrt(sxx) : null, n,
      at: date => intercept + slope * daysBetween(origin, date) };
  }

  function dayKcal(entries) { return (entries || []).reduce((sum, e) => sum + (Number(e.kcal) || 0), 0); }

  // Logged days in [start, end) far below the period's typical intake. Confirmed
  // days were reviewed by the user as genuinely complete and are never flagged.
  function lowDays(log, start, end, confirmed) {
    const ok = new Set(confirmed || []);
    const days = [];
    for (let date = start; date < end; date = shiftDate(date, 1)) {
      if ((log[date] || []).length) days.push({ date, kcal: dayKcal(log[date]) });
    }
    if (days.length < 5) return [];
    const sorted = days.map(d => d.kcal).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    if (median <= 0) return [];
    return days.filter(d => d.kcal < median * LOW_DAY_RATIO && !ok.has(d.date))
      .map(d => ({ ...d, typical_kcal: Math.round(median) }));
  }

  function confidenceOf(halfWidth) { return halfWidth <= 150 ? 'high' : halfWidth <= 300 ? 'medium' : 'low'; }

  function calibrationWindow(log, weights, today, since, opts) {
    const cutoff = [shiftDate(today, -42), since || '0000-00-00'].sort().pop();
    const recent = weights.filter(w => w.date >= cutoff && w.date <= today && Number.isFinite(w.kg) && w.kg > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const result = { can_calibrate: false, window_start: cutoff, window_end: today, estimate: null, low_days: [], weigh_ins: recent.length };
    const fail = reason => ({ ...result, reason });
    if (recent.length < 2) return fail('Need at least 4 recent weigh-ins in the current goal period (last 42 days).');

    const first = recent[0], last = recent[recent.length - 1];
    const span = daysBetween(first.date, last.date);
    const c = coverage(log, first.date, last.date);
    const flagged = lowDays(log, first.date, last.date, opts && opts.confirmed);
    const skip = new Set(flagged.map(d => d.date));
    let total = 0, used = 0;
    for (let date = first.date; date < last.date; date = shiftDate(date, 1)) {
      if (!(log[date] || []).length || skip.has(date)) continue;
      total += dayKcal(log[date]); used++;
    }
    const trend = weightTrend(recent);
    Object.assign(result, { days_span: span, days_logged: c.logged, days_used: used, coverage: c.ratio, low_days: flagged,
      weight_start: first.kg, weight_end: last.kg, weight_start_date: first.date, weight_end_date: last.date });

    // Running estimate: shown with a range as soon as there is something to go on,
    // well before the stricter bar for applying it as the saved maintenance value.
    if (trend && recent.length >= 3 && span >= 7 && used >= 7 && c.ratio >= 0.8 && c.longest_gap <= 3) {
      const average = total / used;
      const tdee = average - trend.slope * KCAL_PER_KG;
      // Small samples get a wider multiplier; the flat +100 covers logging error and
      // the 7,700 kcal/kg approximation, which no amount of weigh-ins removes.
      const mult = recent.length <= 4 ? 3 : recent.length <= 7 ? 2.4 : 2;
      const half = Math.round((mult * (trend.slope_se || 0) * KCAL_PER_KG + 100) / 10) * 10;
      result.estimate = { tdee: Math.round(tdee), low: Math.round((tdee - half) / 10) * 10, high: Math.round((tdee + half) / 10) * 10,
        range: half, confidence: confidenceOf(half), avg_kcal: Math.round(average),
        kg_per_week: Math.round(trend.slope * 7 * 100) / 100 };
      Object.assign(result, { trend_start: Math.round(trend.at(first.date) * 100) / 100, trend_end: Math.round(trend.at(last.date) * 100) / 100 });
    }

    if (recent.length < 4) return fail('Need at least 4 recent weigh-ins in the current goal period (last 42 days).');
    if (daysBetween(last.date, today) > 7) return fail('The latest weigh-in is more than 7 days old. Add a recent measurement before reviewing maintenance.');
    if (span < 14) return fail('Need at least 14 days between recent weigh-ins.');
    if (c.logged < 14 || c.ratio < 0.9 || c.longest_gap > 2) return fail('Need food logs on at least 90% of this recent period, including 14 past days and no gap longer than 2 days. Missing intake is unknown.');
    if (used < 10) return fail('Too many days in this period look incomplete. Review the flagged days, or keep logging full days.');
    const average = total / used;
    const implied = Math.round(average - trend.slope * KCAL_PER_KG);
    if (implied < 1200 || implied > 5000) return fail('This estimate falls outside the review range. Check the food and weight records before applying it.');
    return { ...result, can_calibrate: true, avg_kcal: Math.round(average), tdee_implied: implied,
      weight_delta_kg: Math.round(trend.slope * span * 100) / 100,
      caveat: 'Logging coverage cannot confirm that every meal was recorded. This is an approximate estimate; missing intake and short-term weight changes can affect it.' };
  }

  // What, if anything, the Today screen should prompt about. Small differences
  // aren't worth acting on given the estimate's own uncertainty.
  function calibrationNudge(stats, review) {
    if (!stats || stats.goal === 'reset' || !review) return null;
    if (review.can_calibrate && Math.abs(review.tdee_implied - stats.tdee) >= 100) {
      return { type: 'ready', suggested: review.tdee_implied, current: stats.tdee, diff: review.tdee_implied - stats.tdee };
    }
    if (stats.override_review) return { type: 'review', current: stats.tdee };
    if (review.low_days && review.low_days.length && review.weigh_ins >= 4) return { type: 'low_days', count: review.low_days.length };
    return null;
  }

  return { TOLERANCE, LABELS, KCAL_PER_KG, shiftDate, daysBetween, contextAt, assess, coverage, weightTrend, lowDays,
    calibrationWindow, calibrationNudge };
});
