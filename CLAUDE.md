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
- `src/actions.js` — ActionExecutor — executes chosen action (self_improve, create_issue, journal, monitor)
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
- `.github/workflows/autonomous.yml` — Autonomous cron workflow (*/5 * * * *)
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

## Current State
- Last worked: 2026-02-28
- What was done: GitHub Pages terminal interface — 7-file SPA with CRT aesthetic, boot sequence, stats dashboard, journal viewer, action log. No build step, pure vanilla ES modules.
- Next up: Enable GitHub Pages (main branch, /docs folder), push and verify at https://skynetagent.github.io/skynet/
- Open issues: GitHub Actions free tier is 2000 min/month — 5-min cron may exceed this, consider reducing frequency if needed
