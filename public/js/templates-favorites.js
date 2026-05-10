// ---------- TEMPLATES ----------
async function loadTemplates() {
  const wrap = $('#templateWrap');
  if (!wrap) return;
  const templates = await api('/api/templates');
  if (!templates.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">My templates</div>
    <div class="template-pills">` +
    templates.map(t => `
      <button class="template-pill" data-id="${t.id}">
        <span class="tp-name">${escapeHtml(t.name)}</span>
        <span class="tp-meta">${t.totals.kcal} kcal · ${t.items.length} item${t.items.length !== 1 ? 's' : ''}</span>
      </button>
    `).join('') + `</div>`;
  $$('.template-pill').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.id;
    const result = await api(`/api/log-template/${id}`, { method: 'POST', body: {} });
    const tmpl = templates.find(t => t.id === id);
    showToast(`Logged ${result.logged} items from "${tmpl?.name || 'template'}"`);
    loadToday();
  }));
}

async function loadMyTemplates() {
  const el = $('#myTemplatesList');
  if (!el) return;
  const templates = await api('/api/templates');
  if (!templates.length) {
    el.innerHTML = '<span style="color:var(--text-dim);">No templates yet. After parsing a meal, click "Save as template" to create one.</span>';
    return;
  }
  el.innerHTML = templates.map(t => `
    <div class="template-item-row">
      <div>
        <span>${escapeHtml(t.name)}</span>
        <span style="color:var(--text-dim);font-size:11px;margin-left:8px;">${t.totals.kcal} kcal · ${t.items.length} items</span>
      </div>
      <div style="display:flex;gap:6px;">
        <button onclick="renameTemplate('${t.id}','${escapeHtml(t.name).replace(/'/g,"&#39;")}')" style="font-size:11px;padding:2px 8px;background:none;border:1px solid var(--border);color:var(--text-dim);border-radius:4px;cursor:pointer;">Rename</button>
        <button onclick="deleteTemplate('${t.id}')" style="font-size:11px;padding:2px 8px;background:none;border:1px solid var(--border);color:var(--text-dim);border-radius:4px;cursor:pointer;">Remove</button>
      </div>
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
async function loadFavorites() {
  const wrap = $('#favWrap');
  const favs = await api('/api/favorites');
  if (!favs.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Frequent foods</div>
    <div class="fav-pills">` +
    favs.map(f => `
      <button class="fav-pill" data-fav='${JSON.stringify(f).replace(/'/g, "&apos;")}'>
        <span class="fp-name">${escapeHtml(f.name)}</span>
        <span class="fp-meta">${f.last_kcal || f.kcal} kcal · ${f.last_protein || f.protein}g P</span>
      </button>
    `).join('') + `</div>`;
  $$('.fav-pill').forEach(btn => btn.addEventListener('click', () => {
    const f = JSON.parse(btn.dataset.fav.replace(/&apos;/g, "'"));
    openFavPopup(f);
  }));
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

  $('#favLogLast').addEventListener('click', async () => {
    await api('/api/log', { method: 'POST', body: {
      name: f.name, kcal: f.last_kcal, protein: f.last_protein,
      fat: f.last_fat || 0, carb: f.last_carb || 0, fiber: f.last_fiber || 0, source: 'manual'
    }});
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
      await api('/api/log', { method: 'POST', body: {
        name: text.slice(0, 200),
        kcal: data.totals.kcal, protein: data.totals.protein,
        fat: data.totals.fat || 0, carb: data.totals.carb || 0, fiber: data.totals.fiber || 0,
        source: data.items[0]?.source || 'ai-estimate', items: data.items
      }});
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
