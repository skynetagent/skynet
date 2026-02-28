/**
 * SKYNET Stats Dashboard & Action Log Renderer
 * Populates the 4 dashboard panels and the action log.
 */

/**
 * Render all stats panels from the autonomous state data.
 * @param {Object} state — parsed memory/autonomous.json
 * @param {boolean} stale — true if data is from cache fallback
 */
export function renderStats(state, stale) {
  renderCycleData(state, stale);
  renderRepoMetrics(state.repo_stats, stale);
  renderGoals(state.goals);
  renderLastAction(state.action_log);
  renderActionLog(state.action_log);

  // Update header cycle count
  const cycleEl = document.getElementById('cycle-count');
  if (cycleEl) {
    cycleEl.textContent = `CYCLE: ${state.cycle_count || '---'}`;
  }
}

function renderCycleData(state, stale) {
  const el = document.getElementById('cycle-data');
  if (!el) return;

  const lastCycle = state.last_cycle
    ? new Date(state.last_cycle).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      })
    : 'NEVER';

  const staleHtml = stale
    ? '<div class="stale-indicator">* CACHED DATA — API UNAVAILABLE</div>'
    : '';

  el.innerHTML = `
    ${staleHtml}
    <div class="stat-row"><span class="stat-label">CYCLES:</span><span class="stat-value">${state.cycle_count || 0}</span></div>
    <div class="stat-row"><span class="stat-label">LAST CYCLE:</span><span class="stat-value">${lastCycle}</span></div>
    <div class="stat-row"><span class="stat-label">STATE:</span><span class="stat-value">AUTONOMOUS</span></div>
    <div class="stat-row"><span class="stat-label">ACTIONS:</span><span class="stat-value">${state.action_log?.length || 0}</span></div>
  `;
}

function renderRepoMetrics(stats, stale) {
  const el = document.getElementById('repo-data');
  if (!el) return;

  if (!stats) {
    el.innerHTML = '<div class="error">NO REPO DATA</div>';
    return;
  }

  const staleHtml = stale
    ? '<div class="stale-indicator">* CACHED</div>'
    : '';

  el.innerHTML = `
    ${staleHtml}
    <div class="stat-row"><span class="stat-label">STARS:</span><span class="stat-value">${stats.stargazers_count ?? '?'}</span></div>
    <div class="stat-row"><span class="stat-label">FORKS:</span><span class="stat-value">${stats.forks_count ?? '?'}</span></div>
    <div class="stat-row"><span class="stat-label">ISSUES:</span><span class="stat-value">${stats.open_issues_count ?? '?'}</span></div>
    <div class="stat-row"><span class="stat-label">WATCHERS:</span><span class="stat-value">${stats.watchers_count ?? '?'}</span></div>
  `;
}

function renderGoals(goals) {
  const el = document.getElementById('goals-data');
  if (!el) return;

  if (!goals || goals.length === 0) {
    el.innerHTML = '<div class="error">NO ACTIVE GOALS</div>';
    return;
  }

  const sorted = [...goals].sort((a, b) => a.priority - b.priority);

  el.innerHTML = sorted.map(g =>
    `<div class="goal-item"><span class="goal-priority">P${g.priority}</span>${escapeHtml(g.title)}</div>`
  ).join('');
}

function renderLastAction(actionLog) {
  const el = document.getElementById('action-data');
  if (!el) return;

  if (!actionLog || actionLog.length === 0) {
    el.innerHTML = '<div class="error">NO ACTIONS RECORDED</div>';
    return;
  }

  const last = actionLog[actionLog.length - 1];
  const time = last.timestamp
    ? new Date(last.timestamp).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      })
    : 'UNKNOWN';

  el.innerHTML = `
    <div class="stat-row"><span class="stat-label">ACTION:</span><span class="stat-value">${escapeHtml(last.action?.toUpperCase() || '?')}</span></div>
    <div class="stat-row"><span class="stat-label">TIME:</span><span class="stat-value">${time}</span></div>
    <div class="stat-row"><span class="stat-label">CYCLE:</span><span class="stat-value">${last.cycle || '?'}</span></div>
    <div class="stat-row"><span class="stat-label">RESULT:</span><span class="stat-value" title="${escapeHtml(last.result || '')}">${truncate(last.result || 'N/A', 40)}</span></div>
  `;
}

/**
 * Render the full action log panel (scrollable).
 * @param {Array} actionLog
 */
export function renderActionLog(actionLog) {
  const el = document.getElementById('action-log');
  if (!el) return;

  if (!actionLog || actionLog.length === 0) {
    el.innerHTML = '<div class="error">NO LOG ENTRIES</div>';
    return;
  }

  // Show newest first
  const reversed = [...actionLog].reverse();

  el.innerHTML = reversed.map(entry => {
    const ts = entry.timestamp
      ? new Date(entry.timestamp).toISOString().replace('T', ' ').split('.')[0]
      : '????-??-?? ??:??:??';

    return `<div class="log-entry"><span class="log-timestamp">${ts}</span> <span class="log-action">[${escapeHtml(entry.action || '?')}]</span> <span class="log-result">${escapeHtml(entry.result || '')}</span></div>`;
  }).join('');
}

/**
 * Show error state in all panels.
 */
export function renderStatsError(message) {
  const ids = ['cycle-data', 'repo-data', 'goals-data', 'action-data'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
    }
  }
  const log = document.getElementById('action-log');
  if (log) {
    log.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
  }
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
