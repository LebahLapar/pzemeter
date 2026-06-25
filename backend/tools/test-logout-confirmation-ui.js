// =====================================================================
// test-logout-confirmation-ui.js - UI test (example-based) Dialog
// Konfirmasi Logout frontend. Menguji interaksi & wiring di
// frontend/js/auth.js dengan jsdom.
// Jalankan: node backend/tools/test-logout-confirmation-ui.js
//
// Strategi (mirror test-factory-reset-ui.js): muat DOM nyata dari
// frontend/index.html (tanpa <script> CDN/socket.io/app.js/auth.js),
// stub global yang dibutuhkan auth.js saat load (window.bootstrap.Modal,
// fetch, CSRF_TOKEN, showLogin), lalu evaluasi auth.js di dalam window.
// Tiap skenario memakai environment baru agar state (logoutBusy,
// listener) terisolasi.
//
// File ini berisi HARNESS (Task 4.1): pembangun environment, stub fetch,
// stub bootstrap.Modal, helper flushAll, dan runner sederhana. Skenario
// uji (Property 1-5 + markup) ditambahkan pada Task 4.2-4.7.
//
// Cakupan requirements harness: 2.1, 2.3, 2.4
// =====================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');
const INDEX_HTML = fs.readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf8');
const AUTH_JS = fs.readFileSync(path.join(FRONTEND_DIR, 'js/auth.js'), 'utf8');

const CSRF_TOKEN = 'test-csrf-token-123';

// ---------------------------------------------------------------------
// Test runner sederhana (gaya node + assert, konsisten dengan
// test-factory-reset-ui.js).
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
// Membangun environment jsdom + stub + auth.js.
//   opts.logoutBehavior: 'success' | 'error' | 'reject' | 'pending'
//     - 'success' : POST /api/auth/logout -> 200 OK (default)
//     - 'error'   : POST /api/auth/logout -> 500 (fetch tetap resolve)
//     - 'reject'  : POST /api/auth/logout -> Promise.reject (jaringan gagal)
//     - 'pending' : POST /api/auth/logout -> Promise yang belum settle
//
// auth.js memanggil GET /api/auth/me saat load (bootstrap()), jadi stub
// fetch mengembalikan sesi terautentikasi untuk endpoint itu agar
// window.CSRF_TOKEN terisi dan #app-view tampil.
//
// Mengembalikan objek dengan window, document, perekam interaksi, dan
// helper untuk menyelesaikan request 'pending'.
// ---------------------------------------------------------------------
function buildEnv(opts) {
  opts = opts || {};
  const behavior = opts.logoutBehavior || 'success';

  // Hapus seluruh <script> agar CDN/socket.io/app.js/auth.js asli tidak
  // dieksekusi; auth.js dievaluasi manual di bawah.
  const html = INDEX_HTML.replace(/<script[\s\S]*?<\/script>/gi, '');

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;

  // --- Rekaman interaksi ---
  const calls = {
    fetch: [],     // semua pemanggilan fetch {url, method, headers}
    modalShow: 0,
    modalHide: 0,
    showLogin: 0,
  };
  let pendingResolve = null; // resolver untuk skenario 'pending'

  // --- Stub bootstrap.Modal (rekam show/hide) (Req 5.1) ---
  window.bootstrap = {
    Modal: function Modal() {
      return {
        show() { calls.modalShow += 1; },
        hide() { calls.modalHide += 1; },
      };
    },
  };

  // --- Stub io (pengaman; tidak dipanggil auth.js) ---
  window.io = function io() {
    return { on() {}, disconnect() {} };
  };

  // --- CSRF token awal (akan ditimpa oleh respons /api/auth/me) ---
  window.CSRF_TOKEN = CSRF_TOKEN;

  // --- Stub showLogin: auth.js mengekspor window.showLogin sendiri,
  // namun kita bungkus agar pemanggilan terekam. Pembungkusan dilakukan
  // SETELAH auth.js dievaluasi (lihat di bawah) agar tidak tertimpa.

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
    calls.fetch.push({ url, method, headers: options.headers || {} });

    // GET /api/auth/me dipanggil bootstrap() saat load -> sesi aktif.
    if (url === '/api/auth/me') {
      return Promise.resolve(jsonResponse(200, {
        authenticated: true,
        csrfToken: CSRF_TOKEN,
      }));
    }

    // POST /api/auth/logout
    if (url === '/api/auth/logout') {
      switch (behavior) {
        case 'success':
          return Promise.resolve(jsonResponse(200, { ok: true }));
        case 'error':
          // fetch tidak reject untuk status non-OK; jalur .then() tetap jalan.
          return Promise.resolve(jsonResponse(500, { error: 'server error' }));
        case 'reject':
          return Promise.reject(new Error('network down'));
        case 'pending':
          return new Promise((resolve) => { pendingResolve = resolve; });
        default:
          return Promise.resolve(jsonResponse(200, { ok: true }));
      }
    }

    // Default aman untuk endpoint lain yang tak terduga.
    return Promise.resolve(jsonResponse(200, {}));
  };

  // --- Evaluasi auth.js di dalam window ---
  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = AUTH_JS;
  window.document.body.appendChild(scriptEl);

  // --- Perekaman showLogin via efek DOM yang teramati ---
  // performLogout() di auth.js memanggil fungsi internal showLogin() (bare
  // call dari dalam IIFE), BUKAN window.showLogin, sehingga membungkus
  // window.showLogin tidak akan menangkap pemanggilan tersebut. showLogin()
  // menampilkan login view dengan menyetel #login-view ke display:'flex'
  // (dan menyembunyikan #app-view). Kita deteksi efek teramati ini agar
  // calls.showLogin merefleksikan apakah pengguna sudah dikembalikan ke
  // login (>=1) atau belum (0). Tidak menyentuh sumber auth.js.
  Object.defineProperty(calls, 'showLogin', {
    configurable: true,
    enumerable: true,
    get() {
      const loginView = window.document.getElementById('login-view');
      return loginView && loginView.style.display === 'flex' ? 1 : 0;
    },
  });

  return {
    dom,
    window,
    document: window.document,
    calls,
    // Selesaikan request logout yang 'pending' (untuk Property 5).
    resolvePending: (status, body) => {
      if (pendingResolve) pendingResolve(jsonResponse(status, body));
    },
    // Jumlah request POST /api/auth/logout yang terkirim.
    logoutFetchCount: () => calls.fetch.filter(
      (c) => c.url === '/api/auth/logout' && c.method === 'POST',
    ).length,
    // Pemanggilan logout terakhir (untuk memeriksa header CSRF).
    lastLogoutCall: () => calls.fetch
      .filter((c) => c.url === '/api/auth/logout' && c.method === 'POST')
      .slice(-1)[0],
  };
}

function el(env, id) { return env.document.getElementById(id); }

// =====================================================================
// SKENARIO
// Skenario uji ditambahkan pada Task 4.2-4.7. Harness (Task 4.1) hanya
// menjalankan smoke check bahwa environment dapat dibangun tanpa error.
// =====================================================================
(async function run() {
  console.log('TEST: Dialog Konfirmasi Logout UI (auth.js)');

  // ---- Smoke harness: environment dapat dibangun & auth.js termuat ----
  await check('harness: environment terbangun, auth.js termuat & sesi /me terambil', async () => {
    const env = buildEnv({ logoutBehavior: 'pending' });
    await flushAll();
    // bootstrap() memanggil GET /api/auth/me sekali saat load.
    const meCalls = env.calls.fetch.filter((c) => c.url === '/api/auth/me');
    assert.strictEqual(meCalls.length, 1, 'GET /api/auth/me dipanggil sekali saat load');
    // Elemen kunci tersedia untuk skenario berikutnya.
    assert.ok(el(env, 'logout-btn'), 'tombol #logout-btn harus ada');
    assert.ok(el(env, 'logout-confirm-modal'), 'modal #logout-confirm-modal harus ada');
    assert.ok(el(env, 'logout-confirm'), 'tombol #logout-confirm harus ada');
    // Belum ada request logout sebelum interaksi apa pun.
    assert.strictEqual(env.logoutFetchCount(), 0, 'belum ada request logout saat load');
  });

  // ---- Property 1: Tidak ada logout sebelum konfirmasi (Req 1.1, 1.3) ----
  // Validates: Requirements 1.1, 1.3
  await check('P1: klik #logout-btn hanya menampilkan modal, TIDAK logout', async () => {
    const env = buildEnv({ logoutBehavior: 'success' });
    await flushAll(); // selesaikan bootstrap() / GET /api/auth/me

    // Pra-kondisi: token sesi terisi, belum ada interaksi logout.
    assert.strictEqual(env.window.CSRF_TOKEN, CSRF_TOKEN, 'token sesi terisi setelah /me');
    assert.strictEqual(env.calls.modalShow, 0, 'modal belum ditampilkan sebelum klik');

    // Aksi: klik tombol logout (dispatch event click di jsdom).
    el(env, 'logout-btn').dispatchEvent(new env.window.Event('click'));
    await flushAll();

    // Modal konfirmasi ditampilkan tepat sekali.
    assert.strictEqual(env.calls.modalShow, 1, 'logoutModal.show() dipanggil sekali');
    // Tidak ada request logout sebelum konfirmasi.
    assert.strictEqual(env.logoutFetchCount(), 0, 'tidak ada POST /api/auth/logout sebelum konfirmasi');
    // showLogin tidak terpanggil (sesi dipertahankan).
    assert.strictEqual(env.calls.showLogin, 0, 'showLogin tidak terpanggil sebelum konfirmasi');
    // Token sesi tidak berubah.
    assert.strictEqual(env.window.CSRF_TOKEN, CSRF_TOKEN, 'window.CSRF_TOKEN tidak berubah sebelum konfirmasi');
  });

  // ---- Property 2: Konfirmasi kirim 1 request + CSRF + tutup modal (Req 2.1, 2.2) ----
  // Validates: Requirements 2.1, 2.2
  await check('P2: klik #logout-confirm kirim tepat satu POST logout dengan X-CSRF-Token & tutup modal', async () => {
    const env = buildEnv({ logoutBehavior: 'pending' });
    await flushAll(); // selesaikan bootstrap() / GET /api/auth/me

    // Token sesi aktif yang akan dipakai sebagai header X-CSRF-Token.
    const token = env.window.CSRF_TOKEN;
    assert.ok(token, 'token sesi terisi setelah /me');

    // Aksi: klik tombol konfirmasi (respons logout dibuat pending).
    el(env, 'logout-confirm').dispatchEvent(new env.window.Event('click'));
    await flushAll();

    // Tepat satu POST /api/auth/logout terkirim.
    assert.strictEqual(env.logoutFetchCount(), 1, 'tepat satu POST /api/auth/logout');
    // Header X-CSRF-Token sama dengan window.CSRF_TOKEN saat itu.
    const lastCall = env.lastLogoutCall();
    assert.ok(lastCall, 'ada pemanggilan POST /api/auth/logout');
    assert.strictEqual(
      lastCall.headers['X-CSRF-Token'], token,
      'header X-CSRF-Token sama dengan window.CSRF_TOKEN',
    );
    // Modal ditutup sekali meski respons belum datang (request masih pending).
    assert.strictEqual(env.calls.modalHide, 1, 'logoutModal.hide() dipanggil sekali tanpa menunggu respons');
  });

  // ---- Property 3: Semua jalur pembatalan tidak mengeluarkan pengguna (Req 3.3, 3.4, 5.4) ----
  // Validates: Requirements 3.3, 3.4, 5.4
  await check('P3: klik tombol Batal (data-bs-dismiss) TIDAK memicu logout', async () => {
    const env = buildEnv({ logoutBehavior: 'success' });
    await flushAll(); // selesaikan bootstrap() / GET /api/auth/me

    // Pra-kondisi: token sesi terisi setelah /me, belum ada interaksi logout.
    const token = env.window.CSRF_TOKEN;
    assert.ok(token, 'token sesi terisi setelah /me');
    assert.strictEqual(env.logoutFetchCount(), 0, 'belum ada request logout sebelum aksi');

    // Aksi: klik tombol Batal di dalam modal. Batal memakai native Bootstrap
    // data-bs-dismiss (tanpa listener JS kustom), jadi tidak ada efek samping
    // logout yang boleh terjadi.
    const cancelBtn = el(env, 'logout-confirm-modal')
      .querySelector('.btn-secondary[data-bs-dismiss="modal"]');
    assert.ok(cancelBtn, 'tombol Batal .btn-secondary[data-bs-dismiss] harus ada');
    cancelBtn.dispatchEvent(new env.window.Event('click'));
    await flushAll();

    // Tidak ada request logout: jalur dismissal tidak terhubung ke performLogout.
    assert.strictEqual(env.logoutFetchCount(), 0, 'tidak ada POST /api/auth/logout setelah klik Batal');
    // showLogin tidak terpanggil: sesi dipertahankan.
    assert.strictEqual(env.calls.showLogin, 0, 'showLogin tidak terpanggil setelah klik Batal');
    // Token sesi tidak berubah (masih sama dengan token setelah /me).
    assert.strictEqual(env.window.CSRF_TOKEN, token, 'window.CSRF_TOKEN tidak berubah setelah klik Batal');
  });

  // ---- Property 4: Aktivasi konfirmasi ganda tetap satu request (Req 4.1, 4.2) ----
  // Validates: Requirements 4.1, 4.2
  await check('P4: dua klik #logout-confirm saat pending hanya kirim satu request & tombol disabled', async () => {
    const env = buildEnv({ logoutBehavior: 'pending' });
    await flushAll(); // selesaikan bootstrap() / GET /api/auth/me

    const confirmBtn = el(env, 'logout-confirm');
    assert.ok(confirmBtn, 'tombol #logout-confirm harus ada');

    // Aksi: klik konfirmasi dua kali. Request logout dibuat pending sehingga
    // logout pertama masih berlangsung saat klik kedua tiba.
    confirmBtn.dispatchEvent(new env.window.Event('click'));
    await flushAll();
    confirmBtn.dispatchEvent(new env.window.Event('click'));
    await flushAll();

    // Guard double-submit: tepat satu POST /api/auth/logout meski diklik dua kali.
    assert.strictEqual(env.logoutFetchCount(), 1, 'hanya satu POST /api/auth/logout meski dua kali klik');
    // Tombol konfirmasi disabled selama request masih pending (belum settle).
    assert.strictEqual(confirmBtn.disabled, true, 'tombol konfirmasi disabled selama logout berlangsung');
  });

  // ---- Property 5: Penyelesaian logout selalu kembali ke login (Req 2.3, 2.4) ----
  // Validates: Requirements 2.3, 2.4
  // Tiga kasus hasil fetch logout: sukses (2xx), error (4xx/5xx), dan reject
  // (jaringan gagal). Untuk SETIAP kasus, penyelesaian logout harus mengosongkan
  // window.CSRF_TOKEN (falsy) dan memanggil showLogin -> kembali ke login.
  const property5Cases = [
    { behavior: 'success', label: 'sukses (2xx)' },
    { behavior: 'error', label: 'error (4xx/5xx)' },
    { behavior: 'reject', label: 'reject (jaringan gagal)' },
  ];
  for (const c of property5Cases) {
    await check('P5: penyelesaian logout (' + c.label + ') mengosongkan CSRF_TOKEN & kembali ke login', async () => {
      const env = buildEnv({ logoutBehavior: c.behavior });
      await flushAll(); // selesaikan bootstrap() / GET /api/auth/me

      // Pra-kondisi: token sesi terisi setelah /me.
      assert.ok(env.window.CSRF_TOKEN, 'token sesi terisi setelah /me');

      // Aksi: klik tombol konfirmasi, lalu habiskan rantai promise fetch
      // (.then/.catch/.finally) dengan flushAll.
      el(env, 'logout-confirm').dispatchEvent(new env.window.Event('click'));
      await flushAll();

      // Apa pun hasil request, sesi sisi klien diakhiri:
      assert.ok(!env.window.CSRF_TOKEN, 'window.CSRF_TOKEN falsy setelah logout settle');
      assert.ok(env.calls.showLogin >= 1, 'showLogin terpanggil minimal sekali setelah logout settle');
    });
  }

  // ---- Markup & aksesibilitas modal (Req 1.4, 5.1, 5.2, 5.5) ----
  // Validates: Requirements 1.4, 5.1, 5.2, 5.5
  await check('Markup & aksesibilitas: struktur modal Bootstrap, judul Indonesia, btn-close aria-label, Batal dismiss, konfirmasi btn-primary (bukan btn-danger)', async () => {
    const env = buildEnv({ logoutBehavior: 'pending' });
    await flushAll(); // selesaikan bootstrap() / GET /api/auth/me

    const modal = el(env, 'logout-confirm-modal');
    assert.ok(modal, 'modal #logout-confirm-modal harus ada');

    // Struktur container Bootstrap 5 (Req 5.1).
    assert.ok(modal.classList.contains('modal'), '#logout-confirm-modal punya kelas modal');
    const dialog = modal.querySelector('.modal-dialog.modal-dialog-centered');
    assert.ok(dialog, 'ada .modal-dialog.modal-dialog-centered');
    const content = modal.querySelector('.modal-content');
    assert.ok(content, 'ada .modal-content');

    // Judul berisi teks Indonesia non-kosong (Req 1.4, 5.2).
    const title = modal.querySelector('.modal-title');
    assert.ok(title, 'ada .modal-title');
    assert.ok(title.textContent.trim().length > 0, '.modal-title berisi teks non-kosong');

    // Tombol tutup punya aria-label non-kosong (Req 5.2).
    const closeBtn = modal.querySelector('.btn-close');
    assert.ok(closeBtn, 'ada .btn-close');
    const ariaLabel = closeBtn.getAttribute('aria-label');
    assert.ok(ariaLabel && ariaLabel.trim().length > 0, '.btn-close punya aria-label non-kosong');

    // Tombol Batal memakai native dismiss (Req 1.4, 5.4).
    const cancelBtn = modal.querySelector('.btn-secondary[data-bs-dismiss="modal"]');
    assert.ok(cancelBtn, 'ada tombol Batal .btn-secondary[data-bs-dismiss="modal"]');

    // Tombol konfirmasi navy/biru, bukan merah (Req 5.5).
    const confirmBtn = el(env, 'logout-confirm');
    assert.ok(confirmBtn, 'ada tombol #logout-confirm');
    assert.ok(confirmBtn.classList.contains('btn-primary'), '#logout-confirm punya kelas btn-primary');
    assert.ok(!confirmBtn.classList.contains('btn-danger'), '#logout-confirm TIDAK punya kelas btn-danger');
  });

  console.log('\nSelesai. ' + passed + ' test lolos.'
    + (failures.length ? ' ' + failures.length + ' gagal: ' + failures.join(', ') : ''));
})();

// Diekspor agar skenario uji (Task 4.2-4.7) dapat menambah test memakai
// harness yang sama bila file ini dipecah/di-require di masa depan.
module.exports = { buildEnv, flushAll, check, CSRF_TOKEN };
