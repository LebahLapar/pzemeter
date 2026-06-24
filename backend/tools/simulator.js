// =====================================================================
// simulator.js - Simulator ESP32+PZEM untuk uji software TANPA hardware.
// Mem-publish payload JSON palsu ke MQTT broker (topic barka/monitor),
// persis seperti yang akan dikirim firmware ESP32 asli.
//
// Jalankan:  node tools/simulator.js
// ENV dibaca dari ../.env (sama dengan backend)
// =====================================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const mqtt = require('mqtt');

const url   = process.env.MQTT_URL || 'mqtt://broker.avisha.id:1883';
const topic = process.env.MQTT_TOPIC_DATA || 'barka/monitor';
const statusTopic = (topic.split('/')[0] || 'barka') + '/status';
const intervalMs = Number(process.env.SIM_INTERVAL_MS || 5000);

const options = {
  clientId: 'pzemeter-simulator-' + Math.random().toString(16).slice(2, 8),
  reconnectPeriod: 5000,
};
if (process.env.MQTT_USER) options.username = process.env.MQTT_USER;
if (process.env.MQTT_PASS) options.password = process.env.MQTT_PASS;

console.log('[SIM] connecting to', url);
const client = mqtt.connect(url, options);

// Energi akumulatif (kWh) yang terus naik, seperti PZEM asli
let energy = 1.0;

function randomReading() {
  // Simulasikan beban yang bervariasi (mis. kipas/charger 30-300W)
  const voltage   = 218 + Math.random() * 8;          // 218-226 V
  const power     = 30 + Math.random() * 270;         // 30-300 W
  const pf        = 0.85 + Math.random() * 0.14;       // 0.85-0.99
  const current   = power / (voltage * pf);            // I = P/(V*PF)
  const frequency = 49.8 + Math.random() * 0.4;        // ~50 Hz

  // Tambah energi: power(W)*interval(jam) -> kWh
  energy += (power / 1000) * (intervalMs / 3600000);

  return {
    device: 'pzemeter-sim',
    voltage:   +voltage.toFixed(1),
    current:   +current.toFixed(3),
    power:     +power.toFixed(1),
    energy:    +energy.toFixed(3),
    frequency: +frequency.toFixed(1),
    pf:        +pf.toFixed(2),
  };
}

client.on('connect', () => {
  console.log('[SIM] MQTT connected. Publishing to:', topic, 'tiap', intervalMs, 'ms');
  client.publish(statusTopic, 'online', { retain: true });

  const tick = () => {
    const r = randomReading();
    const payload = JSON.stringify(r);
    client.publish(topic, payload, { qos: 0 }, (err) => {
      if (err) console.error('[SIM] publish error:', err.message);
      else console.log('[SIM] ->', payload);
    });
  };

  tick();
  setInterval(tick, intervalMs);
});

client.on('error', (e) => console.error('[SIM] error:', e.message));
client.on('reconnect', () => console.log('[SIM] reconnecting...'));

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[SIM] stop. publishing offline...');
  client.publish(statusTopic, 'offline', { retain: true }, () => {
    client.end(true, () => process.exit(0));
  });
});
