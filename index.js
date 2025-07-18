// index.js
const axios = require("axios");
const { RSI, MACD, ADX, EMA } = require("technicalindicators");
const TelegramBot = require("node-telegram-bot-api");

const TELEGRAM_TOKEN = "7818490459:AAG-p7pp4FGVqRcFcT9QoTF8o9vVsKl_VpM";
const CHAT_ID = "1741928134";
const bot = new TelegramBot(TELEGRAM_TOKEN);

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT",
  "SOLUSDT", "DOGEUSDT", "DOTUSDT", "LTCUSDT",
  "AVAXUSDT", "MATICUSDT", "LINKUSDT"
];

const INTERVALS = {
  rsi: "5m",
  macd: "30m",
  adx: "30m",
  ema: "4h"
};

const API_URL = "https://api.binance.com/api/v3/klines";

async function fetchCandles(symbol, interval, limit = 100) {
  const url = `${API_URL}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await axios.get(url);
  return res.data.map(candle => parseFloat(candle[4]));
}

function calculateTP(price, percent = 2.5) {
  return +(price + (price * percent / 100)).toFixed(4);
}

function calculateSL(price, percent = 2.5) {
  return +(price - (price * percent / 100)).toFixed(4);
}

async function analyzeSymbol(symbol) {
  try {
    const rsiPrices = await fetchCandles(symbol, INTERVALS.rsi);
    const macdPrices = await fetchCandles(symbol, INTERVALS.macd);
    const adxPrices = await fetchCandles(symbol, INTERVALS.adx);
    const emaPrices = await fetchCandles(symbol, INTERVALS.ema);

    const closePrice = rsiPrices[rsiPrices.length - 1];

    const rsi = RSI.calculate({ period: 14, values: rsiPrices });
    const macd = MACD.calculate({
      values: macdPrices,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
    const adx = ADX.calculate({ close: adxPrices, high: adxPrices, low: adxPrices, period: 14 });
    const ema = EMA.calculate({ period: 200, values: emaPrices });

    const lastRSI = rsi[rsi.length - 1];
    const lastMACD = macd[macd.length - 1];
    const lastADX = adx[adx.length - 1];
    const lastEMA = ema[ema.length - 1];

    const entry = closePrice;
    const stopLoss = calculateSL(entry);
    const takeProfit = calculateTP(entry);

    const isUpTrend = entry > lastEMA;
    const isDownTrend = entry < lastEMA;

    const adxStrong = lastADX && lastADX.adx >= 25;

    if (lastRSI < 30 && lastMACD.MACD > lastMACD.signal && isUpTrend && adxStrong) {
      sendTelegramAlert(symbol, "compra", entry, stopLoss, takeProfit, lastRSI, lastMACD, lastADX);
    } else if (lastRSI > 70 && lastMACD.MACD < lastMACD.signal && isDownTrend && adxStrong) {
      sendTelegramAlert(symbol, "venda", entry, calculateTP(entry), calculateSL(entry), lastRSI, lastMACD, lastADX);
    }
  } catch (err) {
    console.error(`Erro ao analisar ${symbol}:`, err.message);
  }
}

function sendTelegramAlert(symbol, tipo, entry, sl, tp, rsi, macd, adx) {
  const emoji = tipo === "compra" ? "🚀" : "🛑";
  const msg = `${emoji} ${tipo.charAt(0).toUpperCase() + tipo.slice(1)} detectada para ${symbol}!
Entrada: ${entry}
Stop Loss: ${sl}
Take Profit: ${tp}
RSI5m: ${rsi.toFixed(2)}
MACD30m: ${macd.MACD.toFixed(4)} ${tipo === "compra" ? ">" : "<"} ${macd.signal.toFixed(4)}
ADX30m: ${adx.adx.toFixed(2)}`;
  bot.sendMessage(CHAT_ID, msg);
  console.log(`[${new Date().toLocaleTimeString()}] Alerta enviado: ${symbol} (${tipo})`);
}

async function monitorar() {
  console.log("Iniciando monitoramento...");
  for (const symbol of SYMBOLS) {
    await analyzeSymbol(symbol);
  }
}

setInterval(monitorar, 10 * 60 * 1000); // A cada 10 minutos
