// ---------- AI loaders ----------
// Currently only the dino runner is active. The pot/whisk/pong builders below
// stay in the file as dormant code in case we want to bring them back later —
// they're just not referenced from AI_LOADERS.

const AI_LOADERS = ['dino'];
const AI_MESSAGES = {
  dino:  ['Running for your data…', 'Sprinting through USDA…', 'Outrunning the kcal…', 'Hopping the cactus of nutrition…'],
  // Dormant — kept for posterity.
  pot:   ['Tasting your food…', 'Letting the chef sniff…', 'Counting the calories…', 'Reading the label…'],
  pong:  ['AI vs Database — best of 7…', 'Volleying for the answer…', 'Match point coming up…'],
  whisk: ['Whisking the macros…', 'Stirring the database…', 'Folding in fiber…']
};

// ====== DINO ======
// Pixel-art sprite, shared between the player and (eventually) decorative uses.
function dinoSpriteSVG() {
  return `
    <svg class="dino-sprite-svg" viewBox="0 0 44 44" width="44" height="44" aria-hidden="true" shape-rendering="crispEdges">
      <g fill="var(--text)">
        <!-- Head -->
        <rect x="22" y="2"  width="20" height="16"/>
        <rect x="20" y="6"  width="2"  height="10"/>
        <!-- Eye -->
        <rect x="36" y="6"  width="3" height="3" fill="var(--bg)"/>
        <rect x="37" y="7"  width="1" height="1" fill="var(--text)"/>
        <!-- Mouth -->
        <rect x="38" y="14" width="4" height="2" fill="var(--bg)"/>
        <!-- Neck/back -->
        <rect x="12" y="16" width="24" height="14"/>
        <!-- Belly -->
        <rect x="6"  y="20" width="14" height="10"/>
        <!-- Tiny arm -->
        <rect x="22" y="22" width="4"  height="2"/>
        <!-- Tail -->
        <rect x="0"  y="22" width="6"  height="4"/>
        <!-- Legs (animate to fake running while playing) -->
        <g class="dino-leg dino-leg-l">
          <rect x="10" y="30" width="4" height="10"/>
          <rect x="8"  y="38" width="8" height="2"/>
        </g>
        <g class="dino-leg dino-leg-r">
          <rect x="22" y="30" width="4" height="10"/>
          <rect x="20" y="38" width="8" height="2"/>
        </g>
      </g>
    </svg>`;
}

function cactusSmallSVG() {
  return `
    <svg viewBox="0 0 14 28" width="14" height="28" aria-hidden="true" shape-rendering="crispEdges">
      <g fill="var(--accent)">
        <rect x="5" y="0"  width="4" height="28"/>
        <rect x="0" y="10" width="4" height="10"/>
        <rect x="0" y="10" width="6" height="2"/>
      </g>
    </svg>`;
}

function cactusLargeSVG() {
  return `
    <svg viewBox="0 0 22 36" width="22" height="36" aria-hidden="true" shape-rendering="crispEdges">
      <g fill="var(--accent)">
        <rect x="9" y="0"  width="4" height="36"/>
        <rect x="0" y="10" width="4" height="14"/>
        <rect x="0" y="10" width="6" height="2"/>
        <rect x="18" y="6" width="4" height="14"/>
        <rect x="16" y="6" width="6" height="2"/>
      </g>
    </svg>`;
}

function aiLoaderDinoMarkup() {
  return `
    <div class="dino-game" tabindex="0">
      <div class="dino-hud">
        <span class="dino-score">00000</span>
        <span class="dino-high">HI 00000</span>
      </div>
      <div class="dino-stage">
        <div class="dino-sprite">${dinoSpriteSVG()}</div>
        <div class="dino-ground"></div>
        <div class="dino-overlay">
          <div class="dino-overlay-msg">Press SPACE or tap to play</div>
        </div>
      </div>
    </div>`;
}

// Playable dino game. Mounted onto the loader element; tears down cleanly when
// the AI response arrives (clearAILoader is called on innerHTML replacement).
function startDinoGame(loaderEl) {
  const root  = loaderEl.querySelector('.dino-game');
  const stage = loaderEl.querySelector('.dino-stage');
  const dinoEl = loaderEl.querySelector('.dino-sprite');
  const overlay = loaderEl.querySelector('.dino-overlay');
  const overlayMsg = overlay.querySelector('.dino-overlay-msg');
  const scoreEl = loaderEl.querySelector('.dino-score');
  const highEl  = loaderEl.querySelector('.dino-high');
  if (!root || !stage || !dinoEl) return;

  // Tuning constants. Frame-based (rAF ~60fps); short delta-time correction so
  // the game still feels right on a 144Hz monitor without rewriting physics.
  const STAGE_W = 320;
  const GROUND_PX = 64;        // arbitrary baseline for collision math — both
                               // dino and obstacle boxes use this so the value
                               // itself doesn't need to match CSS pixel-perfect.
  const GRAVITY = 0.55;
  const JUMP_V = -7.5;         // tap-jump peaks ~50px, hold adds ~20px
  const JUMP_HOLD = -0.15;
  const MAX_HOLD_FRAMES = 6;
  const BASE_SPEED = 3.2;
  const SPEED_RAMP = 0.0014;   // gentle ramp — game gets harder but not punishing
  const MAX_SPEED = 7.5;
  const FIRST_SPAWN_DELAY = 65;

  const HIGH_KEY = 'dinoHigh';
  const fmt = n => String(Math.max(0, Math.floor(n))).padStart(5, '0');

  const state = {
    y: 0, vy: 0, jumpFrames: 0, isJumping: false,
    obstacles: [],
    speed: BASE_SPEED,
    score: 0,
    high: Number(localStorage.getItem(HIGH_KEY) || 0),
    phase: 'idle',     // 'idle' | 'playing' | 'gameover'
    inputHeld: false,
    rafId: null,
    frame: 0,
    lastTs: 0
  };

  highEl.textContent = `HI ${fmt(state.high)}`;

  function spawnObstacle() {
    const type = Math.random() < 0.7 ? 'small' : 'large';
    const node = document.createElement('div');
    node.className = `dino-obstacle dino-obstacle-${type}`;
    node.innerHTML = type === 'small' ? cactusSmallSVG() : cactusLargeSVG();
    stage.appendChild(node);
    state.obstacles.push({
      node, x: STAGE_W,
      w: type === 'small' ? 14 : 22,
      h: type === 'small' ? 28 : 36
    });
  }

  function maybeSpawn() {
    if (state.frame < FIRST_SPAWN_DELAY) return;
    const last = state.obstacles[state.obstacles.length - 1];
    const gap = 110 + Math.random() * 130;    // scales naturally with speed
    if (!last || (STAGE_W - last.x) > gap) spawnObstacle();
  }

  function collides() {
    // Tightened hitboxes (the sprite has empty padding) so the game feels fair.
    const dinoBox = { x: 32, y: GROUND_PX - 36 + state.y, w: 28, h: 32 };
    for (const o of state.obstacles) {
      const ob = { x: o.x + 2, y: GROUND_PX - o.h + 4, w: o.w - 4, h: o.h - 6 };
      if (dinoBox.x < ob.x + ob.w &&
          dinoBox.x + dinoBox.w > ob.x &&
          dinoBox.y < ob.y + ob.h &&
          dinoBox.y + dinoBox.h > ob.y) return true;
    }
    return false;
  }

  function tick(ts) {
    // Self-clean: if the loader DOM was replaced (AI response landed, modal
    // closed, etc.), abandon the loop and detach listeners. Belt-and-braces
    // alongside clearAILoader's explicit destroy().
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup',   onKeyUp);
      return;
    }
    // dt normalized to 60fps frame-units, clamped so a tab switch doesn't teleport
    const raw = state.lastTs ? (ts - state.lastTs) / (1000 / 60) : 1;
    const dt = Math.min(2.5, raw);
    state.lastTs = ts;
    state.frame++;

    if (state.phase === 'playing') {
      // Physics
      state.vy += GRAVITY * dt;
      if (state.inputHeld && state.jumpFrames < MAX_HOLD_FRAMES && state.isJumping && state.vy < 0) {
        state.vy += JUMP_HOLD * dt;
        state.jumpFrames += dt;
      }
      state.y += state.vy * dt;
      if (state.y >= 0) {
        state.y = 0; state.vy = 0; state.isJumping = false; state.jumpFrames = 0;
        root.classList.remove('jumping');
      }

      // World movement
      state.speed = Math.min(MAX_SPEED, state.speed + SPEED_RAMP * dt);
      state.obstacles.forEach(o => { o.x -= state.speed * dt; });
      state.obstacles = state.obstacles.filter(o => {
        if (o.x < -50) { o.node.remove(); return false; }
        return true;
      });
      maybeSpawn();

      // Score (~10/sec at base speed, scales with speed = harder = more points)
      state.score += 0.16 * dt * (state.speed / BASE_SPEED);
      scoreEl.textContent = fmt(state.score);

      if (collides()) { gameOver(); }
    }

    // Render
    dinoEl.style.transform = `translateY(${state.y.toFixed(1)}px)`;
    state.obstacles.forEach(o => { o.node.style.transform = `translateX(${o.x.toFixed(1)}px)`; });

    state.rafId = requestAnimationFrame(tick);
  }

  function jump() {
    if (state.phase === 'idle') { start(); return; }
    if (state.phase === 'gameover') { reset(); return; }
    if (state.phase === 'playing' && !state.isJumping) {
      state.vy = JUMP_V;
      state.isJumping = true;
      state.jumpFrames = 0;
      root.classList.add('jumping');
    }
  }

  function start() {
    state.phase = 'playing';
    overlay.classList.add('hidden');
    root.classList.add('running');
  }

  function gameOver() {
    state.phase = 'gameover';
    root.classList.remove('running', 'jumping');
    const finalScore = Math.floor(state.score);
    let newRecord = false;
    if (finalScore > state.high) {
      state.high = finalScore;
      newRecord = true;
      try { localStorage.setItem(HIGH_KEY, String(finalScore)); } catch (_) {}
      highEl.textContent = `HI ${fmt(finalScore)}`;
    }
    overlayMsg.innerHTML = newRecord
      ? `<span class="dino-record">NEW HI ${fmt(finalScore)}</span><span class="dino-retry-hint">space / tap to retry</span>`
      : `<span class="dino-gameover">GAME OVER · ${fmt(finalScore)}</span><span class="dino-retry-hint">space / tap to retry</span>`;
    overlay.classList.remove('hidden');
  }

  function reset() {
    state.obstacles.forEach(o => o.node.remove());
    state.obstacles = [];
    state.y = 0; state.vy = 0; state.isJumping = false; state.jumpFrames = 0;
    state.speed = BASE_SPEED;
    state.score = 0;
    state.frame = 0;
    scoreEl.textContent = fmt(0);
    overlay.classList.add('hidden');
    state.phase = 'playing';
    root.classList.add('running');
  }

  // --- Input ---
  function onKeyDown(e) {
    // Don't hijack typing in inputs/textareas.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowUp') {
      e.preventDefault();
      state.inputHeld = true;
      jump();
    }
  }
  function onKeyUp(e) {
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowUp') {
      state.inputHeld = false;
    }
  }
  function onPointerDown(e) {
    e.preventDefault();
    state.inputHeld = true;
    jump();
  }
  function onPointerUp() { state.inputHeld = false; }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup',   onKeyUp);
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointerup',   onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('pointerleave',  onPointerUp);

  state.rafId = requestAnimationFrame(tick);

  // Expose teardown so clearAILoader can stop everything cleanly.
  loaderEl._dinoGame = {
    destroy() {
      if (state.rafId) cancelAnimationFrame(state.rafId);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup',   onKeyUp);
      // Stage listeners die with the DOM, no need to detach explicitly.
    }
  };
}

// ====== Dormant builders (kept for future use) ======
/* eslint-disable no-unused-vars */
function aiLoaderPotSVG() {
  return `
    <svg class="ail-svg ail-pot-svg" viewBox="0 0 120 150" width="120" height="150" aria-hidden="true">
      <defs>
        <linearGradient id="ailFlameGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stop-color="#fbbf24" />
          <stop offset="60%" stop-color="#f97316" />
          <stop offset="100%" stop-color="#dc2626" />
        </linearGradient>
        <radialGradient id="ailSoupGrad" cx="0.5" cy="0.5" r="0.6">
          <stop offset="0%" stop-color="#f4a273" />
          <stop offset="100%" stop-color="#c45a36" />
        </radialGradient>
      </defs>
      <g class="ail-steam">
        <path class="wisp w1" d="M 40 60 Q 35 45 42 30 Q 49 18 42 5"/>
        <path class="wisp w2" d="M 60 60 Q 55 45 62 30 Q 69 18 62 5"/>
        <path class="wisp w3" d="M 80 60 Q 75 45 82 30 Q 89 18 82 5"/>
      </g>
      <path d="M 14 92 Q 4 86 12 76" fill="none" stroke="#181a1f" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M 106 92 Q 116 86 108 76" fill="none" stroke="#181a1f" stroke-width="3.5" stroke-linecap="round"/>
      <ellipse cx="60" cy="72" rx="40" ry="6" fill="#1f2228"/>
      <path d="M 20 72 L 20 118 Q 20 128 30 131 L 90 131 Q 100 128 100 118 L 100 72 Z" fill="#2a2e36" stroke="#0d0e11" stroke-width="1.5"/>
      <ellipse cx="60" cy="72" rx="38" ry="4.5" fill="#0d0e11"/>
      <ellipse class="ail-pot-surface" cx="60" cy="71" rx="36" ry="3.8" fill="url(#ailSoupGrad)"/>
      <circle class="ail-pot-bubble bubble1" cx="46" cy="71" r="2.4" fill="#fbcb9b"/>
      <circle class="ail-pot-bubble bubble2" cx="62" cy="72" r="3"   fill="#fbcb9b"/>
      <circle class="ail-pot-bubble bubble3" cx="74" cy="70" r="1.9" fill="#fbcb9b"/>
      <circle class="ail-pot-bubble bubble4" cx="55" cy="73" r="1.6" fill="#fbcb9b"/>
      <ellipse cx="46" cy="69" rx="9" ry="1.2" fill="rgba(255,255,255,0.35)"/>
      <g class="ail-flame">
        <path d="M 48 132 Q 42 142 52 144 Q 56 152 60 144 Q 64 152 68 144 Q 78 142 72 132 Q 66 134 60 128 Q 54 134 48 132 Z" fill="url(#ailFlameGrad)"/>
        <path d="M 54 138 Q 52 144 58 145 Q 60 148 62 145 Q 68 144 66 138 Q 62 140 60 136 Q 58 140 54 138 Z" fill="#fde68a" opacity="0.9"/>
      </g>
    </svg>`;
}
function aiLoaderWhiskSVG() {
  return `<svg class="ail-svg ail-whisk-svg" viewBox="0 0 120 130" width="120" height="130" aria-hidden="true"></svg>`;
}
function aiLoaderPongSVG() {
  return `<div class="ail-pong-court"><div class="paddle left"></div><div class="ball"></div><div class="paddle right"></div></div>`;
}
/* eslint-enable no-unused-vars */

const AI_LOADER_BUILDERS = {
  dino: aiLoaderDinoMarkup
};

// ====== ETA tracking ======
// Median + sample count come from /api/loader-stats so the calibration
// follows the user across devices (phone PWA, desktop browser, Electron)
// instead of starting from scratch in each browser's localStorage.
const ETA_DEFAULT_MS = 5000;
const ETA_MIN_SAMPLES = 4;
let _cachedMedianMs = null;
let _cachedSampleCount = 0;

async function prefetchLoaderStats() {
  try {
    const r = await api('/api/loader-stats');
    if (r && typeof r.samples_count === 'number') _cachedSampleCount = r.samples_count;
    if (r && typeof r.median_ms === 'number')     _cachedMedianMs = r.median_ms;
  } catch (_) { /* ignore — fall back to default */ }
}
function loaderMedianMs() {
  return _cachedMedianMs && _cachedSampleCount >= ETA_MIN_SAMPLES
    ? _cachedMedianMs
    : ETA_DEFAULT_MS;
}
function _recordEtaSample(ms) {
  // Fire and forget — never block the user's flow on stats writes.
  fetch('/api/loader-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ duration_ms: Math.round(ms) })
  }).then(r => r.json()).then(r => {
    if (r && typeof r.samples_count === 'number') _cachedSampleCount = r.samples_count;
    // Refresh cached median in the background so future loaders use the new value.
    prefetchLoaderStats();
  }).catch(() => {});
}

// Progress curve: linear to ~88% at the expected time, then asymptotic toward
// ~99% so the bar never reaches 100% during loading — it only completes when
// the response actually lands. Avoids the "100% bar but still waiting" lie.
function progressPercent(elapsed, estimated) {
  if (!estimated || estimated <= 0) return 50;
  if (elapsed <= estimated) return (elapsed / estimated) * 88;
  const overrun = elapsed - estimated;
  return 88 + 11 * (1 - Math.exp(-overrun / estimated));
}

function showAILoader(el, fixedMsg) {
  if (!el) return;
  clearAILoader(el);
  const variant = AI_LOADERS[Math.floor(Math.random() * AI_LOADERS.length)];
  const msgs = AI_MESSAGES[variant];
  const buildBody = AI_LOADER_BUILDERS[variant];

  const estimatedMs = loaderMedianMs();
  // Always show an estimate; once we have ≥4 samples it's the user's real median,
  // before that it's the default. Either way the bar paces against estimatedMs.
  const etaLabel = `~${Math.round(estimatedMs / 1000)}s`;

  el.innerHTML = `
    <div class="ai-loader ai-loader-${variant}">
      ${buildBody()}
      <div class="ai-eta-row">
        <span class="ai-msg">${fixedMsg || msgs[0]}</span>
        <span class="ai-eta-label">${etaLabel}</span>
      </div>
      <div class="ai-eta-track"><div class="ai-eta-fill"></div></div>
    </div>`;

  // Boot the playable dino once its DOM exists.
  if (variant === 'dino') startDinoGame(el);

  // ETA bar + duration recording. The rAF self-detects when the loader DOM
  // was replaced (AI response landed) and records the elapsed time so future
  // estimates calibrate to this user's real call latency.
  const loaderRoot = el.querySelector('.ai-loader');
  const fillEl = el.querySelector('.ai-eta-fill');
  const startTs = performance.now();
  el._aiLoaderStart = startTs;
  function etaTick() {
    if (!loaderRoot || !loaderRoot.isConnected) {
      const elapsed = performance.now() - startTs;
      // Only count "real" completions (300ms+) so super-fast cached responses
      // don't drag the median to misleadingly small values.
      if (elapsed > 300) _recordEtaSample(elapsed);
      return;
    }
    const elapsed = performance.now() - startTs;
    if (fillEl) fillEl.style.width = progressPercent(elapsed, estimatedMs).toFixed(1) + '%';
    el._aiEtaRaf = requestAnimationFrame(etaTick);
  }
  el._aiEtaRaf = requestAnimationFrame(etaTick);

  if (!fixedMsg) {
    let i = 0;
    el._aiLoaderInterval = setInterval(() => {
      const msgEl = el.querySelector('.ai-msg');
      if (!msgEl) { clearAILoader(el); return; }
      i = (i + 1) % msgs.length;
      msgEl.style.opacity = '0';
      setTimeout(() => {
        if (!msgEl.isConnected) return;
        msgEl.textContent = msgs[i];
        msgEl.style.opacity = '1';
      }, 180);
    }, 2200);
  }
}

function clearAILoader(el) {
  if (!el) return;
  if (el._aiLoaderInterval) {
    clearInterval(el._aiLoaderInterval);
    delete el._aiLoaderInterval;
  }
  if (el._aiEtaRaf) {
    cancelAnimationFrame(el._aiEtaRaf);
    delete el._aiEtaRaf;
  }
  if (el._dinoGame) {
    el._dinoGame.destroy();
    delete el._dinoGame;
  }
  // Note: explicit clearAILoader (modal close, etc.) deliberately does NOT
  // record a duration sample — that's a user cancellation, not a real call.
  delete el._aiLoaderStart;
}
