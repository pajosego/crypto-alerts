const axios = require('axios');

const cryptoIds = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'ripple', 'cardano', 'arbitrum', 'injective-protocol', 'dogecoin', 'pepecoin'];

async function getPrices() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: cryptoIds.join(','),
        vs_currencies: 'usd',
        include_24hr_change: 'true',
        include_last_updated_at: 'true'
      }
    });

    const data = response.data;

    for (const id of cryptoIds) {
      if (data[id] && data[id].usd !== undefined) {
        console.log(`${id.toUpperCase()}: $${data[id].usd} (24h var: ${data[id].usd_24h_change ? data[id].usd_24h_change.toFixed(2) : 'N/A'}%)`);
      } else {
        console.log(`Dados não disponíveis para: ${id.toUpperCase()}`);
      }
    }
  } catch (error) {
    console.error('Erro ao puxar preços:', error.message);
  }
}

getPrices();
