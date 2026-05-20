// ---------- Glossary (NetWatch pattern) ----------
const GLOSSARY = {
  'BMR': "Basal Metabolic Rate — calories your body burns at total rest, like sleeping all day.",
  'TDEE': "Total Daily Energy Expenditure — calories you burn in a normal day including movement.",
  'deficit': "Eating fewer calories than you burn. ~7,700 kcal deficit ≈ 1 kg of fat lost.",
  'macro': "Short for macronutrient — protein, carbs, or fat.",
  'protein': "The macronutrient that protects muscle and keeps you full. Most important if losing weight.",
  'kcal': "Kilocalorie. What people mean when they say 'calories'.",
  'fiber': "Slows digestion so you stay full longer. Big help on a cut.",
  'carbs': "Your gym fuel — what muscles burn when you lift.",
  'fat': "Energy + hormones. Most calorie-dense macro (9 kcal/g) so easy to overdo."
};
function glossify(text) {
  if (!text) return '';
  let out = text;
  for (const [term, tip] of Object.entries(GLOSSARY)) {
    const re = new RegExp(`\\b(${term})\\b`, 'g');
    out = out.replace(re, `<span class="gloss" data-tip="${tip.replace(/"/g, '&quot;')}">$1</span>`);
  }
  return out;
}

// ---------- State ----------
let state = { profile: null, stats: null, today: null, water: null, user: null };

// ---------- Helpers ----------
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
function showUndoToast(msg, onUndo, ms = 5000) {
  const t = document.createElement('div');
  t.className = 'toast toast-undo';
  const span = document.createElement('span');
  span.textContent = msg;
  const btn = document.createElement('button');
  btn.className = 'toast-undo-btn';
  btn.textContent = 'Undo';
  t.appendChild(span);
  t.appendChild(btn);
  document.body.appendChild(t);
  let dismissed = false;
  const dismiss = () => { if (!dismissed) { dismissed = true; t.remove(); } };
  btn.addEventListener('click', () => { dismiss(); onUndo(); });
  setTimeout(dismiss, ms);
}
function animateNumber(el, from, to, duration = 600, prefix = '') {
  if (!el || from === to) { if (el) el.textContent = prefix + to; return; }
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = prefix + Math.round(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
// Cached once — the browser doesn't change timezone mid-session.
const CLIENT_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
  catch (_) { return ''; }
})();
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (CLIENT_TZ) headers['X-Client-TZ'] = CLIENT_TZ;
  const r = await fetch(path, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  return r.json();
}

// Reasonably-unique key per save action. Used to dedupe accidental double-clicks
// and post-crash retries — server returns the existing entry if it sees this key.
function newIdemKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// POST /api/log with idempotency + retry. The idempotency_key is reused across
// retries so a network hiccup that loses the response (or a server crash mid-write)
// doesn't create a duplicate — the server returns the existing entry instead.
// Returns the response on success, null on failure (toast already shown).
// Callers can `if (!await logMeal(...)) return;` without a try/catch.
async function logMeal(body, btn) {
  const originalText = btn ? (btn.dataset.origText || btn.textContent) : '';
  if (btn) {
    btn.dataset.origText = originalText;
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }
  const restoreBtn = () => {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  };

  const payload = { ...body, idempotency_key: body.idempotency_key || newIdemKey() };
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await api('/api/log', { method: 'POST', body: payload });
      if (res && res.error) throw new Error(res.error);
      restoreBtn();
      return res;
    } catch (e) {
      if (attempt < MAX_ATTEMPTS - 1) {
        if (btn) btn.textContent = `Retrying… (${attempt + 2}/${MAX_ATTEMPTS})`;
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }
  restoreBtn();
  if (typeof showToast === 'function') {
    showToast('Failed to log after 3 tries — check connection then retry');
  }
  return null;
}
function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
// Local-time yyyy-mm-dd. Don't use toISOString().slice(0,10) — that's UTC and shifts day in -ve TZs.
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Clamp eaten/target as a 0-100% string with 1 decimal. Zero or missing target → 0%.
function pctOf(eaten, target) {
  return Math.min(target > 0 ? eaten / target * 100 : 0, 100).toFixed(1);
}
// Round to 1 decimal place. Non-numeric input → 0.
function round1(x) {
  const n = Number(x) || 0;
  return Math.round(n * 10) / 10;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Refresh whichever view is visible after a log edit/add/delete. If a date is passed
// and history is open with that date selected, also re-render the day's detail.
function refreshAfterChange(date) {
  const todayVisible = !$('#view-today').classList.contains('hidden');
  const historyVisible = !$('#view-history').classList.contains('hidden');
  if (todayVisible) loadToday();
  if (historyVisible) {
    loadHistory();
    if (date && typeof renderCalDetail === 'function' && typeof calSelectedDate !== 'undefined' && calSelectedDate === date) {
      // Re-render the open day so the change shows immediately
      setTimeout(() => renderCalDetail(date), 50);
    }
  }
}
