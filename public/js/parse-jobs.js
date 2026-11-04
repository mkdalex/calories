// ---------- BACKGROUND PARSES ----------
// An AI parse keeps running if the log sheet is closed part-way. Until it finishes it
// shows on Today as a pending meal. When nothing in the result needs checking it saves
// itself; otherwise the row asks the user to check it. Jobs are kept in sessionStorage
// so a reload doesn't silently drop one. A reload does cut the stream, so a job that
// was still parsing comes back as "interrupted" with a one-tap retry.

const PARSE_JOBS_KEY = 'pendingParses';
let parseJobs = [];
const parseJobListeners = new Set();

function saveParseJobs() {
  try {
    sessionStorage.setItem(PARSE_JOBS_KEY, JSON.stringify(parseJobs.map(({ watched, ...job }) => job)));
  } catch (_) { /* private mode: jobs just won't survive a reload */ }
}

function restoreParseJobs() {
  let saved = [];
  try { saved = JSON.parse(sessionStorage.getItem(PARSE_JOBS_KEY) || '[]'); } catch (_) {}
  parseJobs = saved.map(job => ({
    ...job,
    watched: false,
    status: job.status === 'parsing' ? 'interrupted' : job.status === 'ready' ? ((job.checks || []).length ? 'review' : 'saving') : job.status
  }));
  saveParseJobs();
  // A save that may not have reached the server: resend with the same idempotency key.
  parseJobs.filter(job => job.status === 'saving').forEach(autoSaveJob);
}

function onParseJobChange(fn) {
  parseJobListeners.add(fn);
  return () => parseJobListeners.delete(fn);
}

function notifyParseJob(job) {
  saveParseJobs();
  parseJobListeners.forEach(fn => fn(job));
}

function findParseJob(id) {
  return parseJobs.find(job => job.id === id) || null;
}

function removeParseJob(id) {
  const job = findParseJob(id);
  parseJobs = parseJobs.filter(j => j.id !== id);
  if (job) { job.status = 'removed'; notifyParseJob(job); }
}

// Jobs logging into a given day ('yyyy-mm-dd').
function parseJobsForDate(date) {
  return parseJobs.filter(job => (job.date || fmtDate(new Date(job.createdAt))) === date);
}

// text: what was typed. date: null for today. period/time: where the entry gets filed.
function startParseJob({ text, date, period, time }) {
  const job = {
    id: newIdemKey(), idemKey: newIdemKey(), createdAt: Date.now(),
    text, date: date || null, period, time: time || null,
    status: 'parsing', watched: true
  };
  parseJobs.push(job);
  runParseJob(job);
  return job;
}

async function runParseJob(job) {
  Object.assign(job, { status: 'parsing', startedAt: Date.now(), etaMs: loaderMedianMs(), steps: [], result: null, checks: [], error: null });
  notifyParseJob(job);
  try {
    const data = await apiStream('/api/parse/stream', { text: job.text }, ev => {
      if (applyParseEvent(job, ev)) notifyParseJob(job);
    });
    if (!findParseJob(job.id)) return; // discarded while it ran
    if (!data.items || !data.items.length) throw new Error("Couldn't find any food in that. Try naming what you ate.");
    data.suggested_extras = data.suggested_extras || [];
    data.items.forEach((it, i) => {
      it.flagged = (data.trace || [])[i]?.flagged || null;
      it.base = { qty: it.qty, kcal: it.kcal, protein: it.protein, fat: it.fat || 0, carb: it.carb || 0, fiber: it.fiber || 0 };
    });
    job.result = data;
    job.checks = itemsToCheck(data);
    finishParseSteps(job);
    _recordEtaSample(Date.now() - job.startedAt);
    job.status = 'ready';
    notifyParseJob(job);
    if (!job.watched) settleParseJob(job);
  } catch (e) {
    if (!findParseJob(job.id)) return;
    job.status = 'error';
    job.error = e.message;
    notifyParseJob(job);
  }
}

// Finished while nobody was watching: save it if nothing needs a look, otherwise wait.
function settleParseJob(job) {
  if (job.status !== 'ready') return;
  if (job.checks.length) { job.status = 'review'; notifyParseJob(job); }
  else autoSaveJob(job);
}

async function autoSaveJob(job) {
  job.status = 'saving';
  notifyParseJob(job);
  const res = await logMeal(parseJobEntry(job));
  if (!res || !res.entry) { job.status = 'review'; notifyParseJob(job); return; }
  removeParseJob(job.id);
  refreshAfterChange();
  const day = job.date || fmtDate(new Date(job.createdAt));
  showUndoToast(`Logged: ${job.text.slice(0, 32)} · ${res.entry.kcal} kcal`, async () => {
    await fetch(`/api/log/${day}/${res.entry.id}`, { method: 'DELETE' });
    refreshAfterChange();
  });
}

// The /api/log body for a finished job. Items set to "None" in review are dropped.
function parseJobEntry(job) {
  const items = job.result.items.filter(it => it.kcal > 0 || it.protein > 0);
  const totals = sumItems(items);
  return {
    name: job.text.trim().slice(0, 200),
    kcal: totals.kcal, protein: totals.protein, fat: totals.fat, carb: totals.carb, fiber: totals.fiber,
    source: items.some(i => i.source === 'ai-estimate') ? 'ai-estimate' : items[0]?.source || 'manual',
    items,
    idempotency_key: job.idemKey,
    ...(job.date ? { date: job.date } : {}),
    ...(job.time ? { time: job.time } : {})
  };
}

function sumItems(items) {
  const t = items.reduce((a, i) => ({
    kcal: a.kcal + (i.kcal || 0), protein: a.protein + (i.protein || 0),
    fat: a.fat + (i.fat || 0), carb: a.carb + (i.carb || 0), fiber: a.fiber + (i.fiber || 0)
  }), { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 });
  return { kcal: Math.round(t.kcal), protein: round1(t.protein), fat: round1(t.fat), carb: round1(t.carb), fiber: round1(t.fiber) };
}

// Indexes of items that were guessed: low-confidence AI estimates (generic dishes, vague
// amounts) and anything the server's sanity checks flagged. Database matches, the user's
// own foods and confident AI estimates don't need a second look.
function itemsToCheck(data) {
  const out = [];
  data.items.forEach((it, i) => {
    const trace = (data.trace || [])[i] || {};
    if ((it.source === 'ai-estimate' && it.confidence === 'low') || it.flagged || trace.flagged) out.push(i);
  });
  return out;
}

// ---------- Live steps ----------
// Server events → short friendly lines. Returns true when something visible changed.
function applyParseEvent(job, ev) {
  const set = (id, state, label) => {
    let step = job.steps.find(s => s.id === id);
    if (!step) { step = { id }; job.steps.push(step); }
    step.state = state;
    if (label) step.label = label;
  };
  const endThinking = () => { const t = job.steps.find(s => s.id === 'think'); if (t && t.state === 'active') job.steps = job.steps.filter(s => s !== t); };
  if (ev.type === 'thinking') {
    const { title } = splitThought(ev.text);
    const prev = job.steps.find(s => s.id === 'think');
    if (prev && prev.label === (title || 'Thinking it through')) return false;
    set('think', 'active', title || 'Thinking it through');
  } else if (ev.type === 'search') {
    endThinking();
    set('search', ev.done ? 'done' : 'active', ev.done ? (ev.query ? `Looked up “${ev.query}” online` : 'Looked it up online') : 'Searching the web');
  } else if (ev.type === 'step') {
    endThinking();
    const labels = {
      ai: { active: 'Splitting it into foods', done: ev.label && ev.label.replace(/item/, 'food') },
      db: { active: 'Looking it up in USDA and FatSecret' },
      verify: { active: 'Double-checking the numbers', done: ev.label }
    };
    // The db step's own summary is replaced by per-food lines once the result lands.
    if (ev.id === 'db' && ev.state === 'done') { set('db', 'done', 'Checked the food databases'); return true; }
    set(ev.id, ev.state, (labels[ev.id] && labels[ev.id][ev.state]) || ev.label);
  } else {
    return false;
  }
  return true;
}

// Once the result is in, swap the generic database step for what actually happened
// to each food: "Eggs and toast matched in USDA", "Flat white is one of yours",
// "Butter amount is a guess".
function finishParseSteps(job) {
  const { items } = job.result;
  const names = list => {
    const n = list.map(it => it.name.toLowerCase());
    const joined = n.length > 2 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n.join(' and ');
    return joined.charAt(0).toUpperCase() + joined.slice(1);
  };
  const lines = [];
  const bySource = (pred) => items.filter(pred);
  const usda = bySource(it => it.source === 'usda' || it.source === 'usda+ai');
  const fs = bySource(it => it.source === 'fatsecret');
  const verified = bySource(it => it.source === 'ai-verified');
  const own = bySource(it => it.source === 'custom');
  const guessed = job.checks.map(i => items[i]);
  if (usda.length) lines.push(`${names(usda)} matched in USDA`);
  if (fs.length) lines.push(`${names(fs)} matched in FatSecret`);
  if (verified.length) lines.push(`${names(verified)} checked and corrected`);
  if (own.length) lines.push(`${names(own)} ${own.length === 1 ? 'is' : 'are'} one of yours`);
  if (guessed.length) lines.push(`${names(guessed)} ${guessed.length === 1 ? 'amount is a guess' : 'amounts are guesses'}`);
  job.steps = job.steps.filter(s => s.id !== 'db' && s.id !== 'think');
  lines.forEach((label, i) => job.steps.push({ id: `sum${i}`, state: 'done', label, tone: label.endsWith('guess') || label.endsWith('guesses') ? 'warn' : '' }));
}

// 0-100 for the progress bar. Paced against the user's usual parse time, with a floor
// from the steps so the bar never sits behind what's visibly finished.
function parseJobProgress(job) {
  if (job.status !== 'parsing') return job.status === 'error' || job.status === 'interrupted' ? 0 : 100;
  const done = id => job.steps.some(s => s.id === id && s.state === 'done');
  const floor = done('verify') ? 95 : done('db') ? 82 : done('ai') ? 60 : 0;
  return Math.max(floor, progressPercent(Date.now() - job.startedAt, job.etaMs || loaderMedianMs()));
}

function parseJobLabel(job) {
  if (job.status === 'saving') return 'Saving…';
  const active = [...job.steps].reverse().find(s => s.state === 'active');
  const last = job.steps[job.steps.length - 1];
  return active ? `${active.label}…` : last ? last.label : 'Starting…';
}
