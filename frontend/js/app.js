// =====================================================================
// app.js - Dashboard PZEMETER (layout sidebar SPA)
// Fitur: navigasi halaman, realtime Socket.IO, 2 chart, status sistem,
//        estimasi biaya, form pengaturan (threshold & tarif).
// =====================================================================
const MAX_POINTS = 60;

let settings = {
  overVoltage: 250, underVoltage: 180, overCurrent: 10, tariffPerKwh: 1444.70,
};
let lastReading = null;

const rupiah = (n) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const timeLabel = (d) => new Date(d).toLocaleTimeString('id-ID', { hour12: false });

// ---------- Navigasi SPA ----------
function showPage(page) {
  document.querySelectorAll('.page-section').forEach((s) => s.classList.remove('active'));
  const sec = document.getElementById(page + '-section');
  if (sec) sec.classList.add('active');
  document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
  const link = document.querySelector('.nav-link[data-page="' + page + '"]');
  if (link) link.classList.add('active');
  // tutup sidebar di mobile
  document.getElementById('sidebar').classList.remove('open');
}

document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    showPage(link.dataset.page);
  });
});
document.getElementById('menu-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ---------- Chart factory ----------
function makeChart(canvasId, height) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Daya (W)', data: [], borderColor: '#2563eb',
          backgroundColor: 'rgba(37,99,235,0.12)', fill: true, tension: 0.3, yAxisID: 'y' },
        { label: 'Tegangan (V)', data: [], borderColor: '#0d2b5e',
          backgroundColor: 'rgba(13,43,94,0.08)', tension: 0.3, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        y:  { type: 'linear', position: 'left',  title: { display: true, text: 'W' } },
        y1: { type: 'linear', position: 'right', title: { display: true, text: 'V' },
              grid: { drawOnChartArea: false } },
      },
    },
  });
}

const chartMini = makeChart('chart-mini');
const chartFull = makeChart('chart-full');

function pushPoint(r) {
  [chartMini, chartFull].forEach((c) => {
    c.data.labels.push(timeLabel(r.createdAt));
    c.data.datasets[0].data.push(r.power);
    c.data.datasets[1].data.push(r.voltage);
    if (c.data.labels.length > MAX_POINTS) {
      c.data.labels.shift();
      c.data.datasets[0].data.shift();
      c.data.datasets[1].data.shift();
    }
    c.update('none');
  });
}

// ---------- Update tampilan ----------
function setDot(id, cls) {
  const el = document.getElementById(id);
  if (el) el.className = 'status-dot ' + cls;
}

function updateUI(r) {
  lastReading = r;

  // metrik
  document.getElementById('m-voltage').innerHTML = r.voltage.toFixed(1) + '<span class="unit">V</span>';
  document.getElementById('m-current').innerHTML = r.current.toFixed(3) + '<span class="unit">A</span>';
  document.getElementById('m-power').innerHTML   = r.power.toFixed(1) + '<span class="unit">W</span>';
  document.getElementById('m-energy').innerHTML  = r.energy.toFixed(3) + '<span class="unit">kWh</span>';
  document.getElementById('m-freq').innerHTML    = r.frequency.toFixed(1) + '<span class="unit">Hz</span>';
  document.getElementById('m-pf').textContent    = r.pf.toFixed(2);

  // estimasi biaya
  const kw = r.power / 1000;
  const t = settings.tariffPerKwh;
  document.getElementById('c-hour').textContent  = rupiah(kw * 1 * t);
  document.getElementById('c-day').textContent   = rupiah(kw * 24 * t);
  document.getElementById('c-month').textContent = rupiah(kw * 24 * 30 * t);
  document.getElementById('b-tariff').textContent = rupiah(t) + '/kWh';
  document.getElementById('b-power').textContent  = r.power.toFixed(1) + ' W';
  document.getElementById('b-energy').textContent = r.energy.toFixed(3) + ' kWh';

  // status sistem (threshold-based)
  setDot('st-conn-dot', 'status-active');
  document.getElementById('st-conn').textContent = 'Online';

  let vState = 'OK', vDot = 'status-active';
  if (r.voltage > settings.overVoltage) { vState = 'TINGGI'; vDot = 'status-warning'; }
  else if (r.voltage < settings.underVoltage) { vState = 'RENDAH'; vDot = 'status-warning'; }
  setDot('st-volt-dot', vDot);
  document.getElementById('st-volt').textContent = vState;

  let cState = 'OK', cDot = 'status-active';
  if (r.current > settings.overCurrent) { cState = 'OVER'; cDot = 'status-danger'; }
  setDot('st-curr-dot', cDot);
  document.getElementById('st-curr').textContent = cState;

  document.getElementById('st-energy').textContent = r.energy.toFixed(3) + ' kWh';

  // timestamp
  const ts = 'Update: ' + new Date(r.createdAt).toLocaleTimeString('id-ID');
  document.getElementById('ts-dashboard').textContent = ts;
  document.getElementById('ts-biaya').textContent = ts;
  document.getElementById('last-update').textContent =
    'Update terakhir: ' + new Date(r.createdAt).toLocaleString('id-ID');
}

// ---------- Helper fetch terautentikasi (Req 7.3, 9.4) ----------
// Menyertakan cookie sesi (same-origin) dan, untuk metode yang mengubah
// state (POST/PUT/DELETE/PATCH), header X-CSRF-Token dari window.CSRF_TOKEN
// yang diisi oleh auth.js. Bila respons 401, arahkan kembali ke login lewat
// window.showLogin() (diekspor auth.js) lalu lempar error agar caller berhenti.
const CSRF_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];

async function apiFetch(url, options) {
  const opts = options || {};
  const method = (opts.method || 'GET').toUpperCase();
  const headers = Object.assign({}, opts.headers);

  if (CSRF_METHODS.indexOf(method) !== -1) {
    headers['X-CSRF-Token'] = window.CSRF_TOKEN || '';
  }

  const res = await fetch(url, Object.assign({}, opts, {
    method: method,
    headers: headers,
    credentials: 'same-origin',
  }));

  if (res.status === 401) {
    // Sesi habis/tidak valid -> kembali ke login (Req 9.4).
    if (typeof window.onAuthLost === 'function') window.onAuthLost();
    if (typeof window.showLogin === 'function') window.showLogin();
    throw new Error('unauthorized');
  }

  return res;
}

// ---------- Muat data awal ----------
async function loadSettings() {
  try {
    const res = await apiFetch('/api/settings');
    if (res.ok) {
      settings = await res.json();
      // isi form
      document.getElementById('overVoltage').value  = settings.overVoltage;
      document.getElementById('underVoltage').value = settings.underVoltage;
      document.getElementById('overCurrent').value  = settings.overCurrent;
      document.getElementById('tariffPerKwh').value = settings.tariffPerKwh;
    }
  } catch (e) { console.error('gagal load settings:', e); }
}

async function loadHistory() {
  try {
    const res = await apiFetch('/api/history?limit=' + MAX_POINTS);
    if (!res.ok) return;
    const rows = await res.json();
    rows.forEach((r) => pushPoint(r));
    if (rows.length) updateUI(rows[rows.length - 1]);
  } catch (e) { console.error('gagal load history:', e); }
}

// ---------- Simpan pengaturan ----------
document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const alertEl = document.getElementById('settings-alert');
  const payload = {
    overVoltage:  parseFloat(document.getElementById('overVoltage').value),
    underVoltage: parseFloat(document.getElementById('underVoltage').value),
    overCurrent:  parseFloat(document.getElementById('overCurrent').value),
    tariffPerKwh: parseFloat(document.getElementById('tariffPerKwh').value),
  };
  try {
    const res = await apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      settings = data;
      alertEl.className = 'alert alert-success';
      alertEl.textContent = 'Pengaturan tersimpan.';
      if (lastReading) updateUI(lastReading); // refresh estimasi & status
    } else {
      alertEl.className = 'alert alert-danger';
      alertEl.textContent = 'Gagal: ' + (data.error || 'unknown');
    }
  } catch (err) {
    alertEl.className = 'alert alert-danger';
    alertEl.textContent = 'Error koneksi.';
  }
  alertEl.style.display = 'block';
  setTimeout(() => { alertEl.style.display = 'none'; }, 4000);
});

// ---------- Factory Reset (tab Pengaturan) ----------
// Wiring tombol/modal ada di bagian bawah setelah runFactoryReset (Task 7.2).
let factoryResetBusy = false; // guard double-submit (Req 5.5)

function showFactoryResetAlert(cls, msg) {
  const el = document.getElementById('factory-reset-alert');
  if (!el) return;
  el.className = 'alert ' + cls;
  el.textContent = msg;
  el.style.display = 'block';
}

async function runFactoryReset() {
  if (factoryResetBusy) return; // cegah eksekusi destruktif ganda (Req 5.5)
  factoryResetBusy = true;
  const btn = document.getElementById('factory-reset-btn');
  const confirmBtn = document.getElementById('factory-reset-confirm');
  if (btn) btn.disabled = true;
  if (confirmBtn) confirmBtn.disabled = true;

  // Timeout 30 detik (Req 4.6, 5.7) via AbortController.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);

  try {
    const res = await apiFetch('/api/factory-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      // Refresh settings ke default + perbarui UI (Req 4.3, 5.6).
      settings = { overVoltage: 250, underVoltage: 180, overCurrent: 10, tariffPerKwh: 1444.70 };
      await loadSettings();              // sinkron dari server
      if (lastReading) updateUI(lastReading);
      showFactoryResetAlert('alert-success',
        'Factory reset berhasil. ' + (data.deletedCount || 0) + ' data energi dihapus.');
    } else {
      // Gagal: pertahankan view, tampilkan pesan error (Req 4.4, 5.7).
      showFactoryResetAlert('alert-danger', 'Factory reset gagal. Coba lagi.');
    }
  } catch (err) {
    // 401 sudah ditangani apiFetch (redirect login, Req 4.5).
    if (err && err.message === 'unauthorized') return;
    // abort (timeout) atau error koneksi (Req 4.6, 5.7).
    showFactoryResetAlert('alert-danger',
      'Factory reset tidak selesai (timeout/koneksi). Silakan coba lagi.');
  } finally {
    clearTimeout(timer);
    factoryResetBusy = false;
    if (btn) btn.disabled = false;       // re-enable agar bisa retry (Req 5.7)
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

// Wiring tombol & modal Factory Reset (Req 5.2, 5.3, 5.4).
// Init bootstrap.Modal sekali; klik tombol membuka modal tanpa request;
// konfirmasi menutup modal lalu menjalankan reset; Batal/dismiss ditangani
// data-bs-dismiss di HTML (tidak perlu JS).
const frModalEl = document.getElementById('factory-reset-modal');
const frModal = (frModalEl && window.bootstrap) ? new bootstrap.Modal(frModalEl) : null;

const factoryResetBtn = document.getElementById('factory-reset-btn');
if (factoryResetBtn) {
  factoryResetBtn.addEventListener('click', () => {
    if (frModal) frModal.show(); // Req 5.2: tidak ada request sebelum konfirmasi
  });
}

const factoryResetConfirmBtn = document.getElementById('factory-reset-confirm');
if (factoryResetConfirmBtn) {
  factoryResetConfirmBtn.addEventListener('click', async () => {
    if (frModal) frModal.hide();
    await runFactoryReset(); // Req 5.3
  });
}

// ---------- Socket.IO realtime ----------
// socket dibuat di dalam initDashboard (setelah autentikasi), bukan saat load.
let socket = null;
const connDot = document.getElementById('conn-dot');
const connText = document.getElementById('conn-text');

function setupSocket() {
  if (socket) return; // hindari koneksi ganda
  socket = io();

  socket.on('connect', () => {
    connDot.className = 'conn-dot online';
    connText.textContent = 'Terhubung';
  });
  socket.on('disconnect', () => {
    connDot.className = 'conn-dot offline';
    connText.textContent = 'Terputus';
    setDot('st-conn-dot', 'status-danger');
    document.getElementById('st-conn').textContent = 'Offline';
  });
  socket.on('reading', (r) => {
    updateUI(r);
    pushPoint(r);
  });
}

// ---------- Init dashboard (dipanggil auth.js setelah terautentikasi) ----------
// Kontrak Task 11: app.js TIDAK auto-init saat load. auth.js memanggil
// window.initDashboard() hanya setelah sesi terautentikasi (Req 9.2).
let dashboardInitialized = false;

window.initDashboard = function initDashboard() {
  if (dashboardInitialized) return; // guard double-init
  dashboardInitialized = true;
  setupSocket();
  loadSettings();
  loadHistory();
};

// ---------- Bersihkan saat sesi hilang/logout ----------
// Dipanggil auth.js saat logout/401 untuk memutus socket & reset UI koneksi.
window.onAuthLost = function onAuthLost() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  dashboardInitialized = false;
  if (connDot) connDot.className = 'conn-dot offline';
  if (connText) connText.textContent = 'Terputus';
};
