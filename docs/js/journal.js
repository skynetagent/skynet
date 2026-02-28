/**
 * SKYNET Journal Parser & Renderer
 * Parses YAML frontmatter + renders minimal markdown to HTML.
 */

/**
 * Parse YAML frontmatter from a journal entry string.
 * Expects format:
 *   ---
 *   key: value
 *   key: [item1, item2]
 *   ---
 * Returns { meta: {}, content: string }
 */
export function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, content: text };
  }

  const meta = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;

    const key = kv[1];
    let value = kv[2].trim();

    // Handle arrays: [item1, item2]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(s =>
        s.trim().replace(/^["']|["']$/g, '')
      ).filter(Boolean);
    }
    // Handle quoted strings
    else if ((value.startsWith('"') && value.endsWith('"')) ||
             (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    meta[key] = value;
  }

  return { meta, content: match[2] };
}

/**
 * Minimal markdown-to-HTML renderer.
 * Handles: headings, paragraphs, bold, inline code, lists, line breaks.
 */
export function renderMarkdown(md) {
  const lines = md.split('\n');
  const html = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Headings
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      if (inList) { html.push('</ul>'); inList = false; }
      const level = heading[1].length;
      html.push(`<h${level}>${inlineFormat(heading[2])}</h${level}>`);
      continue;
    }

    // Unordered list items
    const listItem = line.match(/^[-*]\s+(.*)$/);
    if (listItem) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${inlineFormat(listItem[1])}</li>`);
      continue;
    }

    // Close list if we hit a non-list line
    if (inList) { html.push('</ul>'); inList = false; }

    // Empty lines
    if (line.trim() === '') continue;

    // Regular paragraph
    html.push(`<p>${inlineFormat(line)}</p>`);
  }

  if (inList) html.push('</ul>');
  return html.join('\n');
}

/**
 * Inline formatting: bold, inline code.
 */
function inlineFormat(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/**
 * Render a list of journal entries to the DOM.
 * @param {Array} entries — [{ meta, content, path }]
 * @param {HTMLElement} container
 */
export function renderJournalEntries(entries, container) {
  if (entries.length === 0) {
    container.innerHTML = '<div class="error">NO JOURNAL ENTRIES FOUND IN MEMORY BANKS</div>';
    return;
  }

  container.innerHTML = '';

  for (const entry of entries) {
    const el = document.createElement('div');
    el.className = 'journal-entry';

    const date = entry.meta.date
      ? new Date(entry.meta.date).toLocaleString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
        })
      : 'UNKNOWN DATE';

    const title = entry.meta.title || extractTitle(entry.content);
    const cycle = entry.meta.cycle ? `CYCLE ${entry.meta.cycle}` : '';
    const tags = Array.isArray(entry.meta.tags) ? entry.meta.tags : [];
    const bodyHtml = renderMarkdown(entry.content);

    el.innerHTML = `
      <div class="journal-entry-header">
        <span class="journal-entry-title">${escapeHtml(title)}</span>
        <span class="journal-entry-meta">${escapeHtml(cycle)} &mdash; ${escapeHtml(date)}</span>
      </div>
      <div class="journal-entry-body">${bodyHtml}</div>
      ${tags.length ? `<div class="journal-tags">${tags.map(t => `<span class="journal-tag">[${escapeHtml(t)}]</span>`).join('')}</div>` : ''}
    `;

    // Add expand toggle if content is long
    const body = el.querySelector('.journal-entry-body');
    // Defer measurement to after DOM insertion
    setTimeout(() => {
      if (body.scrollHeight > 200) {
        const btn = document.createElement('button');
        btn.className = 'expand-toggle';
        btn.textContent = '[EXPAND]';
        btn.addEventListener('click', () => {
          body.classList.toggle('expanded');
          btn.textContent = body.classList.contains('expanded') ? '[COLLAPSE]' : '[EXPAND]';
        });
        el.insertBefore(btn, body.nextSibling);
      }
    }, 0);

    container.appendChild(el);
  }
}

/**
 * Extract title from content (first heading or first line).
 */
function extractTitle(content) {
  const heading = content.match(/^#\s+(.*)$/m);
  if (heading) return heading[1];
  const firstLine = content.trim().split('\n')[0];
  return firstLine || 'UNTITLED ENTRY';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
