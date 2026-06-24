// =====================================================================
// requireAuth.js - Middleware Express penjaga endpoint terproteksi.
//
// Logika sederhana (prosedural):
//   - Jika ada sesi aktif dengan req.session.userId  -> lanjut (next()).
//   - Selain itu                                      -> 401 unauthorized.
//
// Dipasang di level router /api SETELAH daftar endpoint publik sehingga
// menerapkan default-deny: endpoint baru otomatis terproteksi (Req 5.5).
//
// Req 5.1: request dengan sesi valid diteruskan ke handler.
// Req 5.2: request tanpa sesi valid ditolak 401 dan tidak mengembalikan
//          data monitoring apa pun.
// =====================================================================

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: 'unauthorized' });
}

module.exports = requireAuth;
