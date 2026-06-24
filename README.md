# PZEMETER — Sistem Monitoring Energi Listrik Real-Time IoT

Prototipe stop kontak pintar untuk memantau 6 parameter listrik (Tegangan, Arus, Daya, Energi, Frekuensi, Faktor Daya) menggunakan **ESP32 + PZEM-004T v4**, lalu menghitung estimasi biaya berdasarkan tarif PLN P-1/TR (Rp 1.444,70/kWh). Data ditampilkan di **Bot Telegram** dan **Web Dashboard**.

Studi kasus: Diskominfo Provinsi Sumatera Selatan.

## Arsitektur

```
┌──────────┐   MQTT    ┌─────────────────────┐   Socket.IO   ┌─────────────┐
│  ESP32   │  publish  │   Backend Node.js   │ ────────────> │  Dashboard  │
│ +PZEM004T│ ────────> │ (Express+Mongo+MQTT)│               │  (Browser)  │
└──────────┘           │   + Telegram Bot    │               └─────────────┘
                       └─────────┬───────────┘
                                 │ HTTP API
                                 ▼
                          Telegram User
```

- **ESP32** hanya baca sensor + publish JSON ke MQTT (firmware ringan).
- **Backend** subscribe MQTT → simpan MongoDB → hitung biaya → broadcast ke dashboard → kirim Telegram.
- **Token Telegram disimpan di backend (.env)**, tidak di firmware — alasan keamanan.

## Struktur Folder

```
pzemeter/
├── firmware/pzemeter/        # Sketch Arduino IDE untuk ESP32
│   ├── pzemeter.ino
│   └── config.h              # Isi WiFi & MQTT di sini
├── backend/                  # Node.js (Express + MQTT + Mongo + Telegram)
│   ├── src/
│   │   ├── server.js         # entry point
│   │   ├── mqttClient.js     # subscribe MQTT
│   │   ├── db.js             # koneksi MongoDB
│   │   ├── tariff.js         # logika biaya PLN
│   │   ├── telegram.js       # bot Telegram
│   │   ├── models/Reading.js # schema data
│   │   └── routes/api.js     # REST API
│   ├── package.json
│   └── Dockerfile
├── frontend/                 # Dashboard (Vanilla JS + Bootstrap + Chart.js)
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── docker-compose.yml        # MongoDB + backend
└── .env.example
```

## Cara Menjalankan (Backend + DB)

1. Salin & isi environment:
   ```bash
   cp .env.example .env
   # edit .env: isi TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, kredensial MQTT
   # untuk login dashboard, isi juga:
   #   NODE_ENV          -> production saat di belakang HTTPS, selain itu kosong/development
   #   SESSION_SECRET    -> string acak panjang & kuat (jangan di-commit)
   #   ADMIN_USERNAME    -> username admin awal
   #   ADMIN_PASSWORD    -> password admin awal (di-hash otomatis saat seeding)
   ```

2. Jalankan dengan Docker:
   ```bash
   docker compose up -d --build
   ```

3. Buka dashboard: http://localhost:3000

> Catatan: image backend memakai base `node:20-slim` (glibc), bukan Alpine.
> Modul native `bcrypt` memakai prebuilt binary untuk glibc; di Alpine (musl)
> binary tersebut segfault (exit 139). `node:20-slim` membuatnya jalan tanpa
> kompilasi native.

## Login Dashboard & Seed Admin

Seluruh REST API (`/api/latest`, `/api/history`, `/api/stats`, `/api/settings`)
dan koneksi Socket.IO terproteksi — hanya bisa diakses setelah login.

### Seed akun admin awal

Admin awal dibuat otomatis saat backend pertama kali start, **hanya jika koleksi
`users` masih kosong** dan `ADMIN_USERNAME`/`ADMIN_PASSWORD` tersedia di `.env`.
Password disimpan sebagai hash bcrypt (tidak pernah plaintext). Kredensial tidak
di-hardcode di kode sumber.

```bash
# pastikan ADMIN_USERNAME & ADMIN_PASSWORD terisi di .env, lalu:
docker compose up -d --build
docker compose logs backend | grep SEED   # -> [SEED] Admin awal dibuat untuk username: <admin>
```

Mengganti/menambah admin: jalankan ulang seeding hanya berlaku saat koleksi
kosong. Untuk reset, hapus dokumen di koleksi `users` lalu restart backend.

### Cara login

1. Buka http://localhost:3000 — dashboard terkunci, tampil halaman login.
2. Masukkan username & password admin, klik login.
3. Setelah sukses, dashboard tampil. Tombol Logout ada di sidebar.

### Keamanan login (ringkas)

- Password di-hash bcrypt (cost 12); hash dikecualikan dari setiap respons.
- Sesi berbasis cookie `HttpOnly` + `SameSite=Strict`; `Secure` aktif di `NODE_ENV=production`. Masa berlaku 8 jam.
- Proteksi brute force: 5 gagal dalam 15 menit → akun terkunci 15 menit (429). Login juga dibatasi 20 request/menit/IP.
- Request yang mengubah state (`POST /api/settings`, logout) butuh CSRF token (`X-CSRF-Token`), diambil dari `GET /api/auth/me`.
- Login gagal selalu memberi pesan generik (tidak membocorkan field mana yang salah).

Tanpa Docker (dev lokal): butuh MongoDB jalan lokal, lalu:
```bash
cd backend && npm install && npm start
```

## Cara Flash Firmware ESP32 (Arduino IDE)

1. Install board **ESP32 by Espressif Systems** di Board Manager.
2. Install library via Library Manager:
   - `PZEM004Tv30` by Jakub Mandula (kompatibel PZEM-004T v3 **dan v4** — protokol Modbus RTU sama)
   - `PubSubClient` by Nick O'Leary
   - `ArduinoJson` by Benoit Blanchon (v6)
3. Buka `firmware/pzemeter/pzemeter.ino`, edit `config.h` (WiFi & MQTT).
4. Pilih board **ESP32 Dev Module**, baud monitor **115200**, lalu Upload.

### Wiring PZEM-004T → ESP32
| PZEM (TTL) | ESP32      |
|------------|------------|
| 5V         | 5V / VIN   |
| GND        | GND        |
| TX         | GPIO16 (RX)|
| RX         | GPIO17 (TX)|

> Sisi AC 220V (L/N PZEM + koil CT) — lihat PROJECT_PLAN.md Tahap 1. Hati-hati tegangan tinggi.

## Topik MQTT
> Broker `broker.avisha.id` membatasi tiap user pada prefix `username/#`.
> Untuk user `barka`, semua topic **wajib** diawali `barka/`.

- Data : `barka/monitor` (payload JSON)
- Status: `barka/status` (`online`/`offline`, LWT retained)

Identitas perangkat tidak ditaruh di topic, melainkan di field `device` dalam payload JSON (broker hanya mengizinkan topic flat di bawah `barka/`).

Contoh payload:
```json
{"device":"pzemeter-01","voltage":220.5,"current":0.45,"power":98.2,"energy":1.234,"frequency":50.0,"pf":0.98}
```

## Perintah Bot Telegram
- `/start` — info bot
- `/status` — data pembacaan terkini + estimasi biaya
