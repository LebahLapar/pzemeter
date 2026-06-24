// =====================================================================
// telegram.js - Integrasi Telegram Bot (kirim laporan monitoring)
// Library: node-telegram-bot-api
// Token & chat id diambil dari ENV (tidak di-hardcode) -> OWASP A02
// =====================================================================
const TelegramBot = require('node-telegram-bot-api');
const { estimateCost } = require('./tariff');

let bot = null;
let chatId = null;
const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';

function initTelegram() {
  const token = process.env.TELEGRAM_TOKEN;
  chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[TG] TELEGRAM_TOKEN / TELEGRAM_CHAT_ID belum diset. Telegram dimatikan.');
    return null;
  }

  // polling:true agar bot bisa merespon command (/status dll)
  bot = new TelegramBot(token, { polling: true });
  console.log('[TG] Telegram bot aktif');
  return bot;
}

// Registrasi handler command. getLatest = async () => readingDoc|null
function registerCommands(getLatest) {
  if (!bot) return;

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
      'Selamat datang di *Bot Monitoring Listrik Diskominfo Sumsel*.\n' +
      'Ketik /status untuk melihat data terkini.',
      { parse_mode: 'Markdown' });
  });

  bot.onText(/\/status/, async (msg) => {
    const latest = await getLatest();
    if (!latest) {
      bot.sendMessage(msg.chat.id, 'Belum ada data pembacaan.');
      return;
    }
    bot.sendMessage(msg.chat.id, formatReport(latest), {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  });
}

// Format laporan rapi (Markdown) + hyperlink ke dashboard
function formatReport(r) {
  const cost = estimateCost(r.power);
  const rupiah = (n) =>
    'Rp ' + Math.round(n).toLocaleString('id-ID');
  const waktu = new Date(r.createdAt).toLocaleString('id-ID', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta',
  });

  return (
    '⚡ *LAPORAN MONITORING LISTRIK*\n' +
    '_Diskominfo Provinsi Sumatera Selatan_\n' +
    '────────────────────\n' +
    '🕒 ' + waktu + ' WIB\n\n' +
    '🔌 Tegangan   : *' + r.voltage.toFixed(1) + ' V*\n' +
    '🔋 Arus       : *' + r.current.toFixed(3) + ' A*\n' +
    '💡 Daya       : *' + r.power.toFixed(1) + ' W*\n' +
    '📊 Energi     : *' + r.energy.toFixed(3) + ' kWh*\n' +
    '📶 Frekuensi  : *' + r.frequency.toFixed(1) + ' Hz*\n' +
    '⚙️ Faktor Daya: *' + r.pf.toFixed(2) + '*\n' +
    '────────────────────\n' +
    '💰 *ESTIMASI BIAYA* (tarif ' + rupiah(cost.tariffPerKwh) + '/kWh)\n' +
    '• Per Jam  : ' + rupiah(cost.perHour) + '\n' +
    '• Per Hari : ' + rupiah(cost.perDay) + '\n' +
    '• Per Bulan: ' + rupiah(cost.perMonth) + '\n' +
    '────────────────────\n' +
    '🌐 [Buka Web Dashboard](' + dashboardUrl + ')'
  );
}

// Kirim laporan otomatis ke chat utama
function sendReport(reading) {
  if (!bot || !chatId) return;
  bot.sendMessage(chatId, formatReport(reading), {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  }).catch((e) => console.error('[TG] gagal kirim:', e.message));
}

module.exports = { initTelegram, registerCommands, sendReport, formatReport };
