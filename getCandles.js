const Binance = require('node-binance-api');
const binance = new Binance().options({
  useServerTime: true,
});

async function getCandles(symbol, interval) {
  try {
    const candles = await binance.candlesticks(symbol, interval, { limit: 100 });
    return candles.map(candle => ({
      openTime: candle[0],
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      volume: parseFloat(candle[5]),
      closeTime: candle[6],
    }));
  } catch (err) {
    console.error('Erro ao buscar candles:', err);
    return [];
  }
}

(async () => {
  const symbol = 'BTCUSDT';
  const intervals = ['5m', '30m', '4h'];

  for (const interval of intervals) {
    const candles = await getCandles(symbol, interval);
    console.log(`Candles para ${symbol} no timeframe ${interval}:`);
    console.log(candles.slice(0, 3)); // Mostra só os 3 primeiros para não lotar
  }
})();
