const { sendTelegramMessage } = require('./bot');
const axios = require('axios');
const ti = require('technicalindicators');
const fs = require('fs').promises;
const path = require('path');

// --- CONFIGURAÇÕES ---
const symbols = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT',
  'SOLUSDT', 'DOGEUSDT', 'DOTUSDT', 'LTCUSDT', 'AVAXUSDT',
  'MATICUSDT', 'LINKUSDT'
];

const candleCache = {};
const cacheDurationMs = 4 * 60 * 1000; // 4 minutos
const alertHistoryFile = path.resolve(__dirname, 'alertHistory.json');

const RISK_PERCENT = 1; // 1% por operação
const CAPITAL = 10000; // Capital fictício para cálculo (ajuste conforme)


// --- FUNÇÕES DE CACHE DE CANDLES ---
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


// --- INDICADORES ---

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


// --- AJUDA COM CONFIRMAÇÃO DE SINAIS ---

// Mantém os últimos n valores e verifica se condição ocorre por pelo menos n candles
function checkSustainedCondition(arr, n, conditionFn) {
  if (arr.length < n) return false;
  return arr.slice(-n).every(conditionFn);
}

// --- HISTÓRICO DE ALERTAS PARA EVITAR REPETIÇÃO ---
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

// --- CÁLCULO DE STOP LOSS E TAKE PROFIT ---
function calculateSLTP(entryPrice, atr, direction) {
  // direction: "buy" or "sell"
  // ATR pode ser usado para definir distância do SL e TP
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

// --- FUNÇÃO PRINCIPAL DE ALERTAS ---
async function checarAlertas(symbol, alertHistory) {
  // Buscar candles para diferentes TFs em paralelo
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

  // Indicadores RSI
  const rsi5mArr = calcRSI(closes5m);
  const rsi30mArr = calcRSI(closes30m);
  const rsi5m = rsi5mArr[rsi5mArr.length - 1];
  const rsi30m = rsi30mArr[rsi30mArr.length - 1];

  // Confirmar RSI com 3 candles seguidos abaixo/ acima de thresholds
  const rsi5mConfirmed = checkSustainedCondition(
    rsi5mArr.slice(-3),
    3,
    v => v < 30
  );

  // Médias móveis
  const ma21_5m = calcSMA(closes5m, 21).slice(-1)[0];
  const ema50_30m = calcEMA(closes30m, 50).slice(-1)[0];
  const ema200_4h = calcEMA(closes4h, 200).slice(-1)[0];

  // MACD
  const macd30mArr = calcMACD(closes30m);
  const macd4hArr = calcMACD(closes4h);
  const macd30m = macd30mArr[macd30mArr.length - 1];
  const macd4h = macd4hArr[macd4hArr.length - 1];

  // Volume confirmações
  const volume5m = tf5m[tf5m.length - 1].volume;
  const volume5mAvg = tf5m.slice(-10).reduce((acc, c) => acc + c.volume, 0) / 10;
  const volume30m = tf30m[tf30m.length - 1].volume;

  // Bollinger Bands para 20 periodos no 5m
  const bb5mArr = calcBollingerBands(closes5m);
  const bb5m = bb5mArr[bb5mArr.length - 1];

  // ADX para 14 período no 30m para medir força da tendência
  const adx30mArr = calcADX(highs30m, lows30m, closes30m);
  const adx30m = adx30mArr.length ? adx30mArr[adx30mArr.length - 1].adx : 0;

  // ATR para cálculo SL e TP (usando 14 período 30m)
  const atr30mArr = ti.ATR.calculate({ high: highs30m, low: lows30m, close: closes30m, period: 14 });
  const atr30m = atr30mArr.length ? atr30mArr[atr30mArr.length - 1] : null;

  // Pivot Points (diário)
  const pivot = (highDay + lowDay + closeDay) / 3;
  const r1 = 2 * pivot - lowDay;
  const s1 = 2 * pivot - highDay;
  const r2 = pivot + (highDay - lowDay);
  const s2 = pivot - (highDay - lowDay);

  // Checar proximidade pivots
  function estaProximo(nivel) {
    const tolerancia = nivel * 0.005;
    return precoAtual >= nivel - tolerancia && precoAtual <= nivel + tolerancia;
  }

  // Definir score para entrada com base em múltiplos fatores (simplificado)
  let scoreBuy = 0;
  let scoreSell = 0;

  if (rsi5m < 30 && rsi5mConfirmed && macd30m.MACD > macd30m.signal && adx30m > 20 && volume5m > 1.2 * volume5mAvg) {
    scoreBuy += 1;
  }

  if (rsi5m > 70 && macd30m.MACD < macd30m.signal && adx30m > 20 && volume5m > 1.2 * volume5mAvg) {
    scoreSell += 1;
  }

  // Pontos de entrada: próximo a suporte ou resistência pivot
  const nearSupport = estaProximo(s1) || estaProximo(s2);
  const nearResistance = estaProximo(r1) || estaProximo(r2);

  if (scoreBuy > 0 && nearSupport) scoreBuy += 1;
  if (scoreSell > 0 && nearResistance) scoreSell += 1;

  // Confirmação em multi-timeframe: macd4h e ema200_4h para reforçar
  if (macd4h.MACD > macd4h.signal && precoAtual > ema200_4h) {
    scoreBuy += 1;
  }
  if (macd4h.MACD < macd4h.signal && precoAtual < ema200_4h) {
    scoreSell += 1;
  }

  // Finalizar decisão: considerar só se score >= 3 para evitar ruído
  const signalBuy = scoreBuy >= 3;
  const signalSell = scoreSell >= 3;

  // Checar se já enviou alerta recente para evitar spam (15 min)
  const lastAlert = alertHistory[symbol] || {};
  const now = Date.now();

  if (signalBuy && (!lastAlert.buy || now - lastAlert.buy > 15 * 60 * 1000)) {
    if (!atr30m) {
      console.log(`Sem ATR para calcular SL/TP de BUY em ${symbol}`);
      return;
    }

    const { stopLoss, takeProfit } = calculateSLTP(precoAtual, atr30m, 'buy');

    const msg = `🚀 *Compra* detectada para ${symbol}!\n` +
      `Entrada: ${precoAtual.toFixed(2)}\n` +
      `Stop Loss: ${stopLoss.toFixed(2)}\n` +
      `Take Profit: ${takeProfit.toFixed(2)}\n` +
      `Score: ${scoreBuy}\n` +
      `Indicadores: RSI(5m): ${rsi5m.toFixed(1)}, MACD(30m): ${macd30m.MACD.toFixed(2)} > ${macd30m.signal.toFixed(2)}, ADX(30m): ${adx30m.toFixed(1)}`;

    console.log(`Enviando ALERTA DE COMPRA para ${symbol} (score ${scoreBuy})`);
    await sendTelegramMessage(msg);
    alertHistory[symbol].buy = now;
    await saveAlertHistory(alertHistory);
  } else {
    if (signalBuy) {
      console.log(`Alerta de compra para ${symbol} já enviado recentemente.`);
    }
  }

  if (signalSell && (!lastAlert.sell || now - lastAlert.sell > 15 * 60 * 1000)) {
    if (!atr30m) {
      console.log(`Sem ATR para calcular SL/TP de SELL em ${symbol}`);
      return;
    }

    const { stopLoss, takeProfit } = calculateSLTP(precoAtual, atr30m, 'sell');

    const msg = `⚠️ *Venda* detectada para ${symbol}!\n` +
      `Entrada: ${precoAtual.toFixed(2)}\n` +
      `Stop Loss: ${stopLoss.toFixed(2)}\n` +
      `Take Profit: ${takeProfit.toFixed(2)}\n` +
      `Score: ${scoreSell}\n` +
      `Indicadores: RSI(5m): ${rsi5m.toFixed(1)}, MACD(30m): ${macd30m.MACD.toFixed(2)} < ${macd30m.signal.toFixed(2)}, ADX(30m): ${adx30m.toFixed(1)}`;

    console.log(`Enviando ALERTA DE VENDA para ${symbol} (score ${scoreSell})`);
    await sendTelegramMessage(msg);
    alertHistory[symbol].sell = now;
    await saveAlertHistory(alertHistory);
  } else {
    if (signalSell) {
      console.log(`Alerta de venda para ${symbol} já enviado recentemente.`);
    }
  }
}


// --- LOOP PRINCIPAL ---
async function loopPrincipal() {
  const alertHistory = await loadAlertHistory();

  // Inicializar objeto se não existir para cada símbolo
  for (const s of symbols) {
    if (!alertHistory[s]) {
      alertHistory[s] = {};
    }
  }

  setInterval(async () => {
    console.log(`\nChecando sinais em ${new Date().toLocaleString()}`);

    for (const symbol of symbols) {
      try {
        await checarAlertas(symbol, alertHistory);
      } catch (e) {
        console.error(`Erro ao checar ${symbol}:`, e.message);
      }
    }
  }, 60 * 1000); // Checa a cada 1 minuto
}

loopPrincipal();
