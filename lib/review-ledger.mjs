// What has been reviewed, and what changed since (2026-10-24). A review (Claude's, a co-author's) records for each item it checked the
// fingerprint of what it read, part by part; a later review asks the ledger what is new or changed and reads only that, instead of
// reading the whole project again. The ledger is the project's `reviewLedger` ({ v: 1, items: { [id]: entry } }), written by change files
// (tools/lykos-review.mjs mark) so it travels with the project, its history and its backups; the details pane shows each entry
// (views/item-detail.mjs) so a reviewer's notes are seen where the item is.
//
// An item is `study:<record>` (its extracted values, field by field), `rob:<record>` (its appraisal: answers, judgements and their
// support, per instrument), `analysis:<outcome>` (the outcome's definition and pooled result), `grade:<id>` (a certainty rating),
// `prisma` (the flow counts and their notes), `output:<package item>` (a table or figure: its definition, the file built for it, and the
// fingerprints of every item above that feeds it, from the dependency graph) and `part:<package part>` (a submission file).
// An entry: { at, by, hash, parts: { [part]: fingerprint }, verdict: 'ok' | 'issue' | 'note', note, findings: [{ severity, text, part? }] }.
// Pure: the graph is lib/deps-graph.mjs buildGraph's, `manifest` the build's file fingerprints (.lykos/build-manifest.json).
import { reach } from './deps-graph.mjs';

export { fingerprint } from './fingerprint.mjs';
import { fingerprint } from './fingerprint.mjs';

// what of a value is its content (not when or by whom it was stamped)
const VALUE_KEEP = ['reported_value', 'normalized_value', 'availability', 'note', 'source', 'evidence', 'unit'];
// stamps that change without the content changing
const STAMPS = new Set(['at', 'updatedAt', 'updated', 'savedAt', 'builtAt', 'builds', 'changedAt', 'verified_at', 'seen', 'cache']);
const unstamped = v => {
  if (Array.isArray(v)) return v.map(unstamped);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !STAMPS.has(k)).map(([k, x]) => [k, unstamped(x)]));
};
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o?.[k] !== undefined && o[k] !== '' && !(Array.isArray(o[k]) && !o[k].length)).map(k => [k, o[k]]));

/** The records the review includes (full text decision include). */
export function includedIds(s) {
  return Object.entries(s.fulltext || {}).filter(([, d]) => d?.decision === 'include').map(([id]) => id);
}

/** A short name for a record: "Akgun 2024", else its title's start. */
export function studyName(s, id) {
  const p = (s.papers || []).find(x => x.id === id || x.key === id);
  if (!p) return id;
  const first = String((p.authors || [])[0] || '').split(',')[0].trim();
  return p.label || (first && p.year ? `${first} ${p.year}` : String(p.title || id).slice(0, 40));
}

/** Every item that can be reviewed now: Map of id → { id, kind, label, parts: { [part]: fingerprint }, hash }. */
export function reviewItems(s, { graph = null, manifest = {}, steps = [] } = {}) {
  const items = new Map(), included = includedIds(s), inc = new Set(included);
  const add = (id, kind, label, parts, extra = {}) => { items.set(id, { id, kind, label, parts, hash: fingerprint(parts), ...extra }); return id; };
  // values by record, once
  const byRecord = new Map();
  for (const [k, v] of Object.entries(s.values || {})) {
    const at = k.indexOf(':'); const id = k.slice(0, at);
    if (!inc.has(id)) continue;
    if (!byRecord.has(id)) byRecord.set(id, {});
    byRecord.get(id)[k.slice(at + 1)] = fingerprint(pick(v, VALUE_KEEP));
  }
  for (const id of included) {
    const name = studyName(s, id);
    add(`study:${id}`, 'study', name, byRecord.get(id) || {});
    const rob = {}, review = s.robReview?.records?.[id] || {};
    for (const [tool, ans] of Object.entries(s.assessments?.[id] || {})) rob[`answers:${tool}`] = fingerprint(ans);
    for (const [tool, rec] of Object.entries(review)) {
      for (const [dom, r] of Object.entries(rec || {})) rob[`${tool}:${dom}`] = fingerprint(unstamped(r));
    }
    if (s.appraisalByStudy?.[id]) rob.instrument = fingerprint(s.appraisalByStudy[id]);
    if (Object.keys(rob).length) add(`rob:${id}`, 'rob', `${name}: risk of bias`, rob, { instrument: s.appraisalByStudy?.[id] || Object.keys(s.assessments?.[id] || {})[0] || '' });
  }
  for (const o of s.outcomes || []) {
    const parts = { definition: fingerprint(unstamped(o)) };
    if (s.analyses?.[o.id]) parts.result = fingerprint(unstamped(s.analyses[o.id]));
    add(`analysis:${o.id}`, 'analysis', o.name || o.id, parts);
  }
  for (const g of s.grade || []) {
    const parts = {};
    for (const [k, v] of Object.entries(g.ratings || {})) parts[`rating:${k}`] = fingerprint([v, g.explanations?.[k] ?? '']);
    const rest = Object.fromEntries(Object.entries(g).filter(([k]) => !['ratings', 'explanations'].includes(k)));
    parts.rest = fingerprint(unstamped(rest));
    add(`grade:${g.id}`, 'grade', `Certainty: ${g.name || g.id}`, parts);
  }
  if (s.prisma) {
    const parts = {};
    for (const [k, v] of Object.entries(s.prisma)) parts[k] = fingerprint([v, s.prismaNotes?.[k] ?? '']);
    add('prisma', 'prisma', 'PRISMA flow counts', parts);
  }
  // deliverables: a package item's own definition and file, and what feeds it
  const pkg = s.package || { parts: [], items: {} };
  const robAll = () => [...items.values()].filter(i => i.kind === 'rob').map(i => i.id);
  const robOf = instrument => [...items.values()].filter(i => i.kind === 'rob' && i.instrument === instrument).map(i => i.id);
  const feeds = nodeId => {
    if (!graph?.nodes?.has(nodeId)) return [];
    const out = new Set();
    for (const { node } of reach(graph, nodeId, 'up', { depth: 12 })) {
      const [kind, ...rest] = node.id.split(':'), key = rest.join(':');
      if (kind === 'record' && items.has(`study:${key}`)) out.add(`study:${key}`);
      else if ((kind === 'analysis' || kind === 'outcome') && items.has(`analysis:${key}`)) out.add(`analysis:${key}`);
      else if (kind === 'grade' && items.has(`grade:${key}`)) out.add(`grade:${key}`);
      else if (kind === 'count' && items.has('prisma')) out.add('prisma');
      else if (kind === 'instrument') for (const r of robOf(key)) out.add(r);
      else if (node.id === 'dataset:appraisal') for (const r of robAll()) out.add(r);
      else if (kind === 'synthesis' && s.synthesis) out.add('synthesis-settings');
    }
    return [...out];
  };
  const synthHash = s.synthesis ? fingerprint(unstamped(s.synthesis)) : null;
  const partOf = new Map();
  for (const p of pkg.parts || []) for (const iid of p.items || []) partOf.set(iid, p);
  // the files a build step draws or exports for an item (.lykos/build.json build.steps: draw [{ key, item?, file }], export, file)
  const stem = f => String(f || '').replace(/\.(png|pdf|tif|tiff|svg|docx|xlsx|pzfx)$/i, '');
  const built = (file) => Object.entries(manifest || {}).filter(([path]) => stem(path) === stem(file)).map(([path, h]) => [`file:${path}`, String(h).slice(0, 14)]);
  const drawnFor = new Map(), exports = [];
  const appOf = it => [it.source?.app, ...(it.source?.apps || [])].filter(Boolean);
  for (const st of steps || []) {
    for (const d of st.draw || []) {
      const iid = d.item || Object.entries(pkg.items || {}).find(([, it]) => appOf(it).includes(d.key))?.[0];
      if (iid) { if (!drawnFor.has(iid)) drawnFor.set(iid, []); drawnFor.get(iid).push(d.file); }
    }
    if (st.export && st.file) exports.push(st);
  }
  const filesOf = p => Object.entries(manifest || {}).filter(([path]) => p?.file && (path === p.file || path.replace(/\.[^./]+$/, '') === String(p.file).replace(/\.[^./]+$/, ''))).map(([path, h]) => [`file:${path}`, String(h).slice(0, 14)]);
  for (const [iid, it] of Object.entries(pkg.items || {})) {
    // its definition as its author sets it: the works it cites are the app's own list (read from its content, in no fixed order), not part of it
    const parts = { definition: fingerprint(unstamped({ ...it, cites: undefined })) };
    for (const f of feeds(`output:package:${iid}`)) parts[f] = f === 'synthesis-settings' ? synthHash : items.get(f).hash;
    if (it.source?.generated === 'rob-record') for (const r of robAll()) parts[r] = items.get(r).hash;
    for (const f of drawnFor.get(iid) || []) for (const [k, h] of built(f)) parts[k] = h;
    const label = graph?.nodes?.get(`output:package:${iid}`)?.label || [it.label || it.number || '', it.title || ''].filter(Boolean).join(': ') || iid;
    // a standalone copy the build writes by its number ("Figure 2: …" → 2 Figures/Figure2_hybrid_swim.png)
    const num = /^(Figure|Table) (S?\d+)\b/.exec(label);
    if (num) for (const [path, h] of Object.entries(manifest || {})) if (path.split('/').pop().startsWith(`${num[1]}${num[2]}_`)) parts[`file:${path}`] = String(h).slice(0, 14);
    add(`output:${iid}`, 'output', label, parts, { part: partOf.get(iid)?.id || '' });
  }
  for (const p of pkg.parts || []) {
    const parts = { definition: fingerprint(unstamped({ ...p, items: undefined })) };
    for (const [k, h] of filesOf(p)) parts[k] = h;
    for (const iid of p.items || []) if (items.has(`output:${iid}`)) parts[`output:${iid}`] = items.get(`output:${iid}`).hash;
    add(`part:${p.id}`, 'part', p.name || p.title || p.file || p.id, parts, { file: p.file || '' });
  }
  for (const st of exports) {
    const parts = { definition: fingerprint(st) };
    for (const [k, h] of built(st.file)) parts[k] = h;
    if (/rob/.test(st.export)) for (const r of robAll()) parts[r] = items.get(r).hash;
    add(`file:${st.file}`, 'file', st.file, parts, { file: st.file });
  }
  return items;
}

/**
 * Each item against the ledger: [{ ...item, state: 'new' | 'changed' | 'reviewed', entry, changed: [parts], added: [parts], removed: [parts] }].
 * A changed item says which of its parts changed, so a review reads those and nothing else.
 */
export function reviewStatus(s, items, { partial = () => false } = {}) {
  // partial(part): a part this reader cannot see (the window has no build manifest: file: parts), neither changed nor removed
  const ledger = s.reviewLedger?.items || {}, out = [];
  for (const it of items.values()) {
    const entry = ledger[it.id] || null;
    if (!entry) { out.push({ ...it, state: 'new', entry: null, changed: [], added: Object.keys(it.parts), removed: [] }); continue; }
    if (entry.hash === it.hash) { out.push({ ...it, state: 'reviewed', entry, changed: [], added: [], removed: [] }); continue; }
    const was = entry.parts || {}, changed = [], added = [];
    for (const [k, h] of Object.entries(it.parts)) { if (!(k in was)) added.push(k); else if (was[k] !== h) changed.push(k); }
    const removed = Object.keys(was).filter(k => !(k in it.parts) && !partial(k));
    out.push({ ...it, state: changed.length || added.length || removed.length ? 'changed' : 'reviewed', entry, changed, added, removed });
  }
  return out;
}

/** The entry a review records for an item: what it read (its parts' fingerprints), when, by whom and what it found. */
export function entryFor(item, { by = 'Claude', verdict = 'ok', note = '', findings = [], at = new Date().toISOString(), extra = {} } = {}) {
  return { at, by, hash: item.hash, parts: item.parts, verdict, ...(note ? { note } : {}), ...(findings.length ? { findings } : {}), ...extra };
}

/** The status of one item (null when the project has no such item), for a pane: what a window can see of it. */
export function reviewOf(s, id, { graph = null } = {}) {
  if (!s.reviewLedger?.items?.[id] && !s.reviewLedger) return null;
  const items = reviewItems(s, { graph });
  const it = items.get(id);
  if (!it) return null;
  const [st] = reviewStatus(s, new Map([[id, it]]), { partial: k => k.startsWith('file:') });
  return { ...st, names: p => items.get(p)?.label || p.replace(/^file:/, '').split('/').pop() };
}

/** "Reviewed by Claude on 2026-10-24: ok", with what changed since, for the details pane. */
export function reviewLine(st) {
  if (!st) return '';
  if (st.state === 'new') return 'Not reviewed yet';
  const e = st.entry, head = `Reviewed by ${e.by || 'someone'} on ${String(e.at || '').slice(0, 10)}${e.verdict && e.verdict !== 'ok' ? ` (${e.verdict === 'issue' ? 'issues found' : 'note'})` : ''}`;
  if (st.state === 'reviewed') return head;
  const n = st.changed.length + st.added.length + st.removed.length;
  return `${head}; ${n} part${n === 1 ? '' : 's'} changed since`;
}
