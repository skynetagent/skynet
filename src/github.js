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
}

module.exports = { GitHubClient };
