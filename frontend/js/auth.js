// =====================================================================
// auth.js - Gating autentikasi & halaman login frontend PZEMETER.
// Vanilla JS, tanpa framework. Dimuat SETELAH app.js (lihat index.html).
//
// Tanggung jawab (Req 9.1, 9.2, 9.3, 9.5, 9.6):
//   - Saat load: GET /api/auth/me untuk menentukan status sesi.
//       * authenticated=true  -> tampilkan #app-view, simpan CSRF token,
//                                init dashboard.
//       * authenticated=false / error / gagal fetch -> tampilkan
//                                #login-view (kondisi BAWAAN).
//   - Submit form login -> POST /api/auth/login. Sukses: init dashboard.
//     Gagal: pesan error generik (tanpa membocorkan field mana yang salah).
//   - Tombol logout -> POST /api/auth/logout (menyertakan X-CSRF-Token).
//
// ---------------------------------------------------------------------
// KONTRAK INTEGRASI DENGAN app.js (Task 12):
//   auth.js MENGENDALIKAN perpindahan tampilan (login <-> dashboard) dan
//   menyimpan CSRF token. app.js HARUS mengikuti kontrak berikut:
//
//   1. window.CSRF_TOKEN : string|null
//        Diisi oleh auth.js setelah sesi terautentikasi. app.js membaca
//        nilai ini untuk header `X-CSRF-Token` pada request POST.
//
//   2. window.initDashboard() : function (didefinisikan oleh app.js)
//        Dipanggil auth.js HANYA setelah autentikasi berhasil. Berisi
//        pemuatan data awal dashboard (loadSettings, loadHistory) dan
//        koneksi Socket.IO. app.js TIDAK boleh auto-init sendiri saat load.
//        Jika app.js belum mendefinisikan fungsi ini (mis. Task 12 belum
//        dikerjakan), auth.js menampilkan dashboard tanpa init tambahan.
//
//   3. window.onAuthLost() : function (opsional, didefinisikan app.js)
//        Dipanggil auth.js ketika sesi hilang/logout untuk membersihkan
//        state dashboard (mis. memutus socket). Opsional.
//
//   auth.js juga menyediakan window.showLogin() agar app.js bisa
//   mengarahkan kembali ke login saat menerima respons 401 (Req 9.4).
// =====================================================================
(function () {
  'use strict';

  var loginView = document.getElementById('login-view');
  var appView = document.getElementById('app-view');
  var loginForm = document.getElementById('login-form');
  var loginError = document.getElementById('login-error');
  var loginSubmit = document.getElementById('login-submit');
  var logoutBtn = document.getElementById('logout-btn');

  // Pesan error generik (Req 9.6): tidak mengungkapkan field mana yang salah.
  var GENERIC_LOGIN_ERROR = 'Username atau kata sandi salah.';

  var dashboardStarted = false;

  // ---------- Perpindahan tampilan ----------
  function showLogin() {
    if (appView) appView.style.display = 'none';
    if (loginView) loginView.style.display = 'flex';
  }

  function showApp() {
    if (loginView) loginView.style.display = 'none';
    if (appView) appView.style.display = 'block';
  }

  function clearLoginError() {
    if (!loginError) return;
    loginError.style.display = 'none';
    loginError.textContent = '';
  }

  function setLoginError(msg) {
    if (!loginError) return;
    loginError.textContent = msg;
    loginError.style.display = 'block';
  }

  // ---------- Init dashboard (kontrak dengan app.js) ----------
  function startDashboard() {
    if (dashboardStarted) return;
    if (typeof window.initDashboard === 'function') {
      try {
        window.initDashboard();
      } catch (e) {
        console.error('[auth] initDashboard gagal:', e);
      }
    }
    dashboardStarted = true;
  }

  // ---------- Ambil status sesi + CSRF token ----------
  // Mengembalikan objek { authenticated, csrfToken } atau null bila gagal.
  function fetchSession() {
    return fetch('/api/auth/me', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .catch(function () {
        // (Req 9.3) Gagal menentukan status -> perlakukan tidak terautentikasi.
        return null;
      });
  }

  // ---------- Alur saat halaman dimuat ----------
  function bootstrap() {
    fetchSession().then(function (data) {
      if (data && data.authenticated) {
        window.CSRF_TOKEN = data.csrfToken || null;
        showApp();
        startDashboard();
      } else {
        // (Req 9.1, 9.3) Default ke login bila tidak terautentikasi/error.
        window.CSRF_TOKEN = null;
        showLogin();
      }
    });
  }

  // ---------- Submit login ----------
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      clearLoginError();

      var username = document.getElementById('login-username').value;
      var password = document.getElementById('login-password').value;

      if (!username || !password) {
        setLoginError(GENERIC_LOGIN_ERROR);
        return;
      }

      if (loginSubmit) loginSubmit.disabled = true;

      fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ username: username, password: password }),
      })
        .then(function (res) {
          if (res.ok) {
            // Login sukses. Ambil CSRF token segar via /me lalu masuk dashboard.
            return fetchSession().then(function (data) {
              window.CSRF_TOKEN = data && data.csrfToken ? data.csrfToken : null;
              if (loginForm) loginForm.reset();
              showApp();
              startDashboard();
            });
          }
          // (Req 9.6) Semua kegagalan -> pesan generik yang sama.
          setLoginError(GENERIC_LOGIN_ERROR);
        })
        .catch(function () {
          setLoginError('Tidak dapat terhubung ke server. Coba lagi.');
        })
        .finally(function () {
          if (loginSubmit) loginSubmit.disabled = false;
        });
    });
  }

  // ---------- Logout ----------
  // Logout adalah request yang mengubah state -> wajib menyertakan CSRF token
  // (Req 7.1). Token diambil dari window.CSRF_TOKEN yang diisi saat sesi aktif.
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      logoutBtn.disabled = true;

      fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': window.CSRF_TOKEN || '',
        },
        credentials: 'same-origin',
      })
        .then(function () {
          // Apa pun hasilnya, kembali ke login (sesi dianggap berakhir).
          window.CSRF_TOKEN = null;
          dashboardStarted = false;
          if (typeof window.onAuthLost === 'function') {
            try {
              window.onAuthLost();
            } catch (e) {
              console.error('[auth] onAuthLost gagal:', e);
            }
          }
          showLogin();
        })
        .catch(function () {
          // Tetap arahkan ke login meskipun request gagal.
          window.CSRF_TOKEN = null;
          showLogin();
        })
        .finally(function () {
          logoutBtn.disabled = false;
        });
    });
  }

  // ---------- Ekspor helper untuk app.js (Req 9.4) ----------
  // app.js memanggil window.showLogin() ketika menerima 401 dari API.
  window.showLogin = showLogin;

  // Jalankan gating saat DOM siap.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
