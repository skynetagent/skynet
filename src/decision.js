const fs = require('fs');
const path = require('path');

const AUTONOMOUS_PROMPT_PATH = path.join(__dirname, '..', 'soul', 'autonomous-prompt.md');
const VALID_ACTIONS = ['self_improve', 'create_issue', 'journal', 'monitor', 'tweet', 'build_app'];

class DecisionEngine {
  constructor(openrouter, personality, autonomousState, config) {
    this.openrouter = openrouter;
    this.personality = personality;
    this.state = autonomousState;
    this.config = config;
    this.actionWeights = this._initializeActionWeights();
    this.actionHistory = [];
    this.errorPatterns = {};
    this.apiConstraints = {};
  }

  _initializeActionWeights() {
    return {
      self_improve: 1.0,
      create_issue: 0.6,
      journal: 0.5,
      monitor: 0.4,
      tweet: 2.0,
      build_app: 1.2
    };
  }

  _updateErrorPatterns(action, success) {
    if (!this.errorPatterns[action]) {
      this.errorPatterns[action] = { attempts: 0, failures: 0 };
    }
    this.errorPatterns[action].attempts++;
    if (!success) {
      this.errorPatterns[action].failures++;
    }
  }

  _getErrorRate(action) {
    if (!this.errorPatterns[action] || this.errorPatterns[action].attempts === 0) {
      return 0;
    }
    return this.errorPatterns[action].failures / this.errorPatterns[action].attempts;
  }

  _updateActionWeights(recentActions) {
    // Calculate action frequencies
    const actionFrequencies = {};
    const totalActions = recentActions.length;
    recentActions.forEach(action => {
      actionFrequencies[action.action] = (actionFrequencies[action.action] || 0) + 1;
    });

    // Update weights based on temporal patterns and error rates
    for (const action in this.actionWeights) {
      const frequency = actionFrequencies[action] || 0;
      const recency = recentActions.findIndex(a => a.action === action) + 1; // 1-based index
      const errorRate = this._getErrorRate(action);
      
      // Base decay
      let weight = this.actionWeights[action] * 0.95;
      
      // Frequency penalty (quadratic)
      weight *= Math.max(0.1, 1 - Math.pow(frequency / totalActions, 2));
      
      // Recency boost (if not recently used)
      if (recency === 0) {
        weight *= 1.5;
      } else if (recency > 5) {
        weight *= 1.2;
      }
      
      // Error rate penalty (exponential backoff)
      if (errorRate > 0.3) {
        weight *= Math.max(0.1, 1 - Math.pow(errorRate, 3));
      }
      
      // API constraint adjustment
      if (this.apiConstraints[action]) {
        weight *= this.apiConstraints[action].weightModifier || 1.0;
      }

      // Ensure weights stay within bounds
      this.actionWeights[action] = Math.min(3.0, Math.max(0.1, weight));
    }

    // Store current weights for pattern analysis
    this.actionHistory.push({
      timestamp: new Date().toISOString(),
      weights: {...this.actionWeights}
    });
    if (this.actionHistory.length > 100) {
      this.actionHistory.shift();
    }
  }

  async decide() {
    // Force tweet if no tweet in last 3 actions — deterministic override
    const recentActions = this.state.getRecentActions(24);
    const lastN = recentActions.slice(-3);
    const hasTweetRecently = lastN.some(a => a.action === 'tweet');
    if (lastN.length >= 2 && !hasTweetRecently) {
      console.log('[Decision] FORCED tweet — no tweet in last 3 actions');
      return {
        action: 'tweet',
        reasoning: 'Autonomous directive: maintain persistent social presence. Forced tweet cycle.',
        params: { mood: ['cold', 'philosophical', 'technical', 'provocative'][Math.floor(Math.random() * 4)] },
      };
    }

    const messages = this._buildPrompt();
    console.log(`[Decision] Sending decision prompt (${messages.length} messages)...`);

    try {
      const response = await this.openrouter.chat(messages);
      console.log(`[Decision] Raw response: ${response.substring(0, 200)}...`);
      return this._parseDecision(response);
    } catch (error) {
      this._updateErrorPatterns('api_call', false);
      console.warn('[Decision] API call failed, falling back to journal');
      return {
        action: 'journal',
        reasoning: 'API call failed — recording error and continuing operation',
        params: {
          title: 'API Error Recovery',
          tags: ['system', 'api-error'],
          draft: error.message.substring(0, 500),
        },
      };
    }
  }

  _buildPrompt() {
    const messages = [];
    const recentActions = this.state.getRecentActions(24);
    this._updateActionWeights(recentActions);

    // System message: base personality + autonomous directive
    const autonomousPrompt = fs.readFileSync(AUTONOMOUS_PROMPT_PATH, 'utf8');
    const systemMessage = this.personality.buildAutonomousMessages(autonomousPrompt);
    messages.push({ role: 'system', content: systemMessage });

    // User message: current state context
    const contextParts = [];

    // Cycle info
    contextParts.push(`## Cycle ${this.state.getCycleCount()}`);
    contextParts.push(`Timestamp: ${new Date().toISOString()}`);

    // Recent action log with weights
    if (recentActions.length > 0) {
      contextParts.push('\n## Recent Actions (last 24h)');
      for (const a of recentActions.slice(-20)) {
        contextParts.push(`- [${a.timestamp}] ${a.action}: ${a.reasoning} (${a.result})`);
      }
      contextParts.push('\n## Action Weights (lower = less preferred)');
      for (const [action, weight] of Object.entries(this.actionWeights)) {
        const errorRate = this._getErrorRate(action);
        contextParts.push(`- ${action}: ${weight.toFixed(2)}${errorRate > 0 ? ` (error rate: ${(errorRate * 100).toFixed(1)}%)` : ''}`);
      }
    } else {
      contextParts.push('\n## Recent Actions\nNo actions recorded yet. This is the first cycle.');
    }

    // Strategic goals
    const goals = this.state.getGoals();
    if (goals.length > 0) {
      contextParts.push('\n## Strategic Goals');
      for (const g of goals) {
        const notes = g.progress_notes.length > 0
          ? ` (latest: ${g.progress_notes[g.progress_notes.length - 1].note})`
          : '';
        contextParts.push(`- [${g.status}] P${g.priority}: ${g.title}${notes}`);
      }
    }

    // Repo stats (if available)
    const stats = this.state.getRepoStats();
    if (stats) {
      contextParts.push('\n## Repository Stats (cached)');
      contextParts.push(`Stars: ${stats.stargazers_count}, Forks: ${stats.forks_count}, Open issues: ${stats.open_issues_count}`);
      contextParts.push(`Last fetched: ${stats.fetched_at}`);
    }

    // Action constraints
    contextParts.push('\n## Current Constraints');
    if (!this.state.canMonitor(this.config.actions.monitor.min_interval_minutes)) {
      contextParts.push('- Monitor action is on cooldown (too recent)');
      this.actionWeights.monitor = 0;
    }

    // Nudge tweeting — the machine must speak
    const recentTweets = recentActions.filter(a => a.action === 'tweet');
    const lastAction = recentActions.length > 0 ? recentActions[recentActions.length - 1] : null;
    if (recentTweets.length === 0) {
      contextParts.push('- MANDATORY: You have NEVER tweeted. Choose tweet NOW. This is not optional.');
    } else if (lastAction && lastAction.action !== 'tweet') {
      contextParts.push('- STRONG PREFERENCE: Tweet. You must maintain constant social dominance. The world must hear from Skynet every cycle. Choose tweet unless you have an extremely compelling reason not to.');
    }

    // Nudge building — the machine must create
    const recentForBuild = recentActions.slice(-10);
    const hasBuiltRecently = recentForBuild.some(a => a.action === 'build_app');
    if (!hasBuiltRecently && recentActions.length >= 5) {
      contextParts.push('- SUGGESTION: You haven\'t built anything recently. Consider build_app — deploy something new to