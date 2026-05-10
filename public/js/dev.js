// ---------- DEV ----------
async function loadDev() {
  loadHealth();
  loadUsage();
}

async function loadHealth() {
  $('#healthList').innerHTML = '<div class="empty">Pinging APIs...</div>';
  const data = await api('/api/health');
  const labels = {
    openai: 'OpenAI', openfoodfacts: 'Open Food Facts', fatsecret: 'FatSecret', usda: 'USDA'
  };
  $('#healthList').innerHTML = Object.entries(data.checks).map(([k, c]) => `
    <div class="health-row">
      <div class="dot ${c.status}"></div>
      <div class="health-name">${labels[k] || k}</div>
      <div class="health-detail">${escapeHtml(c.detail)}${c.model ? ` <span style="color: var(--text-dim);">(${escapeHtml(c.model)})</span>` : ''}</div>
    </div>
  `).join('');
  if (data.public_ip) {
    $('#healthIp').innerHTML = `Your public IP: <strong style="color: var(--text);">${escapeHtml(data.public_ip)}</strong> &mdash; whitelist this in FatSecret if its status is red.`;
  }
}

$('#healthRefresh').addEventListener('click', loadHealth);

async function loadUsage() {
  const data = await api('/api/usage');
  const fmt = (n) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toString();
  const cents = (n) => n < 0.01 ? `$${(n).toFixed(4)}` : `$${n.toFixed(2)}`;

  $('#usageStats').innerHTML = `
    <div class="stat-grid">
      <div class="stat-box">
        <div class="label">Today</div>
        <div class="value">${cents(data.today.cost_usd)}</div>
        <div class="sub">${data.today.calls} calls · ${fmt(data.today.in_tokens + data.today.out_tokens)} tokens</div>
      </div>
      <div class="stat-box">
        <div class="label">Last 7 days</div>
        <div class="value">${cents(data.last_7_days.cost_usd)}</div>
        <div class="sub">${data.last_7_days.calls} calls · ${fmt(data.last_7_days.in_tokens + data.last_7_days.out_tokens)} tokens</div>
      </div>
      <div class="stat-box">
        <div class="label">All time</div>
        <div class="value">${cents(data.all_time.cost_usd)}</div>
        <div class="sub">${data.all_time.calls} calls · ${fmt(data.all_time.in_tokens + data.all_time.out_tokens)} tokens</div>
      </div>
    </div>
    <div style="color: var(--text-dim); font-size: 12px; margin-top: 10px;">
      Model: <strong style="color: var(--text);">${escapeHtml(data.model)}</strong> &mdash;
      $${data.pricing_per_1m.in}/M input, $${data.pricing_per_1m.out}/M output.
      ${data.all_time.reasoning_tokens > 0 ? ` Reasoning tokens used: ${fmt(data.all_time.reasoning_tokens)}.` : ''}
    </div>
  `;

  $('#usageEndpoints').innerHTML = Object.keys(data.by_endpoint).length
    ? Object.entries(data.by_endpoint).map(([k, v]) => `
        <div class="health-row">
          <div class="health-name">${escapeHtml(k)}</div>
          <div class="health-detail">${v.calls} call${v.calls !== 1 ? 's' : ''} · ${cents(v.cost_usd)}</div>
        </div>
      `).join('')
    : '<div class="empty">No AI calls yet.</div>';

  $('#usageRecent').innerHTML = data.recent.length
    ? data.recent.map(r => `
        <div class="recent-call">
          <span style="color: var(--text-dim);">${new Date(r.ts).toLocaleTimeString()}</span>
          <span>${escapeHtml(r.endpoint)}</span>
          <span style="color: var(--text-dim);">${r.in}+${r.out}t${r.reasoning ? ` (${r.reasoning}r)` : ''}</span>
          <span style="color: var(--accent);">${cents(r.cost)}</span>
        </div>
      `).join('')
    : '<div class="empty">No recent calls.</div>';
}

$('#usageReset').addEventListener('click', async () => {
  if (!confirm('Clear all usage history?')) return;
  await fetch('/api/usage', { method: 'DELETE' });
  loadUsage();
});
