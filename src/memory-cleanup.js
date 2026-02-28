const fs = require('fs');
const path = require('path');
const { OpenRouterClient } = require('./openrouter');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'bot.json');
const MEMORY_DIR = path.join(__dirname, '..', 'memory');
const CONVERSATIONS_DIR = path.join(MEMORY_DIR, 'conversations');
const EPISODES_DIR = path.join(MEMORY_DIR, 'episodes');

async function main() {
  console.log('[Memory Cleanup] Starting weekly compaction...');

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY required for summarization');
  }

  const openrouter = new OpenRouterClient(apiKey, config.model);

  // Find conversation files with many turns
  if (!fs.existsSync(CONVERSATIONS_DIR)) {
    console.log('[Memory Cleanup] No conversations directory. Nothing to do.');
    return;
  }

  const files = fs.readdirSync(CONVERSATIONS_DIR).filter(f => f.endsWith('.json'));
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Load or create current month's episode file
  const episodePath = path.join(EPISODES_DIR, `${currentMonth}.json`);
  let episodeFile;
  try {
    episodeFile = JSON.parse(fs.readFileSync(episodePath, 'utf8'));
  } catch {
    episodeFile = { month: currentMonth, episodes: [] };
  }

  let compacted = 0;

  for (const file of files) {
    const filePath = path.join(CONVERSATIONS_DIR, file);
    const conversation = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const threshold = config.memory.episode_summary_threshold || 50;
    if (!conversation.turns || conversation.turns.length < threshold) {
      continue;
    }

    console.log(`[Memory Cleanup] Summarizing ${file} (${conversation.turns.length} turns)...`);

    // Summarize the conversation using the LLM
    const turnText = conversation.turns
      .map(t => `${t.role}: ${t.content}`)
      .join('\n');

    const summary = await openrouter.chat([
      {
        role: 'system',
        content: 'You are a memory compaction system. Summarize the following conversation into 2-3 sentences capturing: who was involved, what was discussed, key outcomes, and any notable user behaviors. Be factual and concise.',
      },
      {
        role: 'user',
        content: `Summarize this conversation:\n\n${turnText.slice(0, 8000)}`,
      },
    ]);

    // Add to episodes
    episodeFile.episodes.push({
      date: conversation.created || now.toISOString(),
      thread_id: conversation.thread_id,
      title: conversation.title,
      summary: summary,
    });

    // Trim the conversation to recent turns only
    const trimTo = (config.memory.conversation_trim_to || 10) * 2;
    conversation.turns = conversation.turns.slice(-trimTo);
    conversation.compacted_at = now.toISOString();
    fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2));

    compacted++;
  }

  // Save episodes
  if (compacted > 0) {
    if (!fs.existsSync(EPISODES_DIR)) {
      fs.mkdirSync(EPISODES_DIR, { recursive: true });
    }
    fs.writeFileSync(episodePath, JSON.stringify(episodeFile, null, 2));
  }

  console.log(`[Memory Cleanup] Done. Compacted ${compacted} conversations.`);
}

main().catch((err) => {
  console.error('[Memory Cleanup] Fatal error:', err.message);
  process.exit(1);
});
