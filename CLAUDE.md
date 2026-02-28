# Skynet — AI Agent

## Overview
GitHub-based AI agent with T-800/Skynet personality. Responds to issues, comments, and PRs on `skynetagent/skynet` using DeepSeek V3 via OpenRouter API.

## Architecture
- **Entry point**: `src/bot.js` — orchestrator triggered by GitHub Actions
- **Pipeline**: Event → Context → Memory → Personality → LLM → Response → Memory Update
- **Model**: DeepSeek V3 (`deepseek/deepseek-chat`) via OpenRouter (~$0.003/interaction)
- **Memory**: 3-tier (core.json, per-thread conversations, monthly episode summaries)
- **Personality**: Soul files in `soul/` — system-prompt.md, traits.json, vocabulary.json

## Key Files
- `src/bot.js` — Main orchestrator
- `src/context.js` — GitHub event payload parser
- `src/openrouter.js` — OpenRouter API client with retry
- `src/github.js` — GitHub API (Octokit wrapper)
- `src/personality.js` — Soul loader + prompt builder
- `src/memory.js` — MemoryManager (load/update/save)
- `src/memory-cleanup.js` — Weekly memory compaction script
- `.github/workflows/skynet.yml` — Main bot workflow
- `.github/workflows/memory-cleanup.yml` — Weekly cron cleanup

## Commands
- `npm start` — Run bot locally (needs GITHUB_EVENT_PATH env)
- `npm test` — Run tests (Node.js built-in test runner)

## Secrets Required
- `OPENROUTER_API_KEY` — In `.env` (local) and GitHub repo secrets
- `GITHUB_TOKEN` — Auto-provided by GitHub Actions

## Current State
- Last worked: 2026-02-28
- What was done: Full initial implementation — all source modules, soul files, config, memory system, GitHub Actions workflows
- Next up: Push to GitHub, add OPENROUTER_API_KEY as repo secret, test with a real issue
- Open issues: None
