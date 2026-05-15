// ---------- Auth: Discord login check + logout ----------
// Runs before init. If not logged in, shows the login screen and stops the rest of the app
// from loading. If logged in, populates state.user and lets the normal init proceed.

async function checkAuth() {
  try {
    const r = await fetch('/api/me');
    if (r.ok) {
      state.user = await r.json();
      return true;
    }
  } catch (_) {}
  return false;
}

function showLoginScreen() {
  const el = document.getElementById('loginScreen');
  if (el) el.classList.remove('hidden');
}
function hideLoginScreen() {
  const el = document.getElementById('loginScreen');
  if (el) el.classList.add('hidden');
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  state.user = null;
  location.reload();
}

function renderUserChip() {
  if (!state.user) return;
  const el = document.getElementById('userChip');
  if (!el) return;
  const name = state.user.global_name || state.user.username;
  const avatar = state.user.avatar
    ? `https://cdn.discordapp.com/avatars/${state.user.id}/${state.user.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${(parseInt(state.user.id) >> 22) % 6}.png`;
  el.innerHTML = `
    <img class="user-chip-avatar" src="${avatar}" alt="" />
    <span class="user-chip-name">${escapeHtml(name)}</span>
    <button class="user-chip-logout" id="userLogoutBtn" title="Logout">⏻</button>
  `;
  const btn = document.getElementById('userLogoutBtn');
  if (btn) btn.addEventListener('click', logout);
}
