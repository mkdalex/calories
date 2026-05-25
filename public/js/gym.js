// ---------- Gym / training tracker ----------

const GYM_SPLITS = [
  { id: 'push',   label: 'Push' },
  { id: 'pull',   label: 'Pull' },
  { id: 'legs',   label: 'Legs' },
  { id: 'upper',  label: 'Upper' },
  { id: 'lower',  label: 'Lower' },
  { id: 'full',   label: 'Full body' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'rest',   label: 'Rest' }
];
const GYM_MUSCLES = [
  { id: 'chest',     label: 'Chest' },
  { id: 'back',      label: 'Back' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'biceps',    label: 'Biceps' },
  { id: 'triceps',   label: 'Triceps' },
  { id: 'quads',     label: 'Quads' },
  { id: 'hamstrings',label: 'Hamstrings' },
  { id: 'glutes',    label: 'Glutes' },
  { id: 'calves',    label: 'Calves' },
  { id: 'abs',       label: 'Abs' },
  { id: 'forearms',  label: 'Forearms' }
];
const GYM_KNOWN_IDS = new Set([...GYM_SPLITS.map(s => s.id), ...GYM_MUSCLES.map(s => s.id)]);

// State held in module scope so picker + week strip share it.
let gymWeekStart = startOfWeek(new Date());          // Monday of the displayed week
let gymData = {};                                    // date -> { types, notes }
let gymPickerDate = null;                            // date being edited in the picker
let gymPickerState = { types: new Set(), notes: '' };

// Monday-based week (gym calendars usually start Monday).
function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();                      // 0=Sun, 1=Mon, ... 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function fmtRangeLabel(weekStart) {
  const end = new Date(weekStart); end.setDate(end.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${weekStart.toLocaleDateString([], opts)} – ${end.toLocaleDateString([], opts)}`;
}

// Render a chip with its label + tone (split / muscle / custom).
function gymTypeChip(t, opts = {}) {
  const known = GYM_KNOWN_IDS.has(t);
  const split = GYM_SPLITS.find(s => s.id === t);
  const muscle = GYM_MUSCLES.find(s => s.id === t);
  const label = (split || muscle) ? (split || muscle).label : t;
  const tone = t === 'rest' ? 'rest' : split ? 'split' : muscle ? 'muscle' : 'custom';
  const dismiss = opts.dismissible ? `<span class="gym-chip-x" data-rm="${t}" title="Remove">×</span>` : '';
  return `<span class="gym-chip ${tone}${opts.active ? ' active' : ''}" data-id="${t}">${escapeHtml(label)}${dismiss}</span>`;
}

async function loadGym() {
  const today = new Date();
  if (gymWeekStart > startOfWeek(today)) gymWeekStart = startOfWeek(today);
  await fetchGymRange();
  renderGymWeek();
  renderGymStats();
  renderGymHeatmap();
}

async function fetchGymRange() {
  // Pull 52 weeks so the GitHub-style heatmap has a full year to draw.
  const end = new Date(); end.setHours(0,0,0,0);
  const start = new Date(end); start.setDate(start.getDate() - 52 * 7);
  gymData = await api(`/api/training?start=${fmtDate(start)}&end=${fmtDate(end)}`);
}

function renderGymWeek() {
  const wrap = $('#gymWeek');
  if (!wrap) return;
  const todayStr = fmtDate(new Date());
  const cards = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(gymWeekStart); d.setDate(d.getDate() + i);
    const ds = fmtDate(d);
    const entry = gymData[ds];
    const isToday  = ds === todayStr;
    const isFuture = ds > todayStr;
    const isRest   = entry && entry.types && entry.types.includes('rest');
    const cls = [
      'gym-day-card',
      isToday  ? 'today'  : '',
      isFuture ? 'future' : '',
      isRest   ? 'rest'   : entry ? 'logged' : 'empty'
    ].filter(Boolean).join(' ');

    const chips = entry && entry.types && entry.types.length
      ? entry.types.slice(0, 3).map(t => gymTypeChip(t)).join('')
      : `<span class="gym-day-empty">${isFuture ? '—' : isToday ? 'Tap to log' : 'tap to add'}</span>`;
    const more = entry && entry.types && entry.types.length > 3
      ? `<span class="gym-day-more">+${entry.types.length - 3}</span>`
      : '';

    cards.push(`
      <button class="${cls}" data-date="${ds}" ${isFuture ? 'disabled' : ''}>
        <div class="gym-day-name">${d.toLocaleDateString([], { weekday: 'short' }).toUpperCase()}</div>
        <div class="gym-day-num">${d.getDate()}</div>
        <div class="gym-day-chips">${chips}${more}</div>
        ${isToday ? '<div class="gym-day-today-tag">TODAY</div>' : ''}
      </button>
    `);
  }
  wrap.innerHTML = cards.join('');
  wrap.querySelectorAll('.gym-day-card:not(:disabled)').forEach(card => {
    card.addEventListener('click', () => openGymPicker(card.dataset.date));
  });

  $('#gymWeekLabel').textContent = fmtRangeLabel(gymWeekStart);
  // Disable "next" once we're already on the current week.
  const curWeekStart = startOfWeek(new Date()).getTime();
  $('#gymNextWeek').disabled = gymWeekStart.getTime() >= curWeekStart;
}

function renderGymStats() {
  const card = $('#gymStatsCard');
  if (!card) return;
  // Current week count + active streak + longest streak (all-time from loaded range).
  const todayStr = fmtDate(new Date());
  let weekCount = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(gymWeekStart); d.setDate(d.getDate() + i);
    const ds = fmtDate(d);
    const e = gymData[ds];
    if (e && e.types && e.types.length && !e.types.includes('rest')) weekCount++;
  }
  // Streak rules: training days add +1, tagged rest days pause but don't reset,
  // untagged days break the streak. Today is given a grace period — an untagged
  // "today" doesn't break a streak that was earned yesterday.
  let activeStreak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = fmtDate(d);
    const e = gymData[ds];
    if (i === 0 && !e) continue;
    if (!e || !e.types || !e.types.length) break;
    if (e.types.includes('rest')) continue;
    activeStreak++;
  }
  // Longest training streak in the loaded window — walks every calendar day in
  // the range, applying the same rules so untagged gaps reset the run.
  let longest = 0, run = 0;
  const sortedDates = Object.keys(gymData).sort();
  if (sortedDates.length) {
    const startD = new Date(sortedDates[0] + 'T00:00:00');
    const endD = new Date(); endD.setHours(0,0,0,0);
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      const ds = fmtDate(d);
      const e = gymData[ds];
      if (!e || !e.types || !e.types.length) run = 0;
      else if (e.types.includes('rest')) { /* pause, no change */ }
      else { run++; longest = Math.max(longest, run); }
    }
  }
  longest = Math.max(longest, activeStreak);

  card.innerHTML = `
    <div class="gym-stat-grid">
      <div class="gym-stat">
        <div class="gym-stat-num">${weekCount}<span class="gym-stat-num-sub">/7</span></div>
        <div class="gym-stat-lbl">this week</div>
      </div>
      <div class="gym-stat">
        <div class="gym-stat-num">${activeStreak}${activeStreak > 0 ? ' 🔥' : ''}</div>
        <div class="gym-stat-lbl">active streak</div>
      </div>
      <div class="gym-stat">
        <div class="gym-stat-num">${longest}</div>
        <div class="gym-stat-lbl">longest (1 yr)</div>
      </div>
    </div>
  `;
}

// Days between two yyyy-mm-dd strings (b - a). Local-time safe.
function dateDiff(a, b) {
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db - da) / 86400000);
}

function renderGymHeatmap() {
  const card = $('#gymHeatmapCard');
  if (!card) return;
  // GitHub-style heatmap that grows with your data: starts at 4 weeks when you're
  // brand new and expands toward 52 as you accumulate history. Avoids the
  // "sea of empty cells" demotivation when you've only logged a couple of days.
  const todayStr = fmtDate(new Date());
  const dataDates = Object.keys(gymData).sort();
  let weeksSinceFirst = 0;
  if (dataDates.length) {
    const first = new Date(dataDates[0] + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    weeksSinceFirst = Math.ceil((today - first) / (7 * 86400000));
  }
  const WEEKS = Math.min(52, Math.max(4, weeksSinceFirst + 1));
  const startMonday = startOfWeek(new Date());
  startMonday.setDate(startMonday.getDate() - (WEEKS - 1) * 7);

  // Map a day's tagged types → intensity level 0–4. Levels mirror GitHub's
  // count-based shading but for training "volume" (number of distinct things tagged).
  const intensity = (types) => {
    if (!types || !types.length) return 0;
    if (types.includes('rest')) return 0; // rest handled separately
    const nonRest = types.filter(t => t !== 'rest');
    if (nonRest.length === 1 && nonRest[0] === 'cardio') return 1;
    if (nonRest.length <= 1) return 2;
    if (nonRest.length <= 3) return 3;
    return 4;
  };

  const cols = [];
  const monthMarks = []; // { weekIndex, monthIndex }
  let lastMonth = -1;
  let totalTrained = 0;

  for (let w = 0; w < WEEKS; w++) {
    const cells = [];
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(startMonday); d.setDate(d.getDate() + w * 7 + dow);
      const ds = fmtDate(d);
      let cls = 'hm-cell';
      let title = ds;
      if (ds > todayStr) {
        cls += ' hm-future';
      } else {
        const e = gymData[ds];
        if (!e || !e.types || !e.types.length) {
          cls += ' hm-l0';
          title = `${ds} — untagged`;
        } else if (e.types.includes('rest')) {
          cls += ' hm-rest';
          title = `${ds} — rest`;
        } else {
          const level = intensity(e.types);
          cls += ` hm-l${level}`;
          totalTrained++;
          title = `${ds} — ${e.types.join(', ')}`;
        }
      }
      cells.push(`<div class="${cls}" title="${title}"></div>`);
    }
    cols.push(`<div class="hm-col">${cells.join('')}</div>`);
    // Track month boundary using the first day of each column (Monday).
    const colStart = new Date(startMonday); colStart.setDate(colStart.getDate() + w * 7);
    if (colStart.getMonth() !== lastMonth) {
      monthMarks.push({ weekIndex: w, monthIndex: colStart.getMonth() });
      lastMonth = colStart.getMonth();
    }
  }

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthLabels = monthMarks.map((m, i) => {
    const next = monthMarks[i + 1];
    const span = (next ? next.weekIndex : WEEKS) - m.weekIndex;
    // Drop the first label if its span is too narrow to read (avoids "Mar" overlapping "Apr").
    if (i === 0 && span < 2) return '';
    return `<span class="hm-month" style="grid-column: span ${span};">${MONTH_NAMES[m.monthIndex]}</span>`;
  }).join('');

  // Adaptive title — matches the user's actual journey stage rather than always
  // saying "last year" when there's only a week of data.
  let titleMain;
  if (totalTrained === 0) {
    titleMain = `Your training log starts here`;
  } else if (weeksSinceFirst <= 1) {
    titleMain = `${totalTrained} training day${totalTrained === 1 ? '' : 's'} so far — keep going`;
  } else if (WEEKS < 52) {
    titleMain = `${totalTrained} training days in ${weeksSinceFirst} week${weeksSinceFirst === 1 ? '' : 's'}`;
  } else {
    titleMain = `${totalTrained} training days in the last year`;
  }

  card.innerHTML = `
    <h2>${titleMain}
      <span style="font-size:11px;color:var(--text-dim);font-weight:400;">consistency at a glance</span>
    </h2>
    <div class="hm-wrap">
      <div class="hm-y-labels">
        <span>Mon</span>
        <span></span>
        <span>Wed</span>
        <span></span>
        <span>Fri</span>
        <span></span>
        <span></span>
      </div>
      <div class="hm-main">
        <div class="hm-months" style="grid-template-columns: repeat(${WEEKS}, 1fr);">${monthLabels}</div>
        <div class="hm-grid">${cols.join('')}</div>
      </div>
    </div>
    <div class="hm-legend">
      <span class="hm-legend-text">Less</span>
      <div class="hm-cell hm-l0"></div>
      <div class="hm-cell hm-l1"></div>
      <div class="hm-cell hm-l2"></div>
      <div class="hm-cell hm-l3"></div>
      <div class="hm-cell hm-l4"></div>
      <span class="hm-legend-text">More</span>
      <span class="hm-legend-rest"><div class="hm-cell hm-rest"></div> rest</span>
    </div>
  `;
}

// ---------- Picker ----------

function openGymPicker(date) {
  gymPickerDate = date;
  const existing = gymData[date];
  gymPickerState = {
    types: new Set(existing && existing.types ? existing.types : []),
    notes: (existing && existing.notes) || ''
  };
  const niceDate = new Date(date + 'T00:00:00').toLocaleDateString([], {
    weekday: 'long', month: 'short', day: 'numeric'
  });
  $('#gymPickerTitle').textContent = `Tag training · ${niceDate}`;
  $('#gymPickerNotes').value = gymPickerState.notes;
  $('#gymPickerCustom').value = '';
  renderGymPickerChips();
  $('#gymPickerModal').classList.remove('hidden');
}

function closeGymPicker() {
  $('#gymPickerModal').classList.add('hidden');
  gymPickerDate = null;
}

function renderGymPickerChips() {
  // Split row
  $('#gymPickerSplits').innerHTML = GYM_SPLITS.map(s =>
    gymTypeChip(s.id, { active: gymPickerState.types.has(s.id) })
  ).join('');
  // Muscle row + any custom types already in the set (so they're visible & removable)
  const customs = [...gymPickerState.types].filter(t => !GYM_KNOWN_IDS.has(t));
  $('#gymPickerMuscles').innerHTML = [
    ...GYM_MUSCLES.map(s => gymTypeChip(s.id, { active: gymPickerState.types.has(s.id) })),
    ...customs.map(t => gymTypeChip(t, { active: true, dismissible: true }))
  ].join('');

  // Wire chip clicks
  document.querySelectorAll('#gymPickerSplits .gym-chip, #gymPickerMuscles .gym-chip').forEach(chip => {
    chip.addEventListener('click', (ev) => {
      // Dismiss (×) on a custom chip
      if (ev.target.dataset.rm) {
        gymPickerState.types.delete(ev.target.dataset.rm);
        renderGymPickerChips();
        return;
      }
      toggleGymType(chip.dataset.id);
    });
  });
}

function toggleGymType(id) {
  if (gymPickerState.types.has(id)) {
    gymPickerState.types.delete(id);
  } else {
    if (id === 'rest') gymPickerState.types.clear();      // rest is exclusive
    else gymPickerState.types.delete('rest');             // adding a workout clears rest
    gymPickerState.types.add(id);
  }
  renderGymPickerChips();
}

async function saveGymPicker() {
  if (!gymPickerDate) return;
  const notes = $('#gymPickerNotes').value.trim();
  const types = [...gymPickerState.types];
  const btn = $('#gymPickerSave');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await api(`/api/training/${gymPickerDate}`, { method: 'POST', body: { types, notes } });
    if (res && res.entry) gymData[gymPickerDate] = res.entry;
    else delete gymData[gymPickerDate];
    closeGymPicker();
    renderGymWeek();
    renderGymStats();
    renderGymHeatmap();
    if (typeof showToast === 'function') showToast('Training saved');
  } catch (e) {
    if (typeof showToast === 'function') showToast('Save failed: ' + (e.message || ''));
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

async function clearGymDay() {
  if (!gymPickerDate) return;
  await api(`/api/training/${gymPickerDate}`, { method: 'DELETE' });
  delete gymData[gymPickerDate];
  closeGymPicker();
  renderGymWeek();
  renderGymStats();
  renderGymHeatmap();
  if (typeof showToast === 'function') showToast('Day cleared');
}

// Wire static controls (header arrows, modal buttons) once on script load.
document.addEventListener('DOMContentLoaded', wireGymControls);
// Defensive: if DOMContentLoaded already fired (script defer ordering), wire now.
if (document.readyState !== 'loading') wireGymControls();

function wireGymControls() {
  const prev = $('#gymPrevWeek');
  if (!prev || prev.dataset.wired) return;
  prev.dataset.wired = '1';

  prev.addEventListener('click', () => {
    const next = new Date(gymWeekStart); next.setDate(next.getDate() - 7);
    gymWeekStart = next;
    renderGymWeek();
    renderGymStats();
  });
  $('#gymNextWeek').addEventListener('click', () => {
    const cur = startOfWeek(new Date()).getTime();
    const candidate = new Date(gymWeekStart); candidate.setDate(candidate.getDate() + 7);
    if (candidate.getTime() > cur) return;
    gymWeekStart = candidate;
    renderGymWeek();
    renderGymStats();
  });
  $('#gymPickerClose').addEventListener('click', closeGymPicker);
  $('#gymPickerModal').addEventListener('click', (e) => {
    if (e.target === $('#gymPickerModal')) closeGymPicker();
  });
  $('#gymPickerSave').addEventListener('click', saveGymPicker);
  $('#gymPickerClear').addEventListener('click', clearGymDay);
  $('#gymPickerCustomAdd').addEventListener('click', addCustomGymType);
  $('#gymPickerCustom').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addCustomGymType(); }
  });
}

function addCustomGymType() {
  const input = $('#gymPickerCustom');
  const raw = input.value.trim().toLowerCase().slice(0, 24);
  if (!raw) return;
  // Normalize whitespace & strip non-letter junk to avoid storing emoji/special chars.
  const cleaned = raw.replace(/[^a-z0-9 \-]/g, '').trim();
  if (!cleaned) return;
  // Adding a workout type clears any prior 'rest' selection.
  gymPickerState.types.delete('rest');
  gymPickerState.types.add(cleaned);
  input.value = '';
  renderGymPickerChips();
}
