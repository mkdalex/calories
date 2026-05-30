// ---------- WATER ----------
function renderWater() {
  const water = state.water || { entries: [], total_ml: 0 };
  const GOAL_ML = 2000;
  const GLASS_ML = 250;
  const total = water.total_ml || 0;
  const glasses = Math.floor(total / GLASS_ML);
  const fillPct = Math.min(total / GOAL_ML, 1);

  // Hydration tiers. The fill colour is always water-blue (theme-aware via CSS),
  // so the bottle reads as "filling up" rather than cycling through alarm hues.
  // The level *label* still shifts tone (muted → info → accent) to celebrate progress.
  const LEVELS = [
    { min: 0,    label: 'Get started',   tone: 'muted',
      effect: 'A glass now helps focus and energy.' },
    { min: 250,  label: 'Started',       tone: 'muted',
      effect: 'Keep going — aim for one more this hour.' },
    { min: 500,  label: 'Building',      tone: 'info',
      effect: 'Steady pace. Six more glasses to hit goal.' },
    { min: 1000, label: 'Halfway',       tone: 'info',
      effect: 'Nice — you\'re on track for the day.' },
    { min: 1500, label: 'Well hydrated', tone: 'accent',
      effect: 'Sharp focus, steady energy, good recovery.' },
    { min: 1750, label: 'Optimal',       tone: 'accent',
      effect: 'Peak hydration — keep it up tomorrow.' },
  ];
  const level = [...LEVELS].reverse().find(l => total >= l.min) || LEVELS[0];
  const toneVar = level.tone === 'accent' ? 'var(--accent)'
                : level.tone === 'info'   ? 'var(--info)'
                : 'var(--text-dim)';

  // Bottle fills entire shape (neck + body) at 100%: y=10 to y=158
  const bodyTop = 10, bodyBot = 158, bodyH = bodyBot - bodyTop; // 148px total
  const fillH = Math.round(fillPct * bodyH);
  const fillY = bodyBot - fillH;

  const entries = water.entries || [];
  const lastId = entries.length ? entries[entries.length - 1].id : null;
  const goalText = fillPct >= 1 ? '✓ Goal' : `${glasses}/8 glasses`;

  // Slightly more refined silhouette (smoother shoulder curve, narrower waist near the cap)
  const bottlePath = 'M 27 10 C 27 26 12 34 12 46 L 12 148 Q 12 158 35 158 Q 58 158 58 148 L 58 46 C 58 34 43 26 43 10 Z';

  // Quarter-glass markers at body area (46-148)
  const markerLines = [1, 2, 3].map(i => {
    const ly = 148 - Math.round(i * 102 / 4);
    return `<line class="bottle-marker" x1="14" y1="${ly}" x2="56" y2="${ly}" clip-path="url(#bottleClip)" />`;
  }).join('');

  // ml text: sit just below the fill waterline, clamped inside the bottle body
  const textY = total > 0 ? Math.min(fillY + 16, 148) : 0;
  const fillClass = level.tone === 'accent' ? 'bottle-fill bottle-fill--accent' : 'bottle-fill';

  $('#waterWrap').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
      <div class="water-bottle-wrap" onclick="logWater()" title="Tap to add 1 glass (250 ml)">
        <svg class="water-bottle" width="70" height="166" viewBox="0 0 70 166">
          <defs>
            <clipPath id="bottleClip">
              <path d="${bottlePath}" />
            </clipPath>
          </defs>
          ${total > 0 ? `<rect class="${fillClass}" x="5" y="${fillY}" width="60" height="${bodyBot - fillY + 10}" clip-path="url(#bottleClip)" />` : ''}
          ${markerLines}
          <path class="bottle-body" d="${bottlePath}" />
          <path class="bottle-neck" d="M 27 10 L 27 4 L 43 4 L 43 10" />
          <rect class="bottle-cap" x="26" y="0" width="18" height="6" rx="2" />
          ${total > 0 ? `<text class="bottle-text" x="35" y="${textY}" text-anchor="middle">${total}ml</text>` : ''}
        </svg>
        <div class="water-label" style="color:${toneVar}">${goalText}</div>
        ${lastId ? `<button class="water-undo" onclick="event.stopPropagation();undoWater('${lastId}')">undo</button>` : '<div style="height:22px"></div>'}
      </div>
      <div class="water-level-card">
        <div class="water-level-name" style="color:${toneVar}">${level.label}</div>
        <div class="water-level-effect">${level.effect}</div>
      </div>
    </div>
  `;
}

async function logWater() {
  const res = await api('/api/water', { method: 'POST', body: { ml: 250 } });
  state.water = res;
  renderWater();
  if (typeof renderHeroExtras === 'function' && state.today) renderHeroExtras(state.today);
}

async function undoWater(id) {
  const res = await api(`/api/water/${id}`, { method: 'DELETE' });
  state.water = res;
  renderWater();
  if (typeof renderHeroExtras === 'function' && state.today) renderHeroExtras(state.today);
}
