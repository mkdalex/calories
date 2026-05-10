// ---------- AI loaders ----------
// Random animated loader shown while waiting on AI responses.
// Variant chosen at random each call so the user sees variety.

const AI_LOADERS = ['pot', 'pong', 'dino', 'whisk'];
const AI_MESSAGES = {
  pot:   ['Tasting your food…', 'Letting the chef sniff…', 'Counting the calories…', 'Reading the label…', 'Asking the simmer for permission…'],
  pong:  ['AI vs Database — best of 7…', 'Volleying for the answer…', 'Match point coming up…', 'Server is set…'],
  dino:  ['Running for your data…', 'Sprinting through USDA…', 'Outrunning the kcal…', 'Hopping the cactus of nutrition…'],
  whisk: ['Whisking the macros…', 'Stirring the database…', 'Folding in fiber…', 'Beating the AI for a number…']
};

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

      <!-- Steam wisps -->
      <g class="ail-steam">
        <path class="wisp w1" d="M 40 60 Q 35 45 42 30 Q 49 18 42 5"/>
        <path class="wisp w2" d="M 60 60 Q 55 45 62 30 Q 69 18 62 5"/>
        <path class="wisp w3" d="M 80 60 Q 75 45 82 30 Q 89 18 82 5"/>
      </g>

      <!-- Pot handles (drawn behind the body) -->
      <path d="M 14 92 Q 4 86 12 76" fill="none" stroke="#181a1f" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M 106 92 Q 116 86 108 76" fill="none" stroke="#181a1f" stroke-width="3.5" stroke-linecap="round"/>

      <!-- Pot body (rim) -->
      <ellipse cx="60" cy="72" rx="40" ry="6" fill="#1f2228"/>
      <!-- Pot body (cylinder) -->
      <path d="M 20 72 L 20 118 Q 20 128 30 131 L 90 131 Q 100 128 100 118 L 100 72 Z" fill="#2a2e36" stroke="#0d0e11" stroke-width="1.5"/>
      <!-- Inner shadow rim -->
      <ellipse cx="60" cy="72" rx="38" ry="4.5" fill="#0d0e11"/>
      <!-- Soup surface -->
      <ellipse class="ail-pot-surface" cx="60" cy="71" rx="36" ry="3.8" fill="url(#ailSoupGrad)"/>

      <!-- Surface bubbles -->
      <circle class="ail-pot-bubble bubble1" cx="46" cy="71" r="2.4" fill="#fbcb9b"/>
      <circle class="ail-pot-bubble bubble2" cx="62" cy="72" r="3"   fill="#fbcb9b"/>
      <circle class="ail-pot-bubble bubble3" cx="74" cy="70" r="1.9" fill="#fbcb9b"/>
      <circle class="ail-pot-bubble bubble4" cx="55" cy="73" r="1.6" fill="#fbcb9b"/>

      <!-- Highlight -->
      <ellipse cx="46" cy="69" rx="9" ry="1.2" fill="rgba(255,255,255,0.35)"/>

      <!-- Flame -->
      <g class="ail-flame">
        <path d="M 48 132 Q 42 142 52 144 Q 56 152 60 144 Q 64 152 68 144 Q 78 142 72 132 Q 66 134 60 128 Q 54 134 48 132 Z" fill="url(#ailFlameGrad)"/>
        <path d="M 54 138 Q 52 144 58 145 Q 60 148 62 145 Q 68 144 66 138 Q 62 140 60 136 Q 58 140 54 138 Z" fill="#fde68a" opacity="0.9"/>
      </g>
    </svg>`;
}

function aiLoaderWhiskSVG() {
  return `
    <svg class="ail-svg ail-whisk-svg" viewBox="0 0 120 130" width="120" height="130" aria-hidden="true">
      <!-- Bowl back lip -->
      <ellipse cx="60" cy="100" rx="44" ry="6" fill="#3a2c1f"/>
      <!-- Bowl body -->
      <path d="M 16 100 Q 16 122 60 122 Q 104 122 104 100 Z" fill="#5a4530" stroke="#2a1f12" stroke-width="1.5"/>
      <!-- Bowl inner -->
      <path d="M 19 100 Q 19 119 60 119 Q 101 119 101 100 Z" fill="#4a3a2a" opacity="0.6"/>
      <!-- Batter -->
      <ellipse cx="60" cy="98" rx="40" ry="4.5" fill="#f3d272"/>
      <ellipse cx="60" cy="97" rx="40" ry="3" fill="#fae28e"/>

      <!-- Splashes -->
      <circle class="ail-whisk-splash s1" cx="30" cy="92" r="2" fill="#fae28e"/>
      <circle class="ail-whisk-splash s2" cx="92" cy="93" r="1.6" fill="#fae28e"/>
      <circle class="ail-whisk-splash s3" cx="40" cy="86" r="1.4" fill="#fae28e"/>

      <!-- Whisk (group rotates) -->
      <g class="ail-whisk-rot">
        <!-- Handle -->
        <rect x="56" y="6"  width="8" height="42" rx="3" fill="#9b6f44"/>
        <rect x="56" y="6"  width="8" height="6" rx="3" fill="#6e4d2c"/>
        <!-- Cap connecting handle to wires -->
        <ellipse cx="60" cy="48" rx="6" ry="2.5" fill="#7a5a3a"/>
        <!-- Wires (4 curves making a balloon shape) -->
        <path d="M 60 48 Q 48 70 54 100 Q 58 102 60 100 Q 62 70 60 48" fill="none" stroke="#cfd2d6" stroke-width="1.6"/>
        <path d="M 60 48 Q 42 65 50 100 Q 56 102 60 100 Q 62 65 60 48" fill="none" stroke="#a3a8ad" stroke-width="1.6"/>
        <path d="M 60 48 Q 78 65 70 100 Q 64 102 60 100 Q 58 65 60 48" fill="none" stroke="#cfd2d6" stroke-width="1.6"/>
        <path d="M 60 48 Q 72 70 66 100 Q 62 102 60 100 Q 58 70 60 48" fill="none" stroke="#a3a8ad" stroke-width="1.6"/>
      </g>
    </svg>`;
}

function aiLoaderDinoSVG() {
  return `
    <div class="ail-dino-stage">
      <svg class="ail-dino-svg" viewBox="0 0 44 44" width="40" height="40" aria-hidden="true" shape-rendering="crispEdges">
        <g fill="#8b949e">
          <!-- Head -->
          <rect x="22" y="2"  width="20" height="16"/>
          <rect x="20" y="6"  width="2"  height="10"/>
          <!-- Eye -->
          <rect x="36" y="6"  width="3" height="3" fill="#0e1116"/>
          <rect x="37" y="7"  width="1" height="1" fill="#fff"/>
          <!-- Mouth -->
          <rect x="38" y="14" width="4" height="2" fill="#0e1116"/>
          <!-- Neck/back -->
          <rect x="12" y="16" width="24" height="14"/>
          <!-- Belly -->
          <rect x="6"  y="20" width="14" height="10"/>
          <!-- Tiny arm -->
          <rect x="22" y="22" width="4"  height="2"/>
          <!-- Tail -->
          <rect x="0"  y="22" width="6"  height="4"/>
          <!-- Legs (animate to fake running) -->
          <g class="leg leg-l">
            <rect x="10" y="30" width="4" height="10"/>
            <rect x="8"  y="38" width="8" height="2"/>
          </g>
          <g class="leg leg-r">
            <rect x="22" y="30" width="4" height="10"/>
            <rect x="20" y="38" width="8" height="2"/>
          </g>
        </g>
      </svg>
      <svg class="ail-cactus ail-cactus-1" viewBox="0 0 22 36" width="22" height="36" aria-hidden="true" shape-rendering="crispEdges">
        <g fill="#4ade80">
          <rect x="9" y="0"  width="4" height="36"/>
          <rect x="0" y="10" width="4" height="14"/>
          <rect x="0" y="10" width="6" height="2"/>
          <rect x="18" y="6" width="4" height="14"/>
          <rect x="16" y="6" width="6" height="2"/>
        </g>
      </svg>
      <svg class="ail-cactus ail-cactus-2" viewBox="0 0 14 28" width="14" height="28" aria-hidden="true" shape-rendering="crispEdges">
        <g fill="#4ade80">
          <rect x="5" y="0"  width="4" height="28"/>
          <rect x="0" y="10" width="4" height="10"/>
          <rect x="0" y="10" width="6" height="2"/>
        </g>
      </svg>
    </div>`;
}

function aiLoaderPongSVG() {
  return `
    <div class="ail-pong-court">
      <div class="paddle left"></div>
      <div class="ball"></div>
      <div class="paddle right"></div>
    </div>`;
}

const AI_LOADER_BUILDERS = {
  pot:   aiLoaderPotSVG,
  whisk: aiLoaderWhiskSVG,
  dino:  aiLoaderDinoSVG,
  pong:  aiLoaderPongSVG
};

function showAILoader(el, fixedMsg) {
  if (!el) return;
  clearAILoader(el);
  const variant = AI_LOADERS[Math.floor(Math.random() * AI_LOADERS.length)];
  const msgs = AI_MESSAGES[variant];
  const buildBody = AI_LOADER_BUILDERS[variant];
  el.innerHTML = `<div class="ai-loader ai-loader-${variant}">${buildBody()}<div class="ai-msg">${fixedMsg || msgs[0]}</div></div>`;
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
  if (el && el._aiLoaderInterval) {
    clearInterval(el._aiLoaderInterval);
    delete el._aiLoaderInterval;
  }
}
