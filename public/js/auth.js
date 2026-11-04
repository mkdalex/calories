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
  const name = state.user.global_name || state.user.username;
  const avatar = state.user.avatar
    ? `https://cdn.discordapp.com/avatars/${state.user.id}/${state.user.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${(parseInt(state.user.id) >> 22) % 6}.png`;

  // Profile account card (mobile has no top bar, so log out lives here)
  const acct = document.getElementById('accountUser');
  if (acct) {
    acct.innerHTML = `
      <img class="account-avatar" src="${avatar}" alt="" />
      <span><span class="account-name">${escapeHtml(name)}</span><span class="account-sub">Signed in with Discord</span></span>
    `;
  }
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = logout;

  // Desktop sidebar user block
  const sbAvatar = document.getElementById('sbUserAvatar');
  if (sbAvatar) sbAvatar.innerHTML = `<img src="${avatar}" alt="" />`;
  const sbName = document.getElementById('sbUserName');
  if (sbName) sbName.textContent = name;
}
