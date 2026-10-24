// The figure-need rules of plan §4.15c.6 as one pure function:
//
//   detect(facts, options, now) -> Finding[]      the findings, ranked
//   rank(findings), digest(findings), overview(findings, cap), routed(findings, surface)
//
// `facts` is the object lib/figure-facts.mjs collects (the app and the MCP both
// build it); nothing here reads a file, a clock, a locale or a random source,
// calls a model, or writes anything: the same facts give the same findings, in
// any time zone. `now` is only the clamp for a date in the future (facts have
// already ignored those); it defaults to facts.now.
//
// A Finding is { key, rule, kind, severity, subject, text, evidence, members?,
// stamp, action, generatable, reason?, surfaces, decision, ... }:
//   key         "<rule>:<subject>", one finding per key;
//   text        sentence case, at most 80 characters;
//   evidence    at most 5 of { kind, path?, at?, quote?, line? };
//   stamp       first 12 hex of sha256(rule | paths with size:mtime | evidence text),
//               so a decision lapses when the evidence changes (paths without size:mtime
//               for a rule whose evidence holds all it reads, stampBy 'evidence': Y5);
//   action      the actions the row offers, by id (see ACTIONS);
//   generatable 'yes' | 'no' | 'external' | 'blocked';
//   surfaces    where it is shown: overview, outputs, assistant, mcp;
//   decision    null, or { state, at } of the registry decision that still holds.
//
// Vocabulary and thresholds are lib/figure-lexicon.mjs (PARAMS and the word
// lists); the few numbers the spec leaves open are in LOCAL below, named.
import { sha256 } from './allocation.mjs';
import { parseVersionFull } from './folder-map.mjs';
import { literalMentions } from './submission-checks.mjs';
import { decisionFor, baselineFor } from './figure-registry.mjs';
import { PRESETS } from './figure-presets.mjs';
import { findingsOf as driftFindingsOf, DRIFT_RULES } from './drift.mjs';
import { coverageRules, COVERAGE_RULES } from './coverage-needs.mjs';
import { PARAMS, FIGURE_EXTENSIONS, FIGURE_NOUNS, ASK_WORDS, CLINICAL_IMAGE_WORDS, DECLARATION_STOP_WORDS, FUNCTION_WORDS } from './figure-lexicon.mjs';

// ---- constants ----------------------------------------------------------------------

export const TEXT_MAX = 80;
export const EVIDENCE_MAX = 5;
export const SEVERITY_ORDER = ['block', 'gap', 'info'];
/** The order of kinds in the ranking (plan §4.15c.5). One constant, so a change of order is one edit. */
export const KIND_ORDER = ['missing', 'source', 'requested', 'stale', 'unlinked', 'style', 'coverage', 'notice'];
/** Action ids a row can offer. */
export const ACTIONS = ['use-file', 'add-task', 'propose', 'link', 'adopt', 'not-for-submission', 'rebuild', 'mark-current', 'run-again', 'open-folder', 'open-task'];
export const RULES = Object.freeze({
  W1: 'source', M1: 'missing', M2: 'missing', M3: 'missing',
  T1: 'stale', T2: 'stale', T3: 'stale', T4: 'stale', T5: 'stale',
  R1: 'requested', R2: 'requested', U1: 'unlinked',
  Y1: 'style', Y2: 'style', Y3: 'style', Y4: 'style', Y5: 'style',
  X1: 'notice', X2: 'notice', X3: 'notice',
});

/**
 * Numbers the spec leaves open, named so that none is buried in a rule (defaults, not measured).
 * FOLDER_PATTERN_SHARE: spec M1, "80 % of the folder's files follow that pattern".
 * GENERIC_SHARE: a token in more than this share of the stems says nothing (spec R1, `declared`).
 * DISTINCT_SHARE: a token is distinctive when at most this share of the figures holds it (at least one figure).
 * PRISMA_SHARE: the share of PRISMA fields filled from which a PRISMA figure is expected.
 * DECL_DISTINCT_SHARE, DECL_DISTINCT_MIN: a word of a guide declaration identifies a file when at most max(MIN, SHARE of the
 * families of its class) carry it.
 */
export const LOCAL = Object.freeze({ FOLDER_PATTERN_SHARE: 0.8, GENERIC_SHARE: 1 / 3, DISTINCT_SHARE: 0.1, PRISMA_SHARE: 0.5, DECL_DISTINCT_SHARE: 0.1, DECL_DISTINCT_MIN: 2, MAX_MEMBERS: 200, MAX_COMMANDS: 5, CANDIDATE_LEGEND_SHARE: 0.5, MATCH_TOP_SHARE: 0.85 });

/** Words that never identify a figure in a request (plain text), besides the lexicon's function, noun and ask words. */
const TOKEN_STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'these', 'those', 'from', 'into', 'about', 'which', 'what', 'when', 'where', 'whether',
  'would', 'could', 'should', 'will', 'can', 'may', 'might', 'also', 'more', 'most', 'some', 'such', 'than', 'then', 'there', 'their', 'they', 'them', 'you', 'your',
  'authors', 'author', 'reviewer', 'comment', 'manuscript', 'paper', 'article', 'data', 'figure', 'figures', 'fig', 'table', 'tables', 'text', 'section', 'one', 'two',
  'forest', 'forrest', 'funnel', 'kaplan', 'meier', 'curve', 'heat', 'map', 'flow', 'chart', 'diagram', 'graph', 'plot', 'visualization', 'visualisation',
  'meta', 'analysis', 'analyses', 'systematic', 'review', 'results', 'result', 'studies', 'study',
  'ideally', 'helpful', 'useful', 'better', 'clear', 'clearer', 'much', 'many', 'well', 'very', 'only', 'any', 'each', 'both', 'between', 'within', 'across']);

// ---- small helpers -------------------------------------------------------------------

const arr = v => Array.isArray(v) ? v : [];
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string' ? v : '';
const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const uniq = list => [...new Set(list)];
const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const extOf = p => { const b = baseOf(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const stemOf = p => { const b = baseOf(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; };
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const FIGURE_EXT = new Set(FIGURE_EXTENSIONS);
const IMAGE_EXT = new Set(FIGURE_EXTENSIONS.filter(e => e !== 'pdf'));
const underDir = (path, dir) => dir === '' || path === dir || path.startsWith(`${dir}/`);

/** A text squeezed to one line and cut to the finding limit (an ellipsis marks the cut). */
export const fit = (s, n = TEXT_MAX) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const clip = (s, n) => fit(s, n);
/** A file name short enough to share a finding text with other words. */
const short = (name, n = 40) => (name.length > n ? `${name.slice(0, n - 1)}…` : name);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Words of a name or sentence, lower case; camel case and digits-with-letters split at the usual joints. */
function words(s) {
  return String(s ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z][a-z0-9]*/g) || [];
}
const isCode = t => /^[a-z]{0,2}\d+[a-z]?$/.test(t) || /^v\d+$/.test(t);
/** A word as the rules compare it: a trailing plural s is dropped. */
const norm = t => t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t;

const wholeList = list => new RegExp(`^(?:${list.join('|')})$`, 'i');
const NOUN_TOKEN = wholeList(FIGURE_NOUNS);
const ASK_TOKEN = wholeList(ASK_WORDS);
const FUNCTION_SET = new Set([...FUNCTION_WORDS, ...DECLARATION_STOP_WORDS]);
const CLINICAL_RE = new RegExp(`\\b(?:${CLINICAL_IMAGE_WORDS.join('|')})\\b`, 'i');

/** Content words of a request: no function, noun, ask or filler word, no code such as "f3". */
function contentTokens(text) {
  return uniq(words(text).filter(t => t.length >= 3 && !isCode(t) && !TOKEN_STOP.has(t) && !FUNCTION_SET.has(t) && !NOUN_TOKEN.test(t) && !ASK_TOKEN.test(t)).map(norm)
    .filter(t => !TOKEN_STOP.has(t) && !FUNCTION_SET.has(t))).sort(byText);
}
/** Words of a file name or title as figure candidates carry them (version and page marks removed). */
function nameTokens(name) {
  return uniq(words(String(name).replace(/_p\d+(?=\.|$)/i, '')).filter(t => t.length >= 2 && !isCode(t) && !TOKEN_STOP.has(t)).map(norm));
}

const isLive = r => !r.scratch && !r.archived && !r.older && !r.copyOf;
/** The label a figure file stands for: "Figure 4", "Figure S12" (from "Figure4_forest", "S12", "FigureS3_x"); null otherwise. */
function labelOfFile(path) {
  const b = baseOf(path);
  let m = /^Figure[_ -]?(S?)0*(\d+)(?!\d)/i.exec(b);
  if (!m) m = /^(S)0*(\d+)[a-z]?(?=[._ -]|$)/i.exec(stemOf(path) + '.');
  return m ? `Figure ${m[1] ? 'S' : ''}${Number(m[2])}` : null;
}
const labelKey = label => slug(label);
/** "Figure 6, 7, 8" from labels; keeps the kinds apart. */
function listLabels(labels) {
  const by = new Map();
  for (const l of labels) { const m = /^(Figure S?)(\d+)$/.exec(l); const k = m ? m[1] : l; by.set(k, [...(by.get(k) || []), m ? Number(m[2]) : null]); }
  return [...by].map(([k, ns]) => (ns[0] == null ? k : `${k.replace('Figure', ns.length > 1 ? 'Figures' : 'Figure')} ${ns.sort((a, b) => a - b).join(', ')}`)).join('; ');
}

// ---- the context every rule reads -----------------------------------------------------

function buildContext(facts, options, now) {
  const params = Object.freeze({ ...PARAMS, ...(isObj(options.params) ? options.params : {}) });
  const files = arr(facts.files);
  const byPath = new Map(files.map(r => [r.path, r]));
  const registry = facts.sidecars?.registry?.doc || null;
  const style = facts.sidecars?.style?.doc || null;
  const docs = arr(facts.documents).filter(d => d && !d.error);
  const timeOn = facts.clock?.timeKind !== false;
  // A date in the future is ignored here too (facts already do); `at` of an evidence is a plain millisecond number.
  const clean = v => (Number.isFinite(v) && v > 0 && v <= now + 24 * 3600 * 1000 ? v : null);
  const ms = r => (r ? clean(r.mtimeMs) : null);
  const ctx = {
    facts, options, now, P: params, files, byPath, registry, style, docs, timeOn, ms, clean,
    state: isObj(facts.state) ? facts.state : {},
    guide: facts.guide && !facts.guide.unread ? facts.guide : null,
    producers: [...arr(facts.producers)].sort((a, b) => byText(String(a.id), String(b.id))),
    live: files.filter(isLive),
    out: [],
    m1: new Set(),
    stampOf: p => byPath.get(p)?.stamp ?? '',
  };
  ctx.consumers = docs.filter(d => ['manuscript', 'supplement', 'response', 'cover'].includes(d.role));
  return ctx;
}

/** The registry's figure entry for a path (placement, link, label, role), or {}. */
const figureEntry = (ctx, path) => (isObj(ctx.registry?.figures?.[path]) ? ctx.registry.figures[path] : {});

const evidenceText = e => [e.kind, e.path ?? '', e.at ?? '', e.line ?? '', e.quote ?? ''].join(':');
const tidyEvidence = e => {
  const o = { kind: e.kind };
  if (e.path != null && e.path !== '') o.path = e.path;
  if (Number.isFinite(e.at)) o.at = e.at;
  if (e.quote != null && e.quote !== '') o.quote = clip(e.quote, 200);
  if (Number.isFinite(e.line)) o.line = e.line;
  return o;
};

/**
 * Adds one finding. `f` = { rule, subject, severity, text, evidence, members?, action, generatable, reason?, surfaces?, extra? }.
 * The key, kind, stamp, evidence limit and routing are set here, so no rule can forget one.
 */
function add(ctx, f) {
  const evidence = arr(f.evidence).map(tidyEvidence).slice(0, EVIDENCE_MAX);
  const members = f.members ? f.members.slice(0, LOCAL.MAX_MEMBERS) : undefined;
  const paths = uniq([...evidence.map(e => e.path), ...arr(members).filter(m => ctx.byPath.has(m)), ctx.byPath.has(f.subject) ? f.subject : null].filter(Boolean)).sort(byText);
  // f.stampBy 'evidence': the evidence alone decides (a rule that reads what it needs into the evidence, such as a PNG's pixel width), so a
  // rebuild that rewrites the same file does not lapse a decision on it
  const stamp = sha256([f.rule, paths.map(p => (f.stampBy === 'evidence' ? p : `${p}|${ctx.stampOf(p)}`)).join(';'), evidence.map(evidenceText).join('|'), arr(members).join('|'), f.text].join('\u0001')).slice(0, 12);
  const surfaces = f.surfaces || (f.severity === 'info' ? ['outputs', 'mcp'] : ['overview', 'outputs', 'assistant', 'mcp']);
  const finding = {
    key: `${f.rule}:${f.subject}`, rule: f.rule, kind: RULES[f.rule] ?? COVERAGE_RULES[f.rule] ?? DRIFT_RULES[f.rule], severity: f.severity, subject: String(f.subject),
    text: fit(f.text), evidence, ...(members ? { members } : {}), stamp,
    action: arr(f.action), generatable: f.generatable || 'no', ...(f.reason ? { reason: fit(f.reason, 120) } : {}), surfaces, decision: null,
    ...(f.extra || {}),
  };
  ctx.out.push(finding);
  return finding;
}

// ---- notices (a scan that stopped, dates that cannot be trusted, no folder) ---------------

function noticeFindings(ctx) {
  const { facts } = ctx;
  if (facts.hasFolder === false) add(ctx, { rule: 'X2', subject: 'no-folder', severity: 'info', text: 'Folder checks need a project folder', evidence: [], action: [], generatable: 'no' });
  for (const n of arr(facts.notices)) add(ctx, { rule: 'X1', subject: String(n.id), severity: 'info', text: n.text, evidence: [], action: n.id === 'scan' ? ['open-folder'] : [], generatable: 'no' });
  const reg = facts.sidecars?.registry;
  if (reg && reg.notice && facts.hasFolder !== false) add(ctx, { rule: 'X3', subject: 'registry', severity: 'info', text: reg.notice, evidence: [], action: [], generatable: 'no' });
  registryPathsNotFound(ctx);
}

/** Plan §4.15c.3: a registry path that is gone (and was not succeeded by a newer version) is one information line, never a figure finding. */
function registryPathsNotFound(ctx) {
  if (ctx.facts.hasFolder === false || !ctx.files.length) return;
  const gone = new Set();
  for (const p of arr(ctx.registry?.producers)) {
    for (const path of [p.script, ...arr(p.imports), ...arr(p.outputs).filter(o => !/[*?]/.test(o))]) if (path && !ctx.byPath.has(path)) gone.add(path);
    for (const i of arr(p.inputs)) if (i.path && i.resolved && !ctx.byPath.has(i.path) && !successorOf(ctx, i.path)) gone.add(i.path);
  }
  if (gone.size) add(ctx, { rule: 'X3', subject: 'registry-paths', severity: 'info', text: plural(gone.size, 'registry path') + ' not found', evidence: [...gone].sort(byText).slice(0, 3).map(path => ({ kind: 'registry', path })), members: [...gone].sort(byText), action: ['open-folder'], generatable: 'no' });
}

// ---- source of record (W1) and the document the checks read ---------------------------------

// Words of a file name (not substrings: "Recovery" holds "cover", "Discovery" holds "cover", "subtitle" holds "title").
const NOT_MANUSCRIPT_WORDS = new Set(['title', 'cover', 'response', 'responses', 'supplement', 'supplementary', 'supplemental', 'checklist', 'reviewer', 'reviewers', 'comments', 'letter', 'section', 'sections', 'chapter', 'appendix']);
const isManuscriptName = path => !words(baseOf(path)).some(w => NOT_MANUSCRIPT_WORDS.has(w));
const legendCount = d => arr(d?.legends).filter(l => l.kind === 'figure' || l.kind === 'supp-figure').length;
const hasFigureLegend = d => legendCount(d) > 0;
/** The highest "v<n>" in a path ("Systematic review v2 IJSS/..._v1.docx" is 2); null when none. */
const pathVersion = path => { const ns = [...path.matchAll(/(?:^|[^a-z0-9])v0*(\d+)(?![a-z0-9])/gi)].map(m => Number(m[1])); return ns.length ? Math.max(...ns) : null; };

/** The imported file the app's manuscript came from: the applied path whose name is the manuscript's, the latest import first. */
function appManuscriptPath(ctx) {
  const name = str(ctx.state.manuscript?.name);
  if (!name) return null;
  const hits = Object.entries(isObj(ctx.state.applied) ? ctx.state.applied : {}).filter(([p]) => baseOf(p) === name).sort((a, b) => b[1] - a[1] || byText(a[0], b[0]));
  return hits[0]?.[0] ?? null;
}

/**
 * The Word files a newer manuscript could be, by structure and then by date: manuscript role, live, a file name that is not
 * a title page, cover letter, response, supplement, checklist, reviewer file or section file (whole words), holding a figure
 * legend, and not a lower version than another candidate. A file holding fewer than LOCAL.CANDIDATE_LEGEND_SHARE of the
 * imported file's figure legends is a fragment and ranks after every complete one; then newest usable date first, then
 * more legends. A file whose date is unusable is kept (`ms` null) and sorts last among its kind.
 */
function manuscriptCandidates(ctx, appDoc) {
  const floor = appDoc ? Math.ceil(legendCount(appDoc) * LOCAL.CANDIDATE_LEGEND_SHARE) : 1;
  const all = ctx.live.filter(r => r.ext === 'docx' && isManuscriptName(r.path))
    .map(r => ({ row: r, doc: ctx.docs.find(d => d.path === r.path), ms: ctx.ms(r) })).filter(c => c.doc?.role === 'manuscript' && hasFigureLegend(c.doc))
    .map(c => ({ ...c, complete: legendCount(c.doc) >= floor }));
  const top = Math.max(0, ...all.map(c => pathVersion(c.row.path) ?? 0));
  return all.filter(c => (pathVersion(c.row.path) ?? top) >= top)
    .sort((a, b) => Number(b.complete) - Number(a.complete) || (b.ms ?? -1) - (a.ms ?? -1) || legendCount(b.doc) - legendCount(a.doc) || byText(a.row.path, b.row.path));
}

/**
 * Which document M and U rules read (plan §4.15c.6, W1): the registry's choice, else the newer file W1 reports (and the
 * findings built on it say so), else the file the app's manuscript was imported from, else the newest candidate.
 * When dates cannot decide (date checks off, or a candidate's date unusable) a candidate with more figure legends than the
 * imported file is read and an information row names it. Sets `ctx.source = { doc, path, via, from, appPath }` and reports W1.
 */
function sourceOfRecord(ctx) {
  const chosen = str(ctx.registry?.manuscript?.path);
  const appPath = appManuscriptPath(ctx);
  const appDoc = appPath ? ctx.docs.find(d => d.path === appPath) || null : null;
  const cands = manuscriptCandidates(ctx, appDoc);
  const importAt = appPath ? ctx.state.applied[appPath] : null;
  const newest = Number.isFinite(importAt) ? cands.find(c => c.row.path !== appPath && c.ms != null && c.ms > importAt) || null : null;
  let source = null;
  const others = list => list.filter(c => c.row.path !== appPath).map(c => c.row.path);
  if (chosen) source = { doc: ctx.docs.find(d => d.path === chosen) || null, path: chosen, via: 'registry', from: false };
  else if (ctx.timeOn && newest && appPath) {
    source = { doc: newest.doc, path: newest.row.path, via: 'newer', from: true };
    const rest = others(cands).filter(p => p !== newest.row.path);
    add(ctx, {
      rule: 'W1', subject: 'ms', severity: 'gap', text: 'A newer manuscript file exists',
      evidence: [{ kind: 'time', path: newest.row.path, at: newest.ms, quote: 'newer than the imported file' }, { kind: 'import', path: appPath, at: importAt, quote: 'imported' },
        ...rest.slice(0, 2).map(path => ({ kind: 'candidate', path, quote: 'also holds figure legends' }))],
      members: [newest.row.path, ...rest], action: ['use-file'], generatable: 'no',
      reason: `Figure checks read ${baseOf(newest.row.path)} until you choose a file${rest.length ? `; ${plural(rest.length, 'other file')} hold${rest.length > 1 ? '' : 's'} figure legends` : ''}`,
    });
  } else {
    // dates cannot decide: a candidate with more figure legends than the imported file is the longer manuscript
    const undecided = !ctx.timeOn || cands.some(c => c.ms == null);
    const longer = undecided ? others(cands).map(p => cands.find(c => c.row.path === p)).filter(c => c && (!appDoc || legendCount(c.doc) > legendCount(appDoc)))
      .sort((a, b) => legendCount(b.doc) - legendCount(a.doc) || (pathVersion(b.row.path) ?? 0) - (pathVersion(a.row.path) ?? 0) || byText(a.row.path, b.row.path))[0] : null;
    if (longer) {
      source = { doc: longer.doc, path: longer.row.path, via: 'structure', from: true };
      add(ctx, {
        rule: 'W1', subject: 'ms-structure', severity: 'info', text: `Figure checks read ${baseOf(longer.row.path)}; its date cannot be used`,
        evidence: [{ kind: 'candidate', path: longer.row.path, quote: `${legendCount(longer.doc)} figure legends` }, ...(appDoc ? [{ kind: 'import', path: appPath, quote: `${legendCount(appDoc)} figure legends` }] : [])],
        members: [longer.row.path], action: ['use-file'], generatable: 'no', reason: 'Dates in this folder cannot say which manuscript is newer',
      });
    } else if (appDoc) source = { doc: appDoc, path: appPath, via: 'app', from: false };
    else if (cands[0]) source = { doc: cands[0].doc, path: cands[0].row.path, via: 'newest', from: false };
    else {
      // no manuscript holds a figure legend: the newest manuscript-role Word file is still the document the checks read
      const any = ctx.live.filter(r => r.ext === 'docx' && isManuscriptName(r.path) && ctx.docs.some(d => d.path === r.path && d.role === 'manuscript'))
        .sort((a, b) => (ctx.ms(b) ?? 0) - (ctx.ms(a) ?? 0) || byText(a.path, b.path))[0];
      if (any) source = { doc: ctx.docs.find(d => d.path === any.path), path: any.path, via: 'newest', from: false };
    }
  }
  ctx.source = { appPath, ...(source || { doc: null, path: null, via: null, from: false }) };
}

// ---- missing: M1 cited without an image, M2 placeholder legend, M3 result without a figure ----------

const FIGURE_NAME = /^Figure(?:[_ -]?S)?0*\d+/i;

/** The figure folder(s) of a document: directories at or under its own that hold figure-named files. `trusted` when 80 % of each folder follows the naming. */
function figureFolders(ctx, docPath) {
  const dir = dirOf(docPath);
  const byDir = new Map();
  for (const r of ctx.live) {
    if (!underDir(r.path, dir) || r.path === docPath) continue;
    const d = dirOf(r.path);
    byDir.set(d, [...(byDir.get(d) || []), r]);
  }
  const folders = [...byDir].filter(([, rows]) => rows.some(r => FIGURE_NAME.test(baseOf(r.path)) && IMAGE_EXT.has(r.ext)));
  if (!folders.length) return null;
  const trusted = folders.every(([, rows]) => rows.filter(r => FIGURE_NAME.test(baseOf(r.path))).length / rows.length >= LOCAL.FOLDER_PATTERN_SHARE);
  return { dirs: folders.map(([d]) => d).sort(byText), rows: folders.flatMap(([, rows]) => rows), trusted };
}

const figureFilePattern = (kind, n) => (kind === 'supp-figure' ? new RegExp(`^(?:Figure[_ -]?)?S0*${n}(?!\\d)`, 'i') : new RegExp(`^Figure[_ -]?0*${n}(?!\\d)`, 'i'));

/** "Figures/ holds Figure1-8 and 10": the figure numbers a folder holds, as a short text. */
function folderSummary(rows, kind) {
  const ns = uniq(rows.map(r => labelOfFile(r.path)).filter(l => l && (kind === 'supp-figure') === /^Figure S/.test(l)).map(l => Number(l.replace(/\D/g, '')))).sort((a, b) => a - b);
  const runs = [];
  for (const n of ns) { const last = runs.at(-1); if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]); }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}

const LABEL_PARTS = /^Figure (S?)(\d+)$/;
const kindOfLabel = label => (LABEL_PARTS.exec(label)?.[1] ? 'supp-figure' : 'figure');

function missingFindings(ctx) {
  const { source } = ctx;
  const doc = source.doc;
  const seen = new Map();   // label -> { cited, legend, placeholder, from }
  const note = (label, patch) => seen.set(label, { cited: false, legend: false, ...(seen.get(label) || {}), ...patch });
  if (doc) {
    for (const m of arr(doc.mentions)) if (m.kind === 'figure' || m.kind === 'supp-figure') note(m.label, { cited: true, mention: seen.get(m.label)?.mention || m });
    for (const l of arr(doc.legends)) note(l.label, { legend: true, fragment: l.fragment });
  }
  const folders = doc ? figureFolders(ctx, doc.path) : null;
  const missing = new Map();   // label -> reason it has no image
  if (doc && folders?.trusted) {
    for (const [label] of seen) {
      const m = LABEL_PARTS.exec(label);
      if (!m) continue;
      // a supplement figure is judged only where the folder holds supplement figures: those usually live beside the supplement
      if (m[1] && !seen.get(label)?.legend && !folders.rows.some(r => /^Figure[_ -]?S\d/i.test(baseOf(r.path)))) continue;
      const re = figureFilePattern(m[1] ? 'supp-figure' : 'figure', Number(m[2]));
      if (!folders.rows.some(r => re.test(baseOf(r.path)))) (missing.get(label) || missing.set(label, new Set()).get(label)).add('folder');
    }
  }
  // The app's manuscript: assetOrderCheck's `missing` findings (a figure cited that is not in the list).
  // The app's blocks are read only when they are the document the checks read: no file, or the file they were imported from.
  const app = !doc || source.via === 'app' ? ctx.state.manuscript : null;
  const appPlaceholders = new Map();
  if (app) {
    for (const label of arr(app.missing)) if (LABEL_PARTS.test(label)) { note(label, { cited: true, app: true }); (missing.get(label) || missing.set(label, new Set()).get(label)).add('app'); }
    for (const p of arr(app.placeholders)) if (p.kind === 'figure' || p.kind === 'supp-figure') appPlaceholders.set(p.label, p);
  }
  for (const [label, reasons] of [...missing].sort((a, b) => byText(a[0], b[0]))) {
    const s = seen.get(label) || {};
    const place = arr(doc?.placeholders).find(p => p.label === label) || appPlaceholders.get(label) || null;
    const clinical = CLINICAL_RE.test(`${s.fragment || ''} ${place?.bracket || ''}`);
    const external = !!place || clinical;
    const evidence = [];
    if (s.cited && doc && s.mention) evidence.push({ kind: 'cited', path: doc.path, at: s.mention.at, quote: label });
    if (reasons.has('app')) evidence.push({ kind: 'state', quote: `${label} is not in the app's figure list` });
    if (s.legend && doc) evidence.push({ kind: 'legend', path: doc.path, quote: s.fragment || label });
    if (place) evidence.push({ kind: 'placeholder', path: doc?.path, quote: place.bracket });
    if (reasons.has('folder') && folders) evidence.push({ kind: 'folder', path: folders.dirs[0], quote: `holds ${folderSummary(folders.rows, kindOfLabel(label)) || 'no numbered figure'}` });
    ctx.m1.add(label);
    add(ctx, {
      rule: 'M1', subject: labelKey(label), severity: s.cited ? 'block' : 'gap',
      text: s.cited ? `${label} is cited but has no image` : `${label} has a legend but no image`,
      evidence, action: ['add-task'], generatable: external ? 'external' : 'blocked',
      reason: external ? (place ? 'The legend is a placeholder; the image is supplied' : 'The legend names a clinical image; it is supplied') : 'No analysis supplies this figure',
      extra: { label, ...(source.from ? { from: source.path } : {}) },
    });
  }
  // M2: legends that are placeholders, one finding per document, minus the numbers M1 reports.
  const phs = [...arr(doc?.placeholders), ...arr(app?.placeholders).filter(p => !arr(doc?.placeholders).some(q => q.label === p.label))];
  const path = doc?.path || '';
  const labels = uniq(phs.filter(p => p.kind === 'figure' || p.kind === 'supp-figure').map(p => p.label)).filter(l => !ctx.m1.has(l));
  if (labels.length) {
    const bracket = phs.find(p => p.label === labels[0])?.bracket;
    add(ctx, {
      rule: 'M2', subject: path || 'manuscript', severity: 'gap',
      text: labels.length === 1 ? `The legend of ${labels[0]} is a placeholder` : `Legends of ${listLabels(labels)} are placeholders`,
      evidence: [{ kind: 'placeholder', path: path || undefined, quote: bracket }, ...labels.slice(0, 3).map(l => ({ kind: 'legend', path: path || undefined, quote: l }))],
      members: labels, action: ['add-task'], generatable: 'no', extra: source.from ? { from: source.path } : {},
    });
  }
}

/** True when `a` already has a figure of its own or a Lykos producer for it. */
function coveredByLykos(ctx, a) {
  if (a.svg || arr(a.figures).length) return true;
  return ctx.producers.some(p => p.kind === 'lykos' && (String(p.id).endsWith(`:${a.id}`) || String(p.id) === a.id || arr(p.inputs).some(i => i.state && String(i.state).includes(a.id))));
}

function resultFindings(ctx) {
  const seen = new Set();
  const uniqueAnalyses = arr(ctx.state.analyses).filter(a => { const k = `${a.source}|${a.title}|${a.measure}|${a.k}|${a.at}`; if (seen.has(k)) return false; seen.add(k); return true; });
  for (const a of uniqueAnalyses) {
    if (a.unused) continue;   // a pooled result nothing in the paper uses asks for no figure or funnel plot (lib/paper-use-graph.mjs)
    if (a.status === 'current' && Number.isFinite(a.k) && a.k >= ctx.P.K_FIG && !coveredByLykos(ctx, a)) {
      add(ctx, {
        rule: 'M3', subject: a.id, severity: 'gap', text: `${clip(a.title || a.id, 40)} (k = ${a.k}) has no figure`,
        evidence: [{ kind: 'state', quote: `${a.source} result, k = ${a.k}, current` }], action: ['propose'], generatable: 'yes',
        extra: { analysis: a.id },
      });
    }
    if (a.status === 'current' && Number.isFinite(a.k) && a.k >= ctx.P.K_FUNNEL && !a.funnel && !ctx.producers.some(p => p.kind === 'lykos' && /funnel/i.test(`${p.id} ${p.label}`) && String(p.id).includes(a.id))) {
      add(ctx, {
        rule: 'M3', subject: `${a.id}:funnel`, severity: 'info', text: `${clip(a.title || a.id, 40)} (k = ${a.k}) has no funnel plot`,
        evidence: [{ kind: 'state', quote: `${a.source} result, k = ${a.k}` }], action: ['propose'], generatable: 'yes', extra: { analysis: a.id },
      });
    }
  }
  const pr = ctx.state.prisma;
  if (pr && pr.total > 0 && pr.filled / pr.total >= LOCAL.PRISMA_SHARE) {
    const has = ctx.live.some(r => r.role === 'prisma-flow' && FIGURE_EXT.has(r.ext)) || arr(ctx.state.outputs).some(o => /prisma/i.test(o.kind)) || arr(ctx.state.manuscript?.assets).some(a => /prisma/i.test(`${a.kind} ${a.name}`));
    if (!has) add(ctx, { rule: 'M3', subject: 'prisma', severity: 'gap', text: 'PRISMA counts are filled; no flow diagram exists', evidence: [{ kind: 'state', quote: `${pr.filled} of ${pr.total} counts filled` }], action: ['propose'], generatable: 'yes' });
  }
}

// ---- stale: T1 to T5 -----------------------------------------------------------------------

const TABLE_ROLES = new Set(['evidence-table', 'table-doc']);
// Files that are not outputs of the project: literature (a study PDF, an excluded or superseded one), a lock file, the guide, a copy.
const NOT_OUTPUT_ROLES = new Set(['study-pdf', 'excluded-pdf', 'related-pdf', 'paper-pdf', 'lock-file', 'app-state', 'guide', 'copy']);

/** The stem of a file without its version token and page mark, lower case: the family its versions share. */
const familyOf = path => parseVersionFull(baseOf(path)).stem.replace(/_p\d+$/i, '').toLowerCase().replace(/[\s._-]+/g, ' ').trim();
const versionOf = path => parseVersionFull(baseOf(path)).version;

/** The newest version of the table set (evidence table and Word tables), where it lives, and when each version was written. */
function tableSet(ctx) {
  const rows = ctx.live.filter(r => TABLE_ROLES.has(r.role) && versionOf(r.path) > 0);
  if (!rows.length) return null;
  const T = Math.max(...rows.map(r => versionOf(r.path)));
  const top = rows.filter(r => versionOf(r.path) === T);
  const newest = [...top].sort((a, b) => (ctx.ms(b) ?? 0) - (ctx.ms(a) ?? 0) || byText(a.path, b.path))[0];
  return { T, dirs: uniq(top.map(r => dirOf(r.path))).sort(byText), rows, top, newest, at: version => { const at = rows.filter(r => versionOf(r.path) === version).map(r => ctx.ms(r)).filter(x => x != null); return at.length ? Math.max(...at) : null; } };
}

/** What changed an input that no longer exists: a present file of the same family with a higher version (or the same name under a newer v<n> folder). */
function successorOf(ctx, path) {
  const v = versionOf(path), fam = familyOf(path), ext = extOf(path), name = baseOf(path);
  const dirV = p => Math.max(0, ...[...dirOf(p).matchAll(/(?:^|\/)v(\d+)(?=\/|$)/gi)].map(m => Number(m[1])));
  const hits = ctx.live.filter(r => r.ext === ext && ((familyOf(r.path) === fam && versionOf(r.path) > v) || (baseOf(r.path) === name && dirV(r.path) > dirV(path))));
  return hits.sort((a, b) => versionOf(b.path) - versionOf(a.path) || (ctx.ms(b) ?? 0) - (ctx.ms(a) ?? 0) || byText(a.path, b.path))[0] || null;
}

/** The words of a stem for whole-word matching: lower case, version and page marks removed, no plural stemming. */
const stemWords = path => uniq(words(stemOf(path).replace(/_p\d+$/i, '')).filter(t => t.length >= 3 && !isCode(t)));

/** The multi-word entries of a bracketed list in a declaration ("(supplement, atlas, hybrid evidence)": [["hybrid", "evidence"]]); all their words must be in a stem. */
function listedPhrases(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/\(([^()]{3,})\)/g)) {
    for (const part of m[1].split(/,|;|\band\b/i)) {
      const ws = words(part).filter(w => w.length >= 3 && !FUNCTION_SET.has(w) || DECLARATION_STOP_WORDS.includes(w) && w.length >= 3);
      if (ws.length >= 2) out.push(uniq(ws));
    }
  }
  return out;
}

/**
 * For each declaration of the guide, the files it binds to (plan §4.15c.6, `declared`). A declaration binds only to files of the
 * extension class of its noun ("PDF reports": .pdf and the page images of the same stem family) and needs a whole word of
 * its own, outside the stop words, in the file stem or its immediate directory. A stem word counts when it is distinctive
 * (few families of the class carry it: "Spine" in every report name identifies none); a directory word does not count when
 * more than a third of the files share it. A scope clause ("after Round 13") is honoured. Path -> [{ d, matched }], strongest first.
 */
function declaredBindings(ctx, ts) {
  const bound = new Map();
  const decls = arr(ctx.guide?.declarations);
  if (!decls.length) return bound;
  const pool = ctx.live.filter(r => !NOT_OUTPUT_ROLES.has(r.role));
  for (const d of decls) {
    if (!d.ext) continue;                                              // no file class named: nothing to bind to
    const exts = new Set(arr(d.ext).map(e => String(e).replace(/^\./, '')));
    const isPage = r => IMAGE_EXT.has(r.ext) && /_p\d+$/i.test(stemOf(r.path));
    const cands = pool.filter(r => exts.has(r.ext) || (d.pages && isPage(r)));
    if (!cands.length) continue;
    // A word is counted once per family of files (the pages of one atlas are one family).
    const families = new Map(cands.map(r => [r.path, familyOf(r.path)]));
    const nFamilies = new Set(families.values()).size;
    const stemDf = new Map();
    for (const fam of new Set(families.values())) {
      const toks = new Set();
      for (const r of cands) if (families.get(r.path) === fam) for (const t of stemWords(r.path)) toks.add(t);
      for (const t of toks) stemDf.set(t, (stemDf.get(t) || 0) + 1);
    }
    const dirWords = new Map(cands.map(r => [r.path, new Set(words(baseOf(dirOf(r.path))).filter(t => t.length >= 3 && !DECLARATION_STOP_WORDS.includes(t)))]));
    const dirDf = new Map();
    for (const set of dirWords.values()) for (const t of set) dirDf.set(t, (dirDf.get(t) || 0) + 1);
    const distinctive = t => (stemDf.get(t) || 0) <= Math.max(LOCAL.DECL_DISTINCT_MIN, Math.ceil(nFamilies * LOCAL.DECL_DISTINCT_SHARE));
    const sharedDir = t => cands.length >= ctx.P.GROUP_MIN && (dirDf.get(t) || 0) > cands.length * LOCAL.GENERIC_SHARE;
    const tokens = uniq(arr(d.tokens));
    const phrases = listedPhrases(d.text);
    const after = /\b(?:after|since)\s+(?:round|revision|version|v)\s*(\d+)/i.exec(d.scope || '');
    const refAt = after && ts ? ts.at(Number(after[1])) : null;
    for (const r of cands) {
      const sw = new Set(stemWords(r.path));
      const matched = tokens.filter(t => (sw.has(t) && distinctive(t)) || (dirWords.get(r.path).has(t) && !sharedDir(t)));
      if (phrases.some(ph => ph.every(w => sw.has(w)))) matched.push(...phrases.filter(ph => ph.every(w => sw.has(w))).map(ph => ph.join(' ')));
      if (!matched.length) continue;
      if (after && refAt != null && ctx.timeOn && ctx.ms(r) != null && ctx.ms(r) > refAt + ctx.P.NEWER_S * 1000) continue;   // rebuilt after the round the sentence names: no longer behind
      bound.set(r.path, [...(bound.get(r.path) || []), { d, matched: matched.length }]);
    }
  }
  for (const list of bound.values()) list.sort((a, b) => b.matched - a.matched || a.d.line - b.d.line);
  return bound;
}

const sameStamps = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The newest reference an output's input hashes can be compared with: the baseline the user marked, or the observation of its last rebuild. */
function hashReference(ctx, producer, regProducer, path, row) {
  const refs = [];
  if (regProducer?.baseline) {
    const b = baselineFor(ctx.registry, regProducer.id, { output: path, stamp: row.stamp });
    if (b?.current) refs.push({ at: Date.parse(b.at), hashes: b.inputs, via: `marked ${b.basis}` });
  }
  const obs = ctx.facts.observations?.[path];
  if (obs && obs.observed === true && obs.stamp === row.stamp && isObj(obs.hashes)) refs.push({ at: Number(obs.at), hashes: obs.hashes, via: 'observed rebuild' });
  refs.sort((x, y) => (Number.isFinite(y.at) ? y.at : -Infinity) - (Number.isFinite(x.at) ? x.at : -Infinity));
  return refs[0] || null;
}

/** Everything that says one output is behind, by evidence kind: { time, declared, version, observed, hash }. */
function staleRecord(ctx, path, row, prods, ts, bindings, regById) {
  const kinds = {};
  const put = (kind, ev) => { (kinds[kind] ||= []).push(ev); };
  const tOut = ctx.ms(row), grace = ctx.P.NEWER_S * 1000;
  const noProducer = prods.length === 0;
  // time: an input or script newer than the output by more than NEWER_S (several signals count once)
  if (ctx.timeOn && tOut != null) {
    for (const p of prods) {
      for (const i of arr(p.inputs)) if (i.path && i.resolved && i.exists && ctx.clean(i.mtimeMs) != null && i.mtimeMs > tOut + grace) put('time', { kind: 'time', path: i.path, at: i.mtimeMs, quote: 'input newer than the figure' });
      for (const s of arr(p.scripts)) if (s.path && ctx.clean(s.mtimeMs) != null && s.mtimeMs > tOut + grace) put('time', { kind: 'time', path: s.path, at: s.mtimeMs, quote: 'script newer than the figure' });
    }
    // an output with no producer whose name already carries the table-set version (a rename without a rebuild) is compared with the newest table-set file of its naming family
    if (noProducer && ts && ts.newest && ts.dirs.some(d => underDir(path, d)) && versionOf(path) >= ts.T && words(stemOf(path))[0] === words(stemOf(ts.newest.path))[0] && ctx.ms(ts.newest) > tOut + grace) {
      put('time', { kind: 'time', path: ts.newest.path, at: ctx.ms(ts.newest), quote: 'newer table file' });
    }
  }
  // declared: the guide says so
  const bs = bindings.get(path);
  if (bs) for (const b of bs) put('declared', { kind: 'declared', path: ctx.guide.path, line: b.d.line, quote: b.d.text });
  // version: an older table version, or an input that was succeeded
  if (ts) {
    const pv = versionOf(path);
    if (pv > 0 && pv < ts.T && ts.dirs.some(d => underDir(path, d)) && !ctx.live.some(r => familyOf(r.path) === familyOf(path) && versionOf(r.path) === ts.T)) {
      put('version', { kind: 'version', path, quote: `v${pv}; the table set is v${ts.T}`, v: pv });
    }
  }
  for (const p of prods) {
    for (const i of arr(p.inputs)) {
      if (!i.path || !i.resolved || i.exists) continue;
      const succ = successorOf(ctx, i.path);
      if (succ) put('version', { kind: 'version', path: succ.path, quote: `${baseOf(i.path)} replaced by ${baseOf(succ.path)}`, succ: i.path });
    }
  }
  // observed: the output stamp is the one first seen while an input or script stamp changed since
  const obs = ctx.facts.observations?.[path];
  if (obs && obs.stamp === row.stamp) {
    for (const p of prods) {
      for (const i of arr(p.inputs)) if (i.path && i.resolved && i.exists && i.stamp && isObj(obs.inputs) && i.path in obs.inputs && obs.inputs[i.path] !== i.stamp) put('observed', { kind: 'observed', path: i.path, at: i.mtimeMs ?? undefined, quote: 'changed since first seen' });
      for (const s of arr(p.scripts)) if (s.path && s.stamp && isObj(obs.scripts) && s.path in obs.scripts && obs.scripts[s.path] !== s.stamp) put('observed', { kind: 'observed', path: s.path, at: s.mtimeMs ?? undefined, quote: 'changed since first seen' });
    }
  }
  // hash: a recorded baseline or an observed rebuild, still the output now, and an input fingerprint that differs
  for (const p of prods) {
    const reg = regById.get(p.id);
    if (!reg && ctx.facts.observations?.[path]?.observed !== true) continue;
    const ref = hashReference(ctx, p, reg, path, row);
    if (!ref) continue;
    for (const i of arr(p.inputs)) if (i.path && i.hash && typeof ref.hashes[i.path] === 'string' && ref.hashes[i.path] !== i.hash) put('hash', { kind: 'hash', path: i.path, quote: `content differs from the ${ref.via}` });
  }
  return kinds;
}

const KIND_RANK = ['hash', 'declared', 'version', 'time', 'observed'];
const distinctKinds = kinds => KIND_RANK.filter(k => kinds[k]?.length);

/** The cause members of one finding share: a changed input, a guide sentence, a table version. */
function causeOf(rec) {
  const k = rec.kinds;
  if (rec.rule === 'T1') return { id: `in-${slug(baseOf(k.hash[0].path))}`, text: uniq(k.hash.map(e => e.path)).sort(byText).join(',') };
  if (k.declared) { const line = [...k.declared].sort((a, b) => a.line - b.line)[0].line; return { id: `decl-${line}`, text: `decl:${line}` }; }
  if (k.version) { const s = k.version.find(e => e.succ); return s ? { id: `succ-${slug(baseOf(s.succ))}`, text: `succ:${s.succ}` } : { id: `ver-${k.version[0].v}`, text: `ver:${k.version[0].v}` }; }
  const sig = uniq([...(k.time || []), ...(k.observed || [])].map(e => e.path)).sort(byText);
  return { id: `in-${slug(baseOf(sig[0] || 'none'))}`, text: sig.join(',') };
}

function staleText(rec, n, name, ctx, ts) {
  const k = rec.kinds, many = n > 1;
  if (rec.rule === 'T1') return many ? `Input changed since the figures were built (${n} files)` : 'Input changed since the figure was built';
  name = short(name);
  if (k.declared) { const e = [...k.declared].sort((a, b) => a.line - b.line)[0]; const src = `${baseOf(e.path)}:${e.line}`; return many ? `${n} files are behind, per the guide (${src})` : `${name} is behind (${src})`; }
  if (k.version) { const s = k.version.find(e => e.succ); return s ? (many ? `${n} files use an input that was replaced` : `${name} uses an input that was replaced`) : (many ? `${n} files carry an older table version (set is v${ts?.T})` : `${name} is v${k.version[0].v}; the table set is v${ts?.T}`); }
  return many ? `${n} files are older than their inputs` : `${name} is older than its inputs`;
}

/** Guide commands (and a producer's recorded run) that rebuild a member, each with its source line. */
function commandsFor(ctx, members, prodsOf, regById) {
  const found = new Map(), without = [];
  for (const m of members) {
    let any = false;
    for (const p of prodsOf.get(m) || []) {
      const reg = regById.get(p.id);
      if (reg?.run?.text) { found.set(`run:${p.id}`, { text: reg.run.text, source: reg.run.source || `${p.id}`, line: null }); any = true; }
      const script = p.script || '';
      if (!script) continue;
      for (const c of arr(ctx.guide?.commands)) if (c.text.includes(baseOf(script)) || (dirOf(script) && c.text.includes(dirOf(script)))) { found.set(`g:${c.line}`, { text: c.text, source: `${baseOf(ctx.guide.path)}:${c.line}`, line: c.line }); any = true; }
    }
    if (!any) without.push(m);
  }
  return { commands: [...found.values()].slice(0, LOCAL.MAX_COMMANDS), without };
}

function staleFindings(ctx) {
  const ts = tableSet(ctx);
  const regById = new Map(arr(ctx.registry?.producers).map(p => [p.id, p]));
  const prodsOf = new Map();
  for (const p of ctx.producers) for (const o of arr(p.outputs)) prodsOf.set(o, [...(prodsOf.get(o) || []), p]);
  const bindings = declaredBindings(ctx, ts);
  const paths = uniq([...prodsOf.keys(), ...ctx.live.filter(r => FIGURE_EXT.has(r.ext) && !NOT_OUTPUT_ROLES.has(r.role)).map(r => r.path)]).filter(p => ctx.byPath.has(p)).sort(byText);
  const recs = [];
  for (const path of paths) {
    const row = ctx.byPath.get(path);
    if (!isLive(row)) continue;
    const kinds = staleRecord(ctx, path, row, prodsOf.get(path) || [], ts, bindings, regById);
    const n = distinctKinds(kinds).length;
    if (!n) continue;
    recs.push({ path, row, kinds, rule: kinds.hash ? 'T1' : n >= 2 ? 'T2' : 'T3' });
  }
  const groups = new Map();
  for (const r of recs) { r.cause = causeOf(r); const k = `${r.rule}|${r.cause.text}`; groups.set(k, [...(groups.get(k) || []), r]); }
  for (const list of groups.values()) {
    const grouped = list.length >= ctx.P.GROUP_MIN;
    const units = grouped ? [list] : list.map(r => [r]);
    for (const unit of units) {
      const first = unit[0], members = unit.map(r => r.path);
      const merged = {};
      for (const r of unit) for (const k of KIND_RANK) for (const e of r.kinds[k] || []) { const list2 = (merged[k] ||= []); if (!list2.some(x => evidenceText(x) === evidenceText(e))) list2.push(e); }
      const rec = { ...first, kinds: merged };
      const { commands, without } = commandsFor(ctx, members, prodsOf, regById);
      const evidence = KIND_RANK.flatMap(k => (merged[k] || []).slice(0, k === 'time' ? 2 : 1));
      const via = weakestOf(unit, prodsOf);
      add(ctx, {
        rule: first.rule, subject: grouped ? `group:${first.cause.id}` : first.path, severity: first.rule === 'T3' ? 'info' : 'gap',
        text: staleText(rec, members.length, baseOf(first.path), ctx, ts), evidence,
        members: grouped || members.length > 1 ? members : undefined, action: [...(commands.length ? ['rebuild'] : []), ...(first.rule === 'T3' ? [] : ['add-task']), 'mark-current'], generatable: 'no',
        reason: via && via !== 'declared' ? `Inputs ${via === 'inferred-write' ? 'inferred from the script that writes it' : 'inferred from script text'}` : undefined,
        extra: { commands, ...(without.length ? { noCommand: without } : {}), ...(via ? { via } : {}), kinds: distinctKinds(merged) },
      });
    }
  }
  appStale(ctx);
  newerTables(ctx);
}

/** The weakest `via` tag over the producers of a unit's members (declared is the strongest). */
function weakestOf(unit, prodsOf) {
  const order = ['declared', 'inferred-write', 'inferred-input', 'inferred-import'];
  let worst = -1;
  for (const r of unit) for (const p of prodsOf.get(r.path) || []) worst = Math.max(worst, order.indexOf(p.via));
  return worst < 0 ? null : order[worst];
}

/** T4: an app result whose own input status says it changed, for every analysis that owns a figure. Shown in the Outputs section only. */
function appStale(ctx) {
  for (const a of arr(ctx.state.analyses)) {
    if (a.status !== 'stale' || !(a.svg || a.funnel || arr(a.figures).length)) continue;
    add(ctx, {
      rule: 'T4', subject: a.id, severity: 'block', text: `Inputs changed since ${clip(a.title || a.id, 40)} was run`,
      evidence: [{ kind: 'state', quote: `${a.source} result: input status changed` }], action: ['run-again'], generatable: 'no', surfaces: ['outputs', 'assistant', 'mcp'],
      extra: { analysis: a.id },
    });
  }
}

/** T5: a table the app imported (or cites) is gone and a newer version of it is present. */
function newerTables(ctx) {
  const applied = isObj(ctx.state.applied) ? ctx.state.applied : {};
  const known = uniq([...arr(ctx.state.valuePaths), ...Object.keys(applied)]).sort(byText);
  for (const p of known) {
    if (ctx.byPath.has(p) || !ctx.facts.hasFolder) continue;
    const succ = successorOf(ctx, p);
    if (!succ) continue;
    if (Number.isFinite(applied[p]) && ctx.ms(succ) != null && ctx.ms(succ) <= applied[p]) continue;
    add(ctx, {
      rule: 'T5', subject: slug(p), severity: 'info', text: `${short(baseOf(p))} no longer exists; v${versionOf(succ.path) || '?'} is present`,
      evidence: [{ kind: 'version', path: succ.path, quote: `${baseOf(succ.path)} is present` }, { kind: 'import', path: p, quote: 'imported or cited by the project' }],
      members: [succ.path], action: ['open-folder'], generatable: 'no', reason: 'No analysis input is checked against the newer table',
    });
  }
}

// ---- requested: R1 reviewer or editor, R2 task or note -----------------------------------------

/** Labels the documents the checks read cite or give a legend ("Figure 4", "Figure S12"). The manuscript is the source of record only. */
function referencedLabels(ctx) {
  const labels = new Set();
  const read = ctx.consumers.filter(d => (d.role !== 'manuscript' || d.path === ctx.source?.path) && (ctx.byPath.get(d.path) ? isLive(ctx.byPath.get(d.path)) : true));
  for (const d of read) { for (const m of arr(d.mentions)) labels.add(m.label); for (const l of arr(d.legends)) labels.add(l.label); }
  const app = ctx.state.manuscript;
  if (app && (!ctx.source?.doc || ctx.source.via === 'app')) { for (const m of arr(app.mentions)) labels.add(m.label); for (const l of arr(app.legends)) labels.add(l.label); }
  return { labels, read };
}

/** Figure files, one per stem and folder (a png wins over its svg), in the order of their paths. */
function figureFiles(ctx) {
  const by = new Map();
  for (const r of ctx.live) {
    if (!IMAGE_EXT.has(r.ext) || NOT_OUTPUT_ROLES.has(r.role)) continue;
    const k = `${dirOf(r.path)}\u0000${stemOf(r.path)}`;
    const had = by.get(k);
    if (!had || (r.ext === 'png' && had.ext !== 'png')) by.set(k, r);
  }
  return [...by.values()].sort((a, b) => byText(a.path, b.path));
}

const pointMatches = (link, r) => !!link && [r.key, r.point, r.round && r.point ? `${r.round}.${r.point}` : null].filter(Boolean).includes(link.reviewPoint);

function requestFindings(ctx) {
  const { P } = ctx;
  const reqs = new Map();
  for (const r of arr(ctx.facts.requests)) reqs.set(r.key, { ...r });
  for (const round of arr(ctx.state.reviewRounds)) for (const pt of arr(round.points)) for (const r of arr(pt.requests)) {
    const had = reqs.get(r.key);
    if (had) { had.round ??= round.id; had.point ??= pt.id; continue; }
    reqs.set(r.key, { ...r, docs: [], round: round.id, point: pt.id });
  }
  if (!reqs.size) { taskFindings(ctx); return; }
  const { labels: refLabels } = referencedLabels(ctx);
  // the figures a request can match: files, Lykos outputs and results
  const pool = [];
  const docLegend = new Map(arr(ctx.source?.doc?.legends).map(l => [l.label, l.fragment]));
  for (const r of figureFiles(ctx)) {
    const e = figureEntry(ctx, r.path), label = labelOfFile(r.path);
    pool.push({
      kind: 'file', id: r.path, path: r.path, label,
      tokens: new Set([...nameTokens(stemOf(r.path)), ...nameTokens(`${e.label || ''} ${e.role || ''}`), ...(label && docLegend.has(label) ? contentTokens(docLegend.get(label)) : [])]),
      referenced: !!label && refLabels.has(label), placed: !!e.placement && e.placement !== 'none', link: e.link || null, decided: e.placement === 'none',
    });
  }
  for (const o of arr(ctx.state.outputs)) pool.push({ kind: 'output', id: `output:${o.id}`, tokens: new Set(nameTokens(`${o.title} ${o.kind}`)), figure: true });
  const seenA = new Set();
  for (const a of arr(ctx.state.analyses)) {
    const k = `${a.source}|${a.title}|${a.measure}|${a.k}|${a.at}`;
    if (seenA.has(k)) continue; seenA.add(k);
    pool.push({ kind: 'analysis', id: `analysis:${a.id}`, tokens: new Set(nameTokens(`${a.title} ${a.measure || ''}`)), figure: !!(a.svg || arr(a.figures).length), eligible: a.status === 'current' && Number.isFinite(a.k) && a.k >= P.K_FIG });
  }
  const N = pool.length, df = new Map();
  for (const c of pool) for (const t of c.tokens) df.set(t, (df.get(t) || 0) + 1);
  const kept = t => (df.get(t) || 0) > 0 && !(N >= P.GROUP_MIN && df.get(t) > N * LOCAL.GENERIC_SHARE);
  const distinct = t => kept(t) && df.get(t) <= Math.max(1, Math.ceil(N * LOCAL.DISTINCT_SHARE));
  const weight = t => Math.log(1 + N / df.get(t));
  /** A candidate matches when it shares a distinctive token and the weighted count of shared tokens reaches MATCH_TOKENS (a distinctive token counts twice). */
  const match = (q, c) => {
    const shared = q.filter(t => c.tokens.has(t) && kept(t)), dist = shared.filter(distinct);
    if (!dist.length || shared.length + dist.length < P.MATCH_TOKENS) return null;
    return { shared, dist, score: dist.reduce((s, t) => s + weight(t), 0) };
  };
  const filesByLabel = new Map();
  for (const c of pool) if (c.kind === 'file' && c.label) filesByLabel.set(c.label, [...(filesByLabel.get(c.label) || []), c]);
  for (const r of [...reqs.values()].sort((a, b) => byText(a.key, b.key))) {
    // a request that cites a figure M1 reports is that figure's finding
    if (literalMentions(r.quote || '').some(m => ctx.m1.has(`Figure ${m.kind === 'supp-figure' ? 'S' : ''}${m.n}`) && (m.kind === 'figure' || m.kind === 'supp-figure'))) continue;
    const q = uniq([...arr(r.tokens).map(norm), ...contentTokens(r.quote || ''), ...arr(r.answerTokens).map(norm)]);
    const hits = pool.map(c => ({ c, m: match(q, c) })).filter(x => x.m);
    const fileHits = hits.filter(x => x.c.kind === 'file');
    const unlinked = fileHits.filter(x => !x.c.referenced && !x.c.placed && !x.c.link && !x.c.decided);
    const linked = fileHits.some(x => x.c.link && pointMatches(x.c.link, r));
    const cited = arr(r.answerLabels).flatMap(l => filesByLabel.get(l) || []);
    const citedScore = Math.max(0, ...cited.map(c => match(q, c)?.score || 0));
    const topUnlinked = Math.max(0, ...unlinked.map(x => x.m.score));
    const lykos = hits.filter(x => x.c.kind !== 'file' && x.c.figure);
    const evidence = [{ kind: 'request', path: arr(r.docs)[0], quote: r.quote }];
    let state;
    if (linked) state = 'closed';
    else if (unlinked.length && (r.declined || topUnlinked > citedScore)) state = 'conflict';
    else if (citedScore > 0 || fileHits.some(x => x.c.referenced || x.c.placed) || lykos.length) state = 'closed';
    else state = 'open';
    if (state === 'closed') continue;
    if (state === 'conflict') {
      // the matches reported are those near the best one: a long answer shares a weaker word with many files
      unlinked.sort((a, b) => b.m.score - a.m.score || byText(a.c.path, b.c.path));
      const top = unlinked.filter(x => x.m.score >= unlinked[0].m.score * LOCAL.MATCH_TOP_SHARE);
      for (const x of top.slice(0, 3)) evidence.push({ kind: 'candidate', path: x.c.path, quote: `shares ${x.m.dist.join(', ')}` });
      if (r.declined) evidence.push({ kind: 'response', path: arr(r.docs)[0], quote: 'the response declines' });
      else if (arr(r.answerLabels).length) evidence.push({ kind: 'response', path: arr(r.docs)[0], quote: `the response cites ${arr(r.answerLabels).join(', ')}` });
      add(ctx, {
        rule: 'R1', subject: r.key, severity: 'gap', text: top.length > 1 ? `A requested figure may exist: ${top.length} unlinked matches` : 'A requested figure may exist: 1 unlinked match',
        evidence, members: top.map(x => x.c.path), action: ['link', 'add-task'], generatable: 'no', extra: { state: 'conflict', conflict: true },
      });
    } else {
      const lyk = hits.filter(x => x.c.kind === 'analysis' && !x.c.figure && x.c.eligible);
      add(ctx, {
        rule: 'R1', subject: r.key, severity: 'gap',
        // when no answer was read, only the request's own words were compared: the text does not claim more than that
        text: r.answered === false ? 'A figure is requested; none matches its wording' : 'A figure is requested; no existing figure matches',
        evidence, action: lyk.length ? ['propose', 'add-task'] : ['add-task'], generatable: lyk.length ? 'yes' : 'blocked',
        reason: lyk.length ? 'A current result matches the request' : r.answered === false ? 'No answer to this request was read' : 'No result matches the request', extra: { state: 'open' },
      });
    }
  }
  taskFindings(ctx);
}

// A to-do asks for a figure when its verb draws one: the noun is the verb's object ("Make a forest plot of ...", "Add a new
// funnel plot"), or the verb is "plot". "Make sure Figure 3 is cited" and "Add legend to figure 6" are about an existing one.
const TASK_ASK = /^\s*(?:please\s+)?(?:(?:make|draw|create|add|build|generate)\s+(?:(?:a|an|the|new|another|one|more|extra|additional)\s+)+(?:[\w-]+\s+){0,3}?(?:plot|figure|graph|chart|diagram)s?\b|plot\b)/i;
const TASK_NOT = /\b(?:legends?|captions?|numbers?|references?|cited?|citations?|notes?|labels?|titles?|shorter|longer|larger|smaller|wider|bigger|colou?rs?|fonts?)\b/i;
const TASK_SKIP_SOURCE = /agents\.md|folder setup/i;

function taskFindings(ctx) {
  for (const t of arr(ctx.state.tasks)) {
    if (TASK_SKIP_SOURCE.test(str(t.source)) || !TASK_ASK.test(str(t.quote)) || TASK_NOT.test(str(t.quote))) continue;
    add(ctx, {
      rule: 'R2', subject: `${t.from || 'task'}-${t.id || slug(t.quote).slice(0, 24)}`, severity: 'gap', text: `${t.from === 'note' ? 'Note' : 'Task'} asks for a figure: ${t.quote}`,
      evidence: [{ kind: 'task', quote: t.quote }], action: ['open-task'], generatable: 'no',
      // not on the Overview or in the assistant until the grammar's precision has been measured on real to-dos
      surfaces: ['outputs', 'mcp'],
    });
  }
}

// ---- unlinked: U1 --------------------------------------------------------------------------

/** "S1-S12" for names that share a letter prefix and run in numbers; null otherwise. */
function rangeLabel(paths) {
  const parts = paths.map(p => /^([A-Za-z]+)0*(\d+)[a-z]?$/.exec(stemOf(p)));
  if (parts.some(m => !m) || new Set(parts.map(m => m[1])).size !== 1) return null;
  const ns = parts.map(m => Number(m[2]));
  return `${parts[0][1]}${Math.min(...ns)}-${parts[0][1]}${Math.max(...ns)}`;
}

function unlinkedFindings(ctx) {
  const { labels: refLabels, read } = referencedLabels(ctx);
  const checked = read.length > 0 || !!ctx.state.manuscript;
  const prodOf = new Map();
  for (const p of ctx.producers) for (const o of arr(p.outputs)) if (!prodOf.has(o)) prodOf.set(o, p);
  const groups = new Map();
  for (const r of figureFiles(ctx)) {
    const e = figureEntry(ctx, r.path);
    if (e.placement) continue;                                          // a placement (also "none") is a decision
    const label = labelOfFile(r.path);
    if (label && refLabels.has(label)) continue;                        // cited by a document read
    const p = prodOf.get(r.path) || arr(ctx.producers).find(q => arr(q.outputs).some(o => stemOf(o) === stemOf(r.path) && dirOf(o) === dirOf(r.path)));
    const g = p ? `producer:${p.id}` : `dir:${dirOf(r.path)}`;
    const grp = groups.get(g) || { id: g, producer: p?.id || null, rows: [] };
    grp.rows.push(r); groups.set(g, grp);
  }
  const msSource = ctx.source?.path ? ctx.ms(ctx.byPath.get(ctx.source.path)) : null;
  for (const g of groups.values()) {
    if (g.rows.length < ctx.P.GROUP_MIN) continue;
    const members = g.rows.map(r => r.path).sort(byText);
    const newest = [...g.rows].sort((a, b) => (ctx.ms(b) ?? 0) - (ctx.ms(a) ?? 0) || byText(a.path, b.path))[0];
    const newer = checked && ctx.timeOn && msSource != null && ctx.ms(newest) != null && ctx.ms(newest) > msSource;
    const where = baseOf(dirOf(members[0])) || 'the project folder';
    const range = rangeLabel(members);
    const evidence = [{ kind: 'unlinked', path: newest.path, at: ctx.ms(newest) ?? undefined, quote: newer ? 'newer than the manuscript' : 'cited by no document read' }];
    if (ctx.source?.path) evidence.push({ kind: 'checked', path: ctx.source.path, quote: 'checked for citations' });
    add(ctx, {
      rule: 'U1', subject: slug(g.id).slice(0, 60), severity: newer ? 'gap' : 'info',
      text: !checked ? `${members.length} figure files in ${where}; citations not checked` : `${range ? `${range}: ` : `${members.length} figure files in ${where}: `}cited by no document read`,
      evidence, members, action: ['adopt', 'link', 'not-for-submission'], generatable: 'no',
      extra: { ...(ctx.source?.from ? { from: ctx.source.path } : {}), ...(!checked ? { unchecked: true } : {}), ...(g.producer ? { producer: g.producer } : {}) },
    });
  }
}

// ---- style: Y1 to Y5 (information only) ----------------------------------------------------------

/** A profile by id: the project's own copy first, then the preset of that name. */
const profileFor = (ctx, id) => arr(ctx.style?.profiles).find(p => p?.id === id) || PRESETS[id] || null;
const round1 = x => Math.round(x * 10) / 10;
const pngOf = (ctx, path) => (isObj(ctx.facts.png?.[path]) && Number.isFinite(ctx.facts.png[path].width) ? ctx.facts.png[path] : null);

/** The profile whose portrait width Y5 measures a supplied image against: the options', the style's forest assignment, then its active profile. */
function referenceProfile(ctx) {
  const id = ctx.options.profileId || ctx.style?.assign?.forest || ctx.style?.active;
  const p = id ? profileFor(ctx, id) : null;
  return p?.geometry?.widthIn?.portrait && p.geometry.dpi ? p : null;
}

/** Paths whose PNG header Y1 and Y5 read: outputs of a producer with a profile, and placed or cited image files. Pass them to collectFacts as `png`. */
export function pngCandidates(facts, options = {}, now = facts?.now) {
  const ctx = buildContext(facts || {}, options, Number.isFinite(now) ? now : 0);
  sourceOfRecord(ctx);
  const out = new Set();
  for (const p of ctx.producers) if (p.profile && p.profile !== 'none') for (const o of arr(p.outputs)) if (extOf(o) === 'png') out.add(o);
  const { labels } = referencedLabels(ctx);
  for (const r of figureFiles(ctx)) if (r.ext === 'png') { const label = labelOfFile(r.path), e = figureEntry(ctx, r.path); if ((e.placement && e.placement !== 'none') || (label && labels.has(label))) out.add(r.path); }
  return [...out].sort(byText);
}

function styleFindings(ctx) {
  // Y1: size and dpi against the producer's rendering profile
  for (const p of ctx.producers) {
    const prof = p.profile && p.profile !== 'none' ? profileFor(ctx, p.profile) : null;
    if (!prof) continue;
    const outs = arr(p.outputs).filter(o => pngOf(ctx, o));
    if (!outs.length) continue;
    const dpiOf = o => pngOf(ctx, o).dpi ?? prof.geometry?.dpi ?? null;
    const inches = o => (dpiOf(o) ? pngOf(ctx, o).width / dpiOf(o) : null);
    // a declared profile, or one laid out in pixels with no print dpi (RevMan Web's export layout), has no print width to check: one line says what it follows
    if (prof.render === false || !Number.isFinite(prof.geometry?.dpi)) {
      const widths = outs.map(inches).filter(w => w != null).map(round1);
      const w = widths.length ? [...widths].sort((a, b) => widths.filter(x => x === b).length - widths.filter(x => x === a).length || a - b)[0] : prof.geometry?.widthIn?.portrait;
      add(ctx, { rule: 'Y1', subject: p.id, severity: 'info', text: `follows ${p.profile}${w != null ? ` (${Number(w).toFixed(1)} in)` : ''}`, evidence: [{ kind: 'png', path: outs[0], quote: `${pngOf(ctx, outs[0]).width} px wide` }], members: outs, action: [], generatable: 'no' });
      continue;
    }
    const targets = [prof.geometry?.widthIn?.portrait, prof.geometry?.widthIn?.landscape].filter(Number.isFinite);
    const bad = [];
    for (const o of outs) {
      const w = inches(o), png = pngOf(ctx, o), want = prof.geometry?.dpi ?? 300;
      const widthOff = w != null && targets.length > 0 && !targets.some(t => Math.abs(w - t) <= ctx.P.WIDTH_TOL * t);
      const dpiOff = png.dpi == null || Math.round(png.dpi) !== want;
      if (widthOff || dpiOff) bad.push({ o, w, png, widthOff, dpiOff });
    }
    if (!bad.length) continue;
    const b = bad[0];
    const parts = [b.widthOff ? `${b.w.toFixed(1)} in wide; profile ${uniq(targets).join(' or ')} in` : null, b.dpiOff ? (b.png.dpi == null ? 'no dpi tag' : `${Math.round(b.png.dpi)} dpi tag`) : null].filter(Boolean);
    add(ctx, {
      rule: 'Y1', subject: p.id, severity: 'info', text: `${bad.length > 1 ? `${bad.length} files: ` : ''}${parts.join('; ')}`,
      evidence: [{ kind: 'png', path: b.o, quote: `${b.png.width} px wide` }], members: bad.map(x => x.o), action: [], generatable: 'no',
    });
  }
  // Y5: supplied image resolution against the reference profile
  const ref = referenceProfile(ctx);
  if (ref) {
    const { labels } = referencedLabels(ctx);
    const portrait = ref.geometry.widthIn.portrait, want = ref.geometry.dpi;
    for (const r of figureFiles(ctx)) {
      const e = figureEntry(ctx, r.path), png = pngOf(ctx, r.path), label = labelOfFile(r.path);
      if (!png || e.exception || !((e.placement && e.placement !== 'none') || (label && labels.has(label)))) continue;
      const implied = png.width / portrait;
      if (Math.round(implied) >= want) continue;
      add(ctx, {
        rule: 'Y5', subject: slug(r.path), severity: 'info', text: `${short(baseOf(r.path))}: implied ${Math.round(implied)} dpi at ${portrait} in`,
        evidence: [{ kind: 'png', path: r.path, quote: `${png.width} px wide; ${png.dpi == null ? 'no dpi tag' : `${Math.round(png.dpi)} dpi tag`}` }], action: [], generatable: 'no', stampBy: 'evidence',
      });
    }
  }
  // Y2, Y3: Lykos renders (state.outputs[].render = { profile, styleHash, fidelity }) against the active profile
  const active = ctx.style?.active ? profileFor(ctx, ctx.style.active) : null;
  const renders = arr(ctx.state.outputs).filter(o => isObj(o.render));
  const changed = active?.hash ? renders.filter(o => o.render.styleHash && o.render.styleHash !== active.hash) : [];
  if (changed.length) add(ctx, { rule: 'Y2', subject: 'render-style', severity: 'info', text: `${plural(changed.length, 'Lykos figure')} drawn in an earlier ${ctx.style.active} style`, evidence: [{ kind: 'render', quote: `${changed[0].id} ${changed[0].render.styleHash.slice(0, 8)}` }], members: changed.map(o => `output:${o.id}`), action: [], generatable: 'no' });
  const approx = renders.filter(o => o.render.fidelity && o.render.fidelity !== 'exact');
  if (approx.length) add(ctx, { rule: 'Y3', subject: 'render-fonts', severity: 'info', text: `${plural(approx.length, 'Lykos figure')} drawn with substitute fonts (${approx[0].render.fidelity})`, evidence: [{ kind: 'render', quote: `${approx[0].id}: ${approx[0].render.fidelity}` }], members: approx.map(o => `output:${o.id}`), action: [], generatable: 'no' });
  // Y4: a profile's source files differ from the files now
  for (const prof of arr(ctx.style?.profiles)) {
    const moved = arr(prof.source).filter(s => { const r = ctx.byPath.get(s.path); return !r || r.size !== s.size || (ctx.ms(r) != null && Number.isFinite(Date.parse(s.mtime)) && ctx.ms(r) !== Date.parse(s.mtime)); });
    if (moved.length) add(ctx, { rule: 'Y4', subject: prof.id, severity: 'info', text: `${prof.id}: ${plural(moved.length, 'source file')} differ from the profile`, evidence: moved.slice(0, 3).map(s => ({ kind: 'style', path: s.path, quote: ctx.byPath.has(s.path) ? 'changed' : 'missing' })), action: [], generatable: 'no' });
  }
}

// ---- drift: files adopted into the project against the files now (plan §4.15d) -------------------------

/**
 * D1 to D5 (lib/drift.mjs): the facts' `drift` says which adopted files changed or went, which cells differ from the file or from the
 * app's own past, and which imported values cite a file with no adoption record. The rules are not in RULES (the figure rules);
 * a finding says where it leads in `view`, and its action ids are the ones above.
 */
function driftFindings(ctx) {
  const d = ctx.facts.drift;
  if (!isObj(d)) return;
  for (const f of driftFindingsOf(d, { successor: p => successorOf(ctx, p)?.path ?? null })) {
    add(ctx, { rule: f.rule, subject: f.subject, severity: f.severity, text: f.text, evidence: f.evidence, members: f.members, action: f.action, generatable: 'no', extra: { view: f.view } });
  }
}

// ---- dedupe, decisions, ranking -------------------------------------------------------------------

const setKey = (ctx, members) => arr(members).map(m => `${dirOf(m)}/${stemOf(m)}`).sort(byText).join('|');

/** One finding per key; M1 absorbs M2 and R1 of its figure; U1 and T3 of one member set are one row. */
function reconcile(ctx) {
  const byKey = new Map();
  for (const f of ctx.out) {
    const had = byKey.get(f.key);
    if (!had) { byKey.set(f.key, f); continue; }
    had.evidence = uniq([...had.evidence, ...f.evidence].map(e => JSON.stringify(e))).map(s => JSON.parse(s)).slice(0, EVIDENCE_MAX);
    if (f.members) had.members = uniq([...arr(had.members), ...f.members]);
  }
  let list = [...byKey.values()];
  // M1 absorbs the placeholder legend of its figure and the request that cites it (a request is filtered when built)
  list = list.filter(f => !(f.rule === 'M2' && arr(f.members).length === 0));
  // U1 + T3 of the same members: one row, at the lower severity of the two
  const t3 = list.filter(f => f.rule === 'T3' && f.members?.length > 1);
  for (const u of list.filter(f => f.rule === 'U1' && f.members?.length)) {
    const same = t3.find(t => setKey(ctx, t.members) === setKey(ctx, u.members));
    if (!same) continue;
    u.evidence = [...u.evidence, ...same.evidence].slice(0, EVIDENCE_MAX);
    if (u.severity === 'info') {
      const range = rangeLabel(u.members);
      u.text = fit(`${range ? `${range}: ` : `${u.members.length} figure files: `}not cited by the submission; inputs newer than the figures`);
      u.surfaces = ['outputs', 'mcp'];
    }
    u.commands = same.commands; if (same.noCommand) u.noCommand = same.noCommand;
    u.action = uniq([...u.action, ...same.action]);
    list = list.filter(f => f !== same);
  }
  return list;
}

/** Marks a finding with the registry decision that still holds for its key and stamp, or null. */
function decide(ctx, list) {
  for (const f of list) {
    const d = ctx.registry ? decisionFor(ctx.registry, f.key, f.stamp) : null;
    f.decision = d ? { state: d.state, at: d.at } : null;
  }
}

const sev = f => SEVERITY_ORDER.indexOf(f.severity);
const kindRank = f => { const i = KIND_ORDER.indexOf(f.kind); return i < 0 ? KIND_ORDER.length : i; };
/** Severity, then a request that conflicts with an existing figure ahead of other gaps, then kind order, then more members, then key. */
const compare = (a, b) => sev(a) - sev(b) || (b.conflict === true) - (a.conflict === true) || kindRank(a) - kindRank(b) || arr(b.members).length - arr(a.members).length || byText(a.key, b.key);

export function rank(findings) { return [...arr(findings)].sort(compare); }

/** A short fingerprint of the findings: the sorted keys and stamps (and whether each is decided). The same facts give the same digest. */
export function digest(findings) {
  return sha256(arr(findings).map(f => `${f.key}@${f.stamp}${f.decision ? `!${f.decision.state}` : ''}`).sort(byText).join('\n')).slice(0, 16);
}

/** The findings a surface shows: those routed to it and not decided. */
export const routed = (findings, surface) => rank(arr(findings).filter(f => !f.decision && arr(f.surfaces).includes(surface)));

/** The Overview rows: at most `cap` of the ranked block and gap findings, and how many more there are. */
export function overview(findings, cap = PARAMS.OVERVIEW_CAP) {
  const all = routed(findings, 'overview').filter(f => f.severity !== 'info');
  return { rows: all.slice(0, cap), more: Math.max(0, all.length - cap), moreText: all.length > cap ? `${all.length - cap} more figure ${all.length - cap === 1 ? 'check' : 'checks'}` : '' };
}

/**
 * The figure needs of a project: the findings of every rule, deduped, marked with the decisions that still hold, ranked.
 * `facts` is collectFacts' result; `options` = { params, profileId }; `now` (ms) defaults to facts.now.
 */
export function detect(facts, options = {}, now = facts?.now) {
  if (!isObj(facts)) return [];
  const opts = isObj(options) ? options : {};
  const ctx = buildContext(facts, opts, Number.isFinite(now) ? now : 0);
  noticeFindings(ctx);
  sourceOfRecord(ctx);
  missingFindings(ctx);
  resultFindings(ctx);
  staleFindings(ctx);
  requestFindings(ctx);
  unlinkedFindings(ctx);
  styleFindings(ctx);
  driftFindings(ctx);
  for (const f of coverageRules(ctx)) add(ctx, f);   // the integration checks (lib/coverage-needs.mjs): the folder's work the record does not hold
  const list = reconcile(ctx);
  decide(ctx, list);
  return rank(list);
}
