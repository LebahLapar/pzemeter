// =====================================================================
// server.js - Entry point backend
// Alur: MQTT subscribe -> simpan DB -> broadcast Socket.IO + Telegram
//       + serve REST API + static frontend
//
// Lapisan keamanan (Task 9 - dashboard-login):
//   helmet -> express.json -> cookie-parser -> express-session (store
//   connect-mongo) -> /api/auth publik -> CSRF + requireAuth utk /api/*
//   (default-deny) -> static frontend -> /health publik.
// =====================================================================
require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { doubleCsrf } = require('csrf-csrf');
const { Server } = require('socket.io');

const { connectDB } = require('./db');
const { initMqtt } = require('./mqttClient');
const { initTelegram, registerCommands, sendReport } = require('./telegram');
const Reading = require('./models/Reading');
const apiRoutes = require('./routes/api');
const createAuthRouter = require('./routes/auth');
const requireAuth = require('./auth/requireAuth');
const { seedAdmin } = require('./auth/seedAdmin');

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/pzemeter';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';
// Nama cookie sesi HARUS sama dengan yang dipakai auth.js untuk clearCookie.
const SESSION_COOKIE_NAME = createAuthRouter.SESSION_COOKIE_NAME;
// Masa berlaku sesi maksimal 8 jam (Req 4.4).
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
// Interval minimum antar laporan Telegram otomatis (ms)
const TG_REPORT_INTERVAL_MS = Number(process.env.TG_REPORT_INTERVAL_MS || 60000);

const app = express();
const server = http.createServer(app);
// CORS Socket.IO: di produksi batasi ke origin dashboard, di dev izinkan semua (Req 6.3).
const io = new Server(server, {
  cors: { origin: isProd ? process.env.DASHBOARD_URL : '*' },
});

// =====================================================================
// 1) helmet - header keamanan HTTP (Req 10.1)
// =====================================================================
app.use(helmet({
  contentSecurityPolicy: false, // dilonggarkan agar CDN Bootstrap/Chart.js jalan
}));

// =====================================================================
// 2) Body parser JSON (batasi ukuran payload)
// =====================================================================
app.use(express.json({ limit: '16kb' }));

// =====================================================================
// 3) cookie-parser - dibutuhkan oleh csrf-csrf & express-session
// =====================================================================
app.use(cookieParser(SESSION_SECRET));

// =====================================================================
// 4) express-session + connect-mongo (Req 4.1-4.4)
//    - HttpOnly + SameSite=Strict selalu aktif
//    - Secure HANYA di production (Req 4.2/4.3)
//    - maxAge 8 jam (Req 4.4); TTL store mengikuti maxAge
//    - name disamakan dengan SESSION_COOKIE_NAME (kontrak dgn auth.js)
// =====================================================================
const sessionMiddleware = session({
  name: SESSION_COOKIE_NAME,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGO_URI,
    ttl: SESSION_MAX_AGE_MS / 1000, // detik
    collectionName: 'sessions',
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    maxAge: SESSION_MAX_AGE_MS,
  },
});
app.use(sessionMiddleware);
// Diekspor agar Task 10 (Socket.IO) dapat membagikan session middleware.
app.set('sessionMiddleware', sessionMiddleware);

// =====================================================================
// 4b) Proteksi Socket.IO (Req 6.1, 6.2)
//    - Bagikan session middleware yang sama ke engine Socket.IO agar
//      socket.request.session terisi dari cookie sesi.
//    - Guard io.use menolak koneksi tanpa session.userId valid SEBELUM
//      event data apa pun dikirim ke klien.
// =====================================================================
io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const s = socket.request.session;
  if (s && s.userId) return next();
  next(new Error('unauthorized'));
});

// =====================================================================
// 5) Proteksi CSRF double-submit cookie (csrf-csrf v3) (Req 7)
//    - Cookie CSRF: HttpOnly, SameSite=Strict, Secure hanya di prod.
//    - doubleCsrfProtection mengabaikan GET/HEAD/OPTIONS, jadi hanya
//      request yang mengubah state (POST/PUT/DELETE) yang divalidasi.
//    - Token diambil dari header 'x-csrf-token'.
// =====================================================================
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => SESSION_SECRET,
  // Ikat token ke sesi agar tidak bisa dipakai lintas sesi.
  getSessionIdentifier: (req) => (req.session && req.session.id) || '',
  cookieName: isProd ? '__Host-psifi.x-csrf-token' : 'psifi.x-csrf-token',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    path: '/',
  },
  getTokenFromRequest: (req) => req.headers['x-csrf-token'],
});

// =====================================================================
// 6) Mount /api/auth
//    - /api/auth/login & /api/auth/me  : PUBLIK (login rate-limited).
//    - /api/auth/logout                : butuh sesi (requireAuth) + CSRF.
//      Karena seluruh router auth di-mount sebelum proteksi global,
//      proteksi logout dipasang eksplisit pada path-nya (Req 7.1, 8.x).
// =====================================================================
app.use('/api/auth/logout', requireAuth, doubleCsrfProtection);
app.use('/api/auth', createAuthRouter(generateToken));

// =====================================================================
// 7) Proteksi sisa /api/* : default-deny (Req 5.3, 5.5) + CSRF (Req 7.1)
//    - requireAuth menolak tanpa sesi valid -> 401.
//    - doubleCsrfProtection memvalidasi request state-changing -> 403.
//    - GET (latest/history/stats/settings) hanya butuh sesi.
//    - POST /api/settings butuh sesi + CSRF token valid.
// =====================================================================
app.use('/api', requireAuth, doubleCsrfProtection, apiRoutes);

// =====================================================================
// 8) Static frontend - index.html tetap diserve tanpa auth (keputusan
//    desain: shell HTML tidak membocorkan data; gating di frontend).
// =====================================================================
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

// =====================================================================
// 9) /health - publik (Req 5.4)
// =====================================================================
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// =====================================================================
// Error handler terpusat (Req 7.2, 10.2)
//   - Error CSRF -> 403 generik.
//   - Lainnya    -> 500 generik tanpa stack trace ke klien.
// =====================================================================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'invalid csrf token' });
  }
  // Hanya log pesan, jangan kirim detail/stack ke klien (Req 10.2).
  console.error('[ERR]', err && err.message);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'server error' });
});

// ---------- Bootstrap ----------
let lastTgReport = 0;

async function main() {
  await connectDB();

  // Seed admin awal bila koleksi user kosong & kredensial env tersedia (Req 2.4).
  await seedAdmin();

  initTelegram();
  registerCommands(async () => {
    return Reading.findOne().sort({ createdAt: -1 }).lean();
  });

  // Saat ada reading baru dari MQTT
  initMqtt((reading) => {
    // Broadcast realtime ke dashboard
    io.emit('reading', reading);

    // Kirim laporan Telegram dengan throttle interval
    const now = Date.now();
    if (now - lastTgReport >= TG_REPORT_INTERVAL_MS) {
      lastTgReport = now;
      sendReport(reading);
    }
  });

  io.on('connection', (socket) => {
    console.log('[IO] client connected:', socket.id);
  });

  server.listen(PORT, () => {
    console.log('[HTTP] server listening on port', PORT);
  });
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
