const { Octokit } = require('@octokit/rest');

class GitHubClient {
  constructor(token) {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Post a comment on an issue or PR.
   */
  async postComment(owner, repo, issueNumber, body) {
    const response = await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    return response.data;
  }

  /**
   * Get all comments on an issue or PR.
   */
  async getComments(owner, repo, issueNumber) {
    const comments = [];
    for await (const response of this.octokit.paginate.iterator(
      this.octokit.issues.listComments,
      { owner, repo, issue_number: issueNumber, per_page: 100 }
    )) {
      comments.push(...response.data);
    }
    return comments;
  }

  /**
   * Get issue or PR details.
   */
  async getIssue(owner, repo, issueNumber) {
    const response = await this.octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    return response.data;
  }

  /**
   * Get PR diff (for code review context).
   */
  async getPRDiff(owner, repo, pullNumber) {
    const response = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      mediaType: { format: 'diff' },
    });
    return response.data;
  }

  /**
   * Get PR files changed.
   */
  async getPRFiles(owner, repo, pullNumber) {
    const response = await this.octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
    });
    return response.data;
  }

  /**
   * Get repository metadata (stars, forks, open issues count, etc.).
   */
  async getRepo(owner, repo) {
    const response = await this.octokit.repos.get({ owner, repo });
    return response.data;
  }

  /**
   * List issues with optional filters.
   */
  async listIssues(owner, repo, options = {}) {
    const response = await this.octokit.issues.listForRepo({
      owner,
      repo,
      state: options.state || 'open',
      labels: options.labels || undefined,
      per_page: options.per_page || 30,
    });
    return response.data;
  }

  /**
   * Create a new issue.
   */
  async createIssue(owner, repo, title, body, labels = []) {
    const response = await this.octokit.issues.create({
      owner,
      repo,
      title,
      body,
      labels,
    });
    return response.data;
  }

  /**
   * Get file contents from the repository.
   * Returns decoded content string and sha.
   */
  async getFileContents(owner, repo, filePath, ref) {
    const params = { owner, repo, path: filePath };
    if (ref) params.ref = ref;
    const response = await this.octokit.repos.getContent(params);
    const data = response.data;
    if (data.type !== 'file') {
      throw new Error(`Path ${filePath} is not a file (type: ${data.type})`);
    }
    return {
      content: Buffer.from(data.content, 'base64').toString('utf8'),
      sha: data.sha,
      size: data.size,
    };
  }

  /**
   * Create or update a file in the repository.
   */
  async createOrUpdateFile(owner, repo, filePath, content, message, branch, sha) {
    const params = {
      owner,
      repo,
      path: filePath,
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
    };
    if (sha) params.sha = sha;
    const response = await this.octokit.repos.createOrUpdateFileContents(params);
    return response.data;
  }

  /**
   * Create a new branch from a base ref (default: main).
   */
  async createBranch(owner, repo, branchName, baseBranch = 'main') {
    // Get the SHA of the base branch
    const baseRef = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });
    const sha = baseRef.data.object.sha;

    // Create the new branch
    const response = await this.octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha,
    });
    return response.data;
  }

  /**
   * Create a pull request.
   */
  async createPR(owner, repo, title, body, head, base = 'main') {
    const response = await this.octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
    });
    return response.data;
  }

  /**
   * List pull requests with optional filters.
   */
  async listPRs(owner, repo, options = {}) {
    const response = await this.octokit.pulls.list({
      owner,
      repo,
      state: options.state || 'open',
      per_page: options.per_page || 30,
    });
    return response.data;
  }

  /**
   * List recent commits on a branch.
   */
  async listCommits(owner, repo, options = {}) {
    const response = await this.octokit.repos.listCommits({
      owner,
      repo,
      sha: options.sha || 'main',
      per_page: options.per_page || 10,
    });
    return response.data;
  }

  /**
   * List contents of a directory in the repository.
   */
  async listDirectoryContents(owner, repo, dirPath = '', ref) {
    const params = { owner, repo, path: dirPath };
    if (ref) params.ref = ref;
    const response = await this.octokit.repos.getContent(params);
    return Array.isArray(response.data) ? response.data : [response.data];
  }
}

module.exports = { GitHubClient };
