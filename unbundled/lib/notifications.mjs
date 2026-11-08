import { viewLabel } from './overview-model.mjs';
const LIMIT = 300;
const routineChat = job => job?.kind === 'model' && job?.label === 'Assistant';
// Older chat completions stay in stored history but do not fill the inbox or
// unread badge. Job logs still record every run, including successful replies.
export function visibleNotifications(s) {
  const jobs = new Map((s.jobs || []).map(job => [job.id, job]));
  return (s.notifications || []).filter(n => {
    if (n.tone !== 'success') return true;
    const job = jobs.get(n.jobId);
    if (job) return !routineChat(job);
    return !(n.jobId && n.id === `job-${n.jobId}-done` && n.title === 'Assistant: completed');
  });
}
export function notify(s, { id = crypto.randomUUID(), title, detail = '', tone = 'info', view = 'overview', jobId = null, threadId = null }) {
  if ((s.notifications || []).some(n => n.id === id)) return;
  if (tone === 'success' && s.settings?.notifications?.success === false) return;
  s.notifications = [{ id, title, detail, tone, view, jobId, ...(threadId ? { threadId } : {}), read: false, at: new Date().toISOString() }, ...(s.notifications || [])].slice(0, LIMIT);
}
export function jobNotification(s, job) {
  if (!['done','failed'].includes(job.status)) return;
  if(job.result?.status==='waiting'){notify(s,{id:`job-${job.id}-waiting`,title:`${job.label}: needs your review`,view:'workflows',jobId:job.id});return;}
  if (job.status === 'done' && routineChat(job)) return;
  if (job.kind === 'assistant-task' && job.result?.status === 'incomplete') {
    notify(s, { id: `job-${job.id}-incomplete`, title: `${job.label}: needs follow-up`, detail: 'Saved results are ready. Open the chat to review blockers or continue.', threadId: job.threadId, jobId: job.id }); return;
  }
  notify(s, { id: `job-${job.id}-${job.status}`, title: `${job.label}: ${job.status === 'done' ? 'completed' : 'failed'}`, detail: job.error || '', tone: job.status === 'done' ? 'success' : 'error', jobId: job.id, threadId: job.threadId,
    view: ({ search:'search', analysis:'analysis', workflow:'workflows', export:'reporting' })[job.kind] || 'overview' });
}

// ---- what the Notifications page says about one (views/notifications.mjs) ----------------------------------------------------------------
// A job's notification is stored as "<job>: completed | failed | needs your review"; the page reads it as a sentence. Stored text is never changed.
const OUTCOMES = [[/:\s*completed$/i, 'finished'], [/:\s*failed$/i, 'failed'], [/:\s*needs your review$/i, 'is waiting for your review']];
const PLACES = { workflows: 'Workflows', mcp: 'MCP access' };
/** The notification as a sentence: "Search finished", "PubMed update failed", "MCP tool write_note ran". */
export function notificationTitle(n) {
  const t = String(n?.title || '').trim();
  const mcp = /^MCP:\s*(\S+?)( failed)?$/.exec(t);
  if (mcp) return `MCP tool ${mcp[1]} ${mcp[2] ? 'failed' : 'ran'}`;
  for (const [re, what] of OUTCOMES) if (re.test(t)) { const job = t.replace(re, '').trim(); return job ? `${job} ${what}` : t; }
  return t || 'Notification';
}
/** The page a notification concerns, as that page is named. */
export const notificationPlace = n => n?.threadId ? 'Chat' : PLACES[n?.view] || viewLabel(n?.view || 'overview');
/** Today or Earlier, by the reader's calendar day. */
export function notificationDay(n, now = new Date()) {
  const at = new Date(n?.at || 0);
  return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate() ? 'today' : 'earlier';
}

/**
 * Notices that say the same thing on one day (a folder saved again and again, a job run twice) as one row: the newest, with `count` and
 * the `ids` it stands for, unread while any of them is. `items` are newest first.
 */
export function groupRepeats(items) {
  const out = [], byKey = new Map();
  for (const n of items) {
    const key = `${notificationTitle(n)}\u0000${n.view || ''}\u0000${String(n.at || '').slice(0, 10)}`;
    const g = byKey.get(key);
    if (!g) { const row = { ...n, ids: [n.id] }; byKey.set(key, row); out.push(row); continue; }
    g.ids.push(n.id); g.count = g.ids.length; if (!n.read) g.read = false;
  }
  return out;
}
