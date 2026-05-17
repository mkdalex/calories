// ---------- Today date ----------
const today = new Date();
$('#todayDate').textContent = today.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

// ---------- Theme toggle (top bar) — works regardless of auth state ----------
if (typeof renderThemeToggle === 'function') renderThemeToggle();
const themeToggleBtn = $('#themeToggle');
if (themeToggleBtn) themeToggleBtn.addEventListener('click', () => toggleTheme());

// ---------- Nav ----------
$$('.nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav button').forEach(b => b.classList.remove('active'));
    $$('.view').forEach(v => v.classList.add('hidden'));
    btn.classList.add('active');
    $('#view-' + btn.dataset.view).classList.remove('hidden');
    if (btn.dataset.view === 'today') loadToday();
    if (btn.dataset.view === 'history') loadHistory();
    if (btn.dataset.view === 'profile') loadProfile();
    if (btn.dataset.view === 'dev') loadDev();
    if (btn.dataset.view === 'recipes' && !$('#rbStepContent').innerHTML) startRecipeBuilder();
  });
});

// ---------- INIT ----------
(async () => {
  const authed = await checkAuth();
  if (!authed) {
    showLoginScreen();
    return; // stop — don't fire any /api calls if not logged in
  }
  renderUserChip();
  loadToday();
  maybeShowOnboarding();
})();
