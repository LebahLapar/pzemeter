// =====================================================================
// mqttClient.js - Subscribe data sensor dari MQTT broker
// Library: mqtt (MQTT.js)
// =====================================================================
const mqtt = require('mqtt');
const Reading = require('./models/Reading');

const TOPIC_DATA = process.env.MQTT_TOPIC_DATA || 'pzemeter/+/data';

// onReading: callback(readingDoc) untuk broadcast realtime & telegram
function initMqtt(onReading) {
  const url = process.env.MQTT_URL || 'mqtt://broker.avisha.id:1883';

  const options = {
    clientId: 'pzemeter-backend-' + Math.random().toString(16).slice(2, 8),
    reconnectPeriod: 5000,
  };
  if (process.env.MQTT_USER) options.username = process.env.MQTT_USER;
  if (process.env.MQTT_PASS) options.password = process.env.MQTT_PASS;

  const client = mqtt.connect(url, options);

  client.on('connect', () => {
    console.log('[MQTT] Connected:', url);
    client.subscribe(TOPIC_DATA, { qos: 0 }, (err) => {
      if (err) console.error('[MQTT] subscribe error:', err.message);
      else console.log('[MQTT] Subscribed:', TOPIC_DATA);
    });
  });

  client.on('reconnect', () => console.log('[MQTT] reconnecting...'));
  client.on('error', (e) => console.error('[MQTT] error:', e.message));

  client.on('message', async (topic, message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      console.warn('[MQTT] payload bukan JSON valid, diabaikan');
      return;
    }

    // Validasi field wajib (input validation - OWASP)
    const required = ['voltage', 'current', 'power', 'energy', 'frequency', 'pf'];
    for (const f of required) {
      if (typeof data[f] !== 'number' || !isFinite(data[f])) {
        console.warn('[MQTT] field tidak valid:', f);
        return;
      }
    }

    try {
      const reading = await Reading.create({
        device:    String(data.device || 'unknown').slice(0, 64),
        voltage:   data.voltage,
        current:   data.current,
        power:     data.power,
        energy:    data.energy,
        frequency: data.frequency,
        pf:        data.pf,
      });
      console.log('[MQTT] Reading saved:', reading.device, reading.power + 'W');
      if (onReading) onReading(reading);
    } catch (e) {
      console.error('[DB] gagal simpan reading:', e.message);
    }
  });

  return client;
}

module.exports = { initMqtt };
