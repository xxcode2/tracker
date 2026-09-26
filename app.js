/* =========================================================
   PAKEIN TRACKER — Vanilla JS app (LocalStorage, no backend)
   ========================================================= */
'use strict';

/* ---------------- Currency helpers ----------------
   User mengetik dalam SATUAN RIBU RUPIAH.
   40  -> 40000  (Rp40.000)
   75  -> 75000  (Rp75.000)
   125 -> 125000 (Rp125.000)
   Internal disimpan sebagai rupiah penuh. */
const nf = new Intl.NumberFormat('id-ID');
function toRp(ribu) {
  const n = parseFloat(ribu);
  if (isNaN(n)) return 0;
  return Math.round(n * 1000);
}
function fmtRp(v) { return 'Rp' + nf.format(Math.round(v || 0)); }
function fmtK(v) { // rupiah penuh -> string ribu untuk input value
  return (Math.round(v || 0) / 1000).toString();
}

/* ---------------- Generic helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function todayStr() { const d = new Date(); return isoDate(d); }
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function initials(name) { const p = String(name || '?').trim().split(/\s+/); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'; }
function avatarColor(name) {
  const grads = ['linear-gradient(135deg,#a855f7,#ec4899)', 'linear-gradient(135deg,#3b82f6,#22d3ee)', 'linear-gradient(135deg,#f59e0b,#ef4444)', 'linear-gradient(135deg,#22c55e,#14b8a6)', 'linear-gradient(135deg,#ec4899,#f97316)', 'linear-gradient(135deg,#8b5cf6,#6366f1)'];
  let h = 0; for (let i = 0; i < String(name).length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return grads[h % grads.length];
}
function relTime(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'baru saja';
  if (s < 3600) return Math.floor(s / 60) + ' menit lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  if (s < 604800) return Math.floor(s / 86400) + ' hari lalu';
  return new Date(ts).toLocaleDateString('id-ID');
}
function fmtDate(dstr) {
  if (!dstr) return '—';
  const d = new Date(dstr + 'T00:00:00');
  if (isNaN(d)) return dstr;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ---------------- Payment methods ---------------- */
const METHODS = {
  QRIS: { icon: 'fa-qrcode', color: '#22c55e' },
  DANA: { icon: 'fa-wallet', color: '#3b82f6' },
  ShopeePay: { icon: 'fa-shield-halved', color: '#ee4d2d' },
  Cash: { icon: 'fa-money-bill-1-wave', color: '#14b8a6' },
  'Transfer Bank': { icon: 'fa-building-columns', color: '#a855f7' },
};
const METHOD_NAMES = Object.keys(METHODS);

/* ---------------- Store ---------------- */
const KEY_TX = 'pakein.transactions';
const KEY_SET = 'pakein.settings';
const KEY_THEME = 'pakein.theme';
const KEY_META = 'pakein.meta';
const API_URL = '/api/data';
const CLOUD_POLL_MS = 45000;

let TRANSACTIONS = [];
let SETTINGS = { defaultMethod: 'QRIS', onboarded: false };
// Cloud sync state
let CLOUD = { available: false, updatedAt: 0, timer: null, poll: null, state: 'offline' };

function loadState() {
  try { TRANSACTIONS = JSON.parse(localStorage.getItem(KEY_TX)) || []; } catch { TRANSACTIONS = []; }
  try { SETTINGS = Object.assign(SETTINGS, JSON.parse(localStorage.getItem(KEY_SET)) || {}); } catch {}
  try { CLOUD.updatedAt = (JSON.parse(localStorage.getItem(KEY_META) || '{}').updatedAt) || 0; } catch { CLOUD.updatedAt = 0; }
}
function saveTx() { localStorage.setItem(KEY_TX, JSON.stringify(TRANSACTIONS)); markLocalChange(); }
function saveSettings() { localStorage.setItem(KEY_SET, JSON.stringify(SETTINGS)); }

/* =========================================================
   CLOUD SYNC (JSONBin via Vercel serverless proxy at /api/data)
   Model: 1 Bin = { updatedAt, transactions[] }. Single user,
   pull-if-newer + push-on-change. LocalStorage tetap jadi cache.
   ========================================================= */
async function cloudGET() {
  try {
    const res = await fetch(API_URL, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null; // mis. belum di-deploy / file://
    const j = await res.json();
    if (j && j.notConfigured) return null;
    return j;
  } catch { return null; }
}
async function cloudPUT(payload) {
  try {
    const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return res.ok;
  } catch { return false; }
}
function writeLocalTx() { localStorage.setItem(KEY_TX, JSON.stringify(TRANSACTIONS)); }
function bumpTimestamp() { CLOUD.updatedAt = Date.now(); localStorage.setItem(KEY_META, JSON.stringify({ updatedAt: CLOUD.updatedAt })); }
function markLocalChange() {
  bumpTimestamp();
  if (CLOUD.available) scheduleCloudPush();
}
function scheduleCloudPush(delay = 900) {
  clearTimeout(CLOUD.timer);
  CLOUD.timer = setTimeout(pushCloud, delay);
}
async function pushCloud() {
  if (!CLOUD.available) return;
  setCloudState('syncing');
  const ok = await cloudPUT({ updatedAt: CLOUD.updatedAt, transactions: TRANSACTIONS });
  setCloudState(ok ? 'online' : 'error');
  if (ok && currentView === 'pengaturan') renderSettings();
}
async function pullCloud({ silent = true } = {}) {
  const g = await cloudGET();
  if (!g) { CLOUD.available = false; setCloudState('offline'); return false; }
  CLOUD.available = true;
  if ((g.updatedAt || 0) > CLOUD.updatedAt) {
    TRANSACTIONS = Array.isArray(g.transactions) ? g.transactions.map(normalizeTx) : [];
    CLOUD.updatedAt = g.updatedAt || 0;
    writeLocalTx(); localStorage.setItem(KEY_META, JSON.stringify({ updatedAt: CLOUD.updatedAt }));
    renderAll();
    setCloudState('online');
    if (!silent) toast('Data terbaru ditarik dari cloud ☁️', 'info');
  } else {
    setCloudState('online');
  }
  return true;
}
// manual "Sync Sekarang": tarik dulu (kalau remote lebih baru), lalu dorong lokal ke remote
async function cloudSyncNow() {
  setCloudState('syncing');
  await pullCloud({ silent: true });
  if (!CLOUD.available) { toast('Cloud belum tersedia / offline', 'warn'); setCloudState('offline'); return; }
  await pushCloud();
  toast('Sinkronisasi selesai ✓', 'success');
}
function startPolling() {
  if (CLOUD.poll) clearInterval(CLOUD.poll);
  CLOUD.poll = setInterval(() => { if (!document.hidden && CLOUD.available) pullCloud({ silent: true }); }, CLOUD_POLL_MS);
}
async function initCloud() {
  const g = await cloudGET();
  if (!g) { CLOUD.available = false; setCloudState('offline'); return; }
  CLOUD.available = true;
  if ((g.updatedAt || 0) > CLOUD.updatedAt) {
    TRANSACTIONS = Array.isArray(g.transactions) ? g.transactions.map(normalizeTx) : [];
    CLOUD.updatedAt = g.updatedAt || 0;
    writeLocalTx(); localStorage.setItem(KEY_META, JSON.stringify({ updatedAt: CLOUD.updatedAt }));
    renderAll();
  } else if (Array.isArray(g.transactions) && g.transactions.length === 0 && TRANSACTIONS.length > 0) {
    // cloud masih kosong tapi lokal sudah ada data -> seed naik
    await pushCloud();
  }
  setCloudState('online');
  startPolling();
}
function setCloudState(state) {
  CLOUD.state = state;
  updateCloudUI();
}
function updateCloudUI() {
  const chip = $('#cloudChip');
  const stateMap = {
    online: { t: CLOUD.updatedAt ? 'Synced' : 'Online', n: 'Tersambung ke cloud.', cls: 'state-online' },
    offline: { t: 'Offline', n: 'Data disimpan lokal di perangkat ini.', cls: 'state-offline' },
    syncing: { t: 'Syncing…', n: 'Menyinkronkan data…', cls: 'state-syncing' },
    error: { t: 'Error', n: 'Gagal terhubung ke cloud.', cls: 'state-error' },
  };
  const s = stateMap[CLOUD.state] || stateMap.offline;
  if (chip) {
    chip.className = 'cloud-chip ' + s.cls;
    const lbl = chip.querySelector('span'); if (lbl) lbl.textContent = s.t;
    const ico = chip.querySelector('i'); if (ico) ico.className = 'fa-solid ' + (CLOUD.state === 'syncing' ? 'fa-arrows-rotate' : CLOUD.state === 'error' ? 'fa-triangle-exclamation' : 'fa-cloud');
  }
  const st = $('#cloudState'), note = $('#cloudNote');
  if (st) st.textContent = s.t;
  if (note) note.textContent = CLOUD.state === 'online' && CLOUD.updatedAt ? ('Sinkron terakhir: ' + new Date(CLOUD.updatedAt).toLocaleString('id-ID')) : s.n;
}

/* ---------------- Derived calculations ---------------- */
// item.price stored in full rupiah; item.status: keep|batal (final dihapus; barang sudah CO bukan keep lagi)
function txTotal(t) { return (t.items || []).filter(i => i.status !== 'batal').reduce((s, i) => s + (i.price || 0), 0); }
function txQty(t) { return (t.items || []).filter(i => i.status !== 'batal').length; }
function txPaidByKind(t, kind) { return (t.payments || []).filter(p => p.kind === kind).reduce((s, p) => s + (p.amount || 0), 0); }
function txDp(t) { return txPaidByKind(t, 'dp'); }
function txLunas(t) { return txPaidByKind(t, 'pelunasan'); }
function txPaidTotal(t) { return txDp(t) + txLunas(t); }
function txRemaining(t) { return Math.max(0, txTotal(t) - txPaidTotal(t)); }
function txPaidStatus(t) {
  const total = txTotal(t), paid = txPaidTotal(t);
  if (total > 0 && paid >= total) return 'LUNAS';
  if (paid > 0) return 'DP SEBAGIAN';
  return 'BELUM DP';
}
function keepCountOf(t, status) { return (t.items || []).filter(i => i.status === status).length; }
function getTx(id) { return TRANSACTIONS.find(t => t.id === id); }

/* =========================================================
   TOAST
   ========================================================= */
function toast(msg, type = 'success') {
  const icons = { success: 'fa-check', error: 'fa-triangle-exclamation', info: 'fa-info', warn: 'fa-bell' };
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<div class="t-ico"><i class="fa-solid ${icons[type] || 'fa-check'}"></i></div><span>${esc(msg)}</span>`;
  $('#toastWrap').appendChild(el);
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 350); }, 3000);
}

/* =========================================================
   MODAL helpers
   ========================================================= */
function openModal(id) { const m = $(id); m.hidden = false; document.body.style.overflow = 'hidden'; }
function closeModal(m) { while (typeof m === 'string') m = $(m); m.hidden = true; if (!$$('.modal:not([hidden])').length) document.body.style.overflow = ''; }
document.addEventListener('click', e => {
  const closer = e.target.closest('[data-close]');
  if (closer) closeModal(closer.closest('.modal'));
  if (e.target.classList.contains('modal')) closeModal(e.target);
});

/* =========================================================
   THEME
   ========================================================= */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(KEY_THEME, theme);
  const label = theme === 'dark' ? 'Dark' : 'Light';
  const icon = theme === 'dark' ? 'fa-moon' : 'fa-sun';
  [$('#themeToggleSidebar'), $('#themeToggleTop')].forEach(b => {
    if (!b) return;
    b.innerHTML = `<i class="fa-solid ${icon}"></i>` + (b.id === 'themeToggleSidebar' ? `<span>${label}</span>` : '');
  });
  renderCharts();
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(cur);
}

/* =========================================================
   CLOCK
   ========================================================= */
function tickClock() {
  const d = new Date();
  $('#headerClock').textContent = d.toLocaleTimeString('id-ID', { hour12: false });
  $('#headerDate').textContent = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/* =========================================================
   ROUTER
   ========================================================= */
const VIEW_TITLES = { dashboard: 'Tracker Penjualan Pakein', transaksi: 'Transaksi', dp: 'DP Customer', keep: 'Barang Keep', pelunasan: 'Pelunasan', checkout: 'Checkout Shopee', analytics: 'Analytics', customer: 'Data Customer', live: 'Live Selling Mode', pengaturan: 'Pengaturan' };
let currentView = 'dashboard';
function go(view) {
  currentView = view;
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  $('#topbarHeading').textContent = VIEW_TITLES[view] || 'PAKEIN TRACKER';
  closeSidebar();
  renderView(view);
  $('#content').scrollIntoView({ block: 'start' });
}
function renderView(view) {
  if (view === 'dashboard') renderDashboard();
  else if (view === 'transaksi') renderTransactions();
  else if (view === 'dp') renderDP();
  else if (view === 'keep') renderKeep();
  else if (view === 'pelunasan') renderPelunasan();
  else if (view === 'checkout') renderCheckout();
  else if (view === 'analytics') renderAnalytics();
  else if (view === 'customer') renderCustomers();
  else if (view === 'live') renderLive();
  else if (view === 'pengaturan') renderSettings();
}
function renderAll() { renderView(currentView); }

/* ---- Sidebar drawer (mobile) ---- */
function openSidebar() { $('#sidebar').classList.add('open'); document.body.classList.add('nav-open'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); document.body.classList.remove('nav-open'); }

/* =========================================================
   COUNTER ANIMATION
   ========================================================= */
function animateCount(el, target, { money = false, suffix = '' } = {}) {
  const dur = 900, start = performance.now();
  function frame(now) {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = target * eased;
    el.textContent = money ? fmtRp(val) : (Math.round(val).toLocaleString('id-ID') + suffix);
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* =========================================================
   DASHBOARD
   ========================================================= */
function dashboardStats() {
  const txs = TRANSACTIONS, today = todayStr();
  const totalTx = txs.length;
  const totalPcs = txs.reduce((s, t) => s + txQty(t), 0);
  const totalValue = txs.reduce((s, t) => s + txTotal(t), 0);
  const activeTxs = txs.filter(t => !t.hangus);
  const totalDp = activeTxs.reduce((s, t) => s + txDp(t), 0);
  const totalLunas = activeTxs.reduce((s, t) => s + txLunas(t), 0);
  const outstanding = txs.reduce((s, t) => s + txRemaining(t), 0);
  const coDone = txs.filter(t => t.checkoutStatus).length;
  const coPending = totalTx - coDone;
  const todayTx = txs.filter(t => t.date === today);
  const notCo = txs.filter(t => !t.checkoutStatus);
  const keepItems = notCo.reduce((s, t) => s + keepCountOf(t, 'keep'), 0);
  const batalItems = txs.reduce((s, t) => s + keepCountOf(t, 'batal'), 0);
  const hangusList = txs.filter(t => t.hangus);
  const hangusCount = hangusList.length;
  const hangusTotal = hangusList.reduce((s, t) => s + (t.hangusAmount || txPaidTotal(t)), 0);
  return { totalTx, totalPcs, totalValue, totalDp, totalLunas, outstanding, coDone, coPending, todayCount: todayTx.length, keepItems, batalItems, hangusCount, hangusTotal };
}

function renderDashboard() {
  const s = dashboardStats();
  const cards = [
    { label: 'Total Customer', value: s.totalTx, sub: `+${s.todayCount} hari ini`, icon: 'fa-users', bg: 'linear-gradient(135deg,#a855f7,#ec4899)', cls: 'trend-up' },
    { label: 'Total Baju', value: s.totalPcs, suffix: ' pcs', sub: `${s.keepItems} masih di-keep`, icon: 'fa-shirt', bg: 'linear-gradient(135deg,#3b82f6,#22d3ee)' },
    { label: 'Total Nilai Barang', value: s.totalValue, money: true, sub: `${s.batalItems} barang batal`, icon: 'fa-sack-dollar', bg: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
    { label: 'Total DP Masuk', value: s.totalDp, money: true, sub: 'Uang muka aktif (hangus dipisah)', icon: 'fa-hand-holding-dollar', bg: 'linear-gradient(135deg,#22c55e,#14b8a6)' },
    { label: 'Total Pelunasan', value: s.totalLunas, money: true, sub: 'Pembayaran akhir', icon: 'fa-circle-check', bg: 'linear-gradient(135deg,#14b8a6,#3b82f6)' },
    { label: 'Belum Lunas', value: s.outstanding, money: true, sub: 'Sisa pembayaran', icon: 'fa-clock', bg: 'linear-gradient(135deg,#ef4444,#f97316)', cls: 'trend-down' },
    { label: 'Sudah Checkout', value: s.coDone, suffix: ' trx', sub: `${s.coPending} belum CO`, icon: 'fa-bag-shopping', bg: 'linear-gradient(135deg,#8b5cf6,#d946ef)' },
    { label: 'Belum Checkout', value: s.coPending, suffix: ' trx', sub: 'Menunggu proses', icon: 'fa-box-open', bg: 'linear-gradient(135deg,#64748b,#334155)' },
  ];
  const grid = $('#statGrid');
  grid.innerHTML = cards.map((c, i) => `
    <div class="stat-card">
      <div class="stat-top">
        <div class="stat-ico" style="background:${c.bg}"><i class="fa-solid ${c.icon}"></i></div>
      </div>
      <div class="stat-label">${c.label}</div>
      <div class="stat-value" data-idx="${i}">0</div>
      <div class="stat-sub ${c.cls || ''}">${c.sub}</div>
    </div>`).join('');
  $$('.stat-value', grid).forEach((el, i) => {
    const c = cards[i];
    animateCount(el, c.value, { money: c.money, suffix: c.suffix || '' });
  });

  renderDailyReport();
  renderMethodList();
  renderRecent();
}

function renderDailyReport() {
  const today = todayStr();
  const t = TRANSACTIONS.filter(x => x.date === today);
  const rows = [
    { k: 'Customer', v: t.length },
    { k: 'Barang', v: t.reduce((s, x) => s + txQty(x), 0) + ' pcs' },
    { k: 'Total Transaksi', v: fmtRp(t.reduce((s, x) => s + txTotal(x), 0)) },
    { k: 'DP Masuk', v: fmtRp(t.reduce((s, x) => s + txDp(x), 0)) },
    { k: 'Pelunasan', v: fmtRp(t.reduce((s, x) => s + txLunas(x), 0)) },
    { k: 'Belum Lunas', v: fmtRp(t.reduce((s, x) => s + txRemaining(x), 0)) },
    { k: 'Sudah CO', v: t.filter(x => x.checkoutStatus).length },
    { k: 'Belum CO', v: t.filter(x => !x.checkoutStatus).length },
  ];
  $('#dailyReport').innerHTML = rows.map(r => `<div class="dr-item"><span>${r.k}</span><strong>${r.v}</strong></div>`).join('');
}

function paymentByMethod() {
  const map = {}; METHOD_NAMES.forEach(m => map[m] = 0);
  TRANSACTIONS.forEach(t => (t.payments || []).forEach(p => { if (map[p.method] != null) map[p.method] += p.amount; }));
  return map;
}
function renderMethodList() {
  const map = paymentByMethod();
  const max = Math.max(1, ...Object.values(map));
  $('#methodList').innerHTML = METHOD_NAMES.map(m => `
    <div class="method-row">
      <div class="method-ico" style="background:${METHODS[m].color}"><i class="fa-solid ${METHODS[m].icon}"></i></div>
      <div class="method-info">
        <div class="m-top"><span>${m}</span><strong>${fmtRp(map[m])}</strong></div>
        <div class="bar-track"><div class="bar-fill" data-w="${Math.round(map[m] / max * 100)}"></div></div>
      </div>
    </div>`).join('');
  requestAnimationFrame(() => $$('#methodList .bar-fill').forEach(b => b.style.width = b.dataset.w + '%'));
}

function statusBadge(t) {
  if (t.hangus) return '<span class="badge b-red">DP HANGUS</span>';
  const st = txPaidStatus(t);
  const map = { 'LUNAS': 'b-green', 'DP SEBAGIAN': 'b-yellow', 'BELUM DP': 'b-red' };
  const co = t.checkoutStatus ? '<span class="badge b-green">SUDAH CO</span>' : '';
  return `<span class="badge ${map[st]}">${st}</span>${co}`;
}
/* ---- Generic pagination (10 per page) ---- */
const PAGE_SIZE = 10;
const PAGE_STATE = {};
function slicePage(list, key) {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  let page = PAGE_STATE[key] || 1;
  if (page > pages) page = pages;
  if (page < 1) page = 1;
  PAGE_STATE[key] = page;
  const from = (page - 1) * PAGE_SIZE;
  return { items: list.slice(from, from + PAGE_SIZE), page, pages, total: list.length };
}
function pagerHTML(key, page, pages, total) {
  if (!total) return '';
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(total, page * PAGE_SIZE);
  const btn = (p, label, cls = '', dis = false) =>
    `<button class="pg-btn ${cls}" ${dis ? 'disabled' : `data-action="goto-page" data-page-key="${key}" data-page="${p}"`}>${label}</button>`;
  let nums = '';
  const win = 2, lo = Math.max(1, page - win), hi = Math.min(pages, page + win);
  if (lo > 1) nums += btn(1, '1') + (lo > 2 ? '<span class="pg-gap">…</span>' : '');
  for (let p = lo; p <= hi; p++) nums += btn(p, String(p), p === page ? 'active' : '');
  if (hi < pages) nums += (hi < pages - 1 ? '<span class="pg-gap">…</span>' : '') + btn(pages, String(pages));
  return `<div class="pager">
    <span class="pg-info">Tampil ${start}–${end} dari ${total}</span>
    <div class="pg-btns">${btn(page - 1, '<i class="fa-solid fa-chevron-left"></i>', '', page <= 1)}${nums}${btn(page + 1, '<i class="fa-solid fa-chevron-right"></i>', '', page >= pages)}</div>
  </div>`;
}
function resetPage(key) { PAGE_STATE[key] = 1; }

function renderRecent() {
  const list = [...TRANSACTIONS].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 10);
  if (!list.length) { $('#recentGrid').innerHTML = emptyState('Belum ada transaksi', 'Mulai catat hasil live kamu hari ini.', 'add-tx'); return; }
  $('#recentGrid').innerHTML = list.map(t => `
    <div class="recent-card">
      <div class="avatar" style="background:${avatarColor(t.customerName)}">${esc(initials(t.customerName))}</div>
      <div class="rc-body">
        <strong>${esc(t.customerName)}</strong>
        <span>${txQty(t)} pcs · ${fmtRp(txTotal(t))}</span>
        <div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">${statusBadge(t)}</div>
      </div>
      <div class="stat-sub">${relTime(t.createdAt)}</div>
    </div>`).join('');
}

function emptyState(title, desc, action) {
  return `<div class="empty" style="grid-column:1/-1">
    <div class="e-ico"><i class="fa-solid fa-inbox"></i></div>
    <h4>${esc(title)}</h4><p>${esc(desc)}</p>
    ${action ? `<button class="btn btn-primary" data-action="${action}"><i class="fa-solid fa-plus"></i> Tambah Transaksi</button>` : ''}
  </div>`;
}

/* =========================================================
   TRANSACTION TABLE + FILTERS
   ========================================================= */
function dateInRange(t, filter) {
  if (!filter || filter.mode === 'all') return true;
  const d = t.date;
  const today = new Date(todayStr() + 'T00:00:00');
  if (filter.mode === 'today') return d === todayStr();
  if (filter.mode === 'yesterday') { const y = new Date(today); y.setDate(y.getDate() - 1); return d === isoDate(y); }
  if (filter.mode === '7d' || filter.mode === '30d') {
    const days = filter.mode === '7d' ? 7 : 30;
    const from = new Date(today); from.setDate(from.getDate() - (days - 1));
    return d >= isoDate(from) && d <= todayStr();
  }
  if (filter.mode === 'custom') {
    if (filter.from && d < filter.from) return false;
    if (filter.to && d > filter.to) return false;
    return true;
  }
  return true;
}
function matchStatus(t, f) {
  const st = txPaidStatus(t);
  switch (f) {
    case 'belum-dp': return st === 'BELUM DP';
    case 'sudah-dp': return txPaidTotal(t) > 0;
    case 'belum-lunas': return st !== 'LUNAS';
    case 'lunas': return st === 'LUNAS';
    case 'keep': return keepCountOf(t, 'keep') > 0 && !t.checkoutStatus;
    case 'hangus': return !!t.hangus;
    case 'belum-co': return !t.checkoutStatus;
    case 'sudah-co': return !!t.checkoutStatus;
    default: return true;
  }
}
function filteredTx() {
  const q = ($('#txSearch').value || '').toLowerCase().trim();
  const sf = $('#txStatusFilter').value;
  const df = currentDateFilter();
  return TRANSACTIONS.filter(t => {
    if (q) {
      const hay = [t.customerName, t.tiktokUsername, t.shopeeUsername].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (!matchStatus(t, sf)) return false;
    if (!dateInRange(t, df)) return false;
    return true;
  }).sort((a, b) => (b.date + (b.createdAt || 0)).toString().localeCompare((a.date + (a.createdAt || 0)).toString()));
}
function currentDateFilter() {
  const mode = $('#txDateFilter').value;
  if (mode === 'custom') return { mode: 'custom', from: $('#txFrom').value, to: $('#txTo').value };
  return { mode };
}
function keepBadge(t) {
  if (t.checkoutStatus) return '<span class="badge b-green">SUDAH CO</span>';
  const parts = [];
  const k = keepCountOf(t, 'keep'), b = keepCountOf(t, 'batal');
  if (k) parts.push(`<span class="badge b-keep">${k} Keep</span>`);
  if (b) parts.push(`<span class="badge b-batal">${b} Batal</span>`);
  return parts.join(' ') || '<span class="badge b-muted">-</span>';
}
function renderTransactions() {
  const all = filteredTx();
  const body = $('#txBody'), mobile = $('#txMobileCards'), empty = $('#txEmpty');
  if (!all.length) {
    body.innerHTML = ''; mobile.innerHTML = '';
    empty.hidden = false; empty.innerHTML = emptyState(TRANSACTIONS.length ? 'Tidak ada hasil' : 'Belum ada transaksi', TRANSACTIONS.length ? 'Coba ubah pencarian / filter.' : 'Mulai catat hasil live kamu hari ini.', 'add-tx');
    return;
  }
  empty.hidden = true;
  const pg = slicePage(all, 'tx'); const list = pg.items;
  body.innerHTML = list.map(t => `
    <tr>
      <td>${fmtDate(t.date)}</td>
      <td><div class="cust-cell"><div class="avatar" style="background:${avatarColor(t.customerName)}">${esc(initials(t.customerName))}</div><div><strong>${esc(t.customerName)}</strong></div></div></td>
      <td>${txQty(t)} pcs</td>
      <td><strong>${fmtRp(txTotal(t))}</strong></td>
      <td>${fmtRp(txDp(t))}</td>
      <td class="${txRemaining(t) > 0 ? 'trend-down' : ''}">${fmtRp(txRemaining(t))}</td>
      <td>${statusBadge(t)}</td>
      <td>${keepBadge(t)}</td>
      <td>${t.checkoutStatus ? '<span class="badge b-green">SUDAH CO</span>' : '<span class="badge b-red">BELUM CO</span>'}</td>
      <td>${esc(t.shopeeUsername || '-')}</td>
      <td><div class="row-actions">
        <button class="mini-btn view" data-act="view" data-id="${t.id}" title="Detail"><i class="fa-solid fa-eye"></i></button>
        <button class="mini-btn edit" data-act="edit" data-id="${t.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="mini-btn co" data-act="co" data-id="${t.id}" title="Checkout"><i class="fa-solid fa-bag-shopping"></i></button>
        <button class="mini-btn del" data-act="del" data-id="${t.id}" title="Hapus"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`).join('') + `<tr class="pager-tr"><td colspan="11">${pagerHTML('tx', pg.page, pg.pages, pg.total)}</td></tr>`;
  mobile.innerHTML = list.map(t => `
    <div class="tx-card">
      <div class="tc-head"><div class="avatar" style="background:${avatarColor(t.customerName)}">${esc(initials(t.customerName))}</div>
        <div class="tc-meta"><strong>${esc(t.customerName)}</strong><span>${fmtDate(t.date)} · ${txQty(t)} pcs</span></div></div>
      <div class="tc-line"><span>Total</span><strong>${fmtRp(txTotal(t))}</strong></div>
      <div class="tc-line"><span>Sisa</span><strong class="${txRemaining(t) > 0 ? 'trend-down' : ''}">${fmtRp(txRemaining(t))}</strong></div>
      <div class="tc-foot">${statusBadge(t)}${keepBadge(t)}</div>
      <div class="row-actions">
        <button class="mini-btn view" data-act="view" data-id="${t.id}"><i class="fa-solid fa-eye"></i></button>
        <button class="mini-btn edit" data-act="edit" data-id="${t.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="mini-btn co" data-act="co" data-id="${t.id}"><i class="fa-solid fa-bag-shopping"></i></button>
        <button class="mini-btn del" data-act="del" data-id="${t.id}"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`).join('') + pagerHTML('tx', pg.page, pg.pages, pg.total);
}

/* ---- Item row template (dynamic): hanya harga + status ---- */
function itemRowHTML(item = {}) {
  const it = Object.assign({ price: 0, status: 'keep' }, item);
  const statusOpts = ['keep', 'batal'].map(s => `<option value="${s}" ${it.status === s ? 'selected' : ''}>${s === 'keep' ? '🟡 Keep' : '🔴 Batal'}</option>`).join('');
  return `<div class="item-row">
    <span class="item-no"><i class="fa-solid fa-shirt"></i></span>
    <input class="item-price" type="number" min="0" step="0.5" placeholder="Harga (ribu)" value="${it.price ? fmtK(it.price) : ''}" />
    <select class="item-status">${statusOpts}</select>
    <button type="button" class="rm" title="Hapus barang"><i class="fa-solid fa-trash"></i></button>
  </div>`;
}
function recomputeFormTotals() {
  let total = 0, qty = 0;
  $$('#itemsWrap .item-row').forEach(r => {
    if (r.querySelector('.item-status').value !== 'batal') {
      total += toRp(r.querySelector('.item-price').value);
      qty++;
    }
  });
  $('#formTotal').textContent = fmtRp(total);
  $('#formQty').textContent = qty + ' pcs';
  const remEl = $('#fDpRemaining');
  if (remEl) remEl.textContent = fmtRp(Math.max(0, total - toRp($('#fDpAmount').value)));
}
function addItemRow(item) {
  const wrap = $('#itemsWrap');
  wrap.insertAdjacentHTML('beforeend', itemRowHTML(item));
  recomputeFormTotals();
}
function openTxModal(id) {
  $('#itemsWrap').innerHTML = '';
  $('#txForm').reset();
  $('#txId').value = id || '';
  if (id) {
    const t = getTx(id);
    $('#modalTxTitle').textContent = 'Edit Transaksi';
    $('#fName').value = t.customerName || '';
    $('#fDate').value = t.date || todayStr();
    (t.items || []).forEach(i => addItemRow(i));
  } else {
    $('#modalTxTitle').textContent = 'Tambah Transaksi';
    $('#fDate').value = todayStr();
    addItemRow();
  }
  recomputeFormTotals();
  fillMethodSelect($('#fDpMethod'), SETTINGS.defaultMethod);
  $('#initDpWrap').style.display = id ? 'none' : '';
  const names = [...new Set(TRANSACTIONS.map(t => (t.customerName || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('#custNames').innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
  openModal('#modalTx');
}
function saveTxFromForm() {
  const name = $('#fName').value.trim();
  if (!name) return toast('Nama customer wajib diisi', 'error');
  const rows = $$('#itemsWrap .item-row');
  if (!rows.length) return toast('Tambahkan minimal satu barang', 'error');
  const items = [];
  for (const r of rows) {
    const priceVal = r.querySelector('.item-price').value;
    const price = toRp(priceVal);
    if (!priceVal || price <= 0) return toast('Setiap barang harus punya harga valid (lebih dari 0)', 'error');
    items.push({ price, status: r.querySelector('.item-status').value });
  }
  const id = $('#txId').value;
  let t;
  if (id) {
    t = getTx(id);
    Object.assign(t, { customerName: name, date: $('#fDate').value || todayStr(), items });
    // re-clamp: if paid now exceeds new total, keep payments but status auto recompute
    toast('Transaksi diperbarui', 'success');
  } else {
    t = { id: uid(), customerName: name, tiktokUsername: '', date: $('#fDate').value || todayStr(), items, payments: [], checkoutStatus: false, shopeeUsername: '', shopeeOrderNumber: '', checkoutDate: '', createdAt: Date.now() };
    const dpAmt = toRp($('#fDpAmount').value);
    if (dpAmt > 0) t.payments.push({ kind: dpAmt >= txTotal(t) ? 'pelunasan' : 'dp', amount: dpAmt, method: $('#fDpMethod').value || SETTINGS.defaultMethod, date: t.date, at: Date.now() });
    TRANSACTIONS.push(t);
    toast('Transaksi berhasil ditambahkan', 'success');
  }
  saveTx();
  closeModal('#modalTx');
  renderAll();
}

/* ---- Detail modal ---- */
function showDetail(id) {
  const t = getTx(id); if (!t) return;
  $('#detailTitle').textContent = 'Detail Transaksi';
  const payments = (t.payments || []).map(p => `<div class="tc-line"><span><span class="badge ${p.kind === 'dp' ? 'b-blue' : 'b-green'}">${p.kind.toUpperCase()}</span> ${esc(p.method)} · ${fmtDate(p.date)}</span><strong>${fmtRp(p.amount)}</strong></div>`).join('') || '<p class="stat-sub">Belum ada pembayaran.</p>';
  const items = (t.items || []).map((i, idx) => `<div class="tc-line"><span>Barang ${idx + 1}</span><strong>${fmtRp(i.price)} <span class="badge ${i.status === 'batal' ? 'b-batal' : 'b-keep'}">${i.status}</span></strong></div>`).join('');
  $('#detailBody').innerHTML = `
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">
      <div class="avatar" style="width:52px;height:52px;font-size:20px;background:${avatarColor(t.customerName)}">${esc(initials(t.customerName))}</div>
      <div><strong style="font-size:18px">${esc(t.customerName)}</strong><br><span class="stat-sub">${fmtDate(t.date)}</span></div>
    </div>
    <div class="panel" style="margin-bottom:14px"><div class="panel-head"><h3>Barang</h3></div>${items}</div>
    <div class="panel" style="margin-bottom:14px"><div class="panel-head"><h3>Pembayaran</h3></div>${payments}</div>
    <div class="totals-bar"><span>Total: <strong>${fmtRp(txTotal(t))}</strong></span><span>Dibayar: <strong>${fmtRp(txPaidTotal(t))}</strong></span><span>Sisa: <strong class="${txRemaining(t) > 0 ? 'trend-down' : ''}">${fmtRp(txRemaining(t))}</strong></span></div>
    <div class="tc-foot" style="margin-top:14px">${statusBadge(t)}${t.checkoutStatus ? `<span class="badge b-green">${esc(t.shopeeUsername || 'SUDAH CO')}</span>` : ''}</div>`;
  openModal('#modalDetail');
}

/* ---- Customer history timeline ---- */
function showCustomerHistory(name) {
  const txs = TRANSACTIONS.filter(t => ((t.customerName || 'Tanpa Nama').trim()) === name)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  if (!txs.length) return toast('Belum ada riwayat untuk customer ini', 'warn');
  const totalBelanja = txs.reduce((s, t) => s + txTotal(t), 0);
  const totalPcs = txs.reduce((s, t) => s + txQty(t), 0);
  const totalBayar = txs.reduce((s, t) => s + txPaidTotal(t), 0);
  const sisa = txs.reduce((s, t) => s + txRemaining(t), 0);
  const coCount = txs.filter(t => t.checkoutStatus).length;
  $('#detailTitle').textContent = 'Riwayat Customer';
  $('#detailBody').innerHTML = `
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">
      <div class="avatar" style="width:52px;height:52px;font-size:20px;background:${avatarColor(name)}">${esc(initials(name))}</div>
      <div><strong style="font-size:18px">${esc(name)}</strong><br><span class="stat-sub">${txs.length} order · terakhir ${fmtDate(txs[0].date)}</span></div>
    </div>
    <div class="cc-stats" style="margin-bottom:14px">
      <div><span>Total Belanja</span><strong>${fmtRp(totalBelanja)}</strong></div>
      <div><span>Total Barang</span><strong>${totalPcs} pcs</strong></div>
      <div><span>Dibayar</span><strong>${fmtRp(totalBayar)}</strong></div>
      <div><span>Sisa / Piutang</span><strong class="${sisa > 0 ? 'trend-down' : ''}">${fmtRp(sisa)}</strong></div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn btn-primary" data-action="add-for-customer" data-name="${esc(name)}"><i class="fa-solid fa-plus"></i> Order Baru</button>
    </div>
    <div class="panel"><div class="panel-head"><h3>Timeline Order</h3><span class="badge b-muted">${coCount}/${txs.length} CO</span></div>
      <div class="hist-list">
        ${txs.map(t => `
        <div class="hist-item" data-act="view" data-id="${t.id}">
          <div class="hi-date">${fmtDate(t.date)}</div>
          <div class="hi-body">
            <div class="hi-top"><strong>${txQty(t)} barang · ${fmtRp(txTotal(t))}</strong>${statusBadge(t)}</div>
            <div class="hi-sub">Dibayar ${fmtRp(txPaidTotal(t))} · Sisa <span class="${txRemaining(t) > 0 ? 'trend-down' : ''}">${fmtRp(txRemaining(t))}</span>${t.checkoutStatus ? ' · <i class="fa-solid fa-bag-shopping"></i> CO' : ''}${t.hangus ? ' · <i class="fa-solid fa-fire"></i> hangus' : ''}</div>
          </div>
          <i class="fa-solid fa-chevron-right hi-chev"></i>
        </div>`).join('')}
      </div>
    </div>`;
  openModal('#modalDetail');
}

/* ---- Delete with confirm ---- */
function askDelete(id) {
  const t = getTx(id); if (!t) return;
  confirmDialog('Hapus Transaksi', `Yakin ingin menghapus transaksi ${t.customerName}? Tindakan ini tidak bisa dibatalkan.`, 'Hapus', () => {
    TRANSACTIONS = TRANSACTIONS.filter(x => x.id !== id);
    saveTx(); renderAll(); toast('Data berhasil dihapus', 'success');
  });
}

/* ---- Generic confirm dialog ---- */
let confirmCb = null;
function confirmDialog(title, msg, okLabel, cb) {
  $('#confirmTitle').textContent = title;
  $('#confirmMsg').textContent = msg;
  $('#confirmOk').textContent = okLabel || 'Konfirmasi';
  confirmCb = cb;
  openModal('#modalConfirm');
}

/* =========================================================
   PAYMENTS (DP + PELUNASAN)
   ========================================================= */
function fillMethodSelect(sel, selected) {
  sel.innerHTML = METHOD_NAMES.map(m => `<option value="${m}" ${m === (selected || SETTINGS.defaultMethod) ? 'selected' : ''}>${m}</option>`).join('');
}

function openDpModal(txId) {
  const list = TRANSACTIONS.filter(t => txTotal(t) > 0);
  if (!list.length) return toast('Belum ada transaksi untuk dicatat DP', 'warn');
  fillMethodSelect($('#dpMethod'));
  $('#dpCustomer').innerHTML = list.map(t => `<option value="${t.id}">${esc(t.customerName)} — ${fmtRp(txTotal(t))} (sisa ${fmtRp(txRemaining(t))})</option>`).join('');
  if (txId) $('#dpCustomer').value = txId;
  $('#dpAmount').value = '';
  syncDpPreview();
  openModal('#modalDp');
}
function syncDpPreview() {
  const t = getTx($('#dpCustomer').value);
  if (!t) return;
  $('#dpTotal').textContent = fmtRp(txTotal(t));
  $('#dpPaid').textContent = fmtRp(txPaidTotal(t));
  const amt = toRp($('#dpAmount').value);
  $('#dpRemaining').textContent = fmtRp(Math.max(0, txRemaining(t) - amt));
}
function saveDp() {
  const t = getTx($('#dpCustomer').value);
  const amt = toRp($('#dpAmount').value);
  if (!t) return toast('Pilih customer', 'error');
  if (amt <= 0) return toast('Nominal DP tidak valid', 'error');
  const method = $('#dpMethod').value;
  const doIt = () => {
    t.payments = t.payments || [];
    t.payments.push({ kind: 'dp', amount: amt, method, date: todayStr(), at: Date.now() });
    saveTx(); closeModal('#modalDp'); renderAll();
    toast(`DP ${fmtRp(amt)} berhasil dicatat`, 'success');
  };
  if (amt > txRemaining(t)) {
    confirmDialog('Melebihi Sisa', `DP ${fmtRp(amt)} lebih besar dari sisa ${fmtRp(txRemaining(t))}. Simpan sebagai pembayaran berlebih?`, 'Ya, Simpan', doIt);
  } else doIt();
}

let activeLunasId = null;
function openLunasModal(txId) {
  const t = getTx(txId); if (!t) return;
  activeLunasId = txId;
  fillMethodSelect($('#lunasMethod'));
  $('#lunasCustomer').textContent = `${t.customerName} — ${txQty(t)} pcs`;
  $('#lunasTotal').textContent = fmtRp(txTotal(t));
  $('#lunasRemaining').textContent = fmtRp(txRemaining(t));
  $('#lunasAmount').value = fmtK(txRemaining(t));
  openModal('#modalLunas');
}
function saveLunas() {
  const t = getTx(activeLunasId); if (!t) return;
  const amt = toRp($('#lunasAmount').value);
  if (amt <= 0) return toast('Nominal pelunasan tidak valid', 'error');
  const method = $('#lunasMethod').value;
  const doIt = () => {
    t.payments = t.payments || [];
    t.payments.push({ kind: 'pelunasan', amount: amt, method, date: todayStr(), at: Date.now() });
    saveTx(); closeModal('#modalLunas'); renderAll();
    toast(txRemaining(t) === 0 ? 'Customer sudah lunas 🎉' : `Pelunasan ${fmtRp(amt)} tercatat`, 'success');
  };
  if (amt > txRemaining(t)) {
    confirmDialog('Melebihi Sisa', `Pelunasan ${fmtRp(amt)} lebih besar dari sisa ${fmtRp(txRemaining(t))}. Lanjutkan?`, 'Ya, Simpan', doIt);
  } else doIt();
}

/* =========================================================
   CHECKOUT SHOPEE
   ========================================================= */
let activeCoId = null;
function openCoModal(txId) {
  const t = getTx(txId); if (!t) return;
  if (t.checkoutStatus) { toast('Transaksi sudah di-checkout', 'info'); return; }
  const unpaid = txRemaining(t) > 0;
  activeCoId = txId;
  $('#coCustomer').textContent = t.customerName;
  $('#coQty').textContent = txQty(t) + ' pcs';
  $('#coTotal').textContent = fmtRp(txTotal(t));
  $('#coRemaining').textContent = fmtRp(txRemaining(t));
  $('#coForm').reset();
  $('#coDate').value = todayStr();
  $('#coReceiver').value = t.customerName;
  $('#coWarnWrap').hidden = !unpaid;
  $('#coWarn').innerHTML = '⚠ Transaksi ini <strong>belum lunas</strong> (sisa ' + fmtRp(txRemaining(t)) + '). Pelunasan harus selesai sebelum checkout Shopee.';
  $('#coLunasWrap').hidden = !unpaid;
  $('#coPaidNow').checked = false;
  openModal('#modalCo');
}
function saveCo() {
  const t = getTx(activeCoId); if (!t) return;
  if (txRemaining(t) > 0) {
    if (!$('#coPaidNow').checked) return toast('Belum lunas — centang "dibayar penuh lewat Shopee" atau catat pelunasan dulu.', 'error');
    t.payments = t.payments || [];
    t.payments.push({ kind: 'pelunasan', amount: txRemaining(t), method: 'ShopeePay', date: $('#coDate').value || todayStr(), at: Date.now() });
  }
  const shopee = $('#coShopee').value.trim();
  if (!shopee) return toast('Nama akun Shopee wajib diisi', 'error');
  t.checkoutStatus = true;
  t.shopeeUsername = shopee;
  t.shopeeReceiver = $('#coReceiver').value.trim();
  t.shopeeOrderNumber = $('#coOrderNo').value.trim();
  t.checkoutDate = $('#coDate').value || todayStr();
  saveTx(); closeModal('#modalCo'); renderAll();
  toast('Checkout Shopee berhasil 🛒', 'success');
}

/* =========================================================
   DP VIEW
   ========================================================= */
function renderDP() {
  const s = dashboardStats();
  $('#dpOverview').innerHTML = [
    { k: 'Total DP Masuk', v: fmtRp(s.totalDp) },
    { k: 'Total Pelunasan', v: fmtRp(s.totalLunas) },
    { k: 'Sudah DP', v: TRANSACTIONS.filter(t => txPaidTotal(t) > 0).length + ' trx' },
    { k: 'Belum DP', v: TRANSACTIONS.filter(t => txPaidTotal(t) === 0).length + ' trx' },
  ].map(x => `<div class="mini"><span>${x.k}</span><strong>${x.v}</strong></div>`).join('');
  const rows = [];
  TRANSACTIONS.forEach(t => (t.payments || []).forEach(p => rows.push({ t, p })));
  rows.sort((a, b) => (b.p.at || 0) - (a.p.at || 0));
  const pgD = slicePage(rows, 'dp');
  $('#paymentHistory').innerHTML = rows.length ? pgD.items.map(({ t, p }) => `
    <tr><td>${fmtDate(p.date)}</td><td>${esc(t.customerName)}</td>
      <td><span class="badge ${p.kind === 'dp' ? 'b-blue' : 'b-green'}">${p.kind.toUpperCase()}</span></td>
      <td><strong>${fmtRp(p.amount)}</strong></td>
      <td><span class="cust-cell"><i class="fa-solid ${METHODS[p.method]?.icon || 'fa-money-bill'}" style="color:${METHODS[p.method]?.color || 'var(--muted)'}"></i> ${esc(p.method)}</span></td></tr>`).join('') + `<tr class="pager-tr"><td colspan="5">${pagerHTML('dp', pgD.page, pgD.pages, pgD.total)}</td></tr>`
    : `<tr><td colspan="5" style="text-align:center;color:var(--muted)">Belum ada pembayaran.</td></tr>`;
}

/* =========================================================
   KEEP VIEW
   ========================================================= */
const keepOpen = new Set(); // nama grup Keep yang lagi di-buka (accordion)
function renderKeep() {
  const s = dashboardStats();
  $('#keepStats').innerHTML = [
    { k: 'Barang KEEP', v: s.keepItems },
    { k: 'Barang BATAL', v: s.batalItems },
    { k: 'DP Hangus', v: s.hangusCount + ' trx' },
    { k: 'Uang DP Hangus', v: fmtRp(s.hangusTotal) },
  ].map(x => `<div class="mini"><span>${x.k}</span><strong>${x.v}</strong></div>`).join('');
  const q = ($('#keepSearch') && $('#keepSearch').value || '').toLowerCase();
  const f = ($('#keepStatusFilter') && $('#keepStatusFilter').value) || 'all';
  const map = new Map();
  TRANSACTIONS.forEach(t => {
    if (t.checkoutStatus) return; // sudah CO = barang dikirim, bukan keep lagi
    const name = (String(t.customerName || '').trim()) || 'Tanpa Nama';
    if (q && !name.toLowerCase().includes(q)) return;
    (t.items || []).forEach((i, idx) => {
      const st = i.status || 'keep';
      const pass = f === 'all' ? st !== 'batal' : st === f;
      if (!pass) return;
      if (!map.has(name)) map.set(name, { name, items: [], txs: new Map(), k: 0, ba: 0, gTotal: 0 });
      const g = map.get(name);
      g.items.push({ i, idx, txId: t.id });
      if (!g.txs.has(t.id)) g.txs.set(t.id, t);
      if (st === 'batal') g.ba++; else { g.k++; g.gTotal += (i.price || 0); }
    });
  });
  const groups = [...map.values()].sort((a, b) => b.gTotal - a.gTotal || a.name.localeCompare(b.name));
  const pg = slicePage(groups, 'keep');
  $('#keepList').innerHTML = groups.length ? pg.items.map(g => {
    const hangTxs = [...g.txs.values()].filter(t => txPaidTotal(t) > 0 && txRemaining(t) > 0 && !t.hangus);
    const coTxs = [...g.txs.values()].filter(t => txTotal(t) > 0 && txRemaining(t) === 0);
    const multi = g.txs.size > 1;
    return `
    <div class="keep-group${keepOpen.has(g.name) ? ' open' : ''}" data-keep-name="${esc(g.name)}">
      <div class="kg-head">
        <div class="avatar" style="background:${avatarColor(g.name)}">${esc(initials(g.name))}</div>
        <div class="kg-name"><strong>${esc(g.name)}</strong><span>${g.k} keep${g.ba ? ' · ' + g.ba + ' batal' : ''}${multi ? ' · ' + g.txs.size + ' sesi' : ''}</span></div>
        ${coTxs.map(tt => `<button class="kg-co" data-act="co" data-id="${tt.id}" title="Sudah lunas — siap checkout Shopee"><i class="fa-solid fa-bag-shopping"></i> CO${multi ? ' · ' + fmtDate(tt.date) : ''}</button>`).join('')}
        ${hangTxs.map(tt => `<button class="kg-hangus" data-act="hangus" data-id="${tt.id}" title="DP hangus: barang kembali dijual, uang DP tetap masuk">${multi ? fmtDate(tt.date) + ' · ' : ''}<i class="fa-solid fa-fire"></i> DP Hangus</button>`).join('')}
        <div class="kg-sum">${fmtRp(g.gTotal)}<div class="kg-badges">${g.k ? `<span class="badge b-keep">${g.k} Keep</span>` : ''}${g.ba ? `<span class="badge b-batal">${g.ba} Batal</span>` : ''}</div></div>
        <i class="fa-solid fa-chevron-down kg-chev" aria-hidden="true"></i>
      </div>
      <div class="kg-items">
        ${g.items.map((it, n) => `
        <div class="kg-item${it.i.status === 'batal' ? ' is-batal' : ''}">
          <span class="ki-no">${n + 1}.</span>
          <span class="ki-price">${fmtRp(it.i.price)}</span>
          <div class="seg seg-mini">
            <button class="${it.i.status === 'keep' ? 'on-keep' : ''}" data-item-status="keep" data-id="${it.txId}" data-idx="${it.idx}" title="Tetap keep"><i class="fa-solid fa-bookmark"></i></button>
            <button class="${it.i.status === 'batal' ? 'on-batal' : ''}" data-item-status="batal" data-id="${it.txId}" data-idx="${it.idx}" title="Batalkan barang"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('') + pagerHTML('keep', pg.page, pg.pages, pg.total) : emptyState(TRANSACTIONS.length ? 'Tidak ada hasil' : 'Belum ada barang di-keep', (q || f !== 'all') ? 'Coba ubah pencarian / filter status.' : 'Tambahkan transaksi untuk melihat barang yang di-keep.', 'add-tx');
}
function setItemStatus(txId, idx, status) {
  const t = getTx(txId); if (!t || !t.items[idx]) return;
  t.items[idx].status = status;
  saveTx(); renderAll();
  toast(`Status barang → ${status.toUpperCase()}`, status === 'batal' ? 'warn' : 'success');
}

/* =========================================================
   PELUNASAN VIEW
   ========================================================= */
function renderPelunasan() {
  const list = TRANSACTIONS.filter(t => txRemaining(t) > 0 && txTotal(t) > 0);
  const outstanding = list.reduce((s, t) => s + txRemaining(t), 0);
  $('#pelunasanStats').innerHTML = [
    { k: 'Transaksi Belum Lunas', v: list.length },
    { k: 'Total Outstanding', v: fmtRp(outstanding) },
    { k: 'Sudah Lunas', v: TRANSACTIONS.filter(t => txTotal(t) > 0 && txRemaining(t) === 0).length },
  ].map(x => `<div class="mini"><span>${x.k}</span><strong>${x.v}</strong></div>`).join('');
  const pg = slicePage(list, 'pelunasan');
  $('#pelunasanList').innerHTML = list.length ? pg.items.map(t => `
    <div class="tx-card">
      <div class="tc-head"><div class="avatar" style="background:${avatarColor(t.customerName)}">${esc(initials(t.customerName))}</div>
        <div class="tc-meta"><strong>${esc(t.customerName)}</strong><span>${txQty(t)} pcs · ${fmtDate(t.date)}</span></div></div>
      <div class="tc-line"><span>Total</span><strong>${fmtRp(txTotal(t))}</strong></div>
      <div class="tc-line"><span>DP</span><strong>${fmtRp(txDp(t))}</strong></div>
      <div class="tc-line"><span>Sisa</span><strong class="trend-down">${fmtRp(txRemaining(t))}</strong></div>
      <div class="tc-foot">${statusBadge(t)}</div>
      <button class="btn btn-primary" data-act="lunas" data-id="${t.id}"><i class="fa-solid fa-circle-check"></i> LUNASI</button>
    </div>`).join('') + pagerHTML('pelunasan', pg.page, pg.pages, pg.total) : emptyState('Semua sudah lunas 🎉', 'Tidak ada transaksi yang menunggu pelunasan.');
}

/* =========================================================
   CHECKOUT VIEW
   ========================================================= */
function renderCheckout() {
  const cf = ($('#coFilter') && $('#coFilter').value) || 'all';
  const cq = ($('#coSearch') && $('#coSearch').value || '').toLowerCase();
  const total = TRANSACTIONS.length;
  const done = TRANSACTIONS.filter(t => t.checkoutStatus).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const readyCount = TRANSACTIONS.filter(t => !t.checkoutStatus && txTotal(t) > 0 && txRemaining(t) === 0).length;
  $('#coProgressPanel').innerHTML = `
    <div class="co-progress">
      <div class="p-top"><span>Progress Checkout</span><strong>${pct}% Checkout</strong></div>
      <div class="big-bar"><i data-w="${pct}"></i></div>
      <div class="mini-grid" style="margin-top:16px">
        <div class="mini"><span>Total Customer</span><strong>${total}</strong></div>
        <div class="mini co-filter${cf === 'done' ? ' co-active' : ''}" data-action="co-filter" data-val="done" title="Klik: tampil yang sudah CO"><span>Sudah CO</span><strong>${done}</strong></div>
        <div class="mini co-filter${cf === 'pending' ? ' co-active' : ''}" data-action="co-filter" data-val="pending" title="Klik: tampil yang belum CO"><span>Belum CO</span><strong>${total - done}</strong></div>
        <div class="mini co-filter${cf === 'ready' ? ' co-active' : ''}" data-action="co-filter" data-val="ready" title="Klik: tampil yang siap dikirim (lunas, belum CO)"><span>Siap Kirim</span><strong>${readyCount}</strong></div>
      </div>
    </div>`;
  requestAnimationFrame(() => { const b = $('#coProgressPanel .big-bar > i'); if (b) b.style.width = b.dataset.w + '%'; });
  let list = TRANSACTIONS.filter(t => txTotal(t) > 0);
  if (cq) list = list.filter(t => String(t.customerName || '').toLowerCase().includes(cq) || String(t.shopeeUsername || '').toLowerCase().includes(cq));
  if (cf === 'done') list = list.filter(t => t.checkoutStatus);
  else if (cf === 'pending') list = list.filter(t => !t.checkoutStatus);
  else if (cf === 'ready') list = list.filter(t => !t.checkoutStatus && txRemaining(t) === 0);
  const pg = slicePage(list, 'co');
  $('#coList').innerHTML = list.length ? pg.items.map(t => `
    <div class="tx-card">
      <div class="tc-head"><div class="avatar" style="background:${avatarColor(t.customerName)}">${esc(initials(t.customerName))}</div>
        <div class="tc-meta"><strong>${esc(t.customerName)}</strong><span>${txQty(t)} pcs · ${fmtRp(txTotal(t))}</span></div></div>
      ${t.checkoutStatus ? `
        <div class="tc-line"><span>Akun Shopee</span><strong>${esc(t.shopeeUsername || '-')}</strong></div>
        <div class="tc-line"><span>Tanggal CO</span><strong>${fmtDate(t.checkoutDate)}</strong></div>
        <div class="tc-foot"><span class="badge b-green">SUDAH CO</span>${t.shopeeOrderNumber ? `<span class="badge b-muted">#${esc(t.shopeeOrderNumber)}</span>` : ''}</div>`
      : `
        <div class="tc-line"><span>Sisa</span><strong class="${txRemaining(t) > 0 ? 'trend-down' : ''}">${fmtRp(txRemaining(t))}</strong></div>
        <div class="tc-foot">${statusBadge(t)}</div>
        <button class="btn ${txRemaining(t) > 0 ? 'btn-ghost' : 'btn-primary'}" data-act="co" data-id="${t.id}"><i class="fa-solid fa-bag-shopping"></i> CO SEKARANG</button>`}
    </div>`).join('') + pagerHTML('co', pg.page, pg.pages, pg.total) : emptyState((cq || cf !== 'all') ? 'Tidak ada hasil' : 'Belum ada transaksi', (cq || cf !== 'all') ? 'Coba ubah pencarian / filter CO.' : 'Data checkout akan muncul di sini.');
}

/* =========================================================
   CUSTOMER AGGREGATION + DATA CUSTOMER VIEW
   ========================================================= */
function customerAgg() {
  const map = new Map();
  TRANSACTIONS.forEach(t => {
    const key = (t.customerName || 'Tanpa Nama').trim();
    if (!map.has(key)) map.set(key, { name: key, tiktok: t.tiktokUsername || '', phone: t.phone || '', orders: 0, qty: 0, value: 0, paid: 0, co: 0 });
    const c = map.get(key);
    c.orders++; c.qty += txQty(t); c.value += txTotal(t); c.paid += txPaidTotal(t);
    if (t.checkoutStatus) c.co++;
    if (t.tiktokUsername) c.tiktok = t.tiktokUsername;
    if (t.phone) c.phone = t.phone;
  });
  return [...map.values()];
}
function renderCustomers() {
  const q = ($('#custSearch').value || '').toLowerCase();
  let list = customerAgg().filter(c => !q || c.name.toLowerCase().includes(q) || c.tiktok.toLowerCase().includes(q));
  list.sort((a, b) => b.value - a.value);
  const pg = slicePage(list, 'cust');
  $('#custGrid').innerHTML = list.length ? pg.items.map(c => `
    <div class="cust-card">
      <div class="cc-top" data-action="cust-history" data-name="${esc(c.name)}" title="Lihat riwayat order">
        <div class="avatar" style="background:${avatarColor(c.name)}">${esc(initials(c.name))}</div>
        <strong>${esc(c.name)}</strong>
      </div>
      <div class="cc-stats">
        <div><span>Order</span><strong>${c.orders}</strong></div>
        <div><span>Barang</span><strong>${c.qty} pcs</strong></div>
        <div><span>Total Belanja</span><strong>${fmtRp(c.value)}</strong></div>
        <div><span>Checkout</span><strong>${c.co}/${c.orders}</strong></div>
      </div>
      <button class="cc-add" data-action="add-for-customer" data-name="${esc(c.name)}" title="Tambah order baru untuk customer ini"><i class="fa-solid fa-plus"></i> Order Lagi</button>
    </div>`).join('') + pagerHTML('cust', pg.page, pg.pages, pg.total) : emptyState('Belum ada customer', 'Data customer muncul otomatis dari transaksi.', 'add-tx');
}

/* =========================================================
   ANALYTICS
   ========================================================= */
const CHARTS = {};
function destroyCharts() { Object.keys(CHARTS).forEach(k => { if (CHARTS[k]) { CHARTS[k].destroy(); delete CHARTS[k]; } }); }
function lastNDays(n) {
  const out = []; const today = new Date(todayStr() + 'T00:00:00');
  for (let i = n - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); out.push(isoDate(d)); }
  return out;
}
function renderAnalytics() {
  const txs = TRANSACTIONS;
  const activeTxs = txs.filter(t => !t.hangus);
  const totalValue = txs.reduce((s, t) => s + txTotal(t), 0);
  const totalDp = activeTxs.reduce((s, t) => s + txDp(t), 0);
  const totalLunas = activeTxs.reduce((s, t) => s + txLunas(t), 0);
  const hangusIncome = txs.filter(t => t.hangus).reduce((s, t) => s + (t.hangusAmount != null ? t.hangusAmount : txPaidTotal(t)), 0);
  const outstanding = txs.reduce((s, t) => s + txRemaining(t), 0);
  const totalPcs = txs.reduce((s, t) => s + txQty(t), 0);
  const n = txs.length || 1;
  const coDone = txs.filter(t => t.checkoutStatus).length;
  const custCount = customerAgg().length;
  const dpCount = txs.filter(t => txPaidTotal(t) > 0).length;
  const lunasCount = txs.filter(t => txTotal(t) > 0 && txRemaining(t) === 0).length;
  $('#analyticsStats').innerHTML = [
    { k: 'Total Omzet', v: fmtRp(totalValue) }, { k: 'Total DP', v: fmtRp(totalDp) },
    { k: 'Total Pelunasan', v: fmtRp(totalLunas) }, { k: 'Outstanding', v: fmtRp(outstanding) }, { k: 'Pendapatan Hangus', v: fmtRp(hangusIncome) },
    { k: 'Avg Order Value', v: fmtRp(totalValue / n) }, { k: 'Rata² Harga/Barang', v: fmtRp(totalPcs ? totalValue / totalPcs : 0) }, { k: 'Avg Item/Customer', v: (totalPcs / n).toFixed(1) },
    { k: 'Total Customer', v: custCount }, { k: 'Total Transaksi', v: txs.length },
    { k: 'Total Pcs', v: totalPcs }, { k: 'Sudah CO', v: coDone }, { k: 'Belum CO', v: txs.length - coDone },
  ].map(x => `<div class="mini"><span>${x.k}</span><strong>${x.v}</strong></div>`).join('');

  // funnel
  $('#funnel').innerHTML = [
    { k: 'Transaksi', v: txs.length, max: txs.length || 1 },
    { k: 'Sudah DP', v: dpCount, max: txs.length || 1 },
    { k: 'Lunas', v: lunasCount, max: txs.length || 1 },
    { k: 'Checkout', v: coDone, max: txs.length || 1 },
  ].map(f => `<div class="fn-row"><div class="fn-top"><span>${f.k}</span><strong>${f.v} (${Math.round(f.v / f.max * 100)}%)</strong></div><div class="fn-bar"><i data-w="${Math.round(f.v / f.max * 100)}">${f.v}</i></div></div>`).join('');
  requestAnimationFrame(() => $$('#funnel .fn-bar > i').forEach(b => b.style.width = Math.max(8, +b.dataset.w) + '%'));

  renderTopCustomers();
  renderCharts();
}
function renderTopCustomers() {
  const list = customerAgg();
  const rankHTML = (arr, valFn, subFn) => arr.length ? arr.map((c, i) => `
    <li><div class="rk">${i + 1}</div>
      <div class="avatar" style="width:34px;height:34px;font-size:14px;border-radius:10px;background:${avatarColor(c.name)}">${esc(initials(c.name))}</div>
      <div class="r-body"><strong>${esc(c.name)}</strong></div>
      <div class="r-val">${valFn(c)}<br><span style="font-size:11px;color:var(--muted);font-weight:400">${subFn(c)}</span></div></li>`).join('')
    : `<li style="color:var(--muted);justify-content:center">Belum ada data</li>`;
  const byValue = [...list].sort((a, b) => b.value - a.value).slice(0, 6);
  const byQty = [...list].sort((a, b) => b.qty - a.qty).slice(0, 6);
  $('#topByValue').innerHTML = rankHTML(byValue, c => fmtRp(c.value), c => `${c.orders} order · ${c.qty} pcs`);
  $('#topByQty').innerHTML = rankHTML(byQty, c => c.qty + ' pcs', c => `${c.orders} order · ${fmtRp(c.value)}`);
}
function gridColor() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(20,20,40,.08)'; }
function textColor() { return document.documentElement.getAttribute('data-theme') === 'dark' ? '#c9c9d6' : '#5b5b78'; }
function renderCharts() {
  if (typeof Chart === 'undefined') return;
  if (currentView !== 'analytics') return;
  destroyCharts();
  Chart.defaults.color = textColor();
  Chart.defaults.font.family = 'Inter, sans-serif';
  const days = lastNDays(7);
  const dayValue = days.map(d => TRANSACTIONS.filter(t => t.date === d).reduce((s, t) => s + txTotal(t), 0));
  const dayPcs = days.map(d => TRANSACTIONS.filter(t => t.date === d).reduce((s, t) => s + txQty(t), 0));
  const dayLabels = days.map(d => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short' }));
  const mm = paymentByMethod();
  const st = [
    TRANSACTIONS.filter(t => txTotal(t) > 0 && txRemaining(t) === 0).length,
    TRANSACTIONS.filter(t => txPaidTotal(t) > 0 && !(txTotal(t) > 0 && txRemaining(t) === 0)).length,
    TRANSACTIONS.filter(t => txPaidTotal(t) === 0).length,
  ];
  const co = [TRANSACTIONS.filter(t => t.checkoutStatus).length, TRANSACTIONS.filter(t => !t.checkoutStatus && txTotal(t) > 0).length];
  const grad = (id) => { const el = $(id); const c = el.getContext('2d'); const gr = c.createLinearGradient(0, 0, 0, 280); gr.addColorStop(0, 'rgba(168,85,247,.5)'); gr.addColorStop(1, 'rgba(236,72,153,.02)'); return gr; };
  const common = { responsive: true, plugins: { legend: { labels: { usePointStyle: true, padding: 14 } } } };
  CHARTS.daily = new Chart($('#chartDaily'), { type: 'line', data: { labels: dayLabels, datasets: [{ label: 'Penjualan', data: dayValue, borderColor: '#ec4899', backgroundColor: grad('#chartDaily'), fill: true, tension: .4, pointRadius: 4, pointBackgroundColor: '#a855f7' }] }, options: { ...common, scales: { y: { grid: { color: gridColor() } }, x: { grid: { color: gridColor() } } } } });
  CHARTS.method = new Chart($('#chartMethod'), { type: 'doughnut', data: { labels: METHOD_NAMES, datasets: [{ data: METHOD_NAMES.map(m => mm[m]), backgroundColor: METHOD_NAMES.map(m => METHODS[m].color), borderWidth: 0 }] }, options: { ...common, plugins: { legend: { position: 'right', labels: { usePointStyle: true } } }, cutout: '62%' } });
  CHARTS.status = new Chart($('#chartStatus'), { type: 'doughnut', data: { labels: ['Lunas', 'Sudah DP', 'Belum DP'], datasets: [{ data: st, backgroundColor: ['#22c55e', '#f5b301', '#ef4444'], borderWidth: 0 }] }, options: { ...common, cutout: '62%' } });
  CHARTS.checkout = new Chart($('#chartCheckout'), { type: 'bar', data: { labels: ['Sudah CO', 'Belum CO'], datasets: [{ label: 'Transaksi', data: co, backgroundColor: ['#a855f7', '#64748b'], borderRadius: 8, borderWidth: 0 }] }, options: { ...common, plugins: { legend: { display: false } }, scales: { y: { grid: { color: gridColor() } }, x: { grid: { display: false } } } } });
  CHARTS.items = new Chart($('#chartItems'), { type: 'bar', data: { labels: dayLabels, datasets: [{ label: 'Pcs Terjual', data: dayPcs, backgroundColor: '#3b82f6', borderRadius: 8, borderWidth: 0 }] }, options: { ...common, plugins: { legend: { display: false } }, scales: { y: { grid: { color: gridColor() } }, x: { grid: { display: false } } } } });
}

/* =========================================================
   LIVE MODE
   ========================================================= */
function renderLive() {
  const q = ($('#liveSearch').value || '').toLowerCase();
  let list = TRANSACTIONS.filter(t => txTotal(t) > 0 && !(t.checkoutStatus));
  if (q) list = list.filter(t => t.customerName.toLowerCase().includes(q));
  list.sort((a, b) => txRemaining(b) - txRemaining(a));
  const pg = slicePage(list, 'live');
  $('#liveList').innerHTML = list.length ? pg.items.map(t => `
    <div class="live-card">
      <div class="lc-head"><div class="avatar" style="background:${avatarColor(t.customerName)}">${esc(initials(t.customerName))}</div>
        <div class="tc-meta"><strong>${esc(t.customerName)}</strong></div></div>
      <div class="lc-stats"><span>${txQty(t)} pcs · ${fmtRp(txTotal(t))}</span><span class="${txRemaining(t) > 0 ? 'trend-down' : 'trend-up'}">sisa ${fmtRp(txRemaining(t))}</span></div>
      <div class="tc-foot">${statusBadge(t)}</div>
      <div class="live-actions">
        <button class="la-add" data-act="edit" data-id="${t.id}"><i class="fa-solid fa-plus"></i>BARANG</button>
        <button class="la-keep" data-act="live-keep" data-id="${t.id}"><i class="fa-solid fa-bookmark"></i>KEEP</button>
        <button class="la-dp" data-act="add-dp" data-id="${t.id}"><i class="fa-solid fa-hand-holding-dollar"></i>DP</button>
        <button class="la-cancel" data-act="live-cancel" data-id="${t.id}"><i class="fa-solid fa-ban"></i>CANCEL</button>
        <button class="la-lunas" data-act="lunas" data-id="${t.id}"><i class="fa-solid fa-circle-check"></i>LUNAS</button>
        <button class="la-co" data-act="co" data-id="${t.id}"><i class="fa-solid fa-bag-shopping"></i>CO</button>
        ${txPaidTotal(t) > 0 ? `<button class="la-hangus" data-act="hangus" data-id="${t.id}"><i class="fa-solid fa-fire"></i>HANGUS</button>` : ''}
      </div>
    </div>`).join('') + pagerHTML('live', pg.page, pg.pages, pg.total) : emptyState('Semua transaksi selesai 🎉', 'Tidak ada transaksi aktif yang belum checkout.');
}
function liveSetAll(txId, status) {
  const t = getTx(txId); if (!t) return;
  t.items.forEach(i => i.status = status);
  saveTx(); renderAll();
  toast(status === 'batal' ? `${t.customerName}: transaksi dibatalkan` : `${t.customerName}: barang di-keep`, status === 'batal' ? 'warn' : 'success');
}
function markHangus(txId) {
  const t = getTx(txId); if (!t) return;
  confirmDialog('DP Hangus', `Tandai DP ${t.customerName} HANGUS? Uang DP tetap masuk ke kantongmu (${fmtRp(txPaidTotal(t))}), barang kembali dijual & keluar dari daftar Keep.`, 'Ya, Hanguskan', () => {
    t.items.forEach(i => i.status = 'batal');
    t.hangus = true; t.hangusAt = Date.now(); t.hangusAmount = txPaidTotal(t);
    saveTx(); renderAll(); toast('DP ditandai hangus — uang tetap masuk, barang kembali dijual', 'warn');
  });
}

/* =========================================================
   SETTINGS + DATA I/O
   ========================================================= */
function renderSettings() {
  $('#settingsTxCount').textContent = TRANSACTIONS.length;
  updateCloudUI();
  $('#methodSetting').innerHTML = METHOD_NAMES.map(m => `<button class="chip" data-default-method="${m}" style="${m === SETTINGS.defaultMethod ? 'background:var(--grad);color:#fff;border-color:transparent' : ''}"><i class="fa-solid ${METHODS[m].icon}" style="color:${m === SETTINGS.defaultMethod ? '#fff' : METHODS[m].color}"></i> ${m}</button>`).join('');
}
function download(filename, text, type) {
  const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
function exportCSV() {
  const head = ['Tanggal', 'Customer', 'TikTok', 'JumlahBarang', 'Total', 'DP', 'Pelunasan', 'Sisa', 'StatusDP', 'StatusCO', 'Shopee', 'NoPesanan'];
  const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [head.map(q).join(',')];
  TRANSACTIONS.forEach(t => lines.push([t.date, t.customerName, t.tiktokUsername, txQty(t), txTotal(t), txDp(t), txLunas(t), txRemaining(t), txPaidStatus(t), t.checkoutStatus ? 'SUDAH CO' : 'BELUM CO', t.shopeeUsername, t.shopeeOrderNumber].map(q).join(',')));
  download('pakein-tracker-' + todayStr() + '.csv', '\ufeff' + lines.join('\n'), 'text/csv;charset=utf-8');
  toast('Export CSV berhasil', 'success');
}
function exportJSON() { download('pakein-tracker-' + todayStr() + '.json', JSON.stringify(TRANSACTIONS, null, 2), 'application/json'); toast('Export JSON berhasil', 'success'); }
function backup() { const data = { app: 'PAKEIN TRACKER', version: 1, exportedAt: new Date().toISOString(), transactions: TRANSACTIONS, settings: SETTINGS }; download('pakein-backup-' + todayStr() + '.json', JSON.stringify(data, null, 2), 'application/json'); toast('Backup berhasil diunduh', 'success'); }
function normalizeTx(t) {
  return { id: t.id || uid(), customerName: t.customerName || 'Tanpa Nama', tiktokUsername: t.tiktokUsername || '', date: t.date || todayStr(), items: (t.items || []).map(i => ({ price: i.price || 0, status: i.status === 'final' ? 'keep' : (i.status || 'keep') })), payments: t.payments || [], checkoutStatus: !!t.checkoutStatus, shopeeUsername: t.shopeeUsername || '', shopeeOrderNumber: t.shopeeOrderNumber || '', checkoutDate: t.checkoutDate || '', hangus: !!t.hangus, hangusAmount: t.hangusAmount || 0, createdAt: t.createdAt || Date.now() };
}
function ingestTransactions(arr) {
  if (!Array.isArray(arr) || !arr.length) { toast('File tidak valid / kosong', 'error'); return; }
  TRANSACTIONS = arr.map(normalizeTx);
  saveTx(); renderAll(); toast(`${TRANSACTIONS.length} transaksi berhasil dimuat`, 'success');
}
function readFileJSON(input, cb) {
  const f = input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    try { const data = JSON.parse(e.target.result); cb(data); }
    catch { toast('Gagal membaca file JSON', 'error'); }
    input.value = '';
  };
  r.readAsText(f);
}
function restoreFrom(data) {
  if (Array.isArray(data)) return ingestTransactions(data);
  if (data && Array.isArray(data.transactions)) {
    TRANSACTIONS = data.transactions.map(normalizeTx);
    if (data.settings) { SETTINGS = Object.assign(SETTINGS, data.settings); saveSettings(); }
    saveTx(); renderAll(); toast('Restore data berhasil', 'success');
  } else toast('Format backup tidak dikenali', 'error');
}
function loadDemo() { demoData(); saveTx(); SETTINGS.onboarded = true; saveSettings(); renderAll(); toast('Demo data dimuat ✨', 'success'); }
function clearAll() {
  confirmDialog('Hapus Semua Data', 'Semua transaksi akan dihapus permanen. Yakin lanjutkan?', 'Hapus Semua', () => {
    TRANSACTIONS = []; saveTx(); renderAll(); toast('Semua data dihapus', 'warn');
  });
}

/* ---------------- Demo data ---------------- */
function demoData() {
  const t = todayStr();
  const dd = (n) => { const d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - n); return isoDate(d); };
  const mk = (name, tt, date, items, payments, co) => {
    const its = items.map(i => ({ price: i.price, status: i.status === 'final' ? 'keep' : i.status }));
    const tr = normalizeTx({ customerName: name, tiktokUsername: tt, date, items: its, payments, createdAt: new Date(date + 'T12:00:00').getTime() });
    if (co) { tr.checkoutStatus = true; tr.shopeeUsername = co.shopee; tr.shopeeOrderNumber = co.no; tr.checkoutDate = co.date; }
    return tr;
  };
  const P = (kind, amount, method) => ({ kind, amount, method, date: todayStr(), at: Date.now() });
  TRANSACTIONS = [
    mk('Siti', '@siti_shop', dd(3), [
      { price: 40000, status: 'final' },
      { price: 75000, status: 'final' },
      { price: 50000, status: 'final' }],
      [P('dp', 40000, 'QRIS'), P('pelunasan', 125000, 'DANA')], { shopee: '@sitishop123', no: '2409A1', date: dd(2) }),
    mk('Rina', '@rina.id', dd(2), [
      { price: 85000, status: 'final' },
      { price: 60000, status: 'keep' }],
      [P('dp', 50000, 'ShopeePay')]),
    mk('Deni', '@denix', dd(2), [
      { price: 125000, status: 'final' }],
      [P('dp', 60000, 'Transfer Bank')]),
    mk('Ayu', '@ayushop', t, [
      { price: 45000, status: 'keep' },
      { price: 25000, status: 'keep' }],
      [P('dp', 30000, 'QRIS')]),
    mk('Fajar', '@fjr', t, [
      { price: 150000, status: 'final' },
      { price: 20000, status: 'batal' }],
      [P('dp', 75000, 'DANA')]),
    mk('Nadia', '@ndia', t, [
      { price: 70000, status: 'keep' }],
      []),
    mk('Dewi', '@dewii', dd(1), [
      { price: 90000, status: 'final' },
      { price: 30000, status: 'final' }],
      [P('dp', 50000, 'ShopeePay'), P('pelunasan', 70000, 'QRIS')], { shopee: '@dewisore', no: '2409B2', date: dd(1) }),
    mk('Bagus', '@bagusstore', dd(1), [
      { price: 120000, status: 'final' }],
      [P('pelunasan', 120000, 'Transfer Bank')], { shopee: '@baguss', no: '2409B3', date: dd(1) }),
    mk('Indah', '@indahh', dd(4), [
      { price: 55000, status: 'keep' },
      { price: 45000, status: 'final' }],
      [P('dp', 40000, 'DANA')]),
    mk('Tomi', '@tomi.gudang', dd(5), [
      { price: 200000, status: 'final' },
      { price: 80000, status: 'final' }],
      [P('dp', 100000, 'Transfer Bank'), P('pelunasan', 180000, 'Transfer Bank')], { shopee: '@tomishop', no: '2409T9', date: dd(4) }),
    mk('Cici', '@cici.cute', dd(6), [
      { price: 35000, status: 'batal' }],
      []),
    mk('Riko', '@rikoo', dd(7), [
      { price: 150000, status: 'final' }],
      [P('dp', 75000, 'QRIS')]),
    mk('Lala', '@lalashop', dd(8), [
      { price: 65000, status: 'final' },
      { price: 25000, status: 'keep' }],
      [P('dp', 30000, 'ShopeePay')]),
    mk('Yoga', '@yoga.fit', dd(9), [
      { price: 110000, status: 'final' }],
      [P('pelunasan', 110000, 'DANA')], { shopee: '@yogastore', no: '2409Y1', date: dd(8) }),
  ];
}

/* =========================================================
   EVENT WIRING
   ========================================================= */
function handleAction(action, el) {
  const id = el.dataset.id || null;
  switch (action) {
    case 'add-tx': openTxModal(); break;
        case 'add-for-customer': openTxModal(); $('#fName').value = el.dataset.name || ''; break;
    case 'cust-history': showCustomerHistory(el.dataset.name || ''); break;
    case 'add-keep': openTxModal(); break;
    case 'add-dp': openDpModal(id); break;
    case 'goto-checkout': go('checkout'); break;
    case 'co-filter': { const val = el.dataset.val; const sel = $('#coFilter'); sel.value = (sel.value === val) ? 'all' : val; resetPage('co'); renderCheckout(); break; }
    case 'goto-pelunasan': go('pelunasan'); break;
    case 'export-csv': exportCSV(); break;
    case 'export-json': exportJSON(); break;
    case 'import-json': $('#importFile').click(); break;
    case 'backup': backup(); break;
    case 'restore': $('#restoreFile').click(); break;
    case 'load-demo': loadDemo(); break;
    case 'clear-all': clearAll(); break;
    case 'toggle-theme': toggleTheme(); break;
    case 'cloud-sync': cloudSyncNow(); break;
    case 'cloud-push': if (!CLOUD.available) { toast('Cloud belum tersedia / offline', 'warn'); break; } pushCloud(); toast('Mengirim data ke cloud…', 'info'); break;
    case 'cloud-pull': pullCloud({ silent: false }); break;
    case 'goto-page': { const k = el.dataset.pageKey, p = +el.dataset.page; if (k && p >= 1) { PAGE_STATE[k] = p; renderAll(); } break; }
  }
}
function handleAct(act, el) {
  const id = el.dataset.id;
  switch (act) {
    case 'view': showDetail(id); break;
    case 'edit': openTxModal(id); break;
    case 'del': askDelete(id); break;
    case 'co': openCoModal(id); break;
    case 'lunas': openLunasModal(id); break;
    case 'add-dp': openDpModal(id); break;
    case 'live-keep': liveSetAll(id, 'keep'); break;
    case 'live-cancel': confirmDialog('Batalkan Transaksi', `Batalkan semua barang untuk ${getTx(id)?.customerName || ''}?`, 'Batalkan', () => liveSetAll(id, 'batal')); break;
    case 'hangus': markHangus(id); break;
  }
}
function wireEvents() {
  // navigation
  $('#nav').addEventListener('click', e => { const n = e.target.closest('.nav-item'); if (n) go(n.dataset.view); });
  $('#hamburger').addEventListener('click', openSidebar);
  $('#backdrop').addEventListener('click', closeSidebar);
  $('#themeToggleSidebar').addEventListener('click', toggleTheme);
  $('#themeToggleTop').addEventListener('click', toggleTheme);

  // cloud sync
  $('#cloudChip').addEventListener('click', cloudSyncNow);
  window.addEventListener('focus', () => { if (CLOUD.available) pullCloud({ silent: true }); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && CLOUD.available) pullCloud({ silent: true }); });

  // global delegated clicks
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action]'); if (a) { handleAction(a.dataset.action, a); }
    const act = e.target.closest('[data-act]'); if (act) { handleAct(act.dataset.act, act); }
    const is = e.target.closest('[data-item-status]'); if (is) { setItemStatus(is.dataset.id, +is.dataset.idx, is.dataset.itemStatus); }
    const kh = e.target.closest('.kg-head'); if (kh && !e.target.closest('button')) { const grp = kh.closest('.keep-group'); const nm = grp.dataset.keepName; if (keepOpen.has(nm)) keepOpen.delete(nm); else keepOpen.add(nm); grp.classList.toggle('open'); }
    const dm = e.target.closest('[data-default-method]'); if (dm) { SETTINGS.defaultMethod = dm.dataset.defaultMethod; saveSettings(); renderSettings(); toast('Metode default: ' + SETTINGS.defaultMethod, 'info'); }
  });

  // transaction form dynamic items
  $('#addItem').addEventListener('click', () => addItemRow());
  $('#fDpAmount').addEventListener('input', recomputeFormTotals);
  $('#itemsWrap').addEventListener('input', e => { if (e.target.classList.contains('item-price')) recomputeFormTotals(); });
  $('#itemsWrap').addEventListener('change', e => { if (e.target.classList.contains('item-status')) recomputeFormTotals(); });
  $('#itemsWrap').addEventListener('click', e => { const rm = e.target.closest('.rm'); if (rm) { rm.closest('.item-row').remove(); recomputeFormTotals(); if (!$$('#itemsWrap .item-row').length) addItemRow(); } });
  $('#saveTx').addEventListener('click', saveTxFromForm);

  // DP modal
  $('#dpCustomer').addEventListener('change', syncDpPreview);
  $('#dpAmount').addEventListener('input', syncDpPreview);
  $('#saveDp').addEventListener('click', saveDp);
  $('#saveLunas').addEventListener('click', saveLunas);
  $('#saveCo').addEventListener('click', saveCo);

  // confirm dialog
  $('#confirmOk').addEventListener('click', () => { closeModal('#modalConfirm'); if (confirmCb) { const c = confirmCb; confirmCb = null; c(); } });

  // filters / search (reset ke halaman 1 saat berubah)
  $('#txSearch').addEventListener('input', () => { resetPage('tx'); renderTransactions(); });
  $('#txStatusFilter').addEventListener('change', () => { resetPage('tx'); renderTransactions(); });
  $('#txDateFilter').addEventListener('change', e => { $('#customRange').hidden = e.target.value !== 'custom'; resetPage('tx'); renderTransactions(); });
  $('#txFrom').addEventListener('change', () => { resetPage('tx'); renderTransactions(); });
  $('#txTo').addEventListener('change', () => { resetPage('tx'); renderTransactions(); });
  $('#custSearch').addEventListener('input', () => { resetPage('cust'); renderCustomers(); });
  $('#liveSearch').addEventListener('input', () => { resetPage('live'); renderLive(); });
  $('#keepSearch').addEventListener('input', () => { resetPage('keep'); renderKeep(); });
  $('#keepStatusFilter').addEventListener('change', () => { resetPage('keep'); renderKeep(); });
  $('#coSearch').addEventListener('input', () => { resetPage('co'); renderCheckout(); });
  $('#coFilter').addEventListener('change', () => { resetPage('co'); renderCheckout(); });

  // file inputs
  $('#importFile').addEventListener('change', e => readFileJSON(e.target, data => ingestTransactions(Array.isArray(data) ? data : data.transactions)));
  $('#restoreFile').addEventListener('change', e => readFileJSON(e.target, restoreFrom));

  // keyboard: Esc closes modal, Ctrl+K search focus
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { const m = $$('.modal:not([hidden])'); if (m.length) closeModal(m[m.length - 1]); }
  });
}

/* =========================================================
   INIT
   ========================================================= */
function init() {
  loadState();
  applyTheme(localStorage.getItem(KEY_THEME) || 'dark');
  tickClock(); setInterval(tickClock, 1000);
  wireEvents();
  go('dashboard');
  updateCloudUI();
  bootstrapCloud();
}
async function bootstrapCloud() {
  await initCloud();
}
document.addEventListener('DOMContentLoaded', init);
