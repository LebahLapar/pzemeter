// =====================================================================
// authService.js - Logika autentikasi murni (prosedural) untuk login admin.
// Memanggil userService untuk lock-check, verifikasi bcrypt, dan
// register/reset percobaan gagal. TIDAK menyentuh objek Express (req/res)
// agar mudah diuji dan dipakai ulang.
//
// Alur attemptLogin (lihat sequence diagram design - Alur Login):
//   1. Cari user by username.
//   2. Jika akun terkunci  -> 429 TANPA memanggil bcrypt (Req 3.3).
//   3. Verifikasi password via bcrypt; user tak ada / password salah
//      -> registerFailure + 401 pesan generik (Req 1.2).
//   4. Sukses -> resetFailures + 200 (Req 1.1, 3.4).
//
// Logging keamanan (Req 10.3): catat login success / failed / account
// locked dengan username SAJA. TIDAK PERNAH mencatat password atau hash.
// =====================================================================
const userService = require('./userService');

// Pesan kesalahan generik (Req 1.2, 9.6): tidak mengungkap field mana yang salah.
const GENERIC_INVALID = 'invalid credentials';
const LOCKED_MESSAGE = 'terlalu banyak percobaan';

// Coba login dengan username + password.
// Mengembalikan hasil terstruktur:
//   sukses : { ok: true,  status: 200, user }
//   gagal  : { ok: false, status: 401, error }  (kredensial salah)
//   lock   : { ok: false, status: 429, error }  (akun terkunci)
// Catatan: validasi field kosong & panjang dilakukan di layer route (Req 1.3, 1.6).
async function attemptLogin(username, password) {
  // Ambil user termasuk passwordHash (select:false di schema).
  const user = await userService.findByUsername(username);

  // (Req 3.3) Cek lock LEBIH DULU. Bila terkunci, tolak tanpa verifikasi
  // password sama sekali (bcrypt tidak dipanggil).
  if (user && userService.isLocked(user)) {
    console.warn('[auth] account locked - login ditolak untuk username: ' + user.username);
    return { ok: false, status: 429, error: LOCKED_MESSAGE };
  }

  // Verifikasi kredensial. Bila user tak ditemukan, verifyPassword
  // dipanggil dengan hash kosong -> false (tetap pesan generik, Req 1.2).
  const valid = user
    ? await userService.verifyPassword(password, user.passwordHash)
    : false;

  if (!valid) {
    // Hanya bisa mencatat kegagalan ke DB bila user ada (ada dokumen untuk disimpan).
    if (user) {
      await userService.registerFailure(user);
    }
    // Log tanpa membocorkan field mana yang salah; gunakan input username apa adanya.
    console.warn('[auth] login failed untuk username: ' + String(username));
    return { ok: false, status: 401, error: GENERIC_INVALID };
  }

  // (Req 3.4) Sukses -> reset penghitung kegagalan & lepas lock.
  await userService.resetFailures(user);
  console.log('[auth] login success untuk username: ' + user.username);
  return { ok: true, status: 200, user };
}

module.exports = {
  attemptLogin,
  GENERIC_INVALID,
  LOCKED_MESSAGE,
};
