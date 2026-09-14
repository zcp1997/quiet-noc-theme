const state = {
  payload: null,
  me: null,
  filter: 'ALL',
  view: localStorage.getItem('quiet-noc-view') || 'grid',
  theme: localStorage.getItem('quiet-noc-theme') || 'system',
  rxSeries: [],
  txSeries: [],
  nodeSeries: new Map(),
  statusChanged: new Set(),
  chartRegistry: new Map(),
  chartSeq: 0,
  socket: null,
  reconnectTimer: null,
  lastUpdate: null,
  connected: false,
  pendingLivePatch: false,
  pendingStructuralRender: false,
  selectionTimer: null,
  routeNodeId: readNodeRoute(),
  exchangeRates: defaultExchangeRates(),
  exchangeSource: 'default',
  exchangeUpdatedAt: null,
  detail: {
    tab: 'resources',
    hours: { resources: 6, latency: 6 },
    key: '',
    loading: false,
    error: '',
    data: null,
  },
};

const $ = (s) => document.querySelector(s);
const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));
const escapeHtml = (v = '') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const CURRENCY_SYMBOLS = { CNY: '¥', USD: '$', HKD: 'HK$', EUR: '€', GBP: '£', JPY: '¥', RUB: '₽', CHF: '₣', INR: '₹', VND: '₫', THB: '฿', CAD: 'CA$' };
const EXCHANGE_CACHE_KEY = 'quiet_noc_exchange_rates_cny_v1';
const EXCHANGE_APIS = [
  ['https://open.er-api.com/v6/latest/CNY', data => data?.rates],
  ['https://api.frankfurter.app/latest?from=CNY', data => data?.rates],
];
const SUPPORTED_CURRENCIES = ['CNY','USD','HKD','EUR','GBP','JPY','RUB','CHF','INR','VND','THB','CAD'];

function defaultExchangeRates() {
  return { CNY: 1, USD: 0.142536, HKD: 1.108377, EUR: 0.12102, GBP: 0.105581, JPY: 22.231552, RUB: 13.5, CHF: 0.12, INR: 11.8, VND: 3500, THB: 5, CAD: 0.19 };
}

function applyTheme() {
  const chosen = state.theme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : state.theme;
  document.documentElement.dataset.theme = chosen;
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => state.theme === 'system' && applyTheme());

function icon(name) {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const paths = {
    server: '<rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01"/>',
    coins: '<circle cx="9" cy="8" r="4"/><path d="M13 8h3a4 4 0 1 1-3.5 5.9M6 12.7V16a4 4 0 0 0 7 2.6"/>',
    traffic: '<path d="M8 4v16m0-16-3 3m3-3 3 3M16 20V4m0 16-3-3m3 3 3-3"/>',
    wifi: '<path d="M4 9a13 13 0 0 1 16 0M7 12a8 8 0 0 1 10 0M10 15a3 3 0 0 1 4 0M12 18h.01"/>',
    moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5-5L7 4l3 3-3 3-3-3-2.7 2.7a4 4 0 0 0 5 5L14 22l2-2-7.7-7.7a4 4 0 0 0 5-5Z"/>',
    arrowLeft: '<path d="m15 18-6-6 6-6"/>',
    arrowDown: '<path d="M12 4v16m0 0-5-5m5 5 5-5"/>',
    arrowUp: '<path d="M12 20V4m0 0-5 5m5-5 5 5"/>',
    cpu: '<rect x=7 y=7 width=10 height=10 rx=2/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3M10 10h4v4h-4z"/>',
  };
  return `<svg ${common} aria-hidden="true">${paths[name] || ''}</svg>`;
}

function bytes(v, decimals = 1) {
  v = Number(v || 0);
  if (v < 1024) return `${Math.round(v)} B`;
  const units = ['KB','MB','GB','TB','PB'];
  let n = v / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  const d = n >= 100 ? 0 : n >= 10 ? 1 : decimals;
  return `${n.toFixed(d)} ${units[i]}`;
}
function rate(v) { return `${bytes(v)}/s`; }
function pct(v) { return `${clamp(Number(v)).toFixed(Number(v) < 10 ? 1 : 0)}%`; }
function shortOS(os = '') {
  const s = String(os || '');
  const debian = s.match(/Debian(?: GNU\/Linux)?\s+(\d+)/i);
  if (debian) return `Debian ${debian[1]}`;
  const ubuntu = s.match(/Ubuntu\s+([\d.]+)/i);
  if (ubuntu) return `Ubuntu ${ubuntu[1]}`;
  return s.replace(' GNU/Linux', '').replace(/\s+\([^)]*\)$/, '') || 'Linux';
}
function shortCpuName(name = '') {
  let s = String(name || '').trim();
  if (!s) return '';
  s = s.replace(/\(R\)|\(TM\)/gi, '').replace(/\s+/g, ' ').trim();
  let m = s.match(/EPYC\s+([A-Z0-9-]+)/i);
  if (m) return `EPYC ${m[1]}`;
  m = s.match(/Ryzen\s+(?:Threadripper\s+)?(?:PRO\s+)?([3579]\s+[A-Z0-9-]+)/i);
  if (m) return `Ryzen ${m[1]}`;
  m = s.match(/Xeon\s+(Gold|Silver|Platinum|Bronze)?\s*([A-Z0-9-]+)/i);
  if (m) return `Xeon${m[1] ? ` ${m[1]}` : ''} ${m[2]}`.trim();
  m = s.match(/Apple\s+(M\d+(?:\s+(?:Pro|Max|Ultra))?)/i);
  if (m) return `Apple ${m[1]}`;
  s = s
    .replace(/^AMD\s+/i, '')
    .replace(/^Intel\s+/i, '')
    .replace(/\s+\d+-Core Processor.*$/i, '')
    .replace(/\s+CPU\s+@.*$/i, '')
    .replace(/\s+Processor.*$/i, '')
    .trim();
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
}
function cpuBadge(node) {
  const full = String(node.cpu_name || '').trim();
  const short = shortCpuName(full);
  if (!short) return '';
  return `<span class="cpu-badge" title="${escapeHtml(full)}"><span class="cpu-badge-icon">${icon('cpu')}</span><span>${escapeHtml(short)}</span></span>`;
}

function duration(sec) {
  sec = Math.max(0, Math.floor(Number(sec || 0)));
  const d = Math.floor(sec / 86400); sec %= 86400;
  const h = Math.floor(sec / 3600); sec %= 3600;
  const m = Math.floor(sec / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}
function money(node) {
  const amount = Number(node.price || 0);
  if (!amount) return '';
  const currency = normalizeCurrency(node.currency);
  const cycle = { monthly: '/月', quarterly: '/季', semi_annual: '/半年', semiannual: '/半年', yearly: '/年', annual: '/年', biennial: '/2年', triennial: '/3年', quinquennial: '/5年', lifetime: '', once: '' };
  return `${CURRENCY_SYMBOLS[currency] || `${currency} `}${formatNumber(amount, 2)}${cycle[String(node.billing_cycle || '').toLowerCase()] || ''}`;
}
function expiry(node) {
  if (!node.expires_at) return null;
  const ts = Date.parse(node.expires_at);
  if (!Number.isFinite(ts)) return null;
  const days = Math.ceil((ts - Date.now()) / 86400000);
  return { days, text: days >= 0 ? `${days} 天后到期` : `已过期 ${Math.abs(days)} 天`, cls: days <= 7 ? 'urgent' : days <= 30 ? 'soon' : '' };
}
function metricClass(v) { return v >= 85 ? 'danger' : v >= 70 ? 'warn' : ''; }
function monthUsage(node) {
  const rx = Number(node.month_rx || 0), tx = Number(node.month_tx || 0);
  switch (String(node.traffic_mode || 'sum').toLowerCase()) {
    case 'up': return tx;
    case 'down': return rx;
    case 'max': return Math.max(rx, tx);
    default: return rx + tx;
  }
}
function trafficPercent(node) {
  const limit = Number(node.traffic_limit || 0);
  return limit > 0 ? monthUsage(node) / limit * 100 : 0;
}
function nodeSeverity(node) {
  if (!node.online) return 'offline';
  const m = node.metrics || {};
  const mem = Number(m.mem_total || node.mem_total || 0) ? Number(m.mem_used || 0) / Number(m.mem_total || node.mem_total) * 100 : 0;
  const disk = Number(m.disk_total || node.disk_total || 0) ? Number(m.disk_used || 0) / Number(m.disk_total || node.disk_total) * 100 : 0;
  const cpu = Number(m.cpu || 0);
  const traffic = trafficPercent(node);
  const exp = expiry(node);
  const max = Math.max(cpu, mem, disk);
  if (max >= 85 || traffic >= 95 || exp?.days <= 7) return 'danger';
  if (max >= 70 || traffic >= 80 || exp?.days <= 30) return 'warn';
  return '';
}
function formatNumber(value, max = 2) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: max }).format(Number(value || 0));
}
function formatCNY(value) {
  return `¥${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))}`;
}
function normalizeCurrency(currency) {
  const v = String(currency || 'CNY').trim().toUpperCase();
  if (v === '$') return 'USD';
  if (v === 'HK$') return 'HKD';
  if (v === '€') return 'EUR';
  if (v === '£') return 'GBP';
  if (v === '₽') return 'RUB';
  if (v === '₣') return 'CHF';
  if (v === '₹') return 'INR';
  if (v === '₫') return 'VND';
  if (v === '฿') return 'THB';
  if (v === 'CA$' || v === 'C$' || v === 'CAD$') return 'CAD';
  return SUPPORTED_CURRENCIES.includes(v) ? v : 'CNY';
}
function billingCycleDays(cycle) {
  const v = String(cycle || '').toLowerCase();
  const table = { monthly: 30, quarterly: 90, semi_annual: 182.5, semiannual: 182.5, halfyearly: 182.5, yearly: 365, annual: 365, biennial: 730, triennial: 1095, quinquennial: 1825 };
  if (table[v]) return table[v];
  const numeric = Number(cycle);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}
function priceCNY(node) {
  const price = Number(node.price || 0);
  if (!Number.isFinite(price) || price <= 0) return 0;
  const cur = normalizeCurrency(node.currency);
  if (cur === 'CNY') return price;
  const r = Number(state.exchangeRates?.[cur]);
  return Number.isFinite(r) && r > 0 ? price / r : 0;
}
function remainingValueCNY(node, now = Date.now()) {
  if (!node.expires_at) return 0;
  const price = priceCNY(node);
  if (price <= 0) return 0;
  const end = Date.parse(node.expires_at);
  if (!Number.isFinite(end) || end <= now) return 0;
  const diffDays = Math.ceil((end - now) / 86400000);
  if (diffDays > 36500) return price;
  const days = billingCycleDays(node.billing_cycle);
  if (days <= 0) return price;
  return price * (diffDays / days);
}
function fleetRemainingValue(nodes) {
  let value = 0, count = 0;
  for (const node of nodes) {
    const v = remainingValueCNY(node);
    if (v > 0) { value += v; count++; }
  }
  return { value, count };
}

function sparkPath(arr, w = 220, h = 34) {
  if (!arr.length) arr = [0, 0];
  const max = Math.max(1, ...arr);
  const min = Math.min(...arr);
  const range = Math.max(1, max - min);
  const pts = arr.map((v, i) => {
    const x = arr.length === 1 ? 0 : i / (arr.length - 1) * w;
    const y = h - 2 - ((v - min) / range) * (h - 5);
    return [x, y];
  });
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return { line, area };
}

function normalizePayload(raw) {
  if (Array.isArray(raw)) return { admin: false, nodes: raw };
  if (raw && Array.isArray(raw.nodes)) return raw;
  return { admin: false, nodes: [] };
}
function sortedNodes() {
  const nodes = [...(state.payload?.nodes || [])];
  return nodes.sort((a,b) => (a.sort ?? 999999) - (b.sort ?? 999999) || (a.id ?? 0) - (b.id ?? 0));
}
function region(node) { return String(node.country || '').trim().toUpperCase(); }
function filteredNodes() {
  const nodes = sortedNodes();
  return state.filter === 'ALL' ? nodes : nodes.filter(n => region(n) === state.filter);
}
function aggregate() {
  const nodes = sortedNodes();
  let online = 0, dayRx = 0, dayTx = 0, totalRx = 0, totalTx = 0, liveRx = 0, liveTx = 0;
  for (const n of nodes) {
    if (n.online) online++;
    dayRx += Number(n.day_rx || 0); dayTx += Number(n.day_tx || 0);
    totalRx += Number(n.total_rx || 0); totalTx += Number(n.total_tx || 0);
    const m = n.metrics || {};
    liveRx += Number(m.net_rx || 0); liveTx += Number(m.net_tx || 0);
  }
  return { nodes, online, dayRx, dayTx, totalRx, totalTx, liveRx, liveTx };
}
function pushSeries(rx, tx) {
  state.rxSeries.push(rx); state.txSeries.push(tx);
  if (state.rxSeries.length > 60) state.rxSeries.shift();
  if (state.txSeries.length > 60) state.txSeries.shift();
}
function pushNodeSeries(nodes) {
  const seen = new Set();
  for (const node of nodes || []) {
    const id = Number(node.id);
    seen.add(id);
    const m = node.metrics;
    if (!m) continue;
    const memTotal = Number(m.mem_total || node.mem_total || 0);
    const diskTotal = Number(m.disk_total || node.disk_total || 0);
    const sample = {
      cpu: clamp(Number(m.cpu || 0)),
      mem: memTotal ? clamp(Number(m.mem_used || 0) / memTotal * 100) : 0,
      disk: diskTotal ? clamp(Number(m.disk_used || 0) / diskTotal * 100) : 0,
    };
    const series = state.nodeSeries.get(id) || { cpu: [], mem: [], disk: [] };
    for (const key of ['cpu','mem','disk']) {
      series[key].push(sample[key]);
      if (series[key].length > 20) series[key].shift();
    }
    state.nodeSeries.set(id, series);
  }
  // Drop histories for nodes removed from the panel.
  for (const id of state.nodeSeries.keys()) if (!seen.has(id)) state.nodeSeries.delete(id);
}
function miniTrend(values) {
  // Keep the SVG node present from the first sample onward.  A stable DOM shape
  // lets the live patcher update only the path attribute instead of inserting or
  // removing children, which is important while nearby text is selected.
  const line = values && values.length >= 2 ? sparkPath(values, 38, 14).line : '';
  return `<svg class="metric-spark" viewBox="0 0 38 14" preserveAspectRatio="none" aria-hidden="true"><path d="${line}"/></svg>`;
}
function metricBlock(label, value, detail, trend=[]) {
  const c = metricClass(value);
  const detailHtml = Array.isArray(detail)
    ? `<div class="metric-detail load-detail" title="Load Average · 1 / 5 / 15 分钟">${detail.map((v) => `<span>${escapeHtml(v)}</span>`).join('')}</div>`
    : `<div class="metric-detail">${escapeHtml(detail)}</div>`;
  return `<div class="metric ${c}">
    <div class="metric-top"><span>${label}</span><span class="metric-value">${miniTrend(trend)}<strong>${pct(value)}</strong></span></div>
    <div class="progress"><span style="width:${clamp(value)}%"></span></div>
    ${detailHtml}
  </div>`;
}
function trafficQuotaMeta(node) {
  const limit = Number(node.traffic_limit || 0);
  if (!(limit > 0)) return '';
  const used = monthUsage(node);
  const p = used / limit * 100;
  const tone = p >= 95 ? 'danger' : p >= 80 ? 'warn' : '';
  const mode = { up:'仅上传', down:'仅下载', max:'取较大值', sum:'上下行合计' }[String(node.traffic_mode || 'sum').toLowerCase()] || '上下行合计';
  const resetDay = Number(node.traffic_reset_day || 0);
  const reset = resetDay > 0 ? ` · ${resetDay} 日重置` : '';
  const title = `本月 ${bytes(used)} / ${bytes(limit)} · ${mode}${resetDay > 0 ? ` · 每月 ${resetDay} 日重置` : ''}`;
  return `<span class="quota-meta ${tone}" title="${escapeHtml(title)}">流量 ${formatNumber(p, p < 10 ? 1 : 0)}%${escapeHtml(reset)}</span>`;
}
function billingPill(node) {
  const price = money(node);
  const exp = expiry(node);
  if (!price && !exp) return '';
  const sep = price && exp ? '<span class="billing-sep">·</span>' : '';
  const remain = remainingValueCNY(node);
  const title = remain > 0 ? ` title="剩余价值 ${escapeHtml(formatCNY(remain))}"` : '';
  return `<span class="billing-pill ${exp?.cls || ''}"${title}>${price ? `<span>${escapeHtml(price)}</span>` : ''}${sep}${exp ? `<span>${escapeHtml(exp.text)}</span>` : ''}</span>`;
}

function nodeCard(n) {
  const m = n.metrics || {};
  const cpu = Number(m.cpu || 0);
  const memTotal = Number(m.mem_total || n.mem_total || 0);
  const memUsed = Number(m.mem_used || 0);
  const memPct = memTotal ? memUsed / memTotal * 100 : 0;
  const diskTotal = Number(m.disk_total || n.disk_total || 0);
  const diskUsed = Number(m.disk_used || 0);
  const diskPct = diskTotal ? diskUsed / diskTotal * 100 : 0;
  const up = Number(m.net_tx || 0), down = Number(m.net_rx || 0);
  const r = region(n);
  const os = shortOS(n.os);
  const status = n.online ? `在线 ${duration(m.uptime)}` : `离线${n.last_seen ? ` · ${new Date(n.last_seen * 1000).toLocaleString('zh-CN', {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'})}` : ''}`;
  const sysTitle = [n.cpu_name, n.virt && n.virt !== 'none' ? String(n.virt).toUpperCase() : '', n.arch].filter(Boolean).join(' · ');
  const trends = state.nodeSeries.get(Number(n.id)) || { cpu: [], mem: [], disk: [] };
  const changed = state.statusChanged.has(Number(n.id)) ? ' status-changed' : '';
  return `<article class="node-card ${nodeSeverity(n)}${changed}" data-node-id="${Number(n.id)}" role="button" tabindex="0" aria-label="查看 ${escapeHtml(n.name || `Node ${n.id}`)} 详情">
    <div class="node-head">
      <div class="node-title-wrap">
        <div class="node-title-row">
          <div class="node-title">${escapeHtml(n.name || `Node ${n.id}`)}</div>
          ${r ? `<span class="region-pill">${escapeHtml(r)}</span>` : ''}
          <span class="os-pill"${sysTitle ? ` title="${escapeHtml(sysTitle)}"` : ''}>${escapeHtml(os)}</span>
        </div>
      </div>
      <div class="status-pill"><span class="status-dot"></span>${escapeHtml(status)}</div>
    </div>
    <div class="metrics">
      ${metricBlock(`CPU ${n.cpu_cores || 0} 核`, cpu, (m.load || [0,0,0]).map(x => Number(x || 0).toFixed(2)), trends.cpu)}
      ${metricBlock('内存', memPct, `${bytes(memUsed, 2)} / ${bytes(memTotal, 2)}`, trends.mem)}
      ${metricBlock('硬盘', diskPct, `${bytes(diskUsed, 2)} / ${bytes(diskTotal, 2)}`, trends.disk)}
    </div>
    <div class="network">
      <div class="net-matrix">
        <span></span><span class="net-head">实时</span><span class="net-head">今日</span><span class="net-head net-total">累计</span>
        <span class="net-direction" title="下载"><span class="net-icon">${icon('arrowDown')}</span><span class="net-direction-text">下载</span></span>
        <span class="net-cell live">${rate(down)}</span><span class="net-cell">${bytes(n.day_rx || 0)}</span><span class="net-cell net-total">${bytes(n.total_rx || 0)}</span>
        <span class="net-direction" title="上传"><span class="net-icon">${icon('arrowUp')}</span><span class="net-direction-text">上传</span></span>
        <span class="net-cell live">${rate(up)}</span><span class="net-cell">${bytes(n.day_tx || 0)}</span><span class="net-cell net-total">${bytes(n.total_tx || 0)}</span>
      </div>
    </div>
    <div class="node-extra"><div class="node-extra-left">${trafficQuotaMeta(n)}${billingPill(n)}</div>${cpuBadge(n)}</div>
  </article>`;
}


function listMetric(value) { return pct(value); }
function nodeListRow(n) {
  const m = n.metrics || {};
  const memTotal = Number(m.mem_total || n.mem_total || 0);
  const diskTotal = Number(m.disk_total || n.disk_total || 0);
  const mem = memTotal ? Number(m.mem_used || 0) / memTotal * 100 : 0;
  const disk = diskTotal ? Number(m.disk_used || 0) / diskTotal * 100 : 0;
  const r = region(n), os = shortOS(n.os);
  const exp = expiry(n);
  const status = n.online ? '在线' : '离线';
  const statusClass = n.online ? '' : ' status-offline';
  const uptimeText = n.online && m.uptime ? duration(m.uptime) : (n.last_seen ? new Date(n.last_seen * 1000).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—');
  const expClass = exp?.cls ? ` ${exp.cls}` : '';
  const dayTraffic = `↓ ${bytes(n.day_rx || 0)} · ↑ ${bytes(n.day_tx || 0)}`;
  const live = `↓ ${rate(Number(m.net_rx || 0))} · ↑ ${rate(Number(m.net_tx || 0))}`;
  return `<tr data-node-id="${Number(n.id)}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(n.name || `Node ${n.id}`)} 详情">
    <td class="list-node"><div class="list-node-main"><span class="list-node-name">${escapeHtml(n.name || `Node ${n.id}`)}</span>${r ? `<span class="region-pill">${escapeHtml(r)}</span>` : ''}</div><span class="list-node-meta">${escapeHtml(os)}</span></td>
    <td><span class="list-status${statusClass}"><span class="status-dot"></span>${status}</span><span class="list-sub">${escapeHtml(uptimeText)}</span></td>
    <td class="list-strong">${listMetric(Number(m.cpu || 0))}</td>
    <td class="list-strong">${listMetric(mem)}</td>
    <td class="list-strong">${listMetric(disk)}</td>
    <td><span class="list-strong">${escapeHtml(live)}</span></td>
    <td>${escapeHtml(dayTraffic)}</td>
    <td><span class="list-expiry${expClass}">${escapeHtml(exp?.text || '∞')}</span></td>
  </tr>`;
}
function nodeListTable(nodes) {
  const rows = nodes.map(nodeListRow).join('');
  return `<div class="node-list-wrap"><table class="node-table"><thead><tr><th>节点</th><th>状态</th><th>CPU</th><th>内存</th><th>硬盘</th><th>实时网速</th><th>今日流量</th><th>到期</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function exchangeSourceLabel() {
  return state.exchangeSource === 'network' ? '今日汇率' : state.exchangeSource === 'cache' ? '今日汇率缓存' : state.exchangeSource === 'stale-cache' ? '缓存汇率' : '备用汇率';
}

function summaryCards(a) {
  const rx = sparkPath(state.rxSeries), tx = sparkPath(state.txSeries);
  const remaining = fleetRemainingValue(a.nodes);
  return `<section class="summary-grid">
    <div class="summary-card" data-summary-card="nodes">
      <div class="summary-head"><span class="summary-icon status-summary">${icon('server')}</span><span>节点</span></div>
      <div class="summary-main">${a.online} / ${a.nodes.length}</div>
      <div class="summary-sub">${a.online === a.nodes.length ? '全部在线' : `${a.nodes.length - a.online} 个节点异常`}</div>
    </div>
    <div class="summary-card" data-summary-card="speed">
      <div class="summary-head"><span class="summary-icon">${icon('wifi')}</span><span>实时网速</span></div>
      <div class="summary-dual"><div><small>↓ 下载</small><strong>${rate(a.liveRx)}</strong></div><div><small>↑ 上传</small><strong>${rate(a.liveTx)}</strong></div></div>
      <div class="spark-wrap"><svg class="sparkline" viewBox="0 0 220 34" preserveAspectRatio="none"><path class="area" d="${rx.area}"/><path class="line" d="${rx.line}"/><path class="line" d="${tx.line}" opacity=".42"/></svg></div>
    </div>
    <div class="summary-card summary-traffic-card" data-summary-card="traffic">
      <div class="summary-head"><span class="summary-icon">${icon('traffic')}</span><span>流量</span></div>
      <div class="traffic-summary">
        <div class="traffic-summary-row"><span class="traffic-summary-label">今日</span><span>${icon('arrowDown')}<strong>${bytes(a.dayRx)}</strong></span><span>${icon('arrowUp')}<strong>${bytes(a.dayTx)}</strong></span></div>
        <div class="traffic-summary-row total"><span class="traffic-summary-label">累计</span><span>${icon('arrowDown')}<strong>${bytes(a.totalRx)}</strong></span><span>${icon('arrowUp')}<strong>${bytes(a.totalTx)}</strong></span></div>
      </div>
    </div>
    <div class="summary-card finance-summary" data-summary-card="finance">
      <div class="summary-head"><span class="summary-icon">${icon('coins')}</span><span>剩余价值</span></div>
      <div class="summary-main">${formatCNY(remaining.value)}</div>
      <div class="summary-sub">${remaining.count} 个计费节点 · ${exchangeSourceLabel()}</div>
    </div>
  </section>`;
}

function headerHtml() {
  const chosenTheme = document.documentElement.dataset.theme;
  const themeIcon = chosenTheme === 'dark' ? 'sun' : 'moon';
  const siteName = escapeHtml(state.me?.site_name || 'Monitor');
  const adminLabel = state.me?.authed ? '进入后台' : '登录';
  return `<header class="topbar"><div class="topbar-inner">
    <a class="brand" href="/" data-home><span class="brand-name">${siteName}</span><span class="brand-tagline">Simple server monitoring for a quieter internet.</span></a>
    <div class="top-actions">
      <a class="action-btn admin-link" href="/admin/">${icon('wrench')}<span>${adminLabel}</span></a>
      <button class="action-btn icon-btn" id="themeToggle" aria-label="切换主题">${icon(themeIcon)}</button>
    </div>
  </div></header>`;
}

function renderList() {
  const a = aggregate();
  const regions = [...new Set(a.nodes.map(region).filter(Boolean))].sort();
  if (state.filter !== 'ALL' && !regions.includes(state.filter)) state.filter = 'ALL';
  const shown = filteredNodes();
  const allHealthy = a.online === a.nodes.length;
  return `${summaryCards(a)}
    <div class="toolbar">
      <div class="filters"><button class="filter-btn ${state.filter==='ALL'?'active':''}" data-region="ALL">全部</button>${regions.map(r => `<button class="filter-btn ${state.filter===r?'active':''}" data-region="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('')}</div>
      <div class="toolbar-right"><span>共 ${shown.length} 个节点</span><div class="view-switch"><button class="view-btn ${state.view==='grid'?'active':''}" data-view="grid" title="卡片视图">${icon('grid')}</button><button class="view-btn ${state.view==='list'?'active':''}" data-view="list" title="列表视图">${icon('list')}</button></div></div>
    </div>
    ${shown.length ? ((state.view === 'list' && matchMedia('(min-width: 901px)').matches) ? nodeListTable(shown) : `<section class="nodes-grid">${shown.map(nodeCard).join('')}</section>`) : '<div class="empty">这个区域没有节点</div>'}
    <footer class="footer"><div>${escapeHtml(state.me?.site_name || 'Monitor')} · Keep your servers running quietly.</div><div class="footer-status"><span>最后更新：${state.lastUpdate ? state.lastUpdate.toLocaleString('zh-CN', {hour12:false}) : '—'}</span><span style="display:flex;align-items:center;gap:6px"><i class="footer-dot ${allHealthy?'':'bad'}"></i>${allHealthy?'系统正常':'存在异常节点'}</span></div></footer>`;
}

function statusHtml(node) {
  const m = node.metrics || {};
  const status = node.online ? `在线 ${duration(m.uptime)}` : `离线`;
  return `<span class="status-pill ${node.online ? '' : 'status-offline'}"><span class="status-dot"></span>${escapeHtml(status)}</span>`;
}
function fact(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<div class="detail-fact"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}
function detailPrice(node) {
  const pieces = [];
  const p = money(node);
  if (p) pieces.push(p);
  const e = expiry(node);
  if (e) pieces.push(e.text);
  const remain = remainingValueCNY(node);
  if (remain > 0) pieces.push(`剩余 ${formatCNY(remain)}`);
  return pieces.join(' · ') || '免费 / 未设置';
}
function cpuName(name='') {
  return String(name).replace(/\s+CPU\s+@.*$/i, '').replace(/\s+Processor$/i, '').trim();
}

function niceCpuTop(max) {
  if (max <= 4) return 4;
  return Math.min(100, Math.ceil(max / 10) * 10);
}
function chartSegments(rows, getter, minTs, maxTs, minY, maxY, w=1000, h=160) {
  const segs = [];
  let cur = [];
  const yRange = Math.max(1e-9, maxY - minY);
  for (const row of rows) {
    const raw = getter(row);
    const v = raw === null || raw === undefined ? NaN : Number(raw);
    if (!Number.isFinite(v)) {
      if (cur.length) segs.push(cur), cur = [];
      continue;
    }
    const x = maxTs === minTs ? 0 : ((Number(row.ts) - minTs) / (maxTs - minTs)) * w;
    const y = h - 4 - ((v - minY) / yRange) * (h - 8);
    cur.push([x, Math.max(4, Math.min(h - 4, y))]);
  }
  if (cur.length) segs.push(cur);
  return segs;
}
function pathFromPoints(points) {
  return points.map((p,i) => `${i ? 'L':'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
}
function nearestSeriesValue(rows, getter, targetTs) {
  let best = null, bestDist = Infinity;
  for (const row of rows) {
    const raw = getter(row);
    const value = raw === null || raw === undefined ? NaN : Number(raw);
    if (!Number.isFinite(value)) continue;
    const dist = Math.abs(Number(row.ts) - targetTs);
    if (dist < bestDist) { bestDist = dist; best = { row, value }; }
  }
  return best;
}
function historyChart(rows, series, opts={}) {
  if (!rows?.length) return '<div class="chart-empty">这段时间没有历史数据</div>';
  const normalized = rows.map(r => ({...r, ts:Number(r.ts || 0) * (Number(r.ts || 0) < 1e12 ? 1000 : 1)})).filter(r=>Number.isFinite(r.ts)).sort((a,b)=>a.ts-b.ts);
  if (!normalized.length) return '<div class="chart-empty">这段时间没有历史数据</div>';
  const minTs = normalized[0].ts, maxTs = normalized[normalized.length-1].ts;
  let dataMin = Infinity, dataMax = -Infinity;
  for (const s of series) for (const r of normalized) {
    const raw = s.get(r);
    const v = raw === null || raw === undefined ? NaN : Number(raw);
    if (Number.isFinite(v)) { dataMin = Math.min(dataMin, v); dataMax = Math.max(dataMax, v); }
  }
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return '<div class="chart-empty">这段时间没有历史数据</div>';
  let minY = opts.minY !== undefined ? Number(opts.minY) : 0;
  let maxY = opts.maxY !== undefined ? Number(opts.maxY) : dataMax;
  if (opts.autoDomain) {
    const span = Math.max(opts.minSpan || 1, dataMax - dataMin);
    const pad = span * .18;
    minY = Math.max(0, dataMin - pad);
    maxY = dataMax + pad;
  } else if (opts.cpuDomain) {
    minY = 0; maxY = niceCpuTop(dataMax);
  } else if (opts.maxY === undefined) {
    minY = Number(opts.minY || 0);
    maxY = Math.max(Number(opts.floor || 1), dataMax * (opts.pad === false ? 1 : 1.08));
  }
  if (!(maxY > minY)) { maxY = minY + Math.max(1, Math.abs(minY) * .1); }
  const lines = series.map((s, idx) => chartSegments(normalized, s.get, minTs, maxTs, minY, maxY).map(points =>
    `<path class="history-line history-line-${idx}" d="${pathFromPoints(points)}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`
  ).join('')).join('');
  const id = `quiet-chart-${++state.chartSeq}`;
  state.chartRegistry.set(id, { rows: normalized, series, minTs, maxTs, minY, maxY, opts });
  const fmtY = opts.yLabel || (v => formatNumber(v,1));
  const midTs = minTs + (maxTs - minTs) / 2;
  return `<div class="history-chart" data-chart-id="${id}">
    <div class="chart-stage">
      <svg viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden="true">
        <path class="chart-grid" d="M0 0H1000M0 40H1000M0 80H1000M0 120H1000M0 160H1000"/>
        ${lines}
        <line class="chart-hover-line" x1="0" x2="0" y1="0" y2="160"/>
        <rect class="chart-hitbox" x="0" y="0" width="1000" height="160"/>
      </svg>
      <div class="chart-y-axis"><span>${escapeHtml(fmtY(maxY))}</span><span>${escapeHtml(fmtY((minY+maxY)/2))}</span><span>${escapeHtml(fmtY(minY))}</span></div>
      <div class="chart-tooltip" role="status"></div>
    </div>
    <div class="chart-time-axis"><span>${new Date(minTs).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</span><span>${new Date(midTs).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</span><span>${new Date(maxTs).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</span></div>
  </div>`;
}
function renderResourceHistory(node, data) {
  const rows = data?.metrics || [];
  const memTotal = Number(node.mem_total || node.metrics?.mem_total || 0);
  return `<div class="detail-charts">
    <section class="chart-panel"><div class="chart-title"><span>CPU</span><span>${rows.length ? `${rows.length} 个采样点` : ''}</span></div>${historyChart(rows,[{label:'CPU',get:r=>Number(r.cpu||0),format:v=>`${Number(v).toFixed(1)}%`}],{cpuDomain:true,yLabel:v=>`${formatNumber(v,0)}%`})}</section>
    <section class="chart-panel"><div class="chart-title"><span>内存</span><span>${bytes(memTotal)}</span></div>${historyChart(rows,[{label:'内存',get:r=>Number(r.mem_used||0),format:v=>bytes(v)}],{minY:0,maxY:memTotal,pad:false,yLabel:v=>bytes(v)})}</section>
    <section class="chart-panel"><div class="chart-title"><span>网络速率</span><span>下行 / 上行</span></div>${historyChart(rows,[{label:'下行',get:r=>Number(r.net_rx||0),format:v=>rate(v)},{label:'上行',get:r=>Number(r.net_tx||0),format:v=>rate(v),dash:'8 5'}],{floor:1024,yLabel:v=>rate(v)})}</section>
  </div>`;
}
function renderLatencyHistory(data) {
  const ping = data?.ping || [];
  const probes = data?.probes || {};
  const loss = data?.loss || {};
  if (!ping.length) return '<div class="chart-empty detail-no-data">这段时间没有延迟数据</div>';
  const ids = [...new Set(ping.map(p=>Number(p.task_id)))].filter(Number.isFinite);
  const grouped = new Map();
  for (const p of ping) {
    const ts = Number(p.ts || 0);
    if (!Number.isFinite(ts)) continue;
    const row = grouped.get(ts) || { ts };
    row[`p${Number(p.task_id)}`] = p.latency == null ? null : Number(p.latency);
    row[`l${Number(p.task_id)}`] = Number(p.loss || 0);
    grouped.set(ts, row);
  }
  const rows = [...grouped.values()].sort((a,b)=>a.ts-b.ts);
  const series = ids.map((id, idx) => ({
    label: probes[id] || `探测 ${id}`,
    get: r => r[`p${id}`] == null ? null : Number(r[`p${id}`]),
    format: (v, row) => `${formatNumber(v,1)} ms${Number(row?.[`l${id}`] || 0) > 0 ? ` · 丢 ${formatNumber(row[`l${id}`],1)}%` : ''}`,
    dash: idx ? `${2+idx*2} 4` : '',
  }));
  const legend = ids.map((id,idx)=>`<span class="probe-chip"><i class="probe-line p${idx}"></i>${escapeHtml(probes[id] || `探测 ${id}`)}${Number(loss[id]||0)>0?` · 丢 ${formatNumber(loss[id],2)}%`:''}</span>`).join('');
  return `<section class="chart-panel latency-panel"><div class="chart-title"><span>网络延迟</span><span>${ids.length} 个探测</span></div>${historyChart(rows,series,{autoDomain:true,minSpan:4,yLabel:v=>`${formatNumber(v,0)} ms`})}<div class="probe-legend">${legend}</div></section>`;
}

function detailTabs() {
  const t = state.detail.tab;
  const hours = state.detail.hours[t];
  const ranges = t === 'latency' ? [1,6,24] : [1,6,24,168];
  return `<div class="detail-controls"><div class="segmented"><button class="seg-btn ${t==='resources'?'active':''}" data-detail-tab="resources">资源</button><button class="seg-btn ${t==='latency'?'active':''}" data-detail-tab="latency">网络延迟</button></div><div class="segmented">${ranges.map(h=>`<button class="seg-btn ${hours===h?'active':''}" data-detail-hours="${h}">${h===168?'7 天':`${h} 小时`}</button>`).join('')}</div></div>`;
}

function detailTitleInner(node) {
  const m = node.metrics || {};
  const r = region(node);
  const os = shortOS(node.os);
  const status = node.online ? `在线 ${duration(m.uptime)}` : '离线';
  return `<h1>${escapeHtml(node.name)}</h1>${r?`<span class="region-pill">${escapeHtml(r)}</span>`:''}<span class="os-pill">${escapeHtml(os)}</span><span class="status-pill ${node.online ? '' : 'status-offline'}"><span class="status-dot"></span>${escapeHtml(status)}</span>`;
}
function detailFactsHtml(node) {
  const m = node.metrics || {};
  const os = shortOS(node.os);
  const system = [os, node.kernel].filter(Boolean).join(' · ');
  const cpu = node.cpu_name ? `${cpuName(node.cpu_name)} × ${node.cpu_cores || 0}` : `${node.cpu_cores || 0} 核`;
  const network = `↓ ${bytes(node.day_rx || 0)} · ↑ ${bytes(node.day_tx || 0)}`;
  const totalNetwork = `↓ ${bytes(node.total_rx || 0)} · ↑ ${bytes(node.total_tx || 0)}`;
  const address = [node.ipv4 || node.ip, node.ipv6].filter(Boolean).join(' · ');
  return `${fact('系统', system)}
    ${fact('CPU', cpu)}
    ${fact('内存 / 硬盘', `${bytes(node.mem_total || 0)} / ${bytes(node.disk_total || 0)}`)}
    ${fact('实时资源', m ? `CPU ${pct(m.cpu || 0)} · 内存 ${pct((m.mem_total||node.mem_total)?(m.mem_used||0)/(m.mem_total||node.mem_total)*100:0)}` : '—')}
    ${fact('今日流量', network)}
    ${fact('累计流量', totalNetwork)}
    ${fact('续费', detailPrice(node))}
    ${address ? fact('地址', address) : ''}
    ${m?.procs != null ? fact('连接 / 进程', `TCP ${m.tcp || 0} · UDP ${m.udp || 0} · ${m.procs || 0} 进程`) : ''}`;
}
function detailHistoryBody(node) {
  let historyBody = '<div class="chart-empty detail-no-data">正在读取历史数据…</div>';
  if (state.detail.error) historyBody = `<div class="chart-empty detail-no-data error">读取历史数据失败：${escapeHtml(state.detail.error)}</div>`;
  else if (!state.detail.loading && state.detail.data) historyBody = state.detail.tab === 'latency' ? renderLatencyHistory(state.detail.data) : renderResourceHistory(node, state.detail.data);
  return `${detailTabs()}${historyBody}`;
}
function renderDetail(node) {
  return `<section class="detail-page">
    <div class="detail-nav"><button class="back-btn" data-home>${icon('arrowLeft')}<span>返回节点</span></button></div>
    <div class="detail-title-line">${detailTitleInner(node)}</div>
    <dl class="detail-facts">${detailFactsHtml(node)}</dl>
    ${node.remark ? `<div class="detail-remark">${escapeHtml(node.remark).replace(/\n/g,'<br>')}</div>` : ''}
    <div class="detail-history">${detailHistoryBody(node)}</div>
  </section>`;
}

function activeSelection() {
  const sel = globalThis.getSelection?.();
  return !!(sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString());
}
function selectionIntersects(root) {
  const sel = globalThis.getSelection?.();
  if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return false;
  if (root.contains?.(sel.anchorNode) || root.contains?.(sel.focusNode)) return true;
  for (let i = 0; i < sel.rangeCount; i++) {
    try { if (sel.getRangeAt(i).intersectsNode(root)) return true; } catch {}
  }
  return false;
}
function selectionTouchesNode(node) {
  const sel = globalThis.getSelection?.();
  if (!node || !sel || sel.isCollapsed || !sel.rangeCount) return false;
  if (sel.anchorNode === node || sel.focusNode === node) return true;
  for (let i = 0; i < sel.rangeCount; i++) {
    try { if (sel.getRangeAt(i).intersectsNode(node)) return true; } catch {}
  }
  return false;
}
function parseElement(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html || '').trim();
  return t.content.firstElementChild;
}
function parseTableRow(html) {
  const table = document.createElement('table');
  table.innerHTML = `<tbody>${html}</tbody>`;
  return table.querySelector('tr');
}

// A tiny DOM morph rather than replacing innerHTML.  This is the same principle
// used by reactive frameworks: stable elements and Text nodes survive snapshots;
// only values that actually changed are written.  Browser selections therefore
// stay attached to the original nodes while unrelated live metrics continue to
// update around them.
function sameNodeKind(current, fresh) {
  if (!current || !fresh || current.nodeType !== fresh.nodeType) return false;
  if (current.nodeType === Node.ELEMENT_NODE) return current.tagName === fresh.tagName;
  return true;
}
function syncAttributes(current, fresh) {
  if (current.nodeType !== Node.ELEMENT_NODE || fresh.nodeType !== Node.ELEMENT_NODE) return;
  for (const attr of [...current.attributes]) {
    if (!fresh.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  }
  for (const attr of [...fresh.attributes]) {
    if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  }
}
function morphNode(current, fresh) {
  if (!sameNodeKind(current, fresh)) return false;

  if (current.nodeType === Node.TEXT_NODE || current.nodeType === Node.COMMENT_NODE) {
    if (current.nodeValue !== fresh.nodeValue) {
      if (selectionTouchesNode(current)) {
        // Protect only the Text node the user is selecting.  Everything else in
        // the card keeps receiving the current WebSocket frame.
        state.pendingLivePatch = true;
      } else {
        current.nodeValue = fresh.nodeValue;
      }
    }
    return true;
  }

  syncAttributes(current, fresh);
  const wanted = [...fresh.childNodes];
  let i = 0;
  while (i < wanted.length) {
    const next = wanted[i];
    const have = current.childNodes[i];
    if (!have) {
      current.appendChild(next.cloneNode(true));
      i++;
      continue;
    }
    if (sameNodeKind(have, next)) {
      if (!morphNode(have, next)) return false;
      i++;
      continue;
    }

    // A rare structural change (for example a quota/billing element being added)
    // is still confined to the smallest differing child.  If that child is part
    // of the active selection, postpone just this structural change until the
    // selection is released.
    if (selectionIntersects(have)) {
      state.pendingLivePatch = true;
      return true;
    }
    current.replaceChild(next.cloneNode(true), have);
    i++;
  }
  while (current.childNodes.length > wanted.length) {
    const extra = current.lastChild;
    if (selectionIntersects(extra)) {
      state.pendingLivePatch = true;
      break;
    }
    extra.remove();
  }
  return true;
}
function patchRoot(root, fresh) {
  if (!root || !fresh || !sameNodeKind(root, fresh)) return false;
  return morphNode(root, fresh);
}
function homeStructureMatches() {
  if (!state.payload || state.routeNodeId !== null) return false;
  const shown = filteredNodes();
  const listMode = state.view === 'list' && matchMedia('(min-width: 901px)').matches;
  const roots = [...document.querySelectorAll(listMode ? '.node-table tbody tr[data-node-id]' : '.node-card[data-node-id]')];
  if (roots.length !== shown.length) return false;
  const ids = roots.map(el => Number(el.dataset.nodeId));
  if (ids.some((id, i) => id !== Number(shown[i]?.id))) return false;
  const expectedRegions = [...new Set(sortedNodes().map(region).filter(Boolean))].sort();
  const actualRegions = [...document.querySelectorAll('[data-region]')].map(el => el.dataset.region).filter(r => r && r !== 'ALL').sort();
  return expectedRegions.length === actualRegions.length && expectedRegions.every((r,i) => r === actualRegions[i]);
}
function patchSummary() {
  const host = document.querySelector('.summary-grid');
  if (!host) return false;
  const freshHost = parseElement(summaryCards(aggregate()));
  if (!freshHost) return false;
  for (const fresh of freshHost.querySelectorAll('[data-summary-card]')) {
    const current = host.querySelector(`[data-summary-card="${fresh.dataset.summaryCard}"]`);
    if (!current || !patchRoot(current, fresh)) return false;
  }
  return true;
}
function patchGridCards() {
  for (const node of filteredNodes()) {
    const current = document.querySelector(`.node-card[data-node-id="${Number(node.id)}"]`);
    const fresh = parseElement(nodeCard(node));
    if (!current || !fresh || !patchRoot(current, fresh)) return false;
  }
  return true;
}
function patchListRows() {
  for (const node of filteredNodes()) {
    const current = document.querySelector(`.node-table tbody tr[data-node-id="${Number(node.id)}"]`);
    const fresh = parseTableRow(nodeListRow(node));
    if (!current || !fresh || !patchRoot(current, fresh)) return false;
  }
  return true;
}
function patchFooter() {
  const footer = document.querySelector('.footer');
  if (!footer) return false;
  const a = aggregate();
  const allHealthy = a.online === a.nodes.length;
  const fresh = parseElement(`<footer class="footer"><div>${escapeHtml(state.me?.site_name || 'Monitor')} · Keep your servers running quietly.</div><div class="footer-status"><span>最后更新：${state.lastUpdate ? state.lastUpdate.toLocaleString('zh-CN', {hour12:false}) : '—'}</span><span style="display:flex;align-items:center;gap:6px"><i class="footer-dot ${allHealthy?'':'bad'}"></i>${allHealthy?'系统正常':'存在异常节点'}</span></div></footer>`);
  return !!fresh && patchRoot(footer, fresh);
}
function patchDetailLive() {
  const page = document.querySelector('.detail-page');
  const node = sortedNodes().find(n => Number(n.id) === Number(state.routeNodeId));
  if (!page || !node) return false;
  const title = page.querySelector('.detail-title-line');
  const facts = page.querySelector('.detail-facts');
  if (title) {
    const freshTitle = parseElement(`<div class="detail-title-line">${detailTitleInner(node)}</div>`);
    if (!freshTitle || !patchRoot(title, freshTitle)) return false;
  }
  if (facts) {
    const freshFacts = parseElement(`<dl class="detail-facts">${detailFactsHtml(node)}</dl>`);
    if (!freshFacts || !patchRoot(facts, freshFacts)) return false;
  }
  document.title = `${node.name || ''} · ${state.me?.site_name || 'Monitor'}`;
  return true;
}
function deferOrRender() {
  if (activeSelection()) {
    state.pendingStructuralRender = true;
    return;
  }
  state.pendingStructuralRender = false;
  render();
}
function patchCurrentView() {
  if (!state.payload) return deferOrRender();
  if (state.routeNodeId !== null) {
    if (!patchDetailLive()) deferOrRender();
    state.statusChanged.clear();
    return;
  }
  if (!document.querySelector('.summary-grid') || !homeStructureMatches()) {
    deferOrRender();
    return;
  }
  if (!patchSummary()) {
    deferOrRender();
    return;
  }
  const listMode = state.view === 'list' && matchMedia('(min-width: 901px)').matches;
  const ok = listMode ? patchListRows() : patchGridCards();
  if (!ok) {
    deferOrRender();
    return;
  }
  patchFooter();
  state.statusChanged.clear();
}
function scheduleSelectionFlush() {
  clearTimeout(state.selectionTimer);
  state.selectionTimer = setTimeout(() => {
    if (activeSelection()) return;
    if (state.pendingStructuralRender) {
      state.pendingStructuralRender = false;
      state.pendingLivePatch = false;
      render();
      return;
    }
    if (state.pendingLivePatch) {
      state.pendingLivePatch = false;
      patchCurrentView();
    }
  }, 60);
}
document.addEventListener('selectionchange', scheduleSelectionFlush);
document.addEventListener('pointerup', scheduleSelectionFlush, true);
document.addEventListener('keyup', scheduleSelectionFlush, true);

function render() {
  state.chartRegistry = new Map();
  state.chartSeq = 0;
  const app = $('#app');
  const payload = state.payload;
  if (!payload) {
    app.innerHTML = `<div class="shell">${headerHtml()}<main class="page"><div class="loading">正在加载节点…</div></main></div>`;
    bindGlobal();
    return;
  }
  let body = '';
  if (state.routeNodeId !== null) {
    const node = sortedNodes().find(n => Number(n.id) === Number(state.routeNodeId));
    body = node ? renderDetail(node) : `<div class="empty">节点不存在或未公开。<button class="inline-link" data-home>返回列表</button></div>`;
  } else {
    body = renderList();
  }
  app.innerHTML = `<div class="shell">${headerHtml()}<main class="page">${body}</main></div><div class="toast" id="toast"></div>`;
  document.title = state.routeNodeId !== null
    ? `${sortedNodes().find(n=>Number(n.id)===Number(state.routeNodeId))?.name || ''} · ${state.me?.site_name || 'Monitor'}`
    : (state.me?.site_name || 'Monitor');
  bindGlobal();
  bindHistoryCharts();
  state.statusChanged.clear();
  if (state.routeNodeId !== null) ensureDetailData();
}

function bindHistoryCharts() {
  document.querySelectorAll('.history-chart[data-chart-id]').forEach(chart => {
    const model = state.chartRegistry.get(chart.dataset.chartId);
    const svg = chart.querySelector('svg');
    const hit = chart.querySelector('.chart-hitbox');
    const line = chart.querySelector('.chart-hover-line');
    const tooltip = chart.querySelector('.chart-tooltip');
    if (!model || !svg || !hit || !line || !tooltip) return;
    const hide = () => { line.style.opacity = '0'; tooltip.classList.remove('show'); };
    const move = (ev) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const local = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
      const targetTs = model.minTs + local / rect.width * (model.maxTs - model.minTs);
      const x = model.maxTs === model.minTs ? 0 : (targetTs - model.minTs) / (model.maxTs - model.minTs) * 1000;
      line.setAttribute('x1', x.toFixed(2)); line.setAttribute('x2', x.toFixed(2)); line.style.opacity = '1';
      const values = [];
      let displayTs = targetTs;
      for (const s of model.series) {
        const near = nearestSeriesValue(model.rows, s.get, targetTs);
        if (!near) continue;
        displayTs = near.row.ts;
        const text = s.format ? s.format(near.value, near.row) : formatNumber(near.value, 2);
        values.push(`<div class="chart-tooltip-row"><span>${escapeHtml(s.label || '值')}</span><strong>${escapeHtml(text)}</strong></div>`);
      }
      if (!values.length) return hide();
      tooltip.innerHTML = `<time>${escapeHtml(new Date(displayTs).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</time>${values.join('')}`;
      tooltip.classList.add('show');
      const tooltipWidth = 190;
      const px = local;
      tooltip.style.left = `${Math.max(8, Math.min(rect.width - tooltipWidth - 8, px + 12))}px`;
      tooltip.style.top = '8px';
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerenter', move);
    hit.addEventListener('pointerleave', hide);
  });
}

function bindGlobal() {
  document.querySelectorAll('[data-home]').forEach(el => el.addEventListener('click', (e) => {
    e.preventDefault();
    goHome();
  }));
  document.querySelectorAll('[data-region]').forEach(btn => btn.addEventListener('click', () => { state.filter = btn.dataset.region; render(); }));
  document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => { state.view = btn.dataset.view; localStorage.setItem('quiet-noc-view', state.view); render(); }));
  document.querySelectorAll('[data-node-id]').forEach(card => {
    const open = () => goNode(Number(card.dataset.nodeId));
    card.addEventListener('click', (e) => {
      if (selectionIntersects(card) && globalThis.getSelection?.()?.toString().trim()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      open();
    });
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
  document.querySelectorAll('[data-detail-tab]').forEach(btn => btn.addEventListener('click', () => {
    state.detail.tab = btn.dataset.detailTab;
    state.detail.key = ''; state.detail.data = null; state.detail.error = '';
    render();
  }));
  document.querySelectorAll('[data-detail-hours]').forEach(btn => btn.addEventListener('click', () => {
    state.detail.hours[state.detail.tab] = Number(btn.dataset.detailHours);
    state.detail.key = ''; state.detail.data = null; state.detail.error = '';
    render();
  }));
  $('#themeToggle')?.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme;
    state.theme = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('quiet-noc-theme', state.theme);
    applyTheme(); render();
  });
}

function readNodeRoute() {
  const m = location.pathname.match(/^\/node\/(\d+)/);
  return m ? Number(m[1]) : null;
}
function goNode(id) {
  history.pushState({}, '', `/node/${id}`);
  state.routeNodeId = id;
  state.detail.key = ''; state.detail.data = null; state.detail.error = '';
  scrollTo(0, 0);
  render();
}
function goHome() {
  if (location.pathname !== '/') history.pushState({}, '', '/');
  state.routeNodeId = null;
  state.detail.key = ''; state.detail.data = null; state.detail.error = '';
  scrollTo(0, 0);
  render();
}
addEventListener('popstate', () => {
  state.routeNodeId = readNodeRoute();
  state.detail.key = ''; state.detail.data = null; state.detail.error = '';
  render();
});

async function ensureDetailData() {
  if (state.routeNodeId === null) return;
  const tab = state.detail.tab;
  const hours = state.detail.hours[tab];
  const key = `${state.routeNodeId}:${tab}:${hours}`;
  if (state.detail.key === key && (state.detail.loading || state.detail.data)) return;
  state.detail.key = key;
  state.detail.loading = true;
  state.detail.error = '';
  const series = tab === 'latency' ? 'ping' : 'metrics';
  const points = Math.max(240, Math.round(innerWidth * (devicePixelRatio || 1)));
  try {
    const res = await fetch(`/api/nodes/${state.routeNodeId}/metrics?hours=${hours}&points=${points}&series=${series}`, { credentials:'same-origin', cache:'no-store' });
    if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
    const data = await res.json();
    if (state.detail.key !== key) return;
    state.detail.data = data;
  } catch (e) {
    if (state.detail.key !== key) return;
    state.detail.error = e?.message || '网络错误';
  } finally {
    if (state.detail.key === key) {
      state.detail.loading = false;
      render();
    }
  }
}

function accept(raw) {
  const payload = normalizePayload(raw);
  const previous = new Map((state.payload?.nodes || []).map(n => [Number(n.id), Boolean(n.online)]));
  state.statusChanged.clear();
  for (const n of payload.nodes || []) {
    const old = previous.get(Number(n.id));
    if (old !== undefined && old !== Boolean(n.online)) state.statusChanged.add(Number(n.id));
  }
  state.payload = payload;
  pushNodeSeries(payload.nodes || []);
  const a = aggregate();
  pushSeries(a.liveRx, a.liveTx);
  state.lastUpdate = new Date();
  state.connected = true;
  patchCurrentView();
}

async function fetchNodes() {
  const res = await fetch('/api/nodes', { headers: { 'Accept': 'application/json' }, cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  accept(await res.json());
}
async function fetchMe() {
  try {
    const res = await fetch('/api/me', { cache:'no-store', credentials:'same-origin' });
    if (res.ok) state.me = await res.json();
  } catch {}
}

function connectWs() {
  clearTimeout(state.reconnectTimer);
  try { state.socket?.close(); } catch {}
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${scheme}//${location.host}/api/ws`);
  state.socket = ws;
  ws.onopen = () => { state.connected = true; };
  ws.onmessage = ev => {
    try { accept(JSON.parse(ev.data)); } catch (e) { console.warn('Invalid live snapshot', e); }
  };
  ws.onclose = () => {
    state.connected = false;
    state.reconnectTimer = setTimeout(connectWs, 5000);
  };
  ws.onerror = () => ws.close();
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function sanitizeRates(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = { CNY: 1 };
  for (const cur of SUPPORTED_CURRENCIES) {
    if (cur === 'CNY') continue;
    const v = Number(raw[cur]);
    if (!Number.isFinite(v) || v <= 0) return null;
    out[cur] = v;
  }
  return out;
}
async function fetchWithTimeout(url, timeout=5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try { return await fetch(url, { signal: ctrl.signal, cache:'no-store' }); }
  finally { clearTimeout(timer); }
}
async function loadExchangeRates() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(EXCHANGE_CACHE_KEY) || 'null'); } catch {}
  if (cached?.base === 'CNY' && cached?.date === todayKey()) {
    const rates = sanitizeRates(cached.rates);
    if (rates) {
      state.exchangeRates = rates; state.exchangeSource = 'cache'; state.exchangeUpdatedAt = cached.fetchedAt || null;
      patchCurrentView(); return;
    }
  }
  for (const [url, parser] of EXCHANGE_APIS) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      const rates = sanitizeRates(parser(await res.json()));
      if (!rates) continue;
      state.exchangeRates = rates; state.exchangeSource = 'network'; state.exchangeUpdatedAt = Date.now();
      localStorage.setItem(EXCHANGE_CACHE_KEY, JSON.stringify({base:'CNY',date:todayKey(),fetchedAt:state.exchangeUpdatedAt,rates}));
      patchCurrentView(); return;
    } catch (e) { console.warn('获取汇率失败:', url, e); }
  }
  if (cached?.rates) {
    const rates = sanitizeRates(cached.rates);
    if (rates) { state.exchangeRates = rates; state.exchangeSource = 'stale-cache'; state.exchangeUpdatedAt = cached.fetchedAt || null; patchCurrentView(); }
  }
}

(async function boot() {
  render();
  await fetchMe();
  render();
  try { await fetchNodes(); } catch (e) {
    console.error(e);
    const app = $('#app');
    if (app) app.innerHTML = `<div class="shell">${headerHtml()}<main class="page"><div class="empty">无法读取 /api/nodes：${escapeHtml(e.message)}</div></main></div>`;
    bindGlobal();
  }
  void loadExchangeRates();
  connectWs();
  setInterval(() => { if (!state.connected) fetchNodes().catch(()=>{}); }, 5000);
})();
