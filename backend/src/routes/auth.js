// =====================================================================
// auth.js - Auth routes (login, logout, me).
// Gaya prosedural CommonJS, konsisten dengan routes/api.js.
//
// Endpoint (di-mount di /api/auth oleh server.js):
//   POST /login   -> publik, rate-limited. Verifikasi kredensial, buat sesi.
//   POST /logout  -> destroy session + hapus cookie sesi.
//   GET  /me      -> lapor { authenticated, username } + sediakan CSRF token.
//
// PENTING - kontrak integrasi dengan server.js (Task 9):
//   Modul ini mengekspor FACTORY: createAuthRouter(generateToken).
//   `generateToken` berasal dari csrf-csrf (doubleCsrf), bertanda tangan
//   generateToken(req, res) dan mengembalikan string token. Dipakai di
//   GET /me untuk menyediakan CSRF token ke frontend (Req 7.3).
//   Jika generateToken tidak diberikan, /me tetap berfungsi tetapi
//   csrfToken bernilai null (mis. saat sesi cookie belum aktif).
//
//   Router login (dengan rate limiter) HARUS di-mount sebagai publik
//   SEBELUM middleware requireAuth/CSRF global. /logout memerlukan sesi
//   aktif + CSRF valid (di-handle oleh middleware global di server.js).
// =====================================================================
const express = require('express');
const rateLimit = require('express-rate-limit');

const authService = require('../auth/authService');

// --- Batas panjang input login (Req 1.6) ---
const MAX_USERNAME_LEN = 254;
const MAX_PASSWORD_LEN = 128;

// Nama cookie sesi (harus sama dengan konfigurasi express-session di server.js).
// Default express-session adalah 'connect.sid'; boleh di-override via env.
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'connect.sid';

// Rate limiter khusus endpoint login: maks 20 request/menit/IP (Req 3.5).
// Berbeda dari lockout per-username (Req 3.2) yang ditangani userService.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 menit
  max: 20, // 20 request per IP per menit
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'terlalu banyak percobaan' },
});

// Factory: bangun router auth. `generateToken` opsional (csrf-csrf).
function createAuthRouter(generateToken) {
  const router = express.Router();

  // -------------------------------------------------------------------
  // Cegah caching SEMUA respons auth (login/logout/me). Status sesi
  // bersifat sensitif dan tidak boleh disimpan cache browser/proxy.
  // Tanpa ini, browser dapat menyajikan ulang respons /me lama yang
  // "authenticated:true" saat refresh sehingga melompat ke dashboard
  // walau sesi sudah berakhir (OWASP: jangan cache data sensitif).
  // -------------------------------------------------------------------
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
  });

  // -------------------------------------------------------------------
  // POST /login (Req 1.1, 1.2, 1.3, 1.6, 3.3, 3.5, 4.7)
  // -------------------------------------------------------------------
  router.post('/login', loginLimiter, async (req, res) => {
    try {
      const body = req.body || {};
      const username = body.username;
      const password = body.password;

      // (Req 1.3) Field wajib: tolak bila tidak ada/kosong/bukan string.
      if (
        typeof username !== 'string' ||
        typeof password !== 'string' ||
        username.trim() === '' ||
        password === ''
      ) {
        return res.status(400).json({ error: 'username dan password wajib' });
      }

      // (Req 1.6) Batasi panjang input sebelum proses lebih lanjut.
      if (username.length > MAX_USERNAME_LEN || password.length > MAX_PASSWORD_LEN) {
        return res.status(400).json({ error: 'username dan password wajib' });
      }

      // Logika autentikasi murni (lock-check, bcrypt, lockout) di authService.
      const result = await authService.attemptLogin(username, password);

      if (!result.ok) {
        // 401 kredensial salah (generik) atau 429 akun terkunci.
        return res.status(result.status).json({ error: result.error });
      }

      // (Req 4.7) Cegah session fixation: regenerasi session id SEBELUM
      // menyimpan identitas, lalu set userId pada sesi baru.
      req.session.regenerate((err) => {
        if (err) {
          console.error('[auth] gagal regenerate session');
          return res.status(500).json({ error: 'server error' });
        }
        req.session.userId = String(result.user._id);
        req.session.username = result.user.username;

        // Simpan sesi secara eksplisit agar cookie terkirim sebelum respons.
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('[auth] gagal menyimpan session');
            return res.status(500).json({ error: 'server error' });
          }
          return res.status(200).json({
            authenticated: true,
            username: result.user.username,
          });
        });
      });
    } catch (e) {
      // (Req 10.2) Pesan generik tanpa stack trace.
      console.error('[auth] error internal saat login');
      return res.status(500).json({ error: 'server error' });
    }
  });

  // -------------------------------------------------------------------
  // POST /logout (Req 8.1, 8.2)
  // Membutuhkan sesi aktif + CSRF valid (di-enforce middleware global).
  // -------------------------------------------------------------------
  router.post('/logout', (req, res) => {
    const username = req.session && req.session.username;

    // Tidak ada sesi -> tidak ada yang perlu dibatalkan.
    if (!req.session) {
      res.clearCookie(SESSION_COOKIE_NAME);
      return res.status(200).json({ ok: true });
    }

    req.session.destroy((err) => {
      if (err) {
        console.error('[auth] gagal destroy session saat logout');
        return res.status(500).json({ error: 'server error' });
      }
      // (Req 8.2, 8.3) Hapus cookie sesi pada browser klien.
      res.clearCookie(SESSION_COOKIE_NAME);
      if (username) {
        console.log('[auth] logout untuk username: ' + username);
      }
      return res.status(200).json({ ok: true });
    });
  });

  // -------------------------------------------------------------------
  // GET /me (Req 9.1, 9.2, 7.3)
  // Publik: melaporkan status sesi saat ini. Bila terautentikasi, sertakan
  // username. Selalu sediakan CSRF token (bila generateToken tersedia)
  // agar frontend bisa menyertakannya pada request berikutnya.
  // -------------------------------------------------------------------
  router.get('/me', (req, res) => {
    const authenticated = !!(req.session && req.session.userId);

    // (Req 7.3) Sediakan CSRF token untuk frontend bila helper tersedia.
    // overwrite=true: SELALU terbitkan token baru & timpa cookie CSRF lama.
    // Tanpa ini, csrf-csrf v3 mencoba memvalidasi cookie lama dan melempar
    // "invalid csrf token" bila browser membawa cookie basi (mis. dari sesi
    // sebelumnya), membuat csrfToken null -> POST (logout/settings/factory-
    // reset) tertolak. Menimpa token aman: token baru tetap terikat sesi.
    let csrfToken = null;
    if (typeof generateToken === 'function') {
      try {
        csrfToken = generateToken(req, res, true);
      } catch (e) {
        // Jangan gagalkan /me hanya karena pembuatan token CSRF bermasalah.
        console.error('[auth] gagal membuat CSRF token:', e && e.message);
        csrfToken = null;
      }
    }

    return res.status(200).json({
      authenticated,
      username: authenticated ? req.session.username || null : null,
      csrfToken,
    });
  });

  return router;
}

module.exports = createAuthRouter;
module.exports.SESSION_COOKIE_NAME = SESSION_COOKIE_NAME;
