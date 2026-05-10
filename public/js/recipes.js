// ---------- RECIPES ----------
const RECIPE_INGREDIENTS = {
  Proteins: [
    { id: 'eggs',     name: 'Eggs',           emoji: '🥚', unit: '',  step: 1,  max: 12, suffix: '' },
    { id: 'chicken',  name: 'Chicken breast', emoji: '🍗', unit: 'g', step: 50, max: 600 },
    { id: 'mince',    name: 'Beef mince',     emoji: '🥩', unit: 'g', step: 50, max: 500 },
    { id: 'tuna',     name: 'Tuna (canned)',  emoji: '🐟', unit: '',  step: 1,  max: 4, suffix: 'can' },
    { id: 'salmon',   name: 'Salmon fillet',  emoji: '🐠', unit: 'g', step: 50, max: 400 },
    { id: 'whey',     name: 'Whey protein',   emoji: '🥤', unit: '',  step: 1,  max: 4, suffix: 'scoop' }
  ],
  Veggies: [
    { id: 'broccoli', name: 'Broccoli', emoji: '🥦' },
    { id: 'carrot',   name: 'Carrot',   emoji: '🥕' },
    { id: 'tomato',   name: 'Tomato',   emoji: '🍅' },
    { id: 'onion',    name: 'Onion',    emoji: '🧅' },
    { id: 'capsicum', name: 'Capsicum', emoji: '🫑' },
    { id: 'spinach',  name: 'Spinach',  emoji: '🥬' },
    { id: 'mushroom', name: 'Mushroom', emoji: '🍄' },
    { id: 'zucchini', name: 'Zucchini', emoji: '🥒' },
    { id: 'lettuce',  name: 'Lettuce',  emoji: '🥗' },
    { id: 'cucumber', name: 'Cucumber', emoji: '🥒' },
    { id: 'garlic',   name: 'Garlic',   emoji: '🧄' }
  ],
  Carbs: [
    { id: 'rice',     name: 'Rice',         emoji: '🍚' },
    { id: 'oats',     name: 'Oats',         emoji: '🌾' },
    { id: 'bread',    name: 'Bread',        emoji: '🍞' },
    { id: 'potato',   name: 'Potato',       emoji: '🥔' },
    { id: 'sweetpot', name: 'Sweet potato', emoji: '🍠' },
    { id: 'pasta',    name: 'Pasta',        emoji: '🍝' },
    { id: 'tortilla', name: 'Tortilla',     emoji: '🫓' }
  ],
  Dairy: [
    { id: 'cheese',  name: 'Cheese',       emoji: '🧀' },
    { id: 'yogurt',  name: 'Greek yogurt', emoji: '🥛' },
    { id: 'milk',    name: 'Milk',         emoji: '🥛' },
    { id: 'butter',  name: 'Butter',       emoji: '🧈' }
  ]
};

const RECIPE_EFFORTS = [
  { id: 'low',    emoji: '⚡', name: 'Quick',  desc: '5–10 min · one pan or no-cook' },
  { id: 'medium', emoji: '🍳', name: 'Medium', desc: '10–20 min · a few steps' },
  { id: 'high',   emoji: '👨‍🍳', name: 'Proper meal', desc: '30+ min · real cooking' }
];

let recipeBuilder = {
  step: 1,
  proteins: {},
  veggies: new Set(),
  carbs: new Set(),
  dairy: new Set(),
  other: '',
  effort: 'medium',
  budget: null,
  mood: '',
  ideas: null,
  loadingIdeas: false
};

function startRecipeBuilder() {
  recipeBuilder = {
    step: 1, proteins: {}, veggies: new Set(), carbs: new Set(), dairy: new Set(),
    other: '', effort: 'medium', budget: null, mood: '', ideas: null, loadingIdeas: false
  };
  // Pre-fill budget with remaining kcal if available
  if (state.today && state.today.remaining_kcal) {
    recipeBuilder.budget = Math.max(300, state.today.remaining_kcal);
  } else {
    recipeBuilder.budget = 600;
  }
  $('#recipeOutput').innerHTML = '';
  renderRecipeBuilder();
}

function renderRecipeBuilder() {
  const step = recipeBuilder.step;
  const titles = {
    1: 'What do you have?',
    2: 'How much effort?',
    3: 'Pick one to build out'
  };
  const subtitles = {
    1: 'Tap what’s in your fridge — or skip and we’ll improvise.',
    2: 'Match what you’re actually willing to do right now.',
    3: 'Three quick ideas. Pick one and we’ll write the full recipe.'
  };
  $('#rbStepTitle').textContent = titles[step] || '';
  $('#rbSubtitle').textContent = subtitles[step] || '';
  $('#rbPips').innerHTML = [1, 2, 3].map(s =>
    `<span class="rb-pip ${s === step ? 'active' : s < step ? 'done' : ''}"></span>`
  ).join('');

  if (step === 1) renderRBStep1();
  else if (step === 2) renderRBStep2();
  else if (step === 3) renderRBStep3();
}

function renderRBStep1() {
  const sections = Object.entries(RECIPE_INGREDIENTS).map(([cat, items]) => {
    if (cat === 'Proteins') {
      return `
        <div class="rb-section">
          <div class="rb-section-title">Proteins</div>
          <div class="rb-protein-grid">
            ${items.map(it => {
              const qty = recipeBuilder.proteins[it.id] || 0;
              const valLabel = qty === 0 ? '—' : `${qty}${it.unit}${it.suffix ? ' ' + it.suffix + (qty !== 1 ? 's' : '') : ''}`;
              return `
                <div class="rb-protein-row ${qty > 0 ? 'active' : ''}">
                  <span class="rb-emoji">${it.emoji}</span>
                  <span class="rb-pname">${it.name}</span>
                  <div class="rb-counter">
                    <button class="rb-cbtn" data-protein="${it.id}" data-delta="-1">−</button>
                    <span class="rb-cval">${valLabel}</span>
                    <button class="rb-cbtn" data-protein="${it.id}" data-delta="1">+</button>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }
    const setName = cat.toLowerCase();
    const set = recipeBuilder[setName];
    return `
      <div class="rb-section">
        <div class="rb-section-title">${cat}</div>
        <div class="rb-chip-grid">
          ${items.map(it => `
            <button class="rb-chip ${set.has(it.id) ? 'active' : ''}" data-cat="${setName}" data-id="${it.id}">
              <span class="rb-emoji">${it.emoji}</span> ${it.name}
            </button>
          `).join('')}
        </div>
      </div>`;
  }).join('');

  $('#rbStepContent').innerHTML = `
    ${sections}
    <div class="rb-section">
      <div class="rb-section-title">Anything else?</div>
      <input id="rbOther" placeholder="e.g. peanut butter, sriracha, leftover rice" value="${escapeHtml(recipeBuilder.other)}" style="font-size:14px;" />
    </div>
  `;

  $('#rbStepNav').innerHTML = `
    <span style="font-size:12px;color:var(--text-dim);">${countSelectedIngredients()} item${countSelectedIngredients() !== 1 ? 's' : ''} picked</span>
    <button class="btn" id="rbNext1">Next: effort →</button>
  `;

  // Wire protein counters
  $$('#rbStepContent .rb-cbtn').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.protein;
    const delta = Number(btn.dataset.delta);
    const def = RECIPE_INGREDIENTS.Proteins.find(p => p.id === id);
    const cur = recipeBuilder.proteins[id] || 0;
    const next = Math.max(0, Math.min(def.max, cur + delta * def.step));
    if (next === 0) delete recipeBuilder.proteins[id]; else recipeBuilder.proteins[id] = next;
    renderRBStep1();
  }));

  // Wire chip toggles (veggies/carbs/dairy)
  $$('#rbStepContent .rb-chip').forEach(btn => btn.addEventListener('click', () => {
    const cat = btn.dataset.cat;
    const id = btn.dataset.id;
    const set = recipeBuilder[cat];
    if (set.has(id)) set.delete(id); else set.add(id);
    btn.classList.toggle('active');
    $('#rbStepNav').querySelector('span').textContent = `${countSelectedIngredients()} item${countSelectedIngredients() !== 1 ? 's' : ''} picked`;
  }));

  $('#rbOther').addEventListener('input', e => { recipeBuilder.other = e.target.value; });
  $('#rbNext1').addEventListener('click', () => { recipeBuilder.step = 2; renderRecipeBuilder(); });
}

function countSelectedIngredients() {
  return Object.keys(recipeBuilder.proteins).length
    + recipeBuilder.veggies.size
    + recipeBuilder.carbs.size
    + recipeBuilder.dairy.size
    + (recipeBuilder.other.trim() ? 1 : 0);
}

function renderRBStep2() {
  const remaining = state.today && state.today.remaining_kcal ? state.today.remaining_kcal : null;

  $('#rbStepContent').innerHTML = `
    <div class="rb-effort-grid">
      ${RECIPE_EFFORTS.map(e => `
        <button class="rb-effort ${recipeBuilder.effort === e.id ? 'active' : ''}" data-effort="${e.id}">
          <div class="rb-effort-emoji">${e.emoji}</div>
          <div class="rb-effort-name">${e.name}</div>
          <div class="rb-effort-desc">${e.desc}</div>
        </button>
      `).join('')}
    </div>
    <div class="rb-section" style="margin-top:16px;">
      <div class="rb-section-title">Calorie budget</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="rbBudget" type="number" value="${recipeBuilder.budget}" style="font-size:14px;flex:1;" />
        ${remaining ? `<button class="btn btn-secondary" id="rbUseRemaining" style="white-space:nowrap;font-size:12px;padding:8px 10px;">Use ${remaining} left today</button>` : ''}
      </div>
    </div>
    <div class="rb-section">
      <div class="rb-section-title">Vibe (optional)</div>
      <input id="rbMood" placeholder="e.g. spicy, cozy, post-gym, comfort food" value="${escapeHtml(recipeBuilder.mood)}" style="font-size:14px;" />
    </div>
  `;
  $('#rbStepNav').innerHTML = `
    <button class="btn btn-secondary" id="rbBack2">← Back</button>
    <button class="btn" id="rbGetIdeas">Get 3 ideas →</button>
  `;
  $$('#rbStepContent .rb-effort').forEach(btn => btn.addEventListener('click', () => {
    recipeBuilder.effort = btn.dataset.effort;
    $$('#rbStepContent .rb-effort').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }));
  $('#rbBudget').addEventListener('input', e => { recipeBuilder.budget = Number(e.target.value) || 600; });
  if ($('#rbUseRemaining')) {
    $('#rbUseRemaining').addEventListener('click', () => {
      recipeBuilder.budget = remaining;
      $('#rbBudget').value = remaining;
    });
  }
  $('#rbMood').addEventListener('input', e => { recipeBuilder.mood = e.target.value; });
  $('#rbBack2').addEventListener('click', () => { recipeBuilder.step = 1; renderRecipeBuilder(); });
  $('#rbGetIdeas').addEventListener('click', fetchRecipeIdeas);
}

async function fetchRecipeIdeas() {
  recipeBuilder.step = 3;
  recipeBuilder.loadingIdeas = true;
  recipeBuilder.ideas = null;
  renderRecipeBuilder();
  try {
    const r = await api('/api/recipe-ideas', {
      method: 'POST',
      body: {
        ingredients: buildIngredientString(),
        kcal_budget: recipeBuilder.budget,
        protein_target: state.stats ? Math.round(state.stats.protein_g / 3) : 30,
        effort: recipeBuilder.effort,
        mood: recipeBuilder.mood
      }
    });
    if (r.error) {
      recipeBuilder.ideas = { error: r.error };
    } else {
      recipeBuilder.ideas = r.ideas || [];
    }
  } catch (e) {
    recipeBuilder.ideas = { error: e.message };
  } finally {
    recipeBuilder.loadingIdeas = false;
    renderRecipeBuilder();
  }
}

function buildIngredientString() {
  const parts = [];
  Object.entries(recipeBuilder.proteins).forEach(([id, qty]) => {
    const def = RECIPE_INGREDIENTS.Proteins.find(p => p.id === id);
    if (!def) return;
    const label = def.suffix ? `${qty} ${def.suffix}${qty !== 1 ? 's' : ''} ${def.name.toLowerCase()}` : `${qty}${def.unit} ${def.name.toLowerCase()}`;
    parts.push(label);
  });
  ['veggies', 'carbs', 'dairy'].forEach(cat => {
    const catList = RECIPE_INGREDIENTS[cat[0].toUpperCase() + cat.slice(1)];
    recipeBuilder[cat].forEach(id => {
      const def = catList.find(x => x.id === id);
      if (def) parts.push(def.name.toLowerCase());
    });
  });
  if (recipeBuilder.other.trim()) parts.push(recipeBuilder.other.trim());
  return parts.join(', ') || 'whatever is normal';
}

function renderRBStep3() {
  if (recipeBuilder.loadingIdeas) {
    showAILoader($('#rbStepContent'));
    $('#rbStepNav').innerHTML = `<button class="btn btn-secondary" id="rbBack3" disabled>← Back</button><span></span>`;
    return;
  }
  if (recipeBuilder.ideas && recipeBuilder.ideas.error) {
    $('#rbStepContent').innerHTML = `<div class="empty" style="color:var(--danger);padding:20px;">${escapeHtml(recipeBuilder.ideas.error)}</div>`;
    $('#rbStepNav').innerHTML = `<button class="btn btn-secondary" id="rbBack3">← Back</button><button class="btn" id="rbRetry">Retry</button>`;
    $('#rbBack3').addEventListener('click', () => { recipeBuilder.step = 2; renderRecipeBuilder(); });
    $('#rbRetry').addEventListener('click', fetchRecipeIdeas);
    return;
  }
  const ideas = recipeBuilder.ideas || [];
  if (!ideas.length) {
    $('#rbStepContent').innerHTML = `<div class="empty" style="padding:20px;">No ideas came back. Try different ingredients.</div>`;
    $('#rbStepNav').innerHTML = `<button class="btn btn-secondary" id="rbBack3">← Back</button>`;
    $('#rbBack3').addEventListener('click', () => { recipeBuilder.step = 2; renderRecipeBuilder(); });
    return;
  }
  $('#rbStepContent').innerHTML = `
    <div class="rb-ideas-grid">
      ${ideas.map((idea, i) => `
        <button class="rb-idea-card" data-idx="${i}">
          <div class="rb-idea-emoji">${idea.emoji || '🍽️'}</div>
          <div class="rb-idea-name">${escapeHtml(idea.name)}</div>
          <div class="rb-idea-stats">${idea.kcal} kcal · ${idea.protein_g}g P · ${idea.time_min} min</div>
          <div class="rb-idea-summary">${escapeHtml(idea.summary || '')}</div>
        </button>
      `).join('')}
    </div>
  `;
  $('#rbStepNav').innerHTML = `
    <button class="btn btn-secondary" id="rbBack3">← Back</button>
    <button class="btn btn-secondary" id="rbReroll">↻ Different ideas</button>
  `;
  $$('#rbStepContent .rb-idea-card').forEach(btn => btn.addEventListener('click', () => {
    const idx = Number(btn.dataset.idx);
    buildFullRecipe(ideas[idx]);
  }));
  $('#rbBack3').addEventListener('click', () => { recipeBuilder.step = 2; renderRecipeBuilder(); });
  $('#rbReroll').addEventListener('click', fetchRecipeIdeas);
}

async function buildFullRecipe(idea) {
  $('#recipeOutput').innerHTML = `<div class="card"></div>`;
  showAILoader($('#recipeOutput').querySelector('.card'), `Writing the full recipe for ${idea.name}…`);
  $('#recipeOutput').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const recipe = await api('/api/recipe', {
      method: 'POST',
      body: {
        ingredients: buildIngredientString(),
        kcal_budget: idea.kcal || recipeBuilder.budget,
        protein_target: idea.protein_g || (state.stats ? Math.round(state.stats.protein_g / 3) : 30),
        mood: `Make exactly: "${idea.name}". ${idea.summary || ''} Effort: ${recipeBuilder.effort}. ${recipeBuilder.mood}`
      }
    });
    if (recipe.error) {
      $('#recipeOutput').innerHTML = `<div class="card"><div class="empty" style="color:var(--danger);">${escapeHtml(recipe.error)}</div></div>`;
      return;
    }
    renderRecipe(recipe);
  } catch (e) {
    $('#recipeOutput').innerHTML = `<div class="card"><div class="empty" style="color:var(--danger);">${escapeHtml(e.message)}</div></div>`;
  }
}

function renderRecipe(r) {
  $('#recipeOutput').innerHTML = `
    <div class="card">
      <h2>${escapeHtml(r.name)}</h2>
      ${r.narrative ? `<div class="narrative">${escapeHtml(r.narrative)}</div>` : ''}
      <div style="display: flex; gap: 16px; color: var(--text-dim); font-size: 14px; margin-bottom: 12px;">
        <span><strong style="color:var(--text);">${r.total_kcal}</strong> kcal</span>
        <span><strong style="color:var(--text);">${r.protein_g}g</strong> protein</span>
        <span>${r.servings} serving${r.servings > 1 ? 's' : ''}</span>
        <span>${r.time_min} min</span>
      </div>
      <h3>Ingredients</h3>
      <ul class="checklist">${(r.ingredients || []).map(i => `<li>${escapeHtml(i.qty || '')} ${escapeHtml(i.item || '')} ${i.note ? `<span style="color:var(--text-dim);">(${escapeHtml(i.note)})</span>` : ''}</li>`).join('')}</ul>
      ${r.tools && r.tools.length ? `<h3>Tools you'll need</h3><ul class="checklist">${r.tools.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
      ${r.prep && r.prep.length ? `<h3>Prep first (before cooking)</h3><ul class="checklist">${r.prep.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
      <h3>Steps</h3>
      ${(r.steps || []).map(s => `
        <div class="recipe-step">
          <div><span class="n">${s.n}</span><span class="do">${escapeHtml(s.do)}</span>${s.time ? `<span class="time">${escapeHtml(s.time)}</span>` : ''}</div>
          ${s.watch_for ? `<div class="watch-for">→ ${escapeHtml(s.watch_for)}</div>` : ''}
          ${s.why ? `<div class="why">why: ${escapeHtml(s.why)}</div>` : ''}
        </div>
      `).join('')}
      <button class="btn" style="margin-top: 12px; width: 100%;" id="recipeLog">Log this as a meal</button>
    </div>
  `;
  $('#recipeLog').addEventListener('click', async () => {
    await api('/api/log', {
      method: 'POST',
      body: { name: r.name, kcal: r.total_kcal, protein: r.protein_g, fat: r.fat_g || 0, carb: r.carb_g || 0, fiber: r.fiber_g || 0, source: 'ai-estimate' }
    });
    showToast('Recipe logged');
    loadToday();
  });
}

$('#snackGo').addEventListener('click', async () => {
  $('#snackGo').disabled = true;
  showAILoader($('#snackOutput'));
  try {
    const data = await api('/api/snack', { method: 'POST', body: { kcal_cap: Number($('#snackCap').value) || 200 } });
    if (data.error) { $('#snackOutput').innerHTML = `<div class="empty" style="color: var(--danger);">${data.error}</div>`; return; }
    $('#snackOutput').innerHTML = data.snacks.map(s => `
      <div class="card" style="padding: 12px 14px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline;">
          <strong>${escapeHtml(s.name)}</strong>
          <span style="color: var(--text-dim); font-size: 14px;">${s.kcal} kcal · ${s.protein_g}g</span>
        </div>
        <div style="color: var(--text-dim); font-size: 13px; margin-top: 4px;">${escapeHtml(s.why)}</div>
        <button class="btn btn-secondary" style="margin-top: 8px; padding: 6px 12px; font-size: 13px;" data-snack='${JSON.stringify(s).replace(/'/g, "&apos;")}'>Log this</button>
      </div>
    `).join('');
    $$('[data-snack]').forEach(btn => btn.addEventListener('click', async () => {
      const s = JSON.parse(btn.dataset.snack.replace(/&apos;/g, "'"));
      await api('/api/log', { method: 'POST', body: { name: s.name, kcal: s.kcal, protein: s.protein_g, fat: s.fat_g || 0, carb: s.carb_g || 0, fiber: s.fiber_g || 0, source: 'ai-estimate' } });
      showToast('Snack logged');
      loadToday();
    }));
  } finally {
    $('#snackGo').disabled = false;
  }
});
