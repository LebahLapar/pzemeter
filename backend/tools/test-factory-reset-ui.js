// =====================================================================
// test-factory-reset-ui.js - UI test (example-based) Factory Reset frontend.
// Menguji interaksi & feedback di frontend/js/app.js dengan jsdom.
// Jalankan: node tools/test-factory-reset-ui.js
//
// Strategi: muat DOM nyata dari frontend/index.html (tanpa <script> CDN/
// socket.io/auth.js), stub global yang dibutuhkan app.js saat load
// (Chart, canvas getContext, window.bootstrap.Modal, fetch, CSRF_TOKEN,
// showLogin), lalu evaluasi app.js di dalam window. Tiap skenario memakai
// environment baru agar state (factoryResetBusy, listener) terisolasi.
//
// Cakupan requirements: 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5,
//                       5.6, 5.7
// =====================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');
const INDEX_HTML = fs.readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf8');
const APP_JS = fs.readFileSync(path.join(FRONTEND_DIR, 'js/app.js'), 'utf8');

const CSRF_TOKEN = 'test-csrf-token-123';

// ---------------------------------------------------------------------
// Test runner sederhana (gaya node + assert, konsisten dengan test-logic.js)
// ---------------------------------------------------------------------
let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log('  \u2713', name);
    passed++;
  } catch (e) {
    console.error('  \u2717', name, '\n     ', e.message);
    failures.push(name);
    process.exitCode = 1;
  }
}

const flush = () => new Promise((r) => setImmediate(r));
async function flushAll(n = 5) {
  for (let i = 0; i < n; i += 1) await flush(); // habiskan microtask + macrotask
}

// ---------------------------------------------------------------------
// Membangun environment jsdom + stub + app.js
//   opts.fetchBehavior: 'success' | 'error500' | '401' | 'timeout' | 'pending'
//   opts.deletedCount: angka untuk skenario success
// Mengembalikan objek dengan window, document, dan perekam interaksi.
// ---------------------------------------------------------------------
function buildEnv(opts) {
  opts = opts || {};

  // Hapus seluruh <script> agar CDN/socket.io/auth.js tidak dieksekusi.
  const html = INDEX_HTML.replace(/<script[\s\S]*?<\/script>/gi, '');

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;

  // --- Rekaman interaksi ---
  const calls = {
    fetch: [],            // semua pemanggilan fetch {url, method, headers}
    modalShow: 0,
    modalHide: 0,
    showLogin: 0,
  };
  let pendingResolve = null; // untuk skenario 'pending'
  const fakeTimers = [];     // callback timeout >= 30000 (skenario timeout)

  // --- Stub canvas getContext (Chart.js butuh ini saat makeChart) ---
  window.HTMLCanvasElement.prototype.getContext = function () {
    return {};
  };

  // --- Stub Chart (dipakai makeChart saat load) ---
  window.Chart = function Chart() {
    return {
      data: { labels: [], datasets: [{ data: [] }, { data: [] }] },
      update() {},
    };
  };

  // --- Stub bootstrap.Modal (Req 5.2) ---
  window.bootstrap = {
    Modal: function Modal() {
      return {
        show() { calls.modalShow += 1; },
        hide() { calls.modalHide += 1; },
      };
    },
  };

  // --- Stub io (tidak dipanggil saat load, hanya pengaman) ---
  window.io = function io() {
    return { on() {}, disconnect() {} };
  };

  // --- CSRF token (diisi auth.js pada produksi) ---
  window.CSRF_TOKEN = CSRF_TOKEN;

  // --- Stub showLogin (handler 401 di apiFetch) ---
  window.showLogin = function showLogin() { calls.showLogin += 1; };

  // --- AbortController: pastikan tersedia di window ---
  if (typeof window.AbortController === 'undefined') {
    window.AbortController = AbortController;
  }

  function makeAbortError() {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    return err;
  }

  function jsonResponse(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    };
  }

  // --- Stub fetch ---
  window.fetch = function fetch(url, options) {
    options = options || {};
    const method = (options.method || 'GET').toUpperCase();
    calls.fetch.push({ url, method, headers: options.headers || {}, signal: options.signal });

    // GET /api/settings dipakai loadSettings() saat sukses reset.
    if (url === '/api/settings') {
      return Promise.resolve(jsonResponse(200, {
        overVoltage: 250, underVoltage: 180, overCurrent: 10, tariffPerKwh: 1444.70,
      }));
    }

    // POST /api/factory-reset
    switch (opts.fetchBehavior) {
      case 'success':
        return Promise.resolve(jsonResponse(200, {
          ok: true, deletedCount: opts.deletedCount != null ? opts.deletedCount : 7,
        }));
      case 'error500':
        return Promise.resolve(jsonResponse(500, { error: 'server error' }));
      case '401':
        return Promise.resolve(jsonResponse(401, { error: 'unauthorized' }));
      case 'pending':
        return new Promise((resolve) => { pendingResolve = resolve; });
      case 'timeout':
        // Tidak pernah resolve; hanya reject ketika signal di-abort.
        return new Promise((_resolve, reject) => {
          const signal = options.signal;
          if (signal) {
            if (signal.aborted) { reject(makeAbortError()); return; }
            signal.addEventListener('abort', () => reject(makeAbortError()));
          }
        });
      default:
        return Promise.resolve(jsonResponse(200, { ok: true, deletedCount: 0 }));
    }
  };

  // --- Fake timer khusus skenario timeout (Req 4.6) ---
  if (opts.fetchBehavior === 'timeout') {
    window.setTimeout = function (cb, delay) {
      if (delay >= 30000) {
        fakeTimers.push(cb);
        return fakeTimers.length; // id dummy
      }
      return 0;
    };
    window.clearTimeout = function () {};
  }

  // --- Evaluasi app.js di dalam window ---
  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = APP_JS;
  window.document.body.appendChild(scriptEl);

  return {
    dom,
    window,
    document: window.document,
    calls,
    resolvePending: (status, body) => {
      if (pendingResolve) pendingResolve(jsonResponse(status, body));
    },
    fireTimeout: () => { fakeTimers.forEach((cb) => cb()); },
    frFetchCount: () => calls.fetch.filter((c) => c.url === '/api/factory-reset').length,
  };
}

function el(env, id) { return env.document.getElementById(id); }

// =====================================================================
// SKENARIO
// =====================================================================
(async function run() {
  console.log('TEST: Factory Reset UI (app.js)');

  // ---- Req 5.1: kartu menampilkan ikon, teks, tombol merah ----
  await check('5.1 kartu menampilkan ikon peringatan, teks deskriptif, tombol merah', () => {
    const env = buildEnv();
    const card = env.document.querySelector('.danger-zone');
    assert.ok(card, 'kartu .danger-zone harus ada');
    assert.ok(card.textContent.includes('\u26A0'), 'harus ada ikon peringatan \u26A0');

    const text = card.querySelector('.danger-text').textContent.toLowerCase();
    assert.ok(text.includes('default'), 'teks menyebut reset ke default');
    assert.ok(text.includes('hapus') && text.includes('data energi'), 'teks menyebut hapus data energi');
    assert.ok(text.includes('tidak dapat dibatalkan'), 'teks menyebut tidak dapat dibatalkan');

    const btn = el(env, 'factory-reset-btn');
    assert.ok(btn, 'tombol factory-reset-btn harus ada');
    assert.ok(btn.classList.contains('btn-danger'), 'tombol harus merah (btn-danger)');
    assert.strictEqual(btn.textContent.trim(), 'Factory Reset');
  });

  // ---- Req 5.2: klik tombol -> modal tampil, tanpa request ----
  await check('5.2 klik tombol membuka modal tanpa mengirim request', async () => {
    const env = buildEnv({ fetchBehavior: 'success' });
    el(env, 'factory-reset-btn').click();
    await flushAll();
    assert.strictEqual(env.calls.modalShow, 1, 'modal.show harus dipanggil sekali');
    assert.strictEqual(env.frFetchCount(), 0, 'tidak ada request factory-reset sebelum konfirmasi');
  });

  // ---- Req 5.3: konfirmasi -> POST dengan header CSRF ----
  await check('5.3 konfirmasi mengirim POST dengan header X-CSRF-Token', async () => {
    const env = buildEnv({ fetchBehavior: 'success' });
    el(env, 'factory-reset-confirm').click();
    await flushAll();
    const frCalls = env.calls.fetch.filter((c) => c.url === '/api/factory-reset');
    assert.strictEqual(frCalls.length, 1, 'tepat satu request factory-reset');
    assert.strictEqual(frCalls[0].method, 'POST', 'metode harus POST');
    assert.strictEqual(frCalls[0].headers['X-CSRF-Token'], CSRF_TOKEN, 'header CSRF harus disertakan');
    assert.strictEqual(env.calls.modalHide, 1, 'modal.hide dipanggil saat konfirmasi');
  });

  // ---- Req 5.4: batal/dismiss -> tanpa request ----
  await check('5.4 klik tombol Batal tidak mengirim request', async () => {
    const env = buildEnv({ fetchBehavior: 'success' });
    const cancelBtn = env.document.querySelector('#factory-reset-modal .btn-secondary[data-bs-dismiss="modal"]');
    assert.ok(cancelBtn, 'tombol Batal harus ada');
    cancelBtn.click();
    await flushAll();
    assert.strictEqual(env.frFetchCount(), 0, 'batal tidak mengirim request');
  });

  // ---- Req 5.5: double-click saat pending -> satu request ----
  await check('5.5 double submit saat pending hanya mengirim satu request', async () => {
    const env = buildEnv({ fetchBehavior: 'pending' });
    const p1 = env.window.runFactoryReset();
    const p2 = env.window.runFactoryReset(); // harus early-return (guard busy)
    await flushAll(2);
    assert.strictEqual(env.frFetchCount(), 1, 'hanya satu request meski dipanggil dua kali');
    env.resolvePending(200, { ok: true, deletedCount: 1 });
    await Promise.all([p1, p2]);
    await flushAll();
  });

  // ---- Req 4.3 / 5.6: 200 -> sukses + refresh settings ----
  await check('4.3/5.6 respons 200 menampilkan sukses dan me-refresh settings', async () => {
    const env = buildEnv({ fetchBehavior: 'success', deletedCount: 42 });
    el(env, 'factory-reset-confirm').click();
    await flushAll();
    const alertEl = el(env, 'factory-reset-alert');
    assert.ok(alertEl.classList.contains('alert-success'), 'alert sukses harus tampil');
    assert.ok(alertEl.textContent.includes('42'), 'pesan menyertakan deletedCount');
    assert.strictEqual(alertEl.style.display, 'block', 'alert terlihat');
    // refresh: loadSettings memanggil GET /api/settings
    const getSettings = env.calls.fetch.filter((c) => c.url === '/api/settings' && c.method === 'GET');
    assert.strictEqual(getSettings.length, 1, 'settings di-refresh via GET /api/settings');
  });

  // ---- Req 4.4 / 5.7: 500 -> error + tombol re-enable ----
  await check('4.4/5.7 respons 500 menampilkan error dan meng-enable kembali tombol', async () => {
    const env = buildEnv({ fetchBehavior: 'error500' });
    const btn = el(env, 'factory-reset-btn');
    const confirmBtn = el(env, 'factory-reset-confirm');
    confirmBtn.click();
    await flushAll();
    const alertEl = el(env, 'factory-reset-alert');
    assert.ok(alertEl.classList.contains('alert-danger'), 'alert error harus tampil');
    assert.strictEqual(btn.disabled, false, 'tombol di-enable kembali (retry)');
    assert.strictEqual(confirmBtn.disabled, false, 'tombol konfirmasi di-enable kembali');
  });

  // ---- Req 4.6 / 5.7: timeout 30s -> error + re-enable ----
  await check('4.6/5.7 timeout 30 detik menampilkan error dan meng-enable kembali tombol', async () => {
    const env = buildEnv({ fetchBehavior: 'timeout' });
    const btn = el(env, 'factory-reset-btn');
    const p = env.window.runFactoryReset();
    await flushAll(2);
    // request terkirim namun belum ada respons
    assert.strictEqual(env.frFetchCount(), 1, 'request terkirim');
    assert.strictEqual(btn.disabled, true, 'tombol disable selama menunggu');
    // simulasikan 30 detik berlalu -> AbortController.abort()
    env.fireTimeout();
    await p;
    await flushAll();
    const alertEl = el(env, 'factory-reset-alert');
    assert.ok(alertEl.classList.contains('alert-danger'), 'alert error timeout harus tampil');
    assert.strictEqual(btn.disabled, false, 'tombol di-enable kembali setelah timeout');
  });

  // ---- Req 4.5: 401 -> redirect login (via apiFetch) ----
  await check('4.5 respons 401 memicu redirect login dan tidak menampilkan error reset', async () => {
    const env = buildEnv({ fetchBehavior: '401' });
    const btn = el(env, 'factory-reset-btn');
    await env.window.runFactoryReset();
    await flushAll();
    assert.strictEqual(env.calls.showLogin, 1, 'showLogin dipanggil (redirect login)');
    const alertEl = el(env, 'factory-reset-alert');
    assert.ok(!alertEl.classList.contains('alert-danger'), 'tidak menampilkan error reset pada 401');
    assert.strictEqual(btn.disabled, false, 'tombol di-enable kembali di finally');
  });

  console.log('\nSelesai. ' + passed + ' test lolos.'
    + (failures.length ? ' ' + failures.length + ' gagal: ' + failures.join(', ') : ''));
})();
