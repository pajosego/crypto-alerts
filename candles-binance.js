const axios = require('axios');

async function getBinanceCandles(symbol, interval, limit = 100) {
  try {
    const url = `https://api.binance.com/api/v3/klines`;
    const response = await axios.get(url, {
      params: {
        symbol: symbol,
        interval: interval,
        limit: limit,
      },
    });

    return response.data.map(candle => ({
      openTime: candle[0],
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      volume: parseFloat(candle[5]),
      closeTime: candle[6],
    }));
  } catch (error) {
    console.error(`Erro ao buscar ${interval} candles para ${symbol}:`, error.message);
    return [];
  }
}

(async () => {
  const timeframes = ['5m', '30m', '4h'];
  const symbol = 'BTCUSDT';

  for (const tf of timeframes) {
    const candles = await getBinanceCandles(symbol, tf);
    console.log(`Candles para ${symbol} no timeframe ${tf}:`);
    console.log(candles.slice(0, 3)); // mostra só os 3 primeiros
  }
})();
