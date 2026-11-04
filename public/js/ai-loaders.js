// ---------- AI loaders ----------
// Currently only the dino runner is active. The pot/whisk/pong builders below
// stay in the file as dormant code in case we want to bring them back later —
// they're just not referenced from AI_LOADERS.

const AI_LOADERS = ['dino'];
const AI_MESSAGES = {
  dino: ['Running for your data…', 'Sprinting through USDA…', 'Outrunning the kcal…', 'Hopping the cactus of nutrition…']
};

// ====== DINO ======
// Pixel-art sprite for the little running dino on pending meal rows.
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

// The game itself lives in dino-runner.js; the loader just gives it somewhere to draw.
function aiLoaderDinoMarkup() {
  return '<div class="ai-game"></div>';
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

  if (variant === 'dino') el._dinoGame = createDinoRunner(el.querySelector('.ai-game'), { height: 110 });

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
