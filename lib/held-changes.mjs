// Protocol changes an agent made, held in .lykos/inbox/held/ for the owner (tools/lykos-apply.mjs; lib/change-file.mjs ownerOnly). The
// owner decides them in Protocol › Changes (views/protocol-changes.mjs, plan W9b): each one can be edited first (saveEdit, the words it
// replaced kept in the file's `edited`), then accepted (acceptHeld: applied to the open project, a version recorded by
// lib/protocol-changes.mjs, the file filed in inbox/applied with the owner's name) or declined (inbox/declined). When the project opens or
// the window is focused, the app asks once a run whether to review what is new (heldPrompt). 2 Nov 2026: an agent withdrew the
// English-only criterion "on the owner's instruction", which the owner had never given.
//
// Pure of the store and the DOM: `folder` is the fsys.mjs shape (stat, read, list, writeBytes, replaceBytes, mkdir, rename); `ask` and
// `apply` are the page's, so the tests run it over a scratch directory.
import { KIND, changeFileWhat } from './change-file.mjs';

export const HELD = '.lykos/inbox/held';
export const DECLINED = '.lykos/inbox/declined';
const MAX_BYTES = 2_000_000;
const decode = bytes => new TextDecoder().decode(bytes);
const encode = text => new TextEncoder().encode(text);
const clip = (t, n = 160) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/** One change in the owner's words: the criterion and its new text, the protocol field and its value, the amendment's note. */
export function changeLine(c) {
  if (c?.op === 'set_criterion') return `${c.id}: ${c.text != null ? clip(c.text) : 'changed'}`;
  if (c?.op === 'set_protocol') return `${c.field[0]?.toUpperCase()}${String(c.field).slice(1)}: ${clip(c.value)}`;
  if (c?.op === 'add_amendment') return `Amendment: ${clip(c.note)}`;
  if (c?.op === 'set_eligibility_rules') return `Eligibility rules: ${(c.rules?.rules || []).map(r => r.id).join(', ')}`;
  if (c?.op === 'screen') return `Screening: ${c.paper} ${c.decision}`;
  return c?.path ? `${c.op} ${c.path.join('.')}` : String(c?.op || '');
}

/** The held change files: `[{ name, cf }]`, oldest first; a file that does not read as a change file is left out (and left where it is). */
export const listHeld = folder => listChanges(folder, HELD);

/** The change files of one inbox folder, oldest first; a declined one with the note that says who declined it and when. */
async function listChanges(folder, dir) {
  const st = await folder.stat(dir).catch(() => null);
  if (!st?.exists || !st.dir) return [];
  const all = await folder.list(dir), names = new Set(all.map(r => r.name));
  const rows = all.filter(r => !r.dir && /\.json$/i.test(r.name) && !(r.size > MAX_BYTES)).sort((a, b) => a.name.localeCompare(b.name));
  const out = [];
  for (const r of rows) {
    try {
      const cf = JSON.parse(decode(await folder.read(`${dir}/${r.name}`)));
      if (cf?.kind !== KIND || !Array.isArray(cf.changes)) continue;
      const why = names.has(`${r.name}.why.txt`) ? decode(await folder.read(`${dir}/${r.name}.why.txt`)).trim() : '';
      out.push({ name: r.name, cf, ...(why ? { why } : {}) });
    } catch { /* not a change file: the CLI's --held lists it */ }
  }
  return out;
}
/** The declined changes, oldest first, each with its note ("Declined by <person> at …"). */
export const listDeclined = folder => listChanges(folder, DECLINED);

/** When a held file was written, from its name (the CLI names it by the time it came in), else ''. */
export function heldAt(name) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z/.exec(String(name || ''));
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5] || '000'}Z` : '';
}

/** Writes a held change back after the owner edited it (lib/protocol-changes.mjs editChange); it stays held until accepted. */
export async function saveEdit(folder, name, cf) {
  const rel = `${HELD}/${name}`;
  if (!(await folder.stat(rel)).exists) throw new Error('This change is no longer held');
  await folder.replaceBytes(rel, encode(JSON.stringify(cf, null, 1)));
}

/** Moves an inbox file (held/<name>, or where it was moved to) into inbox/<where>/ under its own name; answers its new path. */
async function move(folder, from, name, where) {
  const dir = `.lykos/inbox/${where}`;
  if (!(await folder.stat(dir)).exists) await folder.mkdir(dir);
  let to = `${dir}/${name}`;
  for (let n = 2; (await folder.stat(to)).exists && n < 100; n++) to = `${dir}/${name.replace(/\.json$/i, '')}-${n}.json`;
  await folder.rename(from, to);
  return to;
}
const note = (folder, rel, text) => folder.writeBytes(rel, encode(text));

/** Declines a held change: the file moves to inbox/declined with who declined it, when and, when given, why. */
export async function declineHeld(folder, name, { person, why = '', now = () => new Date().toISOString() } = {}) {
  const to = await move(folder, `${HELD}/${name}`, name, 'declined');
  await note(folder, `${to}.why.txt`, `Declined by ${person} at ${now()} in Lykos${String(why).trim() ? `: ${String(why).trim()}` : ''}`);
  return to;
}

/**
 * Accepts a held change: out of held/ first (a failure after the change is applied can never leave it there to be accepted twice), then
 * `apply(cf)` applies it to the open project and answers { lines, version } or { error }; the record in inbox/applied names the agent as
 * the author, the owner as the one who accepted it, the version it made and the owner's edits. Resolves { lines, version } or { error }.
 */
export async function acceptHeld(folder, name, { cf, apply, person, now = () => new Date().toISOString() }) {
  const to = await move(folder, `${HELD}/${name}`, name, 'applied');
  const r = apply(cf);
  if (r.error) { const f = await move(folder, to, name, 'failed'); await note(folder, `${f}.why.txt`, `Accepted by ${person} at ${now()}, but not applied: ${r.error}`); return { error: r.error }; }
  await note(folder, `${to.slice(0, -'.json'.length)}.done.json`, JSON.stringify({ file: name, what: changeFileWhat(cf), by: String(cf.by || 'An agent'), areas: cf.areas || ['Protocol'],
    at: now(), applied: r.lines, accepted: { by: person, at: now(), in: 'Lykos' }, ...(r.version ? { version: r.version } : {}), ...(cf.edited?.length ? { edited: cf.edited } : {}) }, null, 1));
  return { lines: r.lines, version: r.version ?? null };
}

/**
 * Once a run: when a change is held that was not asked about yet, asks `ask({ count, by, whats })` whether to review the held changes now
 * (answers 'review' or null). Every held file counts as asked once it has been offered. Resolves the answer, or null when nothing was new.
 */
export async function heldPrompt(folder, { ask, seen = new Set() }) {
  const held = await listHeld(folder), fresh = held.filter(h => !seen.has(h.name));
  if (!fresh.length) return null;
  for (const h of held) seen.add(h.name);
  const by = [...new Set(fresh.map(h => String(h.cf.by || 'An agent')))].join(', ');
  return ask({ count: held.length, by, whats: fresh.map(h => changeFileWhat(h.cf)) });
}

/**
 * Asks about each held change not asked about in this run. `ask({ by, what, lines })` answers 'accept', 'decline' or null (not now);
 * `apply(cf)` applies it to the open project and answers { lines } or { error }. Resolves { accepted, declined, failed: [names] }.
 * (The command line's way; the app asks once with heldPrompt and decides in Protocol › Changes.)
 */
export async function offerHeld(folder, { ask, apply, person, seen = new Set(), now = () => new Date().toISOString() }) {
  const out = { accepted: 0, declined: 0, failed: [] };
  for (const { name, cf } of await listHeld(folder)) {
    if (seen.has(name)) continue;
    seen.add(name);
    const choice = await ask({ by: String(cf.by || 'An agent'), what: changeFileWhat(cf), lines: cf.changes.map(changeLine) });
    try {
      if (choice === 'decline') { await declineHeld(folder, name, { person, now }); out.declined++; continue; }
      if (choice !== 'accept') continue;
      const r = await acceptHeld(folder, name, { cf, apply, person, now });
      if (r.error) out.failed.push(name); else out.accepted++;
    } catch { out.failed.push(name); }
  }
  return out;
}
