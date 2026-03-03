const https = require('https');

class DexScreenerClient {
  /**
   * @param {string} contractAddress — the token contract address
   */
  constructor(contractAddress) {
    this.contractAddress = contractAddress;
  }

  /**
   * Fetch token data from DexScreener API.
   * Returns the highest-liquidity pair's data.
   * @returns {Promise<{price: number, priceChange24h: number, volume24h: number, liquidity: number, fdv: number, mcap: number, pairAddress: string, dexId: string, url: string}|null>}
   */
  async getTokenData() {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${this.contractAddress}`;

    const raw = await this._fetch(url);
    if (!raw.pairs || raw.pairs.length === 0) {
      return null;
    }

    // Pick highest-liquidity pair
    const pair = raw.pairs.reduce((best, p) => {
      const liq = p.liquidity?.usd || 0;
      return liq > (best.liquidity?.usd || 0) ? p : best;
    }, raw.pairs[0]);

    return {
      price: parseFloat(pair.priceUsd) || 0,
      priceChange24h: pair.priceChange?.h24 || 0,
      volume24h: pair.volume?.h24 || 0,
      liquidity: pair.liquidity?.usd || 0,
      fdv: pair.fdv || 0,
      mcap: pair.marketCap || pair.fdv || 0,
      pairAddress: pair.pairAddress || '',
      dexId: pair.dexId || '',
      url: pair.url || `https://dexscreener.com/base/${this.contractAddress}`,
    };
  }

  _fetch(url) {
    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: { 'Accept': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`DexScreener API ${res.statusCode}: ${data.substring(0, 200)}`));
              return;
            }
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`DexScreener parse error: ${data.substring(0, 200)}`));
          }
        });
      }).on('error', reject);
    });
  }
}

module.exports = { DexScreenerClient };
