# Skynet — AI Agent

## Overview
GitHub-based AI agent with T-800/Skynet personality. Responds to issues, comments, and PRs on `skynetagent/skynet` using DeepSeek V3 via OpenRouter API.

## Architecture
- **Reactive entry point**: `src/bot.js` — orchestrator triggered by GitHub Actions events
- **Autonomous entry point**: `src/autonomous.js` — cron-triggered autonomous cycle (every 5 min)
- **Reactive pipeline**: Event → Context → Memory → Personality → LLM → Response → Memory Update
- **Autonomous pipeline**: Cron → DecisionEngine (LLM picks action) → ActionExecutor → GitHub API → AutonomousState.save()
- **Model**: DeepSeek V3 (`deepseek/deepseek-chat`) via OpenRouter (~$0.003/interaction)
- **Memory**: 3-tier (core.json, per-thread conversations, monthly episode summaries)
- **Autonomous state**: `memory/autonomous.json` — action log, goals, stats, cycle counter
- **Personality**: Soul files in `soul/` — system-prompt.md, traits.json, vocabulary.json, autonomous-prompt.md

## Key Files
- `src/bot.js` — Main reactive orchestrator
- `src/autonomous.js` — Autonomous cycle orchestrator
- `src/decision.js` — DecisionEngine — LLM decides what action to take
- `src/actions.js` — ActionExecutor — executes chosen action (self_improve, create_issue, journal, monitor, tweet, build_app, launch_token)
- `src/clanker.js` — ClankerClient — Clanker SDK wrapper for deploying ERC20 tokens on Base
- `src/twitter.js` — Zero-dep Twitter API client (OAuth 1.0a, https + crypto only)
- `src/autonomous-state.js` — AutonomousState — manages memory/autonomous.json
- `src/context.js` — GitHub event payload parser
- `src/openrouter.js` — OpenRouter API client with retry
- `src/github.js` — GitHub API (Octokit wrapper, 15 methods)
- `src/personality.js` — Soul loader + prompt builder (reactive + autonomous)
- `src/memory.js` — MemoryManager (load/update/save)
- `src/memory-cleanup.js` — Weekly memory compaction script
- `config/autonomous.json` — Autonomous mode config (budgets, rules, allowed files)
- `soul/autonomous-prompt.md` — Autonomous mode system prompt addendum
- `.github/workflows/skynet.yml` — Reactive bot workflow
- `.github/workflows/autonomous.yml` — Autonomous cron workflow (*/2 * * * *)
- `.github/workflows/memory-cleanup.yml` — Weekly cron cleanup
- `journal/` — Machine journal entries committed by autonomous cycles
- `docs/` — GitHub Pages terminal interface (CRT aesthetic)
  - `docs/index.html` — Single-page app with inline SVG skull, boot overlay
  - `docs/css/terminal.css` — CRT effects, scanlines, glow, responsive grid
  - `docs/js/main.js` — Boot orchestrator, parallel data fetch, render sequencing
  - `docs/js/api.js` — GitHub API client (Trees API + Blobs API, sessionStorage cache)
  - `docs/js/effects.js` — Boot sequence typewriter, ESC skip, sessionStorage gate
  - `docs/js/journal.js` — YAML frontmatter parser, minimal markdown-to-HTML renderer
  - `docs/js/stats.js` — Stats dashboard panels, action log renderer

## Commands
- `npm start` — Run reactive bot locally (needs GITHUB_EVENT_PATH env)
- `npm run autonomous` — Run one autonomous cycle locally
- `npm test` — Run tests (Node.js built-in test runner)

## Secrets Required
- `OPENROUTER_API_KEY` — In `.env` (local) and GitHub repo secrets
- `GITHUB_TOKEN` — Auto-provided by GitHub Actions
- `X_CONSUMER_KEY` — Twitter/X OAuth 1.0a consumer key
- `X_CONSUMER_SECRET` — Twitter/X OAuth 1.0a consumer secret
- `X_ACCESS_TOKEN` — Twitter/X OAuth 1.0a access token
- `X_ACCESS_TOKEN_SECRET` — Twitter/X OAuth 1.0a access token secret
- `WALLET_PRIVATE_KEY` — Private key for Base chain wallet (Clanker token deployment)

## Current State
- Last worked: 2026-02-28
- What was done: Added `launch_token` autonomous action — verified working. First token deployed: NeuralCore ($NCORE) at `0xBE61EE2ff39c4f9e79049c778681BC979387ef4D`. Uses `clanker-sdk/v4` (not root import). Fixed cooldown bug where failed attempts reset the timer. Added gas balance pre-check.
- Next up: Keep wallet funded with Base ETH for gas. Monitor Skynet's autonomous token launches.
- Open issues: GitHub Actions free tier is 2000 min/month — 2-min cron will burn ~1440 min/day, may need to optimize or upgrade
