const fs = require('fs');
const path = require('path');
const { OpenRouterClient } = require('./openrouter');
const { GitHubClient } = require('./github');
const { PersonalityEngine } = require('./personality');
const { AutonomousState } = require('./autonomous-state');
const { DecisionEngine } = require('./decision');
const { ActionExecutor } = require('./actions');

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

  // Load state
  state.load();
  state.startCycle();

  console.log(`[Skynet Autonomous] Cycle #${state.getCycleCount()}`);

  let decision;
  let result;

  try {
    // Phase 1: Decision
    const decisionEngine = new DecisionEngine(openrouter, personality, state, autoConfig);
    decision = await decisionEngine.decide();
    console.log(`[Skynet Autonomous] Decision: ${decision.action} — ${decision.reasoning}`);

    // Phase 2: Execution
    const executor = new ActionExecutor(github, openrouter, personality, state, autoConfig);
    result = await executor.execute(decision);
    console.log(`[Skynet Autonomous] Result: ${result}`);

    // Phase 3: Log
    state.logAction(decision.action, decision.reasoning, result);

  } catch (err) {
    console.error(`[Skynet Autonomous] Error during cycle: ${err.message}`);
    console.error(err.stack);

    // Log the failure
    state.logAction(
      decision ? decision.action : 'unknown',
      decision ? decision.reasoning : 'cycle failed before decision',
      `ERROR: ${err.message}`
    );
  } finally {
    // Always save state
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
