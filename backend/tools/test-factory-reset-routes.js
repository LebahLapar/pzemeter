// =====================================================================
// test-factory-reset-routes.js - Unit/integration test untuk method guard
// & kontrak respons endpoint Factory Reset (Task 4.4).
//
// Gaya: node + assert (mengikuti test-logic.js / test-auth.js). Memakai
// `mongodb-memory-server` + mongoose agar deleteMany/findByIdAndUpdate
// berjalan terhadap MongoDB in-memory yang NYATA.
//
// Cakupan (Req 1.2, 1.5, 6.1):
//   - GET/PUT/DELETE/PATCH /api/factory-reset -> 405 { error: 'method not
//     allowed' } DAN koleksi Settings/Reading TIDAK berubah.
//   - POST /api/factory-reset (happy path) -> 200 { ok: true, deletedCount }
//     dengan deletedCount numerik; Settings ter-reset ke default & Reading
//     dikosongkan.
//
// Catatan desain: app minimal di sini sengaja TIDAK memasang requireAuth /
// doubleCsrfProtection. Task ini menguji method guard (405) + kontrak
// happy-path (200), bukan auth/CSRF (itu cakupan task lain). Router api
// di-mount apa adanya sehingga `router.all('/factory-reset')` & handler POST
// teruji langsung.
//
// Jalankan: node tools/test-factory-reset-routes.js
// =====================================================================
const assert = require('assert');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Settings = require('../src/models/Settings');
const Reading = require('../src/models/Reading');
const apiRoutes = require('../src/routes/api');

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('  \u2713', name);
    passed++;
  } catch (e) {
    console.error('  \u2717', name, '\n     ', e.message);
    process.exitCode = 1;
  }
}

// Nilai Settings non-default untuk membuktikan koleksi tidak tersentuh
// oleh request non-POST (dan benar-benar ter-reset oleh POST).
const NON_DEFAULT_SETTINGS = {
  _id: 'global',
  overVoltage: 999,
  underVoltage: 1,
  overCurrent: 77,
  tariffPerKwh: 5000,
};

// Tiga dokumen Reading contoh (sesuai schema Reading.js).
function sampleReadings() {
  const now = Date.now();
  return [0, 1, 2].map((i) => ({
    device: 'pzemeter-test',
    voltage: 220 + i,
    current: 1 + i,
    power: 100 + i,
    energy: 10 + i,
    frequency: 50,
    pf: 0.98,
    createdAt: new Date(now + i),
  }));
}

// Seed koleksi ke kondisi awal yang diketahui (non-default Settings + 3 Reading).
async function seed() {
  await Settings.deleteMany({});
  await Reading.deleteMany({});
  await Settings.create({ ...NON_DEFAULT_SETTINGS });
  await Reading.insertMany(sampleReadings());
}

// Helper request HTTP ke server uji; mengembalikan { status, body }.
async function request(baseUrl, method, path) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
  });
  let body = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch (_) { body = text; }
  }
  return { status: res.status, body };
}

async function main() {
  console.log('TEST: factory-reset routes (method guard & kontrak respons)');

  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'factory_reset_routes_test' });

  // App minimal: hanya body parser + router api (tanpa auth/CSRF global).
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = 'http://127.0.0.1:' + server.address().port;

  try {
    // --- Req 1.2: method non-POST -> 405 & koleksi tidak berubah ---
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      await check(`${method} /api/factory-reset -> 405 dan koleksi tidak berubah`, async () => {
        await seed();

        const { status, body } = await request(baseUrl, method, '/api/factory-reset');

        // Kontrak status & body guard (Req 1.2).
        assert.strictEqual(status, 405, 'status harus 405');
        assert.deepStrictEqual(body, { error: 'method not allowed' }, "body { error: 'method not allowed' }");

        // Settings TIDAK berubah (tetap non-default).
        const s = await Settings.findById('global').lean();
        assert.ok(s, 'dokumen Settings tetap ada');
        assert.strictEqual(s.overVoltage, NON_DEFAULT_SETTINGS.overVoltage, 'overVoltage tak berubah');
        assert.strictEqual(s.underVoltage, NON_DEFAULT_SETTINGS.underVoltage, 'underVoltage tak berubah');
        assert.strictEqual(s.overCurrent, NON_DEFAULT_SETTINGS.overCurrent, 'overCurrent tak berubah');
        assert.strictEqual(s.tariffPerKwh, NON_DEFAULT_SETTINGS.tariffPerKwh, 'tariffPerKwh tak berubah');

        // Reading TIDAK berubah (3 dokumen tetap ada).
        const count = await Reading.countDocuments();
        assert.strictEqual(count, 3, 'Reading tetap 3 dokumen');
      });
    }

    // --- Req 1.5 & 6.1: POST happy path -> 200 { ok: true, deletedCount } ---
    await check('POST /api/factory-reset -> 200 { ok: true, deletedCount } & reset dijalankan', async () => {
      await seed();

      const { status, body } = await request(baseUrl, 'POST', '/api/factory-reset');

      // Kontrak status & body sukses (Req 1.5, 6.1).
      assert.strictEqual(status, 200, 'status harus 200');
      assert.ok(body && typeof body === 'object', 'body objek JSON');
      assert.strictEqual(body.ok, true, 'body.ok === true');
      assert.strictEqual(typeof body.deletedCount, 'number', 'deletedCount numerik');
      assert.ok(Number.isInteger(body.deletedCount) && body.deletedCount >= 0, 'deletedCount integer non-negatif');
      assert.strictEqual(body.deletedCount, 3, 'deletedCount === jumlah Reading awal (3)');

      // Settings ter-reset ke Default_Settings.
      const s = await Settings.findById('global').lean();
      assert.ok(s, 'dokumen Settings ada setelah reset');
      assert.strictEqual(s.overVoltage, 250, 'overVoltage = 250');
      assert.strictEqual(s.underVoltage, 180, 'underVoltage = 180');
      assert.strictEqual(s.overCurrent, 10, 'overCurrent = 10');
      assert.strictEqual(s.tariffPerKwh, 1444.70, 'tariffPerKwh = 1444.70');

      // Reading dikosongkan.
      const count = await Reading.countDocuments();
      assert.strictEqual(count, 0, 'Reading kosong setelah reset');
    });

    // --- Req 3.3: POST saat Reading kosong -> deletedCount 0 ---
    await check('POST /api/factory-reset saat Reading kosong -> deletedCount 0', async () => {
      await Settings.deleteMany({});
      await Reading.deleteMany({});
      await Settings.create({ ...NON_DEFAULT_SETTINGS });

      const { status, body } = await request(baseUrl, 'POST', '/api/factory-reset');

      assert.strictEqual(status, 200, 'status harus 200');
      assert.strictEqual(body.ok, true, 'body.ok === true');
      assert.strictEqual(body.deletedCount, 0, 'deletedCount === 0 saat tak ada Reading');
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mongod.stop();
  }

  console.log('\nSelesai. ' + passed + ' test lolos.');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
