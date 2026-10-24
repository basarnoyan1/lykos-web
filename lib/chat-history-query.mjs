// Used when conversation history opens; kept out of the startup graph.
import { sessionTitle, sessionTime } from './chat-sessions.mjs';
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
export function sessionDateGroup(thread, now = Date.now()) {
  const at = sessionTime(thread), date = new Date(now);
  if (!at) return 'Earlier';
  const midnight = day => new Date(date.getFullYear(), date.getMonth(), date.getDate() + day).getTime();
  return at >= midnight(0) ? 'Today' : at >= midnight(-1) ? 'Yesterday' : at >= midnight(-7) ? 'Previous 7 days' : 'Earlier';
}
export function chatHistoryPage(threads, { query = '', archived = false, offset = 0, limit = 6, now = Date.now(), teamName = () => '' } = {}) {
  const q = clean(query).toLowerCase();
  const matches = threads.slice().reverse().filter(t => {
    if (Boolean(t.archivedAt) !== archived) return false;
    if (!q) return true;
    return sessionTitle(t, teamName(t)).toLowerCase().includes(q)
      || teamName(t).toLowerCase().includes(q)
      || (t.messages || []).some(m => String(m.text || '').toLowerCase().includes(q)
        || m.agents?.some(a => String(a.text || '').toLowerCase().includes(q)));
  }).sort((a, b) => sessionTime(b) - sessionTime(a));
  const start = Math.max(0, Math.min(Math.floor(offset / limit) * limit, Math.floor(Math.max(0, matches.length - 1) / limit) * limit));
  return { total: matches.length, offset: start, rows: matches.slice(start, start + limit).map(thread => ({ thread, title: sessionTitle(thread, teamName(thread)), group: sessionDateGroup(thread, now) })) };
}
