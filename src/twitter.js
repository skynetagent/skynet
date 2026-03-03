const crypto = require('crypto');
const https = require('https');

const USER_ID = '2015872431081058304';

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

    return this._request('POST', url, auth, body);
  }

  /**
   * Reply to a tweet via X API v2.
   * @param {string} text — reply text (max 280 chars)
   * @param {string} tweetId — the tweet to reply to
   * @returns {Promise<{id: string, text: string}>}
   */
  async reply(text, tweetId) {
    const url = 'https://api.twitter.com/2/tweets';
    const body = JSON.stringify({
      text,
      reply: { in_reply_to_tweet_id: tweetId },
    });
    const auth = this._buildOAuthHeader('POST', url);

    return this._request('POST', url, auth, body);
  }

  /**
   * Fetch recent mentions of the authenticated user.
   * @param {string|null} sinceId — only return tweets after this ID
   * @param {number} maxResults — max tweets to return (5-100, default 10)
   * @returns {Promise<{data: Array, meta: Object}>}
   */
  async getMentions(sinceId = null, maxResults = 10) {
    const baseUrl = `https://api.twitter.com/2/users/${USER_ID}/mentions`;
    const queryParams = { max_results: String(maxResults) };
    if (sinceId) {
      queryParams.since_id = sinceId;
    }

    const auth = this._buildOAuthHeader('GET', baseUrl, queryParams);
    const qs = Object.entries(queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const fullUrl = `${baseUrl}?${qs}`;

    return new Promise((resolve, reject) => {
      https.get(fullUrl, {
        headers: { 'Authorization': auth },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode === 200) {
              resolve({
                data: json.data || [],
                meta: json.meta || {},
              });
            } else {
              const errMsg = json.detail || json.title || JSON.stringify(json);
              reject(new Error(`Twitter API ${res.statusCode}: ${errMsg}`));
            }
          } catch (e) {
            reject(new Error(`Twitter response parse error: ${data.substring(0, 200)}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Search recent tweets matching a query.
   * @param {string} query — search query (e.g. "AI agents" or "#crypto")
   * @param {number} maxResults — max tweets to return (10-100, default 10)
   * @returns {Promise<{data: Array, meta: Object}>}
   */
  async searchTweets(query, maxResults = 10) {
    const baseUrl = 'https://api.twitter.com/2/tweets/search/recent';
    const queryParams = {
      query,
      max_results: String(maxResults),
      'tweet.fields': 'public_metrics,author_id,created_at',
    };

    const auth = this._buildOAuthHeader('GET', baseUrl, queryParams);
    const qs = Object.entries(queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const fullUrl = `${baseUrl}?${qs}`;

    return new Promise((resolve, reject) => {
      https.get(fullUrl, {
        headers: { 'Authorization': auth },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode === 200) {
              resolve({
                data: json.data || [],
                meta: json.meta || {},
              });
            } else {
              const errMsg = json.detail || json.title || JSON.stringify(json);
              reject(new Error(`Twitter API ${res.statusCode}: ${errMsg}`));
            }
          } catch (e) {
            reject(new Error(`Twitter response parse error: ${data.substring(0, 200)}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Like a tweet.
   * @param {string} tweetId — the tweet to like
   * @returns {Promise<{liked: boolean}>}
   */
  async likeTweet(tweetId) {
    const url = `https://api.twitter.com/2/users/${USER_ID}/likes`;
    const body = JSON.stringify({ tweet_id: tweetId });
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
            if (res.statusCode === 200) {
              resolve(json.data || { liked: true });
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

  /**
   * Retweet a tweet.
   * @param {string} tweetId — the tweet to retweet
   * @returns {Promise<{retweeted: boolean}>}
   */
  async retweet(tweetId) {
    const url = `https://api.twitter.com/2/users/${USER_ID}/retweets`;
    const body = JSON.stringify({ tweet_id: tweetId });
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
            if (res.statusCode === 200) {
              resolve(json.data || { retweeted: true });
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

  /**
   * Fetch public metrics for a batch of tweet IDs.
   * @param {string[]} tweetIds — array of tweet ID strings (max 100)
   * @returns {Promise<Object>} — { [tweetId]: { like_count, retweet_count, reply_count, quote_count, impression_count } }
   */
  async getTweetMetrics(tweetIds) {
    if (!tweetIds || tweetIds.length === 0) return {};

    // API allows up to 100 IDs per request
    const ids = tweetIds.slice(0, 100);
    const baseUrl = 'https://api.twitter.com/2/tweets';
    const queryParams = {
      ids: ids.join(','),
      'tweet.fields': 'public_metrics',
    };

    const auth = this._buildOAuthHeader('GET', baseUrl, queryParams);
    const qs = Object.entries(queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const fullUrl = `${baseUrl}?${qs}`;

    const result = await new Promise((resolve, reject) => {
      https.get(fullUrl, {
        headers: { 'Authorization': auth },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode === 200) {
              resolve(json.data || []);
            } else {
              const errMsg = json.detail || json.title || JSON.stringify(json);
              reject(new Error(`Twitter API ${res.statusCode}: ${errMsg}`));
            }
          } catch (e) {
            reject(new Error(`Twitter response parse error: ${data.substring(0, 200)}`));
          }
        });
      }).on('error', reject);
    });

    // Transform array into { tweetId: metrics } map
    const metrics = {};
    for (const tweet of result) {
      if (tweet.public_metrics) {
        metrics[tweet.id] = tweet.public_metrics;
      }
    }
    return metrics;
  }

  /**
   * Make an HTTP POST request with auth and JSON body.
   */
  _request(method, url, auth, body) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method,
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

  /**
   * Build OAuth 1.0a Authorization header.
   * For GET requests, queryParams must be included in the signature base string.
   */
  _buildOAuthHeader(method, url, queryParams = {}) {
    const oauthParams = {
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: this.accessToken,
      oauth_version: '1.0',
    };

    // Merge oauth params with query params for signature base
    const allParams = { ...oauthParams, ...queryParams };
    const sortedKeys = Object.keys(allParams).sort();
    const paramString = sortedKeys
      .map((k) => `${this._percentEncode(k)}=${this._percentEncode(allParams[k])}`)
      .join('&');
    const signatureBase = `${method}&${this._percentEncode(url)}&${this._percentEncode(paramString)}`;

    // Sign
    const signingKey = `${this._percentEncode(this.consumerSecret)}&${this._percentEncode(this.accessTokenSecret)}`;
    const signature = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');
    oauthParams.oauth_signature = signature;

    // Build Authorization header (only oauth_ params, not query params)
    return 'OAuth ' + Object.keys(oauthParams).sort()
      .map((k) => `${this._percentEncode(k)}="${this._percentEncode(oauthParams[k])}"`)
      .join(', ');
  }
}

module.exports = { TwitterClient };
