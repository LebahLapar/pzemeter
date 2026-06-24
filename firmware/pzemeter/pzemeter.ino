// =====================================================================
// pzemeter.ino - Firmware ESP32 DevKit V1 + PZEM-004T v3/v4
// Fungsi : Baca 6 parameter listrik -> publish JSON ke MQTT
// Style  : Arduino IDE, prosedural, non-blocking (millis)
//
// LIBRARY YANG DIBUTUHKAN (install via Library Manager Arduino IDE):
//   - "PZEM004Tv30" by Jakub Mandula   (kompatibel v3 & v4 modbus)
//   - "PubSubClient" by Nick O'Leary   (MQTT)
//   - "ArduinoJson"  by Benoit Blanchon (v6.x)
//   - WiFi.h          (bawaan core ESP32)
//
// Board: "ESP32 Dev Module" (install ESP32 by Espressif Systems)
// =====================================================================

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <PZEM004Tv30.h>
#include "config.h"

// ---------- Deklarasi Pin (UART2 hardware serial ESP32) ----------
#define PZEM_RX_PIN   16   // RX ESP32 <- TX PZEM
#define PZEM_TX_PIN   17   // TX ESP32 -> RX PZEM
#define LED_PIN        2   // LED onboard untuk indikator status

// ---------- Objek global ----------
// PZEM memakai Serial2 (UART2) ESP32
PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);

WiFiClient   espClient;
PubSubClient mqtt(espClient);

// ---------- Variabel waktu (non-blocking) ----------
unsigned long lastPublish    = 0;
unsigned long lastReconnect  = 0;
const unsigned long RECONNECT_INTERVAL_MS = 5000UL;

// =====================================================================
// SETUP
// =====================================================================
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println();
  Serial.println("=== PZEMETER ESP32 BOOTING ===");

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // UART2 untuk PZEM
  Serial2.begin(9600, SERIAL_8N1, PZEM_RX_PIN, PZEM_TX_PIN);

  connectWiFi();

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(512); // payload JSON bisa > default 256 byte
}

// =====================================================================
// LOOP
// =====================================================================
void loop() {
  // Jaga koneksi WiFi
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // Jaga koneksi MQTT (non-blocking reconnect)
  if (!mqtt.connected()) {
    unsigned long now = millis();
    if (now - lastReconnect >= RECONNECT_INTERVAL_MS) {
      lastReconnect = now;
      connectMQTT();
    }
  } else {
    mqtt.loop();
  }

  // Publish data sesuai interval
  unsigned long now = millis();
  if (now - lastPublish >= PUBLISH_INTERVAL_MS) {
    lastPublish = now;
    readAndPublish();
  }
}

// =====================================================================
// WiFi
// =====================================================================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("WiFi: connecting to ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000UL) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("WiFi Connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println();
    Serial.println("WiFi FAILED (akan retry di loop)");
  }
}

// =====================================================================
// MQTT
// =====================================================================
void connectMQTT() {
  Serial.print("MQTT: connecting to ");
  Serial.print(MQTT_HOST);
  Serial.print(":");
  Serial.println(MQTT_PORT);

  bool ok;
  // LWT: broker akan kirim "offline" ke topic status bila device putus
  if (strlen(MQTT_USER) > 0) {
    ok = mqtt.connect(DEVICE_ID, MQTT_USER, MQTT_PASS,
                      MQTT_TOPIC_STATUS, 1, true, "offline");
  } else {
    ok = mqtt.connect(DEVICE_ID, NULL, NULL,
                      MQTT_TOPIC_STATUS, 1, true, "offline");
  }

  if (ok) {
    Serial.println("MQTT Connected");
    mqtt.publish(MQTT_TOPIC_STATUS, "online", true); // retained
    digitalWrite(LED_PIN, HIGH);
  } else {
    Serial.print("MQTT FAILED, rc=");
    Serial.println(mqtt.state());
    digitalWrite(LED_PIN, LOW);
  }
}

// =====================================================================
// Baca PZEM + Publish JSON
// =====================================================================
void readAndPublish() {
  float voltage   = pzem.voltage();
  float current   = pzem.current();
  float power     = pzem.power();
  float energy    = pzem.energy();
  float frequency = pzem.frequency();
  float pf        = pzem.pf();

  // PZEM gagal baca -> hasil NaN
  if (isnan(voltage) || isnan(current) || isnan(power) ||
      isnan(energy)  || isnan(frequency) || isnan(pf)) {
    Serial.println("PZEM: gagal baca sensor (NaN). Cek wiring TTL & beban.");
    return;
  }

  Serial.printf("V=%.1f A=%.3f W=%.1f kWh=%.3f Hz=%.1f PF=%.2f\n",
                voltage, current, power, energy, frequency, pf);

  // Susun JSON (ArduinoJson v6)
  StaticJsonDocument<256> doc;
  doc["device"]    = DEVICE_ID;
  doc["voltage"]   = voltage;
  doc["current"]   = current;
  doc["power"]     = power;
  doc["energy"]    = energy;
  doc["frequency"] = frequency;
  doc["pf"]        = pf;

  char payload[256];
  size_t n = serializeJson(doc, payload);

  if (mqtt.connected()) {
    if (mqtt.publish(MQTT_TOPIC_DATA, payload, n)) {
      Serial.print("MQTT Published -> ");
      Serial.println(MQTT_TOPIC_DATA);
    } else {
      Serial.println("MQTT publish GAGAL");
    }
  } else {
    Serial.println("MQTT belum connect, data dilewati");
  }
}
