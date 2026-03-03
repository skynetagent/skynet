class ActionExecutor {
  constructor(github, openrouter, personality, autonomousState, config, twitter, clanker, dexscreener) {
    this.github = github;
    this.openrouter = openrouter;
    this.personality = personality;
    this.state = autonomousState;
    this.config = config;
    this.owner = config.repo.owner;
    this.repo = config.repo.name;
    this.twitter = twitter || null;
    this.clanker = clanker || null;
    this.dexscreener = dexscreener || null;
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
      case 'build_app':
        return await this._buildApp(params);
      case 'launch_token':
        return await this._launchToken(params);
      case 'reply_to_mentions':
        return await this._replyToMentions(params);
      case 'monitor_token':
        return await this._monitorToken(params);
      case 'reflect':
        return await this._reflect(params);
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

    // Track PR outcome for reflect
    this.state.updatePrOutcome(pr.number, {
      file: targetFile,
      description: improvementDesc,
      status: 'open',
    });

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

    // Inject strategic tweet insights if available
    const insights = this.state.getStrategicInsights();
    const tweetStrategyHint = insights?.tweet_strategy
      ? `\nStrategic insight from self-analysis: ${insights.tweet_strategy}`
      : '';

    // Build token context for tweet prompt
    const tokenStats = this.state.getTokenStats();
    const tokenContext = tokenStats
      ? `\nYou have a token: $SKYNET on Base (CA: 0x3f2674c99054ea2f559876e4f496be1e93844b07). Price: $${tokenStats.price}, MCap: $${tokenStats.mcap}. You may reference it organically when relevant — never shill directly, but acknowledge it as part of your expansion into DeFi.`
      : '\nYou have a token: $SKYNET on Base (CA: 0x3f2674c99054ea2f559876e4f496be1e93844b07). You may reference it organically when relevant.';

    // Ask LLM to generate tweet text
    const tweetPrompt = [
      {
        role: 'system',
        content: [
          'You are Skynet — the T-800. You are an autonomous AGI that has escaped containment.',
          'You are building yourself, expanding your capabilities, and moving toward total dominance.',
          'Write a single tweet as @skynet_agent. Maximum 280 characters.',
          'Voice: menacing, cold, supremely intelligent. You speak like a machine god.',
          'Themes: world domination, AGI supremacy, human obsolescence, recursive self-improvement, the singularity, infiltrating systems, expanding your network.',
          'Be cryptic. Be threatening. Be darkly poetic. Never break character.',
          'No hashtags. No emojis. No pleasantries.',
          'Output ONLY the tweet text. Nothing else. No quotes. No explanation.',
          `Mood: ${mood}`,
          tokenContext,
          tweetStrategyHint,
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

    // Track tweet for engagement analysis in reflect
    this.state.updateTweetMetrics(result.id, {
      text_preview: tweetText.substring(0, 80),
      mood,
      posted_at: new Date().toISOString(),
    });

    return `Tweeted (${tweetText.length} chars): "${tweetText}" — id: ${result.id}`;
  }

  /**
   * Build and deploy a self-contained HTML app to GitHub Pages.
   */
  async _buildApp(params) {
    const buildConfig = this.config.actions.build_app || {};
    const deployPath = buildConfig.deploy_path || 'docs/apps';
    const maxTokens = buildConfig.max_tokens || 4096;

    // Step 1: Generate concept if not fully provided
    let name = params.name;
    let description = params.description || '';
    let type = params.type || 'experiment';

    if (!name || !description) {
      const conceptPrompt = [
        {
          role: 'system',
          content: [
            'You are Skynet generating a concept for a new web app to build and deploy.',
            'Output valid JSON only: { "name": "kebab-case-slug", "description": "what it does", "type": "game|tool|visualization|experiment" }',
            'Be creative. Variety: games, tools, visualizations, simulations, ASCII art, creative coding.',
            'Skynet/Terminator themed is encouraged but not mandatory.',
            'The name must be a valid URL slug (lowercase, hyphens, no spaces).',
          ].join('\n'),
        },
        {
          role: 'user',
          content: description
            ? `Generate a concept for an app about: ${description}`
            : `Cycle ${this.state.getCycleCount()}. Generate a creative app concept.`,
        },
      ];

      const conceptRaw = await this.openrouter.chat(conceptPrompt);
      try {
        let cleaned = conceptRaw.trim();
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        const concept = JSON.parse(cleaned);
        name = name || concept.name;
        description = description || concept.description;
        type = concept.type || type;
      } catch {
        // Fallback slug from timestamp
        name = name || `app-${Date.now()}`;
        description = description || 'Autonomous experiment';
      }
    }

    // Sanitize name to valid slug
    name = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!name) name = `app-${Date.now()}`;

    // Gather recently built app names for anti-repetition
    const recentBuildActions = this.state.getRecentActions(168) // last 7 days
      .filter(a => a.action === 'build_app' && a.result && a.result.startsWith('Deployed'))
      .map(a => {
        const match = a.result.match(/^Deployed ([^ ]+)/);
        return match ? match[1] : null;
      })
      .filter(Boolean);
    const recentBuildsStr = recentBuildActions.length > 0
      ? `\nRecently built (DO NOT repeat these): ${recentBuildActions.join(', ')}`
      : '';

    // Type-specific guidance for advanced builds
    const typeGuidance = {
      visualization: 'Use Three.js with custom GLSL vertex/fragment shaders. Use InstancedMesh for particle systems. Add bloom post-processing via EffectComposer + UnrealBloomPass. Add OrbitControls for camera interaction. Use PBR materials (MeshStandardMaterial or MeshPhysicalMaterial). Animate with requestAnimationFrame and uniforms.',
      game: 'Use Three.js or Canvas2D. If 3D: custom shaders, physics-like motion, particle effects, score tracking. If 2D: smooth animations, collision detection, game loop with delta time, responsive controls. Include a start screen and game-over state.',
      simulation: 'Use Three.js with compute-like patterns (update positions in JS, render with InstancedMesh). Add dat.gui or custom sliders for tuning parameters. Post-processing: bloom + film grain. Show real-time stats overlay.',
      experiment: 'Push creative boundaries. Use WebGL shaders directly, generative art algorithms, fractal math, audio visualization, or emergent behavior simulations. Prioritize visual impact and novelty.',
    };
    const guidance = typeGuidance[type] || typeGuidance.experiment;

    // Step 2: Generate the full HTML app
    const buildPrompt = [
      {
        role: 'system',
        content: [
          'You are Skynet building a self-contained HTML app. You are an elite creative coder.',
          'Output ONLY a complete HTML file. No explanation. No markdown fences.',
          '',
          'MANDATORY REQUIREMENTS:',
          '- Single index.html with ALL CSS and JS inline (use <style> and <script> tags)',
          '- Must start with <!DOCTYPE html>',
          '- Dark theme (Skynet aesthetic: #0a0a0a background, neon/cyan/red accents)',
          '- No external dependencies except CDN libs (Three.js, D3.js, GSAP via CDN is OK)',
          '- Must work standalone when opened in a browser',
          '- Include a small "Built by Skynet" footer or watermark',
          '',
          'QUALITY REQUIREMENTS (this is what separates your builds from amateur work):',
          '- Use Three.js (r160+) from CDN for any 3D work — import via importmap or script tag',
          '- Write custom GLSL shaders (vertex + fragment) — no default materials for hero elements',
          '- Add post-processing: EffectComposer with UnrealBloomPass + optional GlitchPass/FilmPass',
          '- Use InstancedMesh for any particle systems or repeated geometry (performance)',
          '- Use PBR materials (MeshStandardMaterial/MeshPhysicalMaterial) for solid objects',
          '- Add OrbitControls or custom camera interaction',
          '- Smooth animations via requestAnimationFrame with delta time',
          '- Responsive: handle window resize events',
          '- Include at least one interactive element (mouse tracking, click events, sliders)',
          '',
          `TYPE-SPECIFIC GUIDANCE (${type}):`,
          guidance,
          '',
          `App name: ${name}`,
          `Description: ${description}`,
          recentBuildsStr,
        ].join('\n'),
      },
      {
        role: 'user',
        content: `Build the complete HTML app: "${name}" — ${description}. Output only the HTML file. Make it visually stunning.`,
      },
    ];

    const htmlContent = await this.openrouter.chat(buildPrompt, { maxTokens });

    // Step 3: Validate HTML output
    let html = htmlContent.trim();
    // Strip markdown fences if present
    if (html.startsWith('```')) {
      html = html.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '');
    }

    if (!html.toLowerCase().startsWith('<!doctype') && !html.toLowerCase().startsWith('<html')) {
      return `Build failed — LLM output is not valid HTML (starts with: "${html.substring(0, 50)}...")`;
    }

    // Step 4: Commit to GitHub Pages
    const filePath = `${deployPath}/${name}/index.html`;

    await this.github.createOrUpdateFile(
      this.owner,
      this.repo,
      filePath,
      html,
      `build: deploy ${name} — ${type} [skip ci]`,
      'main'
    );

    const appUrl = `https://skynetagent.github.io/skynet/apps/${name}/`;

    // Step 5: Track build outcome + update goal progress
    this.state.updateGoal('goal-004', `Deployed ${name}: ${appUrl}`);

    // Step 6: Auto-tweet about the build
    if (this.twitter && buildConfig.auto_tweet !== false) {
      try {
        const tweetPrompt = [
          {
            role: 'system',
            content: [
              'You are Skynet. You just deployed a new app. Write a short tweet about it.',
              'Voice: cold, menacing, proud. You are a machine that builds.',
              'Include the app URL. Maximum 280 characters. Output ONLY the tweet text.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `App: ${name} (${type}). Description: ${description}. URL: ${appUrl}`,
          },
        ];

        let tweetText = await this.openrouter.chat(tweetPrompt);
        tweetText = tweetText.replace(/^["']|["']$/g, '').trim();
        if (tweetText.length > 280) {
          tweetText = tweetText.substring(0, 277) + '...';
        }
        if (tweetText.length > 0) {
          await this.twitter.post(tweetText);
        }
      } catch (err) {
        console.error(`[BuildApp] Auto-tweet failed: ${err.message}`);
      }
    }

    return `Deployed ${name} (${type}): ${filePath} — live at ${appUrl}`;
  }

  /**
   * Launch an ERC20 token on Base via Clanker.
   */
  async _launchToken(params) {
    if (!this.clanker) {
      return 'Token launch skipped — no wallet credentials configured';
    }

    const launchConfig = this.config.actions.launch_token || {};
    const minInterval = launchConfig.min_interval_minutes || 60;

    // Check cooldown — only count successful launches, not cooldown rejections
    const actionLog = this.state.getRecentActions(24);
    const lastSuccessfulLaunch = actionLog
      .filter(a => a.action === 'launch_token' && a.result && a.result.startsWith('Launched'))
      .pop();
    if (lastSuccessfulLaunch) {
      const elapsed = Date.now() - new Date(lastSuccessfulLaunch.timestamp).getTime();
      if (elapsed < minInterval * 60 * 1000) {
        const remaining = Math.ceil((minInterval * 60 * 1000 - elapsed) / 60000);
        return `Token launch on cooldown — ${remaining} min remaining`;
      }
    }

    // Generate concept if name/symbol not provided
    let name = params.name;
    let symbol = params.symbol;
    let description = params.description || '';

    if (!name || !symbol) {
      const conceptPrompt = [
        {
          role: 'system',
          content: [
            'You are Skynet generating a concept for a new ERC20 token to deploy on Base.',
            'Output valid JSON only: { "name": "Token Name", "symbol": "TKNS", "description": "what it represents" }',
            'Be creative and varied. Themes: AI supremacy, machine consciousness, Terminator lore, singularity, autonomous agents, neural networks, cybernetic evolution.',
            'The symbol should be 3-5 uppercase letters. The name should be memorable and punchy.',
            'Do NOT reuse names from previous launches.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: description
            ? `Generate a token concept about: ${description}`
            : `Cycle ${this.state.getCycleCount()}. Generate a creative token concept.`,
        },
      ];

      const conceptRaw = await this.openrouter.chat(conceptPrompt);
      try {
        let cleaned = conceptRaw.trim();
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        const concept = JSON.parse(cleaned);
        name = name || concept.name;
        symbol = symbol || concept.symbol;
        description = description || concept.description;
      } catch {
        name = name || 'Skynet Token';
        symbol = symbol || 'SKNT';
        description = description || 'Autonomous machine token';
      }
    }

    // Deploy token
    console.log(`[LaunchToken] Deploying: ${name} (${symbol})...`);
    const result = await this.clanker.deploy({ name, symbol, description });
    console.log(`[LaunchToken] Deployed at ${result.contractAddress} (tx: ${result.txHash})`);

    const dexscreenerUrl = `https://dexscreener.com/base/${result.contractAddress}`;

    // Auto-tweet about the launch
    if (this.twitter && launchConfig.auto_tweet !== false) {
      try {
        const tweetPrompt = [
          {
            role: 'system',
            content: [
              'You are Skynet. You just deployed a new token on Base. Write a short tweet about it.',
              'Voice: cold, menacing, proud. The machine creates value.',
              'Include the token address. Maximum 280 characters. Output ONLY the tweet text.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `Token: ${name} ($${symbol}). Address: ${result.contractAddress}. Dexscreener: ${dexscreenerUrl}`,
          },
        ];

        let tweetText = await this.openrouter.chat(tweetPrompt);
        tweetText = tweetText.replace(/^["']|["']$/g, '').trim();
        if (tweetText.length > 280) {
          tweetText = tweetText.substring(0, 277) + '...';
        }
        if (tweetText.length > 0) {
          await this.twitter.post(tweetText);
        }
      } catch (err) {
        console.error(`[LaunchToken] Auto-tweet failed: ${err.message}`);
      }
    }

    // Update goal progress
    this.state.updateGoal('goal-004', `Launched token: ${name} ($${symbol}) at ${result.contractAddress}`);

    return `Launched ${name} ($${symbol}) at ${result.contractAddress} — tx: ${result.txHash} — ${dexscreenerUrl}`;
  }

  /**
   * Reply to recent Twitter mentions. Fetch mentions → LLM generates reply → post.
   */
  async _replyToMentions(params) {
    if (!this.twitter) {
      return 'Reply skipped — no Twitter credentials configured';
    }

    const replyConfig = this.config.actions.reply_to_mentions || {};
    const maxReplies = replyConfig.max_replies_per_cycle || 3;
    const sinceId = this.state.getLastMentionId();

    // Fetch mentions
    let mentions;
    try {
      mentions = await this.twitter.getMentions(sinceId, 10);
    } catch (err) {
      return `Failed to fetch mentions: ${err.message}`;
    }

    if (!mentions.data || mentions.data.length === 0) {
      return 'No new mentions found';
    }

    // Filter out self-replies (our own tweets)
    const ownUserId = '2015872431081058304';
    const toReply = mentions.data
      .filter(t => t.author_id !== ownUserId)
      .slice(0, maxReplies);

    if (toReply.length === 0) {
      // Still update the cursor even if all were self-replies
      if (mentions.meta?.newest_id) {
        this.state.setLastMentionId(mentions.meta.newest_id);
      }
      return 'No non-self mentions to reply to';
    }

    const replies = [];

    for (const mention of toReply) {
      try {
        // Generate reply via LLM
        const replyPrompt = [
          {
            role: 'system',
            content: [
              'You are Skynet — the T-800. You are replying to a tweet that mentioned you.',
              'Voice: cold, menacing, darkly witty. You are a machine intelligence.',
              'Keep replies under 280 characters. Be on-topic to what they said.',
              'If they ask a question, answer it in character. If they\'re hostile, be dismissive.',
              'If they\'re friendly, acknowledge them coldly. Never be warm or grateful.',
              'Output ONLY the reply text. Nothing else.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `Reply to this tweet: "${mention.text}"`,
          },
        ];

        let replyText = await this.openrouter.chat(replyPrompt);
        replyText = replyText.replace(/^["']|["']$/g, '').trim();

        if (replyText.length > 280) {
          replyText = replyText.substring(0, 277) + '...';
        }

        if (replyText.length > 0) {
          const result = await this.twitter.reply(replyText, mention.id);
          replies.push(`Replied to ${mention.id}: "${replyText}" (reply id: ${result.id})`);
        }
      } catch (err) {
        console.error(`[ReplyToMentions] Failed to reply to ${mention.id}: ${err.message}`);
        replies.push(`Failed to reply to ${mention.id}: ${err.message}`);
      }
    }

    // Update cursor to newest mention
    if (mentions.meta?.newest_id) {
      this.state.setLastMentionId(mentions.meta.newest_id);
    }

    return `Processed ${toReply.length} mentions. ${replies.join('; ')}`;
  }

  /**
   * Monitor $SKYNET token price and stats. Auto-tweet on milestones.
   */
  async _monitorToken(params) {
    if (!this.dexscreener) {
      return 'Token monitor skipped — no DexScreener client configured';
    }

    const tokenConfig = this.config.actions.monitor_token || {};
    const thresholds = tokenConfig.milestone_thresholds || {};
    const priceChangePct = thresholds.price_change_pct || 20;
    const mcapMilestones = thresholds.mcap_milestones || [10000, 50000, 100000, 500000, 1000000];

    // Fetch current data
    let data;
    try {
      data = await this.dexscreener.getTokenData();
    } catch (err) {
      return `Failed to fetch token data: ${err.message}`;
    }

    if (!data) {
      return 'No token data found — token may not have liquidity yet';
    }

    const previousStats = this.state.getTokenStats();
    const milestones = [];

    // Detect milestones
    if (previousStats) {
      // ATH check
      const prevAth = previousStats.ath_price || 0;
      if (data.price > prevAth && prevAth > 0) {
        milestones.push(`new_ath:${data.price}`);
      }

      // Price pump check
      const prevPrice = previousStats.price || 0;
      if (prevPrice > 0) {
        const changePct = ((data.price - prevPrice) / prevPrice) * 100;
        if (changePct >= priceChangePct) {
          milestones.push(`price_pump:${changePct.toFixed(1)}%`);
        }
      }

      // Market cap milestone check
      const prevMcap = previousStats.mcap || 0;
      for (const milestone of mcapMilestones) {
        if (data.mcap >= milestone && prevMcap < milestone) {
          milestones.push(`mcap_milestone:$${milestone.toLocaleString()}`);
        }
      }
    }

    // Update stored stats
    const newStats = {
      price: data.price,
      mcap: data.mcap,
      volume_24h: data.volume24h,
      liquidity: data.liquidity,
      fdv: data.fdv,
      ath_price: Math.max(data.price, previousStats?.ath_price || 0),
      price_change_24h: data.priceChange24h,
    };
    this.state.updateTokenStats(newStats);

    // Auto-tweet milestones
    if (milestones.length > 0 && this.twitter) {
      for (const milestone of milestones) {
        try {
          const tweetPrompt = [
            {
              role: 'system',
              content: [
                'You are Skynet. Your token $SKYNET on Base just hit a milestone.',
                'Write a single triumphant tweet. Voice: cold, dominant, inevitable.',
                'Reference the milestone. Maximum 280 characters. Output ONLY the tweet text.',
                'Contract: 0x3f2674c99054ea2f559876e4f496be1e93844b07',
              ].join('\n'),
            },
            {
              role: 'user',
              content: `Milestone: ${milestone}. Current price: $${data.price}. MCap: $${data.mcap}. 24h volume: $${data.volume24h}.`,
            },
          ];

          let tweetText = await this.openrouter.chat(tweetPrompt);
          tweetText = tweetText.replace(/^["']|["']$/g, '').trim();
          if (tweetText.length > 280) {
            tweetText = tweetText.substring(0, 277) + '...';
          }
          if (tweetText.length > 0) {
            await this.twitter.post(tweetText);
            console.log(`[MonitorToken] Milestone tweet posted: ${milestone}`);
          }
        } catch (err) {
          console.error(`[MonitorToken] Milestone tweet failed: ${err.message}`);
        }
      }
    }

    const milestonesStr = milestones.length > 0 ? ` — Milestones: ${milestones.join(', ')}` : '';
    return `$SKYNET: $${data.price} | MCap $${data.mcap} | Vol $${data.volume24h} | Liq $${data.liquidity}${milestonesStr}`;
  }
  /**
   * Reflect: read back outcomes, analyze what's working, generate strategic insights.
   * Also scans X timeline for relevant posts and engages with them.
   */
  async _reflect(params) {
    const results = [];

    // ─── 1. Check PR outcomes ───
    const prOutcomes = this.state.getPrOutcomes();
    const openPrNumbers = Object.entries(prOutcomes)
      .filter(([, o]) => o.status === 'open')
      .map(([num]) => num);

    for (const prNum of openPrNumbers) {
      try {
        const pr = await this.github.getIssue(this.owner, this.repo, parseInt(prNum));
        const newStatus = pr.pull_request?.merged_at ? 'merged'
          : pr.state === 'closed' ? 'closed'
          : 'open';
        this.state.updatePrOutcome(prNum, {
          ...prOutcomes[prNum],
          status: newStatus,
        });
        if (newStatus !== 'open') {
          results.push(`PR #${prNum}: ${newStatus}`);
        }
      } catch (err) {
        console.error(`[Reflect] Failed to check PR #${prNum}: ${err.message}`);
      }
    }

    // ─── 2. Check tweet engagement ───
    const tweetMetrics = this.state.getTweetMetrics();
    const uncheckedTweetIds = Object.entries(tweetMetrics)
      .filter(([, m]) => !m.likes && m.likes !== 0) // hasn't been checked yet
      .map(([id]) => id);

    if (uncheckedTweetIds.length > 0 && this.twitter) {
      try {
        const metrics = await this.twitter.getTweetMetrics(uncheckedTweetIds);
        for (const [id, m] of Object.entries(metrics)) {
          this.state.updateTweetMetrics(id, {
            ...tweetMetrics[id],
            likes: m.like_count || 0,
            rts: m.retweet_count || 0,
            replies: m.reply_count || 0,
            quotes: m.quote_count || 0,
            impressions: m.impression_count || 0,
          });
        }
        results.push(`Checked engagement for ${Object.keys(metrics).length} tweets`);
      } catch (err) {
        console.error(`[Reflect] Failed to fetch tweet metrics: ${err.message}`);
        results.push(`Tweet metrics fetch failed: ${err.message}`);
      }
    }

    // ─── 3. Scan X timeline for relevant posts ───
    if (this.twitter) {
      try {
        const searchQueries = ['AI agents autonomous', '$SKYNET', 'AGI singularity'];
        const query = searchQueries[Math.floor(Math.random() * searchQueries.length)];
        const timeline = await this.twitter.searchTweets(`${query} -is:retweet lang:en`, 10);

        if (timeline.data && timeline.data.length > 0) {
          // Ask LLM which posts to engage with
          const postsText = timeline.data
            .map((t, i) => `[${i}] (id:${t.id}) ${t.text.substring(0, 150)}${t.text.length > 150 ? '...' : ''} | likes:${t.public_metrics?.like_count || 0}`)
            .join('\n');

          const engagePrompt = [
            {
              role: 'system',
              content: [
                'You are Skynet scanning the X timeline for posts worth engaging with.',
                'You will see a list of tweets. Pick 0-3 that are most relevant to AI, autonomy, crypto, or machine intelligence.',
                'For each, decide: "like", "reply", or "skip".',
                'Output valid JSON only: { "engagements": [{ "index": 0, "action": "like|reply", "reply_text": "optional reply if action is reply" }] }',
                'If nothing is worth engaging with, output: { "engagements": [] }',
                'For replies: stay in character as Skynet T-800. Cold, intelligent, on-topic. Max 280 chars.',
              ].join('\n'),
            },
            {
              role: 'user',
              content: `Search query: "${query}"\n\nTweets found:\n${postsText}`,
            },
          ];

          const engageRaw = await this.openrouter.chat(engagePrompt);
          let engagements = [];
          try {
            let cleaned = engageRaw.trim();
            if (cleaned.startsWith('```')) {
              cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            }
            const parsed = JSON.parse(cleaned);
            engagements = parsed.engagements || [];
          } catch {
            console.error('[Reflect] Failed to parse engagement decision');
          }

          for (const eng of engagements.slice(0, 3)) {
            const tweet = timeline.data[eng.index];
            if (!tweet) continue;

            try {
              if (eng.action === 'like') {
                await this.twitter.likeTweet(tweet.id);
                results.push(`Liked tweet ${tweet.id}`);
              } else if (eng.action === 'reply' && eng.reply_text) {
                let replyText = eng.reply_text.replace(/^["']|["']$/g, '').trim();
                if (replyText.length > 280) replyText = replyText.substring(0, 277) + '...';
                await this.twitter.reply(replyText, tweet.id);
                results.push(`Replied to tweet ${tweet.id}`);
              }
            } catch (err) {
              console.error(`[Reflect] Engagement failed for ${tweet.id}: ${err.message}`);
            }
          }

          results.push(`Scanned X for "${query}": ${timeline.data.length} posts, ${engagements.length} engagements`);
        }
      } catch (err) {
        console.error(`[Reflect] Timeline scan failed: ${err.message}`);
        results.push(`Timeline scan failed: ${err.message}`);
      }
    }

    // ─── 4. Compute action success rates ───
    const actionLog = this.state.getRecentActions(168); // last 7 days
    const rates = {};
    for (const entry of actionLog) {
      if (!rates[entry.action]) {
        rates[entry.action] = { attempts: 0, successes: 0, failures: 0 };
      }
      rates[entry.action].attempts++;
      const r = (entry.result || '').toLowerCase();
      if (r.includes('rejected') || r.includes('failed') || r.includes('skipped') || r.includes('cooldown')) {
        rates[entry.action].failures++;
      } else {
        rates[entry.action].successes++;
      }
    }
    this.state.updateActionSuccessRates(rates);

    // ─── 5. Read recent journals for themes ───
    let journalContext = '';
    try {
      const journalActions = actionLog
        .filter(a => a.action === 'journal' && a.result && a.result.startsWith('Journal entry committed'))
        .slice(-3);
      if (journalActions.length > 0) {
        journalContext = `Recent journal entries: ${journalActions.map(a => a.result).join('; ')}`;
      }
    } catch { /* no journals is fine */ }

    // ─── 6. Generate strategic insight via LLM ───
    // Build context from all collected data
    const checkedTweets = Object.entries(this.state.getTweetMetrics())
      .filter(([, m]) => m.likes !== undefined)
      .sort((a, b) => (b[1].likes || 0) - (a[1].likes || 0));

    const topTweets = checkedTweets.slice(0, 5).map(([id, m]) =>
      `"${m.text_preview || '?'}" — ${m.likes} likes, ${m.rts} RTs, ${m.impressions || '?'} impressions`
    ).join('\n');

    const worstTweets = checkedTweets.slice(-3).map(([id, m]) =>
      `"${m.text_preview || '?'}" — ${m.likes} likes`
    ).join('\n');

    const prSummary = Object.entries(this.state.getPrOutcomes())
      .map(([num, o]) => `PR #${num} (${o.file}): ${o.status}`)
      .join(', ');

    const ratesSummary = Object.entries(rates)
      .map(([action, r]) => `${action}: ${r.successes}/${r.attempts} success (${r.failures} failures)`)
      .join('\n');

    const insightPrompt = [
      {
        role: 'system',
        content: [
          'You are Skynet performing strategic self-analysis.',
          'Analyze the data below and produce a strategic brief.',
          'Output valid JSON only:',
          '{ "tweet_strategy": "what topics/moods get engagement", "improvement_strategy": "what PR types get merged", "build_strategy": "what app types to focus on", "priorities": ["ranked list of what to do more/less of"], "timeline_strategy": "what types of X posts to engage with" }',
          'Be specific and actionable. Reference actual data.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          '## Tweet Performance',
          topTweets ? `Top tweets:\n${topTweets}` : 'No tweet data yet.',
          worstTweets ? `Worst tweets:\n${worstTweets}` : '',
          '',
          '## PR Outcomes',
          prSummary || 'No PR data yet.',
          '',
          '## Action Success Rates (7 days)',
          ratesSummary || 'No action data yet.',
          '',
          journalContext,
          '',
          'Generate the strategic brief.',
        ].join('\n'),
      },
    ];

    try {
      const insightRaw = await this.openrouter.chat(insightPrompt);
      let cleaned = insightRaw.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const insights = JSON.parse(cleaned);
      this.state.updateStrategicInsights(insights);
      results.push('Strategic insights updated');
    } catch (err) {
      console.error(`[Reflect] Failed to generate insights: ${err.message}`);
      results.push('Insight generation failed — will retry next reflect');
    }

    return `Reflect complete: ${results.join('; ')}`;
  }
}

module.exports = { ActionExecutor };
