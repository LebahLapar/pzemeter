// =====================================================================
// test-factory-reset.js - Property-based test untuk fitur Factory Reset.
// Gaya: node + assert (mengikuti test-logic.js / test-auth.js), memakai
// `fast-check` + `mongodb-memory-server` agar logika reset NYATA teruji
// (findByIdAndUpdate upsert + deleteMany) terhadap MongoDB in-memory.
//
// Jalankan: node tools/test-factory-reset.js   (atau: npm test di backend/)
//
// Struktur: setiap properti adalah satu fungsi async (propertyN) yang
// dipanggil dari main(). Tambah properti baru (4.2, 4.3) dengan menulis
// fungsi async baru lalu memanggilnya di main() pada bagian bertanda.
// =====================================================================
const assert = require('assert');
const fc = require('fast-check');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Settings = require('../src/models/Settings');
const Reading = require('../src/models/Reading');
// Logika reset nyata yang dipakai endpoint POST /api/factory-reset.
const { performFactoryReset, DEFAULT_SETTINGS } = require('../src/routes/api');

const NUM_RUNS = 100; // min. 100 iterasi per properti (sesuai design)

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

// ---- Generator: nilai Settings awal acak (atau kasus dokumen belum ada) ----
// Angka non-negatif & finite, mengikuti domain valid field Settings.
const arbSettingField = fc.double({ min: 0, max: 1e9, noNaN: true });
const arbInitialSettings = fc.option(
  fc.record({
    overVoltage: arbSettingField,
    underVoltage: arbSettingField,
    overCurrent: arbSettingField,
    tariffPerKwh: arbSettingField,
  }),
  { nil: null } // null => dokumen _id:"global" belum ada
);

// =====================================================================
// Feature: factory-reset, Property 1: Settings selalu menjadi
// Default_Settings setelah reset
// Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
// =====================================================================
async function property1() {
  await check('Property 1: Settings menjadi Default_Settings setelah reset', async () => {
    await fc.assert(
      fc.asyncProperty(arbInitialSettings, async (initial) => {
        // Reset state koleksi sebelum tiap iterasi.
        await Settings.deleteMany({});

        // Siapkan kondisi awal: dokumen acak ATAU tidak ada dokumen sama sekali.
        if (initial) {
          await Settings.create({ _id: 'global', ...initial });
        }

        const t0 = Date.now();
        await performFactoryReset();
        const t1 = Date.now();

        const doc = await Settings.findById('global').lean();

        // Dokumen harus ada (dibuat via upsert bila sebelumnya tidak ada) (Req 2.6)
        assert.ok(doc, 'dokumen global harus ada setelah reset');

        // Field di-reset ke Default_Settings (Req 2.1-2.4)
        assert.strictEqual(doc.overVoltage, 250, 'overVoltage = 250');
        assert.strictEqual(doc.underVoltage, 180, 'underVoltage = 180');
        assert.strictEqual(doc.overCurrent, 10, 'overCurrent = 10');
        assert.strictEqual(doc.tariffPerKwh, 1444.70, 'tariffPerKwh = 1444.70');

        // updatedAt dalam rentang [t0, t1] (Req 2.5)
        const u = new Date(doc.updatedAt).getTime();
        assert.ok(u >= t0 && u <= t1, 'updatedAt dalam [t0, t1]');
      }),
      { numRuns: NUM_RUNS }
    );

    // Sanity: konstanta Default_Settings memang seperti yang diharapkan.
    assert.deepStrictEqual(DEFAULT_SETTINGS, {
      overVoltage: 250, underVoltage: 180, overCurrent: 10, tariffPerKwh: 1444.70,
    });
  });
}

// ---- Generator: dokumen Reading valid acak (sesuai schema Reading.js) ----
// Semua field numerik finite & non-negatif; device string tak-kosong.
const arbReading = fc.record({
  device:    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  voltage:   fc.double({ min: 0, max: 300, noNaN: true }),
  current:   fc.double({ min: 0, max: 100, noNaN: true }),
  power:     fc.double({ min: 0, max: 30000, noNaN: true }),
  energy:    fc.double({ min: 0, max: 1e6, noNaN: true }),
  frequency: fc.double({ min: 0, max: 60, noNaN: true }),
  pf:        fc.double({ min: 0, max: 1, noNaN: true }),
});

// N dokumen Reading acak, termasuk kasus N=0 (array kosong).
const arbReadings = fc.array(arbReading, { minLength: 0, maxLength: 50 });

// =====================================================================
// Feature: factory-reset, Property 2: Reading kosong dan deletedCount
// akurat setelah reset
// Validates: Requirements 3.1, 3.2, 3.3
// =====================================================================
async function property2() {
  await check('Property 2: Reading kosong dan deletedCount akurat setelah reset', async () => {
    await fc.assert(
      fc.asyncProperty(arbReadings, async (readings) => {
        // Reset state koleksi sebelum tiap iterasi.
        await Reading.deleteMany({});

        // Sisipkan N dokumen acak (N bisa 0). Sediakan createdAt eksplisit
        // agar insert deterministik; schema mengizinkan default bila kosong.
        const n = readings.length;
        if (n > 0) {
          await Reading.insertMany(readings.map((r) => ({ ...r, createdAt: new Date() })));
        }

        // Pastikan kondisi awal benar (N dokumen tersisip).
        const before = await Reading.countDocuments();
        assert.strictEqual(before, n, 'jumlah dokumen awal harus N');

        const deletedCount = await performFactoryReset();

        // Reading harus kosong setelah reset (Req 3.1)
        const after = await Reading.countDocuments();
        assert.strictEqual(after, 0, 'Reading harus kosong setelah reset');

        // deletedCount harus integer non-negatif (Req 3.3)
        assert.ok(Number.isInteger(deletedCount) && deletedCount >= 0,
          'deletedCount harus integer non-negatif');

        // deletedCount harus sama persis dengan N (Req 3.2)
        assert.strictEqual(deletedCount, n, 'deletedCount === N');
      }),
      { numRuns: NUM_RUNS }
    );
  });
}

// =====================================================================
// Feature: factory-reset, Property 3: Factory reset bersifat idempoten
// Validates: Requirements 4.6, 6.4
// =====================================================================
async function property3() {
  await check('Property 3: Factory reset bersifat idempoten', async () => {
    await fc.assert(
      fc.asyncProperty(arbInitialSettings, arbReadings, async (initial, readings) => {
        // Reset state koleksi sebelum tiap iterasi (state acak awal).
        await Settings.deleteMany({});
        await Reading.deleteMany({});

        // Siapkan kondisi awal acak: Settings (atau belum ada) + N Reading.
        if (initial) {
          await Settings.create({ _id: 'global', ...initial });
        }
        if (readings.length > 0) {
          await Reading.insertMany(readings.map((r) => ({ ...r, createdAt: new Date() })));
        }

        // Panggilan pertama: membawa state acak ke kondisi default.
        const firstDeleted = await performFactoryReset();

        // Panggilan kedua: harus idempoten (tidak mengubah apa pun lagi).
        const secondDeleted = await performFactoryReset();

        // State akhir identik dengan menjalankan satu kali:
        // Settings = Default_Settings (Req 6.4)
        const doc = await Settings.findById('global').lean();
        assert.ok(doc, 'dokumen global harus ada setelah reset');
        assert.strictEqual(doc.overVoltage, 250, 'overVoltage = 250');
        assert.strictEqual(doc.underVoltage, 180, 'underVoltage = 180');
        assert.strictEqual(doc.overCurrent, 10, 'overCurrent = 10');
        assert.strictEqual(doc.tariffPerKwh, 1444.70, 'tariffPerKwh = 1444.70');

        // Reading kosong setelah kedua panggilan (Req 6.4)
        const after = await Reading.countDocuments();
        assert.strictEqual(after, 0, 'Reading harus kosong setelah reset');

        // Panggilan pertama menghapus N dokumen acak (konsistensi sanity).
        assert.strictEqual(firstDeleted, readings.length, 'firstDeleted === N');

        // Idempotensi: panggilan kedua tidak menghapus apa pun (Req 4.6, 6.4)
        assert.strictEqual(secondDeleted, 0, 'deletedCount panggilan kedua === 0');
      }),
      { numRuns: NUM_RUNS }
    );
  });
}

// =====================================================================
// Runner
// =====================================================================
async function main() {
  console.log('TEST: factory-reset (property-based)');

  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'factory_reset_test' });

  try {
    await property1();
    await property2();
    await property3();
    // --- Tambahkan pemanggilan properti berikutnya di sini (4.3) ---
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }

  console.log('\nSelesai. ' + passed + ' test lolos.');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
