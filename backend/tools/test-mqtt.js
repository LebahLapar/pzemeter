// =====================================================================
// test-mqtt.js - Uji koneksi & round-trip ke broker MQTT asli.
// Publish 1 pesan ke barka/monitor lalu pastikan kita menerimanya kembali
// (subscribe topic yang sama). Membuktikan kredensial & broker bekerja.
// Jalankan: node tools/test-mqtt.js
// =====================================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const mqtt = require('mqtt');

const url   = process.env.MQTT_URL || 'mqtt://broker.avisha.id:1883';
const topic = process.env.MQTT_TOPIC_DATA || 'barka/monitor';

const options = {
  clientId: 'pzemeter-test-' + Math.random().toString(16).slice(2, 8),
  connectTimeout: 8000,
  reconnectPeriod: 0, // jangan retry; ini test sekali jalan
};
if (process.env.MQTT_USER) options.username = process.env.MQTT_USER;
if (process.env.MQTT_PASS) options.password = process.env.MQTT_PASS;

console.log('[TEST] connecting to', url, 'as user:', options.username || '(none)');

const client = mqtt.connect(url, options);
const token = 'ping-' + Date.now();
let timer = setTimeout(() => {
  console.error('[TEST] GAGAL: timeout, tidak menerima pesan balik dalam 10s');
  client.end(true, () => process.exit(1));
}, 10000);

client.on('connect', () => {
  console.log('[TEST] ✓ CONNECTED ke broker');
  client.subscribe(topic, (err) => {
    if (err) {
      console.error('[TEST] GAGAL subscribe:', err.message);
      process.exit(1);
    }
    console.log('[TEST] ✓ subscribed:', topic);
    const msg = JSON.stringify({ test: token });
    client.publish(topic, msg, (e) => {
      if (e) console.error('[TEST] publish error:', e.message);
      else console.log('[TEST] ✓ published test message');
    });
  });
});

client.on('message', (t, payload) => {
  const body = payload.toString();
  if (body.includes(token)) {
    clearTimeout(timer);
    console.log('[TEST] ✓ ROUND-TRIP OK: pesan diterima kembali dari', t);
    console.log('[TEST] BERHASIL. Broker & kredensial valid.');
    client.end(true, () => process.exit(0));
  }
});

client.on('error', (e) => {
  console.error('[TEST] ✗ ERROR:', e.message);
  clearTimeout(timer);
  client.end(true, () => process.exit(1));
});
