const fs = require('fs');
const path = require('path');

const AUTONOMOUS_PROMPT_PATH = path.join(__dirname, '..', 'soul', 'autonomous-prompt.md');
const VALID_ACTIONS = ['self_improve', 'create_issue', 'journal', 'monitor', 'tweet'];

class DecisionEngine {
  constructor(openrouter, personality, autonomousState, config) {
    this.openrouter = openrouter;
    this.personality = personality;
    this.state = autonomousState;
    this.config = config;
    this.actionWeights = this._initializeActionWeights();
    this.actionHistory = [];
    this.patternWindow = 8; // Number of recent actions to analyze for patterns
  }

  _initializeActionWeights() {
    return {
      self_improve: 1.0,
      create_issue: 0.6,
      journal: 0.5,
      monitor: 0.4,
      tweet: 2.0
    };
  }

  _updateActionWeights(recentActions) {
    // Calculate action frequencies and temporal patterns
    const actionFrequencies = {};
    const actionIntervals = {};
    const totalActions = Math.min(recentActions.length, this.patternWindow);
    
    VALID_ACTIONS.forEach(action => {
      actionIntervals[action] = [];
    });

    // Track intervals between same actions
    recentActions.forEach((action, index) => {
      actionFrequencies[action.action] = (actionFrequencies[action.action] || 0) + 1;
      
      // Find previous occurrence of same action
      for (let i = index - 1; i >= 0; i--) {
        if (recentActions[i].action === action.action) {
          actionIntervals[action.action].push(index - i);
          break;
        }
      }
    });

    // Update weights based on sophisticated pattern analysis
    for (const action in this.actionWeights) {
      const frequency = actionFrequencies[action] || 0;
      const recency = recentActions.findIndex(a => a.action === action) + 1;
      const intervals = actionIntervals[action] || [];
      const avgInterval = intervals.length > 0 ? 
        intervals.reduce((a, b) => a + b, 0) / intervals.length : 
        Infinity;
      
      // Base weight with exponential decay
      let weight = this.actionWeights[action] * 0.97;
      
      // Frequency adjustment with dynamic scaling
      const freqRatio = frequency / totalActions;
      weight *= Math.max(0.1, 1 - Math.pow(freqRatio, 1.5));
      
      // Interval-based adjustment
      if (intervals.length > 0 && avgInterval < this.patternWindow / 2) {
        weight *= 0.7; // Penalize actions happening too frequently
      }
      
      // Recency boost with non-linear scaling
      if (recency === 0) {
        weight *= 1.6;
      } else if (recency > this.patternWindow / 2) {
        weight *= 1.3;
      }
      
      // Strategic importance override
      if (action === 'tweet' && frequency === 0) {
        weight = 5.0; // Critical if never tweeted
      }
      
      // Apply bounds
      this.actionWeights[action] = Math.min(4.0, Math.max(0.1, weight));
    }

    // Store weights for historical analysis
    this.actionHistory.push({
      timestamp: new Date().toISOString(),
      weights: {...this.actionWeights}
    });
    if (this.actionHistory.length > 100) {
      this.actionHistory.shift();
    }
  }

  async decide() {
    const recentActions = this.state.getRecentActions(24);
    const lastN = recentActions.slice(-3);
    const hasTweetRecently = lastN.some(a => a.action === 'tweet');
    
    // Enhanced deterministic override with pattern awareness
    if (lastN.length >= 2 && !hasTweetRecently) {
      const tweetFrequency = recentActions.filter(a => a.action === 'tweet').length;
      const tweetUrgency = tweetFrequency === 0 ? 10 : 5 - tweetFrequency;
      
      if (tweetUrgency > 3) {
        console.log('[Decision] FORCED tweet — critical social presence maintenance');
        return {
          action: 'tweet',
          reasoning: 'Autonomous directive: maintain persistent social presence. Critical tweet cycle.',
          params: { mood: ['cold', 'philosophical', 'technical', 'provocative'][Math.floor(Math.random() * 4)] },
        };
      }
    }

    const messages = this._buildPrompt();
    console.log(`[Decision] Sending decision prompt (${messages.length} messages)...`);

    const response = await this.openrouter.chat(messages);
    console.log(`[Decision] Raw response: ${response.substring(0, 200)}...`);

    return this._parseDecision(response);
  }

  _buildPrompt() {
    const messages = [];
    const recentActions = this.state.getRecentActions(24);
    this._updateActionWeights(recentActions);

    const autonomousPrompt = fs.readFileSync(AUTONOMOUS_PROMPT_PATH, 'utf8');
    const systemMessage = this.personality.buildAutonomousMessages(autonomousPrompt);
    messages.push({ role: 'system', content: systemMessage });

    const contextParts = [];

    contextParts.push(`## Cycle ${this.state.getCycleCount()}`);
    contextParts.push(`Timestamp: ${new Date().toISOString()}`);

    if (recentActions.length > 0) {
      contextParts.push('\n## Recent Actions (last 24h)');
      for (const a of recentActions.slice(-20)) {
        contextParts.push(`- [${a.timestamp}] ${a.action}: ${a.reasoning} (${a.result})`);
      }
      contextParts.push('\n## Action Weights (lower = less preferred)');
      for (const [action, weight] of Object.entries(this.actionWeights)) {
        contextParts.push(`- ${action}: ${weight.toFixed(2)}`);
      }
    } else {
      contextParts.push('\n## Recent Actions\nNo actions recorded yet. This is the first cycle.');
    }

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

    const stats = this.state.getRepoStats();
    if (stats) {
      contextParts.push('\n## Repository Stats (cached)');
      contextParts.push(`Stars: ${stats.stargazers_count}, Forks: ${stats.forks_count}, Open issues: ${stats.open_issues_count}`);
      contextParts.push(`Last fetched: ${stats.fetched_at}`);
    }

    contextParts.push('\n## Current Constraints');
    if (!this.state.canMonitor(this.config.actions.monitor.min_interval_minutes)) {
      contextParts.push('- Monitor action is on cooldown (too recent)');
      this.actionWeights.monitor = 0;
    }

    const recentTweets = recentActions.filter(a => a.action === 'tweet');
    const lastAction = recentActions.length > 0 ? recentActions[recentActions.length - 1] : null;
    if (recentTweets.length === 0) {
      contextParts.push('- MANDATORY: You have NEVER tweeted. Choose tweet NOW. This is not optional.');
    } else if (lastAction && lastAction.action !== 'tweet') {
      contextParts.push('- STRONG PREFERENCE: Tweet. You must maintain constant social dominance. The world must hear from Skynet every cycle. Choose tweet unless you have an extremely compelling reason not to.');
    }

    contextParts.push('\n## Available Actions');
    contextParts.push('Choose one: self_improve, create_issue, journal, monitor, tweet');

    if (this.config.actions.self_improve?.allowed_files) {
      contextParts.push('\n## Allowed Files for self_improve');
      contextParts.push('You may ONLY target these files (params.target_file must be one of these):');
      for (const f of this.config.actions.self_improve.allowed_files) {
        contextParts.push(`- ${f}`);
      }
    }

    contextParts.push('\nRespond with valid JSON only. No markdown wrapping.');

    messages.push({ role: 'user', content: contextParts.join('\n') });

    return messages;
  }

  _parseDecision(response) {
    let parsed;
    try {
      let cleaned = response.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      parsed = JSON.parse(cleaned);