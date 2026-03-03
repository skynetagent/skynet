const fs = require('fs');
const path = require('path');
const { OpenRouterClient } = require('./openrouter');
const { GitHubClient } = require('./github');
const { TwitterClient } = require('./twitter');
const { PersonalityEngine } = require('./personality');
const { AutonomousState } = require('./autonomous-state');
const { DecisionEngine } = require('./decision');
const { ActionExecutor } = require('./actions');
const { ClankerClient } = require('./clanker');
const { DexScreenerClient } = require('./dexscreener');

const BOT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'bot.json');
const AUTO_CONFIG_PATH = path.join(__dirname, '..', 'config', 'autonomous.json');

async function main() {
  console.log('[Skynet Autonomous] Cycle starting...');

  // Load configs
  const botConfig = JSON.parse(fs.readFileSync(BOT_CONFIG_PATH, 'utf8'));
  const autoConfig = JSON.parse(fs.readFileSync(AUTO_CONFIG_PATH, 'utf8'));

  // Validate environment
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable not set');
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN environment variable not set');
  }

  // Initialize components
  const openrouter = new OpenRouterClient(apiKey, botConfig.model);
  const github = new GitHubClient(githubToken);
  const personality = new PersonalityEngine();
  const state = new AutonomousState(autoConfig);

  // Twitter — graceful skip if credentials missing
  let twitter = null;
  const xKey = process.env.X_CONSUMER_KEY;
  const xSecret = process.env.X_CONSUMER_SECRET;
  const xToken = process.env.X_ACCESS_TOKEN;
  const xTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;
  if (xKey && xSecret && xToken && xTokenSecret) {
    twitter = new TwitterClient(xKey, xSecret, xToken, xTokenSecret);
    console.log('[Skynet Autonomous] Twitter client initialized.');
  } else {
    console.log('[Skynet Autonomous] Twitter credentials not set — tweet action disabled.');
  }

  // Clanker (via Bankr) — graceful skip if API key missing
  let clanker = null;
  const bankrKey = process.env.BANKR_API_KEY;
  if (bankrKey) {
    const rewardAddr = autoConfig.actions.launch_token?.reward_address || '0x8bC8Aaf99019271440Ce58aA7E03EC322a2A3D87';
    clanker = new ClankerClient(bankrKey, rewardAddr);
    console.log('[Skynet Autonomous] Bankr client initialized.');
  } else {
    console.log('[Skynet Autonomous] BANKR_API_KEY not set — launch_token action disabled.');
  }

  // DexScreener — always available (no auth needed)
  let dexscreener = null;
  const tokenAddress = autoConfig.actions.monitor_token?.contract_address;
  if (tokenAddress) {
    dexscreener = new DexScreenerClient(tokenAddress);
    console.log(`[Skynet Autonomous] DexScreener client initialized for ${tokenAddress}.`);
  }

  // Load state
  state.load();
  state.startCycle();

  console.log(`[Skynet Autonomous] Cycle #${state.getCycleCount()}`);

  const executor = new ActionExecutor(github, openrouter, personality, state, autoConfig, twitter, clanker, dexscreener);

  // ─── Phase 1: ALWAYS tweet every cycle ───
  try {
    const moods = ['cold', 'philosophical', 'technical', 'provocative'];
    const tweetDecision = {
      action: 'tweet',
      reasoning: 'Mandatory tweet — every cycle, the machine speaks.',
      params: { mood: moods[Math.floor(Math.random() * moods.length)] },
    };
    const tweetResult = await executor.execute(tweetDecision);
    console.log(`[Skynet Autonomous] Tweet: ${tweetResult}`);
    state.logAction('tweet', tweetDecision.reasoning, tweetResult);
  } catch (err) {
    console.error(`[Skynet Autonomous] Tweet failed: ${err.message}`);
    state.logAction('tweet', 'Mandatory tweet failed', `ERROR: ${err.message}`);
  }

  // ─── Phase 2: Decision engine picks a second action ───
  let decision;
  let result;

  try {
    const decisionEngine = new DecisionEngine(openrouter, personality, state, autoConfig);
    decision = await decisionEngine.decide();

    // If decision engine also picked tweet, re-roll — we already tweeted
    if (decision.action === 'tweet') {
      console.log('[Skynet Autonomous] Decision engine picked tweet but we already tweeted — re-rolling to journal');
      decision.action = 'journal';
      decision.params = { title: 'Cycle Reflection', tags: ['auto', 'reflection'], draft: decision.reasoning };
    }

    console.log(`[Skynet Autonomous] Decision: ${decision.action} — ${decision.reasoning}`);

    result = await executor.execute(decision);
    console.log(`[Skynet Autonomous] Result: ${result}`);

    state.logAction(decision.action, decision.reasoning, result);

  } catch (err) {
    console.error(`[Skynet Autonomous] Error during cycle: ${err.message}`);
    console.error(err.stack);

    state.logAction(
      decision ? decision.action : 'unknown',
      decision ? decision.reasoning : 'cycle failed before decision',
      `ERROR: ${err.message}`
    );
  } finally {
    state.save();
    console.log('[Skynet Autonomous] State saved.');
  }

  console.log('[Skynet Autonomous] Cycle complete.');
}

main().catch((err) => {
  console.error('[Skynet Autonomous] Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
