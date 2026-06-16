// ---------- RESCAN ----------
async function rescanEntry(entry, date, btn) {
  const panel = $(`#rescan-${entry.id}`);
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
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
    btn.textContent = '↻';
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

// ---------- LOG MODAL ----------
let currentLogDate = null;
function openLogModal(date) {
  currentLogDate = date || null;
  const banner = $('#logDateBanner');
  if (banner) {
    if (currentLogDate) {
      const d = new Date(currentLogDate + 'T00:00:00');
      banner.textContent = `Logging to ${d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })} (defaults to 8pm; edit time after via the meal)`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }
  $('#logModal').classList.remove('hidden');
  $('#logText').focus();
  // Warm the meal search index in the background so the very first letter
  // typed has matches ready instantly. No-op if already loaded.
  if (typeof loadMealSearchIndex === 'function') loadMealSearchIndex();
}
function closeLogModal() {
  $('#logModal').classList.add('hidden');
  currentLogDate = null;
  if ($('#logDateBanner')) $('#logDateBanner').classList.add('hidden');
  // Tear down any in-progress AI loader (incl. dino game) so it doesn't keep
  // running invisibly with global key listeners attached.
  clearAILoader($('#parsedItems'));
  // Reset transient pickers so the next open starts clean.
  const ghost = $('#logTextGhost');
  if (ghost) ghost.innerHTML = '';
  const chips = $('#portionChips');
  if (chips) { chips.innerHTML = ''; chips.classList.add('hidden'); }
}
$('#fab').addEventListener('click', () => openLogModal());
$('#logClose').addEventListener('click', closeLogModal);
$('#logModal').addEventListener('click', (e) => {
  if (e.target === $('#logModal')) closeLogModal();
});

// ---------- KEYBOARD SHORTCUTS ----------
document.addEventListener('keydown', (e) => {
  // Close modals
  if (e.key === 'Escape') {
    if (!$('#editModal').classList.contains('hidden')) { closeEditModal(); return; }
    if (!$('#logModal').classList.contains('hidden')) { closeLogModal(); return; }
  }
  // Don't fire nav shortcuts when typing
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'l' || e.key === 'L') { openLogModal(); return; }
  // Number keys 1-5 switch tabs
  const viewMap = { '1': 'today', '2': 'gym', '3': 'history', '4': 'profile', '5': 'dev' };
  if (viewMap[e.key]) {
    const btn = document.querySelector(`.nav button[data-view="${viewMap[e.key]}"]`);
    if (btn) btn.click();
  }
});

// ---------- TYPE-AHEAD (local index, smart ranking, ghost completion) ----------
// The search index is built once per session: one round-trip to fetch
// favourites + customs + templates, then every keystroke runs locally.
// No more 300ms debounce, no more "open the log file on every letter" lag.

let mealSearchIndex = null;
let mealSearchIndexLoading = null;
let currentMatches = [];
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
        // Median is what gets used by default — robust to outlier portions.
        kcal: f.median_kcal ?? f.kcal,
        protein: f.median_protein ?? f.protein,
        fat: f.median_fat ?? 0,
        carb: f.median_carb ?? 0,
        fiber: f.median_fiber ?? 0,
        count: f.count || 0,
        last_date: f.last_date || null,
        portions: f.portions || null
      });
    }
    for (const c of Object.values(customs || {})) {
      items.push({
        source: 'custom',
        name: c.name,
        name_lower: c.name.toLowerCase(),
        kcal: c.kcal || 0, protein: c.protein || 0,
        fat: c.fat || 0, carb: c.carb || 0, fiber: c.fiber || 0,
        count: 0, last_date: null, portions: null
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
        count: 0, last_date: null, portions: null
      });
    }
    mealSearchIndex = items;
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

function updateGhost(typed, suggestion) {
  const ghost = $('#logTextGhost');
  if (!ghost) return;
  if (!typed || !suggestion || suggestion.length === typed.length
      || !suggestion.toLowerCase().startsWith(typed.toLowerCase())) {
    ghost.innerHTML = '';
    return;
  }
  const suffix = suggestion.slice(typed.length);
  ghost.innerHTML = `<span>${escapeHtml(typed)}</span><span class="ghost-suffix">${escapeHtml(suffix)}</span>`;
}

$('#logText').addEventListener('input', () => {
  const text = $('#logText').value;
  const trimmed = text.trim();
  const dd = $('#suggestDropdown');
  if (!trimmed || trimmed.length < 2) {
    dd.classList.add('hidden');
    currentMatches = [];
    currentGhostSuggestion = null;
    updateGhost(text, null);
    return;
  }
  loadMealSearchIndex().then(items => {
    // Textarea may have changed during the await on the very first call.
    const t = $('#logText').value;
    const q = t.trim().toLowerCase().split('\n')[0].slice(0, 60);
    if (q.length < 2) { dd.classList.add('hidden'); return; }
    currentMatches = rankMatches(items, q).slice(0, 6);
    if (!currentMatches.length) {
      dd.classList.add('hidden');
      currentGhostSuggestion = null;
      updateGhost(t, null);
      return;
    }
    dd.classList.remove('hidden');
    dd.innerHTML = currentMatches.map((r, i) => {
      const rel = r.last_date ? ` · ${relDateLabel(r.last_date)}` : '';
      return `
        <div class="suggest-item ${i === 0 ? 'top' : ''}" data-idx="${i}">
          <span class="si-name">${escapeHtml(r.name)}</span>
          <span class="si-meta">${r.kcal} kcal · ${r.protein}g P${rel}</span>
          <span class="si-src">${r.source}</span>
        </div>
      `;
    }).join('');
    dd.querySelectorAll('.suggest-item').forEach(item => {
      // mousedown so we beat the textarea-blur handler that hides the dropdown.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pickSuggestion(currentMatches[Number(item.dataset.idx)]);
      });
    });
    const top = currentMatches[0];
    if (top.name_lower.startsWith(q)) {
      currentGhostSuggestion = top.name;
      updateGhost(t, top.name);
    } else {
      currentGhostSuggestion = null;
      updateGhost(t, null);
    }
  });
});

// Tab on the textarea accepts the ghost suggestion (when one is showing).
// Falls through to normal Tab behaviour otherwise so accessibility stays sane.
$('#logText').addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && currentGhostSuggestion) {
    e.preventDefault();
    $('#logText').value = currentGhostSuggestion;
    currentGhostSuggestion = null;
    updateGhost($('#logText').value, null);
    $('#logText').dispatchEvent(new Event('input', { bubbles: true }));
  }
});

$('#logText').addEventListener('blur', () => {
  setTimeout(() => $('#suggestDropdown').classList.add('hidden'), 200);
});

// User picked a suggestion → fill the textarea, render the parsed view with
// median macros so they can verify + adjust weight + save. Doesn't auto-save,
// except for templates which are an explicit "log this whole combo" action.
function pickSuggestion(r) {
  if (!r) return;
  if (r.source === 'template' && r.template_id) {
    api(`/api/log-template/${r.template_id}`, { method: 'POST', body: {} }).then(res => {
      showToast(`Logged ${res.logged} items from "${r.name}"`);
      closeLogModal();
      loadToday();
    });
    return;
  }
  $('#logText').value = r.name;
  currentGhostSuggestion = null;
  updateGhost(r.name, null);
  $('#suggestDropdown').classList.add('hidden');
  const fakeResult = {
    items: [{ name: r.name, qty: 1, unit: 'serving', kcal: r.kcal, protein: r.protein, fat: r.fat || 0, carb: r.carb || 0, fiber: r.fiber || 0, source: r.source, confidence: 'high' }],
    totals: { kcal: r.kcal, protein: r.protein, fat: r.fat || 0, carb: r.carb || 0, fiber: r.fiber || 0 },
    trace: [], suggested_extras: []
  };
  parsedCache = fakeResult;
  renderParsed(fakeResult);
  renderPortionChips(r);
}

function renderPortionChips(r) {
  const host = $('#portionChips');
  if (!host) return;
  if (!r.portions || r.portions.length < 2) {
    host.innerHTML = '';
    host.classList.add('hidden');
    return;
  }
  host.classList.remove('hidden');
  host.innerHTML = `
    <span class="portion-chip-label">Portion you ate today —</span>
    ${r.portions.map((p, i) => `
      <button class="portion-chip" data-idx="${i}" type="button">
        <span class="pc-kcal">${p.kcal} kcal</span>
        <span class="pc-meta">${p.protein}g P</span>
      </button>
    `).join('')}
  `;
  host.querySelectorAll('.portion-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = r.portions[Number(btn.dataset.idx)];
      const fakeResult = {
        items: [{ name: p.text || r.name, qty: 1, unit: 'serving', kcal: p.kcal, protein: p.protein, fat: p.fat, carb: p.carb, fiber: p.fiber, source: r.source, confidence: 'high' }],
        totals: { kcal: p.kcal, protein: p.protein, fat: p.fat, carb: p.carb, fiber: p.fiber },
        trace: [], suggested_extras: []
      };
      parsedCache = fakeResult;
      renderParsed(fakeResult);
      host.querySelectorAll('.portion-chip').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
}

let parsedCache = null;

// ---------- HISTORY PICKER ----------
function fmtRelDate(ds) {
  if (!ds) return '';
  const d = new Date(ds + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return `${diff}d ago`;
  if (diff < 30) return `${Math.round(diff/7)}w ago`;
  return `${Math.round(diff/30)}mo ago`;
}

$('#logHistory').addEventListener('click', async () => {
  const panel = $('#historyPanel');
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  panel.classList.remove('hidden');
  panel.innerHTML = '<div class="empty" style="padding:12px;">Loading…</div>';
  try {
    const favs = await api('/api/favorites?limit=30&sort=recency');
    if (!favs.length) {
      panel.innerHTML = '<div class="empty" style="padding:12px;">No past meals yet — log a few and they\'ll show up here.</div>';
      return;
    }
    panel.innerHTML = `
      <div class="history-list">
        ${favs.map((f, i) => `
          <div class="history-item" data-idx="${i}">
            <div class="hi-main">
              <span class="hi-name">${escapeHtml(f.last_text || f.name)}</span>
              <span class="hi-meta">${f.last_kcal} kcal · ${round1(f.last_protein)}g P</span>
            </div>
            <div class="hi-sub">
              <span>${f.count}× · ${fmtRelDate(f.last_date)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    panel.querySelectorAll('.history-item').forEach(row => {
      row.addEventListener('click', () => {
        const f = favs[Number(row.dataset.idx)];
        $('#logText').value = f.last_text || f.name;
        panel.classList.add('hidden');
        panel.innerHTML = '';
        const fakeResult = {
          items: [{
            name: f.last_text || f.name, qty: 1, unit: 'serving',
            kcal: f.last_kcal, protein: f.last_protein,
            fat: f.last_fat || 0, carb: f.last_carb || 0, fiber: f.last_fiber || 0,
            source: 'history', confidence: 'high'
          }],
          totals: {
            kcal: f.last_kcal, protein: f.last_protein,
            fat: f.last_fat || 0, carb: f.last_carb || 0, fiber: f.last_fiber || 0
          },
          trace: [], suggested_extras: []
        };
        parsedCache = fakeResult;
        renderParsed(fakeResult);
      });
    });
  } catch (e) {
    panel.innerHTML = `<div class="empty" style="padding:12px;color:var(--danger);">Failed to load: ${escapeHtml(e.message)}</div>`;
  }
});

$('#logParse').addEventListener('click', async () => {
  const text = $('#logText').value.trim();
  if (!text) return;
  $('#logParse').disabled = true;
  $('#logParse').textContent = 'Parsing...';
  showAILoader($('#parsedItems'));
  try {
    const data = await api('/api/parse', { method: 'POST', body: { text } });
    if (data.error) {
      $('#parsedItems').innerHTML = `<div class="empty" style="color: var(--danger);">Error: ${data.error}</div>`;
      return;
    }
    parsedCache = data;
    parsedCache.suggested_extras = data.suggested_extras || [];
    renderParsed(data);
  } catch (e) {
    $('#parsedItems').innerHTML = `<div class="empty" style="color: var(--danger);">${e.message}</div>`;
  } finally {
    $('#logParse').disabled = false;
    $('#logParse').textContent = 'Parse with AI';
  }
});

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

function refreshParsedTotals() {
  if (!parsedCache) return;
  const t = parsedCache.totals;
  const proteinR = round1(t.protein);
  const extras = (t.fat || t.carb || t.fiber) ? ` · ${t.fat||0}g F · ${t.carb||0}g C · ${t.fiber||0}g Fib` : '';
  $('#parsedTotals').innerHTML = `
    <div class="card" style="margin: 0; padding: 12px 14px;">
      <div style="display: flex; justify-content: space-between;">
        <strong>Total</strong>
        <span><strong>${t.kcal} kcal</strong> · ${proteinR}g P${extras}</span>
      </div>
    </div>
  `;
}

function renderParsed(data) {
  const confChip = (conf) => {
    const colors = { high: '#1a7a1a', medium: '#7a5a00', low: '#7a0010' };
    const bg = { high: '#1a3d1a', medium: '#3d2e00', low: '#3d0008' };
    const c = conf || 'medium';
    return `<span class="conf-chip" style="background:${bg[c]};color:${colors[c]};" title="Confidence: ${c}. ${c === 'low' ? 'Rough estimate — consider setting exact value.' : c === 'medium' ? 'Reasonable estimate.' : 'High-quality source.'}">${c.toUpperCase()}</span>`;
  };

  $('#parsedItems').innerHTML = data.items.map((it, i) => `
    <div class="parsed-item" id="pitem-${i}">
      <div class="top">
        <div class="name">${escapeHtml(it.name)} ${confChip(it.confidence)}</div>
        <div class="stats">
          <span class="editable-kcal" data-idx="${i}" title="Click to set exact calories">${it.kcal}</span> kcal · ${it.protein}g P
          ${(it.fat || it.carb || it.fiber) ? `<span style="color:var(--text-dim);font-size:11px;"> · ${it.fat||0}g F · ${it.carb||0}g C · ${it.fiber||0}g Fib</span>` : ''}
        </div>
      </div>
      <div class="meta">
        <span>${it.qty} ${it.unit}</span>
        <span class="badge ${it.isExtra ? 'extra' : it.source}">${it.isExtra ? 'extra' : it.source === 'usda+ai' ? 'USDA' : it.source === 'ai-estimate' ? 'AI' : it.source === 'fatsecret' ? 'FS' : it.source === 'ai-verified' ? 'AI✓' : it.source}</span>
        ${it.confidence !== 'high' ? `<button class="save-custom-btn" data-idx="${i}" data-name="${escapeHtml(it.name)}" data-kcal="${it.kcal}" data-protein="${it.protein}" data-fat="${it.fat||0}" data-carb="${it.carb||0}" data-fiber="${it.fiber||0}" title="Save this value to your personal library — next time you log this food it'll use your number, not an AI guess">Save as my food</button>` : ''}
      </div>
    </div>
  `).join('') + renderTrace(data.trace);

  // Wire editable kcal clicks — patch the changed row + totals instead of rebuilding the whole list
  document.querySelectorAll('.editable-kcal').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.idx);
      const it = parsedCache.items[idx];
      const val = prompt(`Set exact calories for "${it.name}" (currently ${it.kcal}):`, it.kcal);
      if (val === null) return;
      const newKcal = Math.round(Number(val));
      if (isNaN(newKcal) || newKcal <= 0) return;
      parsedCache.items[idx].kcal = newKcal;
      parsedCache.totals.kcal = parsedCache.items.reduce((a, x) => a + x.kcal, 0);
      el.textContent = newKcal;
      refreshParsedTotals();
      if (confirm(`Save "${it.name}" as ${newKcal} kcal for next time?`)) {
        api('/api/custom-foods', { method: 'POST', body: { name: it.name, kcal: newKcal, protein: it.protein, fat: it.fat || 0, carb: it.carb || 0, fiber: it.fiber || 0 } });
      }
    });
  });

  // Wire "Save as my food" buttons
  document.querySelectorAll('.save-custom-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { name, kcal, protein, fat, carb, fiber } = btn.dataset;
      api('/api/custom-foods', { method: 'POST', body: { name, kcal: Number(kcal), protein: Number(protein), fat: Number(fat)||0, carb: Number(carb)||0, fiber: Number(fiber)||0 } })
        .then(() => { btn.textContent = 'Saved!'; btn.disabled = true; });
    });
  });
  refreshParsedTotals();
  $('#parsedSave').innerHTML = `
    <div style="display:flex;gap:8px;">
      <button class="btn" id="parsedSaveBtn" style="flex:1;">Save to today</button>
      <button class="btn btn-secondary" id="parsedSaveTmplBtn" style="padding:10px 14px;white-space:nowrap;">+ Template</button>
    </div>
  `;
  $('#parsedSaveBtn').addEventListener('click', saveParsed);
  $('#parsedSaveTmplBtn').addEventListener('click', async () => {
    const name = prompt('Template name:', $('#logText').value.trim().slice(0, 60) || 'My meal');
    if (!name || !name.trim()) return;
    await api('/api/templates', { method: 'POST', body: {
      name: name.trim(),
      items: parsedCache.items.map(i => ({ name: i.name, kcal: i.kcal, protein: i.protein, fat: i.fat || 0, carb: i.carb || 0, fiber: i.fiber || 0 })),
      totals: parsedCache.totals
    }});
    showToast(`Template "${name.trim()}" saved`);
  });

  const suggestions = (parsedCache && parsedCache.suggested_extras) || [];
  const chipHtml = suggestions.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
        <span style="font-size:12px;color:var(--text-dim);align-self:center;">Did you add:</span>
        ${suggestions.map(s => `<button class="extras-chip" data-val="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}
       </div>`
    : '';
  $('#extrasWrap').innerHTML = `
    ${chipHtml}
    <div style="display:flex;gap:8px;">
      <input id="extrasInput" placeholder="cooking extras? (oil, butter, sauce…)" style="flex:1;font-size:14px;" />
      <button class="btn btn-secondary" id="extrasAdd" style="padding:10px 14px;white-space:nowrap;">+ Add</button>
    </div>
  `;
  $('#extrasAdd').addEventListener('click', addExtras);
  $('#extrasInput').addEventListener('keydown', e => { if (e.key === 'Enter') addExtras(); });
  document.querySelectorAll('.extras-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('#extrasInput').value = chip.dataset.val;
      addExtras();
    });
  });
}

async function addExtras() {
  const text = ($('#extrasInput') && $('#extrasInput').value.trim()) || '';
  if (!text || !parsedCache) return;
  const btn = $('#extrasAdd');
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const data = await api('/api/parse', { method: 'POST', body: { text } });
    if (data.error || !data.items?.length) { showToast('Could not parse that — try being more specific'); return; }
    data.items.forEach(it => { it.isExtra = true; });
    parsedCache.items.push(...data.items);
    parsedCache.trace = [...(parsedCache.trace || []), ...(data.trace || [])];
    // Recompute totals from all items
    parsedCache.totals = parsedCache.items.reduce((a, i) => ({
      kcal: a.kcal + (i.kcal || 0),
      protein: Math.round((a.protein + (i.protein || 0)) * 10) / 10,
      fat: Math.round((a.fat + (i.fat || 0)) * 10) / 10,
      carb: Math.round((a.carb + (i.carb || 0)) * 10) / 10,
      fiber: Math.round((a.fiber + (i.fiber || 0)) * 10) / 10
    }), { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 });
    renderParsed(parsedCache);
  } catch (e) {
    showToast('Failed to add extra: ' + e.message);
  } finally {
    if ($('#extrasAdd')) { $('#extrasAdd').disabled = false; $('#extrasAdd').textContent = '+ Add'; }
  }
}

async function saveParsed() {
  if (!parsedCache) return;
  const body = {
    name: $('#logText').value.trim().slice(0, 200),
    kcal: parsedCache.totals.kcal,
    protein: parsedCache.totals.protein,
    fat: parsedCache.totals.fat || 0,
    carb: parsedCache.totals.carb || 0,
    fiber: parsedCache.totals.fiber || 0,
    source: parsedCache.items.some(i => i.source === 'ai-estimate') ? 'ai-estimate' : parsedCache.items[0]?.source || 'manual',
    items: parsedCache.items
  };
  if (currentLogDate) {
    body.date = currentLogDate;
    body.time = new Date(currentLogDate + 'T20:00:00').toISOString();
  }
  if (!await logMeal(body, $('#parsedSaveBtn'))) return;
  $('#logText').value = '';
  $('#parsedItems').innerHTML = '';
  $('#parsedTotals').innerHTML = '';
  $('#extrasWrap').innerHTML = '';
  $('#parsedSave').innerHTML = '';
  parsedCache = null;
  closeLogModal();
  showToast('Meal logged');
  refreshAfterChange();
}

$('#manSave').addEventListener('click', async () => {
  const name = $('#manName').value.trim();
  const kcal = Number($('#manKcal').value);
  const protein = Number($('#manProtein').value) || 0;
  if (!name || !kcal) return showToast('Need name and kcal');
  const body = { name, kcal, protein, source: 'manual' };
  if (currentLogDate) {
    body.date = currentLogDate;
    body.time = new Date(currentLogDate + 'T20:00:00').toISOString();
  }
  if (!await logMeal(body, $('#manSave'))) return;
  $('#manName').value = ''; $('#manKcal').value = ''; $('#manProtein').value = '';
  closeLogModal();
  showToast('Meal logged');
  refreshAfterChange();
});
