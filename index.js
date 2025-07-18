const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const TELEGRAM_BOT_TOKEN = '7818490459:AAG-p7pp4FGVqRcFcT9QoTF8o9vVsKl_VpM';
const TELEGRAM_CHAT_ID = '1741928134';

const symbols = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT',
  'SOLUSDT', 'DOGEUSDT', 'DOTUSDT', 'LTCUSDT',
  'AVAXUSDT', 'MATICUSDT', 'LINKUSDT'
];

const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutos
const CHECK_INTERVAL_MS = 4 * 60 * 1000; // 4 minutos

const alertHistoryFile = path.resolve(__dirname, 'alertHistory.json');

// Envia mensagem para o Telegram
async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('❌ Erro ao enviar Telegram:', err.message);
  }
}

// Carrega histórico de alertas
async function loadAlertHistory() {
  try {
    const data = await fs.readFile(alertHistoryFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Salva histórico atualizado
async function saveAlertHistory(history) {
  try {
    await fs.writeFile(alertHistoryFile, JSON.stringify(history, null, 2));
  } catch (e) {
    console.error('❌ Erro ao salvar alertHistory:', e.message);
  }
}

// Simula verificação de sinais e retorna score fictício
function analisarIndicadores(symbol) {
  // TODO: Substituir com lógica real
  const scoreBuy = Math.random() * 5;
  const scoreSell = Math.random() * 5;
  return { scoreBuy, scoreSell };
}

// Avalia sinais e envia alertas com cooldown
async function checarAlertas(symbol, alertHistory) {
  const { scoreBuy, scoreSell } = analisarIndicadores(symbol);
  const now = Date.now();

  if (!alertHistory[symbol]) {
    alertHistory[symbol] = { buy: 0, sell: 0 };
  }

  // Sinal de compra
  if (scoreBuy >= 2.5) {
    if ((now - alertHistory[symbol].buy) > ALERT_COOLDOWN_MS) {
      await sendTelegramMessage(`🚀 *Compra* detectada para ${symbol}!\nScore: ${scoreBuy.toFixed(2)}`);
      alertHistory[symbol].buy = now;
      await saveAlertHistory(alertHistory);
    } else {
      console.log(`[${symbol}] Compra ignorada (cooldown ativo).`);
    }
  }

  // Sinal de venda
  if (scoreSell >= 2.5) {
    if ((now - alertHistory[symbol].sell) > ALERT_COOLDOWN_MS) {
      await sendTelegramMessage(`🛑 *Venda* detectada para ${symbol}!\nScore: ${scoreSell.toFixed(2)}`);
      alertHistory[symbol].sell = now;
      await saveAlertHistory(alertHistory);
    } else {
      console.log(`[${symbol}] Venda ignorada (cooldown ativo).`);
    }
  }

  console.log(`[${new Date().toLocaleTimeString()}] ${symbol} -> Score Compra: ${scoreBuy.toFixed(2)}, Score Venda: ${scoreSell.toFixed(2)}`);
}

// Loop principal
(async () => {
  try {
    console.log('🚀 Iniciando monitoramento...');
    const alertHistory = await loadAlertHistory();

    setInterval(async () => {
      console.log(`\n⏱ A verificar sinais em ${new Date().toLocaleString('pt-PT')}`);
      for (const symbol of symbols) {
        try {
          await checarAlertas(symbol, alertHistory);
        } catch (err) {
          console.error(`Erro ao verificar ${symbol}:`, err.message);
        }
      }
    }, CHECK_INTERVAL_MS);

  } catch (err) {
    console.error('❌ Erro ao iniciar o bot:', err.message);
  }
})();
