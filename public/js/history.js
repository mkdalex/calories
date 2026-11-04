// ---------- TRENDS (was History) ----------
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let calRangeData = {}; // date -> { kcal, protein, goal, protein_goal, goal_mode, assessment }
let calSelectedDate = null;

// 7, 30 or 90 days. Remembered per browser; falls back to a week.
let trendDays = 7;
try { trendDays = [7, 30, 90].includes(Number(localStorage.getItem('trendRange'))) ? Number(localStorage.getItem('trendRange')) : 7; } catch (_) {}

const niceDate = ds => new Date(ds + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' });

function trendWindow() {
  const end = fmtDate(new Date());
  return { start: GoalPolicy.shiftDate(end, -(trendDays - 1)), end };
}

function setTrendRange(days) {
  trendDays = days;
  try { localStorage.setItem('trendRange', String(days)); } catch (_) {}
  syncRangeToggle();
  renderTrendRange();
  renderWeightCard();
}

function syncRangeToggle() {
  $$('.range-toggle button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.range) === trendDays)));
}

function renderTrendRange() {
  const { start, end } = trendWindow();
  renderKcalTrend(start, end, calRangeData);
  renderTrendTiles(start, end, calRangeData);
}

// ===== Calories: daily bars against the target =====
// Today is drawn as a dashed outline and never counts toward the average.
function renderKcalTrend(startStr, endStr, rangeData) {
  const today = fmtDate(new Date());
  const days = [];
  for (let d = startStr; d <= endStr; d = GoalPolicy.shiftDate(d, 1)) days.push({ date: d, ...(rangeData[d] || {}) });
  const past = days.filter(d => d.date < today && d.kcal != null);
  const average = past.length ? Math.round(past.reduce((s, d) => s + d.kcal, 0) / past.length) : null;
  const scored = past.filter(d => d.goal && d.goal_mode !== 'reset');
  const diff = scored.length ? Math.round(scored.reduce((s, d) => s + d.kcal - d.goal, 0) / scored.length) : null;

  $('#kcalTrendStats').innerHTML = `
    <div class="kt-head">
      <div class="kt-figure">
        <span class="kt-label">Daily average</span>
        <span class="kt-num">${average === null ? '—' : `${average.toLocaleString()} <small>kcal</small>`}</span>
        <span class="kt-sub">${average === null ? 'No past-day average yet' : `${past.length} logged day${past.length === 1 ? '' : 's'} · today not counted`}</span>
      </div>
      ${diff === null ? '' : `<span class="kt-badge ${diff > 0 ? 'over' : ''}">${Math.abs(diff).toLocaleString()} ${diff > 0 ? 'over' : 'under'} target</span>`}
    </div>`;

  const logged = days.filter(d => d.kcal != null);
  if (!logged.length) {
    $('#kcalTrendChart').innerHTML = cbEmptyState('<p class="history-note">Nothing logged in this window.</p>');
    return;
  }
  const target = [...days].reverse().find(d => d.goal && d.goal_mode !== 'reset')?.goal || null;
  const max = Math.max(1, ...logged.map(d => d.kcal), target || 0) * 1.08;
  const label = d => d.date === today ? 'Today' : new Date(d.date + 'T00:00:00').toLocaleDateString([], { weekday: 'short' });
  const bars = days.map(d => {
    const when = d.date === today ? 'Today' : niceDate(d.date);
    if (d.kcal == null) return `<span class="kt-col"><span class="kt-bar missing" title="${when}: nothing logged"></span></span>`;
    const state = d.date === today ? 'in-progress' : !d.goal || d.goal_mode === 'reset' ? 'plain' : d.kcal > d.goal ? 'over' : 'under';
    const note = state === 'in-progress' ? ' so far' : d.goal ? ` · target ${d.goal.toLocaleString()}` : '';
    return `<span class="kt-col"><span class="kt-bar ${state}" style="height:${(d.kcal / max * 100).toFixed(1)}%" title="${when}: ${d.kcal.toLocaleString()} kcal${note}"></span></span>`;
  }).join('');
  // Short ranges label every day; longer ones just the ends and the middle.
  const labels = days.length <= 7
    ? days.map(d => `<span class="${d.date === today ? 'now' : ''}">${label(d)}</span>`).join('')
    : [days[0], days[Math.floor(days.length / 2)], days[days.length - 1]].map(d => `<span class="${d.date === today ? 'now' : ''}">${d.date === today ? 'Today' : niceDate(d.date)}</span>`).join('');
  $('#kcalTrendChart').innerHTML = `
    <div class="kt-plot ${days.length > 30 ? 'dense' : ''}" role="img" aria-label="Daily calories for the last ${days.length} days${target ? ` against a ${target.toLocaleString()} kcal target` : ''}" style="--n:${days.length}">
      ${target ? `<span class="kt-target" style="bottom:${(target / max * 100).toFixed(1)}%"><span>target ${target.toLocaleString()}</span></span>` : ''}
      ${bars}
    </div>
    <div class="kt-labels ${days.length <= 7 ? 'each' : 'ends'}" style="--n:${days.length}" aria-hidden="true">${labels}</div>
    <div class="kt-legend" aria-hidden="true">
      <span><i class="under"></i>Under</span><span><i class="over"></i>Over target</span><span><i class="in-progress"></i>In progress</span>
    </div>`;
}

// ===== Two stat tiles: protein days and logging coverage =====
function renderTrendTiles(startStr, endStr, rangeData) {
  const today = fmtDate(new Date());
  const days = [];
  for (let d = startStr; d <= endStr; d = GoalPolicy.shiftDate(d, 1)) days.push({ date: d, ...(rangeData[d] || {}) });
  const past = days.filter(d => d.date < today && d.kcal != null);
  const proteinScored = past.filter(d => d.protein_goal && d.goal_mode !== 'reset');
  const proteinHit = proteinScored.filter(d => d.protein >= d.protein_goal * 0.9).length;
  const avgProtein = past.length ? Math.round(past.reduce((s, d) => s + (d.protein || 0), 0) / past.length) : null;
  const loggedDays = days.filter(d => d.kcal != null).length;
  const t = typeof state !== 'undefined' ? state.today : null;
  const streak = t && t.date === today && t.streak > 0 ? `${t.streak}-day streak` : '';
  $('#trendTiles').innerHTML = `
    <div class="trend-tile">
      <span class="tt-label">Protein target hit</span>
      <span class="tt-num prot">${proteinScored.length ? `${proteinHit} <small>of ${proteinScored.length} days</small>` : '—'}</span>
      <span class="tt-sub">${avgProtein === null ? 'No past days yet' : `avg ${avgProtein}g`}</span>
    </div>
    <div class="trend-tile">
      <span class="tt-label">Days logged</span>
      <span class="tt-num">${loggedDays} <small>of ${days.length}</small></span>
      <span class="tt-sub">${streak || '&nbsp;'}</span>
    </div>`;
}

// ===== Weight =====
// Observations only: latest weigh-in, change across the shown weigh-ins, and distance
// to a goal weight if one is set. No forecasts.
async function renderWeightCard() {
  const wrap = $('#weightHistory');
  if (!wrap) return;
  const [weights, profileData] = await Promise.all([api('/api/weight'), api('/api/profile')]);
  const head = (label, value) => `
    <div class="wt-head">
      <div class="wt-figure">${label}${value}</div>
      <button class="chip-btn ghost" id="weighInToggle" type="button" aria-controls="weighInForm">+ Weigh in</button>
    </div>`;

  if (!weights.length) {
    wrap.innerHTML = head('<span class="wt-label" id="weightTitle">Weight</span>', '<span class="wt-sub">No weigh-ins yet.</span>');
    wireWeighIn();
    return;
  }

  const last = weights[weights.length - 1];
  const { start } = trendWindow();
  const inRange = weights.filter(w => w.date >= start);
  // A short window often holds 0-1 weigh-ins; then show the most recent few instead.
  const shown = inRange.length >= 2 ? inRange : weights.slice(-8);
  const first = shown[0];
  const delta = Math.round((last.kg - first.kg) * 10) / 10;
  const span = GoalPolicy.daysBetween(first.date, last.date);

  const profile = (profileData && profileData.profile) || {};
  const stats = (profileData && profileData.stats) || {};
  const goalKg = Number(profile.goal_weight_kg) || null;
  const towardGoal = goalKg && delta !== 0 && Math.sign(goalKg - first.kg) === Math.sign(delta);
  const deltaText = shown.length >= 2
    ? `<span class="wt-delta ${towardGoal ? 'good' : ''}">${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta).toFixed(1)} kg in ${span} day${span === 1 ? '' : 's'}</span>` : '';

  wrap.innerHTML = head(
    `<span class="wt-label" id="weightTitle">Weight · ${niceDate(last.date)}</span>`,
    `<span class="wt-num">${last.kg.toFixed(1)} <small>kg</small></span>${deltaText}`)
    + weightChart(shown)
    + goalProgress(weights, last, goalKg, stats.goal_started)
    + `<details class="weigh-list">
        <summary>All weigh-ins</summary>
        ${[...weights].reverse().slice(0, 30).map((w, i, list) => {
          const prev = list[i + 1];
          const d = prev ? Math.round((w.kg - prev.kg) * 10) / 10 : null;
          return `<div class="weight-row">
            <button class="wr-edit" type="button" data-date="${w.date}" aria-label="Edit weigh-in for ${niceDate(w.date)}">
              <span class="wr-date">${new Date(w.date + 'T00:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <span class="wr-kg">${w.kg.toFixed(1)} kg</span>
              <span class="wr-delta">${d === null ? '' : d === 0 ? 'same' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`}</span>
            </button>
            <button class="wr-del" type="button" data-date="${w.date}" aria-label="Delete weigh-in for ${niceDate(w.date)}">×</button>
          </div>`;
        }).join('')}
      </details>`;

  wireWeighIn();
  wrap.querySelectorAll('.wr-del').forEach(btn => btn.addEventListener('click', async () => {
    const date = btn.dataset.date;
    const entry = weights.find(w => w.date === date);
    await api(`/api/weight/${date}`, { method: 'DELETE' });
    renderWeightCard();
    if (entry) {
      showUndoToast(`Deleted weigh-in for ${niceDate(date)}`, async () => {
        await api('/api/weight', { method: 'POST', body: { kg: entry.kg, date: entry.date } });
        renderWeightCard();
      });
    }
  }));
  wrap.querySelectorAll('.wr-edit').forEach(btn => btn.addEventListener('click', () => {
    const date = btn.dataset.date;
    const cur = weights.find(w => w.date === date);
    if (!cur) return;
    const val = prompt(`Weight for ${niceDate(date)}:`, cur.kg);
    if (val === null) return;
    const kg = Number(val);
    if (!kg || kg < 30 || kg > 250) return showToast('Enter a weight between 30 and 250');
    api('/api/weight', { method: 'POST', body: { kg, date } }).then(() => renderWeightCard());
  }));
}

function wireWeighIn() {
  const toggle = $('#weighInToggle');
  if (toggle) toggle.addEventListener('click', () => {
    const form = $('#weighInForm');
    const open = form.classList.toggle('hidden') === false;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) $('#weightInput').focus();
  });
}

// Line through the shown weigh-ins, each one labelled (or just the ends and extremes
// when there are many). Drawn at the card's real width so text stays a readable size.
function weightChart(points) {
  if (points.length < 2) return '';
  const card = $('#weightCard');
  const W = Math.max(260, Math.round(((card && card.clientWidth) || 350) - 34));
  const H = 132, top = 22, bottom = 108, left = 8, right = W - 8;
  const kgs = points.map(p => p.kg);
  const lo = Math.min(...kgs) - 0.3, hi = Math.max(...kgs) + 0.3;
  const span = Math.max(1, GoalPolicy.daysBetween(points[0].date, points[points.length - 1].date));
  const x = p => left + 12 + GoalPolicy.daysBetween(points[0].date, p.date) / span * (right - left - 24);
  const y = kg => top + (hi - kg) / (hi - lo) * (bottom - top);
  const minI = kgs.indexOf(Math.min(...kgs)), maxI = kgs.indexOf(Math.max(...kgs));
  const labelled = points.length <= 8 ? points.map((_, i) => i) : [...new Set([0, minI, maxI, points.length - 1])];
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)} ${y(p.kg).toFixed(1)}`).join(' ');
  const lastI = points.length - 1;
  const dots = points.map((p, i) => i === lastI
    ? `<circle cx="${x(p).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="5.5" class="wc-last"/>`
    : `<circle cx="${x(p).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="4" class="wc-dot"/>`).join('');
  const labels = labelled.map(i => {
    const p = points[i];
    const anchor = i === 0 ? 'start' : i === lastI ? 'end' : 'middle';
    return `<text x="${(x(p) + (i === 0 ? -6 : i === lastI ? 6 : 0)).toFixed(1)}" y="${(y(p.kg) - 10).toFixed(1)}" text-anchor="${anchor}" class="${i === lastI ? 'wc-label now' : 'wc-label'}">${p.kg.toFixed(1)}</text>`;
  }).join('');
  const mid = points[Math.floor(points.length / 2)];
  return `
    <svg class="weight-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Weight from ${points[0].kg} kg on ${niceDate(points[0].date)} to ${points[lastI].kg} kg on ${niceDate(points[lastI].date)}">
      <line x1="0" y1="${bottom + 6}" x2="${W}" y2="${bottom + 6}" class="wc-axis"/>
      <path d="${path}" class="wc-line"/>
      ${dots}${labels}
      <text x="0" y="${H - 2}" class="wc-date">${niceDate(points[0].date)}</text>
      ${points.length > 2 ? `<text x="${W / 2}" y="${H - 2}" text-anchor="middle" class="wc-date">${niceDate(mid.date)}</text>` : ''}
      <text x="${W}" y="${H - 2}" text-anchor="end" class="wc-date">${niceDate(points[lastI].date)}</text>
    </svg>`;
}

function goalProgress(weights, last, goalKg, goalStarted) {
  if (!goalKg) return '';
  const startW = (goalStarted && weights.find(w => w.date >= goalStarted)) || weights[0];
  const total = startW.kg - goalKg;
  const done = startW.kg - last.kg;
  const pct = total === 0 ? 100 : Math.max(0, Math.min(100, done / total * 100));
  const left = Math.abs(last.kg - goalKg);
  const reached = total === 0 || (total > 0 ? last.kg <= goalKg : last.kg >= goalKg);
  return `
    <div class="wt-goal">
      <div class="wt-goal-bar" role="img" aria-label="${Math.round(pct)}% of the way to ${goalKg} kg"><span style="width:${pct.toFixed(0)}%"></span></div>
      <span>${reached ? `Goal weight of ${goalKg} kg reached` : `${left.toFixed(1)} kg to ${goalKg} kg goal`}</span>
    </div>`;
}

// ===== Target check (was "Recent progress") =====
async function renderPredictedActual() {
  const card = $('#predictedActualCard');
  if (!card) return;
  const [review, profile] = await Promise.all([api('/api/calibrate'), api('/api/profile')]);
  const stats = profile.stats;
  if (!stats) { card.innerHTML = '<h2>Target check</h2><p class="history-note">Set up a profile first.</p>'; return; }
  const label = GoalPolicy.LABELS[stats.goal] || stats.goal_meta.label;
  card.innerHTML = `<h2>Target check · ${escapeHtml(label)}</h2>
    ${stats.goal === 'reset' ? '<p class="history-note">Reset week: weight change isn\'t scored.</p>'
      : review.can_calibrate
        ? `<p class="history-note"><strong>${review.weight_start} → ${review.weight_end} kg</strong> over ${review.days_span} days, with food logged on ${review.days_logged} of them.</p>`
        : `<p class="history-note">${escapeHtml(review.reason || 'Not enough recent records yet.')}</p>`}
    <button class="btn btn-secondary" type="button" onclick="setActiveView('profile')">Review target</button>`;
}

// ===== Source quality breakdown =====
async function renderSourceQuality() {
  const card = $('#sourceQualityCard');
  if (!card) return;
  const data = await api('/api/source-breakdown');
  const sources = Object.entries(data);
  if (!sources.length) {
    card.innerHTML = '<h2>Where your numbers come from</h2><p class="history-note">Log some meals to see this.</p>';
    return;
  }
  const totalKcal = sources.reduce((a, [, v]) => a + v.kcal, 0);

  // Same colour roles as the source badges: databases accent, your own foods info, guesses warn.
  const dbSoft = 'color-mix(in srgb, var(--accent) 55%, var(--panel-2))';
  const meta = {
    'custom':       { label: 'Your saved foods',   color: 'var(--info)',     tier: 'best' },
    'usda':         { label: 'USDA',               color: 'var(--accent)',   tier: 'best' },
    'usda+ai':      { label: 'USDA',               color: 'var(--accent)',   tier: 'best' },
    'ai-verified':  { label: 'AI verified',        color: dbSoft,            tier: 'good' },
    'fatsecret':    { label: 'FatSecret',          color: dbSoft,            tier: 'good' },
    'openfoodfacts':{ label: 'Open Food Facts',    color: dbSoft,            tier: 'good' },
    'ai-estimate':  { label: 'AI estimate',        color: 'var(--warn)',     tier: 'rough' },
    'manual':       { label: 'Typed in',           color: 'var(--text-dim)', tier: 'best' },
    'extra':        { label: 'Added extras',       color: 'var(--text-dim)', tier: 'rough' }
  };

  sources.sort((a, b) => b[1].kcal - a[1].kcal);
  const segments = sources.map(([src, v]) => {
    const m = meta[src] || { label: src, color: 'var(--text-dim)', tier: 'rough' };
    return { src, ...v, ...m, pct: totalKcal > 0 ? (v.kcal / totalKcal * 100) : 0 };
  });
  const trustedShare = segments.filter(s => s.tier === 'best').reduce((a, s) => a + s.pct, 0);

  card.innerHTML = `
    <h2>Where your numbers come from</h2>
    <p class="history-note"><strong>${Math.round(trustedShare)}%</strong> of your kcal came from lab data, your saved foods or numbers you typed.</p>
    <div class="sq-bar">
      ${segments.map(s => `<div class="sq-seg" style="width:${s.pct}%;background:${s.color};" title="${s.label} · ${s.pct.toFixed(0)}%"></div>`).join('')}
    </div>
    <div class="sq-legend">${segments.map(s => `
      <div class="sq-row">
        <span class="sq-dot" style="background:${s.color};"></span>
        <span class="sq-label">${s.label}</span>
        <span class="sq-pct">${s.pct.toFixed(0)}%</span>
        <span class="sq-count">${s.count} meal${s.count !== 1 ? 's' : ''}</span>
      </div>`).join('')}
    </div>
    <p class="history-note">Saving an AI guess as your food means next time it uses your number.</p>
  `;
}

async function renderProteinAdherence() {
  const card = $('#proteinAdherenceCard');
  if (!card) return;
  const r = await api('/api/protein-adherence?days=30');
  if (r.empty || r.error) { card.innerHTML = '<h2>Protein, last 30 days</h2><p class="history-note">Set up your profile to track protein.</p>'; return; }
  const maximum = Math.max(1, ...r.series.map(d => d.protein || 0));
  const width = 560 / r.series.length;
  const bars = r.series.map((d, i) => {
    if (d.protein === null) return '';
    const height = d.protein / maximum * 54;
    return `<rect x="${i * width}" y="${58 - height}" width="${Math.max(1, width - 2)}" height="${height}" rx="1.5" fill="${d.hit === true ? 'var(--purple)' : 'var(--track)'}"><title>${d.date}: ${d.protein} g${d.target ? `, target ${d.target} g` : ', not scored'}</title></rect>`;
  }).join('');
  card.innerHTML = `<h2>Protein, last 30 days</h2>
    ${r.days_logged ? `<div class="pa-stat-grid">
      <div class="pa-stat"><div class="pa-num">${r.days_assessed ? `${r.days_hit}/${r.days_assessed}` : '—'}</div><div class="pa-lbl">days at 90%+ of target</div></div>
      <div class="pa-stat"><div class="pa-num">${r.avg_protein} g</div><div class="pa-lbl">average over ${r.days_logged} logged days</div></div>
    </div><svg viewBox="0 0 560 60" width="100%" role="img" aria-label="Protein on past days">${bars}</svg>`
      : '<p class="history-note">No past days logged in this window yet.</p>'}
    <p class="history-note">Today, missing days and reset days aren't scored.</p>`;
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
      No review is due yet. You can ask for one now.
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
    <h2>AI debrief <span class="db-lock-tag">Locked</span></h2>
    <div class="db-lock-blurb">Log five past days on your current goal to unlock a weekly review with one thing to try.</div>
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
// Trends calendar. Switches view if we're not already on Trends.
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
  const nextTooltip = `Next weekly debrief ${relText} (${nextStr}). It writes itself next time you open Trends.`;
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
    return `<button type="button" class="db-date-chip" data-jump-date="${escapeHtml(iso)}" title="Open this day in the calendar">${label} →</button>`;
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
  syncRangeToggle();
  renderDebriefCard();
  renderProteinAdherence();
  renderPredictedActual();
  renderSourceQuality();

  // One range fetch covers the 90-day chart, the 60-day weekday pattern and the
  // calendar month (the server only returns days that have entries).
  const today = fmtDate(new Date());
  const mm = String(calMonth + 1).padStart(2, '0');
  const calStart = `${calYear}-${mm}-01`;
  const calEnd = `${calYear}-${mm}-${String(new Date(calYear, calMonth + 1, 0).getDate()).padStart(2, '0')}`;
  const allStart = [GoalPolicy.shiftDate(today, -89), calStart].sort()[0];
  const allEnd = [today, calEnd].sort().reverse()[0];
  calRangeData = await api(`/api/log-range?start=${allStart}&end=${allEnd}`);

  renderTrendRange();
  renderWeightCard();
  renderDowPattern(GoalPolicy.shiftDate(today, -59), today, calRangeData);
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
  // Monday first, to match the calendar.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const data = order.map(i => ({ name: dowNames[i], avg: buckets[i].count > 0 ? Math.round(buckets[i].sum / buckets[i].count) : null, count: buckets[i].count }));
  const totalDays = data.reduce((a, d) => a + d.count, 0);
  if (totalDays < 7) {
    el.innerHTML = `<h2>Day of the week</h2>` + (totalDays === 0
      ? cbEmptyState(`<p class="history-note">Log 7 past days to see your weekday pattern.</p>`)
      : `<p class="history-note">Log ${7 - totalDays} more past day${totalDays === 6 ? '' : 's'} to see your weekday pattern.</p>`);
    return;
  }
  const validAvgs = data.filter(d => d.avg !== null).map(d => d.avg);
  const max = Math.max(...validAvgs);
  const heaviest = data.reduce((best, d) => (d.avg !== null && (!best || d.avg > best.avg)) ? d : best, null);
  const lightest = data.reduce((best, d) => (d.avg !== null && (!best || d.avg < best.avg)) ? d : best, null);
  const heavyDelta = heaviest && lightest ? heaviest.avg - lightest.avg : 0;

  const insight = heavyDelta > 200
    ? `${heaviest.name} is your heaviest day (${heaviest.avg.toLocaleString()} kcal), ${lightest.name} your lightest (${lightest.avg.toLocaleString()}).`
    : `Steady across the week, within ${heavyDelta} kcal.`;

  el.innerHTML = `
    <h2>Day of the week <span class="h2-note">last ${totalDays} logged days</span></h2>
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
    <p class="history-note">${insight}</p>
  `;
}

// Monday-first month grid with one status dot per day. Calories over target beat a
// protein shortfall, which beats on target. Today is in progress and gets no verdict.
function renderCalendar() {
  const todayStr = fmtDate(new Date());
  const now = new Date();
  $('#calMonthLabel').textContent = new Date(calYear, calMonth, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
  $('#calNext').disabled = (calYear > now.getFullYear()) || (calYear === now.getFullYear() && calMonth >= now.getMonth());

  const firstDay = (new Date(calYear, calMonth, 1).getDay() + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="cal-dow"><abbr title="${d}">${d[0]}</abbr></div>`).join('');
  for (let i = 0; i < firstDay; i++) html += `<span class="cal-cell blank" aria-hidden="true"></span>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const ds = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const entry = calRangeData[ds];
    const isToday = ds === todayStr;
    if (ds > todayStr) { html += `<span class="cal-cell future">${day}</span>`; continue; }

    let status = '', words = 'nothing logged';
    if (entry && isToday) { status = 'in-progress'; words = 'in progress'; }
    else if (entry) {
      const proteinShort = entry.goal_mode !== 'reset' && entry.protein_goal && entry.protein < entry.protein_goal * 0.9;
      if (entry.assessment === 'above') { status = 'over'; words = 'over target'; }
      else if (proteinShort) { status = 'short'; words = 'protein short'; }
      else if (entry.assessment === 'within' || entry.assessment === 'below') { status = 'on'; words = entry.assessment === 'below' ? 'under target' : 'on target'; }
      else { status = 'plain'; words = 'logged, not scored'; }
      words = `${entry.kcal.toLocaleString()} kcal, ${words}`;
    }
    const cls = ['cal-cell', entry ? 'logged' : 'empty-log', isToday ? 'today' : '', isToday && entry ? 'in-progress' : '', ds === calSelectedDate ? 'selected' : ''].filter(Boolean).join(' ');
    html += `<button type="button" class="${cls}" data-date="${ds}" aria-pressed="${ds === calSelectedDate}" aria-label="${niceDate(ds)}: ${words}">
      <span>${day}</span><i class="dot ${status}"></i>
    </button>`;
  }

  $('#calGrid').innerHTML = html;
  $$('#calGrid .cal-cell[data-date]').forEach(cell => cell.addEventListener('click', async () => {
    const date = cell.dataset.date;
    $$('#calGrid .cal-cell.selected').forEach(c => { c.classList.remove('selected'); c.setAttribute('aria-pressed', 'false'); });
    if (calSelectedDate === date) { calSelectedDate = null; $('#calDetail').innerHTML = ''; return; }
    calSelectedDate = date;
    cell.classList.add('selected');
    cell.setAttribute('aria-pressed', 'true');
    await renderCalDetail(date);
  }));
}

async function renderCalDetail(date) {
  $('#calDetail').innerHTML = `<div class="cal-detail-drawer"><p class="history-note">Loading…</p></div>`;
  const data = await api('/api/log?date=' + date);
  const title = new Date(date + 'T00:00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  const note = date === fmtDate(new Date()) ? 'In progress'
    : data.stats ? `${GoalPolicy.LABELS[data.stats.goal] || data.stats.goal} · target ${data.stats.kcal_goal.toLocaleString()} kcal`
    : 'No target on record, so not scored';
  $('#calDetail').innerHTML = `
    <div class="cal-detail-drawer">
      <div class="cal-detail-header">
        <div>
          <div class="cal-detail-title">${title}</div>
          <div class="cal-detail-sub">${data.entries.length ? `${data.totals.kcal.toLocaleString()} kcal · ${Math.round(data.totals.protein)}g P · ` : ''}${escapeHtml(note)}</div>
        </div>
        <button class="btn btn-secondary" id="calAddMeal" type="button">+ Add meal</button>
      </div>
      ${data.entries.length ? data.entries.map(e => `
        <button class="cal-entry-row" type="button" data-eid="${e.id}">
          <span class="ce-name">${escapeHtml(e.name)}</span>
          <span class="ce-meta">${e.kcal.toLocaleString()} · <strong>${Math.round(e.protein)}g</strong></span>
        </button>`).join('') : '<p class="history-note">Nothing logged this day.</p>'}
    </div>`;
  $('#calAddMeal').addEventListener('click', () => openLogModal(date));
  $$('#calDetail .cal-entry-row').forEach(row => row.addEventListener('click', () => {
    const e = data.entries.find(en => en.id === row.dataset.eid);
    if (e) openEditModal(e, date);
  }));
  const drawer = $('#calDetail .cal-detail-drawer');
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
  const newData = await api(`/api/log-range?start=${calYear}-${mm}-01&end=${calYear}-${mm}-${String(lastDay).padStart(2, '0')}`);
  Object.assign(calRangeData, newData);
  renderCalendar();
}
$('#calPrev').addEventListener('click', () => shiftCalendarMonth(-1));
$('#calNext').addEventListener('click', () => shiftCalendarMonth(1));
$$('.range-toggle button').forEach(btn => btn.addEventListener('click', () => setTrendRange(Number(btn.dataset.range))));

$('#weighInForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const kg = Number($('#weightInput').value);
  if (!kg || kg < 30 || kg > 250) return showToast('Enter a weight between 30 and 250');
  await api('/api/weight', { method: 'POST', body: { kg } });
  $('#weightInput').value = '';
  $('#weighInForm').classList.add('hidden');
  showToast('Weight logged');
  renderWeightCard();
  loadProfile();
});
