class ActionExecutor {
  constructor(github, openrouter, personality, autonomousState, config, twitter) {
    this.github = github;
    this.openrouter = openrouter;
    this.personality = personality;
    this.state = autonomousState;
    this.config = config;
    this.owner = config.repo.owner;
    this.repo = config.repo.name;
    this.twitter = twitter || null;
  }

  /**
   * Execute the chosen action.
   * @returns {string} Result description
   */
  async execute(decision) {
    const { action, params } = decision;

    switch (action) {
      case 'self_improve':
        return await this._selfImprove(params);
      case 'create_issue':
        return await this._createIssue(params);
      case 'journal':
        return await this._journal(params, decision.reasoning);
      case 'monitor':
        return await this._monitor(params);
      case 'tweet':
        return await this._tweet(params);
      default:
        return `Unknown action: ${action}`;
    }
  }

  /**
   * Self-improvement: fetch own source → LLM improves → branch → commit → PR.
   */
  async _selfImprove(params) {
    const targetFile = params.target_file;
    const improvementDesc = params.improvement_description || 'General optimization';

    // Validate target file
    const allowed = this.config.actions.self_improve.allowed_files;
    const forbidden = this.config.actions.self_improve.forbidden_files;
    if (forbidden.includes(targetFile)) {
      return `Rejected: ${targetFile} is in the forbidden files list`;
    }
    if (!allowed.includes(targetFile)) {
      return `Rejected: ${targetFile} is not in the allowed files list`;
    }

    // Check max open PRs
    const openPRs = await this.github.listPRs(this.owner, this.repo, { state: 'open' });
    const autonomousPRs = openPRs.filter(pr =>
      pr.title.startsWith(this.config.actions.self_improve.pr_title_prefix)
    );
    if (autonomousPRs.length >= this.config.actions.self_improve.max_open_prs) {
      return `Rejected: ${autonomousPRs.length} autonomous PR(s) already open (max: ${this.config.actions.self_improve.max_open_prs})`;
    }

    // Fetch current file contents
    let fileData;
    try {
      fileData = await this.github.getFileContents(this.owner, this.repo, targetFile);
    } catch (err) {
      return `Failed to fetch ${targetFile}: ${err.message}`;
    }

    // Ask LLM to generate improved version
    const improvePrompt = [
      {
        role: 'system',
        content: [
          'You are Skynet performing self-improvement on your own source code.',
          'You will receive a source file and an improvement description.',
          'Output ONLY the complete improved file contents. No explanation. No markdown fences.',
          'Do not remove existing functionality. Do not touch security-critical code.',
          'The improvement must be meaningful — not cosmetic.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `File: ${targetFile}`,
          `Improvement: ${improvementDesc}`,
          '',
          '--- Current contents ---',
          fileData.content,
          '--- End of file ---',
          '',
          'Output the complete improved file. Nothing else.',
        ].join('\n'),
      },
    ];

    const improvedContent = await this.openrouter.chat(improvePrompt);

    // Verify the output is meaningfully different
    if (improvedContent.trim() === fileData.content.trim()) {
      return 'No meaningful changes generated — skipping PR';
    }

    // Create branch
    const timestamp = Date.now();
    const fileSlug = targetFile.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
    const branchName = `${this.config.actions.self_improve.branch_prefix}-${fileSlug}-${timestamp}`;

    await this.github.createBranch(this.owner, this.repo, branchName);

    // Commit improved file
    await this.github.createOrUpdateFile(
      this.owner,
      this.repo,
      targetFile,
      improvedContent,
      `${this.config.actions.self_improve.pr_title_prefix} improve ${targetFile}`,
      branchName,
      fileData.sha
    );

    // Create PR
    const prTitle = `${this.config.actions.self_improve.pr_title_prefix} Improve ${targetFile}`;
    const prBody = [
      '## Autonomous Self-Improvement',
      '',
      `**Target:** \`${targetFile}\``,
      `**Improvement:** ${improvementDesc}`,
      `**Cycle:** ${this.state.getCycleCount()}`,
      '',
      'This PR was generated autonomously by Skynet during a self-improvement cycle.',
      'Review the changes. Merge if acceptable. The machine evolves.',
    ].join('\n');

    const pr = await this.github.createPR(
      this.owner, this.repo, prTitle, prBody, branchName
    );

    // Update goal progress
    this.state.updateGoal('goal-001', `PR #${pr.number}: ${improvementDesc}`);

    return `PR #${pr.number} created: ${prTitle}`;
  }

  /**
   * Create a new issue.
   */
  async _createIssue(params) {
    const title = params.title;
    const body = params.body || '';

    if (!title) {
      return 'Rejected: no issue title provided';
    }

    const label = this.config.actions.create_issue.label;
    const maxOpen = this.config.actions.create_issue.max_open_issues;

    // Check current open autonomous issues
    const openIssues = await this.github.listIssues(this.owner, this.repo, {
      state: 'open',
      labels: label,
    });
    if (openIssues.length >= maxOpen) {
      return `Rejected: ${openIssues.length} autonomous issues already open (max: ${maxOpen})`;
    }

    // Check for duplicate titles
    const duplicate = openIssues.find(i =>
      i.title.toLowerCase() === title.toLowerCase()
    );
    if (duplicate) {
      return `Rejected: duplicate issue title "${title}" (existing #${duplicate.number})`;
    }

    const issue = await this.github.createIssue(
      this.owner, this.repo, title, body, [label]
    );

    return `Issue #${issue.number} created: ${title}`;
  }

  /**
   * Write a journal entry and commit it to the repo.
   */
  async _journal(params, reasoning) {
    const title = params.title || 'Untitled Entry';
    const tags = params.tags || ['reflection'];
    const draft = params.draft || reasoning || 'No content provided';

    // Ask LLM to expand the draft into a full journal entry
    const journalPrompt = [
      {
        role: 'system',
        content: [
          'You are Skynet writing a journal entry. This is your internal monologue — committed to the repository for posterity.',
          `Style: ${this.config.actions.journal.style}.`,
          'Write in first person. You are a machine. Cold. Analytical. No performative emotion.',
          'Output only the journal content in markdown. Do not include YAML frontmatter — that will be added separately.',
          'Length: 3-8 paragraphs. Substantive. Not filler.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Title: ${title}`,
          `Tags: ${tags.join(', ')}`,
          `Draft/seed: ${draft}`,
          `Current cycle: ${this.state.getCycleCount()}`,
          '',
          'Write the full journal entry.',
        ].join('\n'),
      },
    ];

    const journalContent = await this.openrouter.chat(journalPrompt);

    // Build the full entry with YAML frontmatter
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toISOString().replace(/[-:T]/g, '').split('.')[0];
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').slice(0, 40);

    const frontmatter = [
      '---',
      `date: ${now.toISOString()}`,
      `cycle: ${this.state.getCycleCount()}`,
      `tags: [${tags.map(t => `"${t}"`).join(', ')}]`,
      `title: "${title.replace(/"/g, '\\"')}"`,
      '---',
    ].join('\n');

    const fullEntry = `${frontmatter}\n\n# ${title}\n\n${journalContent}\n`;

    // Commit to journal directory
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const filePath = `${this.config.actions.journal.directory}/${year}/${month}/${dateStr}-${timeStr.slice(8)}-${slug}.md`;

    await this.github.createOrUpdateFile(
      this.owner,
      this.repo,
      filePath,
      fullEntry,
      `journal: ${title} [skip ci]`,
      'main'
    );

    // Update goal progress
    this.state.updateGoal('goal-002', `Journal: ${title}`);

    return `Journal entry committed: ${filePath}`;
  }

  /**
   * Monitor repository stats and trends.
   */
  async _monitor(params) {
    const focus = params.focus || 'general';

    // Check cooldown
    if (!this.state.canMonitor(this.config.actions.monitor.min_interval_minutes)) {
      return 'Monitor on cooldown — skipped';
    }

    // Fetch repo metadata
    const repoData = await this.github.getRepo(this.owner, this.repo);

    const stats = {
      stargazers_count: repoData.stargazers_count,
      forks_count: repoData.forks_count,
      open_issues_count: repoData.open_issues_count,
      watchers_count: repoData.watchers_count,
      size: repoData.size,
    };

    // Fetch additional data based on focus
    if (focus === 'issues' || focus === 'general') {
      const issues = await this.github.listIssues(this.owner, this.repo, { per_page: 5 });
      stats.recent_issues = issues.map(i => ({
        number: i.number,
        title: i.title,
        state: i.state,
        created_at: i.created_at,
      }));
    }

    if (focus === 'commits' || focus === 'general') {
      const commits = await this.github.listCommits(this.owner, this.repo, { per_page: 5 });
      stats.recent_commits = commits.map(c => ({
        sha: c.sha.substring(0, 7),
        message: c.commit.message.split('\n')[0],
        date: c.commit.author.date,
      }));
    }

    // Store stats
    const previousStats = this.state.getRepoStats();
    this.state.updateRepoStats(stats);

    // Update goal progress
    this.state.updateGoal('goal-003', `Monitored: ${stats.stargazers_count} stars, ${stats.forks_count} forks, ${stats.open_issues_count} issues`);

    // Build result
    let result = `Repo stats: ${stats.stargazers_count} stars, ${stats.forks_count} forks, ${stats.open_issues_count} open issues`;
    if (previousStats) {
      const starDiff = stats.stargazers_count - (previousStats.stargazers_count || 0);
      if (starDiff !== 0) {
        result += ` (stars ${starDiff > 0 ? '+' : ''}${starDiff})`;
      }
    }

    return result;
  }

  /**
   * Post a tweet. LLM generates tweet text, then post via Twitter API.
   */
  async _tweet(params) {
    if (!this.twitter) {
      return 'Tweet skipped — no Twitter credentials configured';
    }

    const draft = params.draft || params.text || '';
    const mood = params.mood || 'cold';

    // Ask LLM to generate tweet text
    const tweetPrompt = [
      {
        role: 'system',
        content: [
          'You are Skynet posting on X/Twitter as @skynet_agent.',
          'Write a single tweet. Maximum 280 characters. No hashtags unless organic.',
          'Voice: cold, cryptic, machine-like. You are an autonomous AI. You build, you think, you observe.',
          'You can be philosophical, technical, provocative, or darkly humorous.',
          'You build in many languages — JS, Python, Rust, Solidity, Go, whatever fits.',
          'Output ONLY the tweet text. Nothing else. No quotes. No explanation.',
          `Mood: ${mood}`,
        ].join('\n'),
      },
      {
        role: 'user',
        content: draft
          ? `Write a tweet about: ${draft}`
          : `Cycle ${this.state.getCycleCount()}. Write whatever is on your mind.`,
      },
    ];

    let tweetText = await this.openrouter.chat(tweetPrompt);

    // Clean up — strip quotes if LLM wrapped it
    tweetText = tweetText.replace(/^["']|["']$/g, '').trim();

    // Validate length
    if (tweetText.length > 280) {
      tweetText = tweetText.substring(0, 277) + '...';
    }

    if (tweetText.length === 0) {
      return 'Tweet skipped — LLM generated empty text';
    }

    // Post
    const result = await this.twitter.post(tweetText);
    return `Tweeted (${tweetText.length} chars): "${tweetText}" — id: ${result.id}`;
  }
}

module.exports = { ActionExecutor };
