// ---------- AI loaders ----------
// Currently only the dino runner is active. The pot/whisk/pong builders below
// stay in the file as dormant code in case we want to bring them back later —
// they're just not referenced from AI_LOADERS.

const AI_LOADERS = ['dino'];
const AI_MESSAGES = {
  dino: ['Running for your data…', 'Sprinting through USDA…', 'Outrunning the kcal…', 'Hopping the cactus of nutrition…']
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
  const JUMP_KEYS = new Set([' ', 'Spacebar', 'ArrowUp']);
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
    lastTs: 0,
    lastScoreText: ''
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
    // Self-clean if the loader DOM was replaced — belt-and-braces alongside
    // clearAILoader's explicit destroy().
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup',   onKeyUp);
      state.rafId = null;
      return;
    }
    // dt normalized to 60fps frame-units, clamped so a tab switch doesn't teleport
    const raw = state.lastTs ? (ts - state.lastTs) / (1000 / 60) : 1;
    const dt = Math.min(2.5, raw);
    state.lastTs = ts;
    state.frame++;

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

    state.speed = Math.min(MAX_SPEED, state.speed + SPEED_RAMP * dt);
    state.obstacles.forEach(o => { o.x -= state.speed * dt; });
    state.obstacles = state.obstacles.filter(o => {
      if (o.x < -50) { o.node.remove(); return false; }
      return true;
    });
    maybeSpawn();

    state.score += 0.16 * dt * (state.speed / BASE_SPEED);
    const nextScoreText = fmt(state.score);
    if (nextScoreText !== state.lastScoreText) {
      scoreEl.textContent = nextScoreText;
      state.lastScoreText = nextScoreText;
    }

    if (collides()) { gameOver(); return; }

    dinoEl.style.transform = `translateY(${state.y.toFixed(1)}px)`;
    state.obstacles.forEach(o => { o.node.style.transform = `translateX(${o.x.toFixed(1)}px)`; });

    state.rafId = requestAnimationFrame(tick);
  }
  function ensureRunning() {
    if (state.rafId == null) {
      state.lastTs = 0;
      state.rafId = requestAnimationFrame(tick);
    }
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
    ensureRunning();
  }

  function gameOver() {
    state.phase = 'gameover';
    root.classList.remove('running', 'jumping');
    if (state.rafId != null) { cancelAnimationFrame(state.rafId); state.rafId = null; }
    const finalScore = Math.floor(state.score);
    const newRecord = finalScore > state.high;
    if (newRecord) {
      state.high = finalScore;
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
    state.lastScoreText = '';
    scoreEl.textContent = fmt(0);
    overlay.classList.add('hidden');
    state.phase = 'playing';
    root.classList.add('running');
    ensureRunning();
  }

  function onKeyDown(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!JUMP_KEYS.has(e.key)) return;
    e.preventDefault();
    state.inputHeld = true;
    jump();
  }
  function onKeyUp(e) {
    if (JUMP_KEYS.has(e.key)) state.inputHeld = false;
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

  // No initial rAF — the loop only runs while state.phase === 'playing'.
  // Stage pointer listeners die with the DOM; only document keys need detaching.
  loaderEl._dinoGame = {
    destroy() {
      if (state.rafId != null) { cancelAnimationFrame(state.rafId); state.rafId = null; }
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup',   onKeyUp);
    }
  };
}

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
  api('/api/loader-stats', { method: 'POST', body: { duration_ms: Math.round(ms) } })
    .then(r => {
      if (!r) return;
      if (typeof r.samples_count === 'number') _cachedSampleCount = r.samples_count;
      if (typeof r.median_ms === 'number')     _cachedMedianMs = r.median_ms;
    })
    .catch(() => {});
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

  if (variant === 'dino') startDinoGame(el);

  // ETA bar + duration recording. setInterval (not rAF) because the bar already
  // has a 150ms CSS transition that smooths between updates — 60Hz writes would
  // be wasted. When the loader DOM is replaced (AI response landed) the interval
  // self-clears and records the elapsed time for future calibration.
  const loaderRoot = el.querySelector('.ai-loader');
  const fillEl = el.querySelector('.ai-eta-fill');
  const startTs = performance.now();
  el._aiEtaInterval = setInterval(() => {
    if (!loaderRoot || !loaderRoot.isConnected) {
      clearInterval(el._aiEtaInterval);
      delete el._aiEtaInterval;
      const elapsed = performance.now() - startTs;
      // Under 300ms is probably cached — don't let it drag the median down.
      if (elapsed > 300) _recordEtaSample(elapsed);
      return;
    }
    if (fillEl) fillEl.style.width = progressPercent(performance.now() - startTs, estimatedMs).toFixed(1) + '%';
  }, 150);

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
  // Explicit clearAILoader (modal close, etc.) deliberately does NOT record a
  // duration sample — that's a user cancellation, not a real call.
  if (!el) return;
  if (el._aiLoaderInterval) { clearInterval(el._aiLoaderInterval); delete el._aiLoaderInterval; }
  if (el._aiEtaInterval)    { clearInterval(el._aiEtaInterval);    delete el._aiEtaInterval; }
  if (el._dinoGame)         { el._dinoGame.destroy();              delete el._dinoGame; }
}
