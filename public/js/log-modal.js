// ---------- RESCAN ----------
async function rescanEntry(entry, date, btn) {
  const panel = $(`#rescan-${entry.id}`);
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  const btnHtml = btn.innerHTML;
  btn.textContent = '…';
  btn.disabled = true;
  panel.classList.remove('hidden');
  panel.innerHTML = '';
  showAILoader(panel);
  try {
    const data = await api('/api/parse', { method: 'POST', body: { text: entry.name } });
    const newKcal = data.totals.kcal;
    const newProtein = data.totals.protein;
    const newFat = data.totals.fat || 0;
    const newCarb = data.totals.carb || 0;
    const newFiber = data.totals.fiber || 0;
    const oldKcal = entry.kcal;
    const diff = newKcal - oldKcal;
    const diffStr = diff === 0 ? 'same' : (diff > 0 ? `+${diff}` : `${diff}`) + ' kcal';
    const diffColor = diff === 0 ? 'var(--text-dim)' : Math.abs(diff) > 100 ? '#e05' : 'var(--warn)';

    const confColors = { high: 'var(--green)', medium: 'var(--warn)', low: '#e05' };
    const confSummary = data.trace.map(t =>
      `<div style="font-size:12px;color:var(--text-dim);margin-top:3px;">
        <span style="color:${confColors[t.confidence] || 'var(--text-dim)'};">[${(t.confidence||'?').toUpperCase()}]</span>
        ${escapeHtml(t.name)} — ${t.final_kcal} kcal · ${t.reasoning ? escapeHtml(t.reasoning) : ''}
      </div>`
    ).join('');

    panel.innerHTML = `
      <div class="rescan-result">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>
            <span style="font-size:15px;font-weight:600;">${newKcal} kcal · ${Math.round(newProtein * 10) / 10}g P</span>
            ${(newFat || newCarb || newFiber) ? `<span style="color:var(--text-dim);font-size:12px;"> · ${newFat}g F · ${newCarb}g C · ${newFiber}g Fib</span>` : ''}
            <span style="font-size:12px;color:${diffColor};margin-left:8px;">(${diffStr} vs current ${oldKcal})</span>
          </div>
          <div style="display:flex;gap:6px;">
            <button id="rescan-apply-${entry.id}" class="btn" style="padding:4px 12px;font-size:13px;">Apply</button>
            <button id="rescan-close-${entry.id}" style="background:none;border:1px solid var(--border);color:var(--text-dim);padding:4px 10px;border-radius:6px;cursor:pointer;font-size:13px;">Dismiss</button>
          </div>
        </div>
        ${confSummary}
        ${renderTrace(data.trace)}
      </div>`;

    $(`#rescan-apply-${entry.id}`).addEventListener('click', async () => {
      await api(`/api/log/${date}/${entry.id}`, { method: 'PATCH', body: { kcal: newKcal, protein: newProtein, fat: newFat, carb: newCarb, fiber: newFiber, source: 'ai-estimate' } });
      panel.classList.add('hidden');
      showToast(`Updated to ${newKcal} kcal`);
      loadToday();
    });
    $(`#rescan-close-${entry.id}`).addEventListener('click', () => {
      panel.classList.add('hidden');
      panel.innerHTML = '';
    });
  } catch (e) {
    panel.innerHTML = `<div style="padding:10px;color:#e05;font-size:13px;">Rescan failed: ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.innerHTML = btnHtml;
    btn.disabled = false;
  }
}

// ---------- EDIT MODAL ----------
let editState = null;

function openEditModal(entry, date) {
  editState = { entry, date };
  $('#editName').value = entry.name;
  $('#editKcal').value = entry.kcal;
  $('#editProtein').value = entry.protein;
  $('#editFat').value = entry.fat || 0;
  $('#editCarb').value = entry.carb || 0;
  $('#editFiber').value = entry.fiber || 0;
  if (entry.time) {
    const d = new Date(entry.time);
    $('#editTime').value = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  } else {
    $('#editTime').value = '';
  }
  $('#editModal').classList.remove('hidden');
  $('#editName').focus();
}

function closeEditModal() {
  $('#editModal').classList.add('hidden');
  editState = null;
}

$('#editClose').addEventListener('click', closeEditModal);
$('#editModal').addEventListener('click', (e) => { if (e.target === $('#editModal')) closeEditModal(); });

$('#editSave').addEventListener('click', async () => {
  if (!editState) return;
  const { entry, date } = editState;
  const timeVal = $('#editTime').value;
  let timeIso = entry.time;
  if (timeVal) {
    const d = new Date(entry.time || Date.now());
    const [h, m] = timeVal.split(':');
    d.setHours(Number(h), Number(m), 0, 0);
    timeIso = d.toISOString();
  }
  await api(`/api/log/${date}/${entry.id}`, {
    method: 'PATCH',
    body: {
      name: $('#editName').value.trim(),
      kcal: Number($('#editKcal').value),
      protein: Number($('#editProtein').value) || 0,
      fat: Number($('#editFat').value) || 0,
      carb: Number($('#editCarb').value) || 0,
      fiber: Number($('#editFiber').value) || 0,
      time: timeIso
    }
  });
  closeEditModal();
  showToast('Meal updated');
  refreshAfterChange(date);
});

$('#editDelete').addEventListener('click', async () => {
  if (!editState) return;
  const { entry, date } = editState;
  await fetch(`/api/log/${date}/${entry.id}`, { method: 'DELETE' });
  closeEditModal();
  refreshAfterChange(date);
  showUndoToast(`Deleted "${entry.name.slice(0, 40)}"`, async () => {
    await logMeal({
      name: entry.name, kcal: entry.kcal, protein: entry.protein,
      fat: entry.fat || 0, carb: entry.carb || 0, fiber: entry.fiber || 0,
      source: entry.source, items: entry.items, time: entry.time, date
    });
    refreshAfterChange(date);
  });
});

// ---------- LOG SHEET ----------
// One sheet, four screens: type → parse → review → done. Typing something you've had
// before relogs it with no AI call; anything new goes to the AI parse, which runs as a
// background job (parse-jobs.js) so the sheet can close while it works.

const LOG_PERIODS = ['Breakfast', 'Lunch', 'Snack', 'Dinner', 'Late night'];
const PERIOD_PLURAL = { Breakfast: 'breakfasts', Lunch: 'lunches', Snack: 'snacks', Dinner: 'dinners', 'Late night': 'late-night meals' };
const SHEET_TITLES = { type: 'Log a meal', parse: 'On it', review: 'Looks like', done: 'Logged' };

const flow = { screen: 'type', date: null, period: 'Dinner', job: null, tool: null, opener: null, done: null, unwatch: null, active: -1 };

// On desktop Today the same sheet sits inline at the top of the page as an
// always-open composer; everywhere else it's the pop-up sheet.
const composerQuery = window.matchMedia('(min-width: 1024px)');
let sheetInline = false;

function wantsInlineComposer() {
  return composerQuery.matches && !$('#view-today').classList.contains('hidden');
}

// Move the sheet to wherever it should live right now. Runs on view and width changes.
function syncComposer() {
  const inline = wantsInlineComposer();
  if (inline === sheetInline) return;
  releaseJob();
  sheetInline = inline;
  const sheet = $('#logSheet');
  sheet.classList.toggle('inline', inline);
  (inline ? $('#composerHost') : $('#logModal')).appendChild(sheet);
  $('#logModal').classList.add('hidden');
  document.body.classList.remove('sheet-open');
  resetSheet(typeof todayViewDate !== 'undefined' ? todayViewDate : null);
}
composerQuery.addEventListener('change', syncComposer);

// The inline composer follows the day Today is showing, unless it's mid-way through something.
function composerFollowDay(date) {
  if (sheetInline && flow.screen === 'type' && !$('#logText').value.trim()) resetSheet(date);
}

// Back to an empty type screen for a given day and meal.
function resetSheet(date, period) {
  flow.date = date || null;
  flow.period = period || (flow.date ? 'Dinner' : getMealPeriod(new Date().toISOString()));
  flow.done = null;
  $('#logText').value = '';
  updateGhost('', null);
  setTool(null);
  showScreen('type');
  renderTypeLists();
  updatePrimary();
  // Warm the meal search index so the very first letter typed has matches ready.
  loadMealSearchIndex().then(() => { renderTypeLists(); updatePrimary(); });
  loadUsuals().then(() => { if (flow.screen === 'type') renderTypeLists(); });
}

// date: 'yyyy-mm-dd' to log into a past day. period: the meal to file it under
// (e.g. from an "Add dinner" slot). Defaults: today, and the period on the clock.
function openLogModal(date, period) {
  syncComposer();
  releaseJob();
  flow.opener = sheetInline ? null : document.activeElement;
  resetSheet(date, period);
  if (sheetInline) $('#composerHost').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  else showSheet();
  $('#logText').focus();
}

// Open the sheet on a background parse (a pending row on Today was tapped).
function openParseJob(id) {
  const job = findParseJob(id);
  if (!job || job.status === 'saving') return;
  syncComposer();
  releaseJob();
  flow.date = job.date;
  flow.period = job.period;
  flow.opener = sheetInline ? null : document.activeElement;
  if (sheetInline) $('#composerHost').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  else showSheet();
  if (job.status === 'interrupted') runParseJob(job);
  watchJob(job);
}

function showSheet() {
  $('#logModal').classList.remove('hidden');
  document.body.classList.add('sheet-open');
  renderSheetHead();
}

// Let go of the job the sheet is showing. A parse keeps running in the background;
// a finished one that wasn't logged stays on Today to finish later.
function releaseJob() {
  const job = flow.job;
  if (job) {
    job.watched = false;
    if (job.local || job.status === 'error' || job.status === 'interrupted') removeParseJob(job.id);
    else if (job.status === 'ready') { job.status = 'review'; notifyParseJob(job); }
  }
  flow.job = null;
  unwatchJob();
  stopDinoTicker();
}

function closeLogModal() {
  releaseJob();
  flow.done = null;
  stopBarcodeCamera();
  if (sheetInline) { resetSheet(typeof todayViewDate !== 'undefined' ? todayViewDate : null); return; }
  $('#logModal').classList.add('hidden');
  document.body.classList.remove('sheet-open');
  flow.screen = 'type';
  if (flow.opener && flow.opener.isConnected) flow.opener.focus();
}

function showScreen(screen) {
  flow.screen = screen;
  $('#logSheet').dataset.screen = screen;
  [['type', '#lsType'], ['parse', '#lsParse'], ['review', '#lsReview'], ['done', '#lsDone']]
    .forEach(([name, sel]) => $(sel).classList.toggle('hidden', name !== screen));
  renderSheetHead();
  if (screen === 'parse') startDinoTicker(); else stopDinoTicker();
}

function renderSheetHead() {
  $('#logTitle').textContent = SHEET_TITLES[flow.screen];
  $('#logPeriodLabel').textContent = flow.period;
  $('#logPeriod').classList.toggle('hidden', flow.screen === 'done');
  $('#logPeriod').setAttribute('aria-label', `Meal: ${flow.period}. Tap to change`);
  $('#logPeriodInlineLabel').textContent = flow.period;
  $('#logPeriodInline').setAttribute('aria-label', `Meal: ${flow.period}. Click to change`);
  const banner = $('#logDateBanner');
  if (flow.date) {
    banner.textContent = `Logging to ${new Date(flow.date + 'T12:00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function cyclePeriod() {
  flow.period = LOG_PERIODS[(LOG_PERIODS.indexOf(flow.period) + 1) % LOG_PERIODS.length];
  if (flow.job) {
    flow.job.period = flow.period;
    flow.job.time = entryTime(flow.date, flow.period);
    notifyParseJob(flow.job);
  }
  renderSheetHead();
  if (flow.screen === 'type') renderTypeLists();
  if (flow.screen === 'review') renderReview();
}

// Time an entry gets filed at: now, unless it's going to another period or a past day,
// in which case it gets that period's usual time (past days default to dinner, 8pm).
function entryTime(date, period) {
  if (!date && period === getMealPeriod(new Date().toISOString())) return null;
  return new Date(`${date || fmtDate(new Date())}T${PERIOD_TIME[period]}:00`).toISOString();
}

function entryWhen() {
  const time = entryTime(flow.date, flow.period);
  return { ...(flow.date ? { date: flow.date } : {}), ...(time ? { time } : {}) };
}

$('#logClose').addEventListener('click', closeLogModal);
$('#logModal').addEventListener('click', (e) => { if (e.target === $('#logModal')) closeLogModal(); });
$('#logPeriod').addEventListener('click', cyclePeriod);
$('#logPeriodInline').addEventListener('click', cyclePeriod);

// ---------- KEYBOARD SHORTCUTS ----------
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#editModal').classList.contains('hidden')) { closeEditModal(); return; }
    if (!$('#logModal').classList.contains('hidden')) { closeLogModal(); return; }
  }
  // Don't fire nav shortcuts when typing
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (!$('#logModal').classList.contains('hidden')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // "/" (or L) jumps to the composer from anywhere; on Today on desktop that's the inline box.
  if (e.key === '/' || e.key === 'l' || e.key === 'L') {
    e.preventDefault();
    if (wantsInlineComposer() && flow.screen === 'type') { syncComposer(); $('#logText').focus(); }
    else openLogModal(typeof todayViewDate !== 'undefined' ? todayViewDate : null);
    return;
  }
  // Number keys 1-5 switch tabs, in sidebar order
  const viewMap = { '1': 'today', '2': 'history', '3': 'gym', '4': 'profile', '5': 'dev' };
  if (viewMap[e.key]) setActiveView(viewMap[e.key]);
});

// ---------- TYPE-AHEAD (local index, smart ranking, ghost completion) ----------
// The search index is built once per session: one round-trip to fetch
// favourites + customs + templates, then every keystroke runs locally.

let mealSearchIndex = null;
let mealSearchIndexLoading = null;
let currentGhostSuggestion = null;

async function loadMealSearchIndex() {
  if (mealSearchIndex) return mealSearchIndex;
  if (mealSearchIndexLoading) return mealSearchIndexLoading;
  mealSearchIndexLoading = (async () => {
    const [favs, customs, templates] = await Promise.all([
      api('/api/favorites?limit=500').catch(() => []),
      api('/api/custom-foods').catch(() => ({})),
      api('/api/templates').catch(() => [])
    ]);
    const items = [];
    for (const f of (favs || [])) {
      items.push({
        source: 'history',
        name: f.last_text || f.name,
        name_lower: (f.last_text || f.name).toLowerCase(),
        // "Log again" means the same amounts as last time.
        kcal: f.last_kcal ?? f.kcal,
        protein: f.last_protein ?? f.protein,
        fat: f.last_fat ?? 0,
        carb: f.last_carb ?? 0,
        fiber: f.last_fiber ?? 0,
        count: f.count || 0,
        last_date: f.last_date || null
      });
    }
    for (const c of Object.values(customs || {})) {
      items.push({
        source: 'custom',
        name: c.name,
        name_lower: c.name.toLowerCase(),
        kcal: c.kcal || 0, protein: c.protein || 0,
        fat: c.fat || 0, carb: c.carb || 0, fiber: c.fiber || 0,
        count: 0, last_date: null
      });
    }
    for (const t of (templates || [])) {
      items.push({
        source: 'template',
        template_id: t.id,
        name: t.name,
        name_lower: t.name.toLowerCase(),
        kcal: t.totals?.kcal || 0, protein: t.totals?.protein || 0,
        fat: t.totals?.fat || 0, carb: t.totals?.carb || 0, fiber: t.totals?.fiber || 0,
        count: 0, last_date: null
      });
    }
    mealSearchIndex = items;
    mealSearchIndexLoading = null;
    return items;
  })();
  return mealSearchIndexLoading;
}

// Rank candidates: prefix match beats substring, then add a recency + freq
// + source-kicker bonus. User-curated rows (custom / template) outrank
// history rows of the same score so saved foods float to the top.
function rankMatches(items, q) {
  const todayMs = Date.now();
  const ranked = [];
  for (const it of items) {
    let baseScore;
    if (it.name_lower.startsWith(q))    baseScore = 1000;
    else if (it.name_lower.includes(q)) baseScore = 500;
    else continue;
    const freq = Math.min(it.count, 30);
    let recency = 0;
    if (it.last_date) {
      const ageDays = (todayMs - new Date(it.last_date + 'T00:00:00').getTime()) / 86400000;
      recency = Math.max(0, 100 - ageDays * 3.3);  // 0 at ~30 days, 100 today
    }
    const sourceBonus = it.source === 'custom' ? 20 : it.source === 'template' ? 10 : 0;
    ranked.push({ item: it, score: baseScore + freq + recency + sourceBonus });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map(r => r.item);
}

function relDateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - d) / 86400000);
  if (days <= 0)  return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7)   return `${days}d ago`;
  if (days < 30)  return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

// "Last had Monday" style label for a past day.
function lastHadLabel(dateStr) {
  const days = Math.round((new Date(fmtDate(new Date()) + 'T12:00:00') - new Date(dateStr + 'T12:00:00')) / 86400000);
  if (days <= 0) return 'Earlier today';
  if (days === 1) return 'Yesterday';
  const d = new Date(dateStr + 'T12:00:00');
  return `Last had ${days < 7 ? d.toLocaleDateString([], { weekday: 'long' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

function updateGhost(typed, suggestion) {
  const ghost = $('#logTextGhost');
  if (!ghost) return;
  const show = typed && suggestion && suggestion.length > typed.length
    && suggestion.toLowerCase().startsWith(typed.toLowerCase());
  ghost.innerHTML = show
    ? `<span>${escapeHtml(typed)}</span><span class="ghost-suffix">${escapeHtml(suggestion.slice(typed.length))}</span>`
    : '';
  $('#ghostAccept').classList.toggle('hidden', !show);
}

function acceptGhost() {
  if (!currentGhostSuggestion) return false;
  $('#logText').value = currentGhostSuggestion;
  currentGhostSuggestion = null;
  onLogTextInput();
  return true;
}

// ---------- TYPE screen ----------
// Usuals: what you actually eat at each meal, from the last two weeks of entries
// (with their times, which the favourites list doesn't carry). Loaded once per session.
let usualsLoading = null;

function loadUsuals() {
  if (usualsLoading) return usualsLoading;
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return fmtDate(d); });
  usualsLoading = Promise.all(days.map(d => api(`/api/log?date=${d}`).catch(() => null))).then(logs => {
    const meals = new Map();
    logs.forEach(log => (log && log.entries || []).forEach(e => {
      if (!e.name) return;
      const period = getMealPeriod(e.time);
      const key = `${period}|${e.name.trim().toLowerCase()}`;
      const m = meals.get(key) || { period, count: 0, entry: null, date: '' };
      m.count++;
      if (!m.entry || log.date > m.date) { m.entry = e; m.date = log.date; }
      meals.set(key, m);
    }));
    return [...meals.values()];
  });
  return usualsLoading;
}

function usualsFor(meals, period) {
  const byUse = (a, b) => b.count - a.count || b.date.localeCompare(a.date);
  const picked = meals.filter(m => m.period === period).sort(byUse).slice(0, 3);
  const names = new Set(picked.map(m => m.entry.name.toLowerCase()));
  // Thin history for this meal? Top up with the user's most-eaten others.
  for (const m of meals.filter(m => m.period !== period).sort(byUse)) {
    if (picked.length >= 3) break;
    if (names.has(m.entry.name.toLowerCase())) continue;
    names.add(m.entry.name.toLowerCase());
    picked.push(m);
  }
  return picked;
}

function typedQuery() {
  return $('#logText').value.trim().toLowerCase().split('\n')[0].slice(0, 60);
}

function exactMatch() {
  const q = $('#logText').value.trim().toLowerCase();
  if (!q || !mealSearchIndex) return null;
  return mealSearchIndex.find(it => it.name_lower === q && it.source === 'history')
    || mealSearchIndex.find(it => it.name_lower === q) || null;
}

function renderTypeLists() {
  const host = $('#logLists');
  if (flow.tool) { host.innerHTML = ''; return; }
  const q = typedQuery();
  const row = (attrs, name, when, kcal, protein, plus) => `
    <button class="pick-row" type="button" ${attrs}>
      <span class="pick-text"><span class="pick-name">${escapeHtml(name)}</span><span class="pick-when">${escapeHtml(when)}</span></span>
      <span class="pick-nums">${Math.round(kcal).toLocaleString()} · <strong>${Math.round(protein)}g</strong></span>
      ${plus ? '<span class="pick-plus" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>' : ''}
    </button>`;

  flow.active = -1;
  $('#logText').removeAttribute('aria-activedescendant');
  if (!q) {
    // The inline composer stays compact; Today's frequent-food chips sit right under it.
    if (!usualsLoading || sheetInline) { host.innerHTML = ''; return; }
    usualsLoading.then(meals => {
      if (flow.screen !== 'type' || typedQuery() || flow.tool) return;
      const usuals = usualsFor(meals, flow.period);
      host.innerHTML = usuals.length ? `
        <h3 class="ls-label">Your usual ${PERIOD_PLURAL[flow.period]} · one tap logs it</h3>
        <div class="pick-list">${usuals.map((m, i) => row(`data-usual="${i}" aria-label="Log ${escapeHtml(m.entry.name)} again"`, m.entry.name, lastHadLabel(m.date), m.entry.kcal, m.entry.protein, true)).join('')}</div>` : '';
      host.querySelectorAll('[data-usual]').forEach(btn => btn.addEventListener('click', () => {
        const e = usuals[Number(btn.dataset.usual)].entry;
        relog({ name: e.name, kcal: e.kcal, protein: e.protein, fat: e.fat || 0, carb: e.carb || 0, fiber: e.fiber || 0, source: e.source, items: e.items }, btn);
      }));
    });
    return;
  }

  const matches = q.length >= 2 && mealSearchIndex ? rankMatches(mealSearchIndex, q).slice(0, 4) : [];
  if (matches.length) {
    const when = it => it.source === 'template' ? 'Template' : it.source === 'custom' ? 'Your food' : `${relDateLabel(it.last_date)} · same amounts`;
    host.innerHTML = `
      <h3 class="ls-label">You've had this before</h3>
      <div class="pick-list">${matches.map((it, i) => row(`data-match="${i}" id="logMatch${i}"`, it.name, when(it).replace(/^./, c => c.toUpperCase()), it.kcal, it.protein, false)).join('')}</div>`;
    host.querySelectorAll('[data-match]').forEach(btn => btn.addEventListener('click', () => relogIndexItem(matches[Number(btn.dataset.match)], btn)));
  } else if (q.length > 2) {
    host.innerHTML = `
      <div class="new-hint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/></svg>
        <span>New one. I'll split it into foods, look each up, and show you anything I had to guess.</span>
      </div>`;
  } else {
    host.innerHTML = '';
  }
}

function updatePrimary() {
  const btn = $('#logPrimary');
  const text = $('#logText').value.trim();
  const exact = exactMatch();
  btn.disabled = !text;
  btn.textContent = !text ? (sheetInline ? 'Type what you ate' : 'Type something, or tap a usual')
    : exact ? `Log again · ${Math.round(exact.kcal).toLocaleString()} kcal`
    : 'Work it out';
}

function onLogTextInput() {
  const text = $('#logText').value;
  const q = typedQuery();
  currentGhostSuggestion = null;
  if (q.length >= 2 && mealSearchIndex) {
    const top = rankMatches(mealSearchIndex, q)[0];
    if (top && top.name_lower.startsWith(q) && !text.includes('\n')) currentGhostSuggestion = top.name;
  }
  updateGhost(text, currentGhostSuggestion);
  renderTypeLists();
  updatePrimary();
}

function primaryAction() {
  const text = $('#logText').value.trim();
  if (!text) return;
  const exact = exactMatch();
  if (exact) relogIndexItem(exact, $('#logPrimary'));
  else workItOut();
}

$('#logText').addEventListener('input', () => {
  if (!mealSearchIndex) loadMealSearchIndex().then(onLogTextInput);
  onLogTextInput();
});
$('#logText').addEventListener('keydown', (e) => {
  const atEnd = e.target.selectionStart === e.target.value.length;
  const matchRows = $$('#logLists [data-match]');
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && matchRows.length) {
    // Move through "You've had this before"; Enter then relogs the highlighted one.
    e.preventDefault();
    flow.active = Math.max(-1, Math.min(matchRows.length - 1, flow.active + (e.key === 'ArrowDown' ? 1 : -1)));
    matchRows.forEach((r, i) => r.classList.toggle('active', i === flow.active));
    if (flow.active >= 0) e.target.setAttribute('aria-activedescendant', matchRows[flow.active].id);
    else e.target.removeAttribute('aria-activedescendant');
  } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && flow.active >= 0 && matchRows[flow.active]) {
    e.preventDefault();
    matchRows[flow.active].click();
  } else if ((e.key === 'Tab' || (e.key === 'ArrowRight' && atEnd)) && currentGhostSuggestion) {
    e.preventDefault();
    acceptGhost();
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if ($('#logText').value.trim()) workItOut();
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    primaryAction();
  }
});
$('#ghostAccept').addEventListener('click', () => { acceptGhost(); $('#logText').focus(); });
$('#logPrimary').addEventListener('click', primaryAction);

// ---------- Relog (no AI) ----------
async function relogIndexItem(it, btn) {
  if (it.source === 'template' && it.template_id) {
    btn.disabled = true;
    const day = flow.date ? `?date=${flow.date}` : '';
    const res = await api(`/api/log-template/${it.template_id}${day}`, { method: 'POST', body: {} }).catch(() => null);
    btn.disabled = false;
    if (!res || !res.entries) { showToast('Could not log that template'); return; }
    afterLogged({ name: it.name, kcal: it.kcal, protein: it.protein, ids: res.entries.map(e => e.id) });
    return;
  }
  relog({ name: it.name, kcal: it.kcal, protein: it.protein, fat: it.fat, carb: it.carb, fiber: it.fiber, source: it.source === 'custom' ? 'custom' : 'history' }, btn);
}

async function relog(entry, btn) {
  btn.disabled = true;
  const res = await logMeal({ ...entry, ...entryWhen() });
  btn.disabled = false;
  if (!res || !res.entry) return;
  afterLogged({ name: entry.name, kcal: res.entry.kcal, protein: res.entry.protein, ids: [res.entry.id] });
}

// ---------- Search / Barcode / Manual ----------
$$('#lsType .tool-btn').forEach(btn => btn.addEventListener('click', () => setTool(flow.tool === btn.dataset.tool ? null : btn.dataset.tool)));

function setTool(tool) {
  stopBarcodeCamera();
  flow.tool = tool;
  $$('#lsType .tool-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
    b.setAttribute('aria-expanded', String(b.dataset.tool === tool));
  });
  const panel = $('#logPanel');
  panel.classList.toggle('hidden', !tool);
  if (!tool) { panel.innerHTML = ''; renderTypeLists(); return; }
  $('#logLists').innerHTML = '';
  if (tool === 'search') renderSearchPanel();
  if (tool === 'barcode') renderBarcodePanel();
  if (tool === 'manual') renderManualPanel();
}

function renderSearchPanel() {
  const panel = $('#logPanel');
  panel.innerHTML = `
    <form class="panel-row" id="searchForm">
      <label class="sr-only" for="searchInput">Search food databases</label>
      <input id="searchInput" type="search" placeholder="Search USDA, FatSecret, Open Food Facts" value="${escapeHtml($('#logText').value.trim().split('\n')[0])}" />
      <button class="sheet-secondary" type="submit">Search</button>
    </form>
    <div id="searchResults"></div>`;
  $('#searchInput').focus();
  $('#searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    if (!q) return;
    const out = $('#searchResults');
    out.innerHTML = '<p class="panel-note">Searching…</p>';
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`).catch(() => null);
    const results = (data && data.results) || [];
    if (!results.length) { out.innerHTML = '<p class="panel-note">Nothing found. Try a simpler name, or describe it and let the AI work it out.</p>'; return; }
    out.innerHTML = `<div class="pick-list">${results.map((r, i) => `
      <button class="pick-row" type="button" data-r="${i}">
        <span class="pick-text">
          <span class="pick-name">${escapeHtml(r.name)}${r.brand ? ` <span class="pick-brand">${escapeHtml(r.brand)}</span>` : ''}</span>
          <span class="pick-when">${sourceBadge(r.source)} per ${r.serving_g || 100} g</span>
        </span>
        <span class="pick-nums">${Math.round(r.kcal_per_serving)} · <strong>${Math.round(r.protein_per_serving)}g</strong></span>
      </button>`).join('')}</div>`;
    out.querySelectorAll('[data-r]').forEach(btn => btn.addEventListener('click', () => reviewFoodResult(results[Number(btn.dataset.r)])));
  });
}

let barcodeStream = null;

function renderBarcodePanel() {
  const panel = $('#logPanel');
  const canScan = 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  panel.innerHTML = `
    ${canScan ? `<button class="sheet-secondary scan-btn" id="scanBtn" type="button">Scan with camera</button><video class="scan-video hidden" id="scanVideo" playsinline muted></video>` : ''}
    <form class="panel-row" id="barcodeForm">
      <label class="sr-only" for="barcodeInput">Barcode number</label>
      <input id="barcodeInput" inputmode="numeric" pattern="[0-9]*" placeholder="Barcode number" />
      <button class="sheet-secondary" type="submit">Look up</button>
    </form>
    <div id="barcodeResult"></div>`;
  $('#barcodeForm').addEventListener('submit', (e) => { e.preventDefault(); lookupBarcode($('#barcodeInput').value.trim()); });
  if (canScan) $('#scanBtn').addEventListener('click', startBarcodeCamera);
  else $('#barcodeInput').focus();
}

async function lookupBarcode(code) {
  if (!/^\d{6,14}$/.test(code)) { $('#barcodeResult').innerHTML = '<p class="panel-note">That doesn\'t look like a barcode number.</p>'; return; }
  $('#barcodeResult').innerHTML = '<p class="panel-note">Looking it up…</p>';
  const r = await fetch(`/api/barcode/${code}`).then(x => x.ok ? x.json() : null).catch(() => null);
  if (!r) { $('#barcodeResult').innerHTML = '<p class="panel-note">Not found in Open Food Facts. Try Search, or describe it.</p>'; return; }
  reviewFoodResult(r);
}

async function startBarcodeCamera() {
  const video = $('#scanVideo');
  try {
    barcodeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (_) {
    $('#barcodeResult').innerHTML = '<p class="panel-note">No camera access. Type the number instead.</p>';
    return;
  }
  video.srcObject = barcodeStream;
  video.classList.remove('hidden');
  $('#scanBtn').classList.add('hidden');
  await video.play();
  const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
  const tick = async () => {
    if (!barcodeStream) return;
    const codes = await detector.detect(video).catch(() => []);
    if (codes.length) { const code = codes[0].rawValue; stopBarcodeCamera(); $('#barcodeInput').value = code; lookupBarcode(code); return; }
    setTimeout(tick, 250);
  };
  tick();
}

function stopBarcodeCamera() {
  if (!barcodeStream) return;
  barcodeStream.getTracks().forEach(t => t.stop());
  barcodeStream = null;
}

function renderManualPanel() {
  const panel = $('#logPanel');
  panel.innerHTML = `
    <form id="manualForm" class="manual-form">
      <div class="field"><label for="manName">Name</label><input id="manName" value="${escapeHtml($('#logText').value.trim())}" /></div>
      <div class="row2">
        <div class="field"><label for="manKcal">kcal</label><input id="manKcal" type="number" inputmode="numeric" /></div>
        <div class="field"><label for="manProtein">Protein (g)</label><input id="manProtein" type="number" inputmode="decimal" step="0.1" /></div>
      </div>
      <button class="sheet-primary" id="manSave" type="submit">Save</button>
    </form>`;
  $(panel.querySelector('#manName').value ? '#manKcal' : '#manName').focus();
  $('#manualForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#manName').value.trim();
    const kcal = Number($('#manKcal').value);
    if (!name || !kcal) { showToast('Need a name and kcal'); return; }
    relog({ name, kcal, protein: Number($('#manProtein').value) || 0, source: 'manual' }, $('#manSave'));
  });
}

// A database or barcode hit becomes a one-item review, with the amount to confirm.
function reviewFoodResult(r) {
  const serving = r.serving_g || 100;
  const per = (key100, keyServing) => r[keyServing] ?? (r[key100] != null ? r[key100] * serving / 100 : 0);
  const item = {
    name: r.brand ? `${r.name} (${r.brand})` : r.name, qty: serving, unit: 'g',
    kcal: Math.round(r.kcal_per_serving), protein: round1(r.protein_per_serving),
    fat: round1(per('fat_100g', 'fat_per_serving')), carb: round1(per('carb_100g', 'carb_per_serving')), fiber: round1(r.fiber_100g != null ? r.fiber_100g * serving / 100 : 0),
    source: r.source, confidence: 'high', needsAmount: true
  };
  item.base = { qty: item.qty, kcal: item.kcal, protein: item.protein, fat: item.fat, carb: item.carb, fiber: item.fiber };
  stopBarcodeCamera();
  const job = {
    id: newIdemKey(), idemKey: newIdemKey(), local: true, createdAt: Date.now(),
    text: item.name, date: flow.date, period: flow.period, time: entryTime(flow.date, flow.period),
    status: 'ready', steps: [], checks: [0],
    result: { items: [item], totals: sumItems([item]), trace: [], suggested_extras: [] }
  };
  flow.job = job;
  showScreen('review');
  renderReview();
}

// ---------- PARSE screen ----------
function workItOut() {
  const text = $('#logText').value.trim();
  if (!text) return;
  const job = startParseJob({ text, date: flow.date, period: flow.period, time: entryTime(flow.date, flow.period) });
  watchJob(job);
}

function watchJob(job) {
  unwatchJob();
  flow.job = job;
  job.watched = true;
  const screenFor = () => job.status === 'ready' || job.status === 'review' ? 'review' : 'parse';
  showScreen(screenFor());
  if (flow.screen === 'review') renderReview(); else renderParse();
  flow.unwatch = onParseJobChange(changed => {
    if (changed !== job || flow.job !== job) return;
    if (job.status === 'ready' && flow.screen === 'parse') {
      renderParse();
      // A beat on the finished steps before switching, so the summary is readable.
      setTimeout(() => { if (flow.job === job && flow.screen === 'parse') { showScreen('review'); renderReview(); } }, 900);
    } else if (flow.screen === 'parse') {
      renderParse();
    }
  });
}

function unwatchJob() {
  if (flow.unwatch) flow.unwatch();
  flow.unwatch = null;
}

let dinoJumps = 0;

function renderParse() {
  const job = flow.job;
  $('#parseBubble').textContent = job.text;
  if (!$('#dinoRunner').innerHTML) $('#dinoRunner').innerHTML = dinoSpriteSVG();
  const steps = $('#parseSteps');
  if (job.status === 'error' || job.status === 'interrupted') {
    steps.innerHTML = `
      <li class="parse-error">
        <strong>${job.status === 'error' ? "Couldn't work that out" : 'That got interrupted'}</strong>
        <span>${escapeHtml(job.error || 'The page reloaded before it finished.')}</span>
        <span class="parse-error-actions">
          <button class="sheet-secondary" type="button" id="parseRetry">Try again</button>
          <button class="link-btn" type="button" id="parseEdit">Edit what I typed</button>
        </span>
      </li>`;
    $('#parseRetry').addEventListener('click', () => { runParseJob(job); });
    $('#parseEdit').addEventListener('click', () => backToType(job));
    $('#parseClose').textContent = 'Close';
    return;
  }
  $('#parseClose').textContent = "Close. Add it when it's ready";
  steps.innerHTML = job.steps.map(s => `
    <li class="parse-step ${s.state === 'done' ? 'done' : 'active'} ${s.tone || ''}">
      <span class="ps-icon" aria-hidden="true">${s.state === 'done' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7"/></svg>' : ''}</span>
      <span class="ps-label">${escapeHtml(s.state === 'done' ? s.label : `${s.label}…`)}</span>
    </li>`).join('') || '<li class="parse-step active"><span class="ps-icon" aria-hidden="true"></span><span class="ps-label">Starting…</span></li>';
}

let dinoTicker = null;

function startDinoTicker() {
  stopDinoTicker();
  const tick = () => {
    const job = flow.job;
    if (!job) return;
    $('#dinoStrip').style.setProperty('--p', (parseJobProgress(job) / 100).toFixed(3));
  };
  tick();
  dinoTicker = setInterval(tick, 150);
}

function stopDinoTicker() {
  if (dinoTicker) clearInterval(dinoTicker);
  dinoTicker = null;
}

$('#dinoStrip').addEventListener('click', () => {
  const strip = $('#dinoStrip');
  if (strip.classList.contains('jumping')) return;
  strip.classList.add('jumping');
  dinoJumps++;
  $('#dinoJumps').textContent = `${dinoJumps} JUMP${dinoJumps === 1 ? '' : 'S'}`;
  setTimeout(() => strip.classList.remove('jumping'), 300);
});

$('#parseClose').addEventListener('click', closeLogModal);

function backToType(job) {
  removeParseJob(job.id);
  unwatchJob();
  flow.job = null;
  showScreen('type');
  $('#logText').value = job.text;
  onLogTextInput();
  $('#logText').focus();
}

// ---------- REVIEW screen ----------
// Base day for "leaves you N kcal": only when the entry lands on the day Today has loaded.
function dayBaseline(date) {
  const t = state.today;
  const day = date || fmtDate(new Date());
  return t && t.date === day && t.remaining_kcal != null ? t : null;
}

// Quick amounts for a guessed item: none / half / as guessed / one and a half. For a
// database or barcode hit (needsAmount): half to double a serving.
function amountOptions(it) {
  const b = it.base;
  const unit = String(it.unit || '').toLowerCase();
  const grams = /^(g|grams?|ml)$/.test(unit);
  const factors = it.needsAmount ? [0.5, 1, 1.5, 2] : [0, 0.5, 1, 1.5];
  if (!(b.qty > 0)) return factors.map(f => ({ f, label: f === 0 ? 'None' : f === 1 ? 'As guessed' : f === 0.5 ? 'Half' : `${f}×` }));
  const step = grams ? 5 : 0.5;
  const seen = new Set();
  return factors.map(f => {
    const qty = f === 1 ? b.qty : Math.max(f === 0 ? 0 : step, Math.round(b.qty * f / step) * step);
    return { f: qty / b.qty, qty, label: qty === 0 ? 'None' : grams ? `${qty}${unit === 'ml' ? 'ml' : 'g'}` : `${qty} ${unit}` };
  }).filter(o => !seen.has(o.qty) && seen.add(o.qty));
}

function scaleItem(it, f) {
  const b = it.base;
  Object.assign(it, {
    qty: b.qty > 0 ? Math.round(b.qty * f * 10) / 10 : b.qty,
    kcal: Math.round(b.kcal * f), protein: round1(b.protein * f),
    fat: round1(b.fat * f), carb: round1(b.carb * f), fiber: round1(b.fiber * f), picked: f
  });
}

function renderReview() {
  const job = flow.job;
  const { items } = job.result;
  const totals = sumItems(items);
  job.result.totals = totals;
  const checks = job.checks.filter(i => items[i]);

  // Callout: only for what was guessed (or, for a database hit, how much you had).
  const others = items.length - checks.length;
  $('#reviewChecks').innerHTML = checks.length ? `
    <div class="check-card">
      <strong class="check-title">${items[checks[0]].needsAmount ? 'How much did you have?' : checks.length === 1 ? 'One thing to check' : `${checks.length} things to check`}</strong>
      ${checks.map(i => {
        const it = items[i];
        const trace = (job.result.trace || [])[i] || {};
        const why = it.needsAmount ? `One serving is ${it.base.qty} g.`
          : it.flagged === 'high-kcal' ? 'This came out unusually high, so it may be off.'
          : `I guessed${trace.ai_kcal_low && trace.ai_kcal_high ? ` (it could be ${trace.ai_kcal_low}–${trace.ai_kcal_high} kcal)` : ''}${others ? ', the rest came from real data' : ''}.`;
        return `
          <div class="check-item">
            ${it.needsAmount ? '' : `<span class="check-q">How much ${escapeHtml(it.name.toLowerCase())}?</span>`}
            <span class="check-why">${why}</span>
            <div class="amount-chips" role="group" aria-label="Amount of ${escapeHtml(it.name)}">
              ${amountOptions(it).map(o => `<button type="button" class="amount-chip" data-i="${i}" data-f="${o.f}" aria-pressed="${Math.abs((it.picked ?? 1) - o.f) < 0.001}">${escapeHtml(o.label)}</button>`).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>` : '';
  $$('#reviewChecks .amount-chip').forEach(btn => btn.addEventListener('click', () => {
    scaleItem(items[Number(btn.dataset.i)], Number(btn.dataset.f));
    renderReview();
  }));

  $('#parsedItems').innerHTML = `<div class="review-list">${items.map((it, i) => {
    const guessed = checks.includes(i) && !it.needsAmount;
    const amount = it.qty ? `${it.qty} ${it.unit || ''}`.trim() : '';
    return `
      <button class="review-row ${it.kcal === 0 && it.protein === 0 ? 'none' : ''}" type="button" data-i="${i}" aria-label="${escapeHtml(it.name)}: options">
        <span class="rr-text">
          <span class="rr-name">${escapeHtml(it.name)}</span>
          <span class="rr-meta">${amount ? `${escapeHtml(amount)} · ` : ''}${it.isExtra ? sourceBadge('extra') : sourceBadge(guessed ? 'guess' : it.source)}</span>
        </span>
        <span class="rr-nums"><span class="rr-kcal">${it.kcal.toLocaleString()}</span><span class="rr-prot">${round1(it.protein)}g P</span></span>
      </button>`;
  }).join('')}</div>`;
  $$('#parsedItems .review-row').forEach(btn => btn.addEventListener('click', () => openRowMenu(btn, reviewItemActions(Number(btn.dataset.i)))));

  renderExtras();
  $('#reviewMore').innerHTML = renderAIWork(job.result) + (job.result.trace && job.result.trace.length
    ? `<details class="ai-work"><summary>How it looked up each item</summary>${renderTrace(job.result.trace)}</details>` : '');

  const base = dayBaseline(job.date);
  if (base) {
    const left = base.remaining_kcal - totals.kcal;
    const prot = Math.max(0, Math.round(base.remaining_protein - totals.protein));
    $('#reviewLeft').innerHTML = `
      <span>${left >= 0 ? `Leaves you <strong>${left.toLocaleString()} kcal</strong>` : `Puts you <strong class="warn">${Math.abs(left).toLocaleString()} kcal</strong> over`}</span>
      <span><strong class="prot">${prot}g</strong> protein to go</span>`;
  } else {
    $('#reviewLeft').innerHTML = `<span>${round1(totals.protein)}g protein</span>`;
  }
  $('#parsedSaveBtn').textContent = `Log ${job.period.toLowerCase()} · ${totals.kcal.toLocaleString()} kcal`;
  $('#parsedSaveBtn').disabled = !items.some(it => it.kcal > 0 || it.protein > 0);
}

function reviewItemActions(i) {
  const job = flow.job;
  const it = job.result.items[i];
  const actions = [{ label: 'Set exact kcal', run: () => {
    const val = prompt(`Exact calories for "${it.name}" (now ${it.kcal}):`, it.kcal);
    const kcal = Math.round(Number(val));
    if (val === null || !(kcal >= 0)) return;
    // Keep the macros in proportion to the new kcal.
    const f = it.kcal > 0 ? kcal / it.kcal : 1;
    Object.assign(it, { kcal, protein: round1(it.protein * f), fat: round1(it.fat * f), carb: round1(it.carb * f), fiber: round1(it.fiber * f) });
    it.base = { qty: it.qty, kcal: it.kcal, protein: it.protein, fat: it.fat, carb: it.carb, fiber: it.fiber };
    it.picked = 1;
    job.checks = job.checks.filter(c => c !== i);
    renderReview();
  } }];
  if (it.source !== 'custom') actions.push({ label: 'Save as my food', run: async () => {
    await api('/api/custom-foods', { method: 'POST', body: { name: it.name, kcal: it.kcal, protein: it.protein, fat: it.fat || 0, carb: it.carb || 0, fiber: it.fiber || 0 } });
    mealSearchIndex = null;
    showToast(`Saved "${it.name}" as your food`);
  } });
  if (job.result.items.length > 1) actions.push({ label: 'Remove', danger: true, run: () => {
    job.result.items.splice(i, 1);
    if (job.result.trace) job.result.trace.splice(i, 1);
    job.checks = job.checks.filter(c => c !== i).map(c => (c > i ? c - 1 : c));
    renderReview();
  } });
  return actions;
}

function renderExtras() {
  const suggestions = flow.job.result.suggested_extras || [];
  $('#extrasWrap').innerHTML = `
    ${suggestions.length ? `<div class="extras-suggest"><span>Did you add:</span>${suggestions.map(s => `<button class="extras-chip" type="button" data-val="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>` : ''}
    <form class="panel-row" id="extrasForm">
      <label class="sr-only" for="extrasInput">Cooking extras</label>
      <input id="extrasInput" placeholder="Cooking extras? Oil, butter, sauce…" />
      <button class="sheet-secondary" id="extrasAdd" type="submit">+ Add</button>
    </form>`;
  $('#extrasForm').addEventListener('submit', (e) => { e.preventDefault(); addExtras(); });
  $$('#extrasWrap .extras-chip').forEach(chip => chip.addEventListener('click', () => { $('#extrasInput').value = chip.dataset.val; addExtras(); }));
}

async function addExtras() {
  const text = ($('#extrasInput') && $('#extrasInput').value.trim()) || '';
  const job = flow.job;
  if (!text || !job) return;
  const btn = $('#extrasAdd');
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const data = await api('/api/parse', { method: 'POST', body: { text } });
    if (data.error || !data.items?.length) { showToast('Could not parse that. Try being more specific.'); return; }
    const start = job.result.items.length;
    data.items.forEach((it, i) => {
      it.isExtra = true;
      it.flagged = (data.trace || [])[i]?.flagged || null;
      it.base = { qty: it.qty, kcal: it.kcal, protein: it.protein, fat: it.fat || 0, carb: it.carb || 0, fiber: it.fiber || 0 };
    });
    job.result.items.push(...data.items);
    job.result.trace = [...(job.result.trace || []), ...(data.trace || [])];
    job.checks.push(...itemsToCheck({ items: data.items, trace: data.trace }).map(i => i + start));
    renderReview();
  } catch (e) {
    showToast('Failed to add extra: ' + e.message);
  } finally {
    if ($('#extrasAdd')) { $('#extrasAdd').disabled = false; $('#extrasAdd').textContent = '+ Add'; }
  }
}

$('#reviewEdit').addEventListener('click', () => backToType(flow.job));

$('#reviewTemplate').addEventListener('click', async () => {
  const job = flow.job;
  const name = prompt('Template name:', job.text.slice(0, 60) || 'My meal');
  if (!name || !name.trim()) return;
  const items = job.result.items.filter(i => i.kcal > 0 || i.protein > 0);
  await api('/api/templates', { method: 'POST', body: {
    name: name.trim(),
    items: items.map(i => ({ name: i.name, kcal: i.kcal, protein: i.protein, fat: i.fat || 0, carb: i.carb || 0, fiber: i.fiber || 0 })),
    totals: sumItems(items)
  }});
  mealSearchIndex = null;
  showToast(`Template "${name.trim()}" saved`);
});

$('#parsedSaveBtn').addEventListener('click', async () => {
  const job = flow.job;
  if (!job) return;
  const btn = $('#parsedSaveBtn');
  btn.disabled = true;
  job.time = entryTime(job.date, job.period);
  const res = await logMeal(parseJobEntry(job));
  btn.disabled = false;
  if (!res || !res.entry) return;
  removeParseJob(job.id);
  afterLogged({ name: job.text, kcal: res.entry.kcal, protein: res.entry.protein, ids: [res.entry.id], text: job.local ? '' : job.text });
});

// ---------- DONE screen ----------
function afterLogged({ name, kcal, protein, ids, text = '' }) {
  const date = flow.date;
  const base = dayBaseline(date);
  unwatchJob();
  flow.job = null;
  flow.done = { ids, date, text };
  usualsLoading = null;
  mealSearchIndex = null;
  showScreen('done');
  const onToday = !$('#view-today').classList.contains('hidden');
  $('#lsDone').innerHTML = `
    <span class="done-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7"/></svg></span>
    <div class="done-text">
      <strong>${escapeHtml(name)}</strong>
      <span>${Math.round(kcal).toLocaleString()} kcal · ${round1(protein)}g protein</span>
    </div>
    ${base ? `
    <div class="done-tiles">
      <div class="done-tile"><strong class="${base.remaining_kcal - kcal < 0 ? 'warn' : ''}">${Math.abs(Math.round(base.remaining_kcal - kcal)).toLocaleString()}</strong><span>${base.remaining_kcal - kcal < 0 ? 'kcal over' : `kcal left ${date ? 'that day' : 'today'}`}</span></div>
      <div class="done-tile"><strong class="prot">${Math.max(0, Math.round(base.remaining_protein - protein))}g</strong><span>protein to go</span></div>
    </div>` : ''}
    <div class="done-actions">
      <button class="sheet-secondary" id="doneUndo" type="button">Undo</button>
      <button class="sheet-primary" id="doneBack" type="button">${sheetInline ? 'Log another' : onToday ? 'Back to Today' : 'Done'}</button>
    </div>`;
  $('#doneUndo').addEventListener('click', undoLogged);
  $('#doneBack').addEventListener('click', closeLogModal);
  $('#doneBack').focus();
  refreshAfterChange(date || undefined);
}

async function undoLogged() {
  const done = flow.done;
  if (!done) return;
  const day = done.date || fmtDate(new Date());
  $('#doneUndo').disabled = true;
  await Promise.all(done.ids.map(id => fetch(`/api/log/${day}/${id}`, { method: 'DELETE' })));
  flow.done = null;
  refreshAfterChange(done.date || undefined);
  showToast('Removed');
  showScreen('type');
  $('#logText').value = done.text;
  onLogTextInput();
  $('#logText').focus();
}

// ---------- How the AI worked it out ----------
// Reasoning summaries come as "**Short title**\n\nBody…". Split so the title can
// label the step and the body shows underneath.
function splitThought(text) {
  const m = /^\s*\*\*(.+?)\*\*\s*/.exec(text || '');
  const title = m ? m[1].trim() : '';
  const body = (m ? text.slice(m[0].length) : text || '').replace(/\*\*/g, '').trim();
  return { title, body };
}

// Collapsible "how it worked this out": the AI's thinking and any web sources
function renderAIWork(data) {
  const thoughts = (data.thinking || []).map(splitThought).filter(t => t.title || t.body);
  const sources = data.sources || [];
  if (!thoughts.length && !sources.length) return '';
  const thoughtHtml = thoughts.map(t => `
    <div class="ai-work-thought">
      ${t.title ? `<div class="ai-work-thought-title">${escapeHtml(t.title)}</div>` : ''}
      ${t.body ? `<div>${escapeHtml(t.body)}</div>` : ''}
    </div>`).join('');
  const sourceHtml = sources.length ? `
    <div class="ai-work-sources">
      <div class="ai-work-thought-title">Sources</div>
      ${sources.map(s => {
        const safeUrl = /^https?:\/\//i.test(s.url) ? s.url : '#';
        return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a>`;
      }).join('')}
    </div>` : '';
  const summary = sources.length ? `How the AI worked this out · ${sources.length} source${sources.length === 1 ? '' : 's'}` : 'How the AI worked this out';
  return `<details class="ai-work"><summary>${summary}</summary>${thoughtHtml}${sourceHtml}</details>`;
}

const TRACE_CONF_COLOR = { high: 'var(--green)', medium: 'var(--warn)', low: 'var(--danger-bright)' };
const TRACE_CAT_LABEL = { 'whole-food': 'whole food', chain: 'chain restaurant', branded: 'branded product', generic: 'generic', 'home-cooked': 'home-cooked' };
const TRACE_SOURCE_LABEL = {
  'custom':      'your saved value',
  'usda+ai':     'USDA (AI confirmed)',
  'usda':        'USDA',
  'fatsecret':   'FatSecret',
  'ai-estimate': 'AI estimate'
};
const TRACE_FLAG_NOTE = {
  'high-kcal':  ' <span style="color:var(--danger-bright);">⚠ unusually high — verify</span>',
  'sanity-cap': ' <span style="color:var(--warn);">⚠ sanity capped</span>'
};
const TRACE_USDA_STATUS = {
  confirmed: { icon: '✓', color: 'var(--green)', note: 'confirms AI' },
  conflict:  { icon: '!', color: 'var(--warn)',  note: 'differs from AI — used USDA (lab data)' }
};
const TRACE_USDA_FALLBACK = { icon: '?', color: 'var(--warn)', note: 'differs from AI — used USDA (lab data)' };

function renderTrace(trace) {
  if (!trace || !trace.length) return '';

  const rows = trace.map(t => {
    const conf = t.confidence || 'medium';
    const cColor = TRACE_CONF_COLOR[conf] || TRACE_CONF_COLOR.medium;

    // AI section
    let aiRow = `<div class="trace-step">
      <span class="src" style="color:${cColor};">AI (${conf} conf)</span>
      <span class="arrow">→</span>
      <span class="detail">${t.ai_kcal_total} kcal`;
    if (t.ai_kcal_low && t.ai_kcal_high) aiRow += ` <span style="color:var(--text-dim);font-size:11px;">(range ${t.ai_kcal_low}–${t.ai_kcal_high})</span>`;
    if (t.reasoning) aiRow += ` <span style="color:var(--text-dim);font-size:11px;">— ${escapeHtml(t.reasoning)}</span>`;
    aiRow += `</span></div>`;

    // USDA row (if present)
    let usdaRow = '';
    if (t.usda) {
      const u = TRACE_USDA_STATUS[t.usda.status] || TRACE_USDA_FALLBACK;
      usdaRow = `<div class="trace-step">
        <span class="src" style="color:${u.color};">${u.icon} USDA</span>
        <span class="arrow">→</span>
        <span class="detail">${escapeHtml(t.usda.name)} · ${t.usda.kcal_100g} kcal/100g · ${u.note}</span>
      </div>`;
    }

    // ai-verified is the only source label that depends on per-item data, so it can't go in the lookup.
    const sourceLabel = t.source === 'ai-verified'
      ? `AI verified${t.verify_note ? ' — ' + t.verify_note : ''}`
      : TRACE_SOURCE_LABEL[t.source] || 'AI estimate';
    const flagNote = TRACE_FLAG_NOTE[t.flagged] || '';

    return `<div class="trace-item">
      <div class="trace-item-name">${escapeHtml(t.name)} <span class="qty">· ${t.qty} ${t.unit}</span>
        <span style="font-size:11px;color:var(--text-dim);margin-left:6px;">${TRACE_CAT_LABEL[t.category] || t.category}</span>
      </div>
      ${aiRow}${usdaRow}
      <div class="trace-scaling">→ Final: <strong>${t.final_kcal} kcal</strong> · ${t.final_protein}g P · ${t.final_fat || 0}g F · ${t.final_carb || 0}g C · ${t.final_fiber || 0}g Fib · source: ${sourceLabel}${flagNote}</div>
    </div>`;
  }).join('');

  return `<div class="trace-panel">
    <div class="trace-title">How it looked up each item</div>
    ${rows}
  </div>`;
}
