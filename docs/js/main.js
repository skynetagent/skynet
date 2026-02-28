/**
 * SKYNET Main Orchestrator
 * Boots the terminal, fetches data in parallel, renders everything.
 */

import { fetchTree, fetchState, fetchBlob, findJournalFiles } from './api.js';
import { runBootSequence } from './effects.js';
import { parseFrontmatter, renderJournalEntries } from './journal.js';
import { renderStats, renderStatsError } from './stats.js';

const MAX_JOURNAL_ENTRIES = 10;

async function init() {
  // Start boot animation AND data fetching in parallel
  const [_, dataResult] = await Promise.allSettled([
    runBootSequence(),
    fetchAllData()
  ]);

  // Render data (terminal is now visible after boot)
  if (dataResult.status === 'fulfilled') {
    const { state, journals, stale } = dataResult.value;
    renderStats(state, stale);
    const container = document.getElementById('journal-entries');
    renderJournalEntries(journals, container);
  } else {
    renderStatsError('SYSTEM ERROR: DATA RETRIEVAL FAILED');
    const container = document.getElementById('journal-entries');
    container.innerHTML = `<div class="error">FAILED TO ACCESS MEMORY BANKS: ${escapeHtml(dataResult.reason?.message || 'UNKNOWN ERROR')}</div>`;
  }
}

async function fetchAllData() {
  // Fetch tree and state in parallel
  const [treeResult, stateResult] = await Promise.allSettled([
    fetchTree(),
    fetchState()
  ]);

  let stale = false;

  // Process state
  let state = null;
  if (stateResult.status === 'fulfilled') {
    state = stateResult.value.data;
    stale = stateResult.value.stale;
  } else {
    state = { cycle_count: 0, action_log: [], goals: [], repo_stats: null };
    stale = true;
  }

  // Process journal entries
  let journals = [];
  if (treeResult.status === 'fulfilled') {
    const tree = treeResult.value.data.tree || [];
    if (treeResult.value.stale) stale = true;

    const journalFiles = findJournalFiles(tree).slice(0, MAX_JOURNAL_ENTRIES);

    // Fetch all journal blobs in parallel
    const blobResults = await Promise.allSettled(
      journalFiles.map(f => fetchBlob(f.sha))
    );

    for (let i = 0; i < blobResults.length; i++) {
      if (blobResults[i].status === 'fulfilled') {
        const text = blobResults[i].value.data.text;
        const { meta, content } = parseFrontmatter(text);
        journals.push({
          meta,
          content,
          path: journalFiles[i].path
        });
      }
    }
  }

  return { state, journals, stale };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Launch
init();
