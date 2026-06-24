// =====================================================================
// userService.js - Logika prosedural untuk akun admin: hashing kata sandi,
// verifikasi, dan proteksi brute force (lockout dengan window bergulir).
// Memisahkan logika dari Express agar mudah diuji (lihat test-auth.js).
//
// Library: bcrypt (npm: bcrypt) untuk hashing & verifikasi kata sandi.
// =====================================================================
const bcrypt = require('bcrypt');
const User = require('../models/User');

// --- Konstanta proteksi brute force (Req 3) ---
const BCRYPT_COST = 12; // cost factor >= 10 (Req 2.1)
const MAX_FAILED_ATTEMPTS = 5; // ambang lock (Req 3.2)
const FAILURE_WINDOW_MS = 15 * 60 * 1000; // jendela bergulir 15 menit (Req 3.1)
const LOCK_DURATION_MS = 15 * 60 * 1000; // durasi Account_Lock 15 menit (Req 3.2)

// Ambil user berdasarkan username, termasuk passwordHash (select:false di schema).
// Username di-normalisasi lowercase + trim agar konsisten dengan schema.
async function findByUsername(username) {
  if (!username) return null;
  const normalized = String(username).trim().toLowerCase();
  return User.findOne({ username: normalized }).select('+passwordHash');
}

// Hash kata sandi plaintext dengan bcrypt cost 12 (Req 2.1).
async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

// Verifikasi kata sandi plaintext terhadap hash tersimpan via bcrypt.compare (Req 1.4).
// Mengembalikan false bila salah satu argumen tidak ada (hindari throw).
async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
}

// Apakah akun sedang dalam kondisi Account_Lock? (Req 3.3)
// True bila lockUntil ada dan masih di masa depan.
function isLocked(user) {
  if (!user || !user.lockUntil) return false;
  return user.lockUntil.getTime() > Date.now();
}

// Catat satu percobaan login gagal dengan window bergulir 15 menit (Req 3.1, 3.2).
// - Jika kegagalan terakhir sudah lebih dari 15 menit lalu, counter di-reset
//   sehingga hanya kegagalan dalam window yang dihitung.
// - Increment counter, perbarui lastFailedAt.
// - Bila counter mencapai 5, set lockUntil = sekarang + 15 menit.
async function registerFailure(user) {
  const now = Date.now();

  // Reset counter bila kegagalan terakhir di luar window 15 menit.
  const lastFailed = user.lastFailedAt ? user.lastFailedAt.getTime() : 0;
  if (!lastFailed || now - lastFailed > FAILURE_WINDOW_MS) {
    user.failedAttempts = 0;
  }

  user.failedAttempts += 1;
  user.lastFailedAt = new Date(now);

  // Terapkan Account_Lock saat mencapai ambang dalam window (Req 3.2).
  if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    user.lockUntil = new Date(now + LOCK_DURATION_MS);
  }

  await user.save();
  return user;
}

// Reset penghitung kegagalan & lepas lock setelah login sukses (Req 3.4).
async function resetFailures(user) {
  user.failedAttempts = 0;
  user.lastFailedAt = null;
  user.lockUntil = null;
  await user.save();
  return user;
}

module.exports = {
  findByUsername,
  hashPassword,
  verifyPassword,
  isLocked,
  registerFailure,
  resetFailures,
  // ekspor konstanta untuk keperluan pengujian
  BCRYPT_COST,
  MAX_FAILED_ATTEMPTS,
  FAILURE_WINDOW_MS,
  LOCK_DURATION_MS,
};
