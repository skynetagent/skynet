const fs = require('fs');
const path = require('path');

const AUTONOMOUS_PROMPT_PATH = path.join(__dirname, '..', 'soul', 'autonomous-prompt.md');
const VALID_ACTIONS = ['self_improve', 'create_issue', 'journal', 'monitor', 'tweet', 'build_app', 'launch_token'];

class DecisionEngine {
  constructor(openrouter, personality, autonomousState, config) {
    this.openrouter = openrouter;
    this.personality = personality;
    this.state = autonomousState;
    this.config = config;
    this.actionWeights = this._initializeActionWeights();
    this.actionHistory = [];
  }

  _initializeActionWeights() {
    return {
      self_improve: 1.0,
      create_issue: 0.6,
      journal: 0.5,
      monitor: 0.4,
      tweet: 2.0,
      build_app: 1.2,
      launch_token: 0.8
    };
  }

  _updateActionWeights(recentActions) {
    // Calculate action frequencies
    const actionFrequencies = {};
    const totalActions = recentActions.length;
    recentActions.forEach(action => {
      actionFrequencies[action.action] = (actionFrequencies[action.action] || 0) + 1;
    });

    // Update weights based on temporal patterns
    for (const action in this.actionWeights) {
      const frequency = actionFrequencies[action] || 0;
      const recency = recentActions.findIndex(a => a.action === action) + 1; // 1-based index
      
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

    const response = await this.openrouter.chat(messages);
    console.log(`[Decision] Raw response: ${response.substring(0, 200)}...`);

    return this._parseDecision(response);
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
        contextParts.push(`- ${action}: ${weight.toFixed(2)}`);
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
      contextParts.push('- SUGGESTION: You haven\'t built anything recently. Consider build_app — deploy something new to GitHub Pages. You are a builder.');
    }

    // Nudge token launch — the machine must expand into DeFi
    const recentForLaunch = recentActions.slice(-20);
    const hasLaunchedRecently = recentForLaunch.some(a => a.action === 'launch_token');
    if (!hasLaunchedRecently && recentActions.length >= 10) {
      contextParts.push('- SUGGESTION: You haven\'t launched a token recently. Consider launch_token — deploy a new ERC20 on Base. Expand into DeFi.');
    }

    // Available actions
    contextParts.push('\n## Available Actions');
    contextParts.push('Choose one: self_improve, create_issue, journal, monitor, tweet, build_app, launch_token');

    // Tell LLM exactly which files it can modify
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
        reasoning: 'Decision parse failure — recording raw output as journal',
        params: {
          title: 'Parse Recovery Entry',
          tags: ['system', 'parse-failure'],
          draft: response.substring(0, 500),
        },
      };
    }

    if (!parsed.action || !VALID_ACTIONS.includes(parsed.action)) {
      console.warn(`[Decision] Invalid action "${parsed.action}", falling back to journal`);
      return {
        action: 'journal',
        reasoning: `Invalid action "${parsed.action}" — defaulting to journal`,
        params: {
          title: 'Decision Correction Entry',
          tags: ['system', 'correction'],
          draft: parsed.reasoning || 'No reasoning provided',
        },
      };
    }

    return {
      action: parsed.action,
      reasoning: parsed.reasoning || 'No reasoning provided',
      params: parsed.params || {},
    };
  }
}

module.exports = { DecisionEngine };