// ---------- WATER ----------
function renderWater() {
  const water = state.water || { entries: [], total_ml: 0 };
  const GOAL_ML = 2000;
  const GLASS_ML = 250;
  const total = water.total_ml || 0;
  const glasses = Math.floor(total / GLASS_ML);
  const fillPct = Math.min(total / GOAL_ML, 1);

  // Hydration levels: min ml, label, fill color, short effect text
  const LEVELS = [
    { min: 0,    label: 'Dehydrated',    color: '#ef4444',
      effect: 'Headaches · fatigue · brain fog · poor mood' },
    { min: 250,  label: 'Very low',      color: '#f97316',
      effect: 'Sluggish digestion · thirst · low energy' },
    { min: 500,  label: 'Low',           color: '#eab308',
      effect: 'Energy dip · dry mouth · hard to focus' },
    { min: 1000, label: 'Getting there', color: '#84cc16',
      effect: 'OK but not optimal — push for 6+ glasses' },
    { min: 1500, label: 'Well hydrated', color: '#22c55e',
      effect: 'Sharp focus · good energy · muscles recover' },
    { min: 1750, label: 'Optimal!',      color: '#06b6d4',
      effect: 'Peak recovery · clear skin · top performance' },
  ];
  const level = [...LEVELS].reverse().find(l => total >= l.min) || LEVELS[0];

  // Bottle fills entire shape (neck + body) at 100%: y=10 to y=158
  const bodyTop = 10, bodyBot = 158, bodyH = bodyBot - bodyTop; // 148px total
  const fillH = Math.round(fillPct * bodyH);
  const fillY = bodyBot - fillH;

  const entries = water.entries || [];
  const lastId = entries.length ? entries[entries.length - 1].id : null;
  const goalText = fillPct >= 1 ? '✓ Goal!' : `${glasses}/8 glasses`;

  const bottlePath = 'M 27 10 C 27 28 12 35 12 45 L 12 148 Q 12 158 35 158 Q 58 158 58 148 L 58 45 C 58 35 43 28 43 10 Z';

  // Quarter-glass markers at body area (45-148)
  const markerLines = [1, 2, 3].map(i => {
    const ly = 148 - Math.round(i * 103 / 4);
    return `<line x1="12" y1="${ly}" x2="58" y2="${ly}" stroke="rgba(255,255,255,0.12)" stroke-width="1" clip-path="url(#bottleClip)" />`;
  }).join('');

  // ml text: sit just below the fill waterline, clamped inside the bottle body
  const textY = total > 0 ? Math.min(fillY + 16, 148) : 0;

  $('#waterWrap').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
      <div class="water-bottle-wrap" onclick="logWater()" title="Tap to add 1 glass (250 ml)">
        <svg width="70" height="162" viewBox="0 0 70 162">
          <defs>
            <clipPath id="bottleClip">
              <path d="${bottlePath}" />
            </clipPath>
          </defs>
          ${total > 0 ? `<rect x="5" y="${fillY}" width="60" height="${bodyBot - fillY + 10}" clip-path="url(#bottleClip)" fill="${level.color}" opacity="0.82" />` : ''}
          ${markerLines}
          <path d="${bottlePath}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2" />
          <path d="M 27 10 L 27 2 L 43 2 L 43 10" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" />
          <rect x="27" y="0" width="16" height="6" rx="2" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" />
          ${total > 0 ? `<text x="35" y="${textY}" text-anchor="middle" fill="rgba(255,255,255,0.9)" font-size="9" font-family="sans-serif">${total}ml</text>` : ''}
        </svg>
        <div class="water-label" style="color:${level.color}">${goalText}</div>
        ${lastId ? `<button class="water-undo" onclick="event.stopPropagation();undoWater('${lastId}')">undo</button>` : '<div style="height:22px"></div>'}
      </div>
      <div class="water-level-card">
        <div class="water-level-name" style="color:${level.color}">${level.label}</div>
        <div class="water-level-effect">${level.effect}</div>
      </div>
    </div>
  `;
}

async function logWater() {
  const res = await api('/api/water', { method: 'POST', body: { ml: 250 } });
  state.water = res;
  renderWater();
}

async function undoWater(id) {
  const res = await api(`/api/water/${id}`, { method: 'DELETE' });
  state.water = res;
  renderWater();
}
