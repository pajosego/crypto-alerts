const axios = require('axios');
const ti = require('technicalindicators');
const fs = require('fs').promises;
const path = require('path');

// --- CONFIGURAÇÕES ---
const TELEGRAM_BOT_TOKEN = '7818490459:AAG-p7pp4FGVqRcFcT9QoTF8o9vVsKl_VpM';
const TELEGRAM_CHAT_ID = '1741928134';

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('Erro ao enviar mensagem para o Telegram:', err.message);
  }
}

const symbols = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT',
  'SOLUSDT', 'DOGEUSDT', 'DOTUSDT', 'LTCUSDT', 'AVAXUSDT',
  'MATICUSDT', 'LINKUSDT'
];

const candleCache = {};
const cacheDurationMs = 4 * 60 * 1000;
const alertHistoryFile = path.resolve(__dirname, 'alertHistory.json');

const RISK_PERCENT = 1;
const CAPITAL = 10000;

async function getCandlesCached(symbol, interval, limit = 100) {
  const key = `${symbol}-${interval}-${limit}`;
  const now = Date.now();

  if (candleCache[key] && (now - candleCache[key].timestamp) < cacheDurationMs) {
    return candleCache[key].data;
  }

  const url = `https://api.binance.com/api/v3/klines`;
  const response = await axios.get(url, {
    params: { symbol, interval, limit }
  });

  const candles = response.data.map(c => ({
    openTime: c[0],
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    volume: parseFloat(c[5]),
    closeTime: c[6]
  }));

  candleCache[key] = { data: candles, timestamp: now };
  return candles;
}

function calcRSI(closes, period = 14) {
  return ti.RSI.calculate({ period, values: closes });
}

function calcSMA(closes, period) {
  return ti.SMA.calculate({ period, values: closes });
}

function calcEMA(closes, period) {
  return ti.EMA.calculate({ period, values: closes });
}

function calcMACD(closes) {
  return ti.MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
}

function calcBollingerBands(closes, period = 20, stdDev = 2) {
  return ti.BollingerBands.calculate({ period, stdDev, values: closes });
}

function calcADX(highs, lows, closes, period = 14) {
  return ti.ADX.calculate({ high: highs, low: lows, close: closes, period });
}

function checkSustainedCondition(arr, n, conditionFn) {
  if (arr.length < n) return false;
  return arr.slice(-n).every(conditionFn);
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
  await fs.writeFile(alertHistoryFile, JSON.stringify(history, null, 2));
}

function calculateSLTP(entryPrice, atr, direction) {
  const slDistance = atr * 1.5;
  const tpDistance = atr * 3;

  if (direction === 'buy') {
    return {
      stopLoss: entryPrice - slDistance,
      takeProfit: entryPrice + tpDistance
    };
  } else {
    return {
      stopLoss: entryPrice + slDistance,
      takeProfit: entryPrice - tpDistance
    };
  }
}

async function checarAlertas(symbol, alertHistory) {
  const [tf5m, tf30m, tf4h, tf1d, tfAtual] = await Promise.all([
    getCandlesCached(symbol, '5m'),
    getCandlesCached(symbol, '30m'),
    getCandlesCached(symbol, '4h'),
    getCandlesCached(symbol, '1d', 2),
    getCandlesCached(symbol, '1m', 1)
  ]);

  const closes5m = tf5m.map(c => c.close);
  const highs5m = tf5m.map(c => c.high);
  const lows5m = tf5m.map(c => c.low);

  const closes30m = tf30m.map(c => c.close);
  const highs30m = tf30m.map(c => c.high);
  const lows30m = tf30m.map(c => c.low);

  const closes4h = tf4h.map(c => c.close);
  const highs4h = tf4h.map(c => c.high);
  const lows4h = tf4h.map(c => c.low);

  const precoAtual = tfAtual[0].close;
  const ontem = tf1d[tf1d.length - 2];
  const highDay = ontem.high;
  const lowDay = ontem.low;
  const closeDay = ontem.close;

  const rsi5mArr = calcRSI(closes5m);
  const rsi30mArr = calcRSI(closes30m);
  const rsi5m = rsi5mArr[rsi5mArr.length - 1];
  const rsi30m = rsi30mArr[rsi30mArr.length - 1];

  const rsi5mConfirmed = checkSustainedCondition(
    rsi5mArr.slice(-3),
    3,
    v => v < 30
  );

  const ma21_5m = calcSMA(closes5m, 21).slice(-1)[0];
  const ema50_30m = calcEMA(closes30m, 50).slice(-1)[0];
  const ema200_4h = calcEMA(closes4h, 200).slice(-1)[0];

  const macd30mArr = calcMACD(closes30m);
  const macd4hArr = calcMACD(closes4h);
  const macd30m = macd30mArr[macd30mArr.length - 1];
  const macd4h = macd4hArr[macd4hArr.length - 1];

  const volume5m = tf5m[tf5m.length - 1].volume;
  const volume5mAvg = tf5m.slice(-10).reduce((acc, c) => acc + c.volume, 0) / 10;
  const volume30m = tf30m[tf30m.length - 1].volume;

  const bb5mArr = calcBollingerBands(closes5m);
  const bb5m = bb5mArr[bb5mArr.length - 1];

  const adx30mArr = calcADX(highs30m, lows30m, closes30m);
  const adx30m = adx30mArr.length ? adx30mArr[adx30mArr.length - 1].adx : 0;

  const atr30mArr = ti.ATR.calculate({ high: highs30m, low: lows30m, close: closes30m, period: 14 });
  const atr30m = atr30mArr.length ? atr30mArr[atr30mArr.length - 1] : null;

  const pivot = (highDay + lowDay + closeDay) / 3;
  const r1 = 2 * pivot - lowDay;
  const s1 = 2 * pivot - highDay;
  const r2 = pivot + (highDay - lowDay);
  const s2 = pivot - (highDay - lowDay);

  function estaProximo(nivel) {
    const tolerancia = nivel * 0.005;
    return precoAtual >= nivel - tolerancia && precoAtual <= nivel + tolerancia;
  }

  let scoreBuy = 0;
  let scoreSell = 0;

  if (rsi5m < 30 && rsi5mConfirmed && macd30m.MACD > macd30m.signal && adx30m > 20 && volume5m > 1.2 * volume5mAvg) {
    scoreBuy += 1;
  }

  if (rsi5m > 70 && macd30m.MACD < macd30m.signal && adx30m > 20 && volume5m > 1.2 * volume5mAvg) {
    scoreSell += 1;
  }

  const nearSupport = estaProximo(s1) || estaProximo(s2);
  const nearResistance = estaProximo(r1) || estaProximo(r2);

  if (scoreBuy > 0 && nearSupport) scoreBuy += 1;
  if (scoreSell > 0 && nearResistance) scoreSell += 1;

  if (macd4h.MACD > macd4h.signal && precoAtual > ema200_4h) {
    scoreBuy += 1;
  }
  if (macd4h.MACD < macd4h.signal && precoAtual < ema200_4h) {
    scoreSell += 1;
  }

  // 🔍 Log dos scores
  console.log(`Score ${symbol} -> Compra: ${scoreBuy}, Venda: ${scoreSell}`);

  const signalBuy = scoreBuy >= 3;
  const signalSell = scoreSell >= 3;

  const lastAlert = alertHistory[symbol] || {};
  const now = Date.now();

  if (signalBuy && (!lastAlert.buy || now - lastAlert.buy > 15 * 60 * 1000)) {
    if (!atr30m) {
      console.log(`Sem ATR para calcular SL/TP de COMPRA em ${symbol}`);
      return;
    }

    const { stopLoss, takeProfit } = calculateSLTP(precoAtual, atr30m, 'buy');

    const msg = `🚀 *Compra* detectada para ${symbol}!\n` +
      `Entrada: ${precoAtual.toFixed(4)}\n` +
      `Stop Loss: ${stopLoss.toFixed(4)}\n` +
      `Take Profit: ${takeProfit.toFixed(4)}\n` +
      `RSI5m: ${rsi5m.toFixed(2)}\n` +
      `MACD30m: ${macd30m.MACD.toFixed(4)} > ${macd30m.signal.toFixed(4)}\n` +
      `ADX30m: ${adx30m.toFixed(2)}`;

    await sendTelegramMessage(msg);

    alertHistory[symbol] = { buy: now, sell: lastAlert.sell };
    await saveAlertHistory(alertHistory);
  }

  if (signalSell && (!lastAlert.sell || now - lastAlert.sell > 15 * 60 * 1000)) {
    if (!atr30m) {
      console.log(`Sem ATR para calcular SL/TP de VENDA em ${symbol}`);
      return;
    }

    const { stopLoss, takeProfit } = calculateSLTP(precoAtual, atr30m, 'sell');

    const msg = `⛔ *Venda* detectada para ${symbol}!\n` +
      `Entrada: ${precoAtual.toFixed(4)}\n` +
      `Stop Loss: ${stopLoss.toFixed(4)}\n` +
      `Take Profit: ${takeProfit.toFixed(4)}\n` +
      `RSI5m: ${rsi5m.toFixed(2)}\n` +
      `MACD30m: ${macd30m.MACD.toFixed(4)} < ${macd30m.signal.toFixed(4)}\n` +
      `ADX30m: ${adx30m.toFixed(2)}`;

    await sendTelegramMessage(msg);

    alertHistory[symbol] = { buy: lastAlert.buy, sell: now };
    await saveAlertHistory(alertHistory);
  }
}

// --- LOOP PRINCIPAL ---
async function loopPrincipal() {
  const agora = new Date();
  console.log(`\nA verificar sinais em ${agora.toLocaleString('pt-PT')}`);

  const alertHistory = await loadAlertHistory();

  for (const symbol of symbols) {
    try {
      await checarAlertas(symbol, alertHistory);
      const hora = new Date().toLocaleTimeString('pt-PT');
      console.log(`[${hora}] Verificado ${symbol}`);
    } catch (err) {
      console.error(`Erro ao verificar ${symbol}:`, err.message);
    }
  }
}

// --- INICIO ---
async function main() {
  while (true) {
    await loopPrincipal();
    await new Promise(resolve => setTimeout(resolve, 4 * 60 * 1000));
  }
}

main();
