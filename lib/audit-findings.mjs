// An audit's findings as tasks (Batch 13 item 10; review of 2026-10-17 §6): a report written outside the app (a Markdown file in an audit
// folder, as review agents write them) keeps its numbered findings as headings — "### 3. Title — confirmed, high priority" —
// each followed by its evidence and often an "Action:" line. Each becomes one task: the title as its text, high priority when the report
// says so, its action and evidence as notes, and a first note line naming the report and the finding, so a report is never imported twice
// and a task always leads back to its source. Pure: the Tasks page reads the file and writes the tasks.
import { makeTask, normaliseTasks } from './tasks.mjs';

const str = v => (v == null ? '' : String(v)).trim();
const FINDING = /^#{2,4}\s+(\d+)[.)]\s+(.+?)\s*$/;
const NOTE_MAX = 1800;

/** The numbered findings of a report: `[{ n, title, qualifier, high, action, body }]`, in the order written. */
export function parseAuditReport(text) {
  const lines = String(text ?? '').split(/\r?\n/), out = [];
  let cur = null;
  const close = () => { if (cur) { cur.body = cur.body.join('\n').replace(/\n{3,}/g, '\n\n').trim(); out.push(cur); cur = null; } };
  for (const line of lines) {
    const m = FINDING.exec(line);
    if (m) {
      close();
      const [title, qualifier = ''] = m[2].split(/\s+[—–]\s+/, 2);
      cur = { n: Number(m[1]), title: str(title).replace(/\*\*/g, ''), qualifier: str(qualifier), high: /high priority|critical|urgent/i.test(qualifier), action: '', body: [] };
      continue;
    }
    if (/^#{1,4}\s/.test(line)) { close(); continue; }
    if (!cur) continue;
    const a = /^\s*\**action\**\s*:\s*(.+)$/i.exec(line);
    if (a && !cur.action) cur.action = str(a[1]); else cur.body.push(line);
  }
  close();
  return out;
}

/** The first line of a task's notes that names where it came from; what makes an import idempotent. */
export const sourceLine = (rel, n) => `From ${rel}, finding ${n}.`;
/** The reports tasks already came from (their notes' first line). */
export function importedSources(todos) {
  const out = new Set();
  for (const t of normaliseTasks(todos)) { const m = /^From (.+), finding \d+\./.exec(String(t.notes || '')); if (m) out.add(m[1]); }
  return out;
}

/** The tasks a report adds: one per finding not already a task from that report. `{ tasks, skipped }`. */
export function auditTasks(findings, rel, todos = [], { ids, at } = {}) {
  const have = new Set(normaliseTasks(todos).map(t => String(t.notes || '').split('\n')[0]));
  const tasks = [];
  let skipped = 0;
  for (const f of findings) {
    const head = sourceLine(rel, f.n);
    if (have.has(head)) { skipped++; continue; }
    const notes = [head, f.qualifier && `Status in the report: ${f.qualifier}.`, f.action && `Action: ${f.action}`, f.body].filter(Boolean).join('\n\n').slice(0, NOTE_MAX);
    tasks.push(makeTask({ text: f.title.slice(0, 200), priority: f.high ? 'high' : 'none', notes, link: { view: 'files', label: rel } }, { ...(ids ? { id: ids() } : {}), ...(at ? { at } : {}) }));
  }
  return { tasks, skipped };
}

/** An audit report among the folder's files: a Markdown file in a folder whose path names an audit or a review. */
export const isAuditReport = path => /\.md$/i.test(path) && /(^|\/)[^/]*(audit|review|verification)[^/]*\//i.test(path) && !/(^|\/)(old versions?|archive)(\/|$)/i.test(path);
