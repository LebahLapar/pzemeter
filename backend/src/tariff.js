// =====================================================================
// tariff.js - Logika tarif listrik PLN P-1/TR (instansi pemerintah)
// Tarif dasar default: Rp 1.444,70 / kWh (bisa di-override dari settings)
// =====================================================================

const TARIFF_PER_KWH = Number(process.env.TARIFF_PER_KWH || 1444.70);

// Hitung biaya dari energi total (kWh) -> Rupiah
function costFromEnergy(energyKwh, tariff = TARIFF_PER_KWH) {
  return energyKwh * tariff;
}

// Estimasi biaya per jam/hari/bulan dari daya sesaat (Watt)
// power (W) -> kW -> kWh per periode -> biaya
function estimateCost(powerWatt, tariff = TARIFF_PER_KWH) {
  const kw = powerWatt / 1000;
  const perHourKwh  = kw * 1;
  const perDayKwh   = kw * 24;
  const perMonthKwh = kw * 24 * 30;

  return {
    tariffPerKwh: tariff,
    perHour:  costFromEnergy(perHourKwh, tariff),
    perDay:   costFromEnergy(perDayKwh, tariff),
    perMonth: costFromEnergy(perMonthKwh, tariff),
  };
}

module.exports = { TARIFF_PER_KWH, costFromEnergy, estimateCost };
