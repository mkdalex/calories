// ---------- WATER ----------
const WATER_GOAL_ML = 2000;
const WATER_GLASS_ML = 250;

function renderWater() {
  const water = state.water || { entries: [], total_ml: 0 };
  const total = water.total_ml || 0;
  const segments = WATER_GOAL_ML / WATER_GLASS_ML;
  const filled = Math.min(segments, Math.floor(total / WATER_GLASS_ML));
  const done = total >= WATER_GOAL_ML;

  $('#waterWrap').innerHTML = `
    <section class="water-row" aria-labelledby="waterTitle">
      <div class="wr-main">
        <div class="wr-head">
          <span id="waterTitle" class="wr-title">Water</span>
          <span class="wr-total ${done ? 'done' : ''}">${total.toLocaleString()} / ${WATER_GOAL_ML.toLocaleString()} ml</span>
        </div>
        <div class="wr-segs" role="img" aria-label="${filled} of ${segments} glasses">
          ${Array.from({ length: segments }, (_, i) => `<span class="${i < filled ? 'on' : ''}"></span>`).join('')}
        </div>
      </div>
      <button class="wr-add" type="button" onclick="logWater()" aria-label="Add ${WATER_GLASS_ML} ml of water">+${WATER_GLASS_ML}</button>
    </section>
  `;
}

async function logWater() {
  const date = typeof todayViewDate !== 'undefined' ? todayViewDate : null;
  const res = await api('/api/water', { method: 'POST', body: { ml: WATER_GLASS_ML, ...(date ? { date } : {}) } });
  state.water = res;
  renderWater();
  const added = res.entries && res.entries[res.entries.length - 1];
  if (added) showUndoToast(`Added ${WATER_GLASS_ML} ml water`, () => undoWater(added.id, date));
}

async function undoWater(id, date) {
  const res = await api(`/api/water/${id}${date ? `?date=${date}` : ''}`, { method: 'DELETE' });
  state.water = res;
  renderWater();
}
