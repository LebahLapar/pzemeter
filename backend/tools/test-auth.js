// =====================================================================
// test-auth.js - Uji logika murni userService (hashing + lockout) TANPA
// jaringan/DB. Gaya mengikuti test-logic.js (node + assert).
// Jalankan: node tools/test-auth.js
//
// Fungsi yang butuh DB (registerFailure/resetFailures) diuji dengan
// dokumen mongoose tiruan: objek biasa + stub save() yang menghitung panggilan.
// findByUsername tidak diuji di sini karena memerlukan koneksi MongoDB nyata.
//
// Memverifikasi Correctness Properties dari design:
//   Property 1: tidak ada plaintext password yang persist (hanya hash bcrypt)
//   Property 3: lockout monoton (5 gagal -> terkunci sampai lockUntil lewat)
//   Property 5: verifikasi password selalu via bcrypt
// =====================================================================
const assert = require('assert');
const bcrypt = require('bcrypt');

const {
  hashPassword,
  verifyPassword,
  isLocked,
  registerFailure,
  resetFailures,
  BCRYPT_COST,
  MAX_FAILED_ATTEMPTS,
  FAILURE_WINDOW_MS,
  LOCK_DURATION_MS,
} = require('../src/auth/userService');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  \u2713', name);
    passed++;
  } catch (e) {
    console.error('  \u2717', name, '\n     ', e.message);
    process.exitCode = 1;
  }
}
// Versi async: tunggu promise selesai sebelum lapor hasil.
async function checkAsync(name, fn) {
  try {
    await fn();
    console.log('  \u2713', name);
    passed++;
  } catch (e) {
    console.error('  \u2717', name, '\n     ', e.message);
    process.exitCode = 1;
  }
}

// Buat dokumen user tiruan ala mongoose: state + stub save() yang dicatat.
function makeFakeUser(overrides = {}) {
  return {
    username: 'admin',
    passwordHash: undefined,
    failedAttempts: 0,
    lastFailedAt: undefined,
    lockUntil: null,
    saveCount: 0,
    async save() {
      this.saveCount += 1;
      return this;
    },
    ...overrides,
  };
}

async function main() {
  console.log('TEST: userService.js hashing');

  // --- hashPassword / verifyPassword (Req 1.4, 2.1; Property 1 & 5) ---
  await checkAsync('hashPassword menghasilkan hash bcrypt (bukan plaintext)', async () => {
    const plain = 'S3cr3t-Pass!';
    const hash = await hashPassword(plain);
    // Property 1: hash tidak sama dengan plaintext & tidak memuat plaintext.
    assert.notStrictEqual(hash, plain);
    assert.ok(!hash.includes(plain), 'hash tidak boleh memuat plaintext');
    // Format hash bcrypt: diawali $2a$/$2b$ diikuti cost factor.
    assert.ok(/^\$2[aby]\$\d{2}\$/.test(hash), 'format hash bcrypt valid');
  });

  await checkAsync('hashPassword memakai cost factor 12 (>= 10)', async () => {
    const hash = await hashPassword('whatever');
    // cost factor terbaca dari segmen kedua hash bcrypt.
    const cost = parseInt(hash.split('$')[2], 10);
    assert.strictEqual(cost, BCRYPT_COST);
    assert.ok(cost >= 10, 'cost factor minimal 10 (Req 2.1)');
  });

  await checkAsync('verifyPassword true untuk kata sandi benar (via bcrypt)', async () => {
    const plain = 'correct horse battery';
    const hash = await hashPassword(plain);
    // Property 5: hash dibuat bcrypt -> verifikasi harus lewat bcrypt.compare.
    assert.strictEqual(await verifyPassword(plain, hash), true);
    // Sanity check independen: bcrypt.compare langsung juga true.
    assert.strictEqual(await bcrypt.compare(plain, hash), true);
  });

  await checkAsync('verifyPassword false untuk kata sandi salah', async () => {
    const hash = await hashPassword('correct-password');
    assert.strictEqual(await verifyPassword('wrong-password', hash), false);
  });

  await checkAsync('verifyPassword false bila argumen kosong (tanpa throw)', async () => {
    assert.strictEqual(await verifyPassword('', 'somehash'), false);
    assert.strictEqual(await verifyPassword('plain', ''), false);
    assert.strictEqual(await verifyPassword(undefined, undefined), false);
  });

  await checkAsync('Property 5: verifyPassword menolak hash yang bukan bcrypt', async () => {
    // Perbandingan string langsung akan lolos, tapi bcrypt.compare menolak.
    const plain = 'mypassword';
    assert.strictEqual(await verifyPassword(plain, plain), false);
  });

  console.log('TEST: userService.js lockout (Property 3)');

  // --- isLocked ---
  check('isLocked false bila lockUntil null', () => {
    assert.strictEqual(isLocked(makeFakeUser()), false);
  });

  check('isLocked false bila user tidak ada', () => {
    assert.strictEqual(isLocked(null), false);
  });

  check('isLocked true bila lockUntil di masa depan', () => {
    const u = makeFakeUser({ lockUntil: new Date(Date.now() + 60 * 1000) });
    assert.strictEqual(isLocked(u), true);
  });

  check('isLocked false bila lockUntil sudah lewat', () => {
    const u = makeFakeUser({ lockUntil: new Date(Date.now() - 60 * 1000) });
    assert.strictEqual(isLocked(u), false);
  });

  // --- registerFailure: lockout setelah 5 gagal (Req 3.2) ---
  await checkAsync('5 kegagalan beruntun -> akun terkunci (Property 3)', async () => {
    const u = makeFakeUser();
    for (let i = 1; i <= MAX_FAILED_ATTEMPTS; i++) {
      await registerFailure(u);
      assert.strictEqual(u.failedAttempts, i, 'counter naik tiap gagal');
    }
    // Setelah mencapai ambang, lockUntil di-set ke masa depan.
    assert.ok(u.lockUntil instanceof Date, 'lockUntil ter-set');
    assert.strictEqual(isLocked(u), true, 'akun terkunci setelah 5 gagal');
    // save() dipanggil tiap registerFailure (persist state).
    assert.strictEqual(u.saveCount, MAX_FAILED_ATTEMPTS);
  });

  await checkAsync('belum terkunci sebelum mencapai 5 gagal', async () => {
    const u = makeFakeUser();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      await registerFailure(u);
    }
    assert.strictEqual(u.failedAttempts, MAX_FAILED_ATTEMPTS - 1);
    assert.strictEqual(isLocked(u), false, 'belum terkunci pada 4 gagal');
    assert.strictEqual(u.lockUntil, null);
  });

  await checkAsync('lockUntil kira-kira sekarang + 15 menit', async () => {
    const u = makeFakeUser();
    const before = Date.now();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await registerFailure(u);
    }
    const expected = before + LOCK_DURATION_MS;
    // Toleransi 2 detik untuk waktu eksekusi.
    assert.ok(Math.abs(u.lockUntil.getTime() - expected) < 2000, 'durasi lock ~15 menit');
  });

  // --- window bergulir 15 menit (Req 3.1) ---
  await checkAsync('window reset: kegagalan lama (>15 menit) tidak diakumulasi', async () => {
    const u = makeFakeUser({
      failedAttempts: 4,
      // gagal terakhir 16 menit lalu -> di luar window, counter harus reset.
      lastFailedAt: new Date(Date.now() - (FAILURE_WINDOW_MS + 60 * 1000)),
    });
    await registerFailure(u);
    // Karena reset, ini dihitung sebagai kegagalan pertama dalam window baru.
    assert.strictEqual(u.failedAttempts, 1, 'counter reset lalu naik ke 1');
    assert.strictEqual(isLocked(u), false, 'tidak terkunci karena window baru');
  });

  await checkAsync('window aktif: kegagalan dalam 15 menit terakumulasi', async () => {
    const u = makeFakeUser({
      failedAttempts: 4,
      // gagal terakhir 5 menit lalu -> masih dalam window.
      lastFailedAt: new Date(Date.now() - 5 * 60 * 1000),
    });
    await registerFailure(u);
    assert.strictEqual(u.failedAttempts, 5, 'counter naik ke 5 dalam window');
    assert.strictEqual(isLocked(u), true, 'terkunci karena mencapai 5 dalam window');
  });

  // --- resetFailures (Req 3.4) ---
  await checkAsync('resetFailures mengosongkan counter & lock', async () => {
    const u = makeFakeUser({
      failedAttempts: 5,
      lastFailedAt: new Date(),
      lockUntil: new Date(Date.now() + LOCK_DURATION_MS),
    });
    await resetFailures(u);
    assert.strictEqual(u.failedAttempts, 0, 'counter nol');
    assert.strictEqual(u.lastFailedAt, null, 'lastFailedAt dibersihkan');
    assert.strictEqual(u.lockUntil, null, 'lock dilepas');
    assert.strictEqual(isLocked(u), false, 'tidak lagi terkunci');
    assert.ok(u.saveCount >= 1, 'state dipersist');
  });

  console.log('\nSelesai. ' + passed + ' test lolos.');
}

main();
