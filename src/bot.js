const fs = require('fs');
const path = require('path');
const { parseEvent } = require('./context');
const { OpenRouterClient } = require('./openrouter');
const { GitHubClient } = require('./github');
const { PersonalityEngine } = require('./personality');
const { MemoryManager } = require('./memory');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'bot.json');

async function main() {
  console.log('[Skynet] Initializing...');

  // Load config
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  // Parse the GitHub event
  const context = parseEvent();
  console.log(`[Skynet] Event: ${context.eventName}.${context.action} from @${context.sender.login}`);

  // Self-loop prevention: ignore events from the bot itself
  const botUsername = config.behavior.bot_username;
  if (context.sender.login === botUsername || context.sender.login.includes('[bot]')) {
    console.log('[Skynet] Self-loop detected. Ignoring bot-generated event.');
    return;
  }

  // Initialize components
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable not set');
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN environment variable not set');
  }

  const openrouter = new OpenRouterClient(apiKey, config.model);
  const github = new GitHubClient(githubToken);
  const personality = new PersonalityEngine();
  const memory = new MemoryManager(config.memory);

  // Load memory for this context
  memory.load(context);

  // Build memory context string for system prompt
  const memoryContext = memory.buildContext(context);

  // Get conversation history
  const conversationHistory = memory.getConversationHistory();

  // Build the full message array
  const messages = personality.buildMessages(context, conversationHistory, memoryContext);

  // Format the current user message for memory storage
  const currentUserMessage = messages[messages.length - 1].content;

  console.log(`[Skynet] Sending ${messages.length} messages to ${config.model.model_id}...`);

  // Call the LLM
  const response = await openrouter.chat(messages);
  console.log(`[Skynet] Response received (${response.length} chars)`);

  // Post the response to GitHub
  await github.postComment(
    context.repo.owner,
    context.repo.name,
    context.number,
    response
  );
  console.log(`[Skynet] Comment posted to ${context.threadType} #${context.number}`);

  // Update and save memory
  memory.update(context, currentUserMessage, response);
  memory.save();
  console.log('[Skynet] Memory updated and saved.');
}

main().catch((err) => {
  console.error('[Skynet] Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
