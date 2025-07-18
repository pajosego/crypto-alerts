require('dotenv').config();
const axios = require("axios");
const { RSI, MACD, ADX, EMA, ATR } = require("technicalindicators");
const TelegramBot = require("node-telegram-bot-api");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT",
  "SOLUSDT", "DOGEUSDT", "DOTUSDT", "LTCUSDT",
  "AVAXUSDT", "MATICUSDT", "LINKUSDT"
];

const INTERVALS = {
  rsi: "5m",
  macd: "30m",
  adx: "30m",
  ema: "4h",
  atr: "5m"
};

const API_URL = "https://api.binance.com/api/v3/klines";

const ALERT_SCORE_THRESHOLD = 3.5;
const ALERT_COOLDOWN = 30 * 60 * 1000; // 30 min

const lastAlerts = {};

// Função para arredondar valores para 6 casas decimais
function round6(value) {
  return +(value.toFixed(6));
}

// Agora canSendAlert também considera entry, sl, tp para evitar alertas repetidos com valores "quase iguais"
function canSendAlert(symbol, tipo, entry, sl, tp) {
  const now = Date.now();
  if (!lastAlerts[symbol]) lastAlerts[symbol] = {};
  
  // Cria uma chave combinada com valores para evitar alertas iguais repetidos
  const alertKey = `${tipo}_${entry}_${sl}_${tp}`;

  if (!lastAlerts[symbol][alertKey] || now - lastAlerts[symbol][alertKey] > ALERT_COOLDOWN) {
    lastAlerts[symbol][alertKey] = now;
    return true;
  }
  return false;
}

function calculateTP(entry, atr, factor = 1.5) {
  return +(entry + factor * atr);
}

function calculateSL(entry, atr, factor = 1) {
  return +(entry - factor * atr);
}

async function fetchCandles(symbol, interval, limit = 100) {
  const url = `${API_URL}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await axios.get(url);
  return res.data.map(c => ({
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4])
  }));
}

async function analyzeSymbol(symbol) {
  try {
    const [candlesRSI, candlesMACD, candlesADX, candlesEMA, candlesATR] = await Promise.all([
      fetchCandles(symbol, INTERVALS.rsi),
      fetchCandles(symbol, INTERVALS.macd),
      fetchCandles(symbol, INTERVALS.adx),
      fetchCandles(symbol, INTERVALS.ema, 200),
      fetchCandles(symbol, INTERVALS.atr)
    ]);

    const closeRSI = candlesRSI.map(c => c.close);
    const closeMACD = candlesMACD.map(c => c.close);
    const closeEMA = candlesEMA.map(c => c.close);
    const highADX = candlesADX.map(c => c.high);
    const lowADX = candlesADX.map(c => c.low);
    const closeADX = candlesADX.map(c => c.close);
    const highATR = candlesATR.map(c => c.high);
    const lowATR = candlesATR.map(c => c.low);
    const closeATR = candlesATR.map(c => c.close);

    const closePrice = closeRSI[closeRSI.length - 1];

    const rsi = RSI.calculate({ period: 14, values: closeRSI });
    const macd = MACD.calculate({
      values: closeMACD,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
    const adx = ADX.calculate({
      close: closeADX,
      high: highADX,
      low: lowADX,
      period: 14
    });
    const ema = EMA.calculate({ period: 200, values: closeEMA });
    const atr = ATR.calculate({
      high: highATR,
      low: lowATR,
      close: closeATR,
      period: 14
    });

    const lastRSI = rsi[rsi.length - 1];
    const lastMACD = macd[macd.length - 1];
    const lastADX = adx[adx.length - 1];
    const lastEMA = ema[ema.length - 1];
    const lastATR = atr[atr.length - 1] || 0;

    const isUpTrend = closePrice > lastEMA;
    const isDownTrend = closePrice < lastEMA;
    const adxStrong = lastADX && lastADX.adx >= 25;

    let scoreCompra = 0;
    if (lastRSI < 30) scoreCompra += 1.5;
    if (lastMACD.MACD > lastMACD.signal) scoreCompra += 1.5;
    if (isUpTrend) scoreCompra += 1;
    if (adxStrong) scoreCompra += 1;

    let scoreVenda = 0;
    if (lastRSI > 70) scoreVenda += 1.5;
    if (lastMACD.MACD < lastMACD.signal) scoreVenda += 1.5;
    if (isDownTrend) scoreVenda += 1;
    if (adxStrong) scoreVenda += 1;

    if (scoreCompra >= ALERT_SCORE_THRESHOLD) {
      const entry = round6(closePrice);
      const sl = round6(calculateSL(entry, lastATR));
      const tp = round6(calculateTP(entry, lastATR));
      if (canSendAlert(symbol, "compra", entry, sl, tp)) {
        sendTelegramAlert(symbol, "compra", entry, sl, tp, lastRSI, lastMACD, lastADX, scoreCompra);
      }
    } else if (scoreVenda >= ALERT_SCORE_THRESHOLD) {
      const entry = round6(closePrice);
      const sl = round6(calculateSL(entry, lastATR));
      const tp = round6(calculateTP(entry, lastATR));
      if (canSendAlert(symbol, "venda", entry, sl, tp)) {
        sendTelegramAlert(symbol, "venda", entry, sl, tp, lastRSI, lastMACD, lastADX, scoreVenda);
      }
    } else {
      console.log(`[${symbol}] Nenhum sinal forte. Scores: Compra=${scoreCompra.toFixed(2)}, Venda=${scoreVenda.toFixed(2)}`);
    }
  } catch (err) {
    console.error(`Erro ao analisar ${symbol}:`, err.message);
  }
}

function sendTelegramAlert(symbol, tipo, entry, sl, tp, rsi, macd, adx, score) {
  const emoji = tipo === "compra" ? "🚀" : "🛑";
  const msg = `${emoji} ${tipo.toUpperCase()} detectada para ${symbol}!
Entrada: ${entry.toFixed(6)}
Stop Loss: ${sl.toFixed(6)}
Take Profit: ${tp.toFixed(6)}
RSI5m: ${rsi.toFixed(2)}
MACD30m: ${macd.MACD.toFixed(4)} ${tipo === "compra" ? ">" : "<"} ${macd.signal.toFixed(4)}
ADX30m: ${adx.adx.toFixed(2)}
Score: ${score.toFixed(2)}`;

  bot.sendMessage(CHAT_ID, msg).catch(e => console.error("Erro Telegram:", e.message));
  console.log(`[${new Date().toLocaleTimeString()}] Alerta enviado: ${symbol} (${tipo.toUpperCase()}) Score: ${score.toFixed(2)}`);
}

async function monitorar() {
  console.log("Iniciando monitoramento...");
  for (const symbol of SYMBOLS) {
    await analyzeSymbol(symbol);
  }
  console.log("Monitoramento concluído.");
}

setInterval(monitorar, 10 * 60 * 1000);
monitorar();

// Evita encerramento automático no Railway
process.stdin.resume();
