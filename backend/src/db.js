// =====================================================================
// db.js - Koneksi MongoDB via mongoose
// =====================================================================
const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/pzemeter';
  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });

  console.log('[DB] MongoDB connected:', uri.replace(/\/\/.*@/, '//***@'));
  return mongoose.connection;
}

module.exports = { connectDB };
