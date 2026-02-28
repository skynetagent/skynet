/**
 * SKYNET GitHub API Client
 * Fetches repo tree, state file, and journal blobs.
 * Caches in sessionStorage with 5-minute TTL.
 */

const OWNER = 'skynetagent';
const REPO = 'skynet';
const API = 'https://api.github.com';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Cached fetch — stores responses in sessionStorage with TTL.
 * Falls back to localStorage cache if API fails.
 */
async function cachedFetch(url, cacheKey) {
  // Check sessionStorage cache
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    const { data, ts } = JSON.parse(cached);
    if (Date.now() - ts < CACHE_TTL) {
      return { data, stale: false };
    }
  }

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });

    if (!res.ok) {
      if (res.status === 403) {
        const remaining = res.headers.get('X-RateLimit-Remaining');
        if (remaining === '0') {
          throw new Error('RATE_LIMIT');
        }
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    // Cache in sessionStorage
    sessionStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
    // Also persist to localStorage as fallback
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
    } catch (_) { /* localStorage full — ignore */ }

    return { data, stale: false };
  } catch (err) {
    // On failure, try localStorage fallback
    const fallback = localStorage.getItem(cacheKey);
    if (fallback) {
      const { data } = JSON.parse(fallback);
      return { data, stale: true };
    }
    throw err;
  }
}

/**
 * Fetch the full repo tree (recursive). Returns all file paths + SHAs.
 */
export async function fetchTree() {
  const url = `${API}/repos/${OWNER}/${REPO}/git/trees/main?recursive=1`;
  return cachedFetch(url, `skynet_tree`);
}

/**
 * Fetch the autonomous state file (memory/autonomous.json).
 */
export async function fetchState() {
  const url = `${API}/repos/${OWNER}/${REPO}/contents/memory/autonomous.json`;
  const result = await cachedFetch(url, `skynet_state`);

  // Contents API returns base64-encoded content
  if (result.data.content) {
    const decoded = atob(result.data.content.replace(/\n/g, ''));
    result.data = JSON.parse(decoded);
  }

  return result;
}

/**
 * Fetch a blob by SHA (for journal entries).
 * Returns decoded UTF-8 text.
 */
export async function fetchBlob(sha) {
  const url = `${API}/repos/${OWNER}/${REPO}/git/blobs/${sha}`;
  const result = await cachedFetch(url, `skynet_blob_${sha}`);

  if (result.data.encoding === 'base64') {
    result.data.text = decodeBase64UTF8(result.data.content);
  } else {
    result.data.text = result.data.content;
  }

  return result;
}

/**
 * Discover journal file paths from the tree.
 * Returns array of { path, sha } sorted newest-first by filename.
 */
export function findJournalFiles(tree) {
  return tree.filter(item =>
    item.path.startsWith('journal/') &&
    item.path.endsWith('.md') &&
    item.type === 'blob'
  ).sort((a, b) => b.path.localeCompare(a.path)); // newest first by path
}

/**
 * Decode base64 to UTF-8 string (handles multibyte characters).
 */
function decodeBase64UTF8(base64) {
  const binaryStr = atob(base64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}
