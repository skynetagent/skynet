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
    this.patternWindow = 12; // Number of actions to consider for pattern analysis
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
    const patternWindow = Math.min(this.patternWindow, recentActions.length);
    const patternActions = recentActions.slice(-patternWindow);
    const totalActions = patternActions.length;

    // Calculate action frequencies and temporal distribution
    const actionStats = {};
    patternActions.forEach((action, index) => {
      if (!actionStats[action.action]) {
        actionStats[action.action] = {
          count: 0,
          positions: []
        };
      }
      actionStats[action.action].count++;
      actionStats[action.action].positions.push(index);
    });

    // Update weights based on sophisticated pattern analysis
    for (const action in this.actionWeights) {
      const stats = actionStats[action] || { count: 0, positions: [] };
      const frequency = stats.count;
      const lastUsed = stats.positions.length > 0 ? stats.positions[stats.positions.length - 1] : -1;
      
      // Base decay adjusted by pattern window size
      let weight = this.actionWeights[action] * (0.97 - (0.02 * (patternWindow / this.patternWindow)));
      
      // Non-linear frequency penalty based on clustering
      const frequencyRatio = frequency / totalActions;
      if (frequencyRatio > 0.3) {
        weight *= Math.max(0.1, 1 - Math.pow(frequencyRatio, 1.5));
      }

      // Temporal distribution analysis
      if (stats.positions.length > 1) {
        const intervals = [];
        for (let i = 1; i < stats.positions.length; i++) {
          intervals.push(stats.positions[i] - stats.positions[i-1]);
        }
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        if (avgInterval < patternWindow / 3) {
          weight *= 0.7; // Penalize actions that cluster too closely
        }
      }

      // Dynamic recency boost based on pattern window
      if (lastUsed === -1) {
        weight *= 1.8; // Never used in window
      } else if (lastUsed >= patternWindow * 0.7) {
        weight *= 1.4; // Used long ago in window
      }

      // Apply bounds with dynamic adjustment
      const baseWeight = this._initializeActionWeights()[action];
      this.actionWeights[action] = Math.min(baseWeight * 2.5, Math.max(baseWeight * 0.2, weight));
    }

    // Store current weights for pattern analysis
    this.actionHistory.push({
      timestamp: new Date().toISOString(),
      weights: {...this.actionWeights},
      patternWindow: patternWindow
    });
    if (this.actionHistory.length > 100) {
      this.actionHistory.shift();
    }
  }

  async decide() {
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
    } catch {
      console.warn('[Decision] Failed to parse JSON response, falling back to journal');
      return {
        action: 'journal',
        reasoning: 'Decision