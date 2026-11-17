import { lib_research_types$RESEARCH_TYPES as RESEARCH_TYPES } from "../boot.mjs";
// Project folders: the standard layout, and what the files in a folder are.
//
// Pure and dependency-free: it runs in the webview, under node --test, and in
// the tools/ MCP server that gives AI clients a file index. Nothing here reads
// or writes a disk; callers pass names, sizes and (for workbooks) sheet names
// and header rows, and get back classifications, an index, a plan of moves, a
// versioned output name or the text of AGENTS.md.
//
// The layout keeps what worked in a real review folder (plan §4.15a): PDFs
// named "NN - Author Year.pdf" where the number is the table ID, one current
// version of each output with earlier ones archived by version, and a guide
// for people and AI agents at the top. It drops what did not: folders named
// after the tool that wrote into them, quick-access copies of the current
// files beside the originals, and versions kept in several places.

// ---- the layout -------------------------------------------------------------
// The layout of 31 Oct 2026 (plan §4.15a): words, no numbers, the authors' files under Manuscript/. Earlier layouts are
// still read; lib/folder-migrate.mjs moves a folder from one.
/** Every folder the layout knows, by the key the app writes to. */
export const FOLDERS = {
  protocol:   { name: 'Protocol',       holds: 'Protocol versions, registration, amendments' },
  search:     { name: 'Search',         holds: 'Database exports, strategies, logs, validation set' },
  screening:  { name: 'Screening',      holds: 'Screening sheets, PRISMA counts, retrieval lists' },
  papers:     { name: 'Papers',         holds: 'Included reports "NN - Author Year.pdf"' },
  literature: { name: 'Literature',     holds: 'Search exports and the papers cited, "NN - Author Year.pdf"' },
  data:       { name: 'Data',           holds: 'Evidence table workbooks (vN)' },
  patients:   { name: 'Patient data',   holds: 'Patient-level data (de-identified xlsx/csv) and its codebook' },
  case:       { name: 'Case',           holds: 'Clinical summary, timeline and signed consent' },
  images:     { name: 'Images',         holds: 'De-identified imaging and clinical photographs' },
  rob:        { name: 'Risk of bias',   holds: 'Risk-of-bias workbook, decision log, figure sources' },
  analysis:   { name: 'Analysis',       holds: 'Analysis scripts and results' },
  synthesis:  { name: 'Synthesis',      holds: 'Codes, themes, matrices and confidence ratings' },
  charting:   { name: 'Charting',       holds: 'Charted data and the evidence map' },
  manuscript: { name: 'Manuscript',     holds: 'Manuscript vN.docx' },
  // folders inside another (SUB_KEYS): a key the app writes to, kept where its parent is
  tables:     { name: 'Tables',         holds: 'Tables for the authors' },
  figures:    { name: 'Figures',        holds: 'Figures for the authors' },
  supplement: { name: 'Supplement',     holds: 'Supplementary material' },
  submission: { name: 'Submission',     holds: 'Cover letter, checklists' },
  verification: { name: 'Verification', holds: 'Verification logs by date, Full text/' },
};
export const ARCHIVE = 'Old versions';
export const GUIDE = 'AGENTS.md';
export const STATE_DIR = '.lykos';
/** The layout's version, as .lykos/layout.json records it: 1 numbered stage folders and Archive/, 2 this one. */
export const LAYOUT_VERSION = 2;
/** Folders inside a stage folder, made with it. */
export const SUBFOLDERS = {
  papers: ['Companions', 'Uncertain', 'Excluded', 'Background'],
  literature: ['Excluded'],
  data: ['Verification', 'Tidy'],
  analysis: ['Scripts', 'Results'],
  manuscript: ['Tables', 'Figures', 'Supplement', 'Submission'],
};
export const PAPER_SUBFOLDERS = SUBFOLDERS.papers;
/** Keys whose folder sits inside another's: [parent key, its name there]. */
export const SUB_KEYS = {
  tables: ['manuscript', 'Tables'], figures: ['manuscript', 'Figures'], supplement: ['manuscript', 'Supplement'],
  submission: ['manuscript', 'Submission'], verification: ['data', 'Verification'],
};
/** What each subfolder holds, for the guide. */
const SUB_HOLDS = {
  'papers/Companions': 'linked reports of an included trial', 'papers/Uncertain': 'full text not decided', 'papers/Excluded': 'Excluded/<reason>/',
  'papers/Background': 'cited, not included', 'data/Verification': 'Verification/<date>/: logs, Full text/', 'data/Tidy': 'analysis dataset, codebook',
  'analysis/Scripts': '', 'analysis/Results': 'one folder per run date', 'manuscript/Tables': '', 'manuscript/Figures': '', 'manuscript/Supplement': '',
  'manuscript/Submission': 'cover letter, checklists',
};

// Stage folders per research type, in the order the work happens (lib/research-types.mjs).
const LAYOUTS = Object.fromEntries(RESEARCH_TYPES.map(t => [t.id, t.layout]));

// Where a kind of output goes when the type has no folder of that name.
const FALLBACK = {
  papers: ['literature'], literature: ['papers'], search: ['literature', 'papers'],
  screening: ['search', 'literature', 'data'], protocol: ['screening', 'case', 'data'],
  patients: ['data', 'case'], data: ['patients', 'case', 'charting', 'synthesis'],
  analysis: ['synthesis', 'charting', 'data', 'patients'], synthesis: ['analysis', 'data'], charting: ['analysis', 'data'],
  rob: ['analysis', 'synthesis', 'data'],
  case: ['patients', 'data'], images: ['case', 'manuscript'], manuscript: [],
};

const pad = n => String(n).padStart(2, '0');

/**
 * The layout for a research type: the stage folders, then Old versions. Each
 * folder is `{ key, dir, holds, subs }`; `dir` is what is on disk ("Papers"),
 * `subs` the folders made inside it. Keys of SUB_KEYS are not stages: their
 * folder is inside their parent's (Manuscript/Supplement).
 */
export function folderLayout(typeId = 'other') {
  const keys = (LAYOUTS[typeId] || LAYOUTS.other).filter(k => !SUB_KEYS[k]);
  const folders = keys.map(key => ({ key, dir: FOLDERS[key].name, holds: FOLDERS[key].holds, subs: SUBFOLDERS[key] || [] }));
  return { type: LAYOUTS[typeId] ? typeId : 'other', folders, archive: ARCHIVE, version: LAYOUT_VERSION };
}

/** Every folder a new project gets, parents first: stages, their subfolders, Old versions. */
export function layoutDirs(layout) {
  const out = [];
  for (const f of layout.folders) {
    out.push(f.dir);
    for (const s of f.subs || []) out.push(`${f.dir}/${s}`);
  }
  out.push(layout.archive || ARCHIVE);
  return out;
}

// Folder names people already use, recognised as a stage. Matched on the
// top-level folder, case-insensitively and without a leading number. The
// author-facing output folders ("1 Tables", "2 Figures", "3 Supplement") and
// "4 Risk of bias" come before data, which once took any "tables".
const ALIASES = [
  ['protocol', /^(protocol|registration|prospero)s?$/],
  ['search', /^(search(es)?|search results|database exports?|exports?|records)$/],
  ['screening', /^(screening|screen|eligibility)$/],
  ['papers', /^(papers?|pdfs?|full[- ]?texts?|articles|included( studies)?|studies)$/],
  ['literature', /^(literature|references|refs)$/],
  ['tables', /^(tables|publication tables)$/],
  ['figures', /^(figures|publication figures)$/],
  ['rob', /^(risk of bias|rob|appraisal|quality( assessment)?|critical appraisal)$/],
  ['data', /^(data|evidence( tables?)?|extraction|data extraction)$/],
  ['patients', /^(patient data|patients|ipd|cases|case data)$/],
  ['case', /^(case|clinical)$/],
  ['images', /^(images?|imaging|figures? source|photos?)$/],
  ['analysis', /^(analysis|analyses|stats?|statistics|results|meta[- ]?analysis)$/],
  ['synthesis', /^(synthesis|themes?|coding)$/],
  ['charting', /^(charting|evidence map)$/],
  ['manuscript', /^(manuscript|draft|drafts|paper draft|writing)$/],
  ['submission', /^(submission|submissions)$/],
  ['supplement', /^(supplement(ary)?( material)?|appendix|appendices)$/],
  ['archive', /^(archive|old versions?|previous versions?|old|versions|backups?|_archive)$/],
];
const bare = name => String(name || '').trim().toLowerCase().replace(/^\d+[\s._-]+/, '');
/** The stage a folder name stands for ("04 Papers", "papers", "Old versions", "1 Tables"), or ''. */
export function stageOfFolder(name) {
  const b = bare(name);
  return ALIASES.find(([, re]) => re.test(b))?.[0] || '';
}

/**
 * Which layout a folder's top-level names are in: 'current' (this layout's
 * names), 'numbered' (the stage folders of 28 Sep 2026, "04 Papers"), 'own'
 * (a person's own names, or a mix), or 'empty' (no stage folder at all).
 */
export function layoutKind(topDirs = []) {
  const staged = topDirs.filter(d => !String(d).startsWith('.') && stageOfFolder(d));
  if (!staged.length) return 'empty';
  const stages = staged.filter(d => stageOfFolder(d) !== 'archive');
  if (stages.length && stages.every(d => /^\d{2} /.test(d))) return 'numbered';
  const current = d => {
    const k = stageOfFolder(d);
    if (k === 'archive') return d === ARCHIVE;
    return !SUB_KEYS[k] && FOLDERS[k]?.name === d;
  };
  return staged.every(current) ? 'current' : 'own';
}

/**
 * The folders a project uses, from its top-level names: the standard ones, or
 * a person's own ("papers", "Evidence table", "1 Tables"). `dirFor(key)` is
 * where an output of that kind goes ("Manuscript/Tables" unless "1 Tables" is
 * there); `used` lists the top-level folders in layout order, for the guide.
 */
export function resolveLayout(topDirs = [], typeId = 'other') {
  const std = folderLayout(typeId);
  const found = {};
  for (const d of topDirs) {
    if (String(d).startsWith('.')) continue;
    const key = stageOfFolder(d);
    if (key && !found[key]) found[key] = d;
  }
  const byKey = Object.fromEntries(std.folders.map(f => [f.key, found[f.key] || f.dir]));
  for (const [k, d] of Object.entries(found)) if (k !== 'archive' && !byKey[k]) byKey[k] = d;
  const archive = found.archive || ARCHIVE;
  const standard = std.folders.every(f => topDirs.includes(f.dir));
  const dirFor = key => {
    if (key === 'archive') return archive;
    if (SUB_KEYS[key]) {
      if (found[key]) return found[key];
      const [parent, name] = SUB_KEYS[key];
      return `${dirFor(parent)}/${name}`;
    }
    if (byKey[key]) return byKey[key];
    for (const k of FALLBACK[key] || []) if (byKey[k]) return byKey[k];
    return byKey.manuscript || std.folders.at(-1).dir;
  };
  const used = [];
  for (const f of std.folders) used.push({ key: f.key, dir: byKey[f.key], holds: f.holds, subs: f.subs, present: topDirs.includes(byKey[f.key]) });
  for (const [k, d] of Object.entries(found)) if (k !== 'archive' && !used.some(u => u.dir === d)) used.push({ key: k, dir: d, holds: FOLDERS[k]?.holds || '', subs: [], present: true });
  return { ...std, byKey, archive, standard, dirFor, used, kind: layoutKind(topDirs) };
}

/** A new Package part's file: under Manuscript/Supplement, Figures or Tables by its name ("Supplement" → Manuscript/Supplement/Supplement v1.docx). */
export function partFile(name, layout = null) {
  const key = /supplement|appendix/i.test(name) ? 'supplement' : /figure/i.test(name) ? 'figures' : 'tables';
  const dir = layout?.dirFor ? layout.dirFor(key) : `${FOLDERS.manuscript.name}/${FOLDERS[key].name}`;
  return `${dir}/${String(name).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()} v1.docx`;
}

/** The folder of a verification round's logs and texts: Data/Verification/<date>, or "<data folder>/Verification <date>" in a folder that keeps the earlier form. */
export function verificationDir(topDirs = [], day, { nested = null } = {}) {
  const L = resolveLayout(topDirs);
  const data = L.dirFor('data');
  const inner = nested ?? (L.kind === 'current' || data === FOLDERS.data.name);
  return inner ? `${data}/Verification/${day}` : `${data}/Verification ${day}`;
}

// ---- names ------------------------------------------------------------------
const extOf = name => { const b = baseOf(name); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const baseOf = path => String(path).slice(String(path).lastIndexOf('/') + 1);
const dirOf = path => String(path).includes('/') ? String(path).slice(0, String(path).lastIndexOf('/')) : '';
const stemOf = name => { const b = baseOf(name); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; };

/**
 * A version in a file name, and the name without it: "Spine_ASD_publication_
 * FINALv12" is v12 of "Spine_ASD_publication_FINAL"; "Evidence table v3" is v3
 * of "Evidence table"; "Manuscript Final_v2" is v2. No version is 0.
 */
export function parseVersion(name) {
  const { stem, version } = parseVersionFull(name);
  return { stem, version };
}

/**
 * The same, with what a versioned review folder also carries: a version of
 * several parts ("v3_4_1" is 3.4.1, later than "v3_4", which is later than
 * "v3"), the copy marks a file manager or a download adds ("name (1)",
 * "name (1) (1)", "name_1" straight after a word; "v2_1" is a version, not a
 * copy), and `group`, the stem without the words that only say how a file was
 * finished ("final", "fixed", "mendeley"), so "Manuscript_v15_final",
 * "Manuscript_v15_mendeley" and "Manuscript_v16" are one manuscript at three
 * versions. `rank` orders versions with sub-versions: 3.4.1 > 3.4 > 3.
 */
export function parseVersionFull(name) {
  let stem = stemOf(name), copy = 0;
  for (let m; (m = /\s*\((\d{1,2})\)$/.exec(stem));) { copy++; stem = stem.slice(0, m.index); }
  const tail = /^(.*[A-Za-z])_(\d)$/.exec(stem);
  if (tail) { copy++; stem = tail[1]; }
  // The last "vN" (or "vN_M_K") that ends a word: "FINALv12_with_sources" is v12 of
  // "FINAL_with_sources"; a note in brackets after it is dropped.
  const all = [...stem.matchAll(/(^|[\s._-]|[a-z](?=v\d)|[A-Z](?=v\d))v(?:er(?:sion)?)?[\s._-]?(\d{1,3})((?:[._]\d{1,3})*)(?=$|[\s._-]|\s*\()/gi)];
  const m = all.at(-1);
  let out = { stem, version: 0, parts: [0] };
  if (m) {
    const before = stem.slice(0, m.index + m[1].length).replace(/[\s._-]+$/, '');
    const after = stem.slice(m.index + m[0].length).replace(/\s*\([^)]*\)\s*$/, '');
    if (before) out = { stem: (before + after).trim(), version: Number(m[2]), parts: [Number(m[2]), ...(m[3] || '').split(/[._]/).filter(Boolean).map(Number)] };
  }
  const group = out.stem.replace(/(^|[\s._-])(final|fixed|audited|corrected|revised|updated|latest|clean|mendeley|zotero|with[\s_-]?citations)(?=$|[\s._-])/gi, '$1')
    .replace(/[\s._-]+/g, ' ').trim().toLowerCase();
  const rank = out.parts.reduce((a, x, i) => a + x / 1000 ** i, 0);
  return { ...out, copy, group, rank };
}

/** "01 - Akgun 2024.pdf", "7 - Di Silvestre 2010b.pdf": the table ID, first author and year. */
export function parseStudyPdf(name) {
  const m = /^(\d{1,4})\s*[-–—_.]\s*(.+?)[\s,_]+((?:19|20)\d{2})([a-z])?(?:\s*\(.*\))?\.pdf$/i.exec(baseOf(name));
  if (!m) return null;
  return { no: Number(m[1]), author: m[2].replace(/\s+et al\.?$/i, '').trim(), year: m[3], suffix: m[4] || '' };
}

/** "Author Year.pdf" without a number: a paper named for its study, not yet numbered. */
export function parseAuthorYearPdf(name) {
  const m = /^([^\d][^/]*?)[\s,_]+((?:19|20)\d{2})([a-z])?(?:\s+(.*))?\.pdf$/i.exec(baseOf(name));
  if (!m) return null;
  return { author: m[1].replace(/\s+et al\.?$/i, '').trim(), year: m[2], suffix: m[3] || '', note: (m[4] || '').trim() };
}

// ---- tables -----------------------------------------------------------------
const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^\w\s#]/g, ' ').replace(/\s+/g, ' ').trim();
const has = (cells, re) => cells.some(c => re.test(c));
const count = (cells, res) => res.filter(re => has(cells, re)).length;

// Header vocabularies. Each role needs its anchor and enough of the rest.
const EVIDENCE = [/\bstudy design\b|\bdesign\b/, /\bpopulation\b|\bparticipants?\b|\bdiagnosis\b/, /\barms?\b|\bintervention\b|\bcomparator\b|\bgroups?\b/,
  /\bage\b|\bsex\b|\bgender\b/, /\bfollow ?up\b/, /\boutcomes?\b/, /\bsample size\b|\b n\b|\bn \(|\(n\)/, /\bcountry\b|\bsetting\b/, /\btechnique\b|\bconstruct\b|\bdevice\b|\bdose\b/];
const SCREEN = [/\bdecision\b|\bverdict\b|\brecommendation\b|\binclude|\bexclu/, /\breason\b|\bcomment/, /\babstract\b/, /\bdoi\b|\bpmid\b/, /\bauthors?\b|\bfirst author\b/, /\byear\b/, /\bgroup\b|\bstage\b/];
// A patient list that carries its own study-level decisions (an "IPD master list"): the outcome columns of a comparative patient-level review.
const IPD_OUTCOME = [/\beor\b|\bextent of resection\b|\bresection\b/, /\bfollow ?up\b|\btime to\b/, /\bevent status\b|\bprogression\b|\brecurrence\b|\bsurvival status\b|\bstatus\b/, /\badjuvant\b|\btreatment\b|\bradiotherapy\b|\bsrs\b|\bintervention\b/];
// Candidate reports for a later round of inclusion: a source link and patient-level notes, no decision column.
const CANDIDATE = [/\bpatients?\b|\bage ?\/? ?sex\b/, /\bresection\b|\bsurgery\b|\beor\b/, /\bfollow ?up\b/, /\brt\b|\bsrs\b|radiotherapy|radiosurgery|adjuvant|\bdose\b/, /\boutcome\b|\bevent\b/, /\bverification\b|\bassessment\b|\bevidence\b|\bproposed\b|\brelation to\b/];
const PATIENT = [/\bage\b/, /\bsex\b|\bgender\b/, /\bdiagnosis\b|\bindication\b/, /\bfollow ?up\b|\btime\b|\bdate\b/, /\bevent\b|\bstatus\b|\boutcome\b|\bcomplication/, /\bbmi\b|\bweight\b|\bheight\b/, /\bmrn\b|\bhospital\b|\bprotocol no\b/, /\bsurgery\b|\bprocedure\b|\blevels?\b/];

/**
 * What a table is, from its header row: an evidence (extraction) table, a
 * screening sheet, patient-level data, eligibility criteria, a search log, a
 * revision log, or nothing recognised. Score is a rough confidence, 0–1.
 */
export function recogniseHeader(header = []) {
  const cells = header.map(norm).filter(Boolean);
  if (cells.length < 2) return { role: '', score: 0 };
  const first = cells[0];
  const out = [];
  if (has(cells, /\bcriterion\b|\bcriteria\b/) && has(cells, /\bkind\b|\bstage\b|\btype\b|\binclusion\b|\bexclusion\b/))
    out.push({ role: 'criteria', score: 0.9 });
  if (has(cells, /\bdatabase\b|\bsource\b/) && has(cells, /\bquery\b|\bstrategy\b|\bsearch\b/) && has(cells, /\bdate\b|\bresults?\b|\brecords?\b|\bhits\b/))
    out.push({ role: 'search-log', score: 0.85 });
  const titled = has(cells, /\btitle\b/);
  const screenHits = count(cells, SCREEN);
  if (titled && screenHits >= 2 && has(cells, SCREEN[0])) out.push({ role: 'screening', score: Math.min(1, 0.45 + 0.1 * screenHits) });
  const studyCol = has(cells, /^(study|studies|study id|author|first author|reference|trial)( .*)?$/) || /^(id|#)$/.test(first) && has(cells, /\bstudy\b/);
  const evidenceHits = count(cells, EVIDENCE);
  if (studyCol && evidenceHits >= 3) out.push({ role: 'evidence', score: Math.min(1, 0.4 + 0.1 * evidenceHits) });
  // A patient list with the review's own include/exclude decision and reason on every row.
  const ipdHits = count(cells, IPD_OUTCOME);
  if (titled && has(cells, SCREEN[0]) && ipdHits >= 3 && has(cells, /\bcase\b|\bpatient\b/)) out.push({ role: 'ipd-list', score: Math.min(1, 0.6 + 0.1 * ipdHits) });
  if (has(cells, /\bsource url\b|\bdoi ?\/? ?url\b|\bprimary source\b/) && count(cells, CANDIDATE) >= 3 && !has(cells, /^(final )?decision$|\bdecision\b/))
    out.push({ role: 'candidate-cases', score: 0.9 });
  const patientCol = has(cells, /^(patient|patient id|patient no|case|case no|case id|subject|participant|mrn|no|#|id)$/) || has(cells, /\bpatient\b|\bcase\b/);
  const patientHits = count(cells, PATIENT);
  if (patientCol && patientHits >= 3 && !studyCol) out.push({ role: 'patients', score: Math.min(1, 0.4 + 0.08 * patientHits) });
  if (has(cells, /\brevision\b|\bchange\b|\bround\b/) && has(cells, /\bimplementation\b|\bsummary\b|\bchange\b|\bguidance\b|\bissue\b/))
    out.push({ role: 'log', score: 0.5 });
  out.sort((a, b) => b.score - a.score);
  return out[0] || { role: '', score: 0 };
}

/** The header row of a sheet: the first row with at least two filled cells, within the first ten. */
export function headerRow(rows = []) {
  for (let i = 0; i < Math.min(rows.length, 10); i++)
    if ((rows[i] || []).filter(c => String(c ?? '').trim()).length >= 2) return { index: i, cells: rows[i].map(c => String(c ?? '').trim()) };
  return { index: -1, cells: [] };
}

const SHEET_WEIGHT = { evidence: 3, screening: 3, patients: 3, 'ipd-list': 4, 'candidate-cases': 4, criteria: 2, 'search-log': 2, log: 0 };
/**
 * A workbook's role from its sheets (`[{ name, header, rows? }]`): the best
 * sheet decides, a sheet named "Table" or "Decisions" wins ties, and every
 * recognised sheet is listed so a screening workbook that also carries its
 * criteria can offer both.
 */
export function recogniseWorkbook(sheets = []) {
  const found = sheets.map(s => ({ sheet: s.name, rows: s.rows ?? null, header: s.header || [], ...recogniseHeader(s.header || []) })).filter(x => x.role);
  const named = (x, re) => re.test(norm(x.sheet)) ? 0.05 : 0;
  found.sort((a, b) => (SHEET_WEIGHT[b.role] || 1) * (b.score + named(b, /^(table|decisions|data|patients|screening)/))
    - (SHEET_WEIGHT[a.role] || 1) * (a.score + named(a, /^(table|decisions|data|patients|screening)/)));
  return { role: found[0]?.role || '', sheet: found[0]?.sheet || '', score: found[0]?.score || 0, sheets: found };
}

/**
 * Evidence-table columns against the project's extraction fields, by label:
 * an exact match, then shared words. Unmatched columns become new fields.
 */
export function mapColumns(header = [], fields = []) {
  const words = s => new Set(norm(s).split(' ').filter(w => w.length > 2 && !['and', 'the', 'for', 'per', 'with'].includes(w)));
  return header.map((label, col) => {
    const l = String(label || '').trim();
    if (!l) return null;
    let best = null, score = 0;
    for (const f of fields) {
      if (norm(f.label) === norm(l)) { best = f; score = 1; break; }
      const A = words(l), B = words(f.label);
      if (!A.size || !B.size) continue;
      let n = 0; for (const w of A) if (B.has(w)) n++;
      const s = n / Math.min(A.size, B.size);
      if (s > score) { score = s; best = f; }
    }
    return { col, label: l, field: score >= 0.5 ? best?.id || null : null, score: score >= 0.5 ? score : 0 };
  }).filter(Boolean);
}

// ---- files ------------------------------------------------------------------
const KIND = {
  pdf: 'pdf', ris: 'records', nbib: 'records', bib: 'records', bibtex: 'records', enw: 'records', ciw: 'records',
  xlsx: 'table', xls: 'table', csv: 'table', tsv: 'table',
  docx: 'document', doc: 'document', odt: 'document', rtf: 'document', md: 'text', txt: 'text',
  png: 'image', jpg: 'image', jpeg: 'image', tif: 'image', tiff: 'image', svg: 'image', gif: 'image', dcm: 'image',
  py: 'script', r: 'script', js: 'script', mjs: 'script', ipynb: 'script', sh: 'script', json: 'data',
  zip: 'archive', pptx: 'slides', ppt: 'slides', key: 'slides', html: 'page', htm: 'page',
};
export const kindOf = name => KIND[extOf(name)] || 'other';

const ARCHIVED = /(^|\/)(archive|old versions?|previous versions?|superseded( versions?)?|_to_delete|backups?|_archive|old)(\/|$)/i;
const REFERENCE = /(^|\/)(references?|templates?|examples?)(\/|$)/i;
// A second form of a file (with sources, annotated, a template, a draft): a
// real table, but not the one to take as current when the plain one is there.
const VARIANT = /with[\s_-]?sources|annotated|template|draft|copy|backup|\bold\b/i;
const EXCLUDED = /(^|\/)(excluded|duplicates?)(\/|$)/i;

/** Where a file sits, as the stage of its top-level folder. */
const topStage = path => {
  const top = String(path).split('/')[0];
  return String(path).includes('/') ? stageOfFolder(top) : '';
};

const doc = (role, target, label, why) => ({ role, target, label, why });
// Roles with no place in the app whose files still come in versions, so the current one can be told from an earlier.
const VERSIONED_ROLES = ['figure', 'table-doc', 'figures-doc', 'report', 'supplement', 'manuscript-output', 'checklist', 'prisma-flow', 'prisma-report', 'candidate-cases', 'reference-list'];

/**
 * One file, classified from its path and what is known about it. `meta` may
 * carry `size`, `sheets` (`[{ name, header }]` for a workbook or CSV) and
 * `text` (the first part of a document). Returns what it is, what it maps to
 * in the app, and why, plus its version and, for a study PDF, its ID.
 */
export function classifyFile(path, meta = {}) {
  const name = baseOf(path), ext = extOf(name), kind = kindOf(name), lower = name.toLowerCase();
  const { stem, version, parts, rank, group, copy } = parseVersionFull(name);
  const stage = topStage(path);
  const archived = ARCHIVED.test(dirOf(path)) || stage === 'archive';
  const excluded = EXCLUDED.test(dirOf(path));
  const base = { path, name, ext, kind, stem, version, rank, group, copy, vlabel: parts.join('.'), stage, archived, excluded, confidence: 0.5 };
  const out = x => ({ ...base, ...x });

  // the project file's visible copy (lib/projects.mjs VISIBLE_COPY) is the app's own state too: never sorted into a stage
  if (path.startsWith(`${STATE_DIR}/`) || path === STATE_DIR || path === 'Lykos project.json') return out(doc('app-state', null, 'Lykos project state', 'kept by the app'));
  if (name === GUIDE) return out({ ...doc('guide', null, 'Folder guide', 'AGENTS.md'), confidence: 1 });
  if (/^~\$|^\.~lock|^\.ds_store$|\.tmp$|\.part$|\.lykos-tmp$|\.pyc$/i.test(name)) return out({ ...doc('lock-file', null, 'Temporary file', 'left by an open editor'), confidence: 1 });
  if (archived) return out({ ...doc('archived', null, version ? `Earlier version v${parts.join('.')}` : 'Archived', 'in an archive folder'), confidence: 0.9 });

  // the copies Lykos keeps of each imported file (plan B3, lib/import-safety.mjs): already imported, never offered again
  if (/(^|\/)raw imports(\/|$)/i.test(dirOf(path))) return out({ ...doc('raw-import', null, 'Raw import copy', 'kept by Lykos as it was imported'), confidence: 1 });
  if (kind === 'records') {
    // A reference list saved beside the manuscript (Mendeley, Zotero, EndNote) is what the paper cites, not a search's results:
    // it must not count as records identified.
    const cites = /(^|\/)(references?|bibliograph\w*|citations?)(\/|$)/i.test(dirOf(path)) || /(^|[^a-z])(references?|bibliograph\w*|cited|zotero|mendeley|endnote)([^a-z]|$)/i.test(stem)
      || ['manuscript', 'protocol', 'supplement', 'analysis'].includes(stage) || (meta.records != null && meta.records <= 1 && stage !== 'search');
    if (cites) return out({ ...doc('reference-export', 'references', 'References (not a search)', `${ext.toUpperCase()} export of the works cited`), confidence: 0.85 });
    return out({ ...doc('search-export', 'library', 'Records to import', `${ext.toUpperCase()} export`), confidence: 0.95 });
  }

  if (kind === 'pdf') {
    const study = parseStudyPdf(name);
    if (study && !excluded) return out({ ...doc('study-pdf', 'pdf', `Included study ${pad(study.no)}`, 'named by the ID rule'), study, confidence: 0.95 });
    if (excluded) {
      const ay = parseAuthorYearPdf(name);
      return out({ ...doc('excluded-pdf', 'pdf', 'Excluded study', 'in an Excluded folder'), study: study || ay, confidence: 0.8 });
    }
    // A publisher's supplementary file (Nature's "..._MOESM1_ESM.pdf") is not a paper.
    if (/moesm|(^|[^a-z])esm([^a-z]|$)|supplementary (file|material|data)/i.test(lower)) return out({ ...doc('supplement', null, 'Supplement', 'a supplementary file of a paper'), confidence: 0.8 });
    // Reviews and background the paper is placed against are cited, not included.
    if (/(^|\/)(related|background|prior|previous|competitor)[\s_-]*(reviews?|studies|literature|work)?(\/|$)/i.test(dirOf(path)) && /related|background|prior|previous|competitor/i.test(dirOf(path)))
      return out({ ...doc('related-pdf', null, 'Related review', 'in a folder of related work'), confidence: 0.8 });
    const ay = parseAuthorYearPdf(name);
    if (ay && (stage === 'papers' || stage === 'literature')) return out({ ...doc('paper-pdf', 'pdf', 'Paper', 'author and year in the name'), study: ay, confidence: 0.8 });
    if (stage === 'papers' || stage === 'literature') return out({ ...doc('paper-pdf', 'pdf', 'Paper', 'in the papers folder'), confidence: 0.7 });
    if (/supplement|moesm|(^|[^a-z])esm([^a-z]|$)|appendix/i.test(lower) || stage === 'supplement') return out(doc('supplement', null, 'Supplement', 'named or filed as a supplement'));
    if (/prisma/i.test(lower)) return out(/count|report|derivation/i.test(lower) ? doc('prisma-report', null, 'PRISMA counts report', 'named PRISMA counts') : doc('prisma-flow', null, 'PRISMA flow diagram', 'named PRISMA'));
    if (stage === 'manuscript') return out(doc('manuscript-output', null, 'Manuscript output', 'in the manuscript folder'));
    if (ay) return out({ ...doc('paper-pdf', 'pdf', 'Paper', 'author and year in the name'), study: ay, confidence: 0.6 });
    return out({ ...doc('report', null, 'Report', 'a PDF that is not named as a paper'), confidence: 0.4 });
  }

  if (kind === 'table') {
    const wb = recogniseWorkbook(meta.sheets || []);
    if (wb.role && REFERENCE.test(dirOf(path))) return out({ ...doc('reference-table', null, 'Reference table', `in ${dirOf(path)}`), sheet: wb.sheet, confidence: 0.6 });
    if (VARIANT.test(stem)) wb.score = Math.max(0, wb.score - 0.15);
    if (wb.role === 'evidence') return out({ ...doc('evidence-table', 'extraction', /with[\s_-]?sources/i.test(stem) ? 'Evidence table with sources' : 'Evidence table', `sheet "${wb.sheet}" has study columns`), sheet: wb.sheet, sheets: wb.sheets, confidence: wb.score });
    if (wb.role === 'ipd-list') return out({ ...doc('ipd-list', 'patients', 'Patient data with the review\'s decisions', `sheet "${wb.sheet}" has one row per patient and an include/exclude decision`), sheet: wb.sheet, sheets: wb.sheets, confidence: wb.score });
    if (wb.role === 'candidate-cases') return out({ ...doc('candidate-cases', null, 'Candidate reports', `sheet "${wb.sheet}" lists reports with a source link and patient notes, no decisions`), sheet: wb.sheet, sheets: wb.sheets, confidence: wb.score });
    if (wb.role === 'screening') return out({ ...doc('screening-sheet', 'screening', 'Screening sheet', `sheet "${wb.sheet}" has decisions`), sheet: wb.sheet, sheets: wb.sheets, confidence: wb.score });
    if (wb.role === 'patients') return out({ ...doc('patient-data', 'patients', 'Patient data', `sheet "${wb.sheet}" has patient columns`), sheet: wb.sheet, sheets: wb.sheets, confidence: wb.score });
    if (wb.role === 'criteria') return out({ ...doc('criteria-table', 'criteria', 'Eligibility criteria', `sheet "${wb.sheet}" lists criteria`), sheet: wb.sheet, sheets: wb.sheets, confidence: wb.score });
    if (wb.role === 'search-log') return out({ ...doc('search-log', 'search-log', 'Search log', `sheet "${wb.sheet}" lists searches`), sheet: wb.sheet, sheets: wb.sheets, confidence: wb.score });
    // No header seen: the name and folder are the evidence.
    if (/screen/i.test(lower) || stage === 'screening') return out({ ...doc('screening-sheet', 'screening', 'Screening sheet', 'named or filed as screening'), confidence: 0.5 });
    if (/patient|ipd|case/i.test(lower) || stage === 'patients') return out({ ...doc('patient-data', 'patients', 'Patient data', 'named or filed as patient data'), confidence: 0.5 });
    if (/evidence|extraction|characteristic|publication|table/i.test(lower) || stage === 'data') return out({ ...doc('evidence-table', 'extraction', 'Evidence table', 'named or filed as a data table'), confidence: 0.5 });
    return out({ ...doc('table', null, 'Table', 'not recognised from its header'), confidence: 0.3 });
  }

  if (kind === 'document') {
    const text = String(meta.text || '').slice(0, 400).toLowerCase();
    if (/checklist/i.test(lower)) return out({ ...doc('checklist', null, /prisma/i.test(lower) ? 'PRISMA checklist' : 'Reporting checklist', 'named as a checklist'), confidence: 0.9 });
    if (/prisma/i.test(lower)) return out({ ...(/count|report|derivation/i.test(lower) ? doc('prisma-report', null, 'PRISMA counts report', 'named PRISMA counts') : doc('prisma-flow', null, 'PRISMA flow diagram', 'named PRISMA')), confidence: 0.9 });
    if (/review|reviewer|response/i.test(lower) && /comment|response|reply|rebuttal/i.test(lower)) return out({ ...doc('reviewer-comments', null, 'Reviewer comments', 'named as reviewer comments'), confidence: 0.85 });
    if (/elig|criteria|inclusion|exclusion/i.test(lower) || /^eligibility criteria/.test(text)) return out({ ...doc('criteria', 'criteria', 'Eligibility criteria', 'named or headed as criteria'), confidence: 0.85 });
    if (/protocol|prospero|registration/i.test(lower)) return out({ ...doc('protocol', 'protocol', 'Protocol', 'named as a protocol'), confidence: 0.8 });
    if (/^table|_table|tables?\b/i.test(lower)) return out({ ...doc('table-doc', null, 'Manuscript tables', 'named as tables'), confidence: 0.7 });
    if (/^fig|figures?\b/i.test(lower)) return out({ ...doc('figures-doc', null, 'Manuscript figures', 'named as figures'), confidence: 0.7 });
    if (/cover|letter/i.test(lower)) return out(doc('cover-letter', null, 'Cover letter', 'named as a letter'));
    if (/consent/i.test(lower)) return out(doc('consent', null, 'Consent', 'named as consent'));
    if (/supplement/i.test(lower)) return out(doc('supplement', null, 'Supplement', 'named as a supplement'));
    if (stage === 'manuscript' || /manuscript|draft|paper|article/i.test(lower)) return out({ ...doc('manuscript', 'manuscript', 'Manuscript', stage === 'manuscript' ? 'in the manuscript folder' : 'named as a manuscript'), confidence: 0.8 });
    if (stage === 'protocol') return out(doc('protocol', 'protocol', 'Protocol', 'in the protocol folder'));
    return out({ ...doc('document', null, 'Document', 'not recognised'), confidence: 0.3 });
  }

  if (kind === 'text') {
    if (/readme|notes?\b|_note/i.test(lower)) return out(doc('notes', null, 'Notes', 'a note or readme'));
    if (/reference[\s_-]?list|bibliograph/i.test(lower)) return out({ ...doc('reference-list', null, 'Formatted reference list', 'the reference list as text'), confidence: 0.8 });
    if (ext === 'txt' && /\brecords\b|_records/i.test(lower) && (stage === 'search' || /pubmed|medline|scopus|wos|web_of_science|embase/i.test(lower)))
      return out({ ...doc('search-export', 'library', 'Records to import', 'a database export as text'), confidence: 0.7 });
    if (/import[\s_-]?log|search[\s_-]?log/i.test(lower)) return out({ ...doc('search-log', 'search-log', 'Search log', 'named as a log'), confidence: 0.75 });
    if (/search|query|strategy/i.test(lower) || stage === 'search') return out({ ...doc('search-query', 'search-log', 'Search strategy', 'named or filed as a search'), confidence: 0.7 });
    if (kind === 'text' && ext === 'md' && stage === 'manuscript') return out(doc('manuscript', 'manuscript', 'Manuscript', 'in the manuscript folder'));
    return out({ ...doc('text', null, 'Text', 'not recognised'), confidence: 0.3 });
  }
  if (kind === 'image') return out(doc(/prisma/i.test(lower) ? 'prisma-flow' : 'image', null, /prisma/i.test(lower) ? 'PRISMA flow diagram' : 'Figure', 'an image'));
  if (kind === 'script') return out(doc('script', null, 'Script', 'code that rebuilds an output'));
  if (kind === 'archive') return out(doc('bundle', null, 'Archive file', 'a zip'));
  if (kind === 'slides') return out(doc('slides', null, 'Slides', 'a presentation'));
  // a page of links to papers no source gave (lykos-papers download --pending) is a retrieval list of the screening stage
  if (kind === 'page') return out(/fetch|retriev|pending|to download/i.test(lower) ? doc('retrieval-list', null, 'Retrieval list', 'papers to fetch by hand') : doc('page', null, 'Web page', 'an HTML file'));
  // folder-init: the table groups (Tables 1–N) and the PRISMA counts a review's own scripts keep.
  if (kind === 'data' && /table[\s_-]?groups?\b/i.test(stem)) return out({ ...doc('table-groups', 'collections', 'Table groups', 'named as table groups'), confidence: 0.8 });
  if (kind === 'data' && /prisma[\s_-]?counts?\b/i.test(stem)) return out({ ...doc('prisma-counts', 'prisma', 'PRISMA counts', 'named as PRISMA counts'), confidence: 0.8 });
  if (kind === 'data') return out(doc('data-file', null, 'Data file', 'JSON'));
  return out({ ...doc('other', null, 'Other', 'not recognised'), confidence: 0.2 });
}

/**
 * The whole folder: every file classified, the current version of each output
 * separated from earlier ones, quick-access copies (the same file in two
 * places) marked, and the files grouped by what they map to in the app.
 * `entries` are `{ path, size?, mtime?, sheets?, text? }`; folders are ignored.
 */
export function folderIndex(entries = [], { typeId = 'other' } = {}) {
  const files = entries.filter(e => e && e.path && !e.dir).map(e => ({ ...classifyFile(e.path, e), size: e.size || 0, mtime: e.mtime || 0 }));
  // A numbered copy ("name (1)", "name_1") beside the file it copies is a copy, not a second version.
  for (const f of files) {
    if (!f.copy || f.archived || ['lock-file', 'app-state'].includes(f.role)) continue;
    const orig = files.find(g => g !== f && !g.copy && !g.archived && dirOf(g.path) === dirOf(f.path) && g.group === f.group && g.rank === f.rank && g.ext === f.ext);
    if (orig) Object.assign(f, { role: 'copy', target: null, copyOf: orig.path, label: 'Copy of a file beside it', why: `same name as ${orig.name}, numbered by a file manager`, older: true });
  }
  // Versions: files of one name and extension in live folders; the highest is current.
  const groups = new Map();
  for (const f of files) {
    if (f.archived || f.role === 'copy' || !f.target && !VERSIONED_ROLES.includes(f.role)) continue;
    const key = `${f.role === 'study-pdf' ? f.stem.toLowerCase() : f.group}\u0000${f.ext}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  for (const list of groups.values()) {
    const top = Math.max(...list.map(f => f.rank));
    for (const f of list) if (list.length > 1 && f.rank < top) { f.older = true; f.label = `${f.label} (earlier v${f.vlabel})`; }
  }
  // The same name and size in two places: the one at the top level is the copy.
  const byName = new Map();
  // Lock files and the app's own state (.DS_Store, ~$ owner files) are not outputs and have no copies.
  for (const f of files) { if (f.archived || ['lock-file', 'app-state'].includes(f.role)) continue; const k = `${f.name}\u0000${f.size}`; byName.set(k, [...(byName.get(k) || []), f]); }
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    const shallow = list.slice().sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    for (const f of shallow.slice(0, -1)) { f.copyOf = shallow.at(-1).path; f.role = 'copy'; f.target = null; f.label = 'Quick-access copy'; f.why = `same file as ${shallow.at(-1).path}`; }
  }
  const byTarget = {};
  for (const f of files) if (f.target && !f.older) (byTarget[f.target] ||= []).push(f);
  const pick = (target, role) => (byTarget[target] || []).filter(f => !role || f.role === role).sort((a, b) => b.confidence - a.confidence || b.rank - a.rank)[0]?.path || '';
  const pickRole = (role, ext) => files.filter(f => f.role === role && !f.older && !f.archived && (!ext || f.ext === ext)).sort((a, b) => b.rank - a.rank || b.mtime - a.mtime)[0]?.path || '';
  const topDirs = [...new Set(entries.filter(e => e?.path).map(e => e.dir && !e.path.includes('/') ? e.path : e.path.includes('/') ? e.path.split('/')[0] : null).filter(Boolean))];
  return {
    files,
    byTarget,
    current: {
      evidence: pick('extraction', 'evidence-table'), screening: pick('screening', 'screening-sheet'),
      manuscript: pick('manuscript', 'manuscript'), criteria: pick('criteria'), patients: pick('patients'),
      supplement: pickRole('supplement', 'docx'), checklist: pickRole('checklist', 'docx'), flow: pickRole('prisma-flow', 'docx'),
      references: pickRole('reference-export', 'ris') || pickRole('reference-export', 'bib') || pickRole('reference-export'),
    },
    studies: files.filter(f => f.role === 'study-pdf').sort((a, b) => a.study.no - b.study.no),
    layout: resolveLayout(topDirs, typeId),
    counts: Object.fromEntries(Object.entries(byTarget).map(([k, v]) => [k, v.length])),
  };
}

// ---- organising an existing folder -----------------------------------------
/**
 * The moves that would bring a folder to the standard layout, without making
 * any. Recognised top-level folders are renamed as a whole (their insides
 * keep their own order; "papers" → "Papers", "04 Papers" → "Papers", a case
 * change is a move too); the author-facing output folders of an earlier
 * layout go inside Manuscript ("1 Tables" → "Manuscript/Tables"); loose files
 * at the top level go to the folder for what they are; quick-access copies and
 * superseded versions go to Old versions. Nothing is deleted, the app's own
 * state, AGENTS.md and a plan or readme at the top are not touched, and a move
 * whose destination exists is listed as skipped, not merged
 * (lib/folder-migrate.mjs merges). `creates` are the folders of the layout
 * that will be missing, subfolders included.
 */
export function organisePlan(entries = [], { typeId = 'other' } = {}) {
  const layout = folderLayout(typeId);
  const topDirs = entries.filter(e => e.dir && !e.path.includes('/')).map(e => e.path);
  const taken = new Set(entries.map(e => e.path));
  const std = resolveLayout([], typeId);
  const target = key => layout.folders.find(f => f.key === key)?.dir || std.dirFor(key);
  const moves = [], skipped = [], creates = [];
  const plan = (from, to, why, dir = false) => {
    if (from === to) return;
    const sameName = from.toLowerCase() === to.toLowerCase();
    if ((taken.has(to) && !sameName) || moves.some(m => m.to === to)) { skipped.push({ from, to, why: `${to} exists`, dir }); return; }
    moves.push({ from, to, why, dir, ...(sameName ? { caseOnly: true } : {}) });
  };
  const renamed = new Map();
  for (const d of topDirs) {
    if (d === STATE_DIR || d.startsWith('.')) continue;
    const key = stageOfFolder(d);
    if (!key) continue;
    if (key === 'archive') { if (d !== ARCHIVE) { plan(d, ARCHIVE, `${d} holds earlier versions`, true); renamed.set(d, ARCHIVE); } continue; }
    const to = target(key);
    if (renamed.has(d) || [...renamed.values()].includes(to)) continue;
    if (d !== to) { plan(d, to, `${d} is the ${FOLDERS[key]?.name.toLowerCase() || key} folder`, true); renamed.set(d, to); }
  }
  // A folder named after the tool that wrote into it ("Claude outputs"): each
  // file goes to the folder for what it is, earlier versions to the archive.
  const index0 = folderIndex(entries, { typeId });
  for (const d of topDirs) {
    if (stageOfFolder(d) || d.startsWith('.') || !TOOL_DIR.test(d)) continue;
    // The folder goes to the archive whole, then what is current comes out of it.
    const archived = `${ARCHIVE}/${d}`;
    if (taken.has(archived)) { skipped.push({ from: d, to: archived, why: `${archived} exists`, dir: true }); continue; }
    plan(d, archived, 'named for the tool that wrote it', true);
    for (const f of index0.files.filter(x => x.path.startsWith(`${d}/`))) {
      const key = f.older || f.archived ? null : KEY_OF_ROLE[f.role] || KEY_OF_TARGET[f.target];
      if (key) plan(`${archived}/${f.path.slice(d.length + 1)}`, `${target(key)}/${f.name}`, `${f.label}, from ${d}`);
    }
  }
  // Inside the papers folder: superseded copies go to Old versions/Papers/Superseded.
  for (const e of entries.filter(x => x.dir)) {
    const parts = e.path.split('/');
    if (parts.length !== 2 || !['papers', 'literature'].includes(stageOfFolder(parts[0]))) continue;
    if (/^superseded/i.test(parts[1])) {
      const parent = renamed.get(parts[0]) || parts[0];
      plan(`${parent}/${parts[1]}`, `${ARCHIVE}/${baseOf(parent)}/Superseded`, 'earlier copies of included papers', true);
    }
  }
  // Loose files at the top level.
  const index = folderIndex(entries, { typeId });
  for (const f of index.files) {
    if (f.path.includes('/')) continue;
    // the guide, the app's state, lock files, and a plan or readme kept beside the guide stay at the top
    if (['guide', 'app-state', 'lock-file'].includes(f.role) || /^(plan|readme|todo|notes)\.md$/i.test(f.name)) continue;
    if (f.role === 'copy') { plan(f.path, `${ARCHIVE}/Quick-access copies/${f.name}`, `same file as ${f.copyOf}`); continue; }
    if (f.older) { plan(f.path, `${ARCHIVE}/${f.name}`, 'an earlier version'); continue; }
    const key = KEY_OF_TARGET[f.target] || KEY_OF_ROLE[f.role];
    if (!key) continue;
    plan(f.path, `${target(key)}/${f.name}`, f.label);
  }
  const after = new Set([...topDirs.map(d => renamed.get(d) || d), ...moves.filter(m => m.dir).map(m => m.to)]);
  const lower = new Set([...after].map(d => d.toLowerCase()));
  for (const dir of layoutDirs(layout)) {
    if (after.has(dir) || taken.has(dir)) continue;
    const top = dir.split('/')[0];
    // a subfolder whose stage keeps a person's own name ("Evidence table" stays where it was skipped) is not made beside it
    if (dir.includes('/') && !after.has(top) && !taken.has(top) && !creates.includes(top)) continue;
    if (!dir.includes('/') && lower.has(dir.toLowerCase())) continue;
    creates.push(dir);
  }
  const lock = index.files.filter(f => f.role === 'lock-file' && !f.path.includes('/')).map(f => f.path);
  return { layout, moves, skipped, creates, lock, guide: !taken.has(GUIDE) };
}

const KEY_OF_TARGET = { library: 'search', pdf: 'papers', screening: 'screening', extraction: 'data', patients: 'patients', manuscript: 'manuscript',
  criteria: 'protocol', protocol: 'protocol', 'search-log': 'search' };
const KEY_OF_ROLE = { 'reviewer-comments': 'submission', 'table-doc': 'tables', 'figures-doc': 'figures', 'cover-letter': 'submission',
  figure: 'figures', supplement: 'supplement', consent: 'case', image: 'images', script: 'analysis', report: 'data', 'retrieval-list': 'screening',
  'prisma-flow': 'screening', 'prisma-report': 'screening', 'candidate-cases': 'screening', checklist: 'submission', 'reference-export': 'manuscript', 'reference-list': 'manuscript' };
// Folders named for an assistant or a generic output bin, not for what they hold.
const TOOL_DIR = /^(claude|chatgpt|gpt|copilot|gemini|ai|llm|assistant|agent)\b.*|\boutputs?$|^exports?$|^new folder( \d+)?$|^untitled folder( \d+)?$/i;

/** A plan's moves reversed, for the undo log: last move first. */
export const undoMoves = moves => moves.slice().reverse().map(m => ({ from: m.to, to: m.from, dir: m.dir }));

/** A path after a list of moves: a moved file, or a file inside a moved folder. */
export function movedPath(path, moves = []) {
  let p = path;
  for (const m of moves) {
    if (p === m.from) p = m.to;
    else if (p.startsWith(`${m.from}/`)) p = m.to + p.slice(m.from.length);
  }
  return p;
}

// ---- versioned outputs -------------------------------------------------------
/**
 * The next name for an output, and what to archive to make room: the current
 * version in `dir` of "<stem> vN.<ext>" (any extension of the same set) moves
 * to Old versions/<dir>/vN/, and the new file is v(N+1). `names` are the file names
 * in `dir` now; a set (xlsx and csv of one table) shares one version.
 */
export function nextVersion(names = [], stem, { archive = ARCHIVE, dir = '' } = {}) {
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} v(\\d+)\\.([a-z0-9]+)$`, 'i');
  const current = names.map(n => ({ n, m: re.exec(n) })).filter(x => x.m).map(x => ({ name: x.n, version: Number(x.m[1]) }));
  const top = current.reduce((a, c) => Math.max(a, c.version), 0);
  const archiveDir = `${archive}/${dir ? `${dir}/` : ''}v${top}`;
  return {
    version: top + 1,
    name: ext => `${stem} v${top + 1}.${ext}`,
    previous: top,
    moves: current.map(c => ({ from: dir ? `${dir}/${c.name}` : c.name, to: `${archive}/${dir ? `${dir}/` : ''}v${c.version}/${c.name}` })),
    archiveDir,
  };
}

// ---- the guide ---------------------------------------------------------------
const GUIDE_FILES = 10;
export const GUIDE_BEGIN = '<!-- lykos:begin (this part is written by Lykos; edit outside it) -->';
export const GUIDE_END = '<!-- lykos:end -->';

/**
 * AGENTS.md for a project folder: what the project is, where things are, the
 * version and ID rules, and the current files. The part between the markers
 * is Lykos's and is rewritten; anything a person adds outside it is kept.
 */
export function guideText({ name = 'Untitled project', type = '', question = '', layout, current = [], updated = new Date().toISOString().slice(0, 10), studies = 0, dirs = null } = {}, existing = '') {
  const L = layout || folderLayout('other');
  const dirFor = L.dirFor || (k => L.folders.find(f => f.key === k)?.dir || (SUB_KEYS[k] ? `${L.folders.find(f => f.key === SUB_KEYS[k][0])?.dir}/${SUB_KEYS[k][1]}` : ''));
  const papersDir = dirFor('papers') || dirFor('literature');
  const archive = L.archive || ARCHIVE;
  // the tree is the folders this project has (resolveLayout's `used`), in the layout's order; a new project's are the layout's own
  // `dirs`, when given, are the folders on disk (relative paths): a subfolder is listed only where it is there
  const present = (L.used || []).filter(u => u.present);
  const rows = present.length ? present : L.folders;
  const has = d => !dirs || dirs.includes(d);
  const W = 28, line = (lead, label, holds) => (holds ? `${lead}${label}`.padEnd(W) + ` ${holds}` : `${lead}${label}`);
  const tree = [`${name}/`, line('├── ', GUIDE, 'this guide'), line('├── ', `${STATE_DIR}/`, 'Lykos project file and its daily backups (do not edit by hand)')];
  for (const u of rows) {
    tree.push(line('├── ', `${u.dir}/`, u.holds));
    // the layout's subfolders that are there, then the folder's own (Search/Raw exports), by name
    const std = (u.dir === FOLDERS[u.key]?.name ? (u.subs || []) : []).filter(sub => has(`${u.dir}/${sub}`));
    const own = (dirs || []).filter(d => d.startsWith(`${u.dir}/`) && !d.slice(u.dir.length + 1).includes('/')).map(d => d.slice(u.dir.length + 1)).filter(n => !std.includes(n)).sort();
    const subs = [...std, ...own];
    subs.forEach((sub, i) => tree.push(line(`│   ${i === subs.length - 1 ? '└── ' : '├── '}`, `${sub}/`, SUB_HOLDS[`${u.key}/${sub}`] || '')));
  }
  tree.push(line('└── ', `${archive}/`, 'everything superseded, by folder (never deleted)'));
  const earlier = L.kind === 'own' || L.kind === 'numbered';
  const block = [
    GUIDE_BEGIN,
    `## Project`,
    `- Name: ${name}`,
    type ? `- Research type: ${type}` : null,
    question ? `- Question: ${question}` : null,
    studies ? `- Included studies: ${studies}` : null,
    `- Updated: ${updated}`,
    '',
    '## Where things are',
    '```',
    ...tree,
    '```',
    '',
    '## Rules',
    `- One current version of each output lives in its folder, named "<name> vN". Writing a new version moves the previous one to ${archive}/<folder>/vN/. Nothing is deleted.`,
    papersDir ? `- Included reports in ${papersDir}/ are named "NN - Author Year.pdf"; NN is the study's ID in every table. Linked reports of a trial go to ${papersDir}/Companions/, undecided full texts to ${papersDir}/Uncertain/, a removed study to ${papersDir}/Excluded/<reason>/; later IDs are renumbered with their PDFs. Preprints replaced by the published version go to ${archive}/${papersDir}/.` : null,
    `- What the authors hand in is written under ${dirFor('manuscript')}/: ${['tables', 'figures', 'supplement', 'submission'].map(k => `${dirFor(k)}/`).join(', ')}.`,
    earlier ? `- This folder keeps an earlier layout. \`node tools/lykos-layout.mjs <folder> migrate --dry-run\` lists the moves to the current one.` : null,
    '- Keep one copy of each file. The list below is the quick access to the current files; do not copy them to the top level.',
    '- Every value in a table must be traceable to its PDF. Do not derive new numbers by hand.',
    '- Tables and figures start in Lykos: make each one a Lykos output (the app\'s Tables and figures, or the MCP save_output) and render its printed file from it. Never build a table by a script or by hand and import it. If Lykos cannot express one, tell the person.',
    '- Working files (probes, drafts, intermediate exports, agent folders) go in the system temporary folder ($TMPDIR), never in this folder; remove them when done.',
    '- Show your work in Lykos: any Lykos MCP call puts your card in the app for 20 minutes. Name the task with review begin "<what>" (args), step as you go and review end when done.',
    `- The Lykos project is ${STATE_DIR}/project.json with its sections in ${STATE_DIR}/project/. Read it with the Lykos MCP server or \`lykos read\`, never by opening those files; change the review through Lykos.`,
    '',
    // measured 1 Oct – 6 Nov 2026: context re-read every turn and long subagents were most of the spend (restool CLAUDE.md, Working economically)
    '## Token use',
    '- One job per session. A paper session does not change Lykos code: an app gap becomes a task for a development session.',
    '- State comes from Lykos: `lykos completeness`, or the MCP\'s overview, query and find with only the fields needed. Do not open Word files, .lykos/, or anything under Old versions/ or raw search exports to learn the state.',
    `- Search inside the current folders, never the whole project folder, and never ${archive}/. Bound output: \`rg -l\` before content, at most 150 lines shown.`,
    '- Read AGENTS details.md, the plan and the notes by the section named for the task, never whole.',
    '- A paper is read at the page of the value, from its verification text; a value with a proof is not read again.',
    '- Figures: run the display checks; render one only to look at it, at 1200 px.',
    '- Subagents only for independent per-study work, on Sonnet, one study or batch each, answer under 200 words. No workflow unless the owner asks.',
    '- At about 200k context, write a handover to a Lykos task and ask for a fresh session.',
    '',
    '## Current files',
    // every agent reads this guide on every turn: the first ten, and where the rest are (2 Nov 2026: a 36-line list in a 33 KB guide)
    ...(current.length ? current.slice(0, GUIDE_FILES).map(c => `- ${c.label}: ${c.path}${c.version ? ` (v${c.version})` : ''}`) : ['- None written yet.']),
    ...(current.length > GUIDE_FILES ? [`- … and ${current.length - GUIDE_FILES} more: the Lykos MCP's find (kind, dir) or the app's Files list them.`] : []),
    GUIDE_END,
  ].filter(x => x != null).join('\n');
  const text = String(existing || '');
  const a = text.indexOf(GUIDE_BEGIN), b = text.indexOf(GUIDE_END);
  if (a >= 0 && b > a) return text.slice(0, a) + block + text.slice(b + GUIDE_END.length);
  if (text.trim()) return `${text.replace(/\s+$/, '')}\n\n${block}\n`;
  return `# ${GUIDE}: guide for people and AI agents working in this folder\n\n${block}\n`;
}

// ---- where each output goes ---------------------------------------------------
const ACRONYMS = { prisma2020: 'PRISMA 2020', scr: 'ScR', nma: 'NMA', entreq: 'ENTREQ', prior: 'PRIOR', sroc: 'SROC', cca: 'CCA', amstar2: 'AMSTAR 2', prisma: 'PRISMA', care: 'CARE', dta: 'DTA' };
const human = s => { const t = String(s).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().replace(/\b[a-z0-9]+\b/gi, w => ACRONYMS[w.toLowerCase()] || w); return t.charAt(0).toUpperCase() + t.slice(1); };
// Bundle entries (lib/bundle.mjs) by name: the folder key and the name the
// output keeps from version to version. Files of one name in one folder form a
// set that shares a version (Library v3.ris and Library v3.csv).
const OUTPUTS = [
  [/^references\.ris$/, 'search', 'Library'],
  [/^records\.csv$/, 'search', 'Library'],
  [/^search-log\.csv$/, 'search', 'Search log'],
  [/^protocol\.md$/, 'protocol', 'Protocol'],
  [/^report-links\.csv$/, 'data', 'Linked reports'],
  [/^([^/]+)-checklist\.csv$/, 'submission', m => `${human(m[1])} checklist`],
  [/^screening-decisions\.csv$/, 'screening', 'Screening decisions'],
  [/^screening-log\.csv$/, 'screening', 'Screening log'],
  [/^characteristics\.csv$/, 'data', 'Evidence table'],
  [/^extracted-values\.csv$/, 'data', 'Extracted values'],
  [/^codebook\.csv$/, 'data', 'Codebook'],
  [/^appraisal\.csv$/, 'rob', 'Appraisal'],
  [/^appraisal\/traffic-light\.svg$/, 'rob', 'Appraisal traffic light'],
  [/^appraisal\/summary\.svg$/, 'rob', 'Appraisal summary'],
  [/^appraisal\/summary-weighted\.svg$/, 'rob', 'Appraisal summary weighted'],
  [/^analysis\/result\.txt$/, 'analysis', 'Primary outcome result'],
  [/^analysis\/forest\.svg$/, 'analysis', 'Primary outcome forest plot'],
  [/^analysis\/input\.csv$/, 'analysis', 'Primary outcome input'],
  [/^analysis\/[^/]*?-([^/]+)\/(result|forest|input)\.(txt|svg|csv)$/, 'analysis', m => `${human(m[1])} ${m[2] === 'forest' ? 'forest plot' : m[2]}`],
  [/^charting\/(.+)$/, 'charting', m => human(m[1])],
  [/^dta\/(.+)$/, 'analysis', m => `Accuracy ${human(m[1])}`],
  [/^umbrella\/(.+)$/, 'analysis', m => human(m[1])],
  [/^synthesis\/(.+)$/, 'synthesis', m => human(m[1])],
  [/^characteristics\/(.+)\.svg$/, 'analysis', m => `Figure ${human(m[1]).toLowerCase()}`],
  [/^patients\/(.+)\.svg$/, 'analysis', m => `Patients ${human(m[1]).toLowerCase()}`],
  [/^prisma\/flow-diagram\.svg$/, 'screening', 'PRISMA flow'],
  [/^prisma\/counts\.csv$/, 'screening', 'PRISMA counts'],
  [/^ai-use\.md$/, 'manuscript', 'AI use statement'],
  [/^manuscript\/manuscript\.md$/, 'manuscript', 'Manuscript draft'],
  [/^manuscript\/supplements\/captions\.csv$/, 'supplement', 'Supplement captions'],
  [/^manuscript\/supplements\/(.+)$/, 'supplement', m => human(m[1])],
  [/^case\/(.+)\.csv$/, 'manuscript', m => human(m[1])],
];
// Kept in the bundle, not written into the folder: working files and the bundle's own manifest.
const NOT_WRITTEN = /^(notes\.csv|collections\.csv|unresolved\.md|manifest\.json|protocol-versions\.json|manuscript\/manuscript-source\.md)$/;

/** Where a bundle entry goes in a project folder: `{ key, stem, ext }`, or null when it stays out. */
export function outputFor(name) {
  if (NOT_WRITTEN.test(name)) return null;
  const ext = extOf(name);
  for (const [re, key, stem] of OUTPUTS) {
    const m = re.exec(name);
    if (m) return { key, stem: typeof stem === 'function' ? stem(m) : stem, ext };
  }
  const first = name.includes('/') ? name.split('/')[0] : '';
  return { key: stageOfFolder(first) || 'data', stem: human(baseOf(name)), ext };
}

// ---- mapping rows to the project -------------------------------------------
const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const familyOf = a => { const t = String(a ?? '').trim(); if (!t) return ''; if (t.includes(',')) return t.split(',')[0]; const w = t.split(/\s+/); return w.length > 1 && /^[A-Z]{1,3}$/.test(w.at(-1).replace(/\./g, '')) ? w.slice(0, -1).join(' ') : w.at(-1); };

/**
 * The library record a study PDF belongs to, by first author's family name
 * and year ("Di Silvestre 2013", "Özer 2022" matches "Ozer"). A suffix
 * ("2010b") picks among same-name records by their label. Returns
 * `{ paper, how }`, or `{ paper: null, candidates }` when none or several fit.
 */
export function matchStudyPdf(study, papers = []) {
  if (!study) return { paper: null, candidates: [] };
  const author = fold(study.author), year = String(study.year);
  const fits = papers.filter(p => String(p.year || '').slice(0, 4) === year && (() => {
    const fam = fold(familyOf(p.authors?.[0]));
    const label = fold(String(p.label || '').replace(/\d{4}[a-z]?$/, ''));
    return (fam && (fam === author || fam.endsWith(` ${author}`) || author.endsWith(` ${fam}`))) || label === author;
  })());
  if (fits.length === 1) return { paper: fits[0], how: 'author-year' };
  if (fits.length > 1 && study.suffix) {
    const bySuffix = fits.filter(p => new RegExp(`${year}${study.suffix}$`, 'i').test(String(p.label || '')));
    if (bySuffix.length === 1) return { paper: bySuffix[0], how: 'author-year-suffix' };
  }
  // The same paper imported from several databases is one study: records that
  // share a DOI or a title are one work, and the fullest record stands for it.
  const works = new Map();
  for (const p of fits) {
    const key = p.doi ? `doi:${String(p.doi).toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}` : fold(p.title) ? `t:${fold(p.title)}` : `id:${p.id}`;
    const alias = [...works.keys()].find(k => works.get(k).some(q => (p.doi && q.doi && String(q.doi).toLowerCase() === String(p.doi).toLowerCase()) || (fold(q.title) && fold(q.title) === fold(p.title))));
    works.set(alias || key, [...(works.get(alias || key) || []), p]);
  }
  if (works.size === 1) {
    const best = fits.slice().sort((a, b) => (!!b.pdf - !!a.pdf) || (!!b.doi - !!a.doi) || (String(b.abstract || '').length - String(a.abstract || '').length))[0];
    return { paper: best, how: 'author-year-duplicates', duplicates: fits.length };
  }
  return { paper: null, candidates: fits, works: works.size };
}

/** A decision in a cell, in a screening sheet's words: include, exclude, uncertain, or null. */
export function decisionOf(text) {
  const t = fold(text);
  if (!t) return null;
  if (/^(exclude|excluded|no|reject|rejected|irrelevant|ineligible|not eligible|duplicate|red)\b/.test(t) || /\bexclu/.test(t) && !/\binclu/.test(t)) return 'exclude';
  // A negated inclusion ("not included", "do not include") excludes; a hedged one ("maybe include") is uncertain.
  if (/\b(not|no|never|don'?t|do not|cannot)\s+(be\s+)?inclu/.test(t)) return 'exclude';
  if (/^(uncertain|maybe|unclear|unsure|possibly|probably|perhaps|full text review|full text|check|amber|pending|\?)/.test(t) || /\b(maybe|possibly|perhaps|unclear|uncertain|unsure)\b/.test(t)) return 'uncertain';
  if (/^(include|included|yes|eligible|accept|accepted|green|core|supporting)\b/.test(t) || /\binclu/.test(t) && !/\bexclu/.test(t)) return 'include';
  return null;
}

/**
 * Which columns of a screening sheet hold what: the decision (the final or
 * current one first), its reason, the title, DOI, authors and year.
 */
export function screeningColumns(header = []) {
  const h = header.map(fold);
  const find = (...res) => { for (const re of res) { const i = h.findIndex(c => re.test(c)); if (i >= 0) return i; } return -1; };
  return {
    decision: find(/^(final )?decision$/, /^current (recommendation|decision)$/, /^verdict$/, /^decision/, /recommendation/, /decision/, /^include/),
    reason: find(/^reason( for exclusion)?$/, /^reason/, /exclusion reason/, /reason/, /comment/),
    title: find(/^(paper )?title$/, /title/),
    doi: find(/^doi$/, /\bdoi\b/),
    pmid: find(/^pmid$/, /\bpmid\b/),
    authors: find(/^authors?$/, /^first author$/, /author/),
    year: find(/^year$/, /\byear\b/),
  };
}

/** A screening sheet's rows as decisions: `{ title, doi, pmid, authors, year, decision, reason, row }`. */
export function screeningRows(rows = [], columns = null) {
  const { index, cells } = headerRow(rows);
  if (index < 0) return [];
  const c = columns || screeningColumns(cells);
  if (c.title < 0 && c.doi < 0) return [];
  const cell = (r, i) => i >= 0 ? String(r[i] ?? '').trim() : '';
  return rows.slice(index + 1).map((r, k) => ({
    row: index + 2 + k, title: cell(r, c.title), doi: cell(r, c.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase(),
    pmid: cell(r, c.pmid), authors: cell(r, c.authors), year: cell(r, c.year).slice(0, 4),
    decision: decisionOf(cell(r, c.decision)), raw: cell(r, c.decision), reason: cell(r, c.reason),
  })).filter(x => x.title || x.doi);
}

/** A record in the library for a sheet row: DOI, then PMID, then the title with punctuation and case ignored. */
export function matchRecord(row, papers = []) {
  if (row.doi) { const p = papers.find(x => String(x.doi || '').toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '') === row.doi); if (p) return p; }
  if (row.pmid) { const p = papers.find(x => String(x.pmid || '') === row.pmid); if (p) return p; }
  const t = fold(row.title);
  return t ? papers.find(x => fold(x.title) === t) || null : null;
}

/** A criteria sheet (ID, Kind, Stage, Criterion, Tested statement, True when, False when) as protocol criteria. */
export function criteriaRows(rows = []) {
  const { index, cells } = headerRow(rows);
  if (index < 0) return [];
  const h = cells.map(fold);
  const at = re => h.findIndex(c => re.test(c));
  const col = { id: at(/^id$/), kind: at(/^kind|^type/), stage: at(/^stage/), text: at(/^criterion|^criteria|^rule/), question: at(/tested|statement|question/), yes: at(/^true/), no: at(/^false/) };
  const get = (r, i) => i >= 0 ? String(r[i] ?? '').trim() : '';
  return rows.slice(index + 1).map(r => {
    const text = get(r, col.text); if (!text) return null;
    const k = fold(get(r, col.kind));
    return { id: get(r, col.id), text, kind: /excl/.test(k) ? 'exclude' : /group|label/.test(k) ? 'group' : 'include',
      stage: /full/.test(fold(get(r, col.stage))) ? 'Full text' : 'Title/abstract',
      question: get(r, col.question), yes: get(r, col.yes), no: get(r, col.no) };
  }).filter(Boolean);
}
