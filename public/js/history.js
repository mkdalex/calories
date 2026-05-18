// ---------- HISTORY ----------
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let calRangeData = {}; // date -> { kcal, goal }
let calSelectedDate = null;

// ===== Predicted vs Actual — "Are you on track?" =====
async function renderPredictedActual() {
  const card = $('#predictedActualCard');
  if (!card) return;
  const [weights, profile] = await Promise.all([
    api('/api/weight'),
    api('/api/profile')
  ]);
  const tdee = profile && profile.stats ? profile.stats.tdee : null;
  if (!tdee || weights.length < 2) {
    card.innerHTML = `<h2>Are you on track?</h2>
      <div style="color:var(--text-dim);font-size:13px;padding:8px 0;">Log at least 2 weights and set up your profile — then I'll compare what your body's actually doing against what the calorie math predicts.</div>`;
    return;
  }
  const first = weights[0];
  const last = weights[weights.length - 1];
  const startStr = first.date;
  const endStr = last.date;
  const rangeData = await api(`/api/log-range?start=${startStr}&end=${endStr}`);

  // Build day-by-day series
  const startD = new Date(startStr + 'T00:00:00');
  const endD = new Date(endStr + 'T00:00:00');
  const dayMs = 86400000;
  const series = [];
  let cumDeficit = 0;
  const weightByDate = {};
  weights.forEach(w => weightByDate[w.date] = w.kg);
  let unloggedDays = 0;
  for (let t = startD.getTime(); t <= endD.getTime(); t += dayMs) {
    const d = new Date(t);
    const ds = fmtDate(d);
    const dayData = rangeData[ds];
    const eaten = dayData ? dayData.kcal : null;
    if (eaten !== null) cumDeficit += (tdee - eaten);
    else unloggedDays += 1;
    const predicted = first.kg - cumDeficit / 7700;
    series.push({ date: ds, predicted, actual: weightByDate[ds] !== undefined ? weightByDate[ds] : null });
  }

  // Chart
  const W = 600, H = 200;
  const PAD = { l: 38, r: 12, t: 14, b: 36 };
  const chartW = W - PAD.l - PAD.r, chartH = H - PAD.t - PAD.b;
  const allKg = [...series.map(s => s.predicted), ...weights.map(w => w.kg)];
  const yMin = Math.min(...allKg) - 0.4;
  const yMax = Math.max(...allKg) + 0.4;
  const yRange = Math.max(0.6, yMax - yMin);
  const xOf = i => PAD.l + (series.length > 1 ? (i / (series.length - 1)) * chartW : chartW / 2);
  const yOf = kg => PAD.t + ((yMax - kg) / yRange) * chartH;

  let predPath = '';
  series.forEach((p, i) => {
    const cmd = predPath === '' ? 'M' : 'L';
    predPath += `${cmd}${xOf(i).toFixed(1)},${yOf(p.predicted).toFixed(1)} `;
  });
  // Connect all actual weigh-ins as one continuous line (ignoring gaps between weighings)
  // and drop a dot on each measurement so they're visible even when isolated.
  let actPath = '';
  const actDots = [];
  weights.forEach((w, i) => {
    const wD = new Date(w.date + 'T00:00:00');
    const idx = Math.round((wD - startD) / dayMs);
    const x = xOf(idx);
    const y = yOf(w.kg);
    actPath += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
    actDots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="var(--info)"/>`);
  });
  const yTicks = [yMax, (yMax + yMin) / 2, yMin].map(v => Math.round(v * 10) / 10);
  const ticks = yTicks.map(v => `
    <text x="${PAD.l - 6}" y="${yOf(v) + 3}" text-anchor="end" fill="var(--text-dim)" font-size="9">${v}</text>
    <line x1="${PAD.l}" y1="${yOf(v)}" x2="${W - PAD.r}" y2="${yOf(v)}" stroke="var(--border)" stroke-dasharray="2 4" opacity="0.4"/>
  `).join('');

  // Verdict
  const lastPred = series[series.length - 1].predicted;
  const lastAct = last.kg;
  const diff = lastAct - lastPred;
  let verdict, vClass;
  if (Math.abs(diff) < 0.3) {
    verdict = `<strong>You're right on track.</strong> Your weight is matching what the math says it should — meaning your TDEE estimate and your logging are both accurate.`;
    vClass = 'good';
  } else if (diff > 0) {
    verdict = `<strong>You're ${diff.toFixed(2)} kg heavier than expected.</strong> Either you're eating more than you're logging${unloggedDays > 2 ? ` (${unloggedDays} unlogged days might explain it)` : ''}, or your real TDEE is lower than ${tdee}. Try the TDEE reality check in Profile.`;
    vClass = 'warn';
  } else {
    verdict = `<strong>You're ${Math.abs(diff).toFixed(2)} kg lighter than expected.</strong> Either your real TDEE is higher than ${tdee} (you're burning more than the formula thinks), or this is water-weight noise. Check the TDEE reality check in Profile in a week.`;
    vClass = 'good';
  }

  card.innerHTML = `
    <h2>Are you on track?</h2>
    <div class="pa-subtitle">The green line is where your weight <em>should</em> be if you ate exactly what you logged and your burn rate is ${tdee.toLocaleString()} kcal/day. The blue line is what the scale actually says. If they hug each other — your cut is working as planned.</div>
    <div class="pa-chart">
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;">
        ${ticks}
        ${predPath ? `<path d="${predPath}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
        ${actPath ? `<path d="${actPath}" fill="none" stroke="var(--info)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
        ${actDots.join('')}
        <circle cx="${xOf(series.length - 1).toFixed(1)}" cy="${yOf(lastPred).toFixed(1)}" r="3.5" fill="var(--accent)"/>
        <text x="${PAD.l}" y="${H - 8}" fill="var(--text-dim)" font-size="9">${first.date}</text>
        <text x="${W - PAD.r}" y="${H - 8}" text-anchor="end" fill="var(--text-dim)" font-size="9">${last.date}</text>
      </svg>
      <div class="pa-legend">
        <span><span class="leg-swatch" style="background:var(--accent);"></span> what math predicts (${lastPred.toFixed(2)} kg)</span>
        <span><span class="leg-swatch" style="background:var(--info);"></span> what the scale shows (${lastAct.toFixed(2)} kg)</span>
      </div>
    </div>
    <div class="pa-verdict pa-${vClass}">${verdict}</div>
  `;
}

// ===== Plateau detector =====
async function renderPlateauBanner() {
  const wrap = $('#plateauBannerWrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  const [weights, profile] = await Promise.all([
    api('/api/weight'),
    api('/api/profile')
  ]);
  if (weights.length < 14 || !profile || !profile.stats) return;

  // Compute 7-day rolling average for the LAST 7 days vs the 7 days BEFORE that
  const lastDate = new Date(weights[weights.length - 1].date + 'T00:00:00');
  const dayMs = 86400000;
  const recent = weights.filter(w => {
    const d = new Date(w.date + 'T00:00:00');
    return (lastDate - d) <= 7 * dayMs;
  });
  const prior = weights.filter(w => {
    const d = new Date(w.date + 'T00:00:00');
    const days = (lastDate - d) / dayMs;
    return days > 7 && days <= 14;
  });
  if (recent.length < 3 || prior.length < 3) return;
  const recentAvg = recent.reduce((a, w) => a + w.kg, 0) / recent.length;
  const priorAvg = prior.reduce((a, w) => a + w.kg, 0) / prior.length;
  const change = recentAvg - priorAvg;

  // Was user actually in deficit during last 14 days?
  const startD = new Date(lastDate); startD.setDate(startD.getDate() - 13);
  const rangeData = await api(`/api/log-range?start=${fmtDate(startD)}&end=${fmtDate(lastDate)}`);
  const logged = Object.values(rangeData);
  if (!logged.length) return;
  const avgEaten = logged.reduce((a, d) => a + d.kcal, 0) / logged.length;
  const inDeficit = avgEaten <= profile.stats.kcal_goal + 100; // tolerance of 100 kcal

  // Only flag plateau if user is on goal AND has been losing/maintaining target
  const wantsLoss = profile.stats.goal_meta && profile.stats.goal_meta.delta < 0;
  if (!wantsLoss) return;
  if (!inDeficit) return;
  if (Math.abs(change) > 0.15) return; // moved meaningfully — not a plateau

  wrap.innerHTML = `
    <div class="plateau-banner">
      <div class="plateau-icon">📉</div>
      <div class="plateau-body">
        <div class="plateau-title">Plateau warning — your weight hasn't moved in 2 weeks</div>
        <div class="plateau-text">
          You've been averaging <strong>${Math.round(avgEaten).toLocaleString()} kcal</strong>/day (goal is ${profile.stats.kcal_goal.toLocaleString()}), but your weight only moved <strong>${change > 0 ? '+' : ''}${change.toFixed(2)} kg</strong> over the last 2 weeks.
          This usually means one of three things:
          <ul>
            <li><strong>Your TDEE has drifted lower.</strong> Body adapts during a cut — burn rate drops 5-10% after weeks in deficit. Run the TDEE reality check in Profile to recalibrate.</li>
            <li><strong>You're under-logging.</strong> Sneaky calories (oil, sauces, weekend eating) add up. Be stricter for a week.</li>
            <li><strong>You need a refeed.</strong> 3-7 days at maintenance (eat at TDEE) can restart fat loss by recovering hormones.</li>
          </ul>
        </div>
      </div>
    </div>
  `;
}

// ===== Source quality breakdown =====
async function renderSourceQuality() {
  const card = $('#sourceQualityCard');
  if (!card) return;
  const data = await api('/api/source-breakdown');
  const sources = Object.entries(data);
  if (!sources.length) {
    card.innerHTML = '<h2>Where your numbers come from</h2><div class="empty" style="padding:12px 0;">Log some meals to see source breakdown.</div>';
    return;
  }
  const totalKcal = sources.reduce((a, [, v]) => a + v.kcal, 0);
  const totalCount = sources.reduce((a, [, v]) => a + v.count, 0);

  const meta = {
    'custom':       { label: 'Your saved foods',   color: '#a78bfa', tier: 'best',  trust: 'You verified these yourself' },
    'usda':         { label: 'USDA database',      color: '#4ade80', tier: 'best',  trust: 'Lab-measured nutrition data' },
    'usda+ai':      { label: 'USDA confirmed',     color: '#4ade80', tier: 'best',  trust: 'USDA-matched + AI sanity checked' },
    'ai-verified':  { label: 'AI verified',        color: '#60a5fa', tier: 'good',  trust: 'Two AI passes agreed' },
    'fatsecret':    { label: 'FatSecret database', color: '#60a5fa', tier: 'good',  trust: 'External food database' },
    'openfoodfacts':{ label: 'Open Food Facts',    color: '#60a5fa', tier: 'good',  trust: 'External food database' },
    'ai-estimate':  { label: 'AI estimate only',   color: '#fbbf24', tier: 'rough', trust: 'AI guess — no database match' },
    'manual':       { label: 'Manual entry',       color: '#8b949e', tier: 'best',  trust: 'You typed it directly' },
    'extra':        { label: 'Added extras',       color: '#8b949e', tier: 'rough', trust: 'Extras like oil, sauces' }
  };

  // Sort by kcal share, descending
  sources.sort((a, b) => b[1].kcal - a[1].kcal);

  const segments = sources.map(([src, v]) => {
    const m = meta[src] || { label: src, color: '#8b949e', tier: 'rough', trust: '' };
    const pct = totalKcal > 0 ? (v.kcal / totalKcal * 100) : 0;
    return { src, ...v, ...m, pct };
  });

  const trustedShare = segments.filter(s => s.tier === 'best').reduce((a, s) => a + s.pct, 0);
  const trustedLabel = trustedShare >= 70 ? `<span style="color:var(--accent);">High confidence</span>` :
                       trustedShare >= 40 ? `<span style="color:var(--warn);">Mixed confidence</span>` :
                       `<span style="color:var(--danger);">Mostly AI guesses</span>`;

  const stackedBar = `
    <div class="sq-bar">
      ${segments.map(s => `<div class="sq-seg" style="width:${s.pct}%;background:${s.color};" title="${s.label} — ${s.pct.toFixed(0)}%"></div>`).join('')}
    </div>`;
  const legend = segments.map(s => `
    <div class="sq-row">
      <span class="sq-dot" style="background:${s.color};"></span>
      <span class="sq-label">${s.label}</span>
      <span class="sq-pct">${s.pct.toFixed(0)}%</span>
      <span class="sq-count">${s.count} meal${s.count !== 1 ? 's' : ''}</span>
      <span class="sq-trust">${s.trust}</span>
    </div>
  `).join('');

  card.innerHTML = `
    <h2>Where your numbers come from</h2>
    <div class="sq-headline">${trustedLabel} — <strong>${Math.round(trustedShare)}%</strong> of your kcal came from verified sources (lab data, foods you saved, or manual entries).</div>
    ${stackedBar}
    <div class="sq-legend">${legend}</div>
    <div class="sq-tip">
      Tip: when AI guesses a food and looks confident, hit <strong>Save as my food</strong> on it — next time it'll use your value, not a guess. The more you save, the more trustworthy your daily totals get.
    </div>
  `;
}

async function renderWeightCard() {
  const wrap = $('#weightHistory');
  if (!wrap) return;
  const weights = await api('/api/weight');
  const inputEl = $('#weightInput');

  if (!weights.length) {
    if (inputEl) inputEl.value = '';
    wrap.innerHTML = '<div class="empty" style="padding:20px;">No weights logged yet. Enter your weight above to start tracking.</div>';
    return;
  }

  const first = weights[0];
  const last = weights[weights.length - 1];
  if (inputEl) inputEl.value = last.kg;

  // Stats
  const totalDelta = Math.round((last.kg - first.kg) * 100) / 100;
  const totalPct = first.kg ? Math.round((totalDelta / first.kg) * 1000) / 10 : 0;
  const firstD = new Date(first.date + 'T00:00:00');
  const lastD = new Date(last.date + 'T00:00:00');
  const daysSpan = Math.max(1, Math.round((lastD - firstD) / 86400000));
  const weeksSpan = daysSpan / 7;
  const kgPerWeek = weeksSpan > 0 ? Math.round((totalDelta / weeksSpan) * 100) / 100 : 0;

  // 7-day rolling average — index by date for easy lookup
  const byDate = {};
  weights.forEach(w => byDate[w.date] = w.kg);
  const dayMs = 86400000;
  const series = [];
  for (let t = firstD.getTime(); t <= lastD.getTime(); t += dayMs) {
    const d = new Date(t);
    const ds = fmtDate(d);
    series.push({ date: ds, kg: byDate[ds] !== undefined ? byDate[ds] : null });
  }
  const avgSeries = series.map((p, i) => {
    const window = series.slice(Math.max(0, i - 6), i + 1).filter(x => x.kg !== null);
    if (window.length < 2) return { date: p.date, kg: null };
    const sum = window.reduce((a, x) => a + x.kg, 0);
    return { date: p.date, kg: sum / window.length };
  });

  // Chart geometry
  const W = 600, H = 160;
  const PAD = { l: 36, r: 12, t: 14, b: 28 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;
  const allKg = weights.map(w => w.kg);
  const yMin = Math.min(...allKg) - 0.5;
  const yMax = Math.max(...allKg) + 0.5;
  const yRange = Math.max(0.5, yMax - yMin);
  const xOf = i => PAD.l + (series.length > 1 ? (i / (series.length - 1)) * chartW : chartW / 2);
  const yOf = kg => PAD.t + ((yMax - kg) / yRange) * chartH;

  // Daily points polyline (gaps for missing days)
  let dailyPath = '';
  series.forEach((p, i) => {
    if (p.kg === null) return;
    const cmd = dailyPath === '' || series[i - 1]?.kg === null ? 'M' : 'L';
    dailyPath += `${cmd}${xOf(i).toFixed(1)},${yOf(p.kg).toFixed(1)} `;
  });
  let avgPath = '';
  avgSeries.forEach((p, i) => {
    if (p.kg === null) return;
    const cmd = avgPath === '' || avgSeries[i - 1]?.kg === null ? 'M' : 'L';
    avgPath += `${cmd}${xOf(i).toFixed(1)},${yOf(p.kg).toFixed(1)} `;
  });

  // Y-axis labels (3 ticks)
  const yTicks = [yMax, (yMax + yMin) / 2, yMin].map(v => Math.round(v * 10) / 10);
  const yTickLabels = yTicks.map(v => `
    <text x="${PAD.l - 6}" y="${yOf(v) + 3}" text-anchor="end" fill="var(--text-dim)" font-size="9" font-family="sans-serif">${v}</text>
    <line x1="${PAD.l}" y1="${yOf(v)}" x2="${W - PAD.r}" y2="${yOf(v)}" stroke="var(--border)" stroke-dasharray="2 4" opacity="0.4"/>
  `).join('');

  // Dot on latest point
  const lastIdx = series.length - 1;
  const lastPt = series[lastIdx];

  // Stats card colours
  const dColor = totalDelta < 0 ? 'var(--accent)' : totalDelta > 0 ? 'var(--danger)' : 'var(--text-dim)';
  const dSign  = totalDelta > 0 ? '+' : '';
  const paceColor = kgPerWeek < -1 ? 'var(--warn)' : kgPerWeek < 0 ? 'var(--accent)' : kgPerWeek > 0 ? 'var(--danger)' : 'var(--text-dim)';
  const paceSign  = kgPerWeek > 0 ? '+' : '';

  // Recent entries (last 8)
  const recent = [...weights].reverse().slice(0, 8);

  wrap.innerHTML = `
    <div class="weight-stats">
      <div class="ws-hero">
        <div class="ws-hero-num">${last.kg.toFixed(2)}<span class="ws-hero-unit"> kg</span></div>
        <div class="ws-hero-lbl">latest · ${new Date(last.date + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
      </div>
      <div class="ws-stat">
        <div class="ws-stat-num" style="color:${dColor};">${dSign}${totalDelta.toFixed(2)} kg</div>
        <div class="ws-stat-lbl">over ${daysSpan} day${daysSpan === 1 ? '' : 's'} · ${dSign}${totalPct.toFixed(1)}%</div>
      </div>
      <div class="ws-stat">
        <div class="ws-stat-num" style="color:${paceColor};">${paceSign}${kgPerWeek.toFixed(2)} kg</div>
        <div class="ws-stat-lbl">per week</div>
      </div>
    </div>

    <div class="weight-chart">
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;">
        ${yTickLabels}
        ${dailyPath ? `<path d="${dailyPath}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>` : ''}
        ${avgPath ? `<path d="${avgPath}" fill="none" stroke="var(--info)" stroke-width="2.5" stroke-linecap="round"/>` : ''}
        ${lastPt && lastPt.kg !== null ? `<circle cx="${xOf(lastIdx).toFixed(1)}" cy="${yOf(lastPt.kg).toFixed(1)}" r="4" fill="var(--info)" stroke="var(--bg)" stroke-width="2"/>` : ''}
        <text x="${PAD.l}" y="${H - 8}" fill="var(--text-dim)" font-size="9" font-family="sans-serif">${first.date}</text>
        <text x="${W - PAD.r}" y="${H - 8}" text-anchor="end" fill="var(--text-dim)" font-size="9" font-family="sans-serif">${last.date}</text>
      </svg>
      <div class="weight-legend">
        <span><span class="leg-swatch daily"></span> daily</span>
        <span><span class="leg-swatch avg"></span> 7-day average</span>
      </div>
    </div>

    <div class="weight-recent">
      <div class="weight-recent-hdr">Recent weigh-ins</div>
      ${recent.map((w, i) => {
        const prev = recent[i + 1];
        const delta = prev ? Math.round((w.kg - prev.kg) * 100) / 100 : null;
        const dStr = delta === null ? '' : delta === 0 ? 'no change' : (delta > 0 ? '+' : '') + delta.toFixed(2) + ' kg';
        const dClr = delta === null || delta === 0 ? 'var(--text-dim)' : delta < 0 ? 'var(--accent)' : 'var(--danger)';
        return `<div class="weight-row" data-date="${w.date}">
          <span class="wr-date">${new Date(w.date + 'T00:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          <span class="wr-kg">${w.kg.toFixed(2)} kg</span>
          <span class="wr-delta" style="color:${dClr};">${dStr}</span>
          <button class="wr-del" data-date="${w.date}" title="Delete this weigh-in">×</button>
        </div>`;
      }).join('')}
    </div>
  `;

  wrap.querySelectorAll('.wr-del').forEach(btn => btn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const date = btn.dataset.date;
    const entry = weights.find(w => w.date === date);
    await api(`/api/weight/${date}`, { method: 'DELETE' });
    renderWeightCard();
    if (entry) {
      showUndoToast(`Deleted weigh-in for ${date}`, async () => {
        await api('/api/weight', { method: 'POST', body: { kg: entry.kg, date: entry.date } });
        renderWeightCard();
      });
    }
  }));
  wrap.querySelectorAll('.weight-row').forEach(row => row.addEventListener('click', (ev) => {
    if (ev.target.classList.contains('wr-del')) return;
    const date = row.dataset.date;
    const cur = weights.find(w => w.date === date);
    if (!cur) return;
    const val = prompt(`Edit weight for ${date}:`, cur.kg);
    if (val === null) return;
    const newKg = Number(val);
    if (!newKg || newKg < 30 || newKg > 250) return showToast('Enter a weight between 30 and 250');
    api('/api/weight', { method: 'POST', body: { kg: newKg, date } }).then(() => renderWeightCard());
  }));
}

async function renderWeeklyReview() {
  const card = $('#weeklyReviewCard');
  if (!card) return;
  card.innerHTML = `<h2>Last 7 days</h2><div class="empty" style="padding:8px 0;">Loading…</div>`;
  const [r, logStats] = await Promise.all([
    api('/api/weekly-review'),
    api('/api/logging-stats').catch(() => null)
  ]);
  if (r.empty || !r.days_logged) {
    card.innerHTML = `<h2>Last 7 days</h2><div class="empty" style="padding:12px 0;">Nothing logged in the last 7 days.</div>`;
    return;
  }
  const goalRow = r.goal_kcal
    ? `<div class="wr-stat"><div class="wr-num">${r.days_hit_goal}/${r.days_logged}</div><div class="wr-lbl">days within goal</div></div>`
    : '';
  const avgVsGoal = r.goal_kcal ? r.avg_kcal - r.goal_kcal : null;
  const avgClr = avgVsGoal === null ? 'var(--text)' : avgVsGoal > 100 ? 'var(--danger)' : avgVsGoal < -200 ? 'var(--warn)' : 'var(--accent)';

  let weightLine = '';
  if (r.weight_delta_kg !== null) {
    const sign = r.weight_delta_kg < 0 ? '−' : '+';
    const clr = r.weight_delta_kg < 0 ? 'var(--accent)' : r.weight_delta_kg > 0 ? 'var(--danger)' : 'var(--text-dim)';
    weightLine = `<div style="font-size:13px;margin-top:8px;">Weight: <strong style="color:${clr};">${sign}${Math.abs(r.weight_delta_kg).toFixed(2)} kg</strong> · ${r.weight_start} → ${r.weight_end} kg</div>`;
  }

  const macroChips = Object.entries(r.macro_hit_days || {}).map(([k, v]) => {
    if (!r.macro_targets[k]) return '';
    const cls = v >= r.days_logged - 1 ? 'good' : v >= Math.ceil(r.days_logged / 2) ? 'mid' : 'bad';
    const labels = { protein: 'Protein', fat: 'Fat', carb: 'Carbs', fiber: 'Fiber' };
    return `<span class="wr-chip ${cls}">${labels[k]}: ${v}/${r.days_logged}</span>`;
  }).join('');

  const topFoods = (r.top_foods || []).length
    ? `<div style="margin-top:10px;">
        <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">Most-logged foods</div>
        ${r.top_foods.map(f => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;"><span>${escapeHtml(f.name)}</span><span style="color:var(--text-dim);">×${f.count} · ~${f.avg_kcal} kcal</span></div>`).join('')}
      </div>`
    : '';

  const heaviestStr = r.heaviest_day ? `${new Date(r.heaviest_day.date + 'T00:00:00').toLocaleDateString([], { weekday: 'short' })} (${r.heaviest_day.kcal.toLocaleString()})` : '—';
  const lightestStr = r.lightest_day ? `${new Date(r.lightest_day.date + 'T00:00:00').toLocaleDateString([], { weekday: 'short' })} (${r.lightest_day.kcal.toLocaleString()})` : '—';

  // Logging stats row (streak + meals/day) — gamifies just showing up
  const streakLine = logStats && logStats.current_streak > 0
    ? `<div class="streak-row">
        <div class="streak-pill"><span class="streak-emoji">🔥</span><strong>${logStats.current_streak}</strong> day${logStats.current_streak === 1 ? '' : 's'} logged in a row</div>
        ${logStats.best_streak > logStats.current_streak ? `<div class="streak-meta">Best ever: ${logStats.best_streak} days</div>` : ''}
        <div class="streak-meta">${logStats.meals_per_day} meals/day avg · ${logStats.total_days_logged} total days</div>
      </div>`
    : '';

  card.innerHTML = `
    <h2>Last 7 days <span style="font-size:11px;color:var(--text-dim);font-weight:400;">${r.start} → ${r.end}</span></h2>
    ${streakLine}
    <div class="wr-stat-grid">
      <div class="wr-stat"><div class="wr-num" style="color:${avgClr};">${r.avg_kcal.toLocaleString()}</div><div class="wr-lbl">avg kcal/day${avgVsGoal !== null ? ` · ${avgVsGoal > 0 ? '+' : ''}${avgVsGoal} vs goal` : ''}</div></div>
      ${goalRow}
      <div class="wr-stat"><div class="wr-num">${r.days_logged}/7</div><div class="wr-lbl">days logged</div></div>
    </div>
    ${weightLine}
    <div style="margin-top:10px;font-size:13px;color:var(--text-dim);">
      Heaviest: <strong style="color:var(--text);">${heaviestStr}</strong> · Lightest: <strong style="color:var(--text);">${lightestStr}</strong>
    </div>
    ${macroChips ? `<div class="wr-chips">${macroChips}</div>` : ''}
    ${topFoods}
  `;
}

async function loadHistory() {
  // Weekly review card
  renderWeeklyReview();

  // Weight tracker — full rebuild with stats, big chart, editable entries
  await renderWeightCard();
  // Plateau detector + predicted vs actual (depend on weight + log data, run after weight loads)
  renderPlateauBanner();
  renderPredictedActual();
  renderSourceQuality();

  // Kcal trend (last 30 days) + DoW pattern (last 60 days) + calendar (current month) — fetch range once
  const now = new Date();
  const trendEnd = fmtDate(now);
  const trendStart = new Date(now); trendStart.setDate(trendStart.getDate() - 29);
  const trendStartStr = fmtDate(trendStart);
  const dowStart = new Date(now); dowStart.setDate(dowStart.getDate() - 59);
  const dowStartStr = fmtDate(dowStart);

  // Calendar month range
  const calStart = `${calYear}-${String(calMonth+1).padStart(2,'0')}-01`;
  const lastDay = new Date(calYear, calMonth+1, 0).getDate();
  const calEnd = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

  // Fetch widest range that covers everything (overlap handled by server returning only logged dates)
  const allStart = [dowStartStr, trendStartStr, calStart].sort()[0];
  const allEnd = [trendEnd, calEnd].sort().reverse()[0];
  calRangeData = await api(`/api/log-range?start=${allStart}&end=${allEnd}`);

  renderKcalTrend(trendStartStr, trendEnd, calRangeData);
  renderDowPattern(dowStartStr, trendEnd, calRangeData);
  renderCalendar();
}

function renderDowPattern(startStr, endStr, rangeData) {
  const el = $('#dowPatternCard');
  if (!el) return;
  const buckets = Array.from({ length: 7 }, () => ({ sum: 0, count: 0 }));
  Object.entries(rangeData).forEach(([date, info]) => {
    if (date < startStr || date > endStr) return;
    if (!info || !info.kcal) return;
    const dow = new Date(date + 'T00:00:00').getDay();
    buckets[dow].sum += info.kcal;
    buckets[dow].count += 1;
  });
  const dowNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const data = buckets.map((b, i) => ({ name: dowNames[i], avg: b.count > 0 ? Math.round(b.sum / b.count) : null, count: b.count }));
  const totalDays = data.reduce((a, d) => a + d.count, 0);
  if (totalDays < 7) {
    el.innerHTML = `<h2>Day-of-week pattern</h2><div class="empty" style="padding:12px 0;">Log ${7 - totalDays} more day${totalDays === 6 ? '' : 's'} to see your weekday patterns.</div>`;
    return;
  }
  const validAvgs = data.filter(d => d.avg !== null).map(d => d.avg);
  const max = Math.max(...validAvgs), min = Math.min(...validAvgs);
  const overall = Math.round(validAvgs.reduce((a, v) => a + v, 0) / validAvgs.length);
  const heaviest = data.reduce((best, d) => (d.avg !== null && (!best || d.avg > best.avg)) ? d : best, null);
  const lightest = data.reduce((best, d) => (d.avg !== null && (!best || d.avg < best.avg)) ? d : best, null);
  const heavyDelta = heaviest && lightest ? heaviest.avg - lightest.avg : 0;

  const insight = heavyDelta > 200
    ? `<strong style="color:var(--text);">${heaviest.name}</strong> is your heaviest (avg ${heaviest.avg.toLocaleString()} kcal) · <strong style="color:var(--text);">${lightest.name}</strong> is lightest (${lightest.avg.toLocaleString()}). That's ${heavyDelta} kcal/day spread.`
    : `Pretty consistent across the week — within ${heavyDelta} kcal/day.`;

  el.innerHTML = `
    <h2>Day-of-week pattern <span style="font-size:11px;color:var(--text-dim);font-weight:400;">last ${totalDays} day${totalDays === 1 ? '' : 's'}</span></h2>
    <div class="dow-grid">
      ${data.map(d => {
        const h = d.avg !== null ? Math.round((d.avg / max) * 100) : 0;
        const isHeavy = heaviest && d.name === heaviest.name && heavyDelta > 200;
        const isLight = lightest && d.name === lightest.name && heavyDelta > 200;
        return `<div class="dow-bar-wrap">
          <div class="dow-bar"><div class="dow-fill ${isHeavy ? 'heavy' : isLight ? 'light' : ''}" style="height:${h}%"></div></div>
          <div class="dow-val">${d.avg !== null ? d.avg.toLocaleString() : '—'}</div>
          <div class="dow-label">${d.name}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="dow-insight">${insight}</div>
  `;
}

function renderKcalTrend(startStr, endStr, rangeData) {
  const days = [];
  const d = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  while (d <= end) {
    const ds = fmtDate(d);
    const entry = rangeData[ds];
    days.push({ date: ds, kcal: entry ? entry.kcal : null, goal: entry ? entry.goal : null });
    d.setDate(d.getDate() + 1);
  }
  const goal = days.find(d => d.goal)?.goal || null;
  const loggedDays = days.filter(d => d.kcal !== null);
  if (!loggedDays.length) {
    $('#kcalTrendChart').innerHTML = '<div class="empty" style="padding:20px 0;">No data logged yet.</div>';
    $('#kcalTrendStats').innerHTML = '';
    return;
  }

  const avgKcal = Math.round(loggedDays.reduce((a, d) => a + d.kcal, 0) / loggedDays.length);
  const hitGoal = goal ? loggedDays.filter(d => d.kcal <= goal).length : 0;
  const avgDiff = goal ? Math.round(avgKcal - goal) : null;

  $('#kcalTrendStats').innerHTML = `
    <span><strong>${avgKcal.toLocaleString()}</strong> 30d avg</span>
    ${goal ? `<span>Goal: <strong>${goal.toLocaleString()}</strong></span>` : ''}
    ${goal ? `<span>Hit goal: <strong>${hitGoal}/${loggedDays.length}</strong> days</span>` : ''}
    ${avgDiff !== null ? `<span style="color:${avgDiff > 0 ? 'var(--danger)' : 'var(--accent)'};">${avgDiff > 0 ? '+' + avgDiff : avgDiff} avg vs goal</span>` : ''}
  `;

  const W = 560, H = 80;
  const allKcals = loggedDays.map(d => d.kcal);
  const minK = Math.max(0, Math.min(...allKcals) - 200);
  const maxK = Math.max(...allKcals) + 200;
  const xOf = (i) => (i / Math.max(1, days.length - 1)) * W;
  const yOf = (k) => H - ((k - minK) / (maxK - minK)) * H;

  // Actual kcal line (gaps for null days)
  let pathD = '';
  days.forEach((d, i) => {
    if (d.kcal === null) return;
    const x = xOf(i), y = yOf(d.kcal);
    pathD += pathD === '' || days[i-1]?.kcal === null ? `M${x},${y}` : `L${x},${y}`;
  });

  // 7-day rolling average
  let avgPath = '';
  days.forEach((_, i) => {
    if (i < 6) return;
    const window = days.slice(i-6, i+1).filter(d => d.kcal !== null);
    if (window.length < 3) return;
    const avg = window.reduce((a, d) => a + d.kcal, 0) / window.length;
    const x = xOf(i), y = yOf(avg);
    avgPath += avgPath === '' ? `M${x},${y}` : `L${x},${y}`;
  });

  const goalY = goal ? yOf(goal) : null;

  $('#kcalTrendChart').innerHTML = `
    <svg width="100%" height="${H+2}" viewBox="0 0 ${W} ${H+2}" preserveAspectRatio="none" style="margin-top:4px;">
      ${goalY !== null ? `<line x1="0" y1="${goalY}" x2="${W}" y2="${goalY}" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-dasharray="6 4"/>` : ''}
      ${pathD ? `<path d="${pathD}" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>` : ''}
      ${avgPath ? `<path d="${avgPath}" fill="none" stroke="var(--info)" stroke-width="2.5"/>` : ''}
    </svg>
    <div style="display:flex;justify-content:space-between;color:var(--text-dim);font-size:11px;margin-top:4px;">
      <span>${days[0].date}</span>
      <span style="display:flex;align-items:center;gap:10px;">
        <span><span style="display:inline-block;width:18px;height:2px;background:rgba(255,255,255,0.5);vertical-align:middle;"></span> daily</span>
        <span><span style="display:inline-block;width:18px;height:2.5px;background:var(--info);vertical-align:middle;border-radius:2px;"></span> 7d avg</span>
        ${goal ? `<span><span style="display:inline-block;width:18px;height:1.5px;background:rgba(255,255,255,0.15);vertical-align:middle;border:none;"></span> goal</span>` : ''}
      </span>
      <span>${days[days.length-1].date}</span>
    </div>
  `;
}

function renderCalendar() {
  const now = new Date();
  const todayStr = fmtDate(now);
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  $('#calMonthLabel').textContent = `${monthNames[calMonth]} ${calYear}`;
  $('#calPrev').disabled = false;
  $('#calNext').disabled = (calYear > now.getFullYear()) || (calYear === now.getFullYear() && calMonth >= now.getMonth());

  const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const goal = Object.values(calRangeData).find(d => d.goal)?.goal || null;

  let html = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('');

  // Blank cells before first day
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell outside"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const ds = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const entry = calRangeData[ds];
    const isToday = ds === todayStr;
    const isFuture = ds > todayStr;
    const isSelected = ds === calSelectedDate;
    let cls = 'cal-cell';
    if (isToday) cls += ' today';
    if (isSelected) cls += ' selected';
    if (isFuture) cls += ' outside';
    else if (!entry) cls += ' empty-log';
    else if (goal && entry.kcal <= goal + 200) cls += ' on-target';
    else if (goal && entry.kcal < goal - 300) cls += ' under';
    else cls += ' over';

    let proteinHtml = '';
    if (entry && entry.protein !== undefined) {
      const pg = entry.protein_goal;
      const hit = pg ? entry.protein >= pg * 0.9 : false;
      proteinHtml = `<div class="cal-day-protein ${hit ? 'hit' : 'miss'}">${Math.round(entry.protein)}p</div>`;
    }
    html += `<div class="${cls}" data-date="${ds}">
      <div class="cal-day-num">${day}</div>
      ${entry ? `<div class="cal-day-kcal">${entry.kcal.toLocaleString()}</div>${proteinHtml}` : ''}
    </div>`;
  }

  $('#calGrid').innerHTML = html;
  $$('.cal-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', async () => {
      const date = cell.dataset.date;
      if (!date || date > todayStr) return;
      if (calSelectedDate === date) {
        calSelectedDate = null;
        $('#calDetail').innerHTML = '';
        cell.classList.remove('selected');
        return;
      }
      calSelectedDate = date;
      $$('.cal-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      await renderCalDetail(date);
    });
  });
}

async function renderCalDetail(date) {
  $('#calDetail').innerHTML = `<div class="cal-detail-drawer"><div class="cal-detail-empty">Loading…</div></div>`;
  const data = await api('/api/log?date=' + date);
  const niceDate = new Date(date + 'T00:00:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const totals = data.entries.length
    ? `<span class="totals">— ${data.totals.kcal} kcal · ${Math.round(data.totals.protein)}g P</span>`
    : '';
  const header = `
    <div class="cal-detail-header">
      <div class="cal-detail-title">${niceDate}${totals}</div>
      <button class="btn btn-secondary" id="calAddMeal" style="padding:6px 12px;font-size:12px;white-space:nowrap;">+ Add meal</button>
    </div>`;
  let body;
  if (!data.entries.length) {
    body = '<div class="cal-detail-empty">Nothing logged this day. Tap + Add meal to backfill.</div>';
  } else {
    body = data.entries.map(e => `
      <div class="cal-entry-row" data-eid="${e.id}">
        <span class="ce-name">${escapeHtml(e.name)}</span>
        <span class="ce-meta">${e.kcal} kcal · ${e.protein}g P</span>
      </div>
    `).join('');
  }
  $('#calDetail').innerHTML = `<div class="cal-detail-drawer">${header}${body}</div>`;
  $('#calAddMeal').addEventListener('click', () => openLogModal(date));
  $$('#calDetail .cal-entry-row').forEach(row => {
    row.addEventListener('click', () => {
      const e = data.entries.find(en => en.id === row.dataset.eid);
      if (e) openEditModal(e, date);
    });
  });
  // Bring the drawer + selected cell into view so it's obvious something opened.
  const drawer = $('#calDetail').querySelector('.cal-detail-drawer');
  if (drawer) drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function shiftCalendarMonth(delta) {
  calMonth += delta;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  else if (calMonth > 11) { calMonth = 0; calYear++; }
  calSelectedDate = null;
  $('#calDetail').innerHTML = '';
  const mm = String(calMonth + 1).padStart(2, '0');
  const lastDay = new Date(calYear, calMonth + 1, 0).getDate();
  const calStart = `${calYear}-${mm}-01`;
  const calEnd = `${calYear}-${mm}-${String(lastDay).padStart(2, '0')}`;
  const newData = await api(`/api/log-range?start=${calStart}&end=${calEnd}`);
  Object.assign(calRangeData, newData);
  renderCalendar();
}
$('#calPrev').addEventListener('click', () => shiftCalendarMonth(-1));
$('#calNext').addEventListener('click', () => shiftCalendarMonth(1));

$('#weightSave').addEventListener('click', async () => {
  const kg = Number($('#weightInput').value);
  if (!kg || kg < 30 || kg > 250) return showToast('Enter a weight between 30 and 250');
  await api('/api/weight', { method: 'POST', body: { kg } });
  showToast('Weight logged');
  renderWeightCard();
  loadProfile();
});
