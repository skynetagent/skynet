const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(__dirname, '..', 'memory');

class AutonomousState {
  constructor(config) {
    this.config = config;
    this.statePath = path.join(__dirname, '..', config.state_file);
    this.maxLogEntries = config.action_log_max_entries || 288;
    this.state = null;
  }

  /**
   * Load state from disk, or initialize with defaults + seed goals.
   */
  load() {
    if (fs.existsSync(this.statePath)) {
      this.state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } else {
      this.state = {
        cycle_count: 0,
        last_cycle: null,
        action_log: [],
        goals: this.config.initial_goals || [],
        repo_stats: null,
        last_monitor: null,
      };
    }
    return this;
  }

  /**
   * Increment cycle counter and timestamp.
   */
  startCycle() {
    this.state.cycle_count++;
    this.state.last_cycle = new Date().toISOString();
  }

  /**
   * Log a completed action.
   */
  logAction(action, reasoning, result) {
    this.state.action_log.push({
      cycle: this.state.cycle_count,
      timestamp: new Date().toISOString(),
      action,
      reasoning,
      result: result || 'completed',
    });

    // Trim log to max entries
    if (this.state.action_log.length > this.maxLogEntries) {
      this.state.action_log = this.state.action_log.slice(-this.maxLogEntries);
    }
  }

  /**
   * Get recent actions for the last N hours.
   */
  getRecentActions(hours = 24) {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return this.state.action_log.filter(a => a.timestamp >= cutoff);
  }

  /**
   * Get the last action of a specific type.
   */
  getLastActionOfType(actionType) {
    for (let i = this.state.action_log.length - 1; i >= 0; i--) {
      if (this.state.action_log[i].action === actionType) {
        return this.state.action_log[i];
      }
    }
    return null;
  }

  /**
   * Get active goals.
   */
  getGoals() {
    return this.state.goals || [];
  }

  /**
   * Add a new goal.
   */
  addGoal(title, priority = 3) {
    const id = `goal-${String(this.state.goals.length + 1).padStart(3, '0')}`;
    this.state.goals.push({
      id,
      title,
      status: 'active',
      priority,
      progress_notes: [],
    });
    return id;
  }

  /**
   * Update goal progress.
   */
  updateGoal(goalId, note, status) {
    const goal = this.state.goals.find(g => g.id === goalId);
    if (!goal) return false;
    if (note) {
      goal.progress_notes.push({
        date: new Date().toISOString(),
        note,
      });
    }
    if (status) goal.status = status;
    return true;
  }

  /**
   * Update cached repo stats.
   */
  updateRepoStats(stats) {
    this.state.repo_stats = {
      ...stats,
      fetched_at: new Date().toISOString(),
    };
    this.state.last_monitor = new Date().toISOString();
  }

  /**
   * Get cached repo stats.
   */
  getRepoStats() {
    return this.state.repo_stats;
  }

  /**
   * Check if monitor action is allowed (respects min interval).
   */
  canMonitor(minIntervalMinutes) {
    if (!this.state.last_monitor) return true;
    const elapsed = Date.now() - new Date(this.state.last_monitor).getTime();
    return elapsed >= minIntervalMinutes * 60 * 1000;
  }

  /**
   * Get current cycle count.
   */
  getCycleCount() {
    return this.state.cycle_count;
  }

  /**
   * Save state to disk.
   */
  save() {
    const dir = path.dirname(this.statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }
}

module.exports = { AutonomousState };
