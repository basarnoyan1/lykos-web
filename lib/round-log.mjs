// A round's log, generated instead of written by hand: every applied change file (.lykos/inbox/applied, its .done.json record:
// what, by, when, areas and the lines it applied; an undone one, moved to .lykos/inbox/undone, marked so), in the order they were
// applied, then the commits and named versions of the folder's history (lib/vcs.mjs) in the same range. The range starts after a
// tag or a commit, or on a date. Written by the folder's version rule (lib/folder-map.mjs nextVersion) as a new file, never over
// one. Used by `lykos-history <folder> round-log`, the MCP history action and History › More › Save a round log.
import { nextVersion } from './folder-map.mjs';

const DIRS = [['.lykos/inbox/applied', false], ['.lykos/inbox/undone', true]];
const dec = b => new TextDecoder().decode(b);
const when = at => String(at || '').replace('T', ' ').slice(0, 16);

/** The change records of the folder, oldest first: each .done.json with `record` (its path) and `undone`. */
export async function changeRecords(folder) {
  const out = [];
  for (const [dir, undone] of DIRS) {
    let names = [];
    try { names = (await folder.list(dir)).filter(e => !e.dir && e.name.endsWith('.done.json')).map(e => e.name); } catch { /* no such folder yet */ }
    for (const n of names) {
      try { const r = JSON.parse(dec(await folder.read(`${dir}/${n}`))); if (r && typeof r === 'object') out.push({ ...r, record: `${dir}/${n}`, undone }); } catch { /* not a record */ }
    }
  }
  return out.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')) || a.record.localeCompare(b.record));
}

/**
 * Where a range starts: a tag, a commit (the range is what came after it) or a date (from its start). Answers
 * { at, label, after } (`after`: strictly later than `at`), { at: '' } for no start; throws on a name that is none of these.
 */
export async function rangeStart(repo, since) {
  const s = String(since || '').trim();
  if (!s) return { at: '', label: '', after: false };
  const tags = await repo.tags();
  const id = tags[s] || s, c = await repo.show(id).catch(() => null);
  if (c) return { at: c.at, label: tags[s] ? `${s} (${c.id})` : c.id, after: true, id: c.id };
  if (/^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(s) && Number.isFinite(Date.parse(s))) return { at: new Date(Date.parse(s)).toISOString(), label: s, after: false };
  throw new Error(`${s} is not a tag, a commit or a date (YYYY-MM-DD)`);
}

/** Everything the log lists: the change records, the commits (oldest first) and the tags in the range. */
export async function roundLogData(folder, repo, { since = '' } = {}) {
  const start = await rangeStart(repo, since);
  const inRange = at => !start.at || (start.after ? String(at || '') > start.at : String(at || '') >= start.at);
  const changes = (await changeRecords(folder)).filter(r => inRange(r.at));
  const [log, tags, notes] = await Promise.all([repo.log({ limit: 1e6 }), repo.tags(), repo.tagNotes ? repo.tagNotes() : {}]);
  const commits = log.filter(c => inRange(c.at)).reverse();
  const ids = new Set(commits.map(c => c.id));
  const named = Object.entries(tags).filter(([, id]) => ids.has(id)).map(([name, id]) => ({ name, id, note: notes[name]?.note || '' }));
  return { start, changes, commits, tags: named, allTags: tags };
}

const listLine = v => String(v ?? '').replace(/\s*\n\s*/g, ' ');

/** The log as Markdown. `project` names the project; `now` is when it was made. */
export function roundLogText({ start, changes, commits, tags, allTags = {} }, { project = '', now = new Date().toISOString() } = {}) {
  const undone = changes.filter(c => c.undone).length;
  const tagsAt = id => Object.entries(allTags).filter(([, t]) => t === id).map(([n]) => n);
  const out = [`# Round log${project ? `: ${project}` : ''}`, '',
    `Made by Lykos on ${when(now)} from the applied change files (.lykos/inbox) and the folder's history.`,
    `Range: ${start.at ? `${start.after ? 'after' : 'from'} ${start.label}${start.after ? ` (${when(start.at)})` : ''}` : 'everything recorded'} to ${when(now)}.`,
    `${changes.length} change ${changes.length === 1 ? 'file' : 'files'} applied${undone ? `, ${undone} of them undone` : ''}; ${commits.length} ${commits.length === 1 ? 'commit' : 'commits'}; ${tags.length ? `named versions ${tags.map(t => t.name).join(', ')}` : 'no named version'}.`, '',
    '## Changes applied', ''];
  if (!changes.length) out.push('None in this range.', '');
  changes.forEach((c, i) => {
    const lines = Array.isArray(c.applied) ? c.applied : [];
    out.push(`### ${i + 1}. ${listLine(c.what) || '(no description)'}${c.undone ? ' (undone)' : ''}`, '',
      `- By: ${listLine(c.by) || 'not recorded'}`, `- When: ${when(c.at) || 'not recorded'}`,
      `- Areas: ${(c.areas || []).join(', ') || 'none named'}`, `- Change file: ${c.file || c.record}${c.undone ? '; undone, its record in .lykos/inbox/undone' : ''}`,
      `- Lines applied (${lines.length}):`, ...lines.map(l => `  - ${listLine(l)}`), '');
  });
  out.push('## Commits', '');
  if (!commits.length) out.push('None in this range.', '');
  for (const c of commits) {
    const names = tagsAt(c.id), n = (c.files || []).length;
    out.push(`- ${c.id}  ${when(c.at)}  ${listLine(c.by)}: ${listLine(c.message) || '(no message)'}${names.length ? `  [${names.join(', ')}]` : ''}  (${n} ${n === 1 ? 'file' : 'files'})`);
  }
  if (commits.length) out.push('');
  out.push('## Named versions', '');
  if (!tags.length) out.push('None in this range.');
  for (const t of tags) out.push(`- ${t.name}: ${t.id}${t.note ? `  ${listLine(t.note)}` : ''}`);
  return `${out.join('\n')}\n`;
}

const parentOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
async function ensureDirs(folder, dir) {
  let at = '';
  for (const part of dir.split('/').filter(Boolean)) {
    at = at ? `${at}/${part}` : part;
    if (!(await folder.stat(at)).exists) await folder.mkdir(at);
  }
}

/**
 * Writes `text` at `rel` by the folder's version rule: "<name> vN.<ext>", the next version after the highest in its folder, the
 * current version moved to Archive/<folder>/vN/ first; never over a file. Answers { path, archived }.
 */
export async function saveVersioned(folder, rel, text) {
  const clean = String(rel).replace(/^\.?\/+/, ''), dir = parentOf(clean), base = clean.slice(clean.lastIndexOf('/') + 1);
  if (!base || clean.split('/').includes('..')) throw new Error(`${rel} is not a file in the folder`);
  const ext = (/\.([a-z0-9]+)$/i.exec(base) || [, 'md'])[1], stem = base.replace(/\.[a-z0-9]+$/i, '').replace(/\s*v\d+$/i, '');
  const { projectLayout } = await import('./project-folder.mjs');
  const archive = (await projectLayout(folder)).archive;
  await ensureDirs(folder, dir);
  const names = (await folder.list(dir)).filter(e => !e.dir).map(e => e.name);
  const nv = nextVersion(names, stem, { archive, dir });
  for (const m of nv.moves) { await ensureDirs(folder, parentOf(m.to)); await folder.rename(m.from, m.to); }
  const path = dir ? `${dir}/${nv.name(ext)}` : nv.name(ext);
  if ((await folder.stat(path)).exists) throw new Error(`${path} exists; nothing was written`);
  await folder.writeBytes(path, new TextEncoder().encode(text));
  return { path, archived: nv.moves.map(m => m.to) };
}

/** The default name of a round log made on `now`'s day. */
export const roundLogName = (now = new Date().toISOString()) => `Round log ${String(now).slice(0, 10)}.md`;
