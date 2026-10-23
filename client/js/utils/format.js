export function highlightText(text, query) {
  const escaped = escapeHTML(text);
  if (!query) return escaped;
  const words = query.split(/\s+/).filter(Boolean)
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return escaped;
  const regex = new RegExp(`(${words.join('|')})`, 'gi');
  return escaped.replace(regex, '<span class="search-highlight">$1</span>');
}

export function renderMarkdown(text) {
  if (!text) return '';
  let h = escapeHTML(text);
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
  h = h.replace(/^##\s+(.+)$/gm, '<div class="md-h">$1</div>');
  h = h.replace(/~~(.+?)~~/g, '<del>$1</del>');
  h = h.replace(/\[([^\]]+)\]\(([^\s()]+)\)/g, function(match, label, url) {
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return match;
    const safe = url.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  });
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  return h;
}

import { escapeHTML } from './dom.js';