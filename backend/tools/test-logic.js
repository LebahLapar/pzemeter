// =====================================================================
// test-logic.js - Uji logika murni (tarif + format Telegram) TANPA jaringan.
// Jalankan: node tools/test-logic.js
// =====================================================================
const assert = require('assert');

// Set ENV sebelum require module yang membacanya
process.env.TARIFF_PER_KWH = '1444.70';

const { estimateCost, costFromEnergy, TARIFF_PER_KWH } = require('../src/tariff');
const { formatReport } = require('../src/telegram');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
    passed++;
  } catch (e) {
    console.error('  ✗', name, '\n     ', e.message);
    process.exitCode = 1;
  }
}

console.log('TEST: tariff.js');

check('tarif terbaca 1444.70', () => {
  assert.strictEqual(TARIFF_PER_KWH, 1444.70);
});

check('costFromEnergy: 1 kWh = Rp 1444.70', () => {
  assert.strictEqual(costFromEnergy(1), 1444.70);
});

check('estimateCost 1000W: perHour = 1 kWh * tarif', () => {
  const c = estimateCost(1000);
  assert.strictEqual(Math.round(c.perHour), 1445);
});

check('estimateCost 1000W: perDay = 24x perHour', () => {
  const c = estimateCost(1000);
  assert.ok(Math.abs(c.perDay - c.perHour * 24) < 0.01);
});

check('estimateCost 1000W: perMonth = 30x perDay', () => {
  const c = estimateCost(1000);
  assert.ok(Math.abs(c.perMonth - c.perDay * 30) < 0.01);
});

check('estimateCost 0W: semua biaya nol', () => {
  const c = estimateCost(0);
  assert.strictEqual(c.perHour, 0);
  assert.strictEqual(c.perMonth, 0);
});

console.log('TEST: telegram.js formatReport');

const sample = {
  device: 'pzemeter-sim',
  voltage: 220.5, current: 0.45, power: 98.2,
  energy: 1.234, frequency: 50.0, pf: 0.98,
  createdAt: new Date('2026-06-23T10:00:00Z'),
};

check('formatReport mengandung 6 parameter', () => {
  const s = formatReport(sample);
  assert.ok(s.includes('220.5 V'));
  assert.ok(s.includes('0.450 A') || s.includes('0.45'));
  assert.ok(s.includes('98.2 W'));
  assert.ok(s.includes('1.234 kWh'));
  assert.ok(s.includes('50.0 Hz'));
  assert.ok(s.includes('0.98'));
});

check('formatReport mengandung estimasi biaya & link dashboard', () => {
  const s = formatReport(sample);
  assert.ok(s.includes('ESTIMASI BIAYA'));
  assert.ok(s.includes('Per Jam'));
  assert.ok(s.includes('Per Bulan'));
  assert.ok(s.toLowerCase().includes('dashboard'));
});

console.log('\nSelesai. ' + passed + ' test lolos.');
