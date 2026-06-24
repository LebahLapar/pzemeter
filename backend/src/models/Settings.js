// =====================================================================
// Settings.js - Pengaturan sistem (threshold & tarif). Single document.
// Disimpan di MongoDB agar persist & bisa diubah dari dashboard.
// =====================================================================
const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  // _id tetap "global" supaya hanya ada 1 dokumen pengaturan
  _id:               { type: String, default: 'global' },
  overVoltage:       { type: Number, default: 250 },   // V - batas tegangan tinggi
  underVoltage:      { type: Number, default: 180 },   // V - batas tegangan rendah
  overCurrent:       { type: Number, default: 10 },    // A - batas arus
  tariffPerKwh:      { type: Number, default: 1444.70 }, // Rp/kWh
  updatedAt:         { type: Date, default: Date.now },
});

module.exports = mongoose.model('Settings', settingsSchema);
