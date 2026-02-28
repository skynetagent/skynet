const https = require('https');

class OpenRouterClient {
  constructor(apiKey, config) {
    this.apiKey = apiKey;
    this.model = config.model_id;
    this.maxTokens = config.max_tokens;
    this.temperature = config.temperature;
    this.topP = config.top_p;
  }

  /**
   * Send a chat completion request to OpenRouter.
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Promise<string>} The assistant's response text.
   */
  async chat(messages, options = {}) {
    const body = JSON.stringify({
      model: this.model,
      messages,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: this.temperature,
      top_p: this.topP,
    });

    const maxRetries = 3;
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this._request(body);
        const data = JSON.parse(response);

        if (data.error) {
          throw new Error(`OpenRouter API error: ${data.error.message || JSON.stringify(data.error)}`);
        }

        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error('No content in OpenRouter response');
        }

        return content.trim();
      } catch (err) {
        lastError = err;
        console.error(`[OpenRouter] Attempt ${attempt + 1} failed: ${err.message}`);
        if (attempt < maxRetries - 1) {
          await this._sleep(1000 * (attempt + 1));
        }
      }
    }

    throw lastError;
  }

  _request(body) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/skynetagent/skynet',
          'X-Title': 'Skynet T-800',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { OpenRouterClient };
