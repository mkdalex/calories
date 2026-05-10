// ---------- HISTORY ----------
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let calRangeData = {}; // date -> { kcal, goal }
let calSelectedDate = null;

async function renderWeeklyReview() {
  const card = $('#weeklyReviewCard');
  if (!card) return;
  card.innerHTML = `<h2>Last 7 days</h2><div class="empty" style="padding:8px 0;">Loading…</div>`;
  const r = await api('/api/weekly-review');
  if (r.empty || !r.days_logged) {
    card.innerHTML = `<h2>Last 7 days</h2><div class="empty" style="padding:12px 0;">Nothing logged in the last 7 days.</div>`;
    return;
  }
  const goalRow = r.goal_kcal
    ? `<div class="wr-stat"><div class="wr-num">${r.days_hit_goal}/${r.days_logged}</div><div class="wr-lbl">days within goal</div></div>`
    : '';
  const avgVsGoal = r.goal_kcal ? r.avg_kcal - r.goal_kcal : null;
  const avgClr = avgVsGoal === null ? 'var(--text)' : avgVsGoal > 100 ? 'var(--danger)' : avgVsGoal < -200 ? 'var(--warn)' : 'var(--accent)';

  let weightLine = '';
  if (r.weight_delta_kg !== null) {
    const sign = r.weight_delta_kg < 0 ? '−' : '+';
    const clr = r.weight_delta_kg < 0 ? 'var(--accent)' : r.weight_delta_kg > 0 ? 'var(--danger)' : 'var(--text-dim)';
    weightLine = `<div style="font-size:13px;margin-top:8px;">Weight: <strong style="color:${clr};">${sign}${Math.abs(r.weight_delta_kg).toFixed(2)} kg</strong> · ${r.weight_start} → ${r.weight_end} kg</div>`;
  }

  const macroChips = Object.entries(r.macro_hit_days || {}).map(([k, v]) => {
    if (!r.macro_targets[k]) return '';
    const cls = v >= r.days_logged - 1 ? 'good' : v >= Math.ceil(r.days_logged / 2) ? 'mid' : 'bad';
    const labels = { protein: 'Protein', fat: 'Fat', carb: 'Carbs', fiber: 'Fiber' };
    return `<span class="wr-chip ${cls}">${labels[k]}: ${v}/${r.days_logged}</span>`;
  }).join('');

  const topFoods = (r.top_foods || []).length
    ? `<div style="margin-top:10px;">
        <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">Most-logged foods</div>
        ${r.top_foods.map(f => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;"><span>${escapeHtml(f.name)}</span><span style="color:var(--text-dim);">×${f.count} · ~${f.avg_kcal} kcal</span></div>`).join('')}
      </div>`
    : '';

  const heaviestStr = r.heaviest_day ? `${new Date(r.heaviest_day.date + 'T00:00:00').toLocaleDateString([], { weekday: 'short' })} (${r.heaviest_day.kcal.toLocaleString()})` : '—';
  const lightestStr = r.lightest_day ? `${new Date(r.lightest_day.date + 'T00:00:00').toLocaleDateString([], { weekday: 'short' })} (${r.lightest_day.kcal.toLocaleString()})` : '—';

  card.innerHTML = `
    <h2>Last 7 days <span style="font-size:11px;color:var(--text-dim);font-weight:400;">${r.start} → ${r.end}</span></h2>
    <div class="wr-stat-grid">
      <div class="wr-stat"><div class="wr-num" style="color:${avgClr};">${r.avg_kcal.toLocaleString()}</div><div class="wr-lbl">avg kcal/day${avgVsGoal !== null ? ` · ${avgVsGoal > 0 ? '+' : ''}${avgVsGoal} vs goal` : ''}</div></div>
      ${goalRow}
      <div class="wr-stat"><div class="wr-num">${r.days_logged}/7</div><div class="wr-lbl">days logged</div></div>
    </div>
    ${weightLine}
    <div style="margin-top:10px;font-size:13px;color:var(--text-dim);">
      Heaviest: <strong style="color:var(--text);">${heaviestStr}</strong> · Lightest: <strong style="color:var(--text);">${lightestStr}</strong>
    </div>
    ${macroChips ? `<div class="wr-chips">${macroChips}</div>` : ''}
    ${topFoods}
  `;
}

async function loadHistory() {
  // Weekly review card
  renderWeeklyReview();

  // Weight sparkline
  const weights = await api('/api/weight');
  if (weights.length) {
    const last = weights[weights.length - 1];
    $('#weightInput').value = last.kg;
    const min = Math.min(...weights.map(w => w.kg));
    const max = Math.max(...weights.map(w => w.kg));
    const range = Math.max(1, max - min);
    const w = 280, h = 60;
    const points = weights.slice(-30).map((wt, i, a) => {
      const x = (i / Math.max(1, a.length - 1)) * w;
      const y = h - ((wt.kg - min) / range) * h;
      return `${x},${y}`;
    }).join(' ');
    $('#weightHistory').innerHTML = `
      <svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="margin-top: 12px;">
        <polyline points="${points}" fill="none" stroke="var(--info)" stroke-width="2" />
      </svg>
      <div style="display: flex; justify-content: space-between; color: var(--text-dim); font-size: 12px; margin-top: 4px;">
        <span>${weights[0].date} (${weights[0].kg} kg)</span>
        <span>${last.date} (${last.kg} kg)</span>
      </div>
    `;
  } else {
    $('#weightHistory').innerHTML = '<div class="empty">No weight logged yet.</div>';
  }

  // Kcal trend (last 30 days) + DoW pattern (last 60 days) + calendar (current month) — fetch range once
  const now = new Date();
  const fmtDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const trendEnd = fmtDate(now);
  const trendStart = new Date(now); trendStart.setDate(trendStart.getDate() - 29);
  const trendStartStr = fmtDate(trendStart);
  const dowStart = new Date(now); dowStart.setDate(dowStart.getDate() - 59);
  const dowStartStr = fmtDate(dowStart);

  // Calendar month range
  const calStart = `${calYear}-${String(calMonth+1).padStart(2,'0')}-01`;
  const lastDay = new Date(calYear, calMonth+1, 0).getDate();
  const calEnd = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

  // Fetch widest range that covers everything (overlap handled by server returning only logged dates)
  const allStart = [dowStartStr, trendStartStr, calStart].sort()[0];
  const allEnd = [trendEnd, calEnd].sort().reverse()[0];
  calRangeData = await api(`/api/log-range?start=${allStart}&end=${allEnd}`);

  renderKcalTrend(trendStartStr, trendEnd, calRangeData);
  renderDowPattern(dowStartStr, trendEnd, calRangeData);
  renderCalendar();
}

function renderDowPattern(startStr, endStr, rangeData) {
  const el = $('#dowPatternCard');
  if (!el) return;
  const buckets = Array.from({ length: 7 }, () => ({ sum: 0, count: 0 }));
  Object.entries(rangeData).forEach(([date, info]) => {
    if (date < startStr || date > endStr) return;
    if (!info || !info.kcal) return;
    const dow = new Date(date + 'T00:00:00').getDay();
    buckets[dow].sum += info.kcal;
    buckets[dow].count += 1;
  });
  const dowNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const data = buckets.map((b, i) => ({ name: dowNames[i], avg: b.count > 0 ? Math.round(b.sum / b.count) : null, count: b.count }));
  const totalDays = data.reduce((a, d) => a + d.count, 0);
  if (totalDays < 7) {
    el.innerHTML = `<h2>Day-of-week pattern</h2><div class="empty" style="padding:12px 0;">Log ${7 - totalDays} more day${totalDays === 6 ? '' : 's'} to see your weekday patterns.</div>`;
    return;
  }
  const validAvgs = data.filter(d => d.avg !== null).map(d => d.avg);
  const max = Math.max(...validAvgs), min = Math.min(...validAvgs);
  const overall = Math.round(validAvgs.reduce((a, v) => a + v, 0) / validAvgs.length);
  const heaviest = data.reduce((best, d) => (d.avg !== null && (!best || d.avg > best.avg)) ? d : best, null);
  const lightest = data.reduce((best, d) => (d.avg !== null && (!best || d.avg < best.avg)) ? d : best, null);
  const heavyDelta = heaviest && lightest ? heaviest.avg - lightest.avg : 0;

  const insight = heavyDelta > 200
    ? `<strong style="color:var(--text);">${heaviest.name}</strong> is your heaviest (avg ${heaviest.avg.toLocaleString()} kcal) · <strong style="color:var(--text);">${lightest.name}</strong> is lightest (${lightest.avg.toLocaleString()}). That's ${heavyDelta} kcal/day spread.`
    : `Pretty consistent across the week — within ${heavyDelta} kcal/day.`;

  el.innerHTML = `
    <h2>Day-of-week pattern <span style="font-size:11px;color:var(--text-dim);font-weight:400;">last ${totalDays} day${totalDays === 1 ? '' : 's'}</span></h2>
    <div class="dow-grid">
      ${data.map(d => {
        const h = d.avg !== null ? Math.round((d.avg / max) * 100) : 0;
        const isHeavy = heaviest && d.name === heaviest.name && heavyDelta > 200;
        const isLight = lightest && d.name === lightest.name && heavyDelta > 200;
        return `<div class="dow-bar-wrap">
          <div class="dow-bar"><div class="dow-fill ${isHeavy ? 'heavy' : isLight ? 'light' : ''}" style="height:${h}%"></div></div>
          <div class="dow-val">${d.avg !== null ? d.avg.toLocaleString() : '—'}</div>
          <div class="dow-label">${d.name}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="dow-insight">${insight}</div>
  `;
}

function renderKcalTrend(startStr, endStr, rangeData) {
  const days = [];
  const d = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  while (d <= end) {
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const entry = rangeData[ds];
    days.push({ date: ds, kcal: entry ? entry.kcal : null, goal: entry ? entry.goal : null });
    d.setDate(d.getDate() + 1);
  }
  const goal = days.find(d => d.goal)?.goal || null;
  const loggedDays = days.filter(d => d.kcal !== null);
  if (!loggedDays.length) {
    $('#kcalTrendChart').innerHTML = '<div class="empty" style="padding:20px 0;">No data logged yet.</div>';
    $('#kcalTrendStats').innerHTML = '';
    return;
  }

  const avgKcal = Math.round(loggedDays.reduce((a, d) => a + d.kcal, 0) / loggedDays.length);
  const hitGoal = goal ? loggedDays.filter(d => d.kcal <= goal).length : 0;
  const avgDiff = goal ? Math.round(avgKcal - goal) : null;

  $('#kcalTrendStats').innerHTML = `
    <span><strong>${avgKcal.toLocaleString()}</strong> 30d avg</span>
    ${goal ? `<span>Goal: <strong>${goal.toLocaleString()}</strong></span>` : ''}
    ${goal ? `<span>Hit goal: <strong>${hitGoal}/${loggedDays.length}</strong> days</span>` : ''}
    ${avgDiff !== null ? `<span style="color:${avgDiff > 0 ? 'var(--danger)' : 'var(--accent)'};">${avgDiff > 0 ? '+' + avgDiff : avgDiff} avg vs goal</span>` : ''}
  `;

  const W = 560, H = 80;
  const allKcals = loggedDays.map(d => d.kcal);
  const minK = Math.max(0, Math.min(...allKcals) - 200);
  const maxK = Math.max(...allKcals) + 200;
  const xOf = (i) => (i / Math.max(1, days.length - 1)) * W;
  const yOf = (k) => H - ((k - minK) / (maxK - minK)) * H;

  // Actual kcal line (gaps for null days)
  let pathD = '';
  days.forEach((d, i) => {
    if (d.kcal === null) return;
    const x = xOf(i), y = yOf(d.kcal);
    pathD += pathD === '' || days[i-1]?.kcal === null ? `M${x},${y}` : `L${x},${y}`;
  });

  // 7-day rolling average
  let avgPath = '';
  days.forEach((_, i) => {
    if (i < 6) return;
    const window = days.slice(i-6, i+1).filter(d => d.kcal !== null);
    if (window.length < 3) return;
    const avg = window.reduce((a, d) => a + d.kcal, 0) / window.length;
    const x = xOf(i), y = yOf(avg);
    avgPath += avgPath === '' ? `M${x},${y}` : `L${x},${y}`;
  });

  const goalY = goal ? yOf(goal) : null;

  $('#kcalTrendChart').innerHTML = `
    <svg width="100%" height="${H+2}" viewBox="0 0 ${W} ${H+2}" preserveAspectRatio="none" style="margin-top:4px;">
      ${goalY !== null ? `<line x1="0" y1="${goalY}" x2="${W}" y2="${goalY}" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-dasharray="6 4"/>` : ''}
      ${pathD ? `<path d="${pathD}" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>` : ''}
      ${avgPath ? `<path d="${avgPath}" fill="none" stroke="var(--info)" stroke-width="2.5"/>` : ''}
    </svg>
    <div style="display:flex;justify-content:space-between;color:var(--text-dim);font-size:11px;margin-top:4px;">
      <span>${days[0].date}</span>
      <span style="display:flex;align-items:center;gap:10px;">
        <span><span style="display:inline-block;width:18px;height:2px;background:rgba(255,255,255,0.5);vertical-align:middle;"></span> daily</span>
        <span><span style="display:inline-block;width:18px;height:2.5px;background:var(--info);vertical-align:middle;border-radius:2px;"></span> 7d avg</span>
        ${goal ? `<span><span style="display:inline-block;width:18px;height:1.5px;background:rgba(255,255,255,0.15);vertical-align:middle;border:none;"></span> goal</span>` : ''}
      </span>
      <span>${days[days.length-1].date}</span>
    </div>
  `;
}

function renderCalendar() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  $('#calMonthLabel').textContent = `${monthNames[calMonth]} ${calYear}`;
  $('#calPrev').disabled = false;
  $('#calNext').disabled = (calYear > now.getFullYear()) || (calYear === now.getFullYear() && calMonth >= now.getMonth());

  const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const goal = Object.values(calRangeData).find(d => d.goal)?.goal || null;

  let html = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('');

  // Blank cells before first day
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell outside"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const ds = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const entry = calRangeData[ds];
    const isToday = ds === todayStr;
    const isFuture = ds > todayStr;
    const isSelected = ds === calSelectedDate;
    let cls = 'cal-cell';
    if (isToday) cls += ' today';
    if (isSelected) cls += ' selected';
    if (isFuture) cls += ' outside';
    else if (!entry) cls += ' empty-log';
    else if (goal && entry.kcal <= goal + 200) cls += ' on-target';
    else if (goal && entry.kcal < goal - 300) cls += ' under';
    else cls += ' over';

    html += `<div class="${cls}" data-date="${ds}">
      <div class="cal-day-num">${day}</div>
      ${entry ? `<div class="cal-day-kcal">${entry.kcal.toLocaleString()}</div>` : ''}
    </div>`;
  }

  $('#calGrid').innerHTML = html;
  $$('.cal-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', async () => {
      const date = cell.dataset.date;
      if (!date || date > todayStr) return;
      if (calSelectedDate === date) {
        calSelectedDate = null;
        $('#calDetail').innerHTML = '';
        cell.classList.remove('selected');
        return;
      }
      calSelectedDate = date;
      $$('.cal-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      await renderCalDetail(date);
    });
  });
}

async function renderCalDetail(date) {
  $('#calDetail').innerHTML = '<div style="padding:8px 0;color:var(--text-dim);font-size:13px;">Loading…</div>';
  const data = await api('/api/log?date=' + date);
  const niceDate = new Date(date + 'T00:00:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const header = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;">
      <div style="font-size:13px;font-weight:600;">${niceDate}${data.entries.length ? ` — ${data.totals.kcal} kcal · ${Math.round(data.totals.protein)}g P` : ''}</div>
      <button class="btn btn-secondary" id="calAddMeal" style="padding:6px 12px;font-size:12px;white-space:nowrap;">+ Add meal</button>
    </div>`;
  let body;
  if (!data.entries.length) {
    body = '<div style="padding:8px 0;color:var(--text-dim);font-size:13px;">Nothing logged this day. Tap + Add meal to backfill.</div>';
  } else {
    body = data.entries.map(e => `
      <div class="cal-entry-row" data-eid="${e.id}" style="display:flex;justify-content:space-between;align-items:center;padding:8px 4px;border-bottom:1px solid var(--border);font-size:13px;cursor:pointer;border-radius:4px;">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px;">${escapeHtml(e.name)}</span>
        <span style="color:var(--text-dim);white-space:nowrap;">${e.kcal} kcal · ${e.protein}g P</span>
      </div>
    `).join('');
  }
  $('#calDetail').innerHTML = `<div style="padding:8px 0;">${header}${body}</div>`;
  $('#calAddMeal').addEventListener('click', () => openLogModal(date));
  $$('#calDetail .cal-entry-row').forEach(row => {
    row.addEventListener('mouseenter', () => row.style.background = 'var(--panel-2)');
    row.addEventListener('mouseleave', () => row.style.background = '');
    row.addEventListener('click', () => {
      const e = data.entries.find(en => en.id === row.dataset.eid);
      if (e) openEditModal(e, date);
    });
  });
}

$('#calPrev').addEventListener('click', async () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  calSelectedDate = null;
  $('#calDetail').innerHTML = '';
  const calStart = `${calYear}-${String(calMonth+1).padStart(2,'0')}-01`;
  const lastDay = new Date(calYear, calMonth+1, 0).getDate();
  const calEnd = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  const newData = await api(`/api/log-range?start=${calStart}&end=${calEnd}`);
  Object.assign(calRangeData, newData);
  renderCalendar();
});
$('#calNext').addEventListener('click', async () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  calSelectedDate = null;
  $('#calDetail').innerHTML = '';
  const calStart = `${calYear}-${String(calMonth+1).padStart(2,'0')}-01`;
  const lastDay = new Date(calYear, calMonth+1, 0).getDate();
  const calEnd = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  const newData = await api(`/api/log-range?start=${calStart}&end=${calEnd}`);
  Object.assign(calRangeData, newData);
  renderCalendar();
});

$('#weightSave').addEventListener('click', async () => {
  const kg = Number($('#weightInput').value);
  if (!kg) return showToast('Enter weight');
  await api('/api/weight', { method: 'POST', body: { kg } });
  showToast('Weight logged');
  loadHistory();
  loadProfile();
});
