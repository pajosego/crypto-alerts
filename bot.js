const { Telegraf } = require('telegraf');
const fs = require('fs');

// ⚠️ Substitui pelo token do teu bot
const BOT_TOKEN = '7818490459:AAG-p7pp4FGVqRcFcT9QoTF8o9vVsKl_VpM';
const CHAT_ID = '1741928134';

const bot = new Telegraf(BOT_TOKEN);

// Permite enviar mensagens de qualquer parte
function sendTelegramMessage(msg) {
  if (CHAT_ID && BOT_TOKEN) {
    bot.telegram.sendMessage(CHAT_ID, msg).catch(err => {
      console.error('Erro ao enviar mensagem:', err.message);
    });
  }
}

module.exports = { sendTelegramMessage };
