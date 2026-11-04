// ---------- DINO RUNNER ----------
// A short endless runner for the AI waits: tap, Space or ↑ to jump (hold for a little
// more height). Cacti have to be jumped; birds fly at head height once you jump, so
// stay on the ground when one comes. It speeds up fast because parses are quick now.
// Drawn on a canvas so it fits any width, coloured from the theme variables. Your top
// ten runs are kept in this browser.

const RUNNER_SCORES_KEY = 'dinoScores';
const RUNNER_OLD_HIGH_KEY = 'dinoHigh';

function runnerScores() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(RUNNER_SCORES_KEY) || '[]'); } catch (_) {}
  if (!Array.isArray(list)) list = [];
  // Carry over the single high score the old dino game kept.
  try {
    const old = Number(localStorage.getItem(RUNNER_OLD_HIGH_KEY));
    if (old > 0 && !list.length) {
      list = [{ score: old, at: null }];
      localStorage.setItem(RUNNER_SCORES_KEY, JSON.stringify(list));
    }
  } catch (_) {}
  return list.filter(r => r && Number.isFinite(r.score)).sort((a, b) => b.score - a.score).slice(0, 10);
}

// Adds a run; returns its place (1-10) on the board, or 0 if it didn't make it.
function recordRunnerScore(score) {
  if (score <= 0) return 0;
  const run = { score, at: new Date().toISOString() };
  const list = [...runnerScores(), run].sort((a, b) => b.score - a.score).slice(0, 10);
  try { localStorage.setItem(RUNNER_SCORES_KEY, JSON.stringify(list)); } catch (_) {}
  return list.indexOf(run) + 1;
}

// The one runner that currently gets Space / ↑ (the most recently shown).
let activeRunner = null;
document.addEventListener('keydown', (e) => {
  if (!activeRunner || !activeRunner.isVisible()) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowUp') { e.preventDefault(); activeRunner.press(); }
});
document.addEventListener('keyup', (e) => {
  if (activeRunner && (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowUp')) activeRunner.release();
});

// Pixel dino, 17×18 cells. Legs come in two frames.
const RUNNER_DINO = [[8, 0, 8, 1], [7, 1, 10, 4], [7, 5, 5, 1], [7, 6, 8, 1], [0, 6, 1, 3], [1, 8, 1, 2], [2, 9, 2, 2],
  [4, 7, 7, 6], [11, 8, 2, 1], [12, 9, 1, 1], [5, 13, 5, 1]];
const RUNNER_LEGS = [[[5, 14, 1, 4], [9, 14, 1, 2]], [[5, 14, 1, 2], [9, 14, 1, 4]]];
const RUNNER_EYE = [9, 2, 1, 1];

// host: an empty element to draw into. opts.height: canvas height in CSS px.
// opts.onState(phase): called with 'idle' | 'playing' | 'over'.
function createDinoRunner(host, { height = 112, onState = () => {} } = {}) {
  host.innerHTML = `
    <div class="runner">
      <div class="runner-hud">
        <span class="runner-score" aria-live="off">00000</span>
        <span class="runner-best"></span>
        <button class="runner-board-btn" type="button" aria-expanded="false">Top runs</button>
      </div>
      <canvas class="runner-canvas" tabindex="0" role="img"
        aria-label="Dino runner. Tap, or press Space or the up arrow, to jump over cacti. Don't jump into birds."></canvas>
      <ol class="runner-board hidden" aria-label="Your top runs"></ol>
    </div>`;
  const canvas = host.querySelector('.runner-canvas');
  const ctx = canvas.getContext('2d');
  const scoreEl = host.querySelector('.runner-score');
  const bestEl = host.querySelector('.runner-best');
  const boardBtn = host.querySelector('.runner-board-btn');
  const boardEl = host.querySelector('.runner-board');
  const fmt = n => String(Math.max(0, Math.floor(n))).padStart(5, '0');

  const S = 2;                 // pixel scale for sprites
  const DINO_W = 17 * S, DINO_H = 18 * S;
  const DINO_X = 18;
  const GRAVITY = 0.85, JUMP_V = -10.2, HOLD = -0.32, HOLD_FRAMES = 9;
  const BASE_SPEED = 5.2, RAMP = 0.0045, MAX_SPEED = 11.5;

  let W = 320, H = height, ground = H - 14;
  let colors = {};
  let game, raf = null, lastTs = 0, held = false, lastPlace = 0, destroyed = false;

  function readColors() {
    const css = getComputedStyle(document.documentElement);
    const v = name => css.getPropertyValue(name).trim();
    colors = { text: v('--text'), dim: v('--text-dim'), accent: v('--accent'), warn: v('--warn'), border: v('--border'), bg: v('--panel') };
  }

  function size() {
    const w = Math.max(240, Math.round(host.clientWidth || 320));
    const dpr = window.devicePixelRatio || 1;
    W = w; H = height; ground = H - 14;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function newGame(phase) {
    game = { phase, y: 0, vy: 0, jumping: false, holdFrames: 0, speed: BASE_SPEED, score: 0, frame: 0, obstacles: [], groundX: 0, nextGap: 260 };
  }

  function best() { const list = runnerScores(); return list.length ? list[0].score : 0; }
  function renderHud() {
    scoreEl.textContent = fmt(game.score);
    const b = Math.max(best(), Math.floor(game.score));
    bestEl.textContent = b ? `BEST ${fmt(b)}` : '';
  }

  function renderBoard() {
    const list = runnerScores();
    boardEl.innerHTML = list.length ? list.map((r, i) => `
      <li class="${i + 1 === lastPlace ? 'latest' : ''}">
        <span class="rb-rank">${i + 1}</span>
        <span class="rb-score">${r.score.toLocaleString()}</span>
        <span class="rb-when">${r.at ? runnerWhen(r.at) : 'earlier'}</span>
      </li>`).join('') : '<li class="rb-empty">No runs yet. Your best ten land here.</li>';
  }

  boardBtn.addEventListener('click', () => {
    const open = boardEl.classList.toggle('hidden') === false;
    boardBtn.setAttribute('aria-expanded', String(open));
    if (open) renderBoard();
  });

  // ----- obstacles -----
  function spawn() {
    const birdsOk = game.score > 120;
    const r = Math.random();
    let o;
    if (birdsOk && r < 0.22) o = { kind: 'bird', w: 30, h: 16, lift: 46 + Math.random() * 10 };
    else if (r < 0.55) o = { kind: 'cactus', w: 12, h: 26 };
    else if (r < 0.85) o = { kind: 'cactus', w: 18, h: 34 };
    else o = { kind: 'cactus2', w: 30, h: 26 };
    o.x = W + 10;
    game.obstacles.push(o);
    // Gap in frames, so it stays fair as speed climbs.
    game.nextGap = game.speed * (34 + Math.random() * 38) + (o.kind === 'cactus2' ? 40 : 0);
  }

  function hit() {
    const d = { x: DINO_X + 6, y: ground - DINO_H + 4 + game.y, w: DINO_W - 12, h: DINO_H - 6 };
    return game.obstacles.some(o => {
      const top = o.kind === 'bird' ? ground - o.lift - o.h : ground - o.h;
      const b = { x: o.x + 2, y: top + 2, w: o.w - 4, h: o.h - 4 };
      return d.x < b.x + b.w && d.x + d.w > b.x && d.y < b.y + b.h && d.y + d.h > b.y;
    });
  }

  // ----- drawing -----
  function rects(list, ox, oy, color) {
    ctx.fillStyle = color;
    list.forEach(([x, y, w, h]) => ctx.fillRect(ox + x * S, oy + y * S, w * S, h * S));
  }

  function drawDino() {
    const ox = DINO_X, oy = ground - DINO_H + game.y;
    rects(RUNNER_DINO, ox, oy, colors.text);
    const legs = game.phase === 'playing' && !game.jumping ? RUNNER_LEGS[Math.floor(game.frame / 6) % 2] : RUNNER_LEGS[0];
    rects(legs, ox, oy, colors.text);
    rects([RUNNER_EYE], ox, oy, colors.bg);
  }

  function drawCactus(x, w, h) {
    ctx.fillStyle = colors.accent;
    const stem = Math.max(4, Math.round(w / 3));
    const sx = x + Math.round((w - stem) / 2);
    ctx.fillRect(sx, ground - h, stem, h);
    ctx.fillRect(x, ground - h * 0.7, stem - 1, h * 0.35);
    ctx.fillRect(x, ground - h * 0.42, sx - x + 1, 3);
    ctx.fillRect(x + w - stem + 1, ground - h * 0.8, stem - 1, h * 0.35);
    ctx.fillRect(sx + stem - 1, ground - h * 0.52, x + w - (sx + stem) + 1, 3);
  }

  function drawBird(o) {
    const y = ground - o.lift - o.h;
    ctx.fillStyle = colors.warn;
    ctx.fillRect(o.x + 6, y + 6, 20, 6);          // body
    ctx.fillRect(o.x, y + 7, 7, 3);                // beak
    const up = Math.floor(game.frame / 10) % 2;
    ctx.fillRect(o.x + 10, up ? y : y + 11, 10, 5); // wing
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // Ground: a dashed line that scrolls with the run.
    ctx.fillStyle = colors.border;
    const dash = 14, gap = 10, off = game.groundX % (dash + gap);
    for (let x = -off; x < W; x += dash + gap) ctx.fillRect(x, ground + 1, dash, 2);
    game.obstacles.forEach(o => {
      if (o.kind === 'bird') drawBird(o);
      else if (o.kind === 'cactus2') { drawCactus(o.x, 14, o.h); drawCactus(o.x + 16, 14, o.h - 4); }
      else drawCactus(o.x, o.w, o.h);
    });
    drawDino();
    if (game.phase !== 'playing') {
      // A soft panel behind the message so it stays readable over cacti.
      const boxW = Math.min(W - 80, 280), boxH = game.phase === 'idle' ? 30 : 50;
      const mid = W / 2 + 20;
      ctx.fillStyle = colors.bg;
      ctx.globalAlpha = 0.88;
      ctx.fillRect(mid - boxW / 2, H / 2 - (game.phase === 'idle' ? 23 : 32), boxW, boxH);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.dim;
      ctx.font = '600 13px Manrope, system-ui, sans-serif';
      ctx.textAlign = 'center';
      if (game.phase === 'idle') {
        ctx.fillText('Tap or press Space to play', mid, H / 2 - 4);
      } else {
        ctx.fillStyle = colors.text;
        ctx.fillText(lastPlace === 1 ? `New best · ${Math.floor(game.score)}` : `Game over · ${Math.floor(game.score)}`, mid, H / 2 - 12);
        ctx.fillStyle = colors.dim;
        ctx.font = '500 12px Manrope, system-ui, sans-serif';
        ctx.fillText(lastPlace ? `#${lastPlace} of your top runs · tap to go again` : 'Tap to go again', mid, H / 2 + 8);
      }
    }
  }

  // ----- loop -----
  function tick(ts) {
    if (destroyed || !host.isConnected) { stop(); return; }
    const dt = lastTs ? Math.min(2.5, (ts - lastTs) / (1000 / 60)) : 1;
    lastTs = ts;
    game.frame += dt;

    game.vy += GRAVITY * dt;
    if (held && game.jumping && game.vy < 0 && game.holdFrames < HOLD_FRAMES) { game.vy += HOLD * dt; game.holdFrames += dt; }
    game.y += game.vy * dt;
    if (game.y >= 0) { game.y = 0; game.vy = 0; game.jumping = false; }

    game.speed = Math.min(MAX_SPEED, game.speed + RAMP * dt);
    const move = game.speed * dt;
    game.groundX += move;
    game.obstacles.forEach(o => { o.x -= move; });
    game.obstacles = game.obstacles.filter(o => o.x + o.w > -10);
    const last = game.obstacles[game.obstacles.length - 1];
    if (game.frame > 40 && (!last || W - (last.x + last.w) > game.nextGap)) spawn();

    game.score += move / 9;
    renderHud();
    if (hit()) { over(); return; }
    draw();
    raf = requestAnimationFrame(tick);
  }

  function stop() { if (raf != null) cancelAnimationFrame(raf); raf = null; }

  function start() {
    newGame('playing');
    lastPlace = 0;
    lastTs = 0;
    readColors();
    onState('playing');
    stop();
    raf = requestAnimationFrame(tick);
  }

  function over() {
    stop();
    game.phase = 'over';
    lastPlace = recordRunnerScore(Math.floor(game.score));
    renderHud();
    draw();
    if (!boardEl.classList.contains('hidden')) renderBoard();
    onState('over');
  }

  function press() {
    held = true;
    if (game.phase !== 'playing') { start(); return; }
    if (!game.jumping) { game.vy = JUMP_V; game.jumping = true; game.holdFrames = 0; }
  }
  function release() { held = false; }

  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); activeRunner = runner; press(); });
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', release);

  const resize = new ResizeObserver(() => { if (!destroyed) { size(); if (game.phase !== 'playing') draw(); } });
  resize.observe(host);

  readColors();
  size();
  newGame('idle');
  renderHud();
  draw();

  const runner = {
    press, release,
    phase: () => game.phase,
    isVisible: () => host.isConnected && host.offsetParent !== null,
    destroy() {
      destroyed = true;
      stop();
      resize.disconnect();
      if (activeRunner === runner) activeRunner = null;
    }
  };
  activeRunner = runner;
  return runner;
}

function runnerWhen(iso) {
  const d = new Date(iso);
  const today = fmtDate(new Date());
  const day = fmtDate(d);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (day === today) return `today ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
