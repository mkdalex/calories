// ---------- HISTORY ----------
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let calRangeData = {}; // date -> { kcal, goal }
let calSelectedDate = null;

// ===== Predicted vs Actual — "Are you on track?" =====
async function renderPredictedActual() {
  const card = $('#predictedActualCard');
  if (!card) return;
  const [review, profile] = await Promise.all([api('/api/calibrate'), api('/api/profile')]);
  const stats = profile.stats;
  if (!stats) { card.innerHTML = '<h2>Recent progress</h2><p>Set up a profile to review your targets.</p>'; return; }
  const label = GoalPolicy.LABELS[stats.goal] || stats.goal_meta.label;
  card.innerHTML = `<h2>Recent progress · ${escapeHtml(label)}</h2>
    <p class="history-note">Current goal tracked from ${escapeHtml(stats.goal_started || 'today')}. Your earlier records remain in the weight chart and calendar.</p>
    ${stats.goal === 'reset' ? '<p>Reset week focuses on recording food. Weight change is not scored.</p>'
      : review.can_calibrate ? `
      <p>Recorded weight: <strong>${review.weight_start} → ${review.weight_end} kg</strong> over ${review.days_span} days.</p>
      <p class="history-note">${review.days_logged}/${review.days_span} days contain food entries. Review omitted meals before using these records to adjust your target.</p>`
      : `<p>${escapeHtml(review.reason || 'More recent records are needed before reviewing your target.')}</p>`}
    <button class="btn btn-secondary" type="button" onclick="setActiveView('profile')">Review target in Profile</button>`;
}

// Weight and calorie records are shown without speculative plateau diagnoses.
async function renderPlateauBanner() {
  const wrap = $('#plateauBannerWrap');
  if (wrap) wrap.innerHTML = '';
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
  // Historical chart shows observations only; current goal progress is reviewed separately.
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
  const PAD = { l: 32, r: 14, t: 14, b: 26 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;
  const allKg = weights.map(w => w.kg);

  const totalLen = series.length;

  // Leave space around the observed weights.
  const yMin = Math.min(...allKg) - 0.5;
  const yMax = Math.max(...allKg) + 0.5;
  const yRange = Math.max(0.5, yMax - yMin);
  const xOf = i => PAD.l + (totalLen > 1 ? (i / (totalLen - 1)) * chartW : chartW / 2);
  const yOf = kg => PAD.t + ((yMax - kg) / yRange) * chartH;

  // Daily weigh-ins rendered as dots so isolated points are always visible
  // (the old polyline collapsed to nothing for orphan days surrounded by gaps).
  let dailyDots = '';
  series.forEach((p, i) => {
    if (p.kg === null) return;
    dailyDots += `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(p.kg).toFixed(1)}" r="2.2" fill="rgba(255,255,255,0.55)"/>`;
  });

  let avgPath = '';
  avgSeries.forEach((p, i) => {
    if (p.kg === null) return;
    const cmd = avgPath === '' || avgSeries[i - 1]?.kg === null ? 'M' : 'L';
    avgPath += `${cmd}${xOf(i).toFixed(1)},${yOf(p.kg).toFixed(1)} `;
  });

  // Y-axis ticks rounded toward the interior of the range so labels never sit
  // outside the chart (Math.ceil(yMax) could place a tick at e.g. 85 when yMax=84.05).
  const yTicksRaw = [Math.floor(yMax), Math.round((yMax + yMin) / 2), Math.ceil(yMin)];
  const yTicks = [...new Set(yTicksRaw)];
  const yTickLabels = yTicks.map((v, i) => `
    <text x="${PAD.l - 6}" y="${yOf(v) + 3}" text-anchor="end" fill="var(--text-dim)" font-size="10" font-family="inherit">${v}</text>
    ${i === 1 ? `<line x1="${PAD.l}" y1="${yOf(v)}" x2="${W - PAD.r}" y2="${yOf(v)}" stroke="var(--border)" opacity="0.25"/>` : ''}
  `).join('');

  // Dot on latest point + "you are here" callout.
  // Callout lives in the reserved TOP margin (above the plot) so it never sits
  // on the trend line.
  const niceDate = ds => new Date(ds + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
  const lastIdx = series.length - 1;
  const lastPt = series[lastIdx];
  let latestCallout = '';
  if (lastPt && lastPt.kg !== null) {
    const cx = xOf(lastIdx);
    const lx = Math.min(W - PAD.r - 18, Math.max(PAD.l + 18, cx));
    latestCallout = `<text x="${lx.toFixed(1)}" y="10" text-anchor="middle" fill="var(--info)" font-size="11" font-weight="600" font-family="inherit" opacity="0.92">${lastPt.kg.toFixed(1)} kg · ${niceDate(last.date)}</text>`;
  }

  // Historical changes are neutral observations, not a verdict on the current goal.
  const dColor = 'var(--text)', paceColor = 'var(--text-dim)';
  const dSign = totalDelta > 0 ? '+' : '', paceSign = kgPerWeek > 0 ? '+' : '';
  const paceVerdictHtml = '<div class="ws-stat-sub">historical average, including gaps</div>';

  // Recent entries (last 8)
  const recent = [...weights].reverse().slice(0, 8);

  wrap.innerHTML = `
    <p class="history-note">Historical weigh-ins · latest recorded ${niceDate(last.date)}. Add a new weigh-in using Log above when you have a current measurement. This chart preserves all goals and logging gaps.</p>
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
        <div class="ws-stat-lbl">historical kg/week</div>
        ${paceVerdictHtml}
      </div>
    </div>

    ${weights.length >= 2 ? `
      <div class="wt-moved-hero">
        <div class="wt-moved-num" style="color:${dColor};">${dSign}${totalDelta.toFixed(2)} kg</div>
        <div class="wt-moved-lbl">change between ${niceDate(first.date)} and ${niceDate(last.date)} · includes gaps</div>
      </div>` : ''}
    <div class="weight-chart">
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;font-family:inherit;">
        ${yTickLabels}
        ${avgPath ? `<path d="${avgPath}" fill="none" stroke="var(--info)" stroke-width="1.75" stroke-linecap="round" class="wt-trend-line" pathLength="1"/>` : ''}
        ${dailyDots}
        ${lastPt && lastPt.kg !== null ? `<circle cx="${xOf(lastIdx).toFixed(1)}" cy="${yOf(lastPt.kg).toFixed(1)}" r="4" fill="var(--info)" stroke="var(--bg)" stroke-width="2" class="wt-latest-dot"/>` : ''}
        ${latestCallout}
        <text x="${PAD.l}" y="${H - 8}" fill="var(--text-dim)" font-size="10" font-family="inherit">${niceDate(first.date)}</text>
        <text x="${W - PAD.r}" y="${H - 8}" text-anchor="end" fill="var(--text-dim)" font-size="10" font-family="inherit">${niceDate(last.date)}</text>
      </svg>
      <div class="weight-legend">
        <span><span class="leg-swatch daily-dot"></span> daily weigh-in</span>
        <span><span class="leg-swatch avg"></span> 7-day average</span>
      </div>
    </div>

    <div class="weight-recent">
      <div class="weight-recent-hdr">Recent weigh-ins</div>
      ${recent.map((w, i) => {
        const prev = recent[i + 1];
        const delta = prev ? Math.round((w.kg - prev.kg) * 100) / 100 : null;
        const dStr = delta === null ? '' : delta === 0 ? 'no change' : (delta > 0 ? '+' : '') + delta.toFixed(2) + ' kg';
        const dClr = 'var(--text-dim)';
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
  const r = await api('/api/weekly-review');
  if (r.error) { card.innerHTML = '<h2>Last 7 past days</h2><p>Could not load this review.</p>'; return; }
  card.innerHTML = `<h2>Last 7 past days <span class="goal-note">${r.start} → ${r.end}</span></h2>
    <p class="history-note">Today is in progress and excluded from this review.</p>
    ${r.empty ? '<p>No food recorded on past days in this window yet.</p>' : `
      <div class="wr-stat-grid">
        <div class="wr-stat"><div class="wr-num">${r.avg_kcal.toLocaleString()}</div><div class="wr-lbl">avg kcal per logged day</div></div>
        <div class="wr-stat"><div class="wr-num">${r.days_assessed ? `${r.days_hit_goal}/${r.days_assessed}` : '—'}</div><div class="wr-lbl">days within recorded target ±200 kcal</div></div>
        <div class="wr-stat"><div class="wr-num">${r.days_logged}/7</div><div class="wr-lbl">days with food entries</div></div>
      </div>
      <p class="history-note">Average protein: ${r.avg_protein} g per logged day.
        ${r.reset_days_logged ? `${r.reset_days_logged} reset days recorded without calorie scoring.` : ''}
        ${r.unknown_target_days ? `${r.unknown_target_days} days have no saved historical target and remain unscored.` : ''}</p>`}
    <p class="history-note">${escapeHtml(r.note)}</p>`;
}

async function renderProteinAdherence() {
  const card = $('#proteinAdherenceCard');
  if (!card) return;
  const r = await api('/api/protein-adherence?days=30');
  if (r.empty || r.error) { card.innerHTML = '<h2>Protein records</h2><p>Set up your profile to track protein.</p>'; return; }
  const maximum = Math.max(1, ...r.series.map(d => d.protein || 0));
  const width = 560 / r.series.length;
  const bars = r.series.map((d, i) => {
    if (d.protein === null) return '';
    const height = d.protein / maximum * 54;
    return `<rect x="${i * width}" y="${58 - height}" width="${Math.max(1, width - 2)}" height="${height}" fill="${d.hit === true ? 'var(--accent)' : 'var(--text-dim)'}"><title>${d.date}: ${d.protein} g${d.target ? `, recorded target ${d.target} g` : ', unscored'}</title></rect>`;
  }).join('');
  card.innerHTML = `<h2>Protein records</h2>
    <p class="history-note">${r.start} → ${r.end}. Today is in progress and excluded.</p>
    ${r.days_logged ? `<div class="pa-stat-grid">
      <div class="pa-stat"><div class="pa-num">${r.days_assessed ? `${r.days_hit}/${r.days_assessed}` : '—'}</div><div class="pa-lbl">days at ≥90% of recorded target</div></div>
      <div class="pa-stat"><div class="pa-num">${r.avg_protein} g</div><div class="pa-lbl">average across ${r.days_logged} logged days</div></div>
    </div><svg viewBox="0 0 560 60" width="100%" role="img" aria-label="Protein recorded on past days">${bars}</svg>`
      : '<p>No past food records in this window yet.</p>'}
    <p class="history-note">Missing days are unknown. Reset days and days without a recorded target are unscored. Food entries may omit meals.</p>`;
}

// ---------- AI weekly debrief ----------
const DEBRIEF_TRIGGER_META = {
  weekly:       { emoji: '📋', label: 'Weekly review',        accent: 'var(--info)'   },
  plateau:      { emoji: '📉', label: 'Plateau alert',         accent: 'var(--warn)'   },
  drift:        { emoji: '⚖️',  label: 'TDEE drift detected',   accent: 'var(--warn)'   },
  drop:         { emoji: '⚠️',  label: 'Adherence dropped',     accent: 'var(--danger)' },
  streak_break: { emoji: '🔻', label: 'Streak broke',          accent: 'var(--text-dim)' }
};

async function renderDebriefCard() {
  const card = $('#debriefCard');
  if (!card) return;
  card.innerHTML = `<h2>AI debrief</h2><div class="empty" style="padding:8px 0;">Loading…</div>`;
  let status;
  try { status = await api('/api/debrief'); }
  catch (e) {
    card.innerHTML = `<h2>AI debrief</h2><div class="empty">Failed to load.</div>`;
    return;
  }
  if (!status.unlocked) {
    renderDebriefLocked(card, status.checklist);
    return;
  }
  // Unlocked — pick the most relevant debrief to show.
  // Priority: a pending trigger that hasn't been generated yet > the most recent existing debrief.
  const triggers = status.pending_triggers || [];
  const recent = status.recent || [];

  if (triggers.length && (!recent.length || recent[0].iso_week !== isoWeekClient())) {
    // Auto-generate the highest-priority pending trigger (alerts before weekly heartbeat).
    const ordered = ['plateau', 'drift', 'drop', 'streak_break', 'weekly'];
    const trigger = ordered.find(t => triggers.includes(t)) || triggers[0];
    renderDebriefGenerating(card, trigger);
    try {
      const r = await api('/api/debrief', { method: 'POST', body: { trigger } });
      if (r && r.error && !r.debrief) {
        // Rate-limited or other server-side block — fall back to whatever we have.
        if (recent.length) renderDebriefResult(card, recent[0], { otherPending: triggers, recent: recent.slice(1) });
        else card.innerHTML = `<h2>AI debrief</h2><div class="db-empty">${escapeHtml(r.error)}</div>`;
        return;
      }
      renderDebriefResult(card, r.debrief, { otherPending: triggers.filter(t => t !== trigger), recent });
    } catch (e) {
      card.innerHTML = `<h2>AI debrief</h2><div class="empty" style="color:var(--danger);">Generation failed: ${escapeHtml(e.message || 'unknown')}</div>`;
    }
    return;
  }

  if (recent.length) {
    renderDebriefResult(card, recent[0], { otherPending: triggers, recent: recent.slice(1) });
    return;
  }

  // Unlocked but no pending triggers and no recent debriefs — offer manual run.
  card.innerHTML = `
    <h2>AI debrief</h2>
    <div class="db-empty">
      No review is scheduled right now. You can request a review of the available past-day records.
      <button class="btn" id="debriefManualBtn" style="margin-top:10px;">Generate weekly debrief</button>
    </div>`;
  $('#debriefManualBtn').addEventListener('click', () => {
    renderDebriefGenerating(card, 'weekly');
    api('/api/debrief', { method: 'POST', body: { trigger: 'weekly' } })
      .then(r => renderDebriefResult(card, r.debrief, { otherPending: [], recent: [] }))
      .catch(e => { card.innerHTML = `<h2>AI debrief</h2><div class="empty" style="color:var(--danger);">Failed: ${escapeHtml(e.message || '')}</div>`; });
  });
}

function isoWeekClient() {
  const d = new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  const n = 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(n).padStart(2,'0')}`;
}

function renderDebriefLocked(card, checklist) {
  const items = (checklist || []).map(c => {
    const tick = c.done ? '✓' : '○';
    const cls = c.done ? 'done' : 'pending';
    const prog = c.progress && !c.done
      ? ` <span class="db-prog">(${c.progress.current}/${c.progress.target})</span>`
      : '';
    return `<div class="db-check ${cls}"><span class="db-tick">${tick}</span> ${escapeHtml(c.label)}${prog}</div>`;
  }).join('');
  card.innerHTML = `
    <h2>🤖 AI debrief <span class="db-lock-tag">LOCKED</span></h2>
    <div class="db-lock-blurb">Log on at least five past days for your current goal to unlock a review of the available records and one practical next step.</div>
    <div class="db-checklist">${items}</div>
  `;
}

function renderDebriefGenerating(card, trigger) {
  const meta = DEBRIEF_TRIGGER_META[trigger] || DEBRIEF_TRIGGER_META.weekly;
  card.innerHTML = `
    <h2>${meta.label}</h2>
    <div id="debriefLoaderSlot"></div>
  `;
  if (typeof showAILoader === 'function') showAILoader($('#debriefLoaderSlot'), 'Reading your week…');
}

// Some older cached debrief entries lead with the section name
// ("WORKING: weight down…"). New entries are sanitized server-side at save
// time; this is a defense-in-depth strip for anything already on disk.
const DEBRIEF_PREFIX_RE = /^\s*(?:WORKING|LEAK|TRY(?:\s+THIS\s+WEEK)?)\s*[:\-–—]\s*/i;
function stripDebriefPrefix(s) {
  if (!s) return '';
  return String(s).replace(DEBRIEF_PREFIX_RE, '');
}

// Tapping a date chip inside the debrief card jumps to that day in the
// History calendar. Switches view if we're not already on History.
function jumpToCalendarDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
  if (typeof setActiveView === 'function') setActiveView('history');
  const [y, m] = iso.split('-').map(Number);
  calYear  = y;
  calMonth = m - 1;
  renderCalendar();
  calSelectedDate = iso;
  renderCalDetail(iso);
  // Highlight the cell after the next paint.
  requestAnimationFrame(() => {
    const cell = document.querySelector(`.cal-cell[data-date="${iso}"]`);
    if (cell) {
      document.querySelectorAll('.cal-cell.selected').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

function renderDebriefResult(card, debrief, opts = {}) {
  const meta = DEBRIEF_TRIGGER_META[debrief.trigger] || DEBRIEF_TRIGGER_META.weekly;
  const when = new Date(debrief.generated_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  // "Next debrief" tooltip — weekly heartbeat fires on the next Monday after this
  // ISO week ends. Triggered alerts (plateau/drift/etc) don't have a schedule
  // so we just show the next weekly cycle as the reference.
  const nextWeekly = (() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const day = d.getDay();                                 // 0=Sun, 1=Mon
    const ahead = day === 0 ? 1 : day === 1 ? 7 : 8 - day;  // days until next Mon (Mon→7d)
    d.setDate(d.getDate() + ahead);
    return d;
  })();
  const daysToNext = Math.round((nextWeekly - new Date().setHours(0,0,0,0)) / 86400000);
  const relText = daysToNext === 0 ? 'later today'
                : daysToNext === 1 ? 'tomorrow'
                : daysToNext === 7 ? 'in a week'
                : `in ${daysToNext} days`;
  const nextStr = nextWeekly.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const nextTooltip = `Next weekly debrief ${relText} (${nextStr}). Auto-generates on your next History visit then.`;
  const otherCount = (opts.otherPending || []).length;
  const otherBanner = otherCount > 0
    ? `<div class="db-other">+${otherCount} other alert${otherCount === 1 ? '' : 's'} this week — <button class="db-link" id="debriefShowOther">view</button></div>`
    : '';
  const fb = debrief.feedback;
  // Status band:
  //   green  → on-plan (no real leak being flagged)
  //   amber  → off-plan weekly review (general drift)
  //   red    → triggered alert (plateau / drift / drop / streak break)
  const statusCls = debrief.on_plan
    ? 'db-status-good'
    : (debrief.trigger && debrief.trigger !== 'weekly')
      ? 'db-status-alert'
      : 'db-status-warn';

  // Trend lines snapshot — short phrases under the WORKING headline
  // ("3rd losing week in a row", "Last week +0.4 kg · pace picking up").
  const trendLinesHtml = (Array.isArray(debrief.trend_lines) && debrief.trend_lines.length)
    ? `<div class="db-trend">${debrief.trend_lines.map(escapeHtml).join(' · ')}</div>`
    : '';

  // Clickable date chip — appears beside the leak/try text when the AI cited a
  // specific day. Tapping jumps to that day in the History calendar.
  const dateChip = (iso) => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    const label = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return `<button type="button" class="db-date-chip" data-jump-date="${escapeHtml(iso)}" title="Open this day in the calendar">📅 ${label} →</button>`;
  };

  // Thumbs-down follow-up: replace the inline state with 4 quick "what was off?"
  // buttons. Reason gets posted alongside the down vote; persisted server-side
  // for prompt tuning. If a reason is already saved, show the cooled-down state.
  const reasonLabels = {
    wrong_leak: 'Wrong leak',
    too_vague: 'Too vague',
    not_actionable: 'Not actionable',
    felt_generic: 'Felt generic'
  };
  const downFollowUp = (() => {
    if (debrief.feedback_reason && reasonLabels[debrief.feedback_reason]) {
      return `<span class="db-feedback-state">Noted: ${reasonLabels[debrief.feedback_reason]}.</span>`;
    }
    const opts = Object.entries(reasonLabels)
      .map(([k, v]) => `<button class="db-reason-btn" data-reason="${k}" type="button">${v}</button>`)
      .join('');
    return `<div class="db-reason-wrap"><span class="db-reason-label">What was off?</span>${opts}</div>`;
  })();

  card.innerHTML = `
    <div class="db-status ${statusCls}"></div>
    <h2>${meta.label} <span class="db-when" title="${nextTooltip}">${when}</span></h2>
    <div class="db-section db-working">
      <div class="db-section-label">Working</div>
      <div class="db-section-text">${escapeHtml(stripDebriefPrefix(debrief.working) || '—')}</div>
      ${trendLinesHtml}
    </div>
    <div class="db-section db-leak">
      <div class="db-section-label">Leak</div>
      <div class="db-section-text">${escapeHtml(stripDebriefPrefix(debrief.leak) || '—')}</div>
      ${dateChip(debrief.leak_date)}
    </div>
    <div class="db-section db-try">
      <div class="db-section-label">Try this week</div>
      <div class="db-section-text">${escapeHtml(stripDebriefPrefix(debrief.try_this) || '—')}</div>
      ${dateChip(debrief.try_date)}
    </div>
    ${otherBanner}
    <div class="db-feedback">
      <span class="db-feedback-label">Was this useful?</span>
      <button class="db-thumb ${fb === 'up' ? 'active' : ''}" data-fb="up" ${fb ? 'disabled' : ''} aria-label="useful">👍</button>
      <button class="db-thumb ${fb === 'down' ? 'active' : ''}" data-fb="down" ${fb ? 'disabled' : ''} aria-label="not useful">👎</button>
      ${fb === 'up'
        ? `<span class="db-feedback-state">Glad it helped.</span>`
        : fb === 'down'
        ? downFollowUp
        : ''}
    </div>
  `;

  // Wire up the date chips → jump to the calendar day in History.
  card.querySelectorAll('.db-date-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const iso = btn.dataset.jumpDate;
      if (!iso || typeof jumpToCalendarDate !== 'function') return;
      jumpToCalendarDate(iso);
    });
  });

  // Wire up the reason buttons → POST reason, re-render in the noted state.
  card.querySelectorAll('.db-reason-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = btn.dataset.reason;
      card.querySelectorAll('.db-reason-btn').forEach(b => b.disabled = true);
      try {
        await api(`/api/debrief/${debrief.id}/feedback`, { method: 'POST', body: { value: 'down', reason } });
        debrief.feedback_reason = reason;
        renderDebriefResult(card, debrief, opts);
      } catch (_) {
        card.querySelectorAll('.db-reason-btn').forEach(b => b.disabled = false);
      }
    });
  });

  card.querySelectorAll('.db-thumb').forEach(btn => btn.addEventListener('click', async () => {
    const val = btn.dataset.fb;
    btn.disabled = true;
    try {
      await api(`/api/debrief/${debrief.id}/feedback`, { method: 'POST', body: { value: val } });
      debrief.feedback = val;
      renderDebriefResult(card, debrief, opts);
    } catch (_) { btn.disabled = false; }
  }));

  const regenBtn = $('#debriefRegen');
  if (regenBtn) regenBtn.addEventListener('click', async () => {
    renderDebriefGenerating(card, debrief.trigger);
    try {
      const r = await api('/api/debrief', { method: 'POST', body: { trigger: debrief.trigger, force: true } });
      // Rate-limit responses come back as { error: "..." } not a debrief object.
      if (r && r.error && !r.debrief) {
        renderDebriefResult(card, debrief, opts);
        if (typeof showToast === 'function') showToast(r.error);
        return;
      }
      renderDebriefResult(card, r.debrief, opts);
    } catch (e) {
      card.innerHTML = `<h2>AI debrief</h2><div class="empty" style="color:var(--danger);">Regenerate failed: ${escapeHtml(e.message || '')}</div>`;
    }
  });

  const otherBtn = $('#debriefShowOther');
  if (otherBtn) {
    otherBtn.addEventListener('click', async () => {
      // Generate + show the next pending trigger (cycles through them on each click).
      const next = opts.otherPending[0];
      renderDebriefGenerating(card, next);
      try {
        const r = await api('/api/debrief', { method: 'POST', body: { trigger: next } });
        renderDebriefResult(card, r.debrief, {
          otherPending: opts.otherPending.slice(1),
          recent: opts.recent
        });
      } catch (e) {
        card.innerHTML = `<h2>AI debrief</h2><div class="empty" style="color:var(--danger);">Failed: ${escapeHtml(e.message || '')}</div>`;
      }
    });
  }
}

async function loadHistory() {
  renderDebriefCard();
  renderWeeklyReview();
  renderProteinAdherence();

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
    if (date < startStr || date > endStr || date >= fmtDate(new Date())) return;
    if (!info || !info.kcal) return;
    const dow = new Date(date + 'T00:00:00').getDay();
    buckets[dow].sum += info.kcal;
    buckets[dow].count += 1;
  });
  const dowNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const data = buckets.map((b, i) => ({ name: dowNames[i], avg: b.count > 0 ? Math.round(b.sum / b.count) : null, count: b.count }));
  const totalDays = data.reduce((a, d) => a + d.count, 0);
  if (totalDays < 7) {
    el.innerHTML = `<h2>Day-of-week pattern</h2>` + (totalDays === 0
      ? cbEmptyState(`<div class="empty" style="padding:12px 0;">Log 7 more days to see your weekday patterns.</div>`)
      : `<div class="empty" style="padding:12px 0;">Log ${7 - totalDays} more day${totalDays === 6 ? '' : 's'} to see your weekday patterns.</div>`);
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
  const today = fmtDate(new Date());
  const records = Object.entries(rangeData).filter(([date]) => date >= startStr && date <= endStr)
    .map(([date, value]) => ({ date, ...value })).sort((a, b) => a.date.localeCompare(b.date));
  const past = records.filter(d => d.date < today);
  const assessed = past.filter(d => ['below', 'within', 'above'].includes(d.assessment));
  const average = past.length ? Math.round(past.reduce((sum, d) => sum + d.kcal, 0) / past.length) : null;
  $('#kcalTrendStats').innerHTML = `<span>${average === null ? 'No past-day average yet' : `<strong>${average.toLocaleString()}</strong> kcal average across ${past.length} past logged days`}</span>
    <span>${assessed.length ? `${assessed.filter(d => d.assessment === 'within').length}/${assessed.length} within recorded target ±200 kcal` : 'No past days with a scorable target'}</span>
    <span>Today is in progress. Missing days are unknown.</span>`;
  if (!records.length) { $('#kcalTrendChart').innerHTML = '<p class="history-note">No food entries in this window.</p>'; return; }
  const W = 560, H = 100, bottom = 82;
  const span = Math.max(1, GoalPolicy.daysBetween(startStr, endStr));
  const max = Math.max(1, ...records.flatMap(d => [d.kcal, d.goal || 0])) * 1.1;
  const x = date => 5 + GoalPolicy.daysBetween(startStr, date) / span * (W - 10);
  const y = kcal => bottom - kcal / max * 72;
  let previous = null;
  const lines = records.map(d => {
    const line = previous && GoalPolicy.daysBetween(previous.date, d.date) === 1
      ? `<line x1="${x(previous.date)}" y1="${y(previous.kcal)}" x2="${x(d.date)}" y2="${y(d.kcal)}" stroke="var(--text-dim)" />` : '';
    previous = d;
    return line + `<circle cx="${x(d.date)}" cy="${y(d.kcal)}" r="3" fill="${d.date === today ? 'var(--info)' : 'var(--text-dim)'}"><title>${d.date}: ${d.kcal} kcal${d.date === today ? ' so far' : ''}</title></circle>` +
      (d.goal ? `<line x1="${x(d.date) - 3}" x2="${x(d.date) + 3}" y1="${y(d.goal)}" y2="${y(d.goal)}" stroke="var(--accent)"><title>Recorded target: ${d.goal} kcal</title></line>` : '');
  }).join('');
  $('#kcalTrendChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Logged calories and recorded daily targets">${lines}</svg>
    <div class="intake-legend"><span>${startStr}</span><span>Dots: logged intake · ticks: recorded targets</span><span>${endStr}</span></div>`;
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
    else if (isToday) cls += ' in-progress';
    else if (entry.assessment === 'within') cls += ' on-target';
    else if (entry.assessment === 'below') cls += ' under';
    else if (entry.assessment === 'above') cls += ' over';
    else cls += ' unscored';

    let proteinHtml = '';
    if (entry && entry.protein !== undefined) {
      const pg = entry.protein_goal;
      const eligible = !isToday && entry.goal_mode !== 'reset' && pg;
      const hit = eligible ? entry.protein >= pg * 0.9 : null;
      proteinHtml = `<div class="cal-day-protein ${hit === null ? '' : hit ? 'hit' : 'miss'}">${Math.round(entry.protein)}p</div>`;
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
  const contextNote = date === fmtDate(new Date()) ? 'Today is in progress.' : data.stats ? `Recorded goal: ${GoalPolicy.LABELS[data.stats.goal] || data.stats.goal} · ${data.stats.kcal_goal} kcal.` : 'No historical target was recorded for this date; totals are unscored.';
  $('#calDetail').innerHTML = `<div class="cal-detail-drawer">${header}<p class="history-note">${escapeHtml(contextNote)}</p>${body}</div>`;
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
