// ---------- Today date ----------
const today = new Date();
$('#todayDate').textContent = today.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

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
loadToday();
maybeShowOnboarding();
