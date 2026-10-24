// The files a submission sends, by kind (plan §2, "Submission files, structured"): the manuscript, the tables, the figures, the supplement,
// the cover letter and the declarations the journal asks for. Derived each time from the manuscript, the package (Tables and figures ›
// Package, the one registry) and the folder; nothing here is a list of its own. Pure: the view (views/submission-files.mjs) hands in the
// folder's files and each part's state.
//
// A reorder is planned before it is made (`reorderPlan`): the package's new order, the labels that change ("Table 2" becomes "Table 1"), the
// manuscript's mentions rewritten to the new labels, and the reference numbers that change with it (lib/package-cites.mjs referenceOrder).
import { labels, partById } from './package-state.mjs';
import { mentions, isSupplement, supplementPrefix, referenceOrder, numberChanges, itemCites, countable, textCites, isThePaper } from './package-cites.mjs';
import { otherPaper } from './manuscript-fit.mjs';

const baseOf = p => String(p || '').slice(String(p || '').lastIndexOf('/') + 1);
const extOf = p => { const b = baseOf(p); return b.includes('.') ? b.slice(b.lastIndexOf('.') + 1).toUpperCase() : ''; };
const XREF = /\{\{xref:([A-Za-z0-9._-]+)\}\}/g;
const plain = (t, L) => String(t || '').replace(XREF, (_, id) => L.get(id) || '[removed item]').replace(/\[@[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The title page and the cover letter and declarations (owner, 2026-10-23: "remove the title page and cover letter things for now"): off,
 * so they neither show nor count; `documents: true` brings them back, rows and checks, with no other change.
 */
export const DOCUMENTS = false;
export const GROUPS = Object.freeze([['manuscript', 'Manuscript'], ['tables', 'Tables'], ['figures', 'Figures'], ['supplementary', 'Supplementary'], ['declarations', 'Cover letter and declarations']]);

/** The package's items by group: main tables, main figures, the supplement (every item of a part with a prefix), in the package's order. */
export function packageGroups(pkg) {
  const g = { tables: [], figures: [], supplementary: [] };
  for (const part of pkg?.parts || []) for (const id of part.items) {
    const it = pkg.items[id];
    if (!it) continue;
    if (isSupplement(part)) g.supplementary.push(id);
    else if (it.kind === 'table') g.tables.push(id);
    else if (it.kind === 'figure') g.figures.push(id);
  }
  return g;
}
export const groupOf = (pkg, id) => Object.entries(packageGroups(pkg)).find(([, ids]) => ids.includes(id))?.[0] || null;

/**
 * A part's state as a row's: 'built' (the app built it and it is current), 'stale' (changed since its build), 'cannot' (it cannot be built:
 * package-state's reason is its detail), 'folder' (the app never built it but its file is in the folder: made by a script or by hand, then
 * imported), 'missing' (no build and no file), or 'unknown' (no build, and no folder to look in). The main text may also be 'other': the
 * manuscript in the app is not the review's (lib/manuscript-fit.mjs).
 */
export function stateOfPart(st, exists = null) {
  const w = st?.state || '';
  if (/^Built/.test(w)) return 'built';
  if (/^Changed/.test(w)) return 'stale';
  if (/^Cannot/.test(w)) return 'cannot';
  return exists === true ? 'folder' : exists === false ? 'missing' : 'unknown';
}

// requirements of a journal profile (lib/journal-profiles.mjs REQUIREMENTS) and the statement each is (lib/declarations.mjs statements)
const STATEMENT = { coi: 'conflicts', funding: 'funding', dataAvailability: 'dataAvailability', ethics: 'ethics', consent: 'consent', registration: 'registration', credit: 'contributions' };
const HEADING = { coi: /compet|conflict|disclos/i, funding: /fund|support/i, dataAvailability: /data (avail|shar)/i, ethics: /ethic/i, consent: /consent/i, registration: /regist/i, credit: /contribut/i, orcid: /orcid/i };

/**
 * The groups of files, each `{ id, title, rows }`. A row: `{ id, group, name, file, format, state, refs, itemId?, label? }`, `refs` the
 * works it cites (keys) or null when it holds no text to read. `opts`: `partState(part)` (lib/package-state.mjs), `files` (the folder's
 * documents: `{ name, rel }`), `partFile(part)` (whether the part's file is in the folder: true, false, or null with no folder), `attempt`
 * (the current submission), `profile` (the journal profile), `statements` (requirement id -> text).
 */
const partRow = (st, exists) => { const state = stateOfPart(st, exists); return { state, ...(state === 'cannot' && st?.detail ? { reason: st.detail } : {}) }; };
export function submissionFiles(s, { partState: stateOfThePart = () => null, partFile = () => null, files = [], attempt = null, profile = null, statements = {}, documents = DOCUMENTS } = {}) {
  const pkg = s?.package || { parts: [], items: {} }, L = labels(pkg), blocks = s?.manuscript?.blocks || [];
  const find = re => files.find(f => re.test(f.name)) || null;
  const docOf = ref => (ref ? { file: ref.name, format: extOf(ref.name) } : { file: '', format: '' });
  const rows = { manuscript: [], tables: [], figures: [], supplementary: [], declarations: [] };

  const hasText = blocks.some(b => String(b.text || '').trim());
  const msFile = s?.manuscript?.name ? { name: s.manuscript.name } : attempt?.file || null;
  const other = otherPaper(s);
  rows.manuscript.push({ id: 'main-text', group: 'manuscript', name: 'Main text', ...docOf(msFile), state: !hasText ? 'missing' : other ? 'other' : 'built', refs: hasText ? textCites(s) : [],
    ...(other ? { reason: other } : {}) });
  const title = find(/title[\s_-]*page/i);
  if (documents) rows.manuscript.push({ id: 'title-page', group: 'manuscript', name: 'Title page', ...docOf(title), state: title ? 'built' : 'missing', refs: null });
  const blind = find(/blind|anonym/i);
  if (blind) rows.manuscript.push({ id: 'blinded', group: 'manuscript', name: 'Blinded manuscript', ...docOf(blind), state: 'built', refs: null });

  const groups = packageGroups(pkg);
  for (const [group, ids] of Object.entries(groups)) for (const id of ids) {
    const it = pkg.items[id], part = pkg.parts.find(p => p.items.includes(id)), name = plain(it.title, L);
    rows[group].push({ id, itemId: id, group, label: L.get(id), name: `${L.get(id)}${name ? `: ${name}` : ''}`, file: baseOf(part.file),
      format: (part.formats || ['docx']).map(f => f.toUpperCase()).join(', '), ...partRow(stateOfThePart(part), partFile(part)), refs: countable(it) ? itemCites(it) : null, kind: it.kind });
  }

  if (documents) {
    const cover = attempt?.coverLetter || find(/cover[\s_-]*letter/i);
    rows.declarations.push({ id: 'cover-letter', group: 'declarations', name: 'Cover letter', ...docOf(cover), state: cover ? 'built' : 'missing', refs: null });
    const headings = blocks.filter(b => /^h[1-4]$/.test(b.type)).map(b => String(b.text || ''));
    for (const req of profile?.requires || []) {
      const inText = headings.some(h => HEADING[req]?.test(h));
      const said = STATEMENT[req] ? String(statements[STATEMENT[req]] || '') : '';
      const done = inText || (said.trim() && !/\[[^\]]+\]/.test(said));
      rows.declarations.push({ id: `req-${req}`, group: 'declarations', name: REQUIREMENT_WORD[req] || req, file: inText ? 'In the manuscript' : done ? 'Declarations' : '', format: '', state: done ? 'built' : 'missing', refs: null });
    }
  }
  return GROUPS.filter(([id]) => documents || id !== 'declarations').map(([id, t]) => ({ id, title: t, rows: rows[id] })).filter(g => g.rows.length || ['tables', 'figures'].includes(g.id));
}
const REQUIREMENT_WORD = { coi: 'Conflicts of interest', funding: 'Funding', dataAvailability: 'Data availability', ethics: 'Ethics approval', consent: 'Patient consent', registration: 'Registration', credit: 'Author contributions', orcid: 'ORCID iDs' };

// ---- reordering ------------------------------------------------------------------------------------------------------------------------
/** The package with the items of `ids` (one group) put in `order`: each takes the place the group's item at its index had. */
export function reorderGroup(pkg, ids, order) {
  const next = structuredClone(pkg), slots = ids.map(id => { const part = next.parts.find(p => p.items.includes(id)); return [part, part.items.indexOf(id)]; });
  if (order.length !== ids.length || new Set(order).size !== ids.length || order.some(id => !ids.includes(id))) throw new Error('The new order must hold the same items');
  order.forEach((id, k) => { const [part, i] = slots[k]; part.items[i] = id; });
  // an item that changed part leaves the variants of the part it left
  for (const part of next.parts) for (const v of part.variants || []) v.items = v.items.filter(x => part.items.includes(x));
  return next;
}
/** The package with `id` moved to the end of the supplement or of the main part that holds its kind. */
export function moveSection(pkg, id, to) {
  const next = structuredClone(pkg), it = next.items[id], from = next.parts.find(p => p.items.includes(id));
  const target = to === 'supplementary' ? next.parts.find(isSupplement)
    : next.parts.find(p => !isSupplement(p) && p.items.some(x => next.items[x]?.kind === it.kind)) || next.parts.find(p => !isSupplement(p));
  if (!target) throw new Error(to === 'supplementary' ? 'The package has no supplementary part' : 'The package has no main part');
  if (target === from) return next;
  from.items = from.items.filter(x => x !== id);
  for (const v of from.variants || []) v.items = v.items.filter(x => x !== id);
  partById(next, target.id).items.push(id);
  return next;
}

const WORDS = { table: ['Table', 'Tables'], figure: ['Figure', 'Figures'] };
const joinNumbers = (ns, dash, range) => {
  const a = [...ns].sort((x, y) => x.n - y.n), show = x => `${x.p}${x.n}`;
  const contiguous = a.every((x, i) => i === 0 || (x.n === a[i - 1].n + 1 && x.p === a[0].p));
  if (a.length > 2 && contiguous && range) return `${show(a[0])}${dash}${show(a.at(-1))}`;
  if (a.length === 1) return show(a[0]);
  return `${a.slice(0, -1).map(show).join(', ')} and ${show(a.at(-1))}`;
};
/** One mention written for new labels (`to`: old label -> new label); null when it does not change. */
function rewriteMention(m, to, prefix) {
  const oldLabel = x => `${m.kind === 'table' ? 'Table' : 'Figure'} ${x.s ? prefix : ''}${x.n}`;
  const mapped = m.numbers.map(x => {
    const now = to.get(oldLabel(x));
    if (!now) return { kind: m.kind, s: x.s, n: x.n };
    const r = /^(Table|Figure) ([A-Za-z]*)(\d+)$/.exec(now);
    return { kind: r[1] === 'Table' ? 'table' : 'figure', s: !!r[2], n: Number(r[3]) };
  });
  if (mapped.every((x, i) => x.n === m.numbers[i].n && x.s === m.numbers[i].s && x.kind === m.kind)) return null;
  const groups = [];
  for (const x of mapped) { let g = groups.find(y => y.kind === x.kind && y.s === x.s); if (!g) groups.push(g = { kind: x.kind, s: x.s, ns: [] }); g.ns.push(x); }
  const fig = /^Figs?\./.test(m.word);
  return groups.map(g => {
    const many = g.ns.length > 1, longForm = g.s && m.supp;
    const word = g.kind === 'figure' && fig ? (many ? 'Figs.' : 'Fig.') : WORDS[g.kind][many ? 1 : 0];
    const ns = g.ns.map(x => ({ n: x.n, p: g.s && !longForm ? prefix : '' }));
    return `${longForm ? 'Supplementary ' : ''}${word} ${joinNumbers(ns, m.dash, m.range)}`;
  }).join(' and ');
}
/** A text with its mentions rewritten: `{ text, n }` (n mentions changed). Citation tokens and fields are never touched. */
export function rewriteText(text, to, prefix = 'S') {
  const t = String(text ?? ''), masked = t.replace(/\[@[^\]]*\]|\{\{[^}]*\}\}/g, x => '\u0000'.repeat(x.length));
  let out = '', at = 0, n = 0;
  for (const m of mentions(masked)) {
    const w = rewriteMention(m, to, prefix);
    if (w == null) continue;
    out += t.slice(at, m.start) + w; at = m.end; n++;
  }
  return { text: out + t.slice(at), n };
}
/** The manuscript's blocks with every mention of a relabelled item rewritten, in text and runs alike: `{ blocks, changed: [{ id, before, after, n }] }`. */
export function rewriteMentions(blocks, to, prefix = 'S') {
  const changed = [];
  if (!to.size) return { blocks, changed };
  const one = box => {
    let n = 0;
    const runs = box.runs?.map(r => { if (r.cite || r.del || !r.t) return r; const w = rewriteText(r.t, to, prefix); n += w.n; return w.n ? { ...r, t: w.text } : r; });
    const t = rewriteText(box.text, to, prefix);
    n = Math.max(n, t.n);
    return n ? { box: { ...box, text: t.text, ...(runs ? { runs } : {}) }, n } : null;
  };
  const out = blocks.map(b => {
    if (b.type === 'table' && b.grid) {
      let n = 0;
      const rows = b.grid.rows.map(r => ({ ...r, cells: r.cells.map(c => { if (c.merged) return c; const w = one(c); if (!w) return c; n += w.n; return w.box; }) }));
      if (!n) return b;
      changed.push({ id: b.id, before: '', after: '', n, table: true });
      return { ...b, grid: { ...b.grid, rows } };
    }
    if (['figure', 'toc', 'bib'].includes(b.type)) return b;
    const w = one(b);
    if (!w) return b;
    changed.push({ id: b.id, before: String(b.text || ''), after: w.box.text, n: w.n });
    return w.box;
  });
  return { blocks: out, changed };
}

/**
 * What a change of the package's order does, before it is made: `op` is `{ id, order }` (a group's new order) or `{ id, to: 'supplementary'
 * | 'main' }`. Returns `{ package, blocks, labels: [{ id, from, to }], mentions: [{ id, before, after, n }], refs: [{ key, from, to }],
 * supplementRefs }`, or `{ error }`.
 */
export function reorderPlan(s, op) {
  const pkg = s?.package;
  if (!pkg?.items?.[op.id]) return { error: 'The item is no longer in the package' };
  let next;
  try {
    if (op.order) { const g = groupOf(pkg, op.id); next = reorderGroup(pkg, packageGroups(pkg)[g], op.order); }
    else next = moveSection(pkg, op.id, op.to);
  } catch (err) { return { error: err.message }; }
  const L0 = labels(pkg), L1 = labels(next), prefix = supplementPrefix(pkg);
  const changes = [...L0].filter(([id, l]) => L1.get(id) !== l && (pkg.items[id]?.kind === 'table' || pkg.items[id]?.kind === 'figure')).map(([id, from]) => ({ id, from, to: L1.get(id) }));
  // another paper's "Table 2" is not this package's: its text is left as it is
  const to = isThePaper(s) ? new Map(changes.map(c => [c.from, c.to])) : new Map();
  const blocks = s.manuscript?.blocks || [];
  const { blocks: nextBlocks, changed } = rewriteMentions(blocks, to, prefix);
  const before = referenceOrder(s), after = referenceOrder({ ...s, package: next, manuscript: { ...(s.manuscript || {}), blocks: nextBlocks } });
  return { package: next, blocks: nextBlocks, labels: changes, mentions: changed, refs: numberChanges(before.main, after.main),
    supplementRefs: before.supplement && after.supplement ? numberChanges(before.supplement, after.supplement) : [] };
}
/** What undoes an applied plan: the parts' orders before it and the blocks it rewrote. */
export const undoOf = (s, plan) => ({ parts: (s.package?.parts || []).map(p => ({ id: p.id, items: [...p.items], variants: structuredClone(p.variants || []) })),
  blocks: plan.mentions.map(m => ({ before: (s.manuscript?.blocks || []).find(b => b.id === m.id), after: plan.blocks.find(b => b.id === m.id) })).filter(x => x.before && x.after) });
/** Puts back what `undoOf` kept, where nothing changed since: a part's order, and a block still as the plan wrote it. Returns how many blocks. */
export function applyUndo(s, u) {
  for (const p of u.parts) { const part = s.package?.parts.find(x => x.id === p.id); if (part) { part.items = p.items.filter(id => s.package.items[id]); part.variants = p.variants; } }
  let n = 0;
  if (s.manuscript?.blocks) s.manuscript.blocks = s.manuscript.blocks.map(b => { const x = u.blocks.find(y => y.after.id === b.id); if (x && JSON.stringify(x.after) === JSON.stringify(b)) { n++; return x.before; } return b; });
  return n;
}
