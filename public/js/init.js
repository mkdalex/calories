// ---------- Theme toggle (desktop sidebar; Profile has the full picker) ----------
if (typeof renderThemeToggle === "function") renderThemeToggle();
const themeToggleBtn = document.getElementById("themeToggle");
if (themeToggleBtn) themeToggleBtn.addEventListener("click", () => toggleTheme());

// ---------- Nav (mobile bottom bar + desktop sidebar) ----------
function setActiveView(viewName) {
  document.querySelectorAll(".sb-nav-item, .sb-dev").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === viewName);
  });
  // Dev lives inside Profile on mobile, so Profile stays lit while it's open.
  const navView = viewName === "dev" ? "profile" : viewName;
  document.querySelectorAll(".nav button[data-view]").forEach((b) => {
    const on = b.dataset.view === navView;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  $$(".view").forEach((v) => v.classList.add("hidden"));
  const target = document.getElementById("view-" + viewName);
  if (target) target.classList.remove("hidden");
  if (typeof closeRowMenu === "function") closeRowMenu();
  window.scrollTo(0, 0);
  if (viewName === "today")   loadToday();
  if (viewName === "gym")     loadGym();
  if (viewName === "history") loadHistory();
  if (viewName === "profile") loadProfile();
  if (viewName === "dev")     loadDev();
}
document.querySelectorAll(".nav button[data-view], .sb-nav-item, .sb-dev, #accountCard [data-view]").forEach((btn) => {
  btn.addEventListener("click", () => setActiveView(btn.dataset.view));
});
document.getElementById("navLog").addEventListener("click", () => openLogModal(todayViewDate));

// ---------- Today header: day picker + previous/next ----------
document.getElementById("tdPrev").addEventListener("click", () => shiftTodayDate(-1));
document.getElementById("tdNext").addEventListener("click", () => shiftTodayDate(1));
document.getElementById("tdBack").addEventListener("click", () => setTodayDate(null));
const tdPicker = document.getElementById("tdPicker");
document.getElementById("tdPickBtn").addEventListener("click", () => {
  try { tdPicker.showPicker(); } catch (_) { tdPicker.focus(); tdPicker.click(); }
});
tdPicker.addEventListener("change", () => setTodayDate(tdPicker.value));

// ---------- Quick "What did you eat?" box: typing or tapping hands off to the log sheet ----------
const quickLogInput = document.getElementById("quickLogInput");
function openLogWithText(text) {
  openLogModal(todayViewDate);
  const modalText = document.getElementById("logText");
  if (text && modalText) {
    modalText.value = text;
    modalText.dispatchEvent(new Event("input", { bubbles: true }));
  }
  quickLogInput.value = "";
}
document.getElementById("quickLog").addEventListener("submit", (e) => {
  e.preventDefault();
  openLogWithText(quickLogInput.value.trim());
});
quickLogInput.addEventListener("click", () => openLogWithText(quickLogInput.value.trim()));
quickLogInput.addEventListener("input", () => openLogWithText(quickLogInput.value));

// ---------- Background parses → pending rows on Today ----------
// Re-render the meal list when a parse changes state (started, ready, failed, saved).
// Step-by-step progress is handled by the row ticker in today.js, not a full re-render.
const parseJobStatus = new Map();
onParseJobChange((job) => {
  if (parseJobStatus.get(job.id) === job.status) return;
  parseJobStatus.set(job.id, job.status);
  if (state.today && !$("#view-today").classList.contains("hidden")) renderMeals(state.today);
});

// ---------- INIT ----------
(async () => {
  const authed = await checkAuth();
  if (!authed) {
    showLoginScreen();
    return; // stop — don't fire any /api calls if not logged in
  }
  renderUserChip();
  restoreParseJobs();
  // Warm the AI loader ETA cache so the first parse shows a calibrated estimate
  // (median from the user's prior calls across all devices).
  if (typeof prefetchLoaderStats === 'function') prefetchLoaderStats();
  loadToday();
  // First-run wizard wins if there's no profile at all; otherwise check whether
  // they're returning from a gap and owe themselves a re-entry.
  const onboarding = await maybeShowOnboarding();
  if (!onboarding) maybeShowComeback();
})();
