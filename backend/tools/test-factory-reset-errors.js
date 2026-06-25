// =====================================================================
// test-factory-reset-errors.js - Unit/integration test untuk KONDISI ERROR
// & ERROR HYGIENE pada endpoint POST /api/factory-reset.
// Gaya: node + assert (mengikuti test-logic.js / test-auth.js), memakai
// `mongodb-memory-server` + `mongoose` agar app bisa connect, lalu
// memonkey-patch method model per-skenario untuk memicu error.
//
// Jalankan: node tools/test-factory-reset-errors.js
//
// Yang diverifikasi:
//   - Settings.findByIdAndUpdate throw  -> 500, Reading TIDAK tersentuh,
//     body { error: 'server error' } tanpa deletedCount/stack/path (Req 2.8, 6.4)
//   - Reading.deleteMany throw          -> 500, body { error: 'server error' }
//     tanpa deletedCount/stack/path (Req 3.4, 3.5, 6.3)
//   - Audit log gagal (console.error) memuat operator + outcome(FAIL) +
//     timestamp, TANPA nilai sensitif (Req 6.5)
//   - Audit log sukses (console.log) memuat operator + deletedCount +
//     timestamp, TANPA nilai sensitif (Req 6.5)
// =====================================================================
const assert = require('assert');
const util = require('util');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Settings = require('../src/models/Settings');
const Reading = require('../src/models/Reading');
const apiRoutes = require('../src/routes/api');

// Operator + nilai sensitif palsu di session untuk uji error hygiene.
// Audit log TIDAK boleh pernah memuat nilai sensitif ini.
const OPERATOR = 'operator-zaki';
const SECRET_VALUES = ['S3cr3t-Passw0rd', '$2b$12$abcdefghijklmnopqrstuv', 'jwt-token-XYZ'];

let passed = 0;
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

// ---- Penangkap output console (mengembalikan fungsi restore + buffer) ----
function captureConsole(method) {
  const original = console[method];
  const lines = [];
  console[method] = (...args) => { lines.push(util.format(...args)); };
  return {
    lines,
    restore() { console[method] = original; },
  };
}

// Helper: assert sebuah baris audit "sehat" (ada outcome, operator, timestamp,
// tanpa nilai sensitif).
function assertHealthyAudit(line, expectedOutcome) {
  assert.ok(line.includes('[AUDIT]'), 'baris audit memuat tag [AUDIT]');
  assert.ok(line.includes('factory-reset'), 'baris audit menyebut factory-reset');
  assert.ok(line.includes(expectedOutcome), 'baris audit memuat outcome ' + expectedOutcome);
  assert.ok(line.includes(OPERATOR), 'baris audit memuat identitas operator');
  // Timestamp ISO 8601 (mis. 2026-06-23T10:00:00.000Z)
  assert.ok(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(line), 'baris audit memuat timestamp');
  // Tidak ada nilai sensitif yang bocor ke log
  for (const secret of SECRET_VALUES) {
    assert.ok(!line.includes(secret), 'baris audit TIDAK memuat nilai sensitif');
  }
}

// Bangun app minimal yang memuat api router + session palsu berisi operator.
function buildApp() {
  const app = express();
  app.use(express.json());
  // Suntik session palsu: operator + nilai sensitif (untuk uji hygiene).
  app.use((req, res, next) => {
    req.session = { username: OPERATOR, passwordHash: SECRET_VALUES[1], token: SECRET_VALUES[2] };
    next();
  });
  app.use('/api', apiRoutes);
  return app;
}

// Helper: POST /api/factory-reset, kembalikan { status, body }.
async function postReset(baseUrl) {
  const res = await fetch(baseUrl + '/api/factory-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  let body;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}

// Assert kontrak error: 500 + body persis { error: 'server error' } tanpa
// kebocoran detail internal.
function assertGenericError(status, body) {
  assert.strictEqual(status, 500, 'status harus 500');
  assert.deepStrictEqual(body, { error: 'server error' }, "body harus persis { error: 'server error' }");
  // Tidak ada deletedCount pada path gagal (Req 3.5)
  assert.ok(!('deletedCount' in body), 'body TIDAK boleh memuat deletedCount');
  // Tidak ada detail internal (Req 3.4, 6.3)
  assert.ok(!('stack' in body), 'body TIDAK boleh memuat stack');
  assert.ok(!('path' in body), 'body TIDAK boleh memuat path');
  assert.ok(!('message' in body), 'body TIDAK boleh memuat message internal');
}

async function main() {
  console.log('TEST: factory-reset (kondisi error & error hygiene)');

  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'factory_reset_err_test' });

  const app = buildApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = 'http://127.0.0.1:' + server.address().port;

  // Simpan method asli untuk restore.
  const origSettingsUpdate = Settings.findByIdAndUpdate;
  const origReadingDelete = Reading.deleteMany;

  try {
    // -----------------------------------------------------------------
    // Skenario A: Settings.findByIdAndUpdate throw
    //   -> 500, Reading TIDAK tersentuh (Req 2.8, 6.4)
    // -----------------------------------------------------------------
    await checkAsync('Settings gagal -> 500 generik & Reading.deleteMany TIDAK dipanggil', async () => {
      let deleteCalls = 0;
      // Spy deleteMany untuk memastikan TIDAK terpanggil.
      Reading.deleteMany = (...args) => {
        deleteCalls += 1;
        return origReadingDelete.apply(Reading, args);
      };
      // Stub findByIdAndUpdate agar melempar error (dengan detail internal).
      Settings.findByIdAndUpdate = () => {
        throw new Error('boom: internal db detail /var/secret/path');
      };

      const errCap = captureConsole('error');
      let result;
      try {
        result = await postReset(baseUrl);
      } finally {
        errCap.restore();
      }

      assertGenericError(result.status, result.body);
      // Reading harus benar-benar tidak tersentuh (reset gagal sebelum delete).
      assert.strictEqual(deleteCalls, 0, 'Reading.deleteMany TIDAK boleh dipanggil');

      // Audit gagal tercatat & sehat.
      const auditLines = errCap.lines.filter((l) => l.includes('[AUDIT]'));
      assert.ok(auditLines.length >= 1, 'ada baris audit pada path gagal');
      assertHealthyAudit(auditLines[0], 'FAIL');
      // Detail error internal tidak ikut tercatat di baris audit.
      assert.ok(!auditLines[0].includes('/var/secret/path'), 'detail internal tidak bocor ke audit');

      // Restore untuk skenario berikutnya.
      Settings.findByIdAndUpdate = origSettingsUpdate;
      Reading.deleteMany = origReadingDelete;
    });

    // -----------------------------------------------------------------
    // Skenario B: Reading.deleteMany throw (Settings sehat)
    //   -> 500, body { error: 'server error' } tanpa deletedCount/stack/path
    //   (Req 3.4, 3.5, 6.3)
    // -----------------------------------------------------------------
    await checkAsync('Reading gagal -> 500 generik tanpa deletedCount/stack/path', async () => {
      Settings.findByIdAndUpdate = origSettingsUpdate; // sehat
      Reading.deleteMany = () => {
        throw new Error('boom: deleteMany failed at /opt/app/db/reading.js:42');
      };

      const errCap = captureConsole('error');
      let result;
      try {
        result = await postReset(baseUrl);
      } finally {
        errCap.restore();
      }

      assertGenericError(result.status, result.body);

      // Audit gagal sehat & tanpa kebocoran.
      const auditLines = errCap.lines.filter((l) => l.includes('[AUDIT]'));
      assert.ok(auditLines.length >= 1, 'ada baris audit pada path gagal');
      assertHealthyAudit(auditLines[0], 'FAIL');
      assert.ok(!auditLines[0].includes('/opt/app/db/reading.js'), 'jejak internal tidak bocor ke audit');

      Reading.deleteMany = origReadingDelete;
    });

    // -----------------------------------------------------------------
    // Audit sukses: console.log memuat operator + deletedCount + timestamp,
    // tanpa nilai sensitif (Req 6.5)
    // -----------------------------------------------------------------
    await checkAsync('Path sukses -> audit OK memuat operator + deletedCount + timestamp', async () => {
      Settings.findByIdAndUpdate = origSettingsUpdate;
      Reading.deleteMany = origReadingDelete;

      // Siapkan beberapa Reading agar deletedCount > 0.
      await Reading.deleteMany({});
      await Reading.insertMany([
        { device: 'd1', voltage: 220, current: 1, power: 100, energy: 0.1, frequency: 50, pf: 0.9, createdAt: new Date() },
        { device: 'd1', voltage: 221, current: 1, power: 110, energy: 0.2, frequency: 50, pf: 0.9, createdAt: new Date() },
      ]);

      const logCap = captureConsole('log');
      let result;
      try {
        result = await postReset(baseUrl);
      } finally {
        logCap.restore();
      }

      assert.strictEqual(result.status, 200, 'status sukses 200');
      assert.strictEqual(result.body.ok, true, 'body ok=true');
      assert.strictEqual(result.body.deletedCount, 2, 'deletedCount = 2');

      const auditLines = logCap.lines.filter((l) => l.includes('[AUDIT]'));
      assert.ok(auditLines.length >= 1, 'ada baris audit pada path sukses');
      assertHealthyAudit(auditLines[0], 'OK');
      // Memuat jumlah dokumen terhapus.
      assert.ok(/deleted=2/.test(auditLines[0]), 'baris audit memuat jumlah dokumen terhapus');
    });
  } finally {
    // Restore semua method & tutup resource.
    Settings.findByIdAndUpdate = origSettingsUpdate;
    Reading.deleteMany = origReadingDelete;
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
