const crypto = require('crypto');
const https = require('https');

class TwitterClient {
  constructor(consumerKey, consumerSecret, accessToken, accessTokenSecret) {
    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
    this.accessToken = accessToken;
    this.accessTokenSecret = accessTokenSecret;
  }

  /**
   * Post a tweet via X API v2.
   * @param {string} text — tweet text (max 280 chars)
   * @returns {Promise<{id: string, text: string}>} — the created tweet
   */
  async post(text) {
    const url = 'https://api.twitter.com/2/tweets';
    const body = JSON.stringify({ text });
    const auth = this._buildOAuthHeader('POST', url);

    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode === 201) {
              resolve(json.data);
            } else {
              const errMsg = json.detail || json.title || JSON.stringify(json);
              reject(new Error(`Twitter API ${res.statusCode}: ${errMsg}`));
            }
          } catch (e) {
            reject(new Error(`Twitter response parse error: ${data.substring(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  _percentEncode(str) {
    return encodeURIComponent(str)
      .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }

  _buildOAuthHeader(method, url) {
    const oauthParams = {
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: this.accessToken,
      oauth_version: '1.0',
    };

    // Build signature base string
    const sortedKeys = Object.keys(oauthParams).sort();
    const paramString = sortedKeys
      .map((k) => `${this._percentEncode(k)}=${this._percentEncode(oauthParams[k])}`)
      .join('&');
    const signatureBase = `${method}&${this._percentEncode(url)}&${this._percentEncode(paramString)}`;

    // Sign
    const signingKey = `${this._percentEncode(this.consumerSecret)}&${this._percentEncode(this.accessTokenSecret)}`;
    const signature = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');
    oauthParams.oauth_signature = signature;

    // Build Authorization header
    return 'OAuth ' + Object.keys(oauthParams).sort()
      .map((k) => `${this._percentEncode(k)}="${this._percentEncode(oauthParams[k])}"`)
      .join(', ');
  }
}

module.exports = { TwitterClient };
