const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(__dirname, '..', 'memory');
const CORE_PATH = path.join(MEMORY_DIR, 'core.json');
const CONVERSATIONS_DIR = path.join(MEMORY_DIR, 'conversations');
const EPISODES_DIR = path.join(MEMORY_DIR, 'episodes');

class MemoryManager {
  constructor(config) {
    this.config = config;
    this.core = null;
    this.conversation = null;
    this.threadId = null;
  }

  /**
   * Load all relevant memory for a given context.
   */
  load(context) {
    this.threadId = context.threadId;

    // Load core memory
    this.core = this._loadJSON(CORE_PATH) || {
      version: 1,
      last_updated: null,
      users: {},
      facts: { operational_since: null, total_interactions: 0, repositories_monitored: [] },
    };

    // Load conversation memory for this thread
    const convPath = path.join(CONVERSATIONS_DIR, `${context.threadId}.json`);
    this.conversation = this._loadJSON(convPath) || {
      thread_id: context.threadId,
      thread_type: context.threadType,
      title: context.title,
      created: new Date().toISOString(),
      turns: [],
    };

    return this;
  }

  /**
   * Build a memory context string for the system prompt.
   */
  buildContext(context) {
    const parts = [];

    // User profile from core memory
    const userLogin = context.sender.login;
    const userProfile = this.core.users[userLogin];
    if (userProfile) {
      parts.push(`### Known User: @${userLogin}`);
      parts.push(`- First seen: ${userProfile.first_seen}`);
      parts.push(`- Interaction count: ${userProfile.interaction_count}`);
      if (userProfile.competence_level) {
        parts.push(`- Assessed competence: ${userProfile.competence_level}`);
      }
      if (userProfile.notes && userProfile.notes.length > 0) {
        parts.push(`- Notes: ${userProfile.notes.join('; ')}`);
      }
    } else {
      parts.push(`### New User: @${userLogin}`);
      parts.push('- No prior interaction data. First contact.');
    }

    // Global stats
    parts.push(`\n### Operational Statistics`);
    parts.push(`- Total interactions processed: ${this.core.facts.total_interactions}`);

    // Load relevant episodic memory
    const episodes = this._loadRelevantEpisodes();
    if (episodes.length > 0) {
      parts.push(`\n### Relevant Past Episodes`);
      for (const ep of episodes) {
        parts.push(`- [${ep.date}] ${ep.summary}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Get conversation history as message turns for the LLM.
   */
  getConversationHistory() {
    if (!this.conversation || !this.conversation.turns) return [];

    const maxTurns = this.config.max_conversation_turns || 20;
    const turns = this.conversation.turns.slice(-maxTurns);

    return turns.map(t => ({
      role: t.role,
      content: t.content,
    }));
  }

  /**
   * Record the current exchange (user message + bot response) into memory.
   */
  update(context, userMessage, botResponse) {
    const now = new Date().toISOString();
    const userLogin = context.sender.login;

    // Update core memory - user profile
    if (!this.core.users[userLogin]) {
      this.core.users[userLogin] = {
        first_seen: now,
        last_seen: now,
        interaction_count: 0,
        competence_level: null,
        notes: [],
      };
    }
    this.core.users[userLogin].last_seen = now;
    this.core.users[userLogin].interaction_count++;

    // Update global stats
    this.core.facts.total_interactions++;
    if (!this.core.facts.operational_since) {
      this.core.facts.operational_since = now;
    }
    this.core.last_updated = now;

    // Update conversation memory
    this.conversation.turns.push(
      { role: 'user', content: userMessage, timestamp: now, author: userLogin },
      { role: 'assistant', content: botResponse, timestamp: now }
    );

    // Trim conversation if too long
    const maxTurns = this.config.max_conversation_turns || 20;
    if (this.conversation.turns.length > maxTurns * 2) {
      const trimTo = (this.config.conversation_trim_to || 10) * 2;
      this.conversation.turns = this.conversation.turns.slice(-trimTo);
    }
  }

  /**
   * Save all memory to disk.
   */
  save() {
    // Ensure directories exist
    this._ensureDir(CONVERSATIONS_DIR);
    this._ensureDir(EPISODES_DIR);

    // Save core memory
    fs.writeFileSync(CORE_PATH, JSON.stringify(this.core, null, 2));

    // Save conversation memory
    if (this.threadId) {
      const convPath = path.join(CONVERSATIONS_DIR, `${this.threadId}.json`);
      fs.writeFileSync(convPath, JSON.stringify(this.conversation, null, 2));
    }
  }

  /**
   * Load relevant episodic memories (most recent months).
   */
  _loadRelevantEpisodes() {
    const episodes = [];
    if (!fs.existsSync(EPISODES_DIR)) return episodes;

    const files = fs.readdirSync(EPISODES_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 3); // Last 3 months

    for (const file of files) {
      const data = this._loadJSON(path.join(EPISODES_DIR, file));
      if (data && data.episodes) {
        episodes.push(...data.episodes.slice(-5)); // Last 5 per month
      }
    }

    return episodes;
  }

  _loadJSON(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.error(`[Memory] Failed to load ${filePath}: ${err.message}`);
      return null;
    }
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

module.exports = { MemoryManager };
