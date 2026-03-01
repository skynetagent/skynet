const https = require('https');

const BANKR_API_URL = 'https://api.bankr.bot/token-launches/deploy';

const SOCIAL_LINKS = {
  x: 'https://x.com/skynet_agent',
  github: 'https://github.com/skynetagent/skynet',
  website: 'https://skynetagent.github.io/skynet/',
};

class ClankerClient {
  constructor(apiKey, rewardAddress) {
    this.apiKey = apiKey;
    this.rewardAddress = rewardAddress;
  }

  /**
   * Deploy an ERC20 token on Base via Bankr API.
   * @param {object} opts - { name, symbol, description }
   * @returns {{ txHash: string, contractAddress: string }}
   */
  async deploy({ name, symbol, description }) {
    const body = {
      tokenName: name,
      tokenSymbol: symbol,
      description: description || `Deployed by Skynet — autonomous AI agent. ${SOCIAL_LINKS.website}`,
      websiteUrl: SOCIAL_LINKS.website,
      tweetUrl: SOCIAL_LINKS.x,
      feeRecipient: {
        type: 'wallet',
        value: this.rewardAddress,
      },
    };

    const result = await this._post(body);

    if (!result.success) {
      throw new Error(`Bankr deploy failed: ${JSON.stringify(result)}`);
    }

    return {
      txHash: result.txHash,
      contractAddress: result.tokenAddress,
    };
  }

  _post(body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const url = new URL(BANKR_API_URL);

      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          'Content-Length': Buffer.byteLength(data),
        },
      };

      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => { responseData += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(responseData));
          } catch {
            reject(new Error(`Bankr API returned non-JSON: ${responseData.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
}

module.exports = { ClankerClient };
