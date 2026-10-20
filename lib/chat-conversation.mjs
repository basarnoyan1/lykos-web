import { sessionTitle } from './chat-sessions.mjs';

export function findChatMessages(messages, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const hits = [];
  messages.forEach((m, i) => {
    if (String(m.text || '').toLowerCase().includes(needle)
      || m.agents?.some(a => String(a.text || '').toLowerCase().includes(needle))) hits.push(i);
  });
  return hits;
}

/** Human-readable conversation only; no settings, credentials or checkpoints. */
export function conversationMarkdown(thread, { teamName = '', renderMessage = m => String(m.text || '') } = {}) {
  const title = sessionTitle(thread, teamName);
  const messages = (thread.messages || []).map(m => {
    const heading = m.role === 'user' ? 'You' : 'Assistant';
    const body = m.agents?.every(a => a.phase === 'conversation') && m.agents.length
      ? m.agents.map(a => `### ${a.role}${a.model ? ` · ${a.model}` : ''}\n\n${a.text || ''}`).join('\n\n')
      : renderMessage(m);
    return `## ${heading}\n\n${body}`;
  });
  return `# ${title}\n\n${messages.join('\n\n---\n\n')}\n`;
}
