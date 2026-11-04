// ---------- TEMPLATES ----------
// Templates and frequent foods share one scrolling row of one-tap chips on Today.
// While a reset week runs, a short label reminds a returning user these still exist.
function renderQuickLabel() {
  const label = $('#quickLabel');
  if (!label) return;
  const text = cbReEntryLabel('', 'What you used to eat. One tap, no AI call.');
  const hasChips = !!document.querySelector('#quickRow .quick-chip');
  label.textContent = text;
  label.classList.toggle('hidden', !text || !hasChips);
}

async function loadTemplates() {
  const wrap = $('#templateWrap');
  if (!wrap) return;
  const templates = await api('/api/templates');
  wrap.innerHTML = templates.map(t => `
    <button class="quick-chip" type="button" data-id="${t.id}" title="Template · ${t.items.length} item${t.items.length !== 1 ? 's' : ''}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/></svg>
      <span class="qc-name">${escapeHtml(t.name)}</span>
      <span class="qc-kcal">${t.totals.kcal}</span>
    </button>
  `).join('');
  wrap.querySelectorAll('.quick-chip').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.id;
    const date = typeof todayViewDate !== 'undefined' && todayViewDate ? `?date=${todayViewDate}` : '';
    const result = await api(`/api/log-template/${id}${date}`, { method: 'POST', body: {} });
    const tmpl = templates.find(t => t.id === id);
    showToast(`Logged ${result.logged} items from "${tmpl?.name || 'template'}"`);
    loadToday();
  }));
  renderQuickLabel();
}

async function loadMyTemplates() {
  const el = $('#myTemplatesList');
  if (!el) return;
  const templates = await api('/api/templates');
  if (!templates.length) {
    el.innerHTML = '<p class="pf-empty">None yet. In a meal review, tap + Template to save one.</p>';
    return;
  }
  el.innerHTML = templates.map(t => `
    <div class="pf-row">
      <div class="pf-row-text">
        <span class="pf-row-name">${escapeHtml(t.name)}</span>
        <span class="pf-row-meta">${t.totals.kcal} kcal · ${t.items.length} item${t.items.length === 1 ? '' : 's'}</span>
      </div>
      <button class="pf-row-btn" type="button" onclick="renameTemplate('${t.id}','${escapeHtml(t.name).replace(/'/g,"&#39;")}')">Rename</button>
      <button class="pf-row-btn" type="button" onclick="deleteTemplate('${t.id}')">Remove</button>
    </div>
  `).join('');
}

async function renameTemplate(id, currentName) {
  const name = prompt('Rename template:', currentName);
  if (!name || !name.trim()) return;
  await api(`/api/templates/${id}`, { method: 'PATCH', body: { name: name.trim() } });
  loadMyTemplates();
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  await api(`/api/templates/${id}`, { method: 'DELETE' });
  loadMyTemplates();
  loadTemplates();
}

// ---------- FAVORITES ----------
// One tap logs the food exactly as last time, with an Undo. Right-click or long-press
// opens the popup for changing the amount or re-parsing.
async function loadFavorites() {
  const wrap = $('#favWrap');
  const favs = await api('/api/favorites');
  wrap.innerHTML = favs.map((f, i) => `
    <button class="quick-chip" type="button" data-fav-idx="${i}" title="Log as last time · long-press to edit">
      <span class="qc-name">${escapeHtml(f.name)}</span>
      <span class="qc-kcal">${f.last_kcal || f.kcal}</span>
    </button>
  `).join('');
  wrap.querySelectorAll('.quick-chip').forEach(btn => {
    const f = favs[Number(btn.dataset.favIdx)];
    btn.addEventListener('click', () => logFavorite(f, btn));
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openFavPopup(f); });
  });
  renderQuickLabel();
}

async function logFavorite(f, btn) {
  const date = typeof todayViewDate !== 'undefined' ? todayViewDate : null;
  // Not passing btn to logMeal: it would swap the chip's markup for "Saving…" text.
  btn.disabled = true;
  const res = await logMeal({
    name: f.name, kcal: f.last_kcal, protein: f.last_protein,
    fat: f.last_fat || 0, carb: f.last_carb || 0, fiber: f.last_fiber || 0, source: 'manual',
    ...(date ? { date } : {})
  });
  btn.disabled = false;
  if (!res || !res.entry) return;
  loadToday();
  const day = date || fmtDate(new Date());
  showUndoToast(`Logged: ${f.name.slice(0, 40)}`, async () => {
    await fetch(`/api/log/${day}/${res.entry.id}`, { method: 'DELETE' });
    loadToday();
  });
}

function openFavPopup(f) {
  // Remove existing popup if any
  const existing = $('#favPopupBg');
  if (existing) existing.remove();

  const bg = document.createElement('div');
  bg.className = 'fav-popup-bg';
  bg.id = 'favPopupBg';
  bg.innerHTML = `
    <div class="fav-popup">
      <h3>${escapeHtml(f.name)}</h3>
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:10px;">Last logged: ${f.last_kcal} kcal · ${f.last_protein}g P${f.last_fat ? ' · ' + f.last_fat + 'g F' : ''}${f.last_carb ? ' · ' + f.last_carb + 'g C' : ''}${f.last_fiber ? ' · ' + f.last_fiber + 'g Fib' : ''}</div>
      <div class="field">
        <label>Edit amount / description</label>
        <input id="favPopupText" value="${escapeHtml(f.last_text || f.name)}" />
      </div>
      <div class="fav-popup-btns">
        <button class="btn" style="flex:1;" id="favLogLast">Log as last time</button>
        <button class="btn btn-secondary" id="favReparse">Re-parse</button>
        <button class="modal-close" id="favPopupClose">×</button>
      </div>
    </div>
  `;
  document.body.appendChild(bg);

  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  $('#favPopupClose').addEventListener('click', () => bg.remove());

  $('#favLogLast').addEventListener('click', async (ev) => {
    const res = await logMeal({
      name: f.name, kcal: f.last_kcal, protein: f.last_protein,
      fat: f.last_fat || 0, carb: f.last_carb || 0, fiber: f.last_fiber || 0, source: 'manual'
    }, ev.currentTarget);
    if (!res) return;
    bg.remove();
    showToast(`Logged: ${f.name}`);
    loadToday();
  });

  $('#favReparse').addEventListener('click', async () => {
    const text = $('#favPopupText').value.trim();
    if (!text) return;
    const btn = $('#favReparse');
    btn.disabled = true; btn.textContent = '…';
    try {
      const data = await api('/api/parse', { method: 'POST', body: { text } });
      if (data.error || !data.items?.length) { showToast('Could not parse — try being more specific'); return; }
      const logged = await logMeal({
        name: text.slice(0, 200),
        kcal: data.totals.kcal, protein: data.totals.protein,
        fat: data.totals.fat || 0, carb: data.totals.carb || 0, fiber: data.totals.fiber || 0,
        source: data.items[0]?.source || 'ai-estimate', items: data.items
      });
      if (!logged) return;
      bg.remove();
      showToast(`Logged: ${text}`);
      loadToday();
    } catch (e) {
      showToast('Parse failed: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Re-parse';
    }
  });
}
