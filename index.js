const axios = require('axios');
const ti = require('technicalindicators');
const fs = require('fs').promises;
const path = require('path');

const TELEGRAM_BOT_TOKEN = '7818490459:AAG-p7pp4FGVqRcFcT9QoTF8o9vVsKl_VpM';
const TELEGRAM_CHAT_ID = '1741928134';

const symbols = [/*...seus símbolos...*/];
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutos

const alertHistoryFile = path.resolve(__dirname, 'alertHistory.json');

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('Erro ao enviar Telegram:', err.message);
  }
}

async function loadAlertHistory() {
  try {
    const data = await fs.readFile(alertHistoryFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveAlertHistory(history) {
  try {
    await fs.writeFile(alertHistoryFile, JSON.stringify(history, null, 2));
  } catch (e) {
    console.error('Erro ao salvar alertHistory:', e.message);
  }
}

async function checarAlertas(symbol, alertHistory) {
  // ... seu cálculo do scoreBuy e scoreSell

  const now = Date.now();

  // Assegura que o objeto existe
  if (!alertHistory[symbol]) {
    alertHistory[symbol] = { buy: 0, sell: 0 };
  }

  // Verifica cooldown para compra
  if (scoreBuy >= 2.5) {
    const lastBuy = alertHistory[symbol].buy || 0;
    if ((now - lastBuy) > ALERT_COOLDOWN_MS) {
      // Envia alerta compra
      await sendTelegramMessage(`🚀 Compra detectada para ${symbol} ...`);
      alertHistory[symbol].buy = now;
      await saveAlertHistory(alertHistory);
    } else {
      console.log(`Alerta compra para ${symbol} ignorado (cooldown).`);
    }
  }

  // Verifica cooldown para venda
  if (scoreSell >= 2.5) {
    const lastSell = alertHistory[symbol].sell || 0;
    if ((now - lastSell) > ALERT_COOLDOWN_MS) {
      // Envia alerta venda
      await sendTelegramMessage(`🛑 Venda detectada para ${symbol} ...`);
      alertHistory[symbol].sell = now;
      await saveAlertHistory(alertHistory);
    } else {
      console.log(`Alerta venda para ${symbol} ignorado (cooldown).`);
    }
  }
}

(async () => {
  const alertHistory = await loadAlertHistory();

  setInterval(async () => {
    for (const symbol of symbols) {
      try {
        await checarAlertas(symbol, alertHistory);
      } catch (e) {
        console.error(`Erro em ${symbol}:`, e.message);
      }
    }
  }, 60 * 1000);
})();
