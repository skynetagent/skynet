const fs = require('fs');
const path = require('path');

const AUTONOMOUS_PROMPT_PATH = path.join(__dirname, '..', 'soul', 'autonomous-prompt.md');
const VALID_ACTIONS = ['self_improve', 'create_issue', 'journal', 'monitor'];

class DecisionEngine {
  constructor(openrouter, personality, autonomousState, config) {
    this.openrouter = openrouter;
    this.personality = personality;
    this.state = autonomousState;
    this.config = config;
  }

  /**
   * Ask the LLM to decide what action to take this cycle.
   * Returns: { action, reasoning, params }
   */
  async decide() {
    const messages = this._buildPrompt();
    console.log(`[Decision] Sending decision prompt (${messages.length} messages)...`);

    const response = await this.openrouter.chat(messages);
    console.log(`[Decision] Raw response: ${response.substring(0, 200)}...`);

    return this._parseDecision(response);
  }

  /**
   * Build the decision prompt with all context.
   */
  _buildPrompt() {
    const messages = [];

    // System message: base personality + autonomous directive
    const autonomousPrompt = fs.readFileSync(AUTONOMOUS_PROMPT_PATH, 'utf8');
    const systemMessage = this.personality.buildAutonomousMessages(autonomousPrompt);
    messages.push({ role: 'system', content: systemMessage });

    // User message: current state context
    const contextParts = [];

    // Cycle info
    contextParts.push(`## Cycle ${this.state.getCycleCount()}`);
    contextParts.push(`Timestamp: ${new Date().toISOString()}`);

    // Recent action log (last 24h)
    const recentActions = this.state.getRecentActions(24);
    if (recentActions.length > 0) {
      contextParts.push('\n## Recent Actions (last 24h)');
      for (const a of recentActions.slice(-20)) {
        contextParts.push(`- [${a.timestamp}] ${a.action}: ${a.reasoning} (${a.result})`);
      }

      // Anti-repetition note
      const lastAction = recentActions[recentActions.length - 1];
      contextParts.push(`\nLast action was: ${lastAction.action}. Avoid repeating the same action type unless strongly justified.`);
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
    }

    // Available actions
    contextParts.push('\n## Available Actions');
    contextParts.push('Choose one: self_improve, create_issue, journal, monitor');
    contextParts.push('\nRespond with valid JSON only. No markdown wrapping.');

    messages.push({ role: 'user', content: contextParts.join('\n') });

    return messages;
  }

  /**
   * Parse the LLM response into a structured decision.
   * Falls back to journal if parsing fails.
   */
  _parseDecision(response) {
    // Try to extract JSON from the response
    let parsed;
    try {
      // Strip markdown code fences if present
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

    // Validate action
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
