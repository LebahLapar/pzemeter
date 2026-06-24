// =====================================================================
// seedAdmin.js - Penyemaian (seed) akun Admin awal saat bootstrap.
// Tujuan: membuat satu Admin_User awal TANPA menulis kredensial di kode
// sumber (Req 2.4). Kredensial diambil dari environment variable.
//
// Aturan keamanan:
// - Hanya menyemai bila koleksi User benar-benar KOSONG (tidak menimpa
//   user yang sudah ada).
// - Password di-hash via bcrypt (userService.hashPassword), tidak pernah
//   disimpan/di-log dalam bentuk teks biasa (Req 2.4, 10.3).
// - Log hanya menyebut username, tidak pernah password/hash (Req 10.3).
// =====================================================================
const User = require('../models/User');
const { hashPassword } = require('./userService');

// Buat admin awal bila kondisi terpenuhi. Aman dipanggil berkali-kali:
// jika sudah ada user atau env tidak lengkap, fungsi tidak melakukan apa pun.
// Mengembalikan true bila admin baru dibuat, false bila dilewati.
async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  // Tanpa kredensial di env, tidak ada yang bisa/boleh disemai (Req 2.4).
  if (!username || !password) {
    console.log('[SEED] ADMIN_USERNAME/ADMIN_PASSWORD tidak diset, lewati seeding admin');
    return false;
  }

  // Jangan timpa data yang sudah ada: hanya semai bila koleksi User kosong.
  const existingCount = await User.estimatedDocumentCount();
  if (existingCount > 0) {
    console.log('[SEED] Koleksi User sudah berisi, lewati seeding admin');
    return false;
  }

  // Hash password sebelum disimpan (Req 2.1). Plaintext tidak pernah persist.
  const passwordHash = await hashPassword(password);

  const admin = await User.create({
    username: String(username).trim().toLowerCase(),
    passwordHash,
  });

  // Log tanpa kredensial: hanya username yang ditampilkan (Req 10.3).
  console.log('[SEED] Admin awal dibuat untuk username:', admin.username);
  return true;
}

module.exports = { seedAdmin };
