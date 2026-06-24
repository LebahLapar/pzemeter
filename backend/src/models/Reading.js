// =====================================================================
// Reading.js - Schema MongoDB untuk satu pembacaan sensor PZEM
// =====================================================================
const mongoose = require('mongoose');

const readingSchema = new mongoose.Schema({
  device:    { type: String, required: true, index: true },
  voltage:   { type: Number, required: true }, // V
  current:   { type: Number, required: true }, // A
  power:     { type: Number, required: true }, // W
  energy:    { type: Number, required: true }, // kWh (akumulatif)
  frequency: { type: Number, required: true }, // Hz
  pf:        { type: Number, required: true }, // power factor
  createdAt: { type: Date, default: Date.now, index: true },
});

// Index gabungan untuk query time-series per device
readingSchema.index({ device: 1, createdAt: -1 });

module.exports = mongoose.model('Reading', readingSchema);
