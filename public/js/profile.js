// ---------- THEME PICKER ----------
const THEMES = [
  { id: 'night', name: 'Night', tag: 'Deep slate dark, emerald accent', swatch: ['#0a0e14', '#10b981', '#f4f6fa'] },
  { id: 'day',   name: 'Day',   tag: 'Fresh greens, kale + teal',       swatch: ['#f1f5ee', '#16a34a', '#14271c'] }
];
const DEFAULT_THEME = 'night';
const THEME_IDS = new Set(THEMES.map(t => t.id));

function getTheme() {
  try {
    const stored = localStorage.getItem('theme');
    return stored && THEME_IDS.has(stored) ? stored : DEFAULT_THEME;
  } catch { return DEFAULT_THEME; }
}
function setTheme(id) {
  if (!THEME_IDS.has(id)) id = DEFAULT_THEME;
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem('theme', id); } catch { /* private mode — selection won't persist */ }
  if (typeof renderThemePicker === 'function') renderThemePicker();
  if (typeof renderThemeToggle === 'function') renderThemeToggle();
}

function toggleTheme() {
  setTheme(getTheme() === 'night' ? 'day' : 'night');
}

function renderThemeToggle() {
  const btn = $('#themeToggle');
  if (!btn) return;
  // Two SVGs (sun + moon) live inside the button; CSS shows the right one via [data-theme] on <html>.
  // We just keep the aria-label / title in sync so screen readers know what'll happen.
  const cur = getTheme();
  const next = cur === 'night' ? 'Day' : 'Night';
  btn.setAttribute('aria-label', `Switch to ${next} theme`);
  btn.title = `Switch to ${next}`;
}

function renderThemePicker() {
  const host = $('#themePicker');
  if (!host) return;
  const current = getTheme();
  host.innerHTML = THEMES.map(t => `
    <button class="theme-option ${t.id === current ? 'active' : ''}" data-theme="${t.id}" type="button">
      <span class="theme-swatch" aria-hidden="true">
        ${t.swatch.map(c => `<span style="background:${c};"></span>`).join('')}
      </span>
      <span>
        <span class="t-name">${t.name}</span>
        <span class="t-tag">${t.tag}</span>
      </span>
    </button>
  `).join('');
  host.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });
}

// ---------- PROFILE ----------
async function loadProfile() {
  const data = await api('/api/profile');
  state.profile = data.profile;
  state.stats = data.stats;
  loadMyFoods();
  loadMyTemplates();
  renderCalibrate();
  renderBackupRestore();
  renderThemePicker();

  // Populate dropdowns
  $('#pActivity').innerHTML = Object.entries(data.activity_options).map(([k, v]) =>
    `<option value="${k}">${v.label} — ${v.desc}</option>`).join('');
  $('#pGoal').innerHTML = Object.entries(data.goal_options).map(([k, v]) =>
    `<option value="${k}">${v.label} — ${v.desc}</option>`).join('');

  if (data.profile) {
    $('#pHeight').value = data.profile.height_cm || '';
    $('#pWeight').value = data.profile.weight_kg ? round1(data.profile.weight_kg) : '';
    $('#pAge').value = data.profile.age || '';
    $('#pSex').value = data.profile.sex || 'male';
    $('#pActivity').value = data.profile.activity || 'moderate';
    $('#pGoal').value = data.profile.goal || 'steady';
    $('#pGoalWeight').value = data.profile.goal_weight_kg || '';
  }
  renderExplainer();
}

function renderExplainer() {
  if (!state.stats) { $('#profileExplainer').innerHTML = ''; return; }
  const s = state.stats;
  const source = s.target_source === 'saved_override' ? 'Saved maintenance override' : 'Profile formula';
  const date = s.override_set_at ? `Saved on ${escapeHtml(s.override_set_at)}.` : 'Original save date is unknown.';
  $('#profileExplainer').innerHTML = `
    <div class="card goal-summary">
      <h2>Your target · ${escapeHtml(GoalPolicy.LABELS[s.goal] || s.goal_meta.label)}</h2>
      <div class="wr-stat-grid">
        <div class="wr-stat"><div class="wr-num">${s.kcal_goal.toLocaleString()}</div><div class="wr-lbl">kcal daily target</div></div>
        <div class="wr-stat"><div class="wr-num">${s.protein_g} g</div><div class="wr-lbl">protein reference</div></div>
        <div class="wr-stat"><div class="wr-num">${s.tdee.toLocaleString()}</div><div class="wr-lbl">active maintenance estimate</div></div>
      </div>
      <p>${escapeHtml(s.explainer)}</p>
      <p class="goal-note"><strong>${source}</strong> · formula ${s.tdee_predicted.toLocaleString()} kcal${s.tdee_calibrated ? ` · ${date}` : ''}</p>
      ${s.tdee_calibrated && s.override_review ? '<p class="goal-note goal-warn">This override may be out of date. Worth a review.</p>' : ''}
      <p class="goal-note">${s.goal_started ? `Goal since ${escapeHtml(s.goal_started)}. Days before that aren't scored.` : 'Goal history starts from your next save.'}</p>
    </div>
    <div class="card" id="calibrateCard"></div>`;
  renderCalibrate();
}

async function renderCalibrate() {
  const card = $('#calibrateCard');
  if (!card) return;
  card.innerHTML = '<h2>Review maintenance estimate</h2><div class="empty">Loading…</div>';
  let r;
  try { r = await api('/api/calibrate'); } catch (_) {
    card.innerHTML = '<h2>Review maintenance estimate</h2><p>Could not load the records. Try again later.</p>'; return;
  }
  const reset = r.calibrated ? `<button class="btn btn-secondary" id="tdeeReset">Reset to formula (${r.tdee_predicted.toLocaleString()} kcal)</button>` : '';
  card.innerHTML = `<h2>Review maintenance estimate</h2>
    <p class="goal-note">From up to 42 days of food and weight on your current goal. Today isn't counted.</p>
    <p>Active estimate: <strong>${r.tdee_current?.toLocaleString() || '—'} kcal</strong> · Formula: ${r.tdee_predicted?.toLocaleString() || '—'} kcal</p>
    ${r.can_calibrate ? `
      <p>Recent records suggest approximately <strong>${r.tdee_implied.toLocaleString()} kcal</strong> for maintenance.</p>
      <p class="goal-note">${r.weight_start_date} → ${r.weight_end_date}: ${r.days_logged}/${r.days_span} days with food entries, ${r.avg_kcal.toLocaleString()} kcal average on logged days. Weight: ${r.weight_start} → ${r.weight_end} kg.</p>
      <p class="goal-note">${escapeHtml(r.caveat)}</p>
      <label class="calibration-confirm"><input type="checkbox" id="calibrationConfirm"> I’ve reviewed this period’s food logs for omitted meals.</label>
      <button class="btn" id="tdeeUse" disabled>Use ${r.tdee_implied.toLocaleString()} kcal as maintenance</button>
    ` : `<p>${escapeHtml(r.reason || 'Not enough recent data to recalibrate.')}</p>`}
    ${reset}`;
  const apply = $('#tdeeUse');
  if (apply) {
    $('#calibrationConfirm').addEventListener('change', e => { apply.disabled = !e.target.checked; });
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      try {
        const saved = await api('/api/profile', { method: 'POST', body: { tdee_override: r.tdee_implied } });
        if (saved.error) throw new Error(saved.error);
        showToast('Maintenance estimate updated'); await loadProfile();
      } catch (e) { showToast(e.message || 'Could not save'); apply.disabled = false; }
    });
  }
  if ($('#tdeeReset')) $('#tdeeReset').addEventListener('click', async () => {
    const saved = await api('/api/profile', { method: 'POST', body: { tdee_override: null } });
    if (saved.error) return showToast(saved.error);
    showToast('Using the profile formula'); loadProfile();
  });
}

async function loadMyFoods() {
  const customs = await api('/api/custom-foods');
  const el = $('#myFoodsList');
  const keys = Object.keys(customs || {});
  if (!keys.length) {
    el.innerHTML = '<p class="pf-empty">None yet. In a meal review, tap a food and choose Save as my food.</p>';
    return;
  }
  el.innerHTML = keys.map(k => {
    const f = customs[k];
    return `<div class="pf-row">
      <div class="pf-row-text">
        <span class="pf-row-name">${escapeHtml(f.name)}</span>
        <span class="pf-row-meta">${f.kcal} kcal · ${f.protein}g P${(f.fat || f.carb || f.fiber) ? ` · ${f.fat||0}g F · ${f.carb||0}g C · ${f.fiber||0}g Fib` : ''}</span>
      </div>
      <button class="pf-row-btn" type="button" onclick="deleteCustomFood('${escapeHtml(k)}')">Remove</button>
    </div>`;
  }).join('');
}

async function deleteCustomFood(key) {
  if (!confirm('Remove this food from your library?')) return;
  await api(`/api/custom-foods/${encodeURIComponent(key)}`, { method: 'DELETE' });
  loadMyFoods();
}

$('#profileSave').addEventListener('click', async () => {
  const gwRaw = $('#pGoalWeight').value;
  const profile = {
    height_cm: Number($('#pHeight').value),
    weight_kg: Number($('#pWeight').value),
    age: Number($('#pAge').value),
    sex: $('#pSex').value,
    activity: $('#pActivity').value,
    goal: $('#pGoal').value,
    goal_weight_kg: gwRaw === '' ? null : Number(gwRaw)
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

// ---------- Backup / Restore ----------
const BACKUP_FILE_KEYS = ['log', 'profile', 'weight', 'templates', 'water', 'custom_foods'];

function renderBackupRestore() {
  const card = $('#backupRestoreCard');
  if (!card) return;
  card.innerHTML = `
    <div class="pf-head"><h2>Backup and restore</h2><span>Export or import your data</span></div>
    <p class="pf-text">Download everything (meals, weights, profile, templates) as one JSON file to keep somewhere safe.</p>
    <div class="pf-actions">
      <button class="btn btn-secondary" id="backupExport" type="button">Download backup (.json)</button>
      <a class="btn btn-secondary" href="/api/export/csv" download>Download meals (.csv)</a>
    </div>

    <hr class="pf-rule">

    <div class="pf-text">
      <strong>Restore or migrate</strong> from a backup file or your old desktop app.
      <ul class="pf-ul">
        <li><strong>Backup file</strong> (from this app): select the single <code>calories-backup-*.json</code> file.</li>
        <li><strong>Old Electron data</strong>: navigate to <code>%APPDATA%\\Calories\\data\\</code> (Windows) and select <code>log.json</code>, <code>profile.json</code>, <code>weight.json</code>, <code>templates.json</code>, <code>water.json</code>, <code>custom_foods.json</code> — pick all that exist with Ctrl-click.</li>
      </ul>
    </div>

    <div class="field">
      <label>Files to import</label>
      <input type="file" id="restoreFiles" multiple accept=".json,application/json" />
    </div>
    <div class="field">
      <label class="pf-radio">
        <input type="radio" name="restoreMode" value="replace" checked /> Replace everything (first migration)
      </label>
      <label class="pf-radio">
        <input type="radio" name="restoreMode" value="merge" /> Merge, keeping what you have (second device)
      </label>
    </div>
    <div id="restorePreview" class="pf-preview"></div>
    <button class="btn" id="backupImport" type="button" disabled>Import</button>
  `;

  $('#backupExport').addEventListener('click', () => {
    // Trigger a real file download via a regular link
    const a = document.createElement('a');
    a.href = '/api/export/json';
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  const fileInput = $('#restoreFiles');
  let stagedBundle = null;
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) { stagedBundle = null; $('#restorePreview').textContent = ''; $('#backupImport').disabled = true; return; }
    stagedBundle = {};
    const summary = [];
    for (const f of files) {
      try {
        const txt = await f.text();
        const parsed = JSON.parse(txt);
        // Detect bundle vs individual file by name
        const baseName = f.name.toLowerCase().replace(/\.json$/, '');
        if (baseName.startsWith('calories-backup')) {
          // Single bundle exported from this app
          for (const k of BACKUP_FILE_KEYS) {
            if (parsed[k] !== undefined) {
              stagedBundle[k] = parsed[k];
              summary.push(`${k} ✓ (from bundle)`);
            }
          }
        } else if (BACKUP_FILE_KEYS.includes(baseName)) {
          stagedBundle[baseName] = parsed;
          summary.push(`${baseName}.json ✓`);
        } else {
          summary.push(`${f.name} — skipped (unknown file)`);
        }
      } catch (e) {
        summary.push(`${f.name} — invalid JSON (skipped)`);
      }
    }
    $('#restorePreview').innerHTML = summary.map(s => `<div>· ${escapeHtml(s)}</div>`).join('');
    $('#backupImport').disabled = !Object.keys(stagedBundle).length;
  });

  $('#backupImport').addEventListener('click', async () => {
    if (!stagedBundle) return;
    const mode = document.querySelector('input[name="restoreMode"]:checked').value;
    if (mode === 'replace' && !confirm('Replace mode will OVERWRITE your current cloud data with the files you selected. Continue?')) return;
    $('#backupImport').disabled = true;
    $('#backupImport').textContent = 'Importing…';
    try {
      const res = await api('/api/import', { method: 'POST', body: { ...stagedBundle, mode } });
      showToast(`Imported: ${res.written.join(', ')}`);
      stagedBundle = null;
      fileInput.value = '';
      $('#restorePreview').textContent = '';
      $('#backupImport').textContent = 'Import';
      // Reload everything to reflect new data
      loadProfile();
      if (typeof loadToday === 'function') loadToday();
    } catch (e) {
      showToast('Import failed: ' + e.message);
      $('#backupImport').disabled = false;
      $('#backupImport').textContent = 'Import';
    }
  });
}
