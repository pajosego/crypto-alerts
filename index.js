const axios = require('axios');
const ti = require('technicalindicators');
const fs = require('fs').promises;
const path = require('path');

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
const cacheDurationMs = 4 * 60 * 1000; // 4 minutos
const alertHistoryFile = path.resolve(__dirname, 'alertHistory.json');

const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutos entre alertas iguais

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
  const rsi5m = rsi5mArr[rsi5mArr.length - 1];

  const macd30mArr = calcMACD(closes30m);
  const macd30m = macd30mArr[macd30mArr.length - 1];

  const adx30mArr = calcADX(highs30m, lows30m, closes30m);
  const adx30m = adx30mArr.length ? adx30mArr[adx30mArr.length - 1].adx : 0;

  const volume5m = tf5m[tf5m.length - 1].volume;
  const volume5mAvg = tf5m.slice(-10).reduce((acc, c) => acc + c.volume, 0) / 10;

  const pivot = (highDay + lowDay + closeDay) / 3;
  const r1 = 2 * pivot - lowDay;
  const s1 = 2 * pivot - highDay;

  function estaProximo(nivel) {
    const tolerancia = nivel * 0.005;
    return precoAtual >= nivel - tolerancia && precoAtual <= nivel + tolerancia;
  }

  let scoreBuy = 0;
  let scoreSell = 0;

  if (rsi5m < 35) scoreBuy += 1;
  if (rsi5m > 65) scoreSell += 1;

  if (macd30m.MACD > macd30m.signal) scoreBuy += 1;
  if (macd30m.MACD < macd30m.signal) scoreSell += 1;

  if (adx30m > 20) {
    scoreBuy += 0.5;
    scoreSell += 0.5;
  }

  if (volume5m > 1.1 * volume5mAvg) {
    scoreBuy += 0.5;
    scoreSell += 0.5;
  }

  if (scoreBuy > 0 && estaProximo(s1)) scoreBuy += 0.5;
  if (scoreSell > 0 && estaProximo(r1)) scoreSell += 0.5;

  const atr30mArr = ti.ATR.calculate({ high: highs30m, low: lows30m, close: closes30m, period: 14 });
  const atr30m = atr30mArr.length ? atr30mArr[atr30mArr.length - 1] : null;

  const now = Date.now();
  const lastAlert = alertHistory[symbol] || {};

  // Debug alert times
  console.log(`${symbol} - Últimos alertas: buy=${lastAlert.buy}, sell=${lastAlert.sell}`);

  if (scoreBuy >= 2.5) {
    if (!lastAlert.buy || (now - lastAlert.buy) > ALERT_COOLDOWN_MS) {
      if (!atr30m) {
        console.log(`Sem ATR para SL/TP compra em ${symbol}`);
        return;
      }
      const { stopLoss, takeProfit } = calculateSLTP(precoAtual, atr30m, 'buy');
      const msg = `🚀 *Compra* detectada para ${symbol}!\nEntrada: ${precoAtual.toFixed(4)}\nStop Loss: ${stopLoss.toFixed(4)}\nTake Profit: ${takeProfit.toFixed(4)}\nRSI5m: ${rsi5m.toFixed(2)}\nMACD30m: ${macd30m.MACD.toFixed(4)} > ${macd30m.signal.toFixed(4)}\nADX30m: ${adx30m.toFixed(2)}`;
      await sendTelegramMessage(msg);
      alertHistory[symbol].buy = now;
      await saveAlertHistory(alertHistory);
    } else {
      console.log(`Alerta de compra para ${symbol} ignorado por cooldown.`);
    }
  }

  if (scoreSell >= 2.5) {
    if (!lastAlert.sell || (now - lastAlert.sell) > ALERT_COOLDOWN_MS) {
      if (!atr30m) {
        console.log(`Sem ATR para SL/TP venda em ${symbol}`);
        return;
      }
      const { stopLoss, takeProfit } = calculateSLTP(precoAtual, atr30m, 'sell');
      const msg = `🛑 *Venda* detectada para ${symbol}!\nEntrada: ${precoAtual.toFixed(4)}\nStop Loss: ${stopLoss.toFixed(4)}\nTake Profit: ${takeProfit.toFixed(4)}\nRSI5m: ${rsi5m.toFixed(2)}\nMACD30m: ${macd30m.MACD.toFixed(4)} < ${macd30m.signal.toFixed(4)}\nADX30m: ${adx30m.toFixed(2)}`;
      await sendTelegramMessage(msg);
      alertHistory[symbol].sell = now;
      await saveAlertHistory(alertHistory);
    } else {
      console.log(`Alerta de venda para ${symbol} ignorado por cooldown.`);
    }
  }
}

(async () => {
  const alertHistory = await loadAlertHistory();

  console.log('Iniciando monitoramento...');
  setInterval(async () => {
    for (const symbol of symbols) {
      try {
        await checarAlertas(symbol, alertHistory);
      } catch (err) {
        console.error(`Erro ao verificar ${symbol}:`, err.message);
      }
    }
  }, 60 * 1000);
})();
