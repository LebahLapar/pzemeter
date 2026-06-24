// =====================================================================
// config.example.h - TEMPLATE konfigurasi.
// Salin file ini menjadi "config.h" lalu isi nilai aslinya.
//   (config.h asli di-ignore git agar kredensial tidak ter-commit)
// (Token Telegram TIDAK disimpan di sini - dikirim dari sisi backend)
// =====================================================================
#ifndef CONFIG_H
#define CONFIG_H

// ---------- WiFi ----------
#define WIFI_SSID       "GANTI_NAMA_WIFI"
#define WIFI_PASSWORD   "GANTI_PASSWORD_WIFI"

// ---------- MQTT Broker ----------
#define MQTT_HOST       "broker.avisha.id"
#define MQTT_PORT       1883
// Kosongkan ("") bila broker tidak butuh autentikasi
#define MQTT_USER       "GANTI_USER_MQTT"
#define MQTT_PASS       "GANTI_PASS_MQTT"

// ID unik perangkat. Dipakai sbg MQTT client id + label "device" di payload JSON.
#define DEVICE_ID       "pzemeter-01"

// PENTING: broker membatasi setiap user pada topic "username/#".
// Jadi SEMUA topic WAJIB diawali prefix username (mis. "barka/").
#define MQTT_TOPIC_DATA   "barka/monitor"
#define MQTT_TOPIC_STATUS "barka/status"

// ---------- Interval ----------
#define PUBLISH_INTERVAL_MS  5000UL

#endif // CONFIG_H
