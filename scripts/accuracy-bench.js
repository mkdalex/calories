#!/usr/bin/env node
// Meal-parsing accuracy benchmark.
//
// Runs every meal in tests/accuracy/meals.json through the real parse pipeline
// (AI + USDA/FatSecret + verify) and compares the totals with researched reference
// values. Uses real API keys from .env and costs real money (roughly 1-3 cents a meal).
//
//   node scripts/accuracy-bench.js                 run all meals
//   node scripts/accuracy-bench.js --only chicken  run meals whose id contains "chicken"
//   node scripts/accuracy-bench.js --compare bench-results/<earlier>.json
//
// Results are saved to bench-results/<timestamp>.json so runs can be compared
// before and after a change.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

// Isolated data dir: the bench must not touch real users' data or the live usage file.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calories-bench-'));
process.env.CALORIES_DATA_DIR = tmp;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'bench';
require('dotenv').config({ path: path.join(ROOT, '.env') });
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set. Run this where your .env with real keys lives (e.g. on the server).');
  process.exit(1);
}
const { runParse } = require(path.join(ROOT, 'server.js'));

const pct = (got, want) => want ? (got - want) / want * 100 : 0;
const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const num = (v, n) => String(v).padStart(n);

async function runOne(meal) {
  const customs = path.join(tmp, 'custom_foods.json'); // empty: no user overrides
  const started = Date.now();
  try {
    const r = await runParse(meal.text, customs);
    const t = r.totals, ref = meal.reference;
    const [lo, hi] = meal.acceptable_kcal || [ref.kcal * 0.85, ref.kcal * 1.15];
    return {
      id: meal.id, category: meal.category, text: meal.text, ms: Date.now() - started,
      reference: ref, acceptable_kcal: [lo, hi],
      got: { kcal: t.kcal, protein: Math.round(t.protein), fat: Math.round(t.fat), carb: Math.round(t.carb) },
      err_pct: { kcal: pct(t.kcal, ref.kcal), protein: pct(t.protein, ref.protein) },
      in_range: t.kcal >= lo && t.kcal <= hi,
      items: r.items.map((it, i) => ({
        name: it.name, qty: it.qty, unit: it.unit, kcal: it.kcal, protein: it.protein, source: it.source,
        ai_kcal: r.trace[i]?.ai_kcal_total, ai_range: [r.trace[i]?.ai_kcal_low, r.trace[i]?.ai_kcal_high],
        usda: r.trace[i]?.usda?.name || null, verify_note: r.trace[i]?.verify_note || null, flagged: r.trace[i]?.flagged || null,
      })),
    };
  } catch (e) {
    return { id: meal.id, category: meal.category, text: meal.text, error: e.message };
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); process.stdout.write('.'); }
  }));
  process.stdout.write('\n');
  return out;
}

function summarize(results) {
  const ok = results.filter(r => !r.error);
  const abs = ok.map(r => Math.abs(r.err_pct.kcal));
  return {
    meals: results.length, errors: results.length - ok.length,
    in_range: ok.filter(r => r.in_range).length,
    median_abs_kcal_err_pct: Math.round(median(abs) * 10) / 10,
    mean_kcal_bias_pct: ok.length ? Math.round(ok.reduce((a, r) => a + r.err_pct.kcal, 0) / ok.length * 10) / 10 : 0,
    median_abs_protein_err_pct: Math.round(median(ok.map(r => Math.abs(r.err_pct.protein))) * 10) / 10,
    worst: [...ok].sort((a, b) => Math.abs(b.err_pct.kcal) - Math.abs(a.err_pct.kcal)).slice(0, 5).map(r => r.id),
  };
}

(async () => {
  const meals = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'accuracy', 'meals.json'), 'utf8'))
    .filter(m => !opt('--only') || m.id.includes(opt('--only')));
  console.log(`Running ${meals.length} meals through the live parse pipeline...`);
  const results = await pool(meals, 3, runOne);

  console.log('\n' + pad('meal', 34) + num('ref', 6) + num('got', 7) + num('err%', 7) + num('P ref', 7) + num('P got', 7) + '  ok   sources');
  for (const r of results) {
    if (r.error) { console.log(pad(r.id, 34) + '  ERROR ' + r.error); continue; }
    const src = [...new Set(r.items.map(i => i.source))].join(',');
    console.log(pad(r.id, 34) + num(r.reference.kcal, 6) + num(r.got.kcal, 7) + num(Math.round(r.err_pct.kcal), 7)
      + num(r.reference.protein, 7) + num(r.got.protein, 7) + '  ' + (r.in_range ? 'yes' : 'NO ') + '  ' + src);
  }
  const summary = summarize(results);
  // Breakdown by where the final numbers came from: shows which path is least accurate.
  const bySource = {};
  for (const r of results.filter(x => !x.error)) for (const it of r.items) {
    (bySource[it.source] = bySource[it.source] || []).push(r);
  }
  console.log('\nSummary:', JSON.stringify(summary, null, 2));
  console.log('Median |kcal err| by item source (meal-level):');
  for (const [s, rs] of Object.entries(bySource)) console.log(`  ${pad(s, 14)} ${num(rs.length, 3)} meals  ${Math.round(median(rs.map(r => Math.abs(r.err_pct.kcal))))}%`);

  const outDir = path.join(ROOT, 'bench-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));
  console.log('\nSaved', path.relative(ROOT, outFile));

  if (opt('--compare')) {
    const prev = JSON.parse(fs.readFileSync(path.resolve(opt('--compare')), 'utf8'));
    const p = prev.summary;
    console.log(`\nvs ${opt('--compare')}:`);
    console.log(`  in range:          ${p.in_range}/${p.meals} -> ${summary.in_range}/${summary.meals}`);
    console.log(`  median |kcal err|: ${p.median_abs_kcal_err_pct}% -> ${summary.median_abs_kcal_err_pct}%`);
    console.log(`  mean kcal bias:    ${p.mean_kcal_bias_pct}% -> ${summary.mean_kcal_bias_pct}%`);
  }
  try {
    const usage = JSON.parse(fs.readFileSync(path.join(tmp, 'usage.json'), 'utf8'));
    console.log(`AI cost this run: $${usage.reduce((a, x) => a + (x.cost || 0), 0).toFixed(3)}`);
  } catch (_) {}
  fs.rmSync(tmp, { recursive: true, force: true });
})();
