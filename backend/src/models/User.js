// =====================================================================
// User.js - Schema MongoDB untuk akun admin dashboard.
// Menyimpan kredensial login (hash bcrypt) + state proteksi brute force.
// passwordHash dikecualikan dari query default (select:false) demi keamanan.
// =====================================================================
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254, // batas panjang username (Req 1.6)
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // jangan ikut terbawa pada query default (Req 2.3)
    },
    failedAttempts: {
      type: Number,
      default: 0, // penghitung percobaan login gagal (Req 3)
    },
    lastFailedAt: {
      type: Date, // waktu gagal terakhir, untuk window bergulir 15 menit (Req 3.1)
    },
    lockUntil: {
      type: Date,
      default: null, // waktu berakhirnya Account_Lock; null = tidak ter-lock (Req 3.2)
    },
  },
  {
    timestamps: true, // createdAt & updatedAt otomatis
  }
);

module.exports = mongoose.model('User', userSchema);
