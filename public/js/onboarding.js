// ---------- ONBOARDING ----------
// First-run setup wizard. Triggered on page load if no profile exists.

const OB_ACTIVITY = [
  { id: 'sedentary', emoji: '🪑', name: 'Sedentary',  desc: 'Desk job, no exercise' },
  { id: 'light',     emoji: '🚶', name: 'Light',      desc: 'Walk often, gym 1–3×/week' },
  { id: 'moderate',  emoji: '🏃', name: 'Moderate',   desc: 'Gym 3–5×/week' },
  { id: 'active',    emoji: '💪', name: 'Active',     desc: 'Gym 6–7×/week, hard sessions' },
  { id: 'athlete',   emoji: '🔥', name: 'Athlete',    desc: '2-a-days or physical job' }
];
const OB_GOALS = [
  { id: 'mild',       emoji: '📉', name: 'Slow loss',     desc: '~0.25 kg/week — easiest to stick to' },
  { id: 'steady',     emoji: '📉', name: 'Steady loss',   desc: '~0.5 kg/week — most people pick this' },
  { id: 'aggressive', emoji: '⚡', name: 'Aggressive',    desc: '~0.75 kg/week — hungry but fast' },
  { id: 'maintain',   emoji: '➖', name: 'Maintain',      desc: 'Stay where you are' },
  { id: 'gain',       emoji: '📈', name: 'Slow gain',     desc: 'Lean muscle building' }
];

let onboardingState = null;

async function maybeShowOnboarding() {
  let data;
  try { data = await api('/api/profile'); } catch (_) { return; }
  // Skip if a complete profile already exists
  if (data && data.profile && data.profile.height_cm && data.profile.weight_kg && data.profile.age) {
    return;
  }
  onboardingState = {
    step: 1,
    profile: {
      height_cm: '', weight_kg: '', age: '', sex: 'male',
      activity: null, goal: null
    },
    stats: null
  };
  buildOnboardingShell();
  renderOnboardingStep();
}

function buildOnboardingShell() {
  if ($('#onboardingBg')) return;
  const bg = document.createElement('div');
  bg.id = 'onboardingBg';
  bg.className = 'ob-bg';
  bg.innerHTML = `
    <div class="ob-card">
      <div class="ob-pips" id="obPips"></div>
      <div id="obContent"></div>
      <div id="obNav" class="ob-nav"></div>
    </div>`;
  document.body.appendChild(bg);
}

function dismissOnboarding() {
  const bg = $('#onboardingBg');
  if (bg) bg.remove();
  onboardingState = null;
}

function renderOnboardingStep() {
  if (!onboardingState) return;
  const step = onboardingState.step;
  const totalSteps = 5;
  $('#obPips').innerHTML = Array.from({ length: totalSteps }, (_, i) => {
    const n = i + 1;
    return `<span class="ob-pip ${n === step ? 'active' : n < step ? 'done' : ''}"></span>`;
  }).join('');
  if (step === 1) renderObWelcome();
  else if (step === 2) renderObBasics();
  else if (step === 3) renderObActivity();
  else if (step === 4) renderObGoal();
  else if (step === 5) renderObSummary();
}

function renderObWelcome() {
  $('#obContent').innerHTML = `
    <div class="ob-welcome">
      <div class="ob-emoji">🍎</div>
      <h1>Welcome</h1>
      <p>This is a calorie + protein tracker — built around the two numbers that actually matter for body composition.</p>
      <p>We need a few details to calculate your daily targets. Takes about 30 seconds.</p>
    </div>`;
  $('#obNav').innerHTML = `<span></span><button class="btn" id="obStart">Get started →</button>`;
  $('#obStart').addEventListener('click', () => { onboardingState.step = 2; renderOnboardingStep(); });
}

function renderObBasics() {
  const p = onboardingState.profile;
  $('#obContent').innerHTML = `
    <h2>About you</h2>
    <div class="ob-subtitle">We use these to estimate how many calories your body burns daily.</div>
    <div class="row2">
      <div class="field">
        <label>Height (cm)</label>
        <input id="obHeight" type="number" value="${p.height_cm}" placeholder="178" />
      </div>
      <div class="field">
        <label>Weight (kg)</label>
        <input id="obWeight" type="number" step="0.1" value="${p.weight_kg}" placeholder="80" />
      </div>
    </div>
    <div class="row2">
      <div class="field">
        <label>Age</label>
        <input id="obAge" type="number" value="${p.age}" placeholder="25" />
      </div>
      <div class="field">
        <label>Sex</label>
        <select id="obSex">
          <option value="male" ${p.sex === 'male' ? 'selected' : ''}>Male</option>
          <option value="female" ${p.sex === 'female' ? 'selected' : ''}>Female</option>
        </select>
      </div>
    </div>
    <div class="ob-error hidden" id="obBasicsError"></div>
  `;
  $('#obNav').innerHTML = `
    <button class="btn btn-secondary" id="obBack2">← Back</button>
    <button class="btn" id="obNext2">Next →</button>
  `;
  $('#obBack2').addEventListener('click', () => { onboardingState.step = 1; renderOnboardingStep(); });
  $('#obNext2').addEventListener('click', () => {
    const h = Number($('#obHeight').value);
    const w = Number($('#obWeight').value);
    const a = Number($('#obAge').value);
    const errs = [];
    if (!h || h < 100 || h > 230) errs.push('Height in cm (100–230)');
    if (!w || w < 30 || w > 250)  errs.push('Weight in kg (30–250)');
    if (!a || a < 13 || a > 100)  errs.push('Age (13–100)');
    if (errs.length) {
      const err = $('#obBasicsError');
      err.textContent = errs.join(' · ');
      err.classList.remove('hidden');
      return;
    }
    onboardingState.profile.height_cm = h;
    onboardingState.profile.weight_kg = w;
    onboardingState.profile.age = a;
    onboardingState.profile.sex = $('#obSex').value;
    onboardingState.step = 3;
    renderOnboardingStep();
  });
}

function renderObActivity() {
  const sel = onboardingState.profile.activity;
  $('#obContent').innerHTML = `
    <h2>How active are you?</h2>
    <div class="ob-subtitle">Pick what matches a typical week. You can change this later.</div>
    <div class="ob-cards">
      ${OB_ACTIVITY.map(a => `
        <button class="ob-card-option ${sel === a.id ? 'active' : ''}" data-id="${a.id}">
          <span class="ob-card-emoji">${a.emoji}</span>
          <div class="ob-card-text">
            <div class="ob-card-name">${a.name}</div>
            <div class="ob-card-desc">${a.desc}</div>
          </div>
        </button>
      `).join('')}
    </div>`;
  $('#obNav').innerHTML = `
    <button class="btn btn-secondary" id="obBack3">← Back</button>
    <button class="btn" id="obNext3" ${!sel ? 'disabled' : ''}>Next →</button>
  `;
  $$('#obContent .ob-card-option').forEach(btn => btn.addEventListener('click', () => {
    onboardingState.profile.activity = btn.dataset.id;
    $$('#obContent .ob-card-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('#obNext3').disabled = false;
  }));
  $('#obBack3').addEventListener('click', () => { onboardingState.step = 2; renderOnboardingStep(); });
  $('#obNext3').addEventListener('click', () => {
    if (!onboardingState.profile.activity) return;
    onboardingState.step = 4;
    renderOnboardingStep();
  });
}

function renderObGoal() {
  const sel = onboardingState.profile.goal;
  $('#obContent').innerHTML = `
    <h2>What's your goal?</h2>
    <div class="ob-subtitle">Most people doing a cut should pick "Steady loss".</div>
    <div class="ob-cards">
      ${OB_GOALS.map(g => `
        <button class="ob-card-option ${sel === g.id ? 'active' : ''}" data-id="${g.id}">
          <span class="ob-card-emoji">${g.emoji}</span>
          <div class="ob-card-text">
            <div class="ob-card-name">${g.name}</div>
            <div class="ob-card-desc">${g.desc}</div>
          </div>
        </button>
      `).join('')}
    </div>`;
  $('#obNav').innerHTML = `
    <button class="btn btn-secondary" id="obBack4">← Back</button>
    <button class="btn" id="obNext4" ${!sel ? 'disabled' : ''}>See my numbers →</button>
  `;
  $$('#obContent .ob-card-option').forEach(btn => btn.addEventListener('click', () => {
    onboardingState.profile.goal = btn.dataset.id;
    $$('#obContent .ob-card-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('#obNext4').disabled = false;
  }));
  $('#obBack4').addEventListener('click', () => { onboardingState.step = 3; renderOnboardingStep(); });
  $('#obNext4').addEventListener('click', async () => {
    if (!onboardingState.profile.goal) return;
    // Save profile, server returns computed stats
    $('#obNext4').disabled = true;
    $('#obNext4').textContent = 'Calculating…';
    try {
      const res = await api('/api/profile', { method: 'POST', body: onboardingState.profile });
      onboardingState.stats = res.stats;
      onboardingState.step = 5;
      renderOnboardingStep();
    } catch (e) {
      $('#obNext4').disabled = false;
      $('#obNext4').textContent = 'See my numbers →';
    }
  });
}

function renderObSummary() {
  const s = onboardingState.stats;
  if (!s) {
    onboardingState.step = 4;
    renderOnboardingStep();
    return;
  }
  const lossPerWeek = s.goal_meta.delta < 0 ? Math.abs(s.goal_meta.delta) * 7 / 7700 : 0;
  const goalText = s.goal_meta.delta < 0
    ? `You'll lose roughly <strong>${lossPerWeek.toFixed(2)} kg/week</strong>`
    : s.goal_meta.delta > 0
    ? `You'll gain slowly while building muscle`
    : `You'll maintain your current weight`;

  $('#obContent').innerHTML = `
    <h2>Your numbers</h2>
    <div class="ob-subtitle">${goalText} if you hit these consistently.</div>
    <div class="ob-summary-grid">
      <div class="ob-stat hero">
        <div class="ob-stat-num">${s.kcal_goal.toLocaleString()}</div>
        <div class="ob-stat-lbl">kcal / day</div>
      </div>
      <div class="ob-stat hero">
        <div class="ob-stat-num">${s.protein_g}g</div>
        <div class="ob-stat-lbl">protein / day</div>
      </div>
      <div class="ob-stat">
        <div class="ob-stat-num">${s.tdee.toLocaleString()}</div>
        <div class="ob-stat-lbl">TDEE (burn rate)</div>
      </div>
      <div class="ob-stat">
        <div class="ob-stat-num">${s.bmr.toLocaleString()}</div>
        <div class="ob-stat-lbl">BMR (at-rest burn)</div>
      </div>
    </div>
    <div class="ob-tips">
      <strong>How to use this app:</strong>
      <ul>
        <li>Tap <strong>+ Log meal</strong> at the bottom-right to log what you ate. Type plain English ("3 scrambled eggs and toast") — AI parses it.</li>
        <li>The big green ring shows kcal left. The blue bar tracks protein.</li>
        <li>Carbs/fat/fiber are hidden by default — tap "All macros" to expand.</li>
        <li>You can edit your profile or change goals any time from the Profile tab.</li>
      </ul>
    </div>
  `;
  $('#obNav').innerHTML = `
    <span></span>
    <button class="btn" id="obFinish">Start tracking →</button>
  `;
  $('#obFinish').addEventListener('click', () => {
    dismissOnboarding();
    loadToday();
  });
}
