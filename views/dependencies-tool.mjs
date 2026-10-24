// Dependencies: how the project's work flows and where each thing ends up, a section of the Changes page (lib/deps-graph.mjs).
//
// The page opens on the project as a tree, in the order the work flows: sources (the folder's files the project reads), project data
// (extraction tables and their collections, datasets, screening counts), results (each analysis with its result) and deliverables (tables,
// figures, the package, manuscript sentences). Each node says what it is in a short fact and a state only when it matters (an analysis whose
// data changed since it ran, a figure older than its input, a package part changed since its last build). Layers, groups and nodes with
// children collapse; a long run folds after eight. Pressing a node focuses it in place: the tree marks the path down to it with a fill and
// opens, under it, where it ends up (tables, figures, analyses, sentences, never the result fields) and what it is built from. A thing the
// tree does not hold (a column, a script, a record) opens on a page of its own. The search filters the tree to the nodes it names and the
// nodes above them, and lists the other things it names. Everything is rebuilt from the project and the folder when the page opens. A project
// kept in app storage has no folder: the graph is the record's alone, and a line above the tree says which parts need a folder.
import { esc, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { uiList, uiRow, uiRowEnd, uiBar } from '../lib/ui-actions.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { toolHost } from '../lib/tool-host.mjs';
import { get, projectGeneration } from '../store.mjs';
import { vcs } from '../lib/vcs.mjs';
import { plural } from '../lib/dates.mjs';
import { buildGraph, deliverables, origins, restText, endsText, endOf, headline, findNodes, homeTree, filterTree, treeRows, pathTo, KINDS, ENDS } from '../lib/deps-graph.mjs';
import { collectFileFacts } from '../lib/deps-files.mjs';
import { glyph } from '../lib/pipeline-graph.mjs';

const CAP = 8, NAMES = 4;
const GROUP_TITLE = { table: 'Tables', figure: 'Figures', analysis: 'Analyses', grade: 'Certainty', block: 'Manuscript', submission: 'Submissions', file: 'Files' };
/** What a project kept in app storage cannot show, said once above the tree. */
export const NO_FOLDER = 'Kept in app storage: there is no project folder, so folder files, the scripts that make them and commit links are not shown.';
/** How a row's steps on the way feed it: a script made it, a sentence cites results, an analysis or a copy comes from, a table reads columns. */
const verbOf = (end, via) => (via.every(n => n.kind === 'script') ? 'Made by' : via.every(n => n.kind === 'result') ? 'Cites'
  : end === 'analysis' || via.every(n => ['file', 'count', 'dataset'].includes(n.kind)) ? 'From' : 'Reads');
const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
/** Where a node lives, dimmed after its name: a file's or a script's folder; nothing for the rest. */
const placeOf = n => (n.kind === 'file' || n.kind === 'script' ? dirOf(n.label) : '');
/** A node's name on the page: a file by its own name, an analysis by its outcome (its kind is its icon), the rest by their label. */
const nameOf = n => n.display || (n.kind === 'file' || n.kind === 'script' ? baseOf(n.label) : n.label);
/** A step's name where its table is already said: a column without its table's name, a result without its analysis's. */
const shortOf = n => n.short || nameOf(n);
/** A kind's word for `n` of it: "column", "columns", "analyses". */
const kindWord = (kind, n) => { const w = KINDS[kind].toLowerCase(); return n === 1 ? w : w.endsWith('analysis') ? `${w.slice(0, -2)}es` : `${w}s`; };
/** Up to NAMES names and how many more: "A, B, C, D and 3 more". */
const names = list => (list.length > NAMES ? `${list.slice(0, NAMES).join(', ')} and ${list.length - NAMES} more` : list.join(', '));

const groupHead = (id, title, count, actions, attrs) => uiBar({ kind: 'head', label: title, id, lead: { title, level: 'h3' }, status: { id: `${id}-count`, text: String(count), ch: 8 }, ...(actions ? { actions } : {}), ...(attrs ? { attrs } : {}) });
const KIND_ICON = { record: 'screening', count: 'gauge', template: 'extraction', collection: 'folder', column: 'extraction', dataset: 'dataset', outcome: 'scale', analysis: 'analysis', grade: 'certainty', swim: 'layers', result: 'link', output: 'outputs', block: 'manuscript', file: 'file', script: 'run', plan: 'protocol', submission: 'send' };
const kindIcon = n => `<span class="dep-ico" aria-hidden="true">${icon(KIND_ICON[n.kind] || 'dot', { size: 16 })}</span>`;
const opener = (n, shownName = nameOf(n), dim = placeOf(n)) => `<button type="button" class="hist-open dep-pick" data-act="pick" data-id="${esc(n.id)}" title="${esc(`${KINDS[n.kind]}: ${n.label}`)}">${kindIcon(n)}<bdi class="hist-name">${esc(shownName)}</bdi>${dim ? `<span class="hist-dir">${esc(dim)}</span>` : ''}</button>`;
const note = (html, attrs = '') => `<div class="hist-note"${attrs}>${html}</div>`;
const listAttrs = { 'data-dep-list': '', 'data-hub-group': 'deps' };

/** A row for one thing: its name (a button that makes it the subject) and a line saying what it is to the page. */
const row = (n, detail = [], { name } = {}) => uiRow({ attrs: { 'data-dep': n.id }, main: { html: opener(n, name), detail: detail.filter(Boolean).map(esc), wrap: true }, end: uiRowEnd({ reserve: true }) });
const foldRow = (key, text) => uiRow({ attrs: { 'data-fold': key },
  main: { html: `<button type="button" class="hist-open dep-fold" data-act="fold" data-key="${esc(key)}"><span class="dep-ico" aria-hidden="true"></span><span class="hist-name">Show ${esc(text)}</span></button>` }, end: uiRowEnd({ reserve: true }) });
/** At most CAP rows of `list`, then a row that shows the rest; `key` in `open` shows them all. */
function capped(list, key, open, draw, word) {
  const shown = open.has(key) ? list : list.slice(0, CAP), rest = list.length - shown.length;
  return [...shown.map(draw), ...(rest ? [foldRow(key, `${rest} more${word ? ` ${word(rest)}` : ''}`)] : [])];
}

/** What an end point's row says under its name: its result (an analysis), what feeds it on the way, what of it something else reads. */
function endDetail(kind, it, subject) {
  const via = it.via.filter(n => n.id !== subject.id);
  return [it.headline, via.length ? `${verbOf(kind, via)} ${names(via.map(shortOf))}` : '',
    ...it.used.map(u => `Its ${shortOf(u.result)} is used in ${names(u.in.map(nameOf))}`)];
}

/** Where `n` ends up and what it is built from, as the rows of a list: the summary line, a section per kind of end point, its own next steps, Built from. */
function focusRows(g, n, open) {
  const d = deliverables(g, n.id), o = origins(g, n.id), parts = [];
  const own = n.kind === 'analysis' ? headline(g, n.id) : n.kind === 'submission' ? [n.status, n.at].filter(Boolean).join(', ') : '';
  // a submission is where the work ends: it says its decision, never that nothing uses it
  const used = d.total ? `Used in ${endsText(d.counts, ', ')}` : n.kind === 'submission' ? '' : 'Used in nothing the project records';
  parts.push(note([KINDS[n.kind], placeOf(n), own, used].filter(Boolean).map(esc).join('; '), ' data-dep-sum'));
  for (const grp of d.groups) {
    const word = k => ENDS[grp.kind][k === 1 ? 0 : 1];
    parts.push(groupHead(`dep-end-${grp.kind}`, GROUP_TITLE[grp.kind], grp.items.length),
      ...capped(grp.items, `end|${grp.kind}`, open, it => row(it.node, endDetail(grp.kind, it, n)), word));
  }
  // the subject's own next steps (a file's columns, a record's counts, a script): which of them feed something, and what
  if (d.through.length) {
    const kinds = new Set(d.through.map(t => t.node.kind)), only = kinds.size === 1 ? [...kinds][0] : '';
    const feeding = d.through.filter(t => t.ends.length), idle = d.through.filter(t => !t.ends.length);
    parts.push(groupHead('dep-through', only ? `${KINDS[only][0]}${kindWord(only, 2).slice(1)}` : 'Next steps', feeding.length === d.through.length ? feeding.length : `${feeding.length} of ${d.through.length}`),
      ...capped(feeding, 'through', open, t => {
        const counts = {};
        for (const e of t.ends) { const k = endOf(g, e); counts[k] = (counts[k] || 0) + 1; }
        return row(t.node, [t.ends.length <= NAMES ? `Feeds ${t.ends.map(nameOf).join(', ')}` : `Feeds ${endsText(counts)}`], { name: shortOf(t.node) });
      }));
    if (idle.length) parts.push(note(esc(`${idle.length === 1 ? '1 feeds' : `${idle.length} feed`} nothing the project records: ${names(idle.map(t => shortOf(t.node)))}`), ' data-dep-idle'));
  }
  parts.push(groupHead('dep-up', 'Built from', o.total));
  if (!o.items.length) parts.push(note('Nothing recorded stands behind this'));
  else {
    const mixed = new Set(o.items.map(x => x.kind)).size > 1;
    parts.push(...capped(o.items, 'up', open, x => row(x, [mixed ? KINDS[x.kind] : '']), mixed ? null : k => kindWord(o.items[0].kind, k)));
    if (Object.keys(o.rest).length) parts.push(note(esc(`Further back: ${restText(o.rest)}`), ' data-dep-rest'));
  }
  return parts;
}

// ---- the tree ------------------------------------------------------------------------------------------------------------
// A row is drawn as a dependency tree draws it: an indent per level, the chevron of a node with children, and the connectors (the lines
// down from a parent and the elbow into each child) as one small SVG laid over the indent, so opening a node moves nothing.
const STEP = 16, MID = 14, ROW = 28;   // the indent of a level (--s4), the middle and the height of a row (--ctl-h-dense)
/** The x of the line under the chevron of a node at rendered depth k: its indent and half the 12 px chevron. */
const lineX = k => k * STEP + 6 + 0.5;
/** The connectors of a row at rendered depth `d`: the lines of the levels above that go on, its own elbow or tee, and a stub to its open children. */
function wires(r, d, hasKids) {
  const lines = [];
  for (let k = 0; k < d - 1; k++) if (r.cont[k + 2]) lines.push(`M${lineX(k)} 0V${ROW}`);
  if (d > 0) lines.push(`M${lineX(d - 1)} 0V${r.last ? MID + 0.5 : ROW}`, `M${lineX(d - 1)} ${MID + 0.5}H${d * STEP + (hasKids ? 0 : 14)}`);
  if (r.expanded) lines.push(`M${lineX(d)} ${MID + 7}V${ROW}`);
  return lines.length ? `<svg class="dep-wires" width="${(d + 1) * STEP + 12}" height="${ROW}" aria-hidden="true" focusable="false"><path d="${lines.join('')}"/></svg>` : '';
}
/** The chevron of a node with children: pressed with the pointer it opens and closes; from the keyboard Right and Left do, as in a tree. */
const twist = r => (r.item.children.length
  ? `<span class="dep-twist" data-act="twist" data-key="${esc(r.key)}" aria-hidden="true">${icon(r.expanded ? 'chevron-down' : 'chevron-right', { size: 12 })}</span>`
  : '<span class="dep-twist" aria-hidden="true"></span>');
/** The indent of a level; none at the top, so a group starts on its head's edge (the spacer and the row's gap of 4 make one step). */
const indent = d => (d ? `<span class="dep-indent" data-d="${Math.min(d, 6)}" aria-hidden="true"></span>` : '');
/** A node's status as the workflows show one (lib/pipeline-graph.mjs): the mark, and its words unless it is current. */
const markHtml = (mark, state) => (mark ? `<span class="pipe-dot dep-mark" data-mark="${esc(mark)}" role="img" aria-label="${esc(state)}">${glyph(mark)}</span>${mark === 'passed' ? '' : `<span class="dep-state">${esc(state)}</span>`}` : '');
const stateCell = it => ({ col: 'state', kind: 'text', ch: 24, html: it ? markHtml(it.mark, it.state) : '' });
/** Graph nodes under a tree node, however deep: a layer's or a group's count. */
const leaves = it => it.children.reduce((a, c) => a + (c.node ? 1 : 0) + leaves(c), 0);

/** One row of the tree: a group or a folder toggles, a node of the graph focuses; a fold row shows the rest. `on` marks the focused path; `states` gives the row its state column (a list with no state has none). */
function treeRow(r, on, states) {
  const cells = states ? [stateCell(r.more ? null : r.item)] : [];
  const d = Math.max(0, r.depth - 1), mark = on.get(r.key);
  if (r.more) return uiRow({ table: true, attrs: { 'data-tree-more': r.parent },
    main: { html: `${indent(d)}<span class="dep-twist" aria-hidden="true"></span><button type="button" class="hist-open dep-fold" data-act="more" data-key="${esc(r.parent)}"><span class="hist-name">and ${esc(r.more)} more</span></button>${wires(r, d, false)}` }, cells, end: uiRowEnd({ reserve: true }) });
  const it = r.item, n = it.node, attrs = { 'data-tree': r.key, ...(n ? { 'data-node': n.id } : {}), ...(mark ? { 'data-on': mark } : {}) };
  const main = n
    ? `${indent(d)}${twist(r)}${opener(n, nameOf(n), it.fact)}`
    : `${indent(d)}${twist(r)}<button type="button" class="hist-open dep-group" data-act="twist" data-key="${esc(r.key)}" aria-expanded="${r.expanded}"><bdi class="hist-name">${esc(it.label)}</bdi><span class="hist-dir">${esc(it.fact || String(it.children.length))}</span></button>`;
  return uiRow({ table: true, attrs, main: { html: main + wires(r, d, it.children.length > 0) }, cells, end: uiRowEnd({ reserve: true }) });
}

/** What a layer's groups hold, in the reader's nouns, a line each: "1 table", "2 datasets", "8 counts". */
const NOUN = { 'sources/read': ['imported'], 'sources/scripts': ['read by a script', 'read by scripts'], 'data/tables': ['table'], 'data/collections': ['collection'],
  'data/datasets': ['dataset'], 'data/screening': ['count'], 'results/analyses': ['analysis', 'analyses'], 'deliverables/tables': ['table'],
  'deliverables/figures': ['figure'], 'deliverables/package': ['in the package'], 'deliverables/manuscript': ['sentence'], 'results/plan': ['planned', 'planned'],
  'deliverables/submissions': ['submission'], 'results/syntheses': ['synthesis', 'syntheses'] };
/** A group of groups (the syntheses, a group per combination) counts its groups; any other counts what it holds. */
const holds = layer => layer.children.map(c => {
  const n = c.children.some(x => !x.node) ? c.children.filter(x => !x.node).length : leaves(c);
  const [one, many = /^(in|read|imported)\b/.test(one) || /s$/.test(one) ? one : `${one}s`] = NOUN[`${layer.key}/${c.key.split('/').pop()}`] || [c.label.toLowerCase()];
  return `<span>${esc(`${n.toLocaleString('en')} ${n === 1 ? one : many}`)}</span>`;
}).join('');
/** A state in the band's few words: "Older than its input" reads "older than input". */
const brief = state => state.replace(/ since it ran$/, '').replace(/ since v\d+$/, ' since built').replace(/ its /, ' ').toLowerCase();
const ORDER = ['failed', 'warning', 'passed'];
/** The checked states under a layer, worst first: `[{ mark, words, n }]`. */
const statesUnder = layer => {
  const by = new Map();
  (function walk(it) { for (const c of it.children) { if (c.mark) { const k = `${c.mark}|${brief(c.state)}`; by.set(k, (by.get(k) || 0) + 1); } walk(c); } })(layer);
  return [...by].map(([k, n]) => { const [mark, words] = k.split('|'); return { mark, words, n }; }).sort((a, b) => ORDER.indexOf(a.mark) - ORDER.indexOf(b.mark) || b.n - a.n);
};
const LAYER_ICON = { sources: 'file', data: 'dataset', results: 'analysis', deliverables: 'outputs' };
/**
 * The layers as one schematic line in the order the work flows, drawn as the workflows draw a run: a node per layer with its icon, ringed in the
 * colour of its worst checked state (neutral where the project checks nothing), on a line into the next; under it the layer's name and size,
 * what it holds and its states, a line each. Nothing is boxed, so a layer with less to say leaves no empty frame.
 */
function band(tree) {
  const stage = layer => {
    const list = statesUnder(layer), worst = list[0]?.mark || '';
    const words = list.map(x => `<span data-mark="${esc(x.mark)}">${esc(`${x.n.toLocaleString('en')} ${x.words}`)}</span>`).join('');
    return `<li class="dep-band-stage" data-layer="${esc(layer.key)}"><span class="dep-band-dot" data-mark="${esc(worst)}" aria-hidden="true">${icon(LAYER_ICON[layer.key] || 'dot', { size: 16 })}</span>`
      + `<span class="dep-band-title"><span class="dep-band-name">${esc(layer.label)}</span> <span class="dep-band-count">${esc(leaves(layer).toLocaleString('en'))}</span></span>`
      + `<span class="dep-band-lines">${holds(layer)}</span>${words ? `<span class="dep-band-lines dep-band-marks">${words}</span>` : ''}</li>`;
  };
  return `<ol class="dep-band" aria-label="How the work flows">${tree.map(stage).join('')}</ol>`;
}

const states = new WeakMap();   // folder -> the page's state (the graph, the tree, the focus), kept between draws
let record = null;              // the same for a project kept in app storage, while that project is open: { gen, st }
const finders = new WeakMap();   // a mounted page's host -> its Find (views/changes.mjs find(): ⌘F)
/** ⌘F on the Changes page: the mounted Dependencies page in `el` opens its search row; false when it is not there. */
export function findIn(el) { const host = el?.querySelector('.tool-host'); const open = host && finders.get(host); if (open) open(); return !!open; }
/**
 * Dependencies drawn into `el` (the Changes view, views/changes.mjs); `node` starts it on one thing (`file:Evidence.xlsx`). The page's one command,
 * reading the project again, is the title bar's (`onHead({ actions, overflow })`); the tools row holds only the search. Returns the way to stop it.
 */
export function mountDependencies(el, { say = () => {}, folder = activeFolder(), node = '', onHead = () => {} } = {}) {
  const fresh = () => ({ folder, graph: null, tree: null, facts: null, subject: '', query: '', open: new Set(), closed: new Set(), more: new Set(), busy: 'Reading the project…', note: '' });
  if (folder && !states.has(folder)) states.set(folder, fresh());
  if (!folder && record?.gen !== projectGeneration()) record = { gen: projectGeneration(), st: fresh() };
  const st = folder ? states.get(folder) : record.st;
  if (node) { st.subject = node; st.open = new Set(); st.alone = true; }   // asked from elsewhere (the Files inspector): its own page first, the tree one press away
  const h = toolHost(el, { say });
  mount(h.ops, h, st, onHead);
  return h.stop;
}

function mount(ops, { body: b, placeTools }, st, onHead) {
  const { isLive } = ops;
  b.classList.add('fv-tool-body');
  b.dataset.stacked = '';
  b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Dependencies'); b.tabIndex = 0;
  b.setAttribute('aria-busy', 'true');
  b.innerHTML = `<div class="note">${esc(st.busy)}</div>`;
  const fieldId = `${ops.uid}-find`;

  // Find: the search row is closed until the title bar's Find (or ⌘F) opens it, and stays open while it narrows the tree, as Files does; the
  // button is pressed while the row is open. Escape in the empty field closes it. Without a folder there is no More (the graph, read from
  // the record alone, is read again each time the section opens); History then shows Find disabled in the same place (views/changes.mjs),
  // so the switch beside it does not move between the sections.
  let said = null;
  const always = !st.folder;
  const head = () => onHead({
    find: { pressed: !!(st.findOpen || st.query), run: () => (st.findOpen || st.query ? closeFind() : openFind()) }, actions: [],
    overflow: always ? [] : [{ id: 'dep-reread', label: 'Read the project again', disabled: !!st.busy, run: () => { if (!st.busy) load(); } }] });
  function bar() {
    const open = !!(st.findOpen || st.query);
    if (open) placeTools(ops, { label: 'Dependencies', filters: [{ type: 'search', id: fieldId, label: 'Find a file, table, column, count or analysis', placeholder: 'Find a file, table or analysis', value: st.query }] });
    else ops.host.querySelector(':scope > .fv-top')?.remove();
    // rebuilt when the page opens or the row opens or closes, not as the project changes: reading it again stays a command, in the title bar's More
    if (isLive() && said !== `${!!st.busy}${open}`) { said = `${!!st.busy}${open}`; head(); }
    // the title bar's Find says so in place (an attribute, as Files does), so nothing is drawn again under the keyboard
    document.querySelectorAll('[id="page-find"]').forEach(x => x.setAttribute('aria-pressed', String(open)));
    const field = ops.host.querySelector(`#${CSS.escape(fieldId)}`);
    field?.addEventListener('input', () => { st.query = field.value; draw(); });
    field?.addEventListener('keydown', e => { if (e.key === 'Escape' && !field.value) { e.preventDefault(); e.stopPropagation(); closeFind(); } });
  }
  function openFind() { st.findOpen = true; bar(); ops.host.querySelector(`#${CSS.escape(fieldId)}`)?.focus(); }
  function closeFind() { const had = !!st.query; st.findOpen = false; st.query = ''; bar(); if (had) draw(); b.focus(); }
  finders.set(ops.host, openFind);

  async function load() {
    st.busy = 'Reading the project…'; st.note = '';
    if (isLive()) { bar(); draw(); }
    try {
      // a project kept in app storage: the record alone, no folder to read
      st.facts = st.folder ? await collectFileFacts(st.folder, { repo: vcs(st.folder, { by: 'You' }) }) : null;
      st.graph = buildGraph(get(), st.facts || {});
      st.tree = homeTree(st.graph);
      // the syntheses open on their combinations, a line each, not on every value of every one
      if (!st.synthShut) for (const s of st.tree.find(l => l.key === 'results')?.children.find(c => c.key.endsWith('/syntheses'))?.children || []) if (!s.node) { st.closed.add(s.key); st.synthShut = true; }
    } catch (err) { st.note = String(err.message || err); }
    st.busy = '';
    if (!isLive()) return;
    b.removeAttribute('aria-busy'); bar(); draw();
  }

  /** Makes `id` the focus; in the tree, opens the nodes above it and shows it however far down its run it is. */
  function focus(id) {
    st.subject = st.subject === id && pathTo(st.tree, id).length ? '' : id;
    st.open = new Set();
    for (const k of pathTo(st.tree, st.subject)) { st.closed.delete(k); st.more.add(k); }
  }

  /** The tree, split after the focused node so where it ends up opens under it; the layers each a list under their head. */
  function homePage() {
    const g = st.graph, q = st.query.trim();
    const tree = q ? filterTree(st.tree, q) : st.tree, path = st.subject ? pathTo(tree, st.subject) : [];
    const on = new Map(path.map((k, i) => [k, i === path.length - 1 ? 'self' : 'path']));
    const out = [tree.length ? band(tree) : ''];
    for (const layer of tree) {
      out.push(`<div class="dep-layer" data-layer="${esc(layer.key)}">`);
      const layerOpen = q || !st.closed.has(layer.key);
      const id = `dep-layer-${layer.key}`;
      out.push(groupHead(id, layer.label, leaves(layer), [{ id: `${id}-twist`, label: `${layerOpen ? 'Collapse' : 'Expand'} ${layer.label}`, icon: layerOpen ? 'chevron-down' : 'chevron-right', role: 'quiet', iconOnly: true }], { 'data-dep-layer-head': '' }));
      if (!layerOpen) { out.push('</div>'); continue; }
      const rows = treeRows([layer], { closed: q ? new Set() : st.closed, open: q ? new Set(tree.flatMap(function all(x) { return [x.key, ...x.children.flatMap(all)]; })) : st.more, cap: CAP }).slice(1);
      const at = rows.findIndex(r => on.get(r.key) === 'self');
      const list = (part, suffix) => { const states = part.some(r => r.item?.state);
        return uiList({ id: `${id}-list${suffix}`, label: layer.label, reveal: true, cols: states ? ['state'] : [], attrs: { ...listAttrs, 'data-dep-tree': layer.key }, rows: part.map(r => treeRow(r, on, states)) }); };
      if (at < 0) { out.push(list(rows, ''), '</div>'); continue; }
      const n = g.nodes.get(st.subject);
      out.push(list(rows.slice(0, at + 1), ''),
        `<section class="dep-focus" data-dep-focus aria-label="${esc(`Where ${n.label} ends up`)}">${uiList({ id: 'dep-list', reveal: true, label: `Where ${n.label} ends up and what it is built from`, attrs: listAttrs, rows: focusRows(g, n, st.open) })}</section>`);
      if (rows.length > at + 1) out.push(list(rows.slice(at + 1), '-rest'));
      out.push('</div>');
    }
    if (q) {
      const other = findNodes(g, q, { limit: 40 }).filter(n => !pathTo(tree, n.id).length);
      if (!tree.length && !other.length) out.push(note(`Nothing in the project is named like "${esc(q)}"`));
      if (other.length) out.push(uiList({ id: 'dep-matches', reveal: true, label: 'Other matches', attrs: listAttrs, rows: [groupHead('dep-start', 'Other matches', other.length),
        ...other.map(n => row(n, [KINDS[n.kind], g.out.get(n.id).length ? (x => (x.total ? `Feeds ${endsText(x.counts)}` : 'Feeds nothing the project records'))(deliverables(g, n.id, { steps: false })) : 'Nothing depends on it']))] }));
    }
    return out.join('');
  }

  /** A thing the tree does not hold (a column, a script, a record): its own page, with the way back to the tree. */
  function subjectPage() {
    const g = st.graph, n = g.nodes.get(st.subject);
    const head = uiBar({ kind: 'head', label: n.label, id: 'dep-subject', lead: { title: nameOf(n), level: 'h2' }, actions: [{ id: 'dep-clear', label: 'Show the whole tree', icon: 'close', role: 'quiet', iconOnly: true }] });
    return uiList({ id: 'dep-list', reveal: true, label: `Where ${n.label} ends up and what it is built from`, attrs: listAttrs, rows: [head, ...focusRows(g, n, st.open)] });
  }

  function draw() {
    if (!isLive()) return;
    if (!st.graph) { if (st.busy) b.querySelector('.note')?.replaceChildren(document.createTextNode(st.busy)); else if (st.note) b.innerHTML = `<div class="note" role="status">${esc(st.note)}</div>`; return; }
    const parts = [];
    if (st.note) parts.push(`<div class="note" role="status">${esc(st.note)}</div>`);
    if (!st.folder) parts.push(note(esc(NO_FOLDER), ' role="status" data-dep-nofolder'));
    const g = st.graph, linked = [...g.nodes.values()].some(n => g.out.get(n.id).length);
    if (!linked) parts.push(emptyState({ icon: 'branch', title: 'Nothing is linked yet', help: true, detail: 'Screening decisions, tables, results and files are linked to what they feed.' }));
    else parts.push(st.subject && g.nodes.has(st.subject) && (st.alone || !pathTo(st.tree, st.subject).length) && !st.query.trim() ? subjectPage() : homePage());
    if (st.facts?.skipped?.length) parts.push(`<div class="hist-note" role="status">${esc(plural(st.facts.skipped.length, 'file'))} could not be read: ${esc(st.facts.skipped.slice(0, 2).join('; '))}${st.facts.skipped.length > 2 ? '…' : ''}</div>`);
    b.innerHTML = `<div class="hist-page">${parts.join('')}</div>`;
    // back from a node's own page to the tree: the node is scrolled to within this page's body, never the page around it
    if (st.reveal) { st.reveal = false; const self = b.querySelector('[data-on=self]'); if (self) b.scrollTop += self.getBoundingClientRect().top - b.getBoundingClientRect().top - 8; }
  }

  const toggle = key => { if (st.closed.has(key)) st.closed.delete(key); else st.closed.add(key); draw(); };
  b.addEventListener('click', e => {
    const t = e.target.closest('[data-act], #dep-clear, [id^="dep-layer-"][id$="-twist"]');
    if (!t) return;
    if (t.id === 'dep-clear') {   // to the tree: a node asked for from elsewhere stays focused there, any other is let go
      const id = st.subject, back = st.alone && pathTo(st.tree, id).length > 0;
      st.alone = false; st.subject = '';
      if (back) { focus(id); st.reveal = true; }
      draw(); return;
    }
    if (t.id?.startsWith('dep-layer-')) { toggle(t.id.slice('dep-layer-'.length, -'-twist'.length)); return; }
    const act = t.dataset.act;
    if (act === 'pick') {
      st.alone = false;
      const inTree = pathTo(st.tree, t.dataset.id).length > 0;
      focus(t.dataset.id);
      if (!inTree) { st.query = ''; bar(); }
      draw();
      if (!inTree) b.scrollTo?.({ top: 0 });
    }
    if (act === 'twist') toggle(t.dataset.key);
    if (act === 'more') { st.more.add(t.dataset.key); draw(); }
    if (act === 'fold') { st.open.add(t.dataset.key); draw(); }
  });
  // a node with children opens and closes from the keyboard as a tree's does: Right opens, Left closes
  b.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const key = e.target.closest?.('[data-tree]')?.dataset.tree;
    if (!key || !b.querySelector(`.dep-twist[data-key="${CSS.escape(key)}"]`)) return;
    const shut = st.closed.has(key);
    if ((e.key === 'ArrowRight') === shut) { e.preventDefault(); toggle(key); b.querySelector(`[data-tree="${CSS.escape(key)}"] button`)?.focus(); }
  });

  load();
}
