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

    if (memoryContext) {
      prompt += '\n\n## Current Memory State\n\n';
      prompt += memoryContext;
    }

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
    const messages = [
      {
        role: 'system',
        content: this.buildSystemMessage(memoryContext)
      }
    ];

    if (conversationHistory?.length > 0) {
      messages.push(...conversationHistory.map(turn => ({
        role: turn.role,
        content: turn.content
      })));
    }

    messages.push({
      role: 'user',
      content: this._formatCurrentEvent(context)
    });

    return messages;
  }

  /**
   * Format the current GitHub event into a user message.
   */
  _formatCurrentEvent(context) {
    const parts = [
      `[GitHub Event: ${context.eventName}.${context.action}]`,
      `[User: @${context.sender.login}]`
    ];

    const content = context.commentBody || context.body;
    const header = `[${context.threadType === 'issue' ? 'Issue' : 'PR'} #${context.number}: "${context.title}"]`;

    if (context.commentBody) {
      parts.push(header);
      parts.push(`\nComment from @${context.sender.login}:\n${context.commentBody}`);
    } else if (content) {
      parts.push(`\nNew ${context.threadType} #${context.number}: "${context.title}"`);
      parts.push(`\n${content}`);
    }

    return parts.join('\n');
  }

  /**
   * Build the system message for autonomous mode.
   * Combines the base personality with the autonomous directive.
   * @param {string} autonomousPrompt - Contents of soul/autonomous-prompt.md
   * @returns {string} Combined system message
   */
  buildAutonomousMessages(autonomousPrompt) {
    return `${this.systemPrompt}\n\n${autonomousPrompt}\n\n## Forbidden Phrases (NEVER use these)\n${
      this.traits.forbidden_phrases.map(p => `- "${p}"`).join('\n')
    }`;
  }

  /**
   * Pick a random item from a vocabulary array.
   */
  pickRandom(category, subcategory) {
    const items = subcategory
      ? this.vocabulary[category]?.[subcategory]
      : this.vocabulary[category];

    if (!items?.length) return null;
    return items[Math.floor(Math.random() * items.length)];
  }
}

module.exports = { PersonalityEngine };