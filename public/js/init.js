// ---------- Today date (mobile topbar) ----------
const today = new Date();
$("#todayDate").textContent = today.toLocaleDateString([], {
  weekday: "short",
  month: "short",
  day: "numeric",
});

// ---------- Page-head greeting + date (desktop) ----------
function renderPageHead() {
  const h = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const el = document.getElementById("phGreet");
  if (el) el.textContent = greet;
  const dateEl = document.getElementById("phDate");
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString([], {
      weekday: "long", month: "long", day: "numeric",
    });
  }
}
renderPageHead();

// ---------- Theme toggle (mobile topbar + desktop sidebar) ----------
if (typeof renderThemeToggle === "function") renderThemeToggle();
document.querySelectorAll("#themeToggle, #themeToggleDesktop").forEach((btn) => {
  btn.addEventListener("click", () => toggleTheme());
});

// ---------- Nav (mobile bottom nav + desktop sidebar) ----------
function setActiveView(viewName) {
  document.querySelectorAll(".nav button, .sb-nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === viewName);
  });
  $$(".view").forEach((v) => v.classList.add("hidden"));
  const target = document.getElementById("view-" + viewName);
  if (target) target.classList.remove("hidden");
  if (viewName === "today")   loadToday();
  if (viewName === "gym")     loadGym();
  if (viewName === "history") loadHistory();
  if (viewName === "profile") loadProfile();
  if (viewName === "dev")     loadDev();
}
document.querySelectorAll(".nav button, .sb-nav-item").forEach((btn) => {
  btn.addEventListener("click", () => setActiveView(btn.dataset.view));
});

// ---------- Page-head "Log meal" button (desktop) ----------
const phLogBtn = document.getElementById("phLogBtn");
if (phLogBtn) phLogBtn.addEventListener("click", () => openLogModal());

// ---------- Sidebar quick-log (desktop) ----------
const sbQuickLog = document.getElementById("sbQuickLog");
const sbQuickLogBtn = document.getElementById("sbQuickLogBtn");
function sbSubmitQuickLog() {
  const text = sbQuickLog ? sbQuickLog.value.trim() : "";
  if (!text) { openLogModal(); return; }
  openLogModal();
  // Pipe the typed text into the modal so the user picks up mid-flow
  const modalText = document.getElementById("logText");
  if (modalText) {
    modalText.value = text;
    if (typeof modalText.dispatchEvent === "function") {
      modalText.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  if (sbQuickLog) sbQuickLog.value = "";
}
if (sbQuickLogBtn) sbQuickLogBtn.addEventListener("click", sbSubmitQuickLog);
if (sbQuickLog) {
  sbQuickLog.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sbSubmitQuickLog(); }
  });
}

// ---------- INIT ----------
(async () => {
  const authed = await checkAuth();
  if (!authed) {
    showLoginScreen();
    return; // stop — don't fire any /api calls if not logged in
  }
  renderUserChip();
  // Warm the AI loader ETA cache so the first parse shows a calibrated estimate
  // (median from the user's prior calls across all devices).
  if (typeof prefetchLoaderStats === 'function') prefetchLoaderStats();
  loadToday();
  maybeShowOnboarding();
})();
