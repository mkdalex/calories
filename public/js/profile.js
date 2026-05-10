// ---------- PROFILE ----------
async function loadProfile() {
  const data = await api('/api/profile');
  state.profile = data.profile;
  state.stats = data.stats;
  loadMyFoods();
  loadMyTemplates();
  renderCalibrate();

  // Populate dropdowns
  $('#pActivity').innerHTML = Object.entries(data.activity_options).map(([k, v]) =>
    `<option value="${k}">${v.label} — ${v.desc}</option>`).join('');
  $('#pGoal').innerHTML = Object.entries(data.goal_options).map(([k, v]) =>
    `<option value="${k}">${v.label} — ${v.desc}</option>`).join('');

  if (data.profile) {
    $('#pHeight').value = data.profile.height_cm || '';
    $('#pWeight').value = data.profile.weight_kg || '';
    $('#pAge').value = data.profile.age || '';
    $('#pSex').value = data.profile.sex || 'male';
    $('#pActivity').value = data.profile.activity || 'moderate';
    $('#pGoal').value = data.profile.goal || 'steady';
  }
  renderExplainer();
}

function renderExplainer() {
  if (!state.stats) {
    $('#profileExplainer').innerHTML = '';
    return;
  }
  const tdeeBadge = state.stats.tdee_calibrated
    ? `<span style="font-size:10px;background:rgba(74,222,128,0.15);color:var(--accent);padding:1px 6px;border-radius:4px;margin-left:6px;vertical-align:middle;">CALIBRATED</span>`
    : '';
  $('#profileExplainer').innerHTML = `
    <div class="card">
      <h2>Your numbers</h2>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 12px;">
        <div><div style="color: var(--text-dim); font-size: 12px;"><span class="gloss" data-tip="${GLOSSARY.BMR}">BMR</span></div><div style="font-size: 22px; font-weight: 600;">${state.stats.bmr.toLocaleString()}</div></div>
        <div><div style="color: var(--text-dim); font-size: 12px;"><span class="gloss" data-tip="${GLOSSARY.TDEE}">TDEE</span>${tdeeBadge}</div><div style="font-size: 22px; font-weight: 600;">${state.stats.tdee.toLocaleString()}</div></div>
        <div><div style="color: var(--text-dim); font-size: 12px;">Daily goal</div><div style="font-size: 22px; font-weight: 600; color: var(--accent);">${state.stats.kcal_goal.toLocaleString()}</div></div>
        <div><div style="color: var(--text-dim); font-size: 12px;">Protein</div><div style="font-size: 22px; font-weight: 600;">${state.stats.protein_g}g</div></div>
      </div>
      <div class="narrative">${glossify(state.stats.explainer)}</div>
    </div>
    <div class="card" id="calibrateCard"></div>
    <div class="card">
      <h2>How this works</h2>
      <div class="edu-card" style="margin-top: 0;">${EDU_PROTEIN_HTML}</div>
    </div>
  `;
  renderCalibrate();
}

async function renderCalibrate() {
  const card = $('#calibrateCard');
  if (!card) return;
  card.innerHTML = `<h2>TDEE reality check</h2><div style="color:var(--text-dim);font-size:13px;padding:6px 0;">Loading…</div>`;
  let r;
  try { r = await api('/api/calibrate'); } catch (e) { card.innerHTML = `<h2>TDEE reality check</h2><div class="empty">Error loading.</div>`; return; }
  const intro = `<div style="color:var(--text-dim);font-size:12px;margin-bottom:8px;line-height:1.5;">Compares your <span class="gloss" data-tip="${GLOSSARY.TDEE}">TDEE</span> formula against what your real weight + log data implies. Adjust the formula if reality says otherwise.</div>`;
  if (!r.can_calibrate) {
    const resetBtn = r.calibrated ? `<button class="btn btn-secondary" id="tdeeReset" style="margin-top:8px;font-size:13px;padding:8px 14px;">Reset to predicted (${r.tdee_predicted})</button>` : '';
    card.innerHTML = `<h2>TDEE reality check</h2>${intro}<div style="color:var(--text-dim);font-size:13px;">${escapeHtml(r.reason)}</div>${resetBtn}`;
    if (resetBtn) {
      $('#tdeeReset').addEventListener('click', async () => {
        await api('/api/profile', { method: 'POST', body: { tdee_override: null } });
        showToast('TDEE reset to predicted');
        loadProfile();
      });
    }
    return;
  }
  const diff = r.diff;
  const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
  const diffColor = Math.abs(diff) < 50 ? 'var(--accent)' : Math.abs(diff) < 150 ? 'var(--warn)' : 'var(--danger)';
  const verdict = Math.abs(diff) < 50
    ? `<span style="color:var(--accent);font-weight:600;">Your formula is on point.</span> Real-world data lines up with the prediction.`
    : diff > 0
    ? `<span style="color:var(--warn);font-weight:600;">Your real TDEE looks higher.</span> You're burning ~${diff} kcal/day more than predicted — you can eat that much more and still hit your goal.`
    : `<span style="color:var(--warn);font-weight:600;">Your real TDEE looks lower.</span> You're burning ~${Math.abs(diff)} kcal/day less than predicted — current goal will lose weight slower than expected.`;

  const wDelta = r.weight_delta_kg;
  const wDeltaStr = wDelta < 0 ? `−${Math.abs(wDelta)}` : wDelta > 0 ? `+${wDelta}` : '0';
  const wColor = wDelta < 0 ? 'var(--accent)' : wDelta > 0 ? 'var(--danger)' : 'var(--text-dim)';

  card.innerHTML = `
    <h2>TDEE reality check</h2>
    ${intro}
    <div class="calibrate-grid">
      <div class="cal-stat"><div class="cal-num">${r.tdee_predicted.toLocaleString()}</div><div class="cal-lbl">predicted</div></div>
      <div class="cal-stat"><div class="cal-num" style="color:${diffColor};">${r.tdee_implied.toLocaleString()}</div><div class="cal-lbl">implied</div></div>
      <div class="cal-stat"><div class="cal-num" style="color:${diffColor};">${diffStr}</div><div class="cal-lbl">diff</div></div>
    </div>
    <div style="font-size:13px;margin:10px 0;line-height:1.5;">${verdict}</div>
    <div style="font-size:12px;color:var(--text-dim);line-height:1.5;">
      Based on <strong style="color:var(--text);">${r.days_logged} logged days</strong> over ${r.days_span} days,
      averaging <strong style="color:var(--text);">${r.avg_kcal.toLocaleString()} kcal/day</strong>,
      weight <strong style="color:${wColor};">${wDeltaStr} kg</strong> (${r.weight_start} → ${r.weight_end} kg).
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
      ${Math.abs(diff) >= 50 ? `<button class="btn" id="tdeeUse" style="font-size:13px;padding:10px 16px;">Use ${r.tdee_implied.toLocaleString()} as my TDEE</button>` : ''}
      ${r.calibrated ? `<button class="btn btn-secondary" id="tdeeReset" style="font-size:13px;padding:10px 16px;">Reset to predicted</button>` : ''}
    </div>
  `;
  if ($('#tdeeUse')) {
    $('#tdeeUse').addEventListener('click', async () => {
      await api('/api/profile', { method: 'POST', body: { tdee_override: r.tdee_implied } });
      showToast(`TDEE set to ${r.tdee_implied.toLocaleString()}`);
      loadProfile();
    });
  }
  if ($('#tdeeReset')) {
    $('#tdeeReset').addEventListener('click', async () => {
      await api('/api/profile', { method: 'POST', body: { tdee_override: null } });
      showToast('TDEE reset to predicted');
      loadProfile();
    });
  }
}

async function loadMyFoods() {
  const customs = await api('/api/custom-foods');
  const el = $('#myFoodsList');
  const keys = Object.keys(customs || {});
  if (!keys.length) {
    el.innerHTML = '<span style="color:var(--text-dim);">None saved yet. When you correct a food\'s calories, you can save it here for instant recall.</span>';
    return;
  }
  el.innerHTML = keys.map(k => {
    const f = customs[k];
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
      <div>
        <span style="color:var(--text);">${escapeHtml(f.name)}</span>
        <span style="color:var(--text-dim);font-size:11px;margin-left:8px;">${f.kcal} kcal · ${f.protein}g P${(f.fat || f.carb || f.fiber) ? ` · ${f.fat||0}g F · ${f.carb||0}g C · ${f.fiber||0}g Fib` : ''}</span>
      </div>
      <button onclick="deleteCustomFood('${escapeHtml(k)}')" style="font-size:11px;padding:2px 8px;background:none;border:1px solid var(--border);color:var(--text-dim);border-radius:4px;cursor:pointer;">Remove</button>
    </div>`;
  }).join('');
}

async function deleteCustomFood(key) {
  if (!confirm('Remove this food from your library?')) return;
  await api(`/api/custom-foods/${encodeURIComponent(key)}`, { method: 'DELETE' });
  loadMyFoods();
}

$('#profileSave').addEventListener('click', async () => {
  const profile = {
    height_cm: Number($('#pHeight').value),
    weight_kg: Number($('#pWeight').value),
    age: Number($('#pAge').value),
    sex: $('#pSex').value,
    activity: $('#pActivity').value,
    goal: $('#pGoal').value
  };
  if (!profile.height_cm || !profile.weight_kg || !profile.age) {
    return showToast('Fill in height, weight, age');
  }
  const data = await api('/api/profile', { method: 'POST', body: profile });
  state.profile = data.profile;
  state.stats = data.stats;
  renderExplainer();
  showToast('Profile saved');
});
