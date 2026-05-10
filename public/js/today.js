// ---------- TODAY ----------
async function loadToday() {
  const [data, water] = await Promise.all([api('/api/log'), api('/api/water')]);
  state.today = data;
  state.stats = data.stats;
  state.water = water;
  renderToday();
  renderWater();
}

function buildMacroDonut(data) {
  const pG = data.totals.protein || 0;
  const fG = data.totals.fat || 0;
  const cG = data.totals.carb || 0;
  const pK = pG * 4, fK = fG * 9, cK = cG * 4;
  const total = pK + fK + cK;
  if (total === 0) return '';

  const pPct = pK / total, fPct = fK / total, cPct = cK / total;
  const W = 120, R = 42, sw = 14;
  const cx = W / 2, cy = W / 2;
  const circ = 2 * Math.PI * R;
  const pLen = circ * pPct, fLen = circ * fPct, cLen = circ * cPct;
  const gap = 2;

  const dominant = pPct >= fPct && pPct >= cPct ? { name: 'Protein', pct: pPct, color: 'var(--info)' }
                  : cPct >= fPct ? { name: 'Carbs', pct: cPct, color: 'var(--accent)' }
                  : { name: 'Fat', pct: fPct, color: 'var(--warn)' };

  return `
    <div class="macro-donut-wrap">
      <svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" class="macro-donut-svg">
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--panel-2)" stroke-width="${sw}"/>
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--info)"   stroke-width="${sw}" stroke-dasharray="${Math.max(0,pLen-gap)} ${circ}" stroke-dashoffset="0" stroke-linecap="butt"/>
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--warn)"   stroke-width="${sw}" stroke-dasharray="${Math.max(0,fLen-gap)} ${circ}" stroke-dashoffset="${-pLen}"/>
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--accent)" stroke-width="${sw}" stroke-dasharray="${Math.max(0,cLen-gap)} ${circ}" stroke-dashoffset="${-(pLen + fLen)}"/>
      </svg>
      <div class="macro-donut-info">
        <div class="md-headline"><span style="color:${dominant.color};">${dominant.name}-heavy</span> · ${Math.round(dominant.pct * 100)}% of kcal</div>
        <div class="md-legend">
          <span><span class="md-dot" style="background:var(--info);"></span>Protein ${Math.round(pPct * 100)}%</span>
          <span><span class="md-dot" style="background:var(--warn);"></span>Fat ${Math.round(fPct * 100)}%</span>
          <span><span class="md-dot" style="background:var(--accent);"></span>Carbs ${Math.round(cPct * 100)}%</span>
        </div>
      </div>
    </div>
  `;
}

function buildProjectionChart(currentWeight, lossKgWk) {
  const WEEKS = 26;
  const W = 320, H = 82;
  const PAD = { t: 12, r: 8, b: 24, l: 36 };
  const chartW = W - PAD.l - PAD.r, chartH = H - PAD.t - PAD.b;
  const endWeight = currentWeight - lossKgWk * WEEKS;
  const maxW = currentWeight + 0.5, minW = endWeight - 0.5;
  const wRange = maxW - minW;
  const wx = w => PAD.l + (w / WEEKS) * chartW;
  const wy = w => PAD.t + ((maxW - w) / wRange) * chartH;

  const pts = Array.from({ length: WEEKS + 1 }, (_, i) => {
    const w = currentWeight - lossKgWk * i;
    return `${i === 0 ? 'M' : 'L'}${wx(i).toFixed(1)},${wy(w).toFixed(1)}`;
  }).join(' ');
  const areaClose = `L${wx(WEEKS).toFixed(1)},${(PAD.t + chartH).toFixed(1)} L${PAD.l},${(PAD.t + chartH).toFixed(1)} Z`;

  const milestones = [{ wk: 4, label: '4 wks' }, { wk: 13, label: '3 mo' }, { wk: 26, label: '6 mo' }];
  const dots = milestones.map(m => {
    const w = currentWeight - lossKgWk * m.wk;
    const x = wx(m.wk), y = wy(w);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#4ade80"/>
      <text x="${x.toFixed(1)}" y="${(PAD.t + chartH + 11).toFixed(1)}" text-anchor="middle" fill="rgba(139,148,158,0.8)" font-size="8.5" font-family="sans-serif">${m.label}</text>
      <text x="${x.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" fill="rgba(74,222,128,0.9)" font-size="8.5" font-family="sans-serif">${w.toFixed(1)}</text>`;
  }).join('');

  return `<div class="proj-chart">
    <svg viewBox="0 0 ${W} ${H}" width="100%" overflow="visible">
      <path d="${pts} ${areaClose}" fill="rgba(74,222,128,0.06)"/>
      <path d="${pts}" fill="none" stroke="#4ade80" stroke-width="1.8" stroke-linecap="round" opacity="0.85"/>
      ${milestones.map(m => `<line x1="${wx(m.wk).toFixed(1)}" y1="${PAD.t}" x2="${wx(m.wk).toFixed(1)}" y2="${(PAD.t+chartH).toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-dasharray="3,3"/>`).join('')}
      <circle cx="${PAD.l}" cy="${wy(currentWeight).toFixed(1)}" r="4" fill="white" opacity="0.8"/>
      <text x="${PAD.l - 4}" y="${(wy(currentWeight)+3).toFixed(1)}" text-anchor="end" fill="rgba(200,210,220,0.7)" font-size="9" font-family="sans-serif">${currentWeight}kg</text>
      <text x="${PAD.l - 4}" y="${(wy(endWeight)+3).toFixed(1)}" text-anchor="end" fill="rgba(74,222,128,0.7)" font-size="9" font-family="sans-serif">${endWeight.toFixed(1)}kg</text>
      ${dots}
    </svg>
  </div>`;
}

function renderZoneBar(data) {
  const el = $('#zoneWrap');
  const { kcal_goal, tdee, goal_meta, weight_kg } = data.stats;
  const eaten = data.totals.kcal;

  // Bar spans 0 → TDEE + same gap as deficit (symmetric headroom on right)
  const deficit = tdee - kcal_goal;
  const maxKcal = tdee + Math.max(deficit, 400);

  // Segment widths as percentages
  const losePct  = (kcal_goal / maxKcal * 100).toFixed(2);
  const maintPct = (deficit / maxKcal * 100).toFixed(2);
  const gainPct  = (100 - losePct - maintPct).toFixed(2);

  // Marker + TDEE tick positions
  const markerPct = Math.min(eaten / maxKcal * 100, 100).toFixed(2);
  const tdeePct   = (tdee / maxKcal * 100).toFixed(2);
  const goalPct   = losePct; // same as goal position

  // Status + projection
  const lossKgWk = Math.abs(goal_meta.delta) * 7 / 7700;
  let statusHtml, projRows = [];

  if (eaten <= kcal_goal) {
    statusHtml = `<span style="color:var(--accent);font-weight:600;">Losing zone</span> — ${kcal_goal - eaten} kcal under your goal. At end-of-day goal: −${lossKgWk.toFixed(2)} kg/week.`;
  } else if (eaten <= tdee) {
    const partialLoss = (tdee - eaten) * 7 / 7700;
    statusHtml = `<span style="color:var(--warn);font-weight:600;">Still losing — just slower</span> — ${eaten - kcal_goal} kcal over your goal but still ${tdee - eaten} under TDEE. At this intake: ~${partialLoss.toFixed(2)} kg/week. You don't stop losing until you hit ${tdee.toLocaleString()}.`;
  } else {
    const gainRate = (eaten - tdee) * 7 / 7700;
    statusHtml = `<span style="color:var(--danger);font-weight:600;">Surplus</span> — ${eaten - tdee} kcal over TDEE. Gaining ~${gainRate.toFixed(2)} kg/week if you stay here.`;
  }

  let projChart = '';
  if (weight_kg && goal_meta.delta < 0) {
    const wk4 = (weight_kg - lossKgWk * 4).toFixed(1);
    const mo3 = (weight_kg - lossKgWk * 13).toFixed(1);
    projRows = [
      { num: `${wk4} kg`, lbl: 'in 4 weeks' },
      { num: `${mo3} kg`, lbl: 'in 3 months' },
      { num: `−${lossKgWk.toFixed(2)} kg`, lbl: 'per week' }
    ];
    projChart = buildProjectionChart(weight_kg, lossKgWk);
  }

  el.innerHTML = `
    <div class="zone-wrap">
      <div class="zone-bar-outer">
        <div class="zone-lose"  style="flex:${losePct}"></div>
        <div class="zone-maint" style="flex:${maintPct}"></div>
        <div class="zone-gain"  style="flex:${gainPct}"></div>
        <div class="zone-tick"  style="left:${goalPct}%"  title="Goal: ${kcal_goal.toLocaleString()} kcal"></div>
        <div class="zone-tick"  style="left:${tdeePct}%" title="TDEE: ${tdee.toLocaleString()} kcal"></div>
        <div class="zone-marker" style="left:${markerPct}%" title="${eaten.toLocaleString()} kcal eaten"></div>
      </div>
      <div class="zone-axis">
        <span>0</span>
        <span class="mid">
          <span style="color:var(--accent);">${kcal_goal.toLocaleString()}</span> full loss
        </span>
        <span class="mid">
          <span style="color:var(--warn);">${tdee.toLocaleString()}</span> maintain
        </span>
        <span>${maxKcal.toLocaleString()}</span>
      </div>
      <div class="zone-status">${statusHtml}</div>
      ${projRows.length ? `
      <div class="zone-projection" style="margin-top:10px;">
        ${projRows.map(p => `<div class="proj-item"><div class="proj-num">${p.num}</div><div class="proj-lbl">${p.lbl}</div></div>`).join('')}
      </div>
      ${projChart}` : ''}
    </div>
  `;
}

function renderToday() {
  const data = state.today;
  const banner = $('#setupBanner');
  if (!data.stats) {
    banner.innerHTML = `<div class="setup-needed"><strong>Set up your profile first</strong><br/>Tap the Profile tab and fill in your stats so we can calculate your daily target.</div>`;
    $('#ringWrap').innerHTML = '';
    $('#proteinWrap').innerHTML = '';
    $('#macroWrap').innerHTML = '';
    $('#narrativeWrap').innerHTML = '';
    $('#zoneWrap').innerHTML = '';
  } else {
    banner.innerHTML = '';
    const goal = data.stats.kcal_goal;
    const eaten = data.totals.kcal;
    const remaining = goal - eaten;
    const pct = Math.min(eaten / goal, 1);
    const over = eaten > goal;
    const C = 226; // 2 * pi * 36
    const R = 100;
    const circ = 2 * Math.PI * R;
    const offset = circ * (1 - pct);

    const prevNumEl = $('#ringWrap .ring-num');
    const prevNum = prevNumEl ? parseInt(prevNumEl.textContent.replace(/[^\d-]/g, '')) || 0 : 0;
    const newNum = over ? eaten - goal : remaining;
    const prefix = over ? '+' : '';

    $('#ringWrap').innerHTML = `
      <div class="ring">
        <svg width="240" height="240">
          <circle cx="120" cy="120" r="${R}" fill="none" stroke-width="14" class="ring-bg" />
          <circle cx="120" cy="120" r="${R}" fill="none" stroke-width="14" stroke-linecap="round" class="ring-fg ${over ? 'over' : ''}" stroke-dasharray="${circ}" stroke-dashoffset="${offset}" />
        </svg>
        <div class="ring-center">
          <div class="ring-num ${over ? 'over' : ''}">${prefix}${prevNum}</div>
          <div class="ring-label">${over ? 'over goal' : 'kcal left'}</div>
          <div class="ring-sub">${eaten} / ${goal} eaten</div>
        </div>
      </div>
    `;
    animateNumber($('#ringWrap .ring-num'), prevNum, newNum, 700, prefix);
    if (prevNum !== newNum && prevNumEl) {
      const ringEl = $('#ringWrap .ring');
      if (ringEl) { ringEl.classList.remove('ring-pulse'); void ringEl.offsetWidth; ringEl.classList.add('ring-pulse'); }
    }

    const pPct = Math.min(data.totals.protein / data.stats.protein_g, 1) * 100;
    const eduOpen = localStorage.getItem('eduProteinOpen') === '1';
    $('#proteinWrap').innerHTML = `
      <div class="protein-bar">
        <div class="row">
          <span class="label">Protein</span>
          <span class="value">${Math.round(data.totals.protein)}g / ${data.stats.protein_g}g</span>
        </div>
        <div class="bar"><div class="bar-fill" style="width: ${pPct}%"></div></div>
        <button class="info-toggle" id="eduToggle">${eduOpen ? '▾' : '▸'} Why does protein matter?</button>
        <div class="edu-card ${eduOpen ? '' : 'hidden'}" id="eduCard">${EDU_PROTEIN_HTML}<div id="macroProteinRemaining"></div></div>
      </div>
    `;
    $('#eduToggle').addEventListener('click', () => {
      const card = $('#eduCard');
      const isHidden = card.classList.toggle('hidden');
      $('#eduToggle').textContent = (isHidden ? '▸' : '▾') + ' Why does protein matter?';
      localStorage.setItem('eduProteinOpen', isHidden ? '0' : '1');
      // Lazy-load protein suggestions only when the user opens the card (saves AI calls)
      if (!isHidden && state.today) {
        const remEl = $('#macroProteinRemaining');
        if (remEl && !remEl.innerHTML.trim()) loadMacroRemaining(state.today);
      }
    });

    // Macro bar (fat / carbs / fiber)
    const fatEaten = Math.round(data.totals.fat || 0);
    const carbEaten = Math.round(data.totals.carb || 0);
    const fiberEaten = Math.round((data.totals.fiber || 0) * 10) / 10;
    const fatTarget = data.stats.fat_g;
    const carbTarget = data.stats.carb_g;
    const fiberTarget = data.stats.fiber_g;
    const fatPct = Math.min(fatTarget > 0 ? fatEaten / fatTarget * 100 : 0, 100).toFixed(1);
    const carbPct = Math.min(carbTarget > 0 ? carbEaten / carbTarget * 100 : 0, 100).toFixed(1);
    const fiberPct = Math.min(fiberTarget > 0 ? fiberEaten / fiberTarget * 100 : 0, 100).toFixed(1);
    const macroFatOpen = localStorage.getItem('macroFatOpen') === '1';
    const macroCarbOpen = localStorage.getItem('macroCarbOpen') === '1';
    const macroFiberOpen = localStorage.getItem('macroFiberOpen') === '1';

    const macroDetailsOpen = localStorage.getItem('macroDetailsOpen') === '1';
    $('#macroWrap').innerHTML = `
      <div class="macro-bar-wrap">
        <button class="macro-details-toggle" id="macroDetailsToggle">
          <span id="mdTogArrow">${macroDetailsOpen ? '▾' : '▸'}</span>
          <span class="md-tog-label">All macros</span>
          <span class="md-tog-summary">F ${fatEaten}g · C ${carbEaten}g · Fib ${fiberEaten}g</span>
        </button>
        <div id="macroDetailsBody" class="${macroDetailsOpen ? '' : 'hidden'}" style="margin-top:10px;">
          ${buildMacroDonut(data)}
          <div class="macro-bar-grid">
            <div class="macro-cell">
              <div class="macro-row">
                <span class="macro-label">Fat</span>
                <span class="macro-value">${fatEaten} / ${fatTarget}g</span>
              </div>
              <div class="bar"><div class="bar-fill" style="width:${fatPct}%;background:var(--warn);"></div></div>
              <button class="macro-toggle" id="macroFatToggle">${macroFatOpen ? '▾' : '▸'} Why fat matters</button>
            </div>
            <div class="macro-cell">
              <div class="macro-row">
                <span class="macro-label">Carbs</span>
                <span class="macro-value">${carbEaten} / ${carbTarget}g</span>
              </div>
              <div class="bar"><div class="bar-fill" style="width:${carbPct}%;background:var(--accent);"></div></div>
              <button class="macro-toggle" id="macroCarbToggle">${macroCarbOpen ? '▾' : '▸'} Why carbs matter</button>
            </div>
            <div class="macro-cell">
              <div class="macro-row">
                <span class="macro-label">Fiber</span>
                <span class="macro-value">${fiberEaten} / ${fiberTarget}g</span>
              </div>
              <div class="bar"><div class="bar-fill" style="width:${fiberPct}%;background:var(--info);"></div></div>
              <button class="macro-toggle" id="macroFiberToggle">${macroFiberOpen ? '▾' : '▸'} Why fiber matters</button>
            </div>
          </div>
          <div class="macro-edu ${macroFatOpen ? '' : 'hidden'}" id="macroFatEdu">${EDU_FAT_HTML}<div id="macroFatRemaining"></div></div>
          <div class="macro-edu ${macroCarbOpen ? '' : 'hidden'}" id="macroCarbEdu">${EDU_CARBS_HTML}<div id="macroCarbRemaining"></div></div>
          <div class="macro-edu ${macroFiberOpen ? '' : 'hidden'}" id="macroFiberEdu">${EDU_FIBER_HTML}<div id="macroFiberRemaining"></div></div>
        </div>
      </div>
    `;
    $('#macroDetailsToggle').addEventListener('click', () => {
      const body = $('#macroDetailsBody');
      const wasHidden = body.classList.toggle('hidden');
      $('#mdTogArrow').textContent = wasHidden ? '▸' : '▾';
      localStorage.setItem('macroDetailsOpen', wasHidden ? '0' : '1');
    });
    [['macroFatToggle', 'macroFatEdu', 'macroFatOpen', 'Why fat matters', 'Why fat matters'],
     ['macroCarbToggle', 'macroCarbEdu', 'macroCarbOpen', 'Why carbs matter', 'Why carbs matter'],
     ['macroFiberToggle', 'macroFiberEdu', 'macroFiberOpen', 'Why fiber matters', 'Why fiber matters']
    ].forEach(([toggleId, eduId, lsKey, openLabel, closeLabel]) => {
      const toggle = $(`#${toggleId}`);
      const edu = $(`#${eduId}`);
      if (!toggle || !edu) return;
      toggle.addEventListener('click', () => {
        const nowHidden = edu.classList.toggle('hidden');
        toggle.textContent = (nowHidden ? '▸' : '▾') + ' ' + (nowHidden ? openLabel : closeLabel);
        localStorage.setItem(lsKey, nowHidden ? '0' : '1');
      });
    });
    // Wire macro food chips (rendered inside edu cards)
    renderMacroFoodChips('fatChips', 'fat');
    renderMacroFoodChips('carbChips', 'carb');
    renderMacroFoodChips('fiberChips', 'fiber');
    // Wire protein chips (in protein bar edu card)
    renderMacroFoodChips('proteinChips', 'protein');
    // Macro-remaining suggestions only fire when user has the protein edu card open (saves AI calls)
    if (eduOpen) loadMacroRemaining(data);

    let msg;
    if (over) {
      msg = `You're ${eaten - goal} kcal over today. No big deal — eat lighter tomorrow and you're back on track.`;
    } else if (remaining < 200) {
      msg = `You have ${remaining} kcal left. That's about a small snack or a light side.`;
    } else if (remaining < 600) {
      msg = `You have ${remaining} kcal left. Plenty for a normal-sized meal.`;
    } else {
      msg = `You have ${remaining} kcal left. Eat a real meal — don't undereat, you'll just binge later.`;
    }
    $('#narrativeWrap').innerHTML = `<div class="narrative">${msg}</div>`;

    // Zone bar
    renderZoneBar(data);
  }

  // Streak + weekly avg
  const streakEl = $('#streakWrap');
  if (data.stats && (data.streak > 0 || data.weekly_avg_kcal)) {
    const parts = [];
    if (data.streak > 0) parts.push(`<div class="item"><div class="num">${data.streak}</div><div class="lbl">day streak</div></div>`);
    if (data.weekly_avg_kcal) parts.push(`<div class="item"><div class="num">${data.weekly_avg_kcal.toLocaleString()}</div><div class="lbl">7-day avg kcal</div></div>`);
    streakEl.innerHTML = `<div class="streak-strip">${parts.join('')}</div>`;
  } else {
    streakEl.innerHTML = '';
  }

  // Meal list with period headers
  const list = $('#mealList');
  if (!data.entries.length) {
    list.innerHTML = `<div class="empty">No meals logged yet. Tap <strong>+ Log meal</strong> to start.</div>`;
  } else {
    // Group entries by meal period, inserting header divs when period changes
    let lastPeriod = null;
    const rows = [];
    data.entries.forEach(e => {
      const period = getMealPeriod(e.time);
      if (period !== lastPeriod) {
        rows.push(`<div class="meal-period-hdr">${PERIOD_ICON[period] || '🍽️'} ${period}</div>`);
        lastPeriod = period;
      }
      rows.push(`
        <div class="meal" data-id="${e.id}" style="cursor: pointer;">
          <div class="meal-info">
            <div class="meal-name">${escapeHtml(e.name)}</div>
            <div class="meal-meta">${fmtTime(e.time)} <span class="badge ${e.source}">${e.source}</span></div>
          </div>
          <div class="meal-stats">
            <div class="meal-kcal">${e.kcal} kcal</div>
            <div class="meal-protein">${e.protein}g protein</div>
            ${(e.fat || e.carb || e.fiber) ? `<div style="color:var(--text-dim);font-size:11px;">F${Math.round(e.fat||0)} C${Math.round(e.carb||0)} Fib${Math.round((e.fiber||0)*10)/10}</div>` : ''}
          </div>
          <button class="meal-rescan" data-id="${e.id}" title="Re-scan with new AI system">↻</button>
          <button class="meal-tmpl" data-id="${e.id}" title="Save as template" style="background:none;border:none;color:var(--text-dim);font-size:13px;cursor:pointer;padding:4px 6px;opacity:0.5;transition:opacity 0.15s;" onmouseover="this.style.opacity=1;this.style.color='var(--accent)'" onmouseout="this.style.opacity=0.5;this.style.color='var(--text-dim)'">📋</button>
          <button class="meal-del" data-id="${e.id}" title="Delete">×</button>
        </div>
        <div class="rescan-panel hidden" id="rescan-${e.id}"></div>`);
    });
    list.innerHTML = rows.join('');
    $$('.meal-del').forEach(btn => btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id;
      const entry = data.entries.find(e => e.id === id);
      await fetch(`/api/log/${data.date}/${id}`, { method: 'DELETE' });
      loadToday();
      if (entry) {
        showUndoToast(`Deleted "${entry.name.slice(0, 40)}"`, async () => {
          await api('/api/log', { method: 'POST', body: {
            name: entry.name, kcal: entry.kcal, protein: entry.protein,
            fat: entry.fat || 0, carb: entry.carb || 0, fiber: entry.fiber || 0,
            source: entry.source, items: entry.items, time: entry.time
          }});
          loadToday();
        });
      }
    }));
    $$('.meal-rescan').forEach(btn => btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id;
      const entry = data.entries.find(e => e.id === id);
      if (!entry) return;
      await rescanEntry(entry, data.date, btn);
    }));
    $$('.meal-tmpl').forEach(btn => btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const entry = data.entries.find(e => e.id === btn.dataset.id);
      if (!entry) return;
      const name = prompt('Template name:', entry.name.slice(0, 60));
      if (!name || !name.trim()) return;
      await api('/api/templates', { method: 'POST', body: { name: name.trim(), from_log_entry_id: entry.id, date: data.date } });
      showToast(`Template "${name.trim()}" saved`);
      loadTemplates();
    }));
    $$('.meal[data-id]').forEach(row => row.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('meal-del') || ev.target.classList.contains('meal-rescan')) return;
      const entry = data.entries.find(e => e.id === row.dataset.id);
      if (entry) openEditModal(entry, data.date);
    }));
  }

  // Day status card
  renderDayStatus(data);

  // Gap fill card
  renderGapFill(data);

  // Templates
  loadTemplates();

  // Favorites
  loadFavorites();
}

// ---------- MEAL PERIOD ----------
function getMealPeriod(timeStr) {
  if (!timeStr) return 'Other';
  const d = new Date(timeStr);
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 10.5) return 'Breakfast';
  if (h < 15)   return 'Lunch';
  if (h < 17)   return 'Snack';
  if (h < 22.5) return 'Dinner';
  return 'Late night';
}
const PERIOD_ICON = { Breakfast: '🌅', Lunch: '☀️', Snack: '🍎', Dinner: '🌙', 'Late night': '🌜', Other: '🍽️' };

// ---------- DAY STATUS ----------
function renderDayStatus(data) {
  const el = $('#dayStatusWrap');
  if (!el || !data.stats) { if (el) el.innerHTML = ''; return; }

  const now = new Date();
  const t = now.getHours() + now.getMinutes() / 60;
  const EATING_START = 7, EATING_END = 21;
  const hoursLeft = Math.max(0, EATING_END - t);
  const hoursLeftStr = hoursLeft > 0
    ? `${Math.floor(hoursLeft)}h ${Math.round((hoursLeft % 1) * 60)}m left`
    : 'After 9pm';

  // Pacing: linear ramp 7am→9pm
  const windowFrac = Math.max(0, Math.min(1, (t - EATING_START) / (EATING_END - EATING_START)));
  const paceTarget = Math.round(data.stats.kcal_goal * windowFrac);
  const eaten = data.totals.kcal;
  const paceGap = eaten - paceTarget;
  const remaining = data.stats.kcal_goal - eaten;

  let paceText, paceClass;
  if (windowFrac === 0) { paceText = 'Before eating window'; paceClass = 'warn'; }
  else if (Math.abs(paceGap) < 150) { paceText = 'On pace'; paceClass = 'good'; }
  else if (paceGap > 0) { paceText = `+${paceGap} kcal ahead`; paceClass = paceGap > 500 ? 'over' : 'warn'; }
  else { paceText = `${Math.abs(paceGap)} kcal behind pace`; paceClass = 'warn'; }

  // Meal detection
  const entries = data.entries || [];
  const inWindow = (s, e) => entries.some(en => {
    if (!en.time) return false;
    const h = new Date(en.time).getHours() + new Date(en.time).getMinutes() / 60;
    return h >= s && h < e;
  });
  const hasBreakfast = inWindow(5, 10.5);
  const hasLunch     = inWindow(10.5, 15);
  const hasDinner    = inWindow(17, 22.5);
  const snackCount   = entries.filter(en => {
    if (!en.time) return false;
    const h = new Date(en.time).getHours() + new Date(en.time).getMinutes() / 60;
    const isBf = h >= 5 && h < 10.5, isLu = h >= 10.5 && h < 15, isDi = h >= 17 && h < 22.5;
    return !isBf && !isLu && !isDi;
  }).length;

  // Meal chips (only show slots that are reachable at this time)
  const chips = [];
  if (t >= 5) {
    const c = hasBreakfast ? 'done' : t > 10.5 ? 'skipped' : 'upcoming';
    chips.push(`<span class="ds-chip ${c}">🌅 Breakfast${hasBreakfast ? ' ✓' : t > 10.5 ? ' —' : ''}</span>`);
  }
  if (t >= 10.5) {
    const c = hasLunch ? 'done' : t > 15 ? 'skipped' : 'upcoming';
    chips.push(`<span class="ds-chip ${c}">☀️ Lunch${hasLunch ? ' ✓' : t > 15 ? ' —' : ''}</span>`);
  }
  if (t >= 17) {
    const c = hasDinner ? 'done' : t > 22.5 ? 'skipped' : 'upcoming';
    chips.push(`<span class="ds-chip ${c}">🌙 Dinner${hasDinner ? ' ✓' : t > 22.5 ? ' —' : ''}</span>`);
  }
  if (snackCount > 0) chips.push(`<span class="ds-chip snack">🍎 ${snackCount} snack${snackCount !== 1 ? 's' : ''}</span>`);

  // Time-aware advice
  let advice;
  if (t < 7) {
    advice = 'Early start. Eat breakfast to fuel your metabolism and avoid hunger crashes later.';
  } else if (t < 10.5 && !hasBreakfast) {
    advice = 'No breakfast logged — skipping it usually leads to overeating at lunch and dinner.';
  } else if (t >= 10.5 && t < 15 && !hasLunch) {
    advice = remaining > 600
      ? `Lunchtime. ${remaining} kcal left — a proper meal now keeps you fuelled through the afternoon.`
      : `Lunchtime. ${remaining} kcal left, keep lunch moderate.`;
  } else if (t >= 17 && t < 21 && !hasDinner) {
    if (remaining > 500) advice = `Dinner time — ${remaining} kcal left. Have a real meal, don't snack it away.`;
    else if (remaining > 200) advice = `${remaining} kcal left. A light dinner — protein + veg — and you're done.`;
    else advice = `Only ${remaining} kcal left. Small snack or call it a day.`;
  } else if (t >= 21) {
    if (remaining > 300) advice = `After 9pm — if you're genuinely hungry, a light protein snack. Otherwise carry those ${remaining} kcal into tomorrow.`;
    else advice = remaining > 0 ? `You're done. ${remaining} kcal left unused is fine — sleep is the best macro now.` : 'Hit your goal. Rest up.';
  } else if (paceGap < -300) {
    advice = `${Math.abs(paceGap)} kcal behind pace — ${hoursLeft > 2 ? `${Math.floor(hoursLeft)}h left, get a proper meal in` : 'not much time left, eat something substantial'}.`;
  } else if (paceGap > 500) {
    advice = 'Pacing fast today — keep the next meal on the lighter side to stay on track.';
  } else {
    advice = `Good pacing. ${hoursLeft > 3 ? `${Math.floor(hoursLeft)}h left in your eating window.` : hoursLeft > 0 ? 'Wrap up with dinner.' : 'Eating window closing.'}`;
  }

  el.innerHTML = `
    <div class="day-status-card">
      <div class="ds-meal-chips">${chips.join('')}</div>
      <div class="ds-meta-row">
        <span class="ds-pace ${paceClass}">${paceText}</span>
        <span class="ds-time-left">${hoursLeftStr}</span>
      </div>
      <div class="ds-advice">${advice}</div>
    </div>`;
}

// ---------- GAP FILL ----------
const GAP_FOODS = [
  { name: '200g chicken breast',           kcal: 330, protein: 62, fat:  7, carb:  0, fiber:  0 },
  { name: '200g Greek yoghurt',            kcal: 120, protein: 20, fat:  3, carb:  6, fiber:  0 },
  { name: '1 scoop whey + 250ml milk',     kcal: 230, protein: 28, fat:  5, carb: 16, fiber:  0 },
  { name: '1 can tuna (185g)',             kcal: 175, protein: 40, fat:  2, carb:  0, fiber:  0 },
  { name: '3 scrambled eggs',              kcal: 210, protein: 18, fat: 15, carb:  1, fiber:  0 },
  { name: '200g cottage cheese',           kcal: 140, protein: 25, fat:  4, carb:  4, fiber:  0 },
  { name: '1 cup lentil soup',             kcal: 230, protein: 18, fat:  1, carb: 40, fiber: 16 },
  { name: '100g edamame (microwaved)',      kcal: 120, protein: 11, fat:  5, carb:  9, fiber:  5 },
  { name: '30g chia seeds + yoghurt',      kcal: 200, protein: 10, fat: 10, carb: 18, fiber: 11 },
  { name: '150g chicken + cup broccoli',   kcal: 290, protein: 47, fat:  5, carb:  8, fiber:  4 },
  { name: '1 cup oats + banana',           kcal: 265, protein:  7, fat:  3, carb: 54, fiber:  7 },
  { name: '30g almonds',                   kcal: 175, protein:  6, fat: 15, carb:  6, fiber:  4 },
  { name: '1/2 avocado + 2 eggs',          kcal: 300, protein: 13, fat: 22, carb:  9, fiber:  5 },
  { name: '100g salmon fillet',            kcal: 180, protein: 25, fat:  9, carb:  0, fiber:  0 },
  { name: '1 cup raspberries + whey shake',kcal: 185, protein: 24, fat:  2, carb: 18, fiber:  8 },
  { name: '1 potato + cottage cheese',     kcal: 300, protein: 29, fat:  4, carb: 41, fiber:  4 },
  { name: '1 cup chickpeas + Greek yoghurt',kcal:260, protein: 22, fat:  3, carb: 36, fiber: 10 },
  { name: 'Tuna + salad wrap',             kcal: 350, protein: 38, fat:  6, carb: 38, fiber:  5 },
  { name: '200g lean beef mince + veg',    kcal: 380, protein: 46, fat: 18, carb: 12, fiber:  4 },
  { name: 'Apple + 30g peanut butter',     kcal: 285, protein:  8, fat: 16, carb: 31, fiber:  6 },
  { name: '1 cup cooked rice + eggs',      kcal: 340, protein: 18, fat:  7, carb: 52, fiber:  1 },
  { name: '1 cup frozen peas + chicken',   kcal: 270, protein: 38, fat:  3, carb: 20, fiber:  7 },
];

function renderGapFill(data) {
  const wrap = $('#gapFillWrap');
  if (!wrap) return;
  if (!data.stats) { wrap.innerHTML = ''; return; }

  const { remaining_kcal, remaining_protein, remaining_fat, remaining_carb, remaining_fiber } = data;
  const hour = new Date().getHours();
  if (hour < 10) { wrap.innerHTML = ''; return; } // too early for gap suggestions

  // Only flag protein gaps — user focuses on kcal + protein, doesn't track other macros
  const behind = [];
  if ((remaining_protein || 0) > 20) behind.push('protein');

  if (!behind.length || (remaining_kcal !== null && remaining_kcal < 50)) {
    wrap.innerHTML = ''; return;
  }

  const kcalBudget = remaining_kcal !== null ? remaining_kcal : 9999;
  const rem = { protein: remaining_protein || 0, fiber: remaining_fiber || 0, carb: remaining_carb || 0, fat: remaining_fat || 0 };

  const scored = GAP_FOODS
    .filter(f => f.kcal <= kcalBudget * 1.15)
    .map(f => {
      let score = 0;
      const multiBehind = behind.filter(m => f[m] > 5).length;
      behind.forEach(m => {
        if (f[m] >= rem[m] * 0.25) score += 2;
        if (f[m] >= rem[m] * 0.5)  score += 1;
      });
      if (multiBehind >= 2) score += 3; // big bonus for closing multiple gaps
      return { ...f, score };
    })
    .filter(f => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) { wrap.innerHTML = ''; return; }

  const names = { protein: 'protein', fat: 'fat', carb: 'carbs', fiber: 'fiber' };
  const label = behind.slice(0, 2).map(m => `<strong>${names[m]}</strong>`).join(' & ');

  wrap.innerHTML = `
    <div class="gap-fill-card">
      <h4>You're low on ${label} — smart picks to catch up:</h4>
      ${scored.map(s => `
        <div class="gap-fill-item">
          <span class="gf-name">${escapeHtml(s.name)}</span>
          <span class="gf-meta">${s.kcal} kcal · ${s.protein}g P${s.fiber ? ' · ' + s.fiber + 'g Fib' : ''}</span>
          <button class="gf-log" data-s='${JSON.stringify({name:s.name,kcal:s.kcal,protein:s.protein,fat:s.fat,carb:s.carb,fiber:s.fiber}).replace(/'/g,"&#39;")}'>Log</button>
        </div>`).join('')}
    </div>`;

  wrap.querySelectorAll('.gf-log').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = JSON.parse(btn.dataset.s.replace(/&#39;/g, "'"));
      await api('/api/log', { method: 'POST', body: { name: s.name, kcal: s.kcal, protein: s.protein, fat: s.fat, carb: s.carb, fiber: s.fiber, source: 'custom' } });
      showToast(`Logged: ${s.name}`);
      loadToday();
    });
  });
}

// ---------- MACRO REMAINING SUGGESTIONS ----------
async function loadMacroRemaining(data) {
  if (!data.stats) return;
  const hour = new Date().getHours();
  if (hour < 12) return; // only show after midday
  // Protein-only — user focuses on kcal + protein, fat/carb/fiber suggestions skipped to save AI calls
  const macros = [
    { key: 'protein', remaining: data.remaining_protein, target: data.stats.protein_g, containerId: 'macroProteinRemaining' }
  ];
  for (const m of macros) {
    const el = document.getElementById(m.containerId);
    if (!el || !m.remaining || m.remaining < 5) continue;
    el.innerHTML = `<div class="macro-remaining-card"><div class="mr-title">You have ${Math.round(m.remaining)}g ${m.key} left — quick options:</div><div class="mr-items" style="color:var(--text-dim);font-size:12px;">Loading…</div></div>`;
    try {
      const result = await api(`/api/macro-suggest?macro=${m.key}&remaining=${Math.round(m.remaining)}`);
      const itemsEl = el.querySelector('.mr-items');
      if (!itemsEl || result.error || !result.suggestions?.length) { if (itemsEl) itemsEl.textContent = ''; continue; }
      itemsEl.innerHTML = result.suggestions.map(s => `
        <div class="macro-remaining-item">
          <span class="mr-name">${escapeHtml(s.name)}</span>
          <span class="mr-note">${s.note || (s.kcal + ' kcal')}</span>
          <button class="mr-log" data-s='${JSON.stringify(s).replace(/'/g,"&#39;")}'>Log</button>
        </div>
      `).join('');
      itemsEl.querySelectorAll('.mr-log').forEach(btn => {
        btn.addEventListener('click', async () => {
          const s = JSON.parse(btn.dataset.s.replace(/&#39;/g, "'"));
          await api('/api/log', { method: 'POST', body: { name: s.name, kcal: s.kcal, protein: s.protein || 0, fat: s.fat || 0, carb: s.carb || 0, fiber: s.fiber || 0, source: 'ai-estimate' } });
          showToast(`Logged: ${s.name}`);
          loadToday();
        });
      });
    } catch (_) {
      const itemsEl = el.querySelector('.mr-items');
      if (itemsEl) itemsEl.textContent = '';
    }
  }
}
