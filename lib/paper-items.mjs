// The paper's tables and figures as things, not files (Tables and figures, plan amendment 2026-10-17). Every item has three parts:
//
//   type         what it is: a flow diagram, risk-of-bias plots, a forest plot, an evidence table... (TYPES), from what the app draws, the
//                caption's words, then the file's name; the icon follows the type (a table or a figure), never the extension alone;
//   place        where it belongs in the paper (Figure 2, Table S1, or not placed yet: the manuscript's legends, the supplement's captions,
//                the package's labels) and in the app (the page that owns its data, with "Open in …");
//   connections  what it is made from and what uses it, read from the dependency graph (lib/deps-graph.mjs) by the caller.
//
// Where the app draws the item from its own data (`drawables`: the PRISMA flow, the risk-of-bias plots of an instrument, the evidence
// table...), the item is that drawing and the folder's PNG, PDF, XLSX and DOCX files of it are its printed versions. A file that matches
// nothing stays a file, named from its words and grouped by what it is (figures, tables, documents, working files, earlier versions).
//
// Pure: drawables, folder rows, captions and graph facts in, items out. Nothing reads a file, a clock or the store; no project is named.
import { folderIndex } from './folder-map.mjs';

/** The type of an item: its words in the interface and whether it is a table or a figure. */
export const TYPES = Object.freeze({
  flow: { word: 'Flow diagram', kind: 'figure' },
  'rob-plots': { word: 'Risk-of-bias plots', kind: 'figure' },
  'rob-traffic': { word: 'Risk-of-bias traffic-light plot', kind: 'figure' },
  'rob-summary': { word: 'Risk-of-bias summary plot', kind: 'figure' },
  forest: { word: 'Forest plot', kind: 'figure' },
  'evidence-map': { word: 'Evidence map', kind: 'figure' },
  swim: { word: 'Synthesis without meta-analysis', short: 'SWiM', kind: 'figure' },
  chart: { word: 'Chart', kind: 'figure' },
  km: { word: 'Kaplan–Meier', kind: 'figure' },
  figure: { word: 'Figure', kind: 'figure' },
  evidence: { word: 'Evidence table', kind: 'table' },
  characteristics: { word: 'Characteristics table', kind: 'table' },
  searches: { word: 'Search strategy table', kind: 'table' },
  'search-summary': { word: 'Search yield table', kind: 'table' },
  'rob-table': { word: 'Risk-of-bias table', kind: 'table' },
  sof: { word: 'Summary of findings table', kind: 'table' },
  profile: { word: 'GRADE evidence profile', kind: 'table' },
  cases: { word: 'Patient table', kind: 'table' },
  table: { word: 'Table', kind: 'table' },
  document: { word: 'Document', kind: 'document' },
});
// a figure of several panels has a type per panel, joined by "+" ('forest+swim'): its words name each, short ("Forest plot and SWiM"), a
// later word lowered unless it holds a capital of its own (an acronym or a name: SWiM, Kaplan–Meier)
const partsOf = type => String(type || '').split('+').filter(Boolean);
const lowered = w => (/[A-Z]/.test(w.slice(1)) ? w : w[0].toLowerCase() + w.slice(1));
export const typeWord = type => {
  const parts = partsOf(type);
  if (parts.length < 2) return TYPES[type]?.word || 'Figure';
  const words = parts.map((t, i) => { const w = TYPES[t]?.short || TYPES[t]?.word || 'figure'; return i ? lowered(w) : w; });
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
};
export const kindOfType = type => TYPES[partsOf(type)[0]]?.kind || 'figure';

// ---- the instruments of risk of bias, by family ------------------------------------------------------------------------------
const FAMILIES = [['robins-i', /robins/i], ['rob2', /\brob[\s_-]?2\b|revised cochrane|cochrane risk[\s-]of[\s-]bias tool for randomi[sz]ed/i], ['jbi', /\bjbi\b|joanna briggs/i],
  ['nos', /newcastle|\bnos\b/i], ['quadas', /quadas/i], ['amstar', /amstar/i], ['casp', /\bcasp\b/i], ['mmat', /\bmmat\b/i]];
/** The family of an instrument named in a text ("ROBINS-I V2", "RoB_JBI_summary", "assessed with the revised Cochrane tool"), or ''. */
export const familyOf = text => FAMILIES.find(([, re]) => re.test(String(text || '').replace(/_/g, ' ')))?.[0] || '';
const FAMILY_WORD = { 'robins-i': 'ROBINS-I', rob2: 'RoB 2', jbi: 'JBI', nos: 'Newcastle–Ottawa', quadas: 'QUADAS-2', amstar: 'AMSTAR 2', casp: 'CASP', mmat: 'MMAT' };

// ---- places in the folder: the paper's own, working files, earlier states --------------------------------------------------------
const EARLIER_DIR = /superseded|^old\b|\bold versions?\b|archive|previous|\(original\)|earlier|obsolete|deprecated|^before\b/i;
const WORKING_DIR = /^(tools?|templates?|code|inputs?|scripts?|src|references?|examples?|audits?|guidance|rcheck|.*\bchecks?\b.*|.*\baudit\b.*)$/i;
const WORKING_NAME = /(^|[_\s-])(check|checks|renames?|inventory|template|scratch|test)([_\s.-]|$)/i;
const segments = p => p.split('/').slice(0, -1);
/** A file kept as an earlier state of the paper: under a superseded, old, original or archive folder. */
export const isEarlier = path => segments(path).some(s => EARLIER_DIR.test(s));
/** A working file: a script's input or output, a template, a check, an audit; not a table or figure of the paper. */
export const isWorking = (path, name = path.slice(path.lastIndexOf('/') + 1)) => segments(path).some(s => WORKING_DIR.test(s)) || WORKING_NAME.test(name);

// ---- names ----------------------------------------------------------------------------------------------------------------------
const LABEL_IN_NAME = /(?:^|[^a-z])(fig(?:ure)?|table)[\s_-]*(s?)(\d{1,2})(?![\d])/i;
/** "Figure 2" from "Figure2_dynamic_vs_rigid", "Table S1" from "Table_S1_characteristics"; null when the name holds none. */
export function labelInName(name) {
  const m = LABEL_IN_NAME.exec(String(name || ''));
  if (!m) return null;
  const kind = /^t/i.test(m[1]) ? 'table' : 'figure', supp = !!m[2];
  return { kind, supp, n: Number(m[3]), label: `${kind === 'table' ? 'Table' : 'Figure'} ${supp ? 'S' : ''}${Number(m[3])}`, rest: String(name).slice(m.index + m[0].length) };
}
const VERSION_TAIL = /([\s_-]*(final)?[\s_-]*v\d+[a-z]?(?:[._]\d+)*)$/i;
/**
 * A file's name in words: the version and the shared project prefix dropped ("Spine_ASD_supplementary_material_v1" → "Supplementary
 * material"), underscores as spaces, the first letter raised; acronyms and numbers kept as written.
 */
export function wordsOf(name, prefix = '') {
  let t = String(name || '');
  if (prefix && t.toLowerCase().startsWith(prefix.toLowerCase()) && t.length > prefix.length + 2) t = t.slice(prefix.length);
  t = t.replace(/\s*\([^)]*\)\s*$/, '').replace(VERSION_TAIL, '').replace(/[_]+/g, ' ').replace(/\s+-\s+/g, ' – ').replace(/\s+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : String(name || '');
}
/** The prefix most of the folder's file names share ("Spine_ASD_"): two leading words that begin three names or more. */
export function sharedPrefix(names) {
  const count = new Map();
  for (const n of names) { const m = /^([A-Za-z0-9]+[_-][A-Za-z0-9]+[_-])/.exec(n); if (m) count.set(m[1], (count.get(m[1]) || 0) + 1); }
  const best = [...count].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 3 ? best[0] : '';
}

// ---- types from words -----------------------------------------------------------------------------------------------------------
// what a caption's words say, each kind by its words; a kind that does not fit a table or a figure is passed over
const SAYS = [
  ['flow', /prisma|flow diagram|study selection/i, k => (k !== 'table' ? 'flow' : '')],
  ['rob', /risk of bias|risk-of-bias|methodological quality|critical appraisal/i, k => (k === 'table' ? 'rob-table' : 'rob-plots')],
  ['swim', /synthesis without meta-analysis|\bswim\b/i, () => 'swim'],
  ['sof', /summary of findings/i, () => 'sof'],
  ['profile', /\bgrade\b|certainty of (the )?evidence|evidence profile/i, () => 'profile'],
  ['searches', /search strateg/i, () => 'searches'],
  ['forest', /forest plot|risk ratios?|odds ratios?|hazard ratios?|pooled|meta-analys|inverse[\s-]variance/i, k => (k !== 'table' ? 'forest' : '')],
  ['evidence-map', /evidence map|heat ?map/i, () => 'evidence-map'],
  ['characteristics', /characteristics/i, k => (k === 'table' ? 'characteristics' : '')],
];
/**
 * The type a caption's words say ("Risk ratios were pooled…" a forest plot, "PRISMA 2020 flow diagram" a flow diagram), or ''. The kind named
 * first is what it is: a legend that says "Synthesis without meta-analysis…" and later "studies at critical risk of bias" is a SWiM (Figure 3,
 * 2026-10-24, read as risk-of-bias plots while risk of bias was asked before anything else).
 */
export function typeInText(text, kind) {
  const t = String(text || '');
  let best = '', at = Infinity;
  for (const [, re, type] of SAYS) {
    const m = re.exec(t), got = m ? type(kind) : '';
    if (got && m.index < at) { best = got; at = m.index; }
  }
  return best;
}
/** A legend's panels: "(A) Any failure… (B) Synthesis without…" as `[{ letter, text }]`, A, B, … in order; [] for a legend of one part. */
export function legendPanels(text) {
  const t = String(text || ''), marks = [...t.matchAll(/(?:^|[\s.;:])\(([A-H])\)\s/g)], out = [];
  for (const m of marks) if (m[1].charCodeAt(0) - 65 === out.length) out.push({ letter: m[1], at: m.index + m[0].length - m[1].length - 3 });
  if (out.length < 2) return [];
  return out.map((p, i) => ({ letter: p.letter, text: t.slice(p.at, out[i + 1]?.at ?? t.length).replace(/^\s*\([A-H]\)\s*/, '').trim() }));
}
/**
 * The type of a caption: its title's words first, then its legend's. A legend of panels has a type per panel (`panels`), and two kinds or more
 * make the type theirs ('forest+swim', "Forest plot and SWiM"); `{ type, panels }`.
 */
export function captionType(title, text, kind) {
  const panels = legendPanels(text).map(p => typeInText(p.text, kind)), kinds = [...new Set(panels.filter(Boolean))];
  if (kinds.length > 1) return { type: kinds.join('+'), panels };
  return { type: typeInText(title, kind) || kinds[0] || typeInText(text, kind), panels };
}
/** The concept a type names, the key a drawable of the app shares with captions and files: 'prisma', 'rob:jbi', 'searches'... */
function conceptOfType(type, text) {
  if (type === 'flow') return 'prisma';
  if (type === 'rob-plots' || type === 'rob-traffic' || type === 'rob-summary') { const f = familyOf(text); return f ? `rob:${f}` : ''; }
  if (type === 'rob-table') return 'rob-table';
  if (type === 'evidence-map') return 'evidence-map';
  if (type === 'characteristics') return 'evidence';
  if (['swim', 'sof', 'profile', 'searches'].includes(type)) return type;
  return '';
}

/**
 * The forest plot of a comparison a forest caption names by its two sides ("Any failure with dynamic versus rigid stabilization": the
 * comparison of Dynamic and Rigid), when exactly one such drawing is not placed yet; null otherwise.
 */
function sidesNamed(items, title) {
  const words = ` ${String(title || '').toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ' ')} `;
  const hits = [...items.values()].filter(it => it.type === 'forest' && !it.label && it.drawn?.sides?.length === 2
    && it.drawn.sides.every(x => words.includes(` ${String(x).toLowerCase().trim()} `)));
  if (hits.length < 2) return hits[0] || null;
  // several comparisons of the same sides ("Dynamic vs rigid" and "Dynamic vs rigid, no revisions"): the one whose own name the caption
  // says the most of, a share of its words; a tie places none
  const share = it => { const own = String(it.drawn.outcomeName || '').toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter(w => w.length > 2 && !/^(vs|versus)$/.test(w));
    return own.length ? own.filter(w => words.includes(` ${w} `)).length / own.length : 0; };
  const ranked = hits.map(it => [it, share(it)]).sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > ranked[1][1] ? ranked[0][0] : null;
}

// ---- a comparison a caption names ----------------------------------------------------------------------------------------------------
const WORD = /[\p{L}\p{N}]+(?:[-‐–][\p{L}\p{N}]+)*/gu;
const VERSUS = /\s(?:versus|vs\.?)\s/i;
const FILLER = new Set(['the', 'a', 'an']);
/**
 * The two sides a caption names, as written: "Any failure with dynamic versus rigid stabilization" is dynamic and rigid, "two-stage vs
 * single-stage surgery" two-stage and single-stage, "dynamic stabilization versus rigid stabilization" (a shared noun after each side)
 * dynamic and rigid. `{ treated, control }`, the first side treated; null when the caption sets no two things against each other.
 */
export function captionSides(text) {
  const t = String(text || ''), m = VERSUS.exec(t);
  if (!m) return null;
  const before = t.slice(0, m.index).match(WORD) || [], after = (t.slice(m.index + m[0].length).match(WORD) || []).filter((w, i) => i > 0 || !FILLER.has(w.toLowerCase()));
  if (!before.length || !after.length) return null;
  const low = w => String(w || '').toLowerCase();
  const shared = before.length > 1 && after.length > 1 && low(before.at(-1)) === low(after[1]);
  const treated = shared ? before.at(-2) : before.at(-1), control = after[0];
  return low(treated) === low(control) ? null : { treated: treated.replace(/[‐–]/g, '-'), control: control.replace(/[‐–]/g, '-') };
}
/** The words of an item's caption: its title, else what its file's name says after the label ("Figure 2 · Dynamic vs rigid"). */
export const captionTitle = it => String(it?.caption || String(it?.name || '').replace(/^[^·:]*[·:]\s*/, ''));
/**
 * Whether Tables and figures makes a comparison of an item (views/outputs.mjs drawPrinted): a figure the app does not draw yet whose caption sets two sides
 * against each other (a forest plot of a comparison, printed only).
 */
export const canSetUp = it => !!it && !it.drawn && it.kind === 'figure' && !!captionSides(captionTitle(it));

/** What a file's own name says:`{ type, concept, label?, part? }` ("RoB_JBI_traffic_light" is the JBI risk-of-bias traffic light). */
export function fileSays(name, ext = '') {
  const n = String(name || ''), words = n.replace(/_/g, ' '), figureFile = !['xlsx', 'xls', 'csv', 'tsv', 'docx'].includes(ext);
  const label = labelInName(n);
  if (/prisma/i.test(n) && !/checklist/i.test(n) && figureFile) return { type: 'flow', concept: 'prisma', label };
  if (/(^|[^a-z])rob([^a-z]|$)|risk[\s_-]?of[\s_-]?bias/i.test(n)) {
    const fam = familyOf(words);
    if (figureFile && fam) { const part = /traffic/i.test(n) ? 'traffic' : /summary/i.test(n) ? 'summary' : ''; return { type: part === 'traffic' ? 'rob-traffic' : part === 'summary' ? 'rob-summary' : 'rob-plots', concept: `rob:${fam}`, label, part }; }
    if (['xlsx', 'xls', 'csv'].includes(ext)) return { type: 'rob-table', concept: 'rob-table', label };
    return { type: '', concept: '', label };
  }
  if (/search[\s_-]*strateg/i.test(n) && ext !== 'docx') return { type: 'searches', concept: 'searches', label };
  if (/(^|[^a-z])swim([^a-z]|$)/i.test(n)) return { type: 'swim', concept: label ? '' : 'swim', label };
  if (/forest/i.test(n)) return { type: 'forest', concept: '', label };
  if (/summary[\s_-]*of[\s_-]*findings|(^|[^a-z])sof([^a-z]|$)/i.test(n)) return { type: 'sof', concept: 'sof', label };
  if (/grade|evidence[\s_-]*profile/i.test(n)) return { type: 'profile', concept: 'profile', label };
  return { type: '', concept: '', label };
}

// ---- rows of the folder ------------------------------------------------------------------------------------------------------------
const FIGURE_EXT = new Set(['png', 'jpg', 'jpeg', 'svg', 'tif', 'tiff', 'gif', 'webp', 'eps', 'pdf', 'pzfx']);
const TABLE_EXT = new Set(['xlsx', 'xls', 'csv', 'tsv']);
const fileKind = r => (r.formats.some(f => FIGURE_EXT.has(f) && f !== 'pdf') ? 'figure' : r.formats.some(f => TABLE_EXT.has(f)) ? 'table' : r.formats.includes('pdf') ? 'document' : 'document');
const pathOf = r => r.open || Object.values(r.paths || {})[0] || '';
const placeOf = r => (pathOf(r).includes('/') ? pathOf(r).slice(0, pathOf(r).lastIndexOf('/')) : '');

/**
 * The folder's rows (lib/folder-results.mjs groupResults, flattened) with the copies of one file folded into one row: the same name, formats
 * and size in several folders is one row whose `places` are those folders, the shallowest first (a quick-access copy is where it is read).
 */
export function foldCopies(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.name}\u0000${[...r.formats].sort().join(',')}\u0000${r.size || 0}`;
    (by.get(k) || by.set(k, []).get(k)).push(r);
  }
  return [...by.values()].map(list => {
    const sorted = list.slice().sort((a, b) => pathOf(a).split('/').length - pathOf(b).split('/').length || pathOf(a).localeCompare(pathOf(b)));
    return { ...sorted[0], places: sorted.map(placeOf), copies: sorted.map(pathOf), mtime: Math.max(...list.map(x => x.mtime || 0)) };
  });
}

// ---- the items ------------------------------------------------------------------------------------------------------------------------
const labelKey = c => `label:${c.label}`;
// the main text's figures, then its tables, by number; the supplement in the order its document gives them
const byLabel = (a, b) => (a.supp === b.supp ? 0 : a.supp ? 1 : -1) || (a.supp ? (a.order ?? 0) - (b.order ?? 0) : 0) || (a.labelKind === b.labelKind ? 0 : a.labelKind === 'figure' ? -1 : 1) || a.n - b.n;

/**
 * The items and the files that match none: `{ items, files, counts }`.
 *
 *   drawables  `[{ key, concept, type, name, view, viewLabel, origin, node, order, printedAs? }]`: what the app draws from its own data (built by
 *              the view); `printedAs` names the printed item a drawing was made for ("Figure 4"), placed there before any concept
 *   rows       the folder's result rows (groupResults' items, flattened)
 *   captions   `[{ label, kind, supp, n, title, text, doc }]`: the legends and captions of the paper's documents and package
 *   graph      `{ templateOf(path), madeFrom(path), usedBy(path) }` (all optional): what the dependency graph says of a file
 *   matches    Map(path -> match): the prints whose panels are the app's results (lib/printed-data.mjs printedMatch); such a print's item is
 *              drawn by the app from them (2026-10-24: Figures 3 and 4 fell back to "File only" each time a script relinked their files)
 *
 * An item: `{ id, type, kind, name, label, place, n, drawn, printed: [row], legendDocs, madeFrom, usedBy, mtime, order }`; `place` is
 * 'main', 'supplement' or '' (not placed yet). `files`: `{ figures, tables, documents, working, earlier }`, each a list of named rows.
 */
export function paperItems({ drawables = [], rows = [], captions = [], graph = {}, matches = null } = {}) {
  const items = new Map(), files = { figures: [], tables: [], documents: [], working: [], earlier: [] };
  const folded = foldCopies(rows), index = folderIndex(folded.map(r => ({ path: pathOf(r), size: r.size || 0, mtime: r.mtime || 0 })));
  const classed = new Map(index.files.map(f => [f.path, f]));
  const prefix = sharedPrefix(folded.map(r => r.name));
  const named = r => ({ ...r, words: wordsOf(r.name, prefix), path: pathOf(r), place: placeOf(r) });

  // the app's drawings first: each is an item, placed in the paper when a caption names it
  for (const d of drawables) items.set(d.key, { id: d.key, type: d.type, kind: kindOfType(d.type), name: d.name, label: '', place: '', n: 0, drawn: d, concept: d.concept || '',
    printed: [], legendDocs: [], madeFrom: d.origin ? [d.origin] : [], usedBy: [], mtime: 0, order: d.order ?? 500 });
  const byConcept = new Map([...items.values()].filter(it => it.concept).map(it => [it.concept, it]));
  // the evidence table is named by its extraction table ('evidence:<id>'); a caption that says "characteristics" names the first one
  const firstEvidence = [...byConcept.entries()].find(([k]) => k.startsWith('evidence:'))?.[1];
  if (firstEvidence && !byConcept.has('evidence')) byConcept.set('evidence', firstEvidence);

  // captions: a numbered place in the paper. One that names a drawing places that drawing; any other is an item of its own.
  const seen = new Map();
  captions.forEach((c, i) => {
    // a second document with the same caption (a short version, a copy) is one more place it is printed
    // (only with the same title: a short or draft version numbering its tables otherwise is not where this one is printed)
    if (seen.has(c.label)) { const had = seen.get(c.label); if (c.doc && had.caption === c.title && !had.legendDocs.includes(c.doc)) had.legendDocs.push(c.doc); return; }
    const words = `${c.title} ${c.text || ''}`, { type } = captionType(c.title, c.text || '', c.kind);
    // a main-text "Table N" is the evidence table's collection of that name when the app has one (its publication tables)
    const concept = conceptOfType(type, words) || (c.kind === 'table' && !c.supp && byConcept.has(`pubtable:${c.n}`) ? `pubtable:${c.n}` : '') || (c.concept || '');
    // a caption of the package or the manuscript made from a drawing of the app names that drawing (`drawn`); a forest plot's caption that
    // names both sides of a comparison places that comparison's forest plot
    // a drawing made for a printed figure (Tables and figures, drawPrinted: its synthesis without meta-analysis) is placed at that figure's label
    const made = [...items.values()].find(it => it.drawn?.printedAs === c.label && !it.label);
    const target = (c.drawn && items.get(c.drawn)) || made || (concept && byConcept.get(concept)) || (type === 'forest' && sidesNamed(items, c.title)) || null;
    const place = c.supp ? 'supplement' : 'main', placed = { label: c.label, place, n: c.n, labelKind: c.kind, supp: c.supp, caption: c.title, legend: c.text || '', order: i };
    if (target && !target.label) {
      Object.assign(target, placed, { name: `${c.label}: ${c.title}` });
      if (c.doc) target.legendDocs.push(c.doc);
      items.set(labelKey(c), target); seen.set(c.label, target);
      return;
    }
    const it = { id: labelKey(c), type: type || (c.kind === 'table' ? 'table' : 'figure'), kind: c.kind, name: `${c.label}: ${c.title}`, drawn: null, concept,
      printed: [], legendDocs: c.doc ? [c.doc] : [], madeFrom: [], usedBy: [], mtime: 0, ...placed };
    items.set(labelKey(c), it); seen.set(c.label, it);
    if (concept && !byConcept.has(concept)) byConcept.set(concept, it);
  });

  // the folder's rows: a printed version of an item, else a file of its own
  const docRows = new Map(), printOf = new Map();
  // a drawing the package keeps a print of (`prints`: its item's `source.was`) has that file as its printed version
  for (const it of items.values()) for (const p of it.drawn?.prints || []) if (!printOf.has(p)) printOf.set(p, it);
  for (const r0 of folded) {
    const r = named(r0), cls = classed.get(r.path) || {}, ext = r.formats[0];
    if (isEarlier(r.path) || cls.archived || cls.older) { files.earlier.push(r); continue; }
    if (isWorking(r.path, r.name)) { files.working.push(r); continue; }
    // a document whose captions placed items is printed in them (its row is reached from those items)
    if (captions.some(c => c.doc && r.copies.includes(c.doc))) { docRows.set(r.path, r); for (const p of r.copies) docRows.set(p, r); continue; }
    // a file the package names as an item's source is that item's printed version
    const pkgHit = captions.find(c => (c.paths || []).some(p => r.copies.includes(p)));
    if (pkgHit && seen.has(pkgHit.label)) { seen.get(pkgHit.label).printed.push({ ...r, part: '' }); continue; }
    const printHit = r.copies.map(p => printOf.get(p)).find(Boolean);
    if (printHit) { printHit.printed.push({ ...r, part: '' }); continue; }
    const says = fileSays(r.name, ext), tpl = r.copies.map(p => graph.templateOf?.(p)).find(Boolean);
    const conceptHit = (tpl && byConcept.get(`evidence:${tpl}`)) || (says.concept && byConcept.get(says.concept))
      || (cls.role === 'evidence-table' && !says.concept && !says.label && firstEvidence) || null;
    // a file matched by its number alone is not a printed version of a drawing the app makes (a script's old Figure 6 is not the app's)
    const labelHit0 = says.label && items.get(`label:${says.label.label}`), labelHit = labelHit0?.drawn ? null : labelHit0;
    let it = conceptHit || labelHit || null;
    if (!it && (says.label || says.concept)) {
      // a numbered file with no caption, or a kind the app knows with no drawing: an item of its own, named from the file
      const key = says.concept ? `concept:${says.concept}` : `label:${says.label.label}`;
      it = items.get(key);
      if (!it) {
        const type = says.type || (says.label?.kind === 'table' ? 'table' : 'figure'), fam = says.concept?.startsWith('rob:') ? FAMILY_WORD[says.concept.slice(4)] : '';
        const rest = says.label ? wordsOf(says.label.rest.replace(/^[_\s-]+/, '')) : '';
        it = { id: key, type: says.concept?.startsWith('rob:') ? 'rob-plots' : type, kind: says.label?.kind || kindOfType(type), concept: says.concept || '', drawn: null,
          name: says.label ? `${says.label.label}${rest ? `: ${rest}` : ''}` : `${typeWord(says.concept?.startsWith('rob:') ? 'rob-plots' : type)}${fam ? `: ${fam}` : ''}`,
          label: says.label?.label || '', place: says.label ? (says.label.supp ? 'supplement' : 'main') : '', n: says.label?.n || 0, labelKind: says.label?.kind, supp: !!says.label?.supp,
          printed: [], legendDocs: [], madeFrom: [], usedBy: [], mtime: 0, order: 900 };
        items.set(key, it);
        if (says.concept && !byConcept.has(says.concept)) byConcept.set(says.concept, it);
      }
    }
    if (it) { it.printed.push({ ...r, part: says.part || '' }); continue; }
    const kind = fileKind(r);
    const words = r.words.replace(/\s/g, '').length <= 6 && cls.label && !/^(Document|Table|Figure|Other|Report)$/.test(cls.label) ? cls.label : r.words;
    files[kind === 'figure' ? 'figures' : kind === 'table' ? 'tables' : 'documents'].push({ ...r, words });
  }

  // each item's printed versions: its files, then the documents its caption is in; its connections from the graph
  const out = [...new Set(items.values())];
  const placedDocs = new Set();
  for (const it of out) {
    for (const d of it.legendDocs) { const r = docRows.get(d); if (r && !it.printed.some(x => x.path === r.path)) { it.printed.push({ ...r, part: 'caption' }); placedDocs.add(r.path); } }
    it.mtime = Math.max(0, ...it.printed.map(r => r.mtime || 0));
    const made = new Set(it.madeFrom), used = new Set(it.usedBy);
    for (const r of it.printed) for (const p of r.copies || [r.path]) { for (const x of graph.madeFrom?.(p) || []) made.add(x); for (const x of graph.usedBy?.(p) || []) used.add(x); }
    for (const d of it.legendDocs) used.add(`${it.kind === 'table' ? 'Caption' : 'Legend'} in ${d.slice(d.lastIndexOf('/') + 1)}`);
    it.madeFrom = [...made]; it.usedBy = [...used];
    // a print whose panels are the app's results is drawn by the app from them, whatever its source says now (a print relinked by a script)
    const m = matches?.size && it.kind === 'figure' && (!it.drawn || it.drawn.draw === 'synth') ? matchOf(it, matches) : null;
    if (m) { it.drawn = printedDrawable(it, m); if (m.type) it.type = m.type; }
  }
  // a document whose captions placed nothing (its numbering is another version's) is a document of its own
  for (const r of new Set(docRows.values())) if (!placedDocs.has(r.path)) files.documents.push(r);
  const placed = out.filter(it => it.label).sort((a, b) => byLabel(a, b) || a.order - b.order);
  const rest = out.filter(it => !it.label).sort((a, b) => (a.printed.length ? 0 : 1) - (b.printed.length ? 0 : 1) || a.order - b.order || a.name.localeCompare(b.name));
  for (const k of Object.keys(files)) files[k].sort((a, b) => a.words.localeCompare(b.words, undefined, { numeric: true }) || a.path.localeCompare(b.path));
  const list = [...placed, ...rest];
  return { items: list, files, counts: { figures: list.filter(it => it.kind === 'figure').length, tables: list.filter(it => it.kind === 'table').length,
    drawn: list.filter(it => it.drawn).length, drawnWithPrinted: list.filter(it => it.drawn && it.printed.length).length,
    // the folder's rows (each copy one) printed as some item, and as an item the app draws: a document holding several captions counts once
    filesInItems: new Set(list.flatMap(it => it.printed.flatMap(r => r.copies || [r.path]))).size,
    filesInDrawn: new Set(list.filter(it => it.drawn).flatMap(it => it.printed.flatMap(r => r.copies || [r.path]))).size } };
}

/** The match of an item's printed files (lib/printed-data.mjs printedMatch, by path), the first of its files that has one; null for none. */
const matchOf = (it, matches) => it.printed.flatMap(r => [...(r.copies || []), ...Object.values(r.paths || {}), r.path]).map(p => matches.get(p)).find(Boolean) || null;
/**
 * The drawing of a print whose panels the app holds: drawn from the print's own reading, each panel against its result (`draw: 'printed'`,
 * views/outputs-paper.mjs drawInto). Its state says whether the print still shows what the app holds ("Matches the app") or the app's data
 * have moved since it was made; its origin names where each panel's result lives.
 */
function printedDrawable(it, m) {
  return { key: `drawn:printed:${m.path}`, concept: '', type: m.type || it.type, name: it.name, view: m.view, viewLabel: m.viewLabel, origin: `From ${m.viewLabel}: ${m.words}`,
    node: '', draw: 'printed', match: m, pkg: m.pkg || '', ...(it.drawn?.app ? { app: it.drawn.app } : {}), state: m.differs ? 'Changed since made' : 'Matches the app', order: it.drawn?.order ?? 56 };
}

/**
 * The section an item is listed in: the main text's figures, its tables, the supplement, what is not placed yet, then Saved (a result the
 * project keeps that the paper does not place yet: a dataset analysis, the patient data's Kaplan–Meier) and Built in.
 */
export function sectionOf(it) {
  if (it.place === 'main') return it.kind === 'table' ? 'tables' : 'figures';
  if (it.place === 'supplement') return 'supplement';
  if (it.drawn?.kept && !it.printed.length) return 'saved';
  return it.printed.length ? 'unplaced' : 'app';
}
export const SECTIONS = Object.freeze([['figures', 'Figures'], ['tables', 'Tables'], ['supplement', 'Supplement'], ['unplaced', 'Not placed yet'], ['saved', 'Saved'], ['app', 'Built in']]);
export const FILE_GROUPS = Object.freeze([['figures', 'Figures'], ['tables', 'Tables'], ['documents', 'Documents'], ['working', 'Working files'], ['earlier', 'Earlier versions']]);

/** Captions of a document's paragraphs: `captionOf` (lib/package-import.mjs) reads each; the title is the caption's first sentence. */
export function captionsIn(paragraphs, doc, captionOf) {
  const out = [];
  for (const p of paragraphs) {
    const c = captionOf(String(p || '').trim());
    if (!c || !c.rest) continue;
    const m = /^(.*?[.!?])(\s+|$)/s.exec(c.rest), title = (m ? m[1] : c.rest).replace(/[.]$/, '').trim();
    if (!title || title.length < 3) continue;
    out.push({ label: `${c.kind === 'table' ? 'Table' : 'Figure'} ${c.prefix}${c.n}`, kind: c.kind, supp: c.prefix === 'S', n: c.n, title, text: c.rest, doc });
  }
  return out;
}
