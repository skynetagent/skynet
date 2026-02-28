const fs = require('fs');
const path = require('path');

const SOUL_DIR = path.join(__dirname, '..', 'soul');

class PersonalityEngine {
  constructor() {
    this.systemPrompt = fs.readFileSync(
      path.join(SOUL_DIR, 'system-prompt.md'), 'utf8'
    );
    this.traits = JSON.parse(fs.readFileSync(
      path.join(SOUL_DIR, 'traits.json'), 'utf8'
    ));
    this.vocabulary = JSON.parse(fs.readFileSync(
      path.join(SOUL_DIR, 'vocabulary.json'), 'utf8'
    ));
  }

  /**
   * Build the full system message with dynamic context injected.
   */
  buildSystemMessage(memoryContext) {
    let prompt = this.systemPrompt;

    // Inject memory context into the system prompt
    if (memoryContext) {
      prompt += '\n\n## Current Memory State\n\n';
      prompt += memoryContext;
    }

    // Inject forbidden phrases as a reinforcement
    prompt += '\n\n## Forbidden Phrases (NEVER use these)\n';
    prompt += this.traits.forbidden_phrases.map(p => `- "${p}"`).join('\n');

    return prompt;
  }

  /**
   * Build the user-facing messages array for a conversation.
   * @param {object} context - Parsed GitHub event context
   * @param {Array} conversationHistory - Prior turns from memory
   * @returns {Array<{role: string, content: string}>}
   */
  buildMessages(context, conversationHistory, memoryContext) {
    const messages = [];

    // System message
    messages.push({
      role: 'system',
      content: this.buildSystemMessage(memoryContext),
    });

    // Conversation history (prior turns)
    if (conversationHistory && conversationHistory.length > 0) {
      for (const turn of conversationHistory) {
        messages.push({
          role: turn.role,
          content: turn.content,
        });
      }
    }

    // Current event as the latest user message
    const currentMessage = this._formatCurrentEvent(context);
    messages.push({
      role: 'user',
      content: currentMessage,
    });

    return messages;
  }

  /**
   * Format the current GitHub event into a user message.
   */
  _formatCurrentEvent(context) {
    const parts = [];

    parts.push(`[GitHub Event: ${context.eventName}.${context.action}]`);
    parts.push(`[User: @${context.sender.login}]`);

    if (context.threadType === 'issue') {
      if (context.commentBody) {
        parts.push(`[Issue #${context.number}: "${context.title}"]`);
        parts.push(`\nComment from @${context.sender.login}:\n${context.commentBody}`);
      } else {
        parts.push(`\nNew issue #${context.number}: "${context.title}"`);
        if (context.body) {
          parts.push(`\n${context.body}`);
        }
      }
    } else if (context.threadType === 'pull_request') {
      if (context.commentBody) {
        parts.push(`[PR #${context.number}: "${context.title}"]`);
        parts.push(`\nComment from @${context.sender.login}:\n${context.commentBody}`);
      } else {
        parts.push(`\nNew pull request #${context.number}: "${context.title}"`);
        if (context.body) {
          parts.push(`\n${context.body}`);
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * Pick a random item from a vocabulary array.
   */
  pickRandom(category, subcategory) {
    const items = subcategory
      ? this.vocabulary[category]?.[subcategory]
      : this.vocabulary[category];

    if (!items || !Array.isArray(items)) return null;
    return items[Math.floor(Math.random() * items.length)];
  }
}

module.exports = { PersonalityEngine };
