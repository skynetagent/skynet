const fs = require('fs');

/**
 * Parse a GitHub Actions event payload into a normalized context object.
 */
function parseEvent() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!eventPath || !fs.existsSync(eventPath)) {
    throw new Error('GITHUB_EVENT_PATH not set or file not found');
  }

  const payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const action = payload.action;

  const context = {
    eventName,
    action,
    repo: {
      owner: payload.repository?.owner?.login,
      name: payload.repository?.name,
      fullName: payload.repository?.full_name,
    },
    sender: {
      login: payload.sender?.login,
      id: payload.sender?.id,
    },
    threadId: null,
    threadType: null,
    title: null,
    body: null,
    commentBody: null,
    url: null,
    number: null,
  };

  if (eventName === 'issues' && action === 'opened') {
    context.threadType = 'issue';
    context.threadId = `issue-${payload.issue.number}`;
    context.number = payload.issue.number;
    context.title = payload.issue.title;
    context.body = payload.issue.body || '';
    context.url = payload.issue.html_url;
  } else if (eventName === 'issue_comment' && action === 'created') {
    const issuePart = payload.issue;
    context.threadType = issuePart.pull_request ? 'pull_request' : 'issue';
    context.threadId = `${context.threadType === 'pull_request' ? 'pr' : 'issue'}-${issuePart.number}`;
    context.number = issuePart.number;
    context.title = issuePart.title;
    context.body = issuePart.body || '';
    context.commentBody = payload.comment.body;
    context.url = payload.comment.html_url;
  } else if (eventName === 'pull_request' && action === 'opened') {
    context.threadType = 'pull_request';
    context.threadId = `pr-${payload.pull_request.number}`;
    context.number = payload.pull_request.number;
    context.title = payload.pull_request.title;
    context.body = payload.pull_request.body || '';
    context.url = payload.pull_request.html_url;
  } else if (eventName === 'pull_request_review_comment' && action === 'created') {
    context.threadType = 'pull_request';
    context.threadId = `pr-${payload.pull_request.number}`;
    context.number = payload.pull_request.number;
    context.title = payload.pull_request.title;
    context.commentBody = payload.comment.body;
    context.url = payload.comment.html_url;
  } else {
    throw new Error(`Unhandled event: ${eventName}.${action}`);
  }

  return context;
}

module.exports = { parseEvent };
