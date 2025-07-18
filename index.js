// index.js
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
const ALERT_COOLDOWN = 30 * 60 * 1000; // 30 minutos

const lastAlerts = {}; // { SYMBOL: { tipo: { timestamp, hash } } }

function getHash(data) {
  return JSON.stringify({
    entry: data.entry,
    sl: data.sl,
    tp: data.tp
  });
}

function canSendAlert(symbol, tipo, hash) {
  const now = Date.now();
  if (!lastAlerts[symbol]) lastAlerts[symbol] = {};
  const last = lastAlerts[symbol][tipo];

  if (!last || now - last.timestamp > ALERT_COOLDOWN || last.hash !== hash) {
    lastAlerts[symbol][tipo] = { timestamp: now, hash };
    return true;
  }
  return false;
}

function calculateTP(entry, atr, factor = 1.5) {
  return +(entry + factor * atr).toFixed(6);
}

function calculateSL(entry, atr, factor = 1) {
  return +(entry - factor * atr).toFixed(6);
}

async function fetchCandles(symbol, interval, limit = 100) {
  const url = `${API_URL}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await axios.get(url);
  return res.data.map(c => ({
    open: +c[1],
    high: +c[2],
    low: +c[3],
    close: +c[4]
  }));
}

async function analyzeSymbol(symbol) {
  try {
    const [rsiC, macdC, adxC, emaC, atrC] = await Promise.all([
      fetchCandles(symbol, INTERVALS.rsi),
      fetchCandles(symbol, INTERVALS.macd),
      fetchCandles(symbol, INTERVALS.adx),
      fetchCandles(symbol, INTERVALS.ema, 200),
      fetchCandles(symbol, INTERVALS.atr)
    ]);

    const close = rsiC.map(c => c.close);
    const price = close[close.length - 1];

    const rsi = RSI.calculate({ period: 14, values: close });
    const lastRSI = rsi.at(-1);

    const macd = MACD.calculate({
      values: macdC.map(c => c.close),
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9
    });
    const lastMACD = macd.at(-1);

    const adx = ADX.calculate({
      close: adxC.map(c => c.close),
      high: adxC.map(c => c.high),
      low: adxC.map(c => c.low),
      period: 14
    });
    const lastADX = adx.at(-1);

    const ema = EMA.calculate({ period: 200, values: emaC.map(c => c.close) });
    const lastEMA = ema.at(-1);

    const atr = ATR.calculate({
      close: atrC.map(c => c.close),
      high: atrC.map(c => c.high),
      low: atrC.map(c => c.low),
      period: 14
    });
    const lastATR = atr.at(-1) || 0;

    const isUp = price > lastEMA;
    const isDown = price < lastEMA;
    const adxStrong = lastADX?.adx >= 25;

    let scoreCompra = 0;
    let scoreVenda = 0;

    if (lastRSI < 30) scoreCompra += 1.5;
    if (lastRSI > 70) scoreVenda += 1.5;

    if (lastMACD.MACD > lastMACD.signal) scoreCompra += 1.5;
    if (lastMACD.MACD < lastMACD.signal) scoreVenda += 1.5;

    if (isUp) scoreCompra += 1;
    if (isDown) scoreVenda += 1;

    if (adxStrong) {
      scoreCompra += 1;
      scoreVenda += 1;
    }

    const entry = price;
    const sl = tipo => tipo === "compra" ? calculateSL(entry, lastATR) : calculateTP(entry, lastATR);
    const tp = tipo => tipo === "compra" ? calculateTP(entry, lastATR) : calculateSL(entry, lastATR);

    const common = {
      entry,
      rsi: lastRSI,
      macd: lastMACD,
      adx: lastADX
    };

    if (scoreCompra >= ALERT_SCORE_THRESHOLD) {
      const hash = getHash({ entry, sl: sl("compra"), tp: tp("compra") });
      if (canSendAlert(symbol, "compra", hash)) {
        sendTelegramAlert(symbol, "compra", entry, sl("compra"), tp("compra"), common, scoreCompra);
      }
    } else if (scoreVenda >= ALERT_SCORE_THRESHOLD) {
      const hash = getHash({ entry, sl: sl("venda"), tp: tp("venda") });
      if (canSendAlert(symbol, "venda", hash)) {
        sendTelegramAlert(symbol, "venda", entry, sl("venda"), tp("venda"), common, scoreVenda);
      }
    } else {
      console.log(`[${symbol}] Nenhum sinal forte. Scores: Compra=${scoreCompra.toFixed(2)}, Venda=${scoreVenda.toFixed(2)}`);
    }
  } catch (err) {
    console.error(`Erro ao analisar ${symbol}:`, err.message);
  }
}

function sendTelegramAlert(symbol, tipo, entry, sl, tp, indicators, score) {
  const emoji = tipo === "compra" ? "🚀" : "🛑";
  const msg = `${emoji} ${tipo.charAt(0).toUpperCase() + tipo.slice(1)} detectada para ${symbol}!
Entrada: ${entry.toFixed(6)}
Stop Loss: ${sl.toFixed(6)}
Take Profit: ${tp.toFixed(6)}
RSI5m: ${indicators.rsi.toFixed(2)}
MACD30m: ${indicators.macd.MACD.toFixed(4)} ${tipo === "compra" ? ">" : "<"} ${indicators.macd.signal.toFixed(4)}
ADX30m: ${indicators.adx.adx.toFixed(2)}
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
