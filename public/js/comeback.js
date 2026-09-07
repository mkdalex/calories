// ---------- COMEBACK ----------
// Shown when you return after a gap in logging. Deliberately NOT the first-run
// wizard: you already know what the app does, your profile is intact, and your
// templates are waiting. The only things actually stale are your weight and your
// intent — so those are the only two things this asks for.
//
// The third option on the intent step is the one that matters. Every goal the app
// had before this required you to already know whether you were cutting, bulking or
// maintaining. Coming off a break you usually don't, and picking wrong is how people
// bounce off again. Reset week removes the choice for seven days.

const CB_INTENTS = [
  {
    id: 'reset',
    emoji: '🔁',
    name: 'Just get back in the habit',
    desc: '7 days at maintenance — no deficit. The only target is that you log. Pick a real goal on day 8, with a week of your own data behind it.',
    recommended: true
  },
  { id: 'steady',   emoji: '📉', name: 'Lose fat',      desc: '~0.5 kg/week deficit. Straight back into a cut.' },
  { id: 'maintain', emoji: '➖', name: 'Maintain',      desc: 'Hold your weight, keep protein high.' },
  { id: 'gain',     emoji: '📈', name: 'Build muscle',  desc: 'Slight surplus for lean gain.' }
];

let comebackState = null;
// Kept after the overlay is gone (or was never shown) so the History empty states can
// point at the month that actually has data instead of just saying "no data".
let comebackInfo = null;

async function maybeShowComeback() {
  let data;
  try { data = await api('/api/comeback'); } catch (_) { return false; }
  comebackInfo = data && data.last_logged ? data : null;
  if (!data || !data.show) return false;
  comebackState = {
    step: 1,
    data,
    weight: data.last_weight ? data.last_weight.kg : '',
    intent: null,
    keepTdee: true
  };
  buildComebackShell();
  renderComebackStep();
  return true;
}

function buildComebackShell() {
  if ($('#comebackBg')) return;
  const bg = document.createElement('div');
  bg.id = 'comebackBg';
  bg.className = 'cb-bg';
  bg.innerHTML = `
    <div class="cb-card">
      <div class="cb-pips" id="cbPips"></div>
      <div id="cbContent"></div>
      <div id="cbNav" class="cb-nav"></div>
    </div>`;
  document.body.appendChild(bg);
}

function dismissComeback() {
  const bg = $('#comebackBg');
  if (bg) bg.remove();
  comebackState = null;
}

// "120 days" is accurate but hard to feel. Months read as a duration.
function cbHumanGap(days) {
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  const months = Math.round(days / 30);
  return months >= 12 ? `${Math.round(days / 365 * 10) / 10} years` : `${months} months`;
}

function cbFmtDate(ds) {
  return new Date(ds + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderComebackStep() {
  if (!comebackState) return;
  const total = 3;
  const step = comebackState.step;
  $('#cbPips').innerHTML = Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    return `<span class="cb-pip ${n === step ? 'active' : n < step ? 'done' : ''}"></span>`;
  }).join('');
  if (step === 1) renderCbWelcome();
  else if (step === 2) renderCbIntent();
  else if (step === 3) renderCbConfirm();
}

// ---------- Step 1: what you did, then what you weigh ----------
function renderCbWelcome() {
  const d = comebackState.data;
  const r = d.recap;
  const gapText = cbHumanGap(d.gap_days);

  // Lead with the work, not the lapse. A stretch that ended is still a stretch that happened.
  let recapHtml = '';
  if (r && r.days_logged) {
    const bits = [];
    bits.push(`<div class="cb-recap-item"><div class="cb-recap-num">${r.days_logged}</div><div class="cb-recap-lbl">days logged</div></div>`);
    if (r.avg_kcal) bits.push(`<div class="cb-recap-item"><div class="cb-recap-num">${r.avg_kcal.toLocaleString()}</div><div class="cb-recap-lbl">avg kcal</div></div>`);
    if (r.avg_protein) bits.push(`<div class="cb-recap-item"><div class="cb-recap-num">${Math.round(r.avg_protein)}g</div><div class="cb-recap-lbl">avg protein</div></div>`);
    if (r.weight_delta_kg !== null && r.weight_delta_kg !== undefined) {
      const sign = r.weight_delta_kg > 0 ? '+' : '';
      bits.push(`<div class="cb-recap-item"><div class="cb-recap-num">${sign}${r.weight_delta_kg}</div><div class="cb-recap-lbl">kg change</div></div>`);
    }
    recapHtml = `
      <div class="cb-recap">
        <div class="cb-recap-hd">Your last stretch · ${cbFmtDate(r.start)} – ${cbFmtDate(r.end)}</div>
        <div class="cb-recap-grid">${bits.join('')}</div>
      </div>`;
  }

  const staleNote = d.weight_age_days !== null && d.weight_age_days > 14
    ? `<div class="cb-hint">Last weigh-in was ${cbFmtDate(d.last_weight.date)} — ${cbHumanGap(d.weight_age_days)} ago. Your calorie and protein targets are still built on that number, so this is the one thing worth fixing before anything else.</div>`
    : '';

  $('#cbContent').innerHTML = `
    <div class="cb-hero">
      <div class="cb-emoji">👋</div>
      <h1>Welcome back</h1>
      <p class="cb-lede">It's been <strong>${gapText}</strong>. Nothing was lost — your profile, templates and history are exactly where you left them.</p>
    </div>
    ${recapHtml}
    <div class="cb-weigh">
      <label for="cbWeight">What do you weigh now?</label>
      <div class="cb-weigh-row">
        <input id="cbWeight" type="number" step="0.1" inputmode="decimal" value="${comebackState.weight}" placeholder="80" />
        <span class="cb-unit">kg</span>
      </div>
      ${staleNote}
      <div class="cb-error hidden" id="cbWeightError"></div>
    </div>`;

  $('#cbNav').innerHTML = `
    <button class="btn btn-secondary" id="cbSkip">Skip for now</button>
    <button class="btn" id="cbNext1">Continue →</button>`;

  $('#cbSkip').addEventListener('click', cbSkipAll);
  $('#cbNext1').addEventListener('click', () => {
    const raw = $('#cbWeight').value.trim();
    const w = Number(raw);
    // A weight is genuinely optional here — you might not have scales to hand — but a
    // typo'd one silently poisons every target, so a bad value is refused outright.
    if (raw !== '' && (!Number.isFinite(w) || w < 30 || w > 250)) {
      const err = $('#cbWeightError');
      err.textContent = 'Weight should be between 30 and 250 kg.';
      err.classList.remove('hidden');
      return;
    }
    comebackState.weight = raw === '' ? '' : w;
    comebackState.step = 2;
    renderComebackStep();
  });
  $('#cbWeight').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('#cbNext1').click(); }
  });
}

// ---------- Step 2: intent ----------
function renderCbIntent() {
  const sel = comebackState.intent;
  $('#cbContent').innerHTML = `
    <h2>What do you want right now?</h2>
    <div class="cb-subtitle">There's no wrong answer, and you can change it whenever. If you genuinely don't know, that's what the first one is for.</div>
    <div class="cb-cards">
      ${CB_INTENTS.map(o => `
        <button class="cb-card-option ${sel === o.id ? 'active' : ''} ${o.recommended ? 'recommended' : ''}" data-id="${o.id}">
          <span class="cb-card-emoji">${o.emoji}</span>
          <div class="cb-card-text">
            <div class="cb-card-name">${o.name}${o.recommended ? '<span class="cb-rec-tag">recommended</span>' : ''}</div>
            <div class="cb-card-desc">${o.desc}</div>
          </div>
        </button>`).join('')}
    </div>`;

  $('#cbNav').innerHTML = `
    <button class="btn btn-secondary" id="cbBack2">← Back</button>
    <button class="btn" id="cbNext2" ${!sel ? 'disabled' : ''}>See my numbers →</button>`;

  $$('#cbContent .cb-card-option').forEach(btn => btn.addEventListener('click', () => {
    comebackState.intent = btn.dataset.id;
    $$('#cbContent .cb-card-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('#cbNext2').disabled = false;
  }));
  $('#cbBack2').addEventListener('click', () => { comebackState.step = 1; renderComebackStep(); });
  $('#cbNext2').addEventListener('click', async () => {
    if (!comebackState.intent) return;
    const btn = $('#cbNext2');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const res = await api('/api/comeback/complete', {
        method: 'POST',
        body: {
          weight_kg: comebackState.weight === '' ? null : comebackState.weight,
          goal: comebackState.intent,
          keep_tdee_override: comebackState.keepTdee,
          last_logged: comebackState.data.last_logged
        }
      });
      if (!res || res.error) throw new Error(res && res.error);
      comebackState.stats = res.stats;
      comebackState.step = 3;
      renderComebackStep();
    } catch (_) {
      btn.disabled = false;
      btn.textContent = 'See my numbers →';
      showToast("Couldn't save — check your connection");
    }
  });
}

// ---------- Step 3: the numbers, and the stale-TDEE call ----------
function renderCbConfirm() {
  const s = comebackState.stats;
  const d = comebackState.data;
  if (!s) { comebackState.step = 2; renderComebackStep(); return; }

  const isReset = comebackState.intent === 'reset';

  // A hand-calibrated TDEE measured at a bodyweight you no longer have is a guess
  // wearing a lab coat. Show both numbers and let the user decide which they trust.
  let tdeeHtml = '';
  if (d.stale_tdee) {
    const st = d.stale_tdee;
    tdeeHtml = `
      <div class="cb-tdee" id="cbTdeeBox">
        <div class="cb-tdee-hd">⚠ Your TDEE was hand-calibrated${st.calibrated_at ? ' on ' + cbFmtDate(st.calibrated_at) : ''}</div>
        <div class="cb-tdee-nums">
          <div><span class="cb-tdee-num">${st.predicted.toLocaleString()}</span><span class="cb-tdee-lbl">predicted now</span></div>
          <div><span class="cb-tdee-num">${st.override.toLocaleString()}</span><span class="cb-tdee-lbl">your override</span></div>
        </div>
        <div class="cb-tdee-note">That was measured at a bodyweight you may no longer have. Either way, the app re-checks it once you've logged ~14 fresh days.</div>
        <div class="cb-tdee-btns">
          <button class="btn btn-secondary cb-tdee-btn active" data-keep="1">Keep it</button>
          <button class="btn btn-secondary cb-tdee-btn" data-keep="0">Reset to predicted</button>
        </div>
      </div>`;
  }

  const resetBlock = isReset ? `
    <div class="cb-resetbox">
      <div class="cb-resetbox-hd">🔁 Reset week — day 1 of 7</div>
      <p>No deficit this week. Eating <strong>${s.kcal_goal.toLocaleString()} kcal</strong> holds you steady, and that's on purpose — the habit is the whole objective right now.</p>
      <p><strong>You "win" a day by logging it.</strong> Not by hitting a number. Over, under, one meal, all of them — a logged day is a green day.</p>
      <p>On day 8 you'll pick a real goal, and you'll have a week of your own intake data to pick it with instead of guessing today.</p>
    </div>` : '';

  $('#cbContent').innerHTML = `
    <h2>${isReset ? "Here's your week" : 'Your numbers'}</h2>
    <div class="cb-subtitle">${
      comebackState.weight !== ''
        ? `Recalculated from today's weigh-in (${comebackState.weight} kg).`
        : `Still based on your last recorded weight — update it in Profile when you can.`
    }</div>
    <div class="cb-summary-grid">
      <div class="cb-stat hero">
        <div class="cb-stat-num">${s.kcal_goal.toLocaleString()}</div>
        <div class="cb-stat-lbl">kcal / day</div>
      </div>
      <div class="cb-stat hero">
        <div class="cb-stat-num">${s.protein_g}g</div>
        <div class="cb-stat-lbl">protein / day</div>
      </div>
    </div>
    ${resetBlock}
    ${tdeeHtml}
    <div class="cb-tips">
      <strong>Easing back in</strong>
      <ul>
        <li>Your old templates and favourites are still on the Today tab — one tap, no typing, no AI call.</li>
        <li>A partial day beats a skipped one. Log the meal you remember and move on.</li>
        <li>History still holds everything from before. It's there when you want it, not in your way.</li>
      </ul>
    </div>`;

  $('#cbNav').innerHTML = `<span></span><button class="btn" id="cbFinish">${isReset ? 'Start day 1 →' : 'Start tracking →'}</button>`;

  $$('#cbContent .cb-tdee-btn').forEach(btn => btn.addEventListener('click', async () => {
    const keep = btn.dataset.keep === '1';
    $$('#cbContent .cb-tdee-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    comebackState.keepTdee = keep;
    if (!keep) {
      const res = await api('/api/comeback/complete', { method: 'POST', body: { keep_tdee_override: false } });
      if (res && res.stats) { comebackState.stats = res.stats; renderComebackStep(); }
    }
  }));

  $('#cbFinish').addEventListener('click', () => {
    dismissComeback();
    loadToday();
  });
}

// Skipping still stamps the acknowledgement — being asked twice in one session is
// nagging, and the gap will re-arm the prompt on its own if they lapse again.
async function cbSkipAll() {
  const lastLogged = comebackState && comebackState.data ? comebackState.data.last_logged : null;
  dismissComeback();
  try {
    await api('/api/comeback/complete', { method: 'POST', body: { last_logged: lastLogged } });
  } catch (_) { /* non-fatal — they'll just see it once more */ }
  loadToday();
}

// ---------- Reset week strip (Today view) ----------
// Rendered above the ring. During a reset the ring still shows calories — that
// information is worth having — but the strip is what you're actually scored on,
// so it sits above it and it counts logged days, nothing else.

function cbDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function renderResetStrip(data) {
  const el = $('#resetWrap');
  if (!el) return;
  const meta = data && data.stats && data.stats.reset_meta;
  if (!meta) { el.innerHTML = ''; return; }

  const startD = new Date(meta.started + 'T00:00:00');
  const days = Array.from({ length: meta.of }, (_, i) => {
    const d = new Date(startD);
    d.setDate(d.getDate() + i);
    return cbDateStr(d);
  });

  let logged = {};
  try {
    logged = await api(`/api/log-range?start=${days[0]}&end=${days[days.length - 1]}`);
  } catch (_) { /* strip still renders, just without the fills */ }

  const today = data.date;
  const doneCount = days.filter(ds => logged[ds]).length;

  if (meta.expired) {
    renderResetDone(el, days, logged, doneCount, meta);
    return;
  }

  const dots = days.map((ds, i) => {
    const isDone = !!logged[ds];
    const isToday = ds === today;
    const isFuture = ds > today;
    const cls = ['reset-dot'];
    if (isDone) cls.push('done');
    if (isToday) cls.push('today');
    if (isFuture && !isDone) cls.push('future');
    return `<div class="${cls.join(' ')}" title="${ds}">${isDone ? '✓' : i + 1}</div>`;
  }).join('');

  const todayDone = !!logged[today];
  const note = todayDone
    ? `Today's logged — that's the whole job. ${meta.days_left > 1 ? `${meta.days_left - 1} to go.` : 'Last day of the reset.'}`
    : `Nothing logged today yet. One meal counts.`;

  el.innerHTML = `
    <div class="reset-strip">
      <div class="reset-strip-top">
        <span class="reset-strip-title">🔁 Reset week · day ${meta.day} of ${meta.of}</span>
        <span class="reset-strip-sub">${doneCount}/${meta.of} days logged</span>
      </div>
      <div class="reset-dots">${dots}</div>
      <div class="reset-strip-note">${note} No deficit this week — you're eating at maintenance on purpose.</div>
    </div>`;
}

// Day 8. The reset is over and the data to choose with now exists, so ask.
function renderResetDone(el, days, logged, doneCount, meta) {
  const loggedDays = days.filter(ds => logged[ds]);
  const avgKcal = loggedDays.length
    ? Math.round(loggedDays.reduce((a, ds) => a + logged[ds].kcal, 0) / loggedDays.length)
    : null;
  const avgProtein = loggedDays.length
    ? Math.round(loggedDays.reduce((a, ds) => a + logged[ds].protein, 0) / loggedDays.length)
    : null;

  const verdict = doneCount >= 5
    ? `${doneCount} of ${meta.of} days logged. The habit's back — that was the point.`
    : doneCount >= 2
    ? `${doneCount} of ${meta.of} days logged. Not perfect, but you're logging again, which is more than a week ago.`
    : `You logged ${doneCount} ${doneCount === 1 ? 'day' : 'days'}. That's a slow start — worth picking the gentlest option below rather than a hard cut.`;

  el.innerHTML = `
    <div class="reset-done">
      <div class="reset-done-hd">🔁 Reset week's done</div>
      <p>${verdict}</p>
      <div class="reset-done-stats">
        <div class="reset-done-stat"><div class="reset-done-num">${doneCount}/${meta.of}</div><div class="reset-done-lbl">days logged</div></div>
        ${avgKcal ? `<div class="reset-done-stat"><div class="reset-done-num">${avgKcal.toLocaleString()}</div><div class="reset-done-lbl">avg kcal</div></div>` : ''}
        ${avgProtein ? `<div class="reset-done-stat"><div class="reset-done-num">${avgProtein}g</div><div class="reset-done-lbl">avg protein</div></div>` : ''}
      </div>
      <p>Now you can pick a goal against real numbers instead of a guess.</p>
      <div class="cb-cards" id="resetGoalPick">
        ${CB_INTENTS.filter(o => o.id !== 'reset').map(o => `
          <button class="cb-card-option" data-id="${o.id}">
            <span class="cb-card-emoji">${o.emoji}</span>
            <div class="cb-card-text">
              <div class="cb-card-name">${o.name}</div>
              <div class="cb-card-desc">${o.desc}</div>
            </div>
          </button>`).join('')}
      </div>
    </div>`;

  $$('#resetGoalPick .cb-card-option').forEach(btn => btn.addEventListener('click', async () => {
    btn.classList.add('active');
    await api('/api/profile', { method: 'POST', body: { goal: btn.dataset.id } });
    showToast('Goal set — targets updated');
    loadToday();
  }));
}

// Swap a section label for its re-entry wording while a reset week is running. The
// one-tap paths already existed; someone coming back just doesn't remember they did.
function cbReEntryLabel(normal, reEntry) {
  const meta = state && state.today && state.today.stats && state.today.stats.reset_meta;
  return meta && !meta.expired ? reEntry : normal;
}

// A stretch of empty chart after a break isn't a result — it's an absence, and the
// two shouldn't look alike. Where there IS older data, offer the way back to it.
function cbEmptyState(fallbackHtml) {
  if (!comebackInfo || !comebackInfo.last_logged || comebackInfo.gap_days < 7) return fallbackHtml;
  const last = comebackInfo.last_logged;
  const d = new Date(last + 'T00:00:00');
  const monthName = d.toLocaleDateString([], { month: 'long', year: 'numeric' });
  return `<div class="gap-empty">
      <strong>Nothing here yet — you're just getting started again</strong>
      This window covers your break, so there's nothing to chart. Your last logged day was ${cbFmtDate(last)}.
      <br/><button class="gap-empty-link" onclick="cbJumpToMonth('${last}')">Show ${monthName} instead →</button>
    </div>`;
}

// Point the History calendar at the month holding the user's last real data.
function cbJumpToMonth(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (typeof calYear === 'undefined') return;
  calYear = d.getFullYear();
  calMonth = d.getMonth();
  if (typeof renderCalendar === 'function') loadHistory();
  const card = document.getElementById('calendarCard');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
