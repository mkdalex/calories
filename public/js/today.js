// ---------- TODAY ----------
// null = today. A 'yyyy-mm-dd' string while browsing a past day from the header.
let todayViewDate = null;

async function loadToday() {
  const q = todayViewDate ? `?date=${todayViewDate}` : '';
  const [data, water] = await Promise.all([api('/api/log' + q), api('/api/water' + q)]);
  state.today = data;
  // Past days carry the historical target, not the current one — keep state.stats current.
  if (!todayViewDate) state.stats = data.stats;
  state.water = water;
  renderToday();
  renderWater();
}

// Anything on or after today snaps back to live "today".
function setTodayDate(date) {
  todayViewDate = date && date < fmtDate(new Date()) ? date : null;
  closeRowMenu();
  $('#targetDetails').classList.add('hidden');
  loadToday();
}

function shiftTodayDate(days) {
  const d = new Date((todayViewDate || fmtDate(new Date())) + 'T12:00:00');
  d.setDate(d.getDate() + days);
  setTodayDate(fmtDate(d));
}

function buildMacroDonut(data) {
  const pG = data.totals.protein || 0;
  const fG = data.totals.fat || 0;
  const cG = data.totals.carb || 0;
  const pK = pG * 4, fK = fG * 9, cK = cG * 4;
  const total = pK + fK + cK;
  if (total === 0) return '';

  const pPct = pK / total, fPct = fK / total, cPct = cK / total;
  const W = 120, R = 42, sw = 14;
  const cx = W / 2, cy = W / 2;
  const circ = 2 * Math.PI * R;
  const pLen = circ * pPct, fLen = circ * fPct, cLen = circ * cPct;
  const gap = 2;

  const dominant = pPct >= fPct && pPct >= cPct ? { name: 'Protein', pct: pPct, color: 'var(--purple)' }
                  : cPct >= fPct ? { name: 'Carbs', pct: cPct, color: 'var(--accent)' }
                  : { name: 'Fat', pct: fPct, color: 'var(--warn)' };

  return `
    <div class="macro-donut-wrap">
      <svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" class="macro-donut-svg" aria-hidden="true">
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--panel-2)" stroke-width="${sw}"/>
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--purple)" stroke-width="${sw}" stroke-dasharray="${Math.max(0,pLen-gap)} ${circ}" stroke-dashoffset="0" stroke-linecap="butt"/>
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--warn)"   stroke-width="${sw}" stroke-dasharray="${Math.max(0,fLen-gap)} ${circ}" stroke-dashoffset="${-pLen}"/>
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--accent)" stroke-width="${sw}" stroke-dasharray="${Math.max(0,cLen-gap)} ${circ}" stroke-dashoffset="${-(pLen + fLen)}"/>
      </svg>
      <div class="macro-donut-info">
        <div class="md-headline"><span style="color:${dominant.color};">${dominant.name}-heavy</span> · ${Math.round(dominant.pct * 100)}% of kcal</div>
        <div class="md-legend">
          <span><span class="md-dot" style="background:var(--purple);"></span>Protein ${Math.round(pPct * 100)}%</span>
          <span><span class="md-dot" style="background:var(--warn);"></span>Fat ${Math.round(fPct * 100)}%</span>
          <span><span class="md-dot" style="background:var(--accent);"></span>Carbs ${Math.round(cPct * 100)}%</span>
        </div>
      </div>
    </div>
  `;
}

function todayFeedback(data) {
  if (!data.entries?.length) return todayViewDate ? 'Nothing logged this day.' : 'Nothing logged yet.';
  if (data.stats.goal === 'reset') return 'Reset week: logging is the goal. Targets are a reference.';
  return todayViewDate ? 'Past day. Only what was logged counts.' : 'Today is in progress.';
}

function renderZoneBar(data) {
  const el = $('#zoneWrap');
  const stats = data.stats;
  const label = GoalPolicy.LABELS[stats.goal] || stats.goal_meta.label;
  const goal = stats.kcal_goal, maintenance = stats.tdee, eaten = data.totals.kcal;
  const maximum = Math.max(goal, maintenance, eaten, 1) * 1.15;
  const position = n => Math.max(0, Math.min(100, n / maximum * 100));
  const adjustment = goal - maintenance;
  const plan = stats.goal === 'reset' ? 'maintenance reference'
    : adjustment < 0 ? `${Math.abs(adjustment)} kcal planned deficit`
    : adjustment > 0 ? `${adjustment} kcal planned surplus` : 'maintenance target';
  const source = stats.target_source === 'saved_override' ? 'saved override' : 'profile formula';
  el.innerHTML = `
    <div class="card goal-summary">
      <h2>${escapeHtml(label)}</h2>
      <p><strong>${goal.toLocaleString()} kcal</strong> a day · <strong>${stats.protein_g} g</strong> protein</p>
      <p class="goal-note">Maintenance about ${maintenance.toLocaleString()} kcal · ${plan} · from ${source}</p>
      ${stats.override_review ? '<p class="goal-note goal-warn">The saved override needs a review.</p>' : ''}
      <div class="intake-track" role="img" aria-label="${eaten} kcal logged, maintenance estimate ${maintenance}, target ${goal}">
        <div class="intake-fill" style="width:${position(eaten)}%"></div>
        <span class="intake-tick" style="left:${position(maintenance)}%" title="Maintenance estimate: ${maintenance}"></span>
        <span class="intake-tick target" style="left:${position(goal)}%" title="Target: ${goal}"></span>
      </div>
      <div class="intake-legend"><span>${eaten.toLocaleString()} logged</span><span>Maintenance ${maintenance.toLocaleString()}</span><span>Target ${goal.toLocaleString()}</span></div>
      <div class="goal-foot">
        <span class="goal-note">${data.entries?.length ? (todayViewDate ? 'Past day' : 'In progress') : 'No meals logged'}</span>
        <button class="goal-link" type="button" onclick="setActiveView('profile')">Review target</button>
      </div>
    </div>`;
}

function renderToday() {
  const data = state.today;
  const banner = $('#setupBanner');
  // Reset week (or its day-8 prompt) sits above everything — during a reset it, not
  // the ring, is what the week is actually being judged on.
  if (typeof renderResetStrip === 'function') renderResetStrip(data);
  renderTodayHead(data);
  if (!data.stats) {
    banner.innerHTML = todayViewDate
      ? `<div class="setup-needed">No target on record for this day.</div>`
      : `<div class="setup-needed"><strong>Set up your profile first</strong><br/>Open Profile and fill in your stats so we can work out your daily target.</div>`;
    $('#summaryCard').innerHTML = '';
    $('#summaryCard').classList.add('hidden');
    $('#targetDetails').classList.add('hidden');
    $('#zoneWrap').innerHTML = '';
    $('#macroWrap').innerHTML = '';
  } else {
    banner.innerHTML = '';
    renderSummary(data);
    renderZoneBar(data);
    renderMacroDetails(data);
  }

  renderMeals(data);
  renderGapFill(data);
  loadTemplates();
  loadFavorites();
}

// ---------- HEADER ----------
function renderTodayHead(data) {
  const d = todayViewDate ? new Date(todayViewDate + 'T12:00:00') : new Date();
  $('#tdDate').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  let short = 'Today', long = 'Today';
  if (todayViewDate) {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const ageDays = Math.round((new Date(fmtDate(new Date()) + 'T12:00:00') - d) / 86400000);
    short = long = todayViewDate === fmtDate(yesterday) ? 'Yesterday'
      : ageDays < 7 ? d.toLocaleDateString([], { weekday: 'long' })
      : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  } else {
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const name = state.user && (state.user.global_name || state.user.username);
    long = name ? `${greet}, ${name.split(' ')[0]}` : greet;
  }
  $('#tdTitle .th-short').textContent = short;
  $('#tdGreeting').textContent = long;

  const streak = $('#tdStreak');
  const inReset = !!(data.stats && data.stats.reset_meta && !data.stats.reset_meta.expired);
  // Suppressed during a reset week: the reset strip already counts the only thing that
  // matters, and "1-day streak" next to it just makes a fresh start look small.
  if (!todayViewDate && !inReset && data.streak > 0) {
    streak.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.6 1.2 2.5 2 2.5 0-3 .5-5.5 1-8z"/></svg>${data.streak}-day streak`;
    streak.classList.remove('hidden');
  } else {
    streak.classList.add('hidden');
  }
  $('#tdBack').classList.toggle('hidden', !todayViewDate);
  $('#tdNext').disabled = !todayViewDate;
  $('#tdPicker').max = fmtDate(new Date());
  $('#tdPicker').value = todayViewDate || fmtDate(new Date());
}

// ---------- SUMMARY CARD ----------
function renderSummary(data) {
  const el = $('#summaryCard');
  el.classList.remove('hidden');
  const stats = data.stats;
  const goal = stats.kcal_goal;
  const eaten = Math.round(data.totals.kcal);
  const over = eaten > goal;
  const R = 64;
  const circ = 2 * Math.PI * R;
  const pct = goal > 0 ? Math.min(eaten / goal, 1) : 0;

  const prevNumEl = $('#summaryCard .ring-num');
  const prevNum = prevNumEl ? parseInt(prevNumEl.textContent.replace(/[^\d-]/g, '')) || 0 : 0;
  const newNum = over ? eaten - goal : goal - eaten;
  const prefix = over ? '+' : '';
  const goalLabel = (GoalPolicy.LABELS[stats.goal] || stats.goal_meta?.label || '').toLowerCase();
  const detailsOpen = !$('#targetDetails').classList.contains('hidden');

  const protein = Math.round(data.totals.protein);
  const pPct = pctOf(protein, stats.protein_g);
  const tile = (label, eatenG, targetG, warnOver) => `
    <div class="sum-tile ${warnOver && eatenG > targetG ? 'over' : ''}">
      <span class="st-label">${label}</span>
      <span class="st-val">${eatenG} <span class="st-of">/ ${targetG}g</span></span>
    </div>`;

  el.innerHTML = `
    <div class="sum-top">
      <div class="sum-ring">
        <svg width="148" height="148" viewBox="0 0 148 148" role="img" aria-label="${eaten} of ${goal} kcal eaten">
          <circle cx="74" cy="74" r="${R}" fill="none" stroke-width="14" class="ring-bg" />
          <circle cx="74" cy="74" r="${R}" fill="none" stroke-width="14" stroke-linecap="round" class="ring-fg ${over ? 'over' : ''}"
            stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct)}" transform="rotate(-90 74 74)" />
        </svg>
        <div class="ring-center">
          <span class="ring-num ${over ? 'over' : ''}">${prefix}${prevNum.toLocaleString()}</span>
          <span class="ring-label">${over ? 'kcal over' : 'kcal left'}</span>
        </div>
      </div>
      <div class="sum-figs">
        <div class="sf">
          <span class="sf-label">Eaten</span>
          <span class="sf-num">${eaten.toLocaleString()}</span>
        </div>
        <div class="sf-rule"></div>
        <button class="sf sf-target" id="sumTarget" type="button" aria-expanded="${detailsOpen}" aria-controls="targetDetails">
          <span class="sf-label">Target · ${escapeHtml(goalLabel)}</span>
          <span class="sf-num">${goal.toLocaleString()}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </span>
        </button>
      </div>
    </div>
    <div class="sum-protein">
      <div class="sp-row">
        <span class="sp-label">Protein</span>
        <span class="sp-val"><strong>${protein}</strong> / ${stats.protein_g} g</span>
      </div>
      <div class="sp-bar"><div style="width:${pPct}%"></div></div>
    </div>
    <div class="sum-tiles">
      ${tile('Carbs', Math.round(data.totals.carb || 0), stats.carb_g, true)}
      ${tile('Fat', Math.round(data.totals.fat || 0), stats.fat_g, true)}
      ${tile('Fibre', Math.round(data.totals.fiber || 0), stats.fiber_g, false)}
    </div>
    <p class="sum-status">${escapeHtml(todayFeedback(data))}</p>
  `;
  animateNumber($('#summaryCard .ring-num'), prevNum, newNum, 700, prefix);
  if (prevNum !== newNum && prevNumEl) {
    const ring = $('#summaryCard .sum-ring');
    ring.classList.remove('ring-pulse'); void ring.offsetWidth; ring.classList.add('ring-pulse');
  }
  $('#sumTarget').addEventListener('click', toggleTargetDetails);
}

function toggleTargetDetails() {
  const panel = $('#targetDetails');
  const open = panel.classList.toggle('hidden') === false;
  $('#sumTarget').setAttribute('aria-expanded', String(open));
  const remEl = $('#macroProteinRemaining');
  if (open && state.today && remEl && !remEl.innerHTML.trim() && localStorage.getItem('eduProteinOpen') === '1') loadMacroRemaining(state.today);
}

// Protein + macro breakdown with the "why it matters" notes. Lives behind the target tap.
function renderMacroDetails(data) {
  const protein = Math.round(data.totals.protein);
  const fatEaten = Math.round(data.totals.fat || 0);
  const carbEaten = Math.round(data.totals.carb || 0);
  const fiberEaten = Math.round((data.totals.fiber || 0) * 10) / 10;
  const rows = [
    ['protein', 'Protein', protein, data.stats.protein_g, 'var(--purple)', 'eduProteinOpen', EDU_PROTEIN_HTML, 'macroProteinRemaining'],
    ['fat', 'Fat', fatEaten, data.stats.fat_g, 'var(--warn)', 'macroFatOpen', EDU_FAT_HTML, 'macroFatRemaining'],
    ['carb', 'Carbs', carbEaten, data.stats.carb_g, 'var(--accent)', 'macroCarbOpen', EDU_CARBS_HTML, 'macroCarbRemaining'],
    ['fiber', 'Fibre', fiberEaten, data.stats.fiber_g, 'var(--info)', 'macroFiberOpen', EDU_FIBER_HTML, 'macroFiberRemaining'],
  ];
  $('#macroWrap').innerHTML = `
    <div class="card macro-card">
      <h2>Macros</h2>
      ${buildMacroDonut(data)}
      ${rows.map(([key, label, eaten, target, color, lsKey, edu, remId]) => {
        const open = localStorage.getItem(lsKey) === '1';
        return `
        <div class="macro-cell">
          <div class="macro-row">
            <span class="macro-label">${label}</span>
            <span class="macro-value">${eaten} / ${target}g</span>
          </div>
          <div class="bar"><div class="bar-fill" style="width:${pctOf(eaten, target)}%;background:${color};"></div></div>
          <button class="macro-toggle" type="button" data-key="${key}" data-ls="${lsKey}" aria-expanded="${open}">Why ${label.toLowerCase()} matters</button>
          <div class="macro-edu ${open ? '' : 'hidden'}" id="edu-${key}">${edu}<div id="${remId}"></div></div>
        </div>`;
      }).join('')}
    </div>`;
  $$('#macroWrap .macro-toggle').forEach(toggle => toggle.addEventListener('click', () => {
    const edu = $(`#edu-${toggle.dataset.key}`);
    const nowHidden = edu.classList.toggle('hidden');
    toggle.setAttribute('aria-expanded', String(!nowHidden));
    localStorage.setItem(toggle.dataset.ls, nowHidden ? '0' : '1');
    // Protein suggestions cost an AI call, so they only load once someone opens the note.
    if (toggle.dataset.key === 'protein' && !nowHidden && state.today) {
      const remEl = $('#macroProteinRemaining');
      if (remEl && !remEl.innerHTML.trim()) loadMacroRemaining(state.today);
    }
  }));
  renderMacroFoodChips('fatChips', 'fat');
  renderMacroFoodChips('carbChips', 'carb');
  renderMacroFoodChips('fiberChips', 'fiber');
  renderMacroFoodChips('proteinChips', 'protein');
}

// ---------- MEALS ----------
function renderMeals(data) {
  const list = $('#mealList');
  const entries = [...(data.entries || [])].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  // AI parses still running (or waiting for a check) for this day, from parse-jobs.js.
  const jobs = typeof parseJobsForDate === 'function' && data.date ? parseJobsForDate(data.date) : [];
  const inReset = !!(data.stats && data.stats.reset_meta && !data.stats.reset_meta.expired);
  $('#mealsCount').textContent = [entries.length && `${entries.length} logged`, jobs.length && `${jobs.length} in progress`].filter(Boolean).join(' · ');

  if (!entries.length && !jobs.length) {
    list.innerHTML = inReset
      ? `<div class="gap-empty"><strong>Nothing logged today</strong>Log one meal and the day counts. It doesn't have to be the whole day, and it doesn't have to hit the number.</div>`
      : '';
  } else {
    const groups = new Map();
    const group = period => groups.get(period) || groups.set(period, { entries: [], jobs: [] }).get(period);
    entries.forEach(e => group(getMealPeriod(e.time)).entries.push(e));
    jobs.forEach(job => group(job.period).jobs.push(job));
    const html = PERIOD_ORDER.filter(p => groups.has(p)).map(period => {
      const g = groups.get(period);
      const first = g.entries[0] ? g.entries[0].time : g.jobs[0].time || new Date(g.jobs[0].createdAt).toISOString();
      return `
        <div class="meal-group">
          <div class="meal-period">${period} · ${fmtTime(first)}</div>
          ${g.entries.map(mealRowHtml).join('')}
          ${g.jobs.map(pendingRowHtml).join('')}
        </div>`;
    }).join('');
    list.innerHTML = `<div class="meals-card">${html}</div>`;

    $$('#mealList .meal-main[data-id]').forEach(btn => btn.addEventListener('click', () => {
      const entry = entries.find(e => e.id === btn.dataset.id);
      if (entry) openEditModal(entry, data.date);
    }));
    $$('#mealList .meal-more[data-id]').forEach(btn => btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const entry = entries.find(e => e.id === btn.dataset.id);
      if (entry) openRowMenu(btn, mealActions(entry, data.date, btn));
    }));
    $$('#mealList .meal-main[data-job]').forEach(btn => btn.addEventListener('click', () => openParseJob(btn.dataset.job)));
    $$('#mealList .meal-more[data-job]').forEach(btn => btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.job;
      openRowMenu(btn, [
        { label: 'Open', run: () => openParseJob(id) },
        { label: 'Discard', danger: true, run: () => { removeParseJob(id); renderMeals(state.today); } },
      ]);
    }));
    if (jobs.some(j => j.status === 'parsing')) startPendingTicker();
  }

  // Dashed "Add dinner" slots for main meals that haven't been logged yet. On today only
  // periods that have already started count as missing; on a past day all of them do.
  const logged = new Set([...entries.map(e => getMealPeriod(e.time)), ...jobs.map(j => j.period)]);
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const missing = MAIN_PERIODS.filter(p => !logged.has(p) && (todayViewDate || hour >= PERIOD_START[p]));
  $('#mealSlots').innerHTML = missing.map(p => `
    <button class="meal-slot" type="button" data-period="${p}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
      Add ${p.toLowerCase()}
    </button>`).join('');
  $$('#mealSlots .meal-slot').forEach(btn => btn.addEventListener('click', () => openLogModal(todayViewDate, btn.dataset.period)));
}

function mealRowHtml(e) {
  const hasMacros = e.fat || e.carb || e.fiber;
  return `
    <div class="meal-row">
      <button class="meal-main" type="button" data-id="${e.id}">
        <span class="meal-text">
          <span class="meal-name">${escapeHtml(e.name)}</span>
          <span class="meal-meta">${sourceBadge(e.source)}${hasMacros ? `<span>F${Math.round(e.fat || 0)} · C${Math.round(e.carb || 0)} · Fib${Math.round((e.fiber || 0) * 10) / 10}</span>` : ''}</span>
        </span>
        <span class="meal-nums">
          <span class="meal-kcal">${Math.round(e.kcal).toLocaleString()}</span>
          <span class="meal-prot">${Math.round(e.protein)}g P</span>
        </span>
      </button>
      <button class="meal-more" type="button" data-id="${e.id}" aria-haspopup="menu" aria-expanded="false" aria-label="More options for ${escapeHtml(e.name)}">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
      </button>
    </div>
    <div class="rescan-panel hidden" id="rescan-${e.id}"></div>`;
}

// A background AI parse that hasn't been logged yet: mini dino and progress while it
// works, then "Check 1 thing" if something was guessed, or a retry if it failed.
function pendingRowHtml(job) {
  const n = (job.checks || []).length;
  const totals = job.result && job.result.totals;
  let line;
  if (job.status === 'parsing' || job.status === 'saving') {
    line = `<span class="pending-dino" aria-hidden="true">${dinoSpriteSVG()}</span>
      <span class="pending-bar" aria-hidden="true"><span style="width:${parseJobProgress(job).toFixed(1)}%"></span></span>
      <span class="pending-label">${escapeHtml(parseJobLabel(job))}</span>`;
  } else if (job.status === 'ready' || job.status === 'review') {
    line = `<span class="src-badge ${n ? 'src-guess' : 'src-db'}">${n ? `Check ${n} thing${n === 1 ? '' : 's'}` : 'Ready to log'}</span>`;
  } else {
    line = `<span class="pending-error">${job.status === 'interrupted' ? 'Interrupted. Tap to try again' : "Couldn't work it out. Tap to see why"}</span>`;
  }
  const ready = totals && (job.status === 'ready' || job.status === 'review');
  return `
    <div class="meal-row pending">
      <button class="meal-main" type="button" data-job="${job.id}">
        <span class="meal-text">
          <span class="meal-name">${escapeHtml(job.text)}</span>
          <span class="pending-line">${line}</span>
        </span>
        <span class="meal-nums ${ready ? '' : 'waiting'}">
          <span class="meal-kcal">${ready ? totals.kcal.toLocaleString() : '…'}</span>
          <span class="meal-prot">${ready ? `${Math.round(totals.protein)}g P` : '…'}</span>
        </span>
      </button>
      <button class="meal-more" type="button" data-job="${job.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Options for ${escapeHtml(job.text)}">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
      </button>
    </div>`;
}

// Moves the pending rows' progress bars without re-rendering the whole list.
let pendingTicker = null;
function startPendingTicker() {
  if (pendingTicker) return;
  pendingTicker = setInterval(() => {
    const rows = $$('#mealList .meal-main[data-job]');
    let running = 0;
    rows.forEach(btn => {
      const job = findParseJob(btn.dataset.job);
      if (!job || job.status !== 'parsing') return;
      running++;
      const bar = btn.querySelector('.pending-bar > span');
      const label = btn.querySelector('.pending-label');
      if (bar) bar.style.width = `${parseJobProgress(job).toFixed(1)}%`;
      if (label) label.textContent = parseJobLabel(job);
    });
    if (!running) { clearInterval(pendingTicker); pendingTicker = null; }
  }, 250);
}

function mealActions(entry, date, anchor) {
  return [
    { label: 'Edit', run: () => openEditModal(entry, date) },
    { label: 'Re-scan with AI', run: () => rescanEntry(entry, date, anchor) },
    { label: 'Save as template', run: async () => {
      const name = prompt('Template name:', entry.name.slice(0, 60));
      if (!name || !name.trim()) return;
      await api('/api/templates', { method: 'POST', body: { name: name.trim(), from_log_entry_id: entry.id, date } });
      showToast(`Template "${name.trim()}" saved`);
      loadTemplates();
    } },
    { label: 'Delete', danger: true, run: async () => {
      await fetch(`/api/log/${date}/${entry.id}`, { method: 'DELETE' });
      loadToday();
      showUndoToast(`Deleted "${entry.name.slice(0, 40)}"`, async () => {
        await logMeal({
          name: entry.name, kcal: entry.kcal, protein: entry.protein,
          fat: entry.fat || 0, carb: entry.carb || 0, fiber: entry.fiber || 0,
          source: entry.source, items: entry.items, time: entry.time, date
        });
        loadToday();
      });
    } },
  ];
}

// ---------- ROW MENU (the ⋯ on each meal) ----------
let rowMenu = null;

function openRowMenu(anchor, actions) {
  const reopening = rowMenu && rowMenu.anchor === anchor;
  closeRowMenu();
  if (reopening) return;
  const menu = document.createElement('div');
  menu.className = 'row-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = actions.map((a, i) =>
    `<button type="button" role="menuitem" data-i="${i}" class="${a.danger ? 'danger' : ''}">${escapeHtml(a.label)}</button>`).join('');
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const top = r.bottom + menu.offsetHeight + 8 > innerHeight ? r.top - menu.offsetHeight - 4 : r.bottom + 4;
  menu.style.top = `${top + scrollY}px`;
  menu.style.left = `${Math.max(8, r.right - menu.offsetWidth) + scrollX}px`;
  anchor.setAttribute('aria-expanded', 'true');

  const items = [...menu.querySelectorAll('[role=menuitem]')];
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    closeRowMenu();
    actions[Number(b.dataset.i)].run();
  });
  menu.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.stopPropagation(); closeRowMenu(); anchor.focus(); }
    else if (e.key === 'Tab') closeRowMenu();
  });
  const outside = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeRowMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  rowMenu = { menu, anchor, outside };
  items[0].focus();
}

function closeRowMenu() {
  if (!rowMenu) return;
  document.removeEventListener('pointerdown', rowMenu.outside);
  rowMenu.anchor.setAttribute('aria-expanded', 'false');
  rowMenu.menu.remove();
  rowMenu = null;
}

// ---------- MEAL PERIOD ----------
function getMealPeriod(timeStr) {
  if (!timeStr) return 'Other';
  const d = new Date(timeStr);
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 10.5) return 'Breakfast';
  if (h < 15)   return 'Lunch';
  if (h < 17)   return 'Snack';
  if (h < 22.5) return 'Dinner';
  return 'Late night';
}
const PERIOD_ORDER = ['Breakfast', 'Lunch', 'Snack', 'Dinner', 'Late night', 'Other'];
const MAIN_PERIODS = ['Breakfast', 'Lunch', 'Dinner'];
// Hour each period starts, matching getMealPeriod's boundaries.
const PERIOD_START = { Breakfast: 0, Lunch: 10.5, Snack: 15, Dinner: 17, 'Late night': 22.5 };
// Clock time an entry gets when it's logged into a period other than the current one.
const PERIOD_TIME = { Breakfast: '08:00', Lunch: '12:30', Snack: '15:30', Dinner: '20:00', 'Late night': '23:00' };

// ---------- GAP FILL ----------
const GAP_FOODS = [
  { name: '200g chicken breast',           kcal: 330, protein: 62, fat:  7, carb:  0, fiber:  0 },
  { name: '200g Greek yoghurt',            kcal: 120, protein: 20, fat:  3, carb:  6, fiber:  0 },
  { name: '1 scoop whey + 250ml milk',     kcal: 230, protein: 28, fat:  5, carb: 16, fiber:  0 },
  { name: '1 can tuna (185g)',             kcal: 175, protein: 40, fat:  2, carb:  0, fiber:  0 },
  { name: '3 scrambled eggs',              kcal: 210, protein: 18, fat: 15, carb:  1, fiber:  0 },
  { name: '200g cottage cheese',           kcal: 140, protein: 25, fat:  4, carb:  4, fiber:  0 },
  { name: '1 cup lentil soup',             kcal: 230, protein: 18, fat:  1, carb: 40, fiber: 16 },
  { name: '100g edamame (microwaved)',      kcal: 120, protein: 11, fat:  5, carb:  9, fiber:  5 },
  { name: '30g chia seeds + yoghurt',      kcal: 200, protein: 10, fat: 10, carb: 18, fiber: 11 },
  { name: '150g chicken + cup broccoli',   kcal: 290, protein: 47, fat:  5, carb:  8, fiber:  4 },
  { name: '1 cup oats + banana',           kcal: 265, protein:  7, fat:  3, carb: 54, fiber:  7 },
  { name: '30g almonds',                   kcal: 175, protein:  6, fat: 15, carb:  6, fiber:  4 },
  { name: '1/2 avocado + 2 eggs',          kcal: 300, protein: 13, fat: 22, carb:  9, fiber:  5 },
  { name: '100g salmon fillet',            kcal: 180, protein: 25, fat:  9, carb:  0, fiber:  0 },
  { name: '1 cup raspberries + whey shake',kcal: 185, protein: 24, fat:  2, carb: 18, fiber:  8 },
  { name: '1 potato + cottage cheese',     kcal: 300, protein: 29, fat:  4, carb: 41, fiber:  4 },
  { name: '1 cup chickpeas + Greek yoghurt',kcal:260, protein: 22, fat:  3, carb: 36, fiber: 10 },
  { name: 'Tuna + salad wrap',             kcal: 350, protein: 38, fat:  6, carb: 38, fiber:  5 },
  { name: '200g lean beef mince + veg',    kcal: 380, protein: 46, fat: 18, carb: 12, fiber:  4 },
  { name: 'Apple + 30g peanut butter',     kcal: 285, protein:  8, fat: 16, carb: 31, fiber:  6 },
  { name: '1 cup cooked rice + eggs',      kcal: 340, protein: 18, fat:  7, carb: 52, fiber:  1 },
  { name: '1 cup frozen peas + chicken',   kcal: 270, protein: 38, fat:  3, carb: 20, fiber:  7 },
];

function renderGapFill(data) {
  const wrap = $('#gapFillWrap');
  if (!wrap) return;
  if (todayViewDate || !data.stats || data.stats.goal === 'reset') { wrap.innerHTML = ''; return; }

  const { remaining_kcal, remaining_protein, remaining_fat, remaining_carb, remaining_fiber } = data;
  const hour = new Date().getHours();
  if (hour < 10) { wrap.innerHTML = ''; return; } // too early for gap suggestions

  // Only flag protein gaps — user focuses on kcal + protein, doesn't track other macros
  const behind = [];
  if ((remaining_protein || 0) > 20) behind.push('protein');

  if (!behind.length || (remaining_kcal !== null && remaining_kcal < 50)) {
    wrap.innerHTML = ''; return;
  }

  const kcalBudget = remaining_kcal !== null ? remaining_kcal : 9999;
  const rem = { protein: remaining_protein || 0, fiber: remaining_fiber || 0, carb: remaining_carb || 0, fat: remaining_fat || 0 };

  const scored = GAP_FOODS
    .filter(f => f.kcal <= kcalBudget * 1.15)
    .map(f => {
      let score = 0;
      const multiBehind = behind.filter(m => f[m] > 5).length;
      behind.forEach(m => {
        if (f[m] >= rem[m] * 0.25) score += 2;
        if (f[m] >= rem[m] * 0.5)  score += 1;
      });
      if (multiBehind >= 2) score += 3; // big bonus for closing multiple gaps
      return { ...f, score };
    })
    .filter(f => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) { wrap.innerHTML = ''; return; }

  wrap.innerHTML = `
    <section class="gap-card" aria-labelledby="gapTitle">
      <div class="gap-head">
        <h2 id="gapTitle">${Math.round(remaining_protein)}g protein to go</h2>
        ${remaining_kcal !== null ? `<span>${Math.max(0, Math.round(remaining_kcal)).toLocaleString()} kcal left</span>` : ''}
      </div>
      ${scored.map((s, i) => `
        <div class="gap-item">
          <span class="gap-name">${escapeHtml(s.name)}</span>
          <span class="gap-meta">${s.kcal} kcal · <strong>${s.protein}g</strong></span>
          <button class="gap-add" type="button" data-i="${i}" aria-label="Log ${escapeHtml(s.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>`).join('')}
    </section>`;

  wrap.querySelectorAll('.gap-add').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = scored[Number(btn.dataset.i)];
      btn.disabled = true; // not passed to logMeal, which would replace the icon with text
      const ok = await logMeal({ name: s.name, kcal: s.kcal, protein: s.protein, fat: s.fat, carb: s.carb, fiber: s.fiber, source: 'custom' });
      btn.disabled = false;
      if (!ok) return;
      showToast(`Logged: ${s.name}`);
      loadToday();
    });
  });
}

// ---------- MACRO REMAINING SUGGESTIONS ----------
async function loadMacroRemaining(data) {
  if (!data.stats || todayViewDate) return;
  const hour = new Date().getHours();
  if (hour < 12) return; // only show after midday
  // Protein-only — user focuses on kcal + protein, fat/carb/fiber suggestions skipped to save AI calls
  const macros = [
    { key: 'protein', remaining: data.remaining_protein, target: data.stats.protein_g, containerId: 'macroProteinRemaining' }
  ];
  for (const m of macros) {
    const el = document.getElementById(m.containerId);
    if (!el || !m.remaining || m.remaining < 5) continue;
    el.innerHTML = `<div class="macro-remaining-card"><div class="mr-title">You have ${Math.round(m.remaining)}g ${m.key} left — quick options:</div><div class="mr-items" style="color:var(--text-dim);font-size:12px;">Loading…</div></div>`;
    try {
      const result = await api(`/api/macro-suggest?macro=${m.key}&remaining=${Math.round(m.remaining)}`);
      const itemsEl = el.querySelector('.mr-items');
      if (!itemsEl || result.error || !result.suggestions?.length) { if (itemsEl) itemsEl.textContent = ''; continue; }
      itemsEl.innerHTML = result.suggestions.map(s => `
        <div class="macro-remaining-item">
          <span class="mr-name">${escapeHtml(s.name)}</span>
          <span class="mr-note">${s.note || (s.kcal + ' kcal')}</span>
          <button class="mr-log" data-s='${JSON.stringify(s).replace(/'/g,"&#39;")}'>Log</button>
        </div>
      `).join('');
      itemsEl.querySelectorAll('.mr-log').forEach(btn => {
        btn.addEventListener('click', async () => {
          const s = JSON.parse(btn.dataset.s.replace(/&#39;/g, "'"));
          if (!await logMeal({ name: s.name, kcal: s.kcal, protein: s.protein || 0, fat: s.fat || 0, carb: s.carb || 0, fiber: s.fiber || 0, source: 'ai-estimate' }, btn)) return;
          showToast(`Logged: ${s.name}`);
          loadToday();
        });
      });
    } catch (_) {
      const itemsEl = el.querySelector('.mr-items');
      if (itemsEl) itemsEl.textContent = '';
    }
  }
}
