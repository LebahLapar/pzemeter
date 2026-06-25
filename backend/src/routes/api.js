// =====================================================================
// api.js - REST API endpoints
// =====================================================================
const express = require('express');
const Reading = require('../models/Reading');
const Settings = require('../models/Settings');
const { estimateCost } = require('../tariff');

const router = express.Router();

// Default_Settings eksplisit untuk factory reset (Req 2.1-2.4, 2.6).
// Sengaja didefinisikan di sini, terlepas dari default schema Settings.
const DEFAULT_SETTINGS = {
  overVoltage: 250,
  underVoltage: 180,
  overCurrent: 10,
  tariffPerKwh: 1444.70,
};

// Helper: clamp angka untuk cegah query abuse
function clampInt(val, def, min, max) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

// Ambil dokumen settings (buat default bila belum ada)
async function getSettings() {
  let s = await Settings.findById('global').lean();
  if (!s) {
    s = (await Settings.create({ _id: 'global' })).toObject();
  }
  return s;
}

// GET /api/latest - pembacaan terbaru + estimasi biaya (tarif dari settings)
router.get('/latest', async (req, res) => {
  try {
    const [r, s] = await Promise.all([
      Reading.findOne().sort({ createdAt: -1 }).lean(),
      getSettings(),
    ]);
    if (!r) return res.status(404).json({ error: 'no data' });
    res.json({ reading: r, cost: estimateCost(r.power, s.tariffPerKwh) });
  } catch (e) {
    res.status(500).json({ error: 'server error' });
  }
});

// GET /api/history?limit=100 - riwayat untuk grafik
router.get('/history', async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 100, 1, 1000);
    const rows = await Reading.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json(rows.reverse()); // urut lama -> baru untuk chart
  } catch (e) {
    res.status(500).json({ error: 'server error' });
  }
});

// GET /api/stats - ringkasan energi & biaya total
router.get('/stats', async (req, res) => {
  try {
    const [first, last, s] = await Promise.all([
      Reading.findOne().sort({ createdAt: 1 }).lean(),
      Reading.findOne().sort({ createdAt: -1 }).lean(),
      getSettings(),
    ]);
    if (!first || !last) return res.status(404).json({ error: 'no data' });

    const energyUsed = Math.max(0, last.energy - first.energy);
    res.json({
      energyUsedKwh: energyUsed,
      latestEnergyKwh: last.energy,
      estimate: estimateCost(last.power, s.tariffPerKwh),
      since: first.createdAt,
      updatedAt: last.createdAt,
    });
  } catch (e) {
    res.status(500).json({ error: 'server error' });
  }
});

// GET /api/settings - baca pengaturan threshold & tarif
router.get('/settings', async (req, res) => {
  try {
    const s = await getSettings();
    res.json(s);
  } catch (e) {
    res.status(500).json({ error: 'server error' });
  }
});

// POST /api/settings - simpan pengaturan (validasi input - OWASP)
router.post('/settings', async (req, res) => {
  try {
    const body = req.body || {};
    const fields = ['overVoltage', 'underVoltage', 'overCurrent', 'tariffPerKwh'];
    const update = { updatedAt: new Date() };

    for (const f of fields) {
      if (body[f] !== undefined) {
        const n = Number(body[f]);
        if (!isFinite(n) || n < 0 || n > 1e9) {
          return res.status(400).json({ error: 'nilai tidak valid: ' + f });
        }
        update[f] = n;
      }
    }

    const s = await Settings.findByIdAndUpdate(
      'global', update, { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    res.json(s);
  } catch (e) {
    res.status(500).json({ error: 'server error' });
  }
});

// Inti logika factory reset (dapat diuji terpisah dari HTTP layer).
// 1) Reset Settings ke Default_Settings (atomik per-dokumen, sebelum delete).
// 2) Hapus seluruh data Reading. Kembalikan jumlah dokumen yang dihapus.
// Urutan reset-lalu-hapus menjaga konsistensi bila Settings gagal (Req 2.8, 6.4).
async function performFactoryReset() {
  await Settings.findByIdAndUpdate(
    'global',
    { $set: { ...DEFAULT_SETTINGS, updatedAt: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const result = await Reading.deleteMany({});
  return result.deletedCount || 0;
}

// 405 untuk method non-POST pada /factory-reset (Req 1.2).
router.all('/factory-reset', (req, res, next) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  next();
});

// POST /api/factory-reset - reset Settings ke default & hapus semua Reading.
// Mewarisi requireAuth + doubleCsrfProtection dari server.js (401/403).
router.post('/factory-reset', async (req, res) => {
  const operator = (req.session && req.session.username) || 'unknown';
  try {
    const deletedCount = await performFactoryReset();

    // Audit log sukses: hanya operator + outcome + timestamp (tanpa kredensial)
    console.log('[AUDIT] factory-reset OK operator=%s deleted=%d at=%s', operator, deletedCount, new Date().toISOString());

    res.status(200).json({ ok: true, deletedCount });
  } catch (e) {
    // Audit log gagal: hanya operator + outcome + timestamp (tanpa kredensial)
    console.error('[AUDIT] factory-reset FAIL operator=%s at=%s', operator, new Date().toISOString());
    // Respons error generik tanpa detail internal (OWASP - error hygiene)
    res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;
// Ekspor tambahan untuk pengujian (tidak mengubah perilaku endpoint).
module.exports.performFactoryReset = performFactoryReset;
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
