// Project state, in the shape of the plan's 5.1 evidence contract: mutated in place behind a version number (a clone per edit cost
// 18 ms at 2,000 records) and saved on an idle debounce.
import { agentEditing } from './lib/agent-state.mjs';
import { timing } from './lib/timings.mjs';
// The project's Undo and Redo (update() below): loaded as the store starts, out of the shell's first modules; until it is here no change is a step.
let undoKit = null;
export const undoReady = Promise.all([import('./lib/change-recorder.mjs'), import('./lib/undo-history.mjs')])
  .then(([c, h]) => { undoKit = { recordChanges: c.recordChanges, undoChanges: c.undoChanges, history: h.undoHistory() }; }, err => console.warn('[undo]', err?.message || err));
const nothing = () => null;
const noHistory = { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '', undo: nothing, redo: nothing, clear: nothing, close: nothing, push: nothing };
const historyOf = () => undoKit?.history || noHistory;
const undoListeners = new Set();
const AGENT_WAIT = 3000;   // ms between tries of a save held while another program edits the folder
import { gzipText, gunzipBlob } from './lib/gzip.mjs';
import { trimProject, trimWouldDrop } from './lib/project-trim.mjs';
import { compactScreening } from './lib/rules-key.mjs';
import { separateRecords } from './lib/search-library.mjs';
import { normalizeDatasets, normalizeDataManagement } from './lib/datasets.mjs';
import { adoptFrom, adoptSent, storableSettings } from './lib/app-settings.mjs';
import { inDesktop, readModelCredentialsNative, writeModelCredentialsNative, saveBackupNative } from './lib/native.mjs';
import { migrateValue } from './lib/evidence.mjs';
import { needsArmSplit, splitJoinedArms } from './lib/arms.mjs';
// ---- evidence features (risk of bias per outcome and reviewer, multi-arm studies, double extraction) ----
import { normalizeEvidence } from './lib/evidence-state.mjs';
import { normalizeExtractionSummary } from './lib/extraction-summary-state.mjs';
// ---- end evidence features ----
import { normalizeLabels } from './lib/screen-labels.mjs';
import { normalizeAssignments } from './lib/screen-assign.mjs';
import { normalizeDeclarations, normalizeAuthors } from './lib/declarations.mjs';
import { normalizeJournalProfile, normalizeReviewRounds } from './lib/journal-profile-state.mjs';
import { normaliseSubmissions } from './lib/submissions.mjs';   // the journals the manuscript went to (views/submissions.mjs)
import { normalizeGovernance } from './lib/governance-state.mjs';
// ---- appraisal and synthesis without meta-analysis: the project's own instruments, effect-direction tables ----
import { useToolState } from './schema.mjs';
import { normalizeInstruments } from './lib/appraisal-custom.mjs';
import { normalizeSwim } from './lib/swim-normalize.mjs';
// ---- end appraisal and synthesis ----
// ---- the qualitative coding workspace (lib/qual.mjs) ----
import { normalizeQual } from './lib/qual.mjs';
import { normalizeWorkspace } from './lib/workspace-records.mjs';   // reading list, journal, notes, milestones
import { useFigureStore, idbFigureStore, externalizeFigures, inlineFigures, figureStore, figureRefs, figureGarbage, namedIn } from './lib/figures.mjs';
import { setAbstractsWait } from './lib/late-abstracts.mjs';

const KEY = 'lykos.project';
const DB = 'lykos-project';

const EMPTY = {
  project: null,
  papers: [], values: {}, assessments: {}, prisma: {}, analysis: null,
  screening: {}, searches: [], notes: [], collections: [], merged: [],
  protocol: null, settings: {}, todos: [],
  templates: [], proposals: {}, runs: [], threads: [], rejections: [],
  datasets: [],   // the researcher's own tables (lib/datasets.mjs)
  // data management of a primary study (lib/data-rules.mjs, lib/allocation.mjs):
  // the change log, row locks and verification, settings, sealed allocations
  dataChangeLog: [], dataLocks: {}, dataVerification: {}, dataSettings: { requireReason: false },
  allocations: [], allocationLog: [],
  trialOperations: null, imagingMeasurements: [],
  // writing and submission (lib/manuscript-submission.mjs): the journal the
  // manuscript is checked against, its declarations, and reviewer rounds
  journalProfile: null, declarations: null, reviewRounds: [], reviewRuns: [],
  // appraisal instruments the review defines (lib/custom-instrument.mjs); synthesis without meta-analysis (lib/swim-state.mjs)
  customInstruments: [], swim: null,
  // protocol, registration and governance (lib/protocol-governance.mjs): absent until first edited
  registration: null, ethics: null, sap: null, spiritSchedule: null, checklistChoice: null,
  // the qualitative coding workspace (lib/qual.mjs): absent until a document is added
  qual: null,
  // the extraction data summary's approved mappings, answer cache and notes (lib/extraction-summary-state.mjs): absent until used
  extractionSummary: null,
};

// Folder projects are portable. Connection keys stay in the desktop app's
// private data directory rather than travelling with a shared project folder.
export function portableState(st) {
  const settings = { ...(st.settings || {}) };
  delete settings.ncbiKey;
  delete settings.braveKey;
  delete settings.tinyfishKey;
  delete settings.openalexKey;
  if (settings.ai) { settings.ai = { ...settings.ai }; delete settings.ai.key; }
  if (settings.models) settings.models = { ...settings.models,
    profiles: (settings.models.profiles || []).map(p => { const copy = { ...p }; delete copy.key; delete copy.workspaceId; return copy; }) };
  return { ...st, settings };
}

export function credentialsOf(st) {
  const settings = st.settings || {};
  return {
    ncbiKey: settings.ncbiKey || '',
    ai: settings.ai && { provider: settings.ai.provider, model: settings.ai.model, key: settings.ai.key || '' },
    profiles: (settings.models?.profiles || []).map(p => ({ id: p.id, provider: p.provider, model: p.model, key: p.key || '', ...(p.workspaceId ? { workspaceId: p.workspaceId } : {}) })),
  };
}

export function withLocalCredentials(st, local) {
  if (!local) return st;
  const settings = { ...(st.settings || {}) };
  if (local.ncbiKey) settings.ncbiKey = local.ncbiKey;
  if (settings.ai && local.ai?.key && settings.ai.provider === local.ai.provider && settings.ai.model === local.ai.model)
    settings.ai = { ...settings.ai, key: local.ai.key };
  if (settings.models?.profiles?.length) {
    const byId = new Map((local.profiles || []).map(p => [p.id, p]));
    settings.models = { ...settings.models, profiles: settings.models.profiles.map(p => {
      const found = byId.get(p.id);
      return found?.key && found.provider === p.provider && found.model === p.model ? { ...p, key: found.key, ...(found.workspaceId ? { workspaceId: found.workspaceId } : {}) } : p;
    }) };
  }
  return { ...st, settings };
}

// The project file's format. A file written by a newer Lykos is not opened by
// an older one: saving it back would drop what this version does not know.
// 2: a folder's project file may be a head naming section files (lib/project-format.mjs); a format-1 folder stays format 1 (lib/projects.mjs).
// 3: a large section of the head may be in chunk files (lib/project-format.mjs APP_FORMAT); a folder is written in its own format.
export const PROJECT_FORMAT = 3;
// The format a whole project file says (an export, a backup, a visible copy): it has no section or chunk files, where alone 3 differs
// from 2, so it stays 2 though WRITE_FORMAT is 3 (Task 7): a format-2 Lykos opens it. A folder's format is its head's (fileFormat).
export const WHOLE_FORMAT = 2;

/**
 * A saved project as this version holds it: every collection present, older
 * value and screening shapes brought forward. Anything that is not a project
 * object — a foreign JSON file, a list, a newer format — is refused rather
 * than read as an empty project, which the first save would write over it.
 */
export function assertProject(saved, { source = 'The project file' } = {}) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error(`${source} is not a Lykos project`);
  if (Number(saved.format) > PROJECT_FORMAT)
    throw new Error(`${source} was saved by a newer version of Lykos; update Lykos to open it`);
  if (saved.papers != null && !Array.isArray(saved.papers)) throw new Error(`${source} is not a Lykos project`);
  for (const k of ['values', 'screening', 'settings'])
    if (saved[k] != null && (typeof saved[k] !== 'object' || Array.isArray(saved[k]))) throw new Error(`${source} is not a Lykos project`);
  return saved;
}
export function normalizeProject(saved, { source = 'The project file', onTrim = null, report = null } = {}) {
  assertProject(saved ?? {}, { source });
  saved ??= {};
  report?.guard?.(saved);   // review F7: the sections a normalizer below may change, copied first (lib/normalize-report.mjs)
  // A fresh copy of the defaults: a project without papers must not push its
  // first paper into EMPTY's own array, shared with every later load.
  const next = { ...structuredClone(EMPTY), ...saved, format: PROJECT_FORMAT };
  for (const k of Object.keys(EMPTY)) if (next[k] == null && EMPTY[k] != null) next[k] = structuredClone(EMPTY[k]);
  for (const k of Object.keys(next.values)) next.values[k] = migrateValue(next.values[k]);
  // Evidence tables imported before arms joined each two-arm study's cells; one value per arm now (lib/arms.mjs).
  (next.templates || []).forEach((t, i) => { if (!needsArmSplit(t, next.values)) return; const r = splitJoinedArms({ template: t, values: next.values }); next.templates[i] = r.template; next.values = r.values; });
  compactScreening(next);   // older projects carried the rules on every proposal
  separateRecords(next);    // an id in both main's records and a protocol scenario's: main's stays, the copy merged into it (Settled 1)
  next.customInstruments = normalizeInstruments(next.customInstruments);   // before normalizeEvidence, which needs every instrument id
  if (next.swim != null) next.swim = normalizeSwim(next.swim);
  // ---- evidence features: robReview from assessments, multiArm, doubleExtraction, extractionLog (lib/evidence-state.mjs) ----
  normalizeEvidence(next);
  if (next.extractionSummary != null) next.extractionSummary = normalizeExtractionSummary(next.extractionSummary);
  // ---- end evidence features ----
  // ---- screening and import (plan B3, E1, E4, E6): labels, assignments, ranking runs, the watched folder
  if (next.screeningLabels != null) next.screeningLabels = normalizeLabels(next.screeningLabels);
  if (next.screeningAssignments != null) next.screeningAssignments = normalizeAssignments(next.screeningAssignments);
  if (next.rankingRuns != null && !Array.isArray(next.rankingRuns)) next.rankingRuns = [];
  if (next.importWatch != null && (typeof next.importWatch !== 'object' || Array.isArray(next.importWatch) || typeof next.importWatch.dir !== 'string')) delete next.importWatch;
  // ---- end screening and import
  // ---- reporting (plan K1): why each PRISMA count entered by hand was entered, by field id
  if (next.prismaNotes != null) next.prismaNotes = Object.fromEntries(Object.entries(typeof next.prismaNotes === 'object' && !Array.isArray(next.prismaNotes) ? next.prismaNotes : {})
    .filter(([, v]) => typeof v === 'string' && v.trim()));
  // ---- end reporting
  next.datasets = normalizeDatasets(next.datasets);
  normalizeDataManagement(next);
  next.journalProfile = normalizeJournalProfile(next.journalProfile);
  // the one author list (plan W9a): ids, affiliations[], the corresponding author's flag, CRediT roles moved in from the declarations
  if (next.paper) { const a = normalizeAuthors(next.paper, next.declarations); next.paper = a.paper; next.declarations = { ...(next.declarations || {}), contributions: a.contributions }; }
  next.declarations = normalizeDeclarations(next.declarations, next.paper);
  next.reviewRounds = normalizeReviewRounds(next.reviewRounds);
  if (!Array.isArray(next.reviewRuns)) next.reviewRuns = [];   // a manuscript version's review runs (lib/review-checks.mjs normalises them where they are read)
  next.submissions = normaliseSubmissions(next.submissions);   // absent or malformed: an empty list; unknown keys kept
  normalizeGovernance(next);   // registration, ethics, sap, spiritSchedule, checklistChoice
  normalizeWorkspace(next);    // reading, journal, projectNotes, noteTemplates, milestones (lib/workspace-records.mjs)
  // kept analyses of the datasets (lib/dataset-analysis.mjs): an entry without its result is dropped
  if (next.qual != null) next.qual = normalizeQual(next.qual);
  if (next.datasetAnalyses != null) next.datasetAnalyses = Array.isArray(next.datasetAnalyses) ? next.datasetAnalyses.filter(a => a && a.id && a.datasetId && a.result && typeof a.result === 'object') : [];
  report?.collect?.(next);   // what the normalizers dropped, before the trim (a copy of its own) and the sent log's move (app-wide)
  // The trim is one-way: what it would drop (imported sheet columns, old workflow runs) is handed over, and the trim waits until load()
  // has kept that copy (finding 13; review F13: no trim without a kept copy). A caller that keeps none gets the project untrimmed.
  const trimWaits = !!onTrim && trimWouldDrop(next);
  if (trimWaits) onTrim({ ...next });
  if ('sentLog' in next) { adoptSent(next.sentLog); delete next.sentLog; }   // app-wide, never in a project
  if (!trimWaits) trimProject(next);   // once: retrieval logs, imported sheet rows and old workflow runs kept to what is read (lib/project-trim.mjs)
  return next;
}

// A copy, not a spread: an edit made before the project loads (a startup job
// entry) would otherwise push into EMPTY's own arrays and reappear in every
// project normalised after it.
let state = structuredClone(EMPTY);
let generation = 0;
/** Imports, recovery and backend switches invalidate async work captured in memory. */
export const projectGeneration = () => generation;
useToolState(() => state);   // tool lists and lookups see the open project's own instruments (schema.mjs)
let version = 0;
let indexVersion = 0;
let savedAt = 0;      // stamp of the last write this tab made or loaded
let saveToken = '';    // identity of that exact write, including same-ms saves
let dirty = false;    // unsaved local changes
let saveFailed = '';  // why the last save did not happen; '' once one succeeds
export const saveError = () => saveFailed;
let aside = null;              // what the last read's normalizing set aside (keepAside, review F7)
const asideSeen = new Set();   // the lists already copied this session
/** What the last read set aside: { count, sections, kept, error }, or null. */
export const asideState = () => aside;
/** Whether the open project is shared with this person for viewing only (a Drive folder): nothing is written. */
export const viewOnly = () => !!backend?.readOnly;
let credentialsFailed = '';   // why the model keys were not written to the shell's credentials file; the project itself is saved either way
export const credentialsError = () => credentialsFailed;
// The open project was replaced by the one on disk (a second window, a sync service). Told after the swap, with the recovery count.
const replacedListeners = new Set();
export const onProjectReplaced = fn => { replacedListeners.add(fn); return () => replacedListeners.delete(fn); };
const projectReplaced = (conflicts = null) => { for (const l of replacedListeners) { try { l({ copies: recoveryCount, conflicts }); } catch {} } };
// The folder copy as last read or written: the merge base (lib/project-merge.mjs), and what a save compares with (only savedAt
// changed: nothing written). Per top-level section; where the shell keeps the base (backend.mergeBase) only hashes are held
// (the text was 18 MB of string for the ASD review, 28 Oct 2026), hashed when quiet, off the save. A recorded change skips the
// comparison. forceWrite: a retried backup writes anyway.
let base = null, baseParts = null, forceWrite = false, changed = false, hashT = null;
const hashedBase = () => !!backend?.mergeBase;
async function baseProject() {
  if (base) return base;
  // the base of the project this window holds: none when the backend's kept base is of a read this window did not take
  if (hashedBase()) { try { base = normalizeProject(await backend.mergeBase(seenReads)); } catch { base = null; } return base; }
  if (baseParts) base = JSON.parse(joinParts(baseParts.map(e => (isChunkBase(e[1]) ? [e[0], chunkBaseText(e[1])] : e))));
  return base;
}
const hashOf = t => [textHash(t), t.length];
const setBase = held => {
  baseParts = held; base = null; clearTimeout(hashT);
  if (held && hashedBase()) {
    hashT = setTimeout(() => {
      if (baseParts === held) baseParts = held.map(e => (typeof e[1] === 'string' ? [e[0], textHash(e[1]), e[1].length]
        : isChunkBase(e[1]) ? [e[0], { ...e[1], chunks: e[1].chunks.map(c => (typeof c === 'string' ? hashOf(c) : c)) }] : e));
    }, 1500);
    hashT.unref?.();
  }
};
// Dirty sections (Task 8): a format-2 save stringifies only the top-level keys an update read or wrote (`touched`, through a proxy of
// the top level); the rest are as the last save wrote them: `keptText` holds a key's text when the head holds it inline, null for a section
// file (its hash is the backend's). The first save after a load, every tenth and the one on close stringify all and compare: a change
// made outside update() is written there ('save: untracked change').
let touched = new Set(), touchAll = true, keptText = null, sinceFull = 0, fullNext = false;
const FULL_EVERY = 10;
const ALWAYS = new Set(['savedAt', 'format', 'settings']);   // made on every save
const touch = k => { if (typeof k === 'string') touched.add(k); };
const forgetKept = () => { touchAll = true; keptText = null; touched = new Set(); marks = new Map(); sinceFull = 0; };
// Chunked sections (format 3, docs/superpowers/specs/2026-11-01-chunked-sections-design.md, "Knowing what changed"): a section the head
// on disk keeps in chunks (`chunkedKeys`, from backend.chunkedEntries) is reached inside update() through a proxy of its own, which marks
// what was read or written: a map's keys, a list's indexes, and from where a list's length changed (`marks`: key -> { all, keys, from }).
// The save stringifies the chunks those fall in (a key's bucket, an index's chunk); iterating the section (Object.keys, for…of) marks it
// all. Only while an update runs: outside one, and in the project itself, the section is its own object. A format-2 folder has no chunked
// section, so nothing of this runs there. What the save compares with is per chunk (baseParts: { entry, chunks: [text | [hash, length]] }).
let chunkedKeys = new Set(), marks = new Map(), formatLib = null;
// the backend's read count the project in memory is of (backend.readCount): a save says it, and one made after a read this window did
// not take is stale (lib/projects.mjs write), so it is merged rather than written over the newer file
let seenReads = null;
const subOf = new WeakMap(), rawOfSub = new WeakMap();
const rawOf = v => (v && typeof v === 'object' && rawOfSub.get(v)) || v;
// a value written at the top: a section proxy in it, or in one of its own fields or items, becomes the section (`s.meta = { log: s.screeningLog }`)
const unwrapped = v => {
  if (!v || typeof v !== 'object') return v;
  if (rawOfSub.has(v)) return rawOfSub.get(v);
  if (!chunkedKeys.size) return v;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) if (v[i] && rawOfSub.has(v[i])) v[i] = rawOfSub.get(v[i]); }
  else for (const k of Object.keys(v)) if (v[k] && rawOfSub.has(v[k])) v[k] = rawOfSub.get(v[k]);
  return v;
};
const markOf = k => { let m = marks.get(k); if (!m) marks.set(k, m = { all: false, keys: new Set(), from: Infinity }); return m; };
const markAll = k => { const m = markOf(k); m.all = true; m.keys.clear(); };
const indexOf = key => {
  if (typeof key !== 'string' || !key.length || key.length > 10) return -1;
  for (let i = 0; i < key.length; i++) { const c = key.charCodeAt(i); if (c < 48 || c > 57 || (c === 48 && i === 0 && key.length > 1)) return -1; }
  return +key;
};
function sectionProxy(k, v) {
  let p = subOf.get(v);
  if (p) return p;
  const list = Array.isArray(v);
  const at = key => {
    const m = markOf(k);
    if (m.all) return;
    if (!list) { if (typeof key === 'string') m.keys.add(key); return; }
    const i = indexOf(key);
    if (i >= 0) m.keys.add(i);
  };
  const length = (t, n) => { const m = markOf(k), to = Number(n); if (!m.all) m.from = Math.min(m.from, Number.isFinite(to) ? Math.min(t.length, to) : 0); };
  p = new Proxy(v, {
    get(t, key) { if (key === Symbol.iterator) markAll(k); else at(key); return Reflect.get(t, key); },
    set(t, key, x) { if (list && key === 'length') length(t, x); else at(key); return Reflect.set(t, key, rawOf(x)); },
    deleteProperty(t, key) { at(key); return Reflect.deleteProperty(t, key); },
    defineProperty(t, key, d) { if (list && key === 'length') length(t, d.value); else at(key); return Reflect.defineProperty(t, key, 'value' in d ? { ...d, value: rawOf(d.value) } : d); },
    getOwnPropertyDescriptor(t, key) { at(key); return Reflect.getOwnPropertyDescriptor(t, key); },
    ownKeys(t) { markAll(k); return Reflect.ownKeys(t); },
  });
  subOf.set(v, p); rawOfSub.set(p, v);
  return p;
}
const tracking = st => new Proxy(st, {
  get(t, k) {
    const v = Reflect.get(t, k);
    if (updating > 0 && chunkedKeys.has(k) && v && typeof v === 'object') return sectionProxy(k, v);
    touch(k); return v;
  },
  // `s.screening = s.screening || {}` puts back the section it read: nothing of it changed
  set(t, k, v) { const x = unwrapped(v); if (!(x === t[k] && chunkedKeys.has(k))) touch(k); return Reflect.set(t, k, x); },
  deleteProperty(t, k) { touch(k); return Reflect.deleteProperty(t, k); },
  defineProperty(t, k, d) { touch(k); return Reflect.defineProperty(t, k, 'value' in d ? { ...d, value: unwrapped(d.value) } : d); },
});
/** The chunked sections the backend's head names now (name -> entry), loading lib/project-format.mjs (already loaded with the read). */
async function readChunked() {
  const entries = backend?.chunkedEntries?.() || null;
  if (entries?.size) formatLib ??= await import('./lib/project-format.mjs');
  chunkedKeys = new Set(entries?.keys() || []);
  return entries || new Map();
}
const isChunkBase = v => !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.chunks) && !!v.entry;
const isChunkPart = v => !!v && typeof v === 'object' && Array.isArray(v.texts);
// the text of a chunked base whose chunks are texts (a browser folder's merge base): its chunks' members joined, a map's in bucket order
const chunkBaseText = b => {
  const inner = b.chunks.map(c => c.slice(1, -1)).filter(Boolean).join(',');
  return b.entry.kind === 'list' ? `[${inner}]` : `{${inner}}`;
};
// the records as the folder keeps them, without their abstracts (`$abstracts`), for what is compared with a chunked `papers`
const asKept = (k, v) => (k === 'papers' && Array.isArray(v) && formatLib ? formatLib.stripAbstracts(v, new Map()).papers : v);
// a chunked section's part for the save (lib/project-format.mjs chunkPart: only the chunks an update touched are made)
const chunkPart = (k, value, mark, held, entry) => (formatLib && (entry || isChunkBase(held)) ? formatLib.chunkPart(value, mark, isChunkBase(held) ? held : null, entry, textHash) : JSON.stringify(value));
/** The base of a saved part: a chunked part becomes its chunks (the new texts, the old base's where none was made) under the entry the head now names. */
function baseOfPart(p, held, entries) {
  if (!isChunkPart(p[1])) return p;
  const e = entries.get(p[0]), old = isChunkBase(held?.[1]) ? held[1].chunks : null;
  if (!e || e.chunks.length !== p[1].texts.length || p[1].texts.some((t, i) => t == null && old?.[i] === undefined)) return [p[0], null];
  return [p[0], { entry: e, chunks: p[1].texts.map((t, i) => t ?? old[i]) }];
}
/** The base of a project just read or merged: a chunked section by its chunks in the split the head names, the others by their text. */
function baseOf(exported, entries, { hashIt = false, held = null } = {}) {
  return Object.keys(exported).flatMap(k => {
    const old = held?.get(k);
    if (old && (!hashIt || typeof old[1] === 'number' || (isChunkBase(old[1]) && old[1].chunks.every(c => typeof c !== 'string')))) return [old];
    const e = entries.get(k), r = e && formatLib ? formatLib.chunkTextsAt(asKept(k, exported[k]), e) : null;
    if (r && r.count === e.chunks.length) return [[k, { entry: e, chunks: hashIt ? r.texts.map(hashOf) : r.texts, loaded: true }]];
    const t = JSON.stringify(exported[k]);
    return t === undefined ? [] : [hashIt ? [k, textHash(t), t.length] : [k, t]];
  });
}
let topProxy = null;   // the running update's proxy, which get() answers
function dirtyParts(obj, keys, full = false, chunkMarks = new Map(), entries = new Map()) {
  const parts = [], held = (entries.size || baseParts?.some(e => isChunkBase(e[1]))) && baseParts ? new Map(baseParts.map(e => [e[0], e])) : null;
  for (const k of Object.keys(obj)) {
    const h = held?.get(k)?.[1];
    if (obj[k] !== undefined && (entries.has(k) || isChunkBase(h))) {
      parts.push([k, chunkPart(k, obj[k], full || keys.has(k) ? 'all' : chunkMarks.get(k), h, entries.get(k))]);
      continue;
    }
    const t = full || keys.has(k) || ALWAYS.has(k) || !keptText.has(k) ? JSON.stringify(obj[k]) : keptText.get(k);
    if (t !== undefined) parts.push([k, t]);
  }
  return parts;
}
const differsFrom = (t, e) => !e || (isChunkPart(t) ? !t.from || !isChunkBase(e[1]) || t.from !== e[1].entry || t.texts.length !== e[1].chunks.length || t.texts.some(x => x != null)
  : isChunkBase(e[1]) || (typeof e[1] === 'number' ? t.length !== e[2] || textHash(t) !== e[1] : t !== e[1]));
export const heldBase = () => baseParts;
// cyrb53
export function textHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
/** [key, JSON] per top-level section; joinParts gives JSON.stringify(obj). */
export function sectionParts(obj) {
  const parts = [];
  for (const k of Object.keys(obj)) {
    const t = JSON.stringify(obj[k]);
    if (t !== undefined) parts.push([k, t]);
  }
  return parts;
}
export const joinParts = parts => `{${parts.map(([k, t]) => `${JSON.stringify(k)}:${t}`).join(',')}}`;
export function partsDiffer(a, b) {
  if (!a || !b) return true;
  const strip = list => list.filter(([k]) => k !== 'savedAt' && k !== 'format');   // the format is the folder's (backend.fileFormat), not an edit
  const x = strip(a), y = strip(b);
  if (x.length !== y.length) return true;
  for (let i = 0; i < x.length; i++) {
    const [ka, ta] = x[i], [kb, tb, lb] = y[i];
    if (ka !== kb) return true;
    if (ta === null) continue;   // not stringified (dirtyParts): as the base
    if (differsFrom(ta, [kb, tb, lb])) return true;
  }
  return false;
}
let merges = 0;   // merges since the last save that was written
let backupHealth = { status: 'unavailable', error: '', at: '' };
export const backupState = () => ({ ...backupHealth });
const setBackupHealth = next => { backupHealth = { ...next }; saveChanged(); };
// Whether the project on disk is current, for the status bar. Its own signal,
// because a save completing must not repaint every view the way an edit does.
const saveListeners = new Set();
export const onSaveState = fn => { saveListeners.add(fn); return () => saveListeners.delete(fn); };
export const saveState = () => saveFailed ? 'failed' : (dirty || pending || flushing) ? 'saving' : 'saved';
const saveChanged = () => { for (const l of saveListeners) l(saveState()); };
let recoveryCount = 0;

// Two tabs on the same project used to each hold a copy and the last to save
// won. Every save is announced; a tab with nothing unsaved reloads on the
// announcement, and no tab overwrites a save newer than the one it loaded.
let chan = null;
const listeners = new Set();

// Where the project is kept. Null is the app's own storage (IndexedDB), the
// only place a project lived before folders; a folder project supplies an
// object with read() and write(state), set before the first load. write
// answers { stale: true } when the copy on disk is newer than the one read.
let backend = null;
let abstractsLate = null, abstractsFailed = null, abstractsIn = true, lateKick = null;   // the late abstracts (takeLateAbstracts)
export function useBackend(b) {
  generation++;
  forgetUndo();
  indexVersion++;
  clearTimeout(backupT); backupT = null; backupDue = false; backupVersion = -1;
  backupHealth = { status: inDesktop() || b?.credentialId || (b?.backupName && tabSafe()) ? 'pending' : 'unavailable', error: '', at: '' };
  backend = b;
  abstractsLate = null; abstractsFailed = null; abstractsIn = true; lateKick = null;
  loaded = false;   // a new place is not loaded until load() reads it
  credentialsFailed = '';
  aside = null; asideSeen.clear();
  // Rendered figures are kept beside the project (lib/figures.mjs): a folder
  // backend brings its own store (.lykos/figures); a project in the app's
  // storage keeps them in IndexedDB under its save channel.
  useFigureStore(b?.figures || idbFigureStore(b?.channel || LOCAL_CHANNEL));
  chan?.close();
  chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(b?.channel || 'lykos-project') : null;
  chan?.unref?.();   // in Node (tests) an open channel would keep the process alive
  chan?.addEventListener('message', onAnnounce);
}

// ---- persistence ---------------------------------------------------------
let db = null;
// The connection is kept, but not a failure: a refused open (storage briefly
// unavailable) or a connection the browser closed (site data cleared) is
// opened again on the next save, instead of failing every save until reload.
function openDb() {
  if (db) return db;
  const opening = db = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('state');
    req.onsuccess = () => { req.result.onclose = () => { if (db === opening) db = null; }; resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
  opening.catch(() => { if (db === opening) db = null; });
  return db;
}
const dbOp = (mode, fn) => openDb().then(d => new Promise((resolve, reject) => {
  const t = d.transaction('state', mode);
  const r = fn(t.objectStore('state'));
  t.oncomplete = () => resolve(r?.result);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
}));

// Every project kept in this browser profile shares one recovery store, so a
// copy's key names the project it came from ("recovery:<time>:<rand>@<owner>"),
// and Settings lists, counts and restores only the open project's own copies
// without reading the others. Keys from before this carry no owner and belong
// to the local project, which was the only one then.
const LOCAL_CHANNEL = 'lykos-project';
export const recoveryOwner = () => backend?.channel || LOCAL_CHANNEL;
const ownerOfKey = key => { const k = String(key); const at = k.indexOf('@'); return at < 0 ? LOCAL_CHANNEL : k.slice(at + 1); };
const ownsRecovery = key => String(key).startsWith('recovery:') && ownerOfKey(key) === recoveryOwner();
const recoveryKey = () => `recovery:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}@${recoveryOwner()}`;
const newToken = () => globalThis.crypto?.randomUUID?.() || recoveryKey();

// A recovery copy is a whole project. Beside each one is a small record of
// what it holds ('recovery-meta:<same suffix>'), so Settings lists copies
// without reading every project back; a copy from before these records gets
// one the first time it is listed.
const META = 'recovery-meta:';
const metaKeyOf = key => META + String(key).slice('recovery:'.length);
const copyFacts = (copy, reason = '') => ({ at: copy?.savedAt || 0, papers: copy?.papers?.length || 0,
  values: Object.keys(copy?.values || {}).length, figures: figureRefs(copy || {}), ...(reason ? { reason } : {}) });
function putCopy(store, copy, key, reason) {
  // A recovery copy never carries a connection key (plan §6.2a); restoring one keeps this machine's.
  copy = portableState(copy);
  store.put(copy, key);
  store.put(copyFacts(copy, reason), metaKeyOf(key));
}
// A copy is kept compressed (plan "Footprint" Task 4): `{ gz: bytes, savedAt, saveToken }`, read back through gunzip. A copy kept
// by an earlier version (the project object itself) still reads. The text is taken at once from the state as it is, so a save
// that follows while the copy compresses changes nothing in it, and waits for nothing.
const isPacked = v => v && typeof v === 'object' && (v.gz instanceof Uint8Array || (typeof Blob !== 'undefined' && v.gz instanceof Blob));
async function unpack(v) {
  if (!isPacked(v)) return v;
  return JSON.parse(await gunzipBlob(v.gz instanceof Uint8Array ? new Blob([v.gz]) : v.gz));
}
function snapshotOf(copy, reason) {
  const portable = portableState(copy);
  return { text: JSON.stringify(portable), facts: copyFacts(portable, reason), savedAt: portable.savedAt || 0, saveToken: portable.saveToken || '' };
}
async function packed(snap) {
  return { gz: new Uint8Array(await (await gzipText(snap.text)).arrayBuffer()), savedAt: snap.savedAt, saveToken: snap.saveToken };
}
/** When a copy was made, from its key; null for a key that does not say. */
export const recoveryMadeAt = key => {
  const m = /^recovery:([0-9a-z]+):/.exec(String(key));
  const t = m ? parseInt(m[1], 36) : NaN;
  return Number.isFinite(t) && t > 0 ? t : null;
};

/**
 * Retention for one project's recovery copies (plan §4.15b): the newest
 * RECOVERY_KEEP are kept, and the newest copy of each calendar day of the last
 * RECOVERY_DAYS days; the rest are pruned. The newest copy is always kept, a
 * copy whose key does not say when it was made is never pruned, and another
 * project's copies are never considered. A copy kept before something one-way
 * (KEPT_APART: a trim, a normalize that dropped values, a save over the day's
 * start that the folder's backup failed to keep; review F13, F7, F28) is kept
 * apart: it neither counts toward that rule nor is pruned by it, and only the
 * newest KEPT_APART_MAX of each such reason are kept. `reasons` maps a key to
 * its copy's reason. Answers the keys to prune.
 */
export const RECOVERY_KEEP = 6, RECOVERY_DAYS = 7;
export const BEFORE_TRIM = 'before trim', BEFORE_NORMALIZE = 'before normalize', DAY_START = "the day's start, folder backup failed";
export const KEPT_APART = Object.freeze([BEFORE_TRIM, BEFORE_NORMALIZE, DAY_START]), KEPT_APART_MAX = 20;
export function recoveryPrunable(keys, now = Date.now(), reasons = new Map()) {
  const apart = k => KEPT_APART.includes(reasons.get(k));
  const drop = [];
  for (const reason of KEPT_APART) {
    const own = keys.filter(k => reasons.get(k) === reason).map(k => ({ k, t: recoveryMadeAt(k) })).filter(x => x.t != null).sort((a, b) => b.t - a.t);
    drop.push(...own.slice(KEPT_APART_MAX).map(x => x.k));
  }
  const dated = keys.filter(k => !apart(k)).map(k => ({ k, t: recoveryMadeAt(k) })).filter(x => x.t != null).sort((a, b) => b.t - a.t);
  const keep = new Set(dated.slice(0, RECOVERY_KEEP).map(x => x.k));
  const days = new Set();
  for (const x of dated) {
    if (now - x.t > RECOVERY_DAYS * 86_400_000) break;
    const day = new Date(x.t).toDateString();
    if (!days.has(day)) { days.add(day); keep.add(x.k); }
  }
  return [...dated.filter(x => !keep.has(x.k)).map(x => x.k), ...drop];
}
const ownKeys = async () => (await dbOp('readonly', s => s.getAllKeys())).filter(ownsRecovery);
/** Prunes the open project's copies by the retention rule; answers how many it keeps. */
async function pruneRecoveries(now = Date.now()) {
  const keys = await ownKeys();
  // each copy's reason, from its record: a copy kept apart is never taken for an ordinary one (a record that does not read counts as one)
  const facts = await getMany(keys.map(metaKeyOf));
  const reasons = new Map(keys.map((k, i) => [k, facts[i]?.reason || '']));
  const drop = recoveryPrunable(keys, now, reasons);
  if (drop.length) await dbOp('readwrite', s => { for (const k of drop) { s.delete(k); s.delete(metaKeyOf(k)); } });
  return keys.length - drop.length;
}
/** Keeps the open project as it is now (`copy`) as a compressed recovery copy, then applies the retention rule; answers the count. */
async function keepCopy(copy, reason, key = recoveryKey(), extra = null) {
  // a copy of the window's project while the log's earlier entries are still to come says how many it lacks (restoreRecovery puts them back)
  const before = lateLog && copy && Array.isArray(copy.screeningLog) ? backend?.lateLogCount?.() || 0 : 0;
  if (before > 0) copy = { ...copy, screeningLogBefore: before };
  const snap = snapshotOf(copy, reason);   // taken now, before anything else can change the state
  if (extra) Object.assign(snap.facts, extra);
  const value = await packed(snap);
  snap.facts.bytes = value.gz.length;
  await dbOp('readwrite', s => { s.put(value, key); s.put(snap.facts, metaKeyOf(key)); });
  try { return await pruneRecoveries(); } catch { return (await ownKeys().catch(() => [key])).length; }
}
/**
 * Once a session, after load: the open project's copies kept by an earlier version (whole objects) are compressed, one at a time,
 * each in its own transaction and only if the copy is still there unchanged. Answers how many were compressed.
 */
export async function compactRecoveries() {
  let done = 0;
  for (const key of await ownKeys().catch(() => [])) {
    const value = await dbOp('readonly', s => s.get(key)).catch(() => null);
    if (!value || isPacked(value) || typeof value !== 'object') continue;
    const snap = snapshotOf(value), next = await packed(snap);
    const ok = await openDb().then(d => new Promise(resolve => {
      const t = d.transaction('state', 'readwrite'), st = t.objectStore('state'), r = st.get(key);
      let wrote = false;
      r.onsuccess = () => {
        const cur = r.result; if (!cur || isPacked(cur) || (cur.savedAt || 0) !== (value.savedAt || 0)) return;
        st.put(next, key); wrote = true;
        const m = st.get(metaKeyOf(key));
        m.onsuccess = () => st.put({ ...(m.result || snap.facts), bytes: next.gz.length }, metaKeyOf(key));
      };
      t.oncomplete = () => resolve(wrote); t.onerror = () => resolve(false); t.onabort = () => resolve(false);
    })).catch(() => false);
    if (ok) done++;
  }
  return done;
}

// The read and conditional write share one IndexedDB transaction. Two tabs
// cannot both pass a separate read and then overwrite each other's project.
//
// The save's identity is also kept on its own small record, 'meta'. Reading
// the whole project back to compare one token cost as much as writing it (180
// ms a save at 20,000 records, bench/perf); the meta record answers the usual
// case, where nobody else saved. The project itself is read only when meta is
// missing (a project saved before meta existed) or names another save, so a
// meta record out of step with the project can never cause a false conflict.
// A build without meta that writes the project leaves meta behind; such a
// write is not seen as a conflict by this check, which is why every write
// here keeps both records in the same transaction.
const identity = rec => rec ? { savedAt: rec.savedAt || 0, saveToken: rec.saveToken || '' } : null;
const isNewer = (disk, expectedAt, expectedToken) => Boolean(disk) && (disk.saveToken
  ? disk.saveToken !== expectedToken
  : (disk.savedAt || 0) > expectedAt);
function commitProject(snapshot, expectedAt, expectedToken) {
  return openDb().then(d => new Promise((resolve, reject) => {
    const tx = d.transaction('state', 'readwrite');
    const store = tx.objectStore('state');
    let result = null;
    const commit = () => {
      store.put(snapshot, 'project');
      store.put(identity(snapshot), 'meta');
      result = { conflict: false };
    };
    const decide = disk => {
      if (!isNewer(identity(disk), expectedAt, expectedToken)) { commit(); return; }
      const key = recoveryKey();
      putCopy(store, snapshot, key, 'conflict');
      result = { conflict: true, disk, key };
    };
    const meta = store.get('meta');
    meta.onsuccess = () => {
      if (meta.result && !isNewer(meta.result, expectedAt, expectedToken)) { commit(); return; }
      const read = store.get('project');
      read.onsuccess = () => decide(read.result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  }));
}

export const getRecoveryCount = () => recoveryCount;
// Several records in one read transaction, in the order asked.
const getMany = keys => !keys.length ? Promise.resolve([]) : openDb().then(d => new Promise((resolve, reject) => {
  const t = d.transaction('state', 'readonly'), s = t.objectStore('state'), out = new Array(keys.length);
  keys.forEach((k, i) => { const r = s.get(k); r.onsuccess = () => { out[i] = r.result; }; });
  t.oncomplete = () => resolve(out);
  t.onerror = () => reject(t.error);
}));
/** The open project's recovery copies, newest first, read from their small records. */
export async function listRecoveries() {
  let keys = await ownKeys();
  if (keys.length) { try { await pruneRecoveries(); keys = await ownKeys(); } catch {} }
  const facts = await getMany(keys.map(metaKeyOf));
  const copies = [];
  for (let i = 0; i < keys.length; i++) {
    let f = facts[i];
    if (!f) {   // a copy kept before its record existed: read once, then recorded
      const data = await dbOp('readonly', s => s.get(keys[i]));
      f = copyFacts(await unpack(data));
      await dbOp('readwrite', s => s.put(f, metaKeyOf(keys[i]))).catch(() => {});
    }
    copies.push({ key: keys[i], at: f.at || 0, papers: f.papers || 0, values: f.values || 0, made: recoveryMadeAt(keys[i]), ...(f.reason ? { reason: f.reason } : {}), ...(f.bytes ? { bytes: f.bytes } : {}) });
  }
  recoveryCount = copies.length;
  return copies.sort((a, b) => b.at - a.at || (b.made || 0) - (a.made || 0));
}
export async function readRecovery(key) {
  if (!String(key).startsWith('recovery:')) throw new Error('Invalid recovery key');
  if (!ownsRecovery(key)) throw new Error('This recovery copy belongs to another project');
  return unpack(await dbOp('readonly', s => s.get(key)));
}
export async function restoreRecovery(key) {
  let boundary = generation;
  const copy = await readRecovery(key);
  if (generation !== boundary) throw new Error('The project changed while the recovery copy was being read.');
  if (!copy?.papers || !copy?.values) throw new Error('Recovery copy is unavailable');
  // kept while the log's earlier entries were still to come: they are the log's first entries now (it is only appended to), put back
  if (Number.isInteger(copy.screeningLogBefore) && copy.screeningLogBefore > 0) {
    const n = copy.screeningLogBefore;
    delete copy.screeningLogBefore;
    if (!abstractsIn) await whenAbstracts();
    boundary = generation;
    const now = Array.isArray(state.screeningLog) ? state.screeningLog : [], first = Array.isArray(copy.screeningLog) ? copy.screeningLog[0] : undefined;
    if (now.length < n || (first !== undefined && JSON.stringify(now[n]) !== JSON.stringify(first)))
      throw new Error('This recovery copy was kept while the screening log was still being read, and the log no longer starts as it did; it was not restored.');
    copy.screeningLog = [...now.slice(0, n), ...(copy.screeningLog || [])];
  }
  await keepCurrentForReplacement('before restore', boundary, () =>
    update(() => normalizeProject(withLocalCredentials(copy, credentialsOf(state)), { source: 'The recovery copy' })));
  await persist();
}

const credentialsSaved = new Map();   // credential id → the keys last written for it
let pending = null;
let holding = null;     // a figure clean-up in progress (saves wait for it)
let inflight = null;    // the write in progress, for persist() to wait on
let pendingSince = 0;   // when the oldest unsaved edit was scheduled
let flushing = false;

// Nothing is saved until a project has been loaded into this window: a write
// before then carries the empty starting state, and saved it would replace the
// project on disk (a startup job log entry was enough to do it).
let loaded = false;

// A trailing debounce: continuous typing would otherwise stringify the whole
// project every few hundred milliseconds. MAX_WAIT still writes during a long
// run of edits; pagehide, visibilitychange and persist() flush at once.
const SAVE_DEBOUNCE = 1000, SAVE_MAX_WAIT = 5000;

/** Writes once edits pause, at least every SAVE_MAX_WAIT, and always before the page goes. */
function schedulePersist() {
  if (!loaded) return;
  const now = Date.now();
  const fresh = !pending;
  if (fresh) pendingSince = now;
  else clearTimeout(pending);
  pending = setTimeout(flush, Math.max(0, Math.min(SAVE_DEBOUNCE, pendingSince + SAVE_MAX_WAIT - now)));
  if (fresh) saveChanged();
}

let closing = false;   // the window is going away: its edits are written whatever else is happening, as a full save
/** The window is closing (app.mjs quitApp), or with false stays after all. */
export const closingWindow = (on = true) => { closing = !!on; };
function flush() {
  clearTimeout(pending);
  pending = null;
  if (!loaded) return Promise.resolve();
  // Another program is editing the folder (lib/agent-activity.mjs): this window's save waits until it is done, so neither overwrites the other.
  if (agentEditing() && !closing) { pending = setTimeout(flush, AGENT_WAIT); return Promise.resolve(); }
  // Figure clean-up holds saves while it decides; the save follows it.
  if (holding) return holding.then(() => flush());
  // A timer can fire while IndexedDB is still writing the previous version.
  // The active flush schedules another pass in finally when that happens.
  if (flushing) return inflight;
  flushing = true;
  inflight = write().finally(() => { inflight = null; });
  return inflight;
}

async function write() {
  const began = performance.now();
  try { return await writeNow(); } finally { timing('save', began); }
}
async function writeNow() {
  let wrote = false;
  const writing = version;   // the edits this write carries
  let carried = null, wasAll = false, carriedMarks = null;
  try {
    // Ruling 23: a save with edits waits for the late abstracts (a failed read is tried again); a clean window has nothing to write
    if (backend && !abstractsIn) {
      if (!dirty && !forceWrite) { wrote = true; return; }
      const own = backend, gen = generation;
      await whenAbstracts();
      if (backend !== own || generation !== gen) return;
    }
    // Rendered figures leave the project before it is written: stored by
    // hash beside it, named in the result (lib/figures.mjs). A figure the
    // store does not take stays inline and is saved with the project.
    try { if ((await externalizeFigures(state))?.moved) { touch('analysis'); touch('analyses'); } } catch {}
    // Review F7: values a read set aside whose copy could not be kept hold every save until it is; it is tried again here, and a
    // refusal is this save's error (nothing is written)
    if (aside?.pending) {
      try { recoveryCount = await keptAside(aside.pending); }
      catch (err) { throw new Error(`values set aside when the project was read have no copy yet (${err?.message || err})`); }
    }
    if (backend?.readOnly) {
      // A Drive folder shared for viewing: edits stay in this window and are never written.
      saveFailed = 'view only: the folder is shared with you for viewing';
      emit();
      return;
    }
    if (backend) {
      // A folder project: the backend answers stale when the copy on disk is
      // newer than the one this window read, and this window reloads instead.
      const at = Math.max(Date.now(), savedAt + 1);
      const writingVersion = version;
      // Only a folder project keeps its keys outside its file; an app-storage
      // project keeps them in its own record, as the local project does.
      if (inDesktop() && backend.credentialId) {
        // Written when they change, not with every save: the shell rewrites
        // and syncs its whole credential file each time it is asked.
        const creds = JSON.stringify(credentialsOf(state));
        if (credentialsSaved.get(backend.credentialId) !== creds) {
          // A refused credentials file must not stop the project from saving (finding 7): it is its own state, tried again on the next save.
          try {
            await writeModelCredentialsNative(backend.credentialId, credentialsOf(state));
            credentialsSaved.set(backend.credentialId, creds);
            credentialsFailed = '';
          } catch (err) { credentialsFailed = String(err?.message || err || 'refused').slice(0, 120); }
        }
      }
      // A folder backend strips keys itself (exportableState); a project kept in the app's storage is written
      // with the app-wide keys left out, so each key is in one place.
      const outgoing = backend.credentialId ? state : { ...state, settings: storableSettings(state.settings) };
      // Stringified once, here (the backend writes this text): no copy of the project is made for the merge base or a worker.
      const t0 = performance.now();
      const sectioned = !!backend.wantsParts?.();
      const full = !sectioned || touchAll || forceWrite || closing || fullNext || !keptText || !baseParts || sinceFull >= FULL_EVERY - 1;
      carried = touched; touched = new Set(); wasAll = touchAll; touchAll = false; fullNext = false;
      carriedMarks = marks; marks = new Map();
      // format 3: the sections the head keeps in chunks; each is made chunk by chunk (chunkPart), only those an update touched unless full
      const entries = sectioned ? await readChunked() : new Map();
      const exported = exportableState(outgoing);
      // the folder's own format (a format-1 folder says format 1, though this version reads format 2)
      if (backend.fileFormat) exported.format = backend.fileFormat();
      // a format-2 folder keeps its records' abstracts apart (the `$abstracts`
      // section): the file is written without them, and the abstracts only when one changed
      const took = !!backend.keepAbstracts && (full || carried.has('papers') || carriedMarks.has('papers'));
      let abstracts = took ? await backend.keepAbstracts(exported) : null;
      const parts = full && !entries.size && !baseParts?.some(e => isChunkBase(e[1])) ? sectionParts(exported) : dirtyParts(exported, carried, full, carriedMarks, entries);
      // a chunked `papers` that moved with no update telling (a record pushed outside one) is made without its abstracts, and they go to `$abstracts`
      const pi = took || !backend.keepAbstracts ? -1 : parts.findIndex(p => p[0] === 'papers');
      if (pi >= 0 && (isChunkPart(parts[pi][1]) ? parts[pi][1].texts.some(t => t != null) : entries.has('papers') && typeof parts[pi][1] === 'string')) {
        abstracts = await backend.keepAbstracts(exported);
        parts[pi] = dirtyParts({ papers: exported.papers }, carried, full, carriedMarks, entries)[0];
      }
      // a key no update touched whose text moved was changed outside update(): written with the rest, and noted
      if (full && !wasAll && sectioned && baseParts) {
        const held = new Map(baseParts.map(e => [e[0], e]));
        for (const [k, t] of parts) if (!carried.has(k) && !carriedMarks.has(k) && !ALWAYS.has(k) && held.has(k) && differsFrom(t, held.get(k))) { timing('save: untracked change', t0); break; }
      }
      const known = changed; changed = false;
      // an abstract changed is a change, though the file's parts are the same
      if (!forceWrite && !known && abstracts == null && !partsDiffer(parts, baseParts)) { timing('save: unchanged', t0); wrote = true; dirty = version !== writingVersion; return; }
      state.savedAt = outgoing.savedAt = at;
      const stampAt = parts.findIndex(p => p[0] === 'savedAt');
      if (stampAt >= 0) parts[stampAt][1] = String(at); else parts.push(['savedAt', String(at)]);
      // format 2 writes from the parts (only the sections that changed): no joined text is made
      const text = backend.wantsParts?.() ? null : joinParts(parts);
      forceWrite = false;
      timing('save: stringify', t0);
      const result = await backend.write(outgoing, { text, abstracts, parts, format: exported.format, seen: seenReads, logShrinks: logShrank(), keepStart });
      if (result?.backup) setBackupHealth(result.backup);
      // A newer save (a teammate, another window) is merged against what this window read (lib/project-merge.mjs); a value both
      // changed keeps theirs and this window's copy for recovery. A backend refusing every save is merged twice, then loaded.
      const mergeBase = result?.stale && (baseParts || hashedBase()) && merges < 2 ? await baseProject() : null;
      if (mergeBase) {
        const { mergeProjects, equal } = await import('./lib/project-merge.mjs');
        // a read that fails (still syncing) keeps the edits first, as below
        const next = await readSaved().catch(async err => { recoveryCount = await keepCopy({ ...state }, 'newer save on disk'); throw err; });
        await keepAside(next);
        let { merged: both, conflicts } = mergeProjects(mergeBase, state, next.project);
        // review F29: the side that lost a conflict is kept as a recovery copy before the merge replaces it; a copy that cannot be kept
        // leaves this window's project as it is (the save error says why). An edit made while a copy was kept is merged again, and a
        // conflict that remains is copied again, so no edit is merged away without a copy holding it.
        for (let at = -1; conflicts.length && at !== version;) {
          at = version;
          recoveryCount = await keepCopy({ ...state }, 'edits that conflicted with a newer save');
          if (version !== at) ({ merged: both, conflicts } = mergeProjects(mergeBase, state, next.project));
        }
        // keys are never in a saved copy: this window's stay
        const merged = withLocalCredentials(both, credentialsOf(state));
        seenReads = next.seen ?? null;
        backend.took?.(seenReads);
        setBase(baseOf(exportableState(next.project), await readChunked()));
        generation++; indexVersion++;
        if (next.recoveries != null) recoveryCount = next.recoveries;
        // the merge can bring an id into both main's records and a scenario's (one window promoted it, the other edited the copy)
        separateRecords(merged);
        state = merged;
        forgetUndo(); forgetKept();
        savedAt = state.savedAt || 0;
        // a merge equal to the copy on disk: nothing to write
        dirty = !equal(merged, next.project);
        if (dirty) merges++;
        version++;
        emit();
        if (conflicts.length) projectReplaced(conflicts);
        if (dirty) schedulePersist();
        return;
      }
      merges = 0;
      if (result?.stale) {
        // Someone else's save is newer and is loaded. This window's unsaved
        // edits are kept as a recovery copy first, never simply dropped; if
        // the copy cannot be kept, nothing is loaded and the save error says so.
        if (dirty) recoveryCount = await keepCopy({ ...state }, 'newer save on disk');
        const at = version;
        const next = await readSaved();
        await keepAside(next);
        // Edits made while the newer copy was read are kept the same way.
        const late = version !== at;
        const kept = late ? await keepCopy({ ...state }, 'newer save on disk') : null;
        const hadEdits = dirty || late;
        apply(next);
        if (late) recoveryCount = kept;
        if (hadEdits) projectReplaced();
        return;
      }
      wrote = true;
      merges = 0;
      savedAt = at;
      {
        // a chunked part's base is its chunks under the entry the head now names (the texts made, the old base's for the rest)
        if (result?.seen != null) seenReads = result.seen;
        // the entries the head just written names (the write's own answer: no read since can move them)
        const held = new Map((baseParts || []).map(e => [e[0], e])), after = result?.chunked || await readChunked();
        if (result?.chunked) chunkedKeys = new Set(after.keys());
        const next = parts.map(p => (isChunkPart(p[1]) ? baseOfPart(p, held.get(p[0]), after) : full || carried.has(p[0]) || ALWAYS.has(p[0]) ? p : held.get(p[0]) || p));
        if (next.some(e => e[1] === null)) { setBase(null); touchAll = true; } else setBase(next);
      }
      const files = sectioned && Array.isArray(result?.sections) ? new Set(result.sections) : null;
      if (files) {
        keptText = new Map(parts.map(([k, t]) => [k, t === null || isChunkPart(t) || files.has(k) ? null : t]));
        sinceFull = full ? 0 : sinceFull + 1;
      } else { keptText = null; touchAll = true; }
      dirty = version !== writingVersion;
    } else {
      const nextAt = Math.max(Date.now(), savedAt + 1);
      const nextToken = newToken();
      const writingVersion = version;
      const outcome = await commitProject({ ...state, settings: storableSettings(state.settings), savedAt: nextAt, saveToken: nextToken }, savedAt, saveToken);
      wrote = true;
      if (outcome.conflict) {
        // the other tab's save is normalized as a read is (review F7, F13): what it drops kept as a copy first, the trim after its copy
        const disk = await normalizeRead(outcome.disk);
        // The conditional transaction already saved the local state. Capture
        // any edits made while that transaction was pending before loading the
        // other tab's version into this tab.
        if (version !== writingVersion) {
          const backingVersion = version;
          const snap = snapshotOf({ ...state, savedAt: nextAt, saveToken: nextToken }, 'conflict'), value = await packed(snap);
          snap.facts.bytes = value.gz.length;
          await dbOp('readwrite', s => { s.put(value, outcome.key); s.put(snap.facts, metaKeyOf(outcome.key)); });
          if (version !== backingVersion) {
            recoveryCount++;
            dirty = true;
            return; // a newer edit is still live; the next flush backs it up
          }
        }
        recoveryCount++;
        try { recoveryCount = await pruneRecoveries(); } catch {}
        const hadEdits = dirty || version !== writingVersion;
        state = disk;
        forgetUndo();
        generation++;
        indexVersion++;
        savedAt = outcome.disk.savedAt || 0;
        saveToken = outcome.disk.saveToken || '';
        dirty = false;
        version++; emit();
        if (hadEdits) projectReplaced();
        return;
      }
      savedAt = nextAt;
      saveToken = nextToken;
      state.savedAt = nextAt;
      state.saveToken = nextToken;
      // IndexedDB clones the value when put() runs. Edits made while that
      // request was pending are in memory but may not be in the saved clone.
      dirty = version !== writingVersion;
    }
    if (saveFailed) { saveFailed = ''; emit(); }
    chan?.postMessage({ savedAt });
    if (!backend || backend.backupName) backup();
  } catch (err) {
    // Storage refused. Keep working in memory rather than losing the edit, and
    // say so: an unsaved project that looks saved is the worst outcome.
    saveFailed = String(err?.message || err || 'refused').slice(0, 120);
    if (carried) { for (const k of carried) touched.add(k); touchAll = true; }
    if (carriedMarks) for (const k of carriedMarks.keys()) touched.add(k);
    emit();
  } finally {
    flushing = false;
    saveChanged();
    if (wrote && dirty && !pending) schedulePersist();
    // Whoever waited for these edits to reach disk (or for the attempt to end) goes on.
    if (wrote) writtenVersion = Math.max(writtenVersion, writing);
    const done = wrote ? savedWaiters.filter(w => w.v <= writing) : savedWaiters;
    savedWaiters = savedWaiters.filter(w => !done.includes(w));
    done.forEach(w => w.resolve());
  }
}

// In the packaged app every save of a project kept in the app's own storage
// (the local project, and each project created there) also lands as a JSON
// file the user can find without the app (plan §7), named by the project's
// id; at most one write every half minute, and none when nothing changed since
// the last one. The project file itself is written on every save; this copy is
// the one found without the app, so it may run behind. A folder project is
// already a file, with its own daily backups.
const BACKUP_EVERY = 30_000;
let backupT = null, backupDue = false, backupVersion = -1;
const tabSafe = () => !inDesktop() && typeof indexedDB !== 'undefined' && typeof CompressionStream !== 'undefined';
function backup() {
  if (!inDesktop() && !tabSafe()) return;
  backupDue = true;
  if (backupHealth.status !== 'failed') setBackupHealth({ ...backupHealth, status: 'pending' });
  if (backupT) return;
  backupT = setTimeout(runBackup, BACKUP_EVERY);
  backupT.unref?.();   // a pending copy never keeps a Node process (the tests) alive
}
async function runBackup() {
  backupT = null;
  if (!backupDue || (backend && !backend.backupName) || version === backupVersion) return;
  backupDue = false;
  const owner = generation, revision = version, name = backend?.backupName || 'local';
  setBackupHealth({ ...backupHealth, status: 'running' });
  try {
    // No clone of the project (plan "Footprint" Task 4): the figures are read first, then the text is made in one synchronous
    // step from the state as it then is; an edit landing while figures were read starts the read again.
    let text = null;
    for (let tries = 0; tries < 3 && text == null; tries++) {
      const at = version, inlined = await inlineFigures(portableState(state));
      if (at === version) text = JSON.stringify(inlined);
    }
    text ??= JSON.stringify(await inlineFigures(structuredClone(portableState(state))));
    if (inDesktop()) await saveBackupNative(name, text);
    else await (await import('./lib/browser-backups.mjs')).keepDailyCopy(name, text, new Date().toISOString().slice(0, 10));
    if (generation !== owner) return;
    backupVersion = revision;
    setBackupHealth({ status: 'current', error: '', at: new Date().toISOString() });
    if (version !== revision) backup();
  } catch (err) {
    if (generation !== owner) return;
    setBackupHealth({ status: 'failed', error: String(err?.message || err), at: backupHealth.at || '' });
    backupDue = true; backupT = setTimeout(runBackup, BACKUP_EVERY); backupT.unref?.();
  }
}
/** Retry the safety copy independently from the main save's health. */
export async function retryBackup() {
  if (backend && !backend.backupName) { dirty = true; forceWrite = true; await persist(); }
  else if (inDesktop() || tabSafe()) { clearTimeout(backupT); backupT = null; backupDue = true; backupVersion = -1; await runBackup(); }
  return backupState();
}

/** Reads the project again from disk after another program edited it (lib/agent-activity.mjs); a window with edits of its own saves
 * them instead, and a newer file on disk then becomes the usual conflict (its edits kept as a recovery copy). */
export async function reloadFromDisk({ ifClean = false } = {}) {
  if (!loaded) return;
  if (await lateFirst()) return;
  if (ifClean && (dirty || pending || flushing)) return;   // mid-run: this window's own edits are not flushed over the program's work
  if (dirty || pending || flushing) { await flush(); return; }
  if (await savedOutside()) return;
  const at = version;
  let next;
  try { next = await readSaved({ reuse: true }); } catch { return; }
  await keepAside(next);
  if (version !== at || dirty || pending || flushing) return;
  if (!next) return;
  apply(next);   // a script's write keeps the old savedAt, so the file is taken whatever it says
}
/** A read again comes after the late abstracts (a failed read tried again); answers true when they are still not in: read nothing more. */
async function lateFirst() {
  if (abstractsIn) return false;
  try { await whenAbstracts(); return false; } catch { return true; }
}
/** Before a clean window takes the file on disk, a change made outside update() (no save wrote it) is saved and merged, never dropped. Only
 *  the sections the disk changed (backend.movedSections, from the head) are compared with what this window last read or wrote; the others
 *  stay as they are in memory. A backend that cannot tell has every section compared. */
async function savedOutside() {
  if (!baseParts || !backend?.wantsParts?.()) return false;
  const onDisk = backend.movedSections ? await backend.movedSections().catch(() => null) : null;
  const held = new Map(baseParts.map(e => [e[0], e])), exported = exportableState(state);
  const moved = Object.keys(exported).some(k => {
    if ((onDisk && !onDisk.has(k)) || ALWAYS.has(k) || !held.has(k)) return false;
    const h = held.get(k);
    const t = isChunkBase(h[1]) ? chunkPart(k, asKept(k, exported[k]), 'all', { ...h[1], loaded: false }, null) : JSON.stringify(exported[k]);   // compared, chunk by chunk
    return t !== undefined && differsFrom(t, h);
  });
  if (!moved) return false;
  fullNext = true; dirty = true;
  await flush();
  return true;
}

// A save elsewhere: take it, unless this tab has edits of its own in flight.
// The read is asynchronous; an edit made while it runs wins, and this tab's
// next save reconciles the two (a newer save on disk becomes a conflict).
async function onAnnounce(e) {
  if (!e.data?.savedAt || e.data.savedAt <= savedAt) return;
  if (await lateFirst()) return;
  if (dirty || pending || flushing) return;   // will be reconciled on this tab's next flush
  if (await savedOutside()) return;
  const at = version;
  let next;
  try { next = await readSaved({ reuse: true }); } catch { return; }
  await keepAside(next);
  if (version !== at || dirty || pending || flushing) return;
  apply(next);
}
useBackend(null);

if (typeof window !== 'undefined') {
  // A debounced write must not be the reason an edit is lost on close.
  addEventListener('pagehide', () => { closing = true; if (pending || dirty) flush(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && (pending || dirty)) { closing = true; flush().finally(() => { closing = false; }); }
  });
}

// The records' abstracts after the first view (chunked-sections spec): read once the first view is drawn (startLateAbstracts), by
// whatever waits for them, or after LATE_BY. abstractsIn: they are on the records (or none were deferred). A failed read is read again
// only when the person asks (retryAbstracts: Retry, Quit's Retry) or when the head names other `$abstracts` chunks, that check made at
// most every LATE_BACKOFF (doubling to 10 min): a wait otherwise rejects at once, with no read and no emit. whenReady() is the one gate of
// every model run, inbox, workflow and export: null once they are in, else the wait.
export const abstractsLoading = () => !abstractsIn;   // still to come, or failed: no view says "No abstract"
let retryAsked = false, lateCheckAt = 0, lateBackoff = 0;
const LATE_BACKOFF = 30_000;
/** The person asked to try again (Retry): the abstracts and the log are read again, once, at once (first-page review R1: a clean window
 *  has no save that would wait for them). */
export const retryAbstracts = () => { retryAsked = true; whenAbstracts().catch(() => {}); };
export const whenAbstracts = () => {
  if (abstractsIn) return Promise.resolve();
  if (!abstractsLate && abstractsFailed) {
    const own = backend, failed = abstractsFailed;
    if (retryAsked) { retryAsked = false; lateAttempt(own, () => own.retryLateAbstracts()); }
    else if (Date.now() >= lateCheckAt) {
      lateBackoff = Math.min(lateBackoff ? lateBackoff * 2 : LATE_BACKOFF, 600_000); lateCheckAt = Date.now() + lateBackoff;
      lateAttempt(own, async () => { if (!await own.lateAbstractsChanged()) throw failed; return own.retryLateAbstracts(); }, failed);
    }
  }
  lateKick?.();
  return abstractsLate || Promise.reject(abstractsFailed);
};
export const whenReady = () => (abstractsIn ? null : whenAbstracts());
export const startLateAbstracts = () => { lateKick?.(); };
const LATE_BY = 2000;
setAbstractsWait(whenReady);
// The screening log's earlier chunks (open-size brief, "The screening log after the first page"): while `lateLog` is set ({ tail: the
// entries the open read }), the window's log is the later chunks of the head it read, plus what the window appended. The late read brings
// the earlier ones, and they go before it: the log is only ever appended to, so what the window added stays after them. Whatever an update
// does to the project object meanwhile (a reducer that returns a new one), the log is still that one; only a read that brings the whole log
// (apply of a read with no late log) clears it (late log review L1: a generation counter is not the head the log came from).
let lateLog = null;
// the log's length in the read this window holds, with the earlier entries once merged: an update that leaves the log shorter is a person's
// removal (a test's cut; no view does it), said to the backend, which otherwise refuses to write a log shorter than the one it read
let logRead = 0;
const logShrank = () => !lateLog && Array.isArray(state?.screeningLog) && state.screeningLog.length < logRead;
/** The late read's answer merged into the project the window holds now (and into `into`, a copy kept before a trim). */
async function mergeLate(late, into = state, { log = true } = {}) {
  const abstracts = late?.abstracts;
  if (abstracts && typeof abstracts === 'object') (await import('./lib/project-format.mjs')).mergeAbstracts(into, abstracts);
  if (Array.isArray(late?.log) && log) into.screeningLog = [...late.log, ...(Array.isArray(into.screeningLog) ? into.screeningLog : [])];
}
function lateAttempt(own, read, same = null) {
  abstractsFailed = null;
  const late = abstractsLate = Promise.resolve().then(read).then(async got => {
    if (backend !== own) return;
    if (!got || typeof got !== 'object') throw new Error('the project file names no abstracts');
    const map = got.abstracts || {}, hadLog = Array.isArray(got.log) && !!lateLog;
    // earlier entries read but not to be put back: only when a whole read since brought the whole log (the backend then holds no late log);
    // never said "merged" otherwise, so the backend goes on refusing to write the log
    if (Array.isArray(got.log) && !hadLog && own.hasLateLog?.()) throw new Error('the screening log\'s earlier entries could not be put back');
    // the head-time log, for a base of it (below): the earlier chunks, then the entries the open read
    const headLog = hadLog ? [...got.log, ...(state.screeningLog || []).slice(0, lateLog.tail)] : null;
    await mergeLate(got, state, { log: hadLog });
    if (hadLog) logRead += got.log.length;   // the records as they are now: one replaced meanwhile takes its abstract, one with its own keeps it
    lateLog = null;
    // the records copies were taken of in the window: a duplicate merged, a record removed (its undo puts the copy back)
    const fill = r => { if (r && r.abstract === undefined && typeof map[r.id] === 'string') r.abstract = map[r.id]; };
    for (const m of state.merged || []) fill(m?.dup);
    for (const t of state.libraryTrash || []) fill(t?.paper);
    own.abstractsMerged?.();
    forgetUndo();   // an earlier step could put back a record without its abstract, or a log without its earlier entries
    abstractsIn = true;
    if (saveFailed.startsWith(LATE_FAILED)) saveFailed = '';
    const clean = !dirty && baseFor === state;
    if (hadLog) {
      // marks of the window were of the later entries' places: the next save compares everything; a base made from the parts (a browser's
      // folder) is of the whole log the head holds, so a merge with a newer save sees the window's entries as appended
      marks.delete('screeningLog'); touched.add('screeningLog'); fullNext = true;
      if (Array.isArray(baseParts) && !hashedBase()) {
        const entries = backend?.chunkedEntries?.() || new Map(), exported = exportableState({ ...state, screeningLog: headLog });
        const [b] = baseOf({ screeningLog: exported.screeningLog }, entries, { hashIt: false }).map(e => (e[0] === 'screeningLog' ? e : null)).filter(Boolean);
        if (b) setBase(baseParts.map(e => (e[0] === 'screeningLog' ? b : e)));
      }
    }
    version++; indexVersion++;
    if (clean) planBase(version);
    emit(); saveChanged();
  }, err => {
    if (err === same) { abstractsFailed = same; throw same; }   // nothing changed on disk: not read, nothing said again
    if (backend === own) {
      abstractsFailed = new Error(`${LATE_FAILED}${String(err?.message || err).slice(0, 100)}`);
      saveFailed = abstractsFailed.message.slice(0, 120);
      emit(); saveChanged();
    }
    throw abstractsFailed || err;
  }).finally(() => { if (abstractsLate === late) abstractsLate = null; });
  late.catch(() => {});
  return late;
}
const LATE_FAILED = 'The records\' abstracts or the screening log could not be read: ';
function takeLateAbstracts() {
  abstractsFailed = null; lateKick = null; abstractsLate = null; retryAsked = false; lateCheckAt = 0; lateBackoff = 0;
  const own = backend;
  abstractsIn = !own?.hasLateAbstracts?.();
  lateLog = !abstractsIn && own.hasLateLog?.() ? { tail: Array.isArray(state.screeningLog) ? state.screeningLog.length : 0 } : null;
  if (abstractsIn) return;
  let kick;
  const asked = new Promise(r => { kick = r; });
  lateKick = () => { lateKick = null; kick(); };
  setTimeout(() => lateKick?.(), LATE_BY).unref?.();
  lateAttempt(own, () => asked.then(() => own.lateAbstracts()));
}

/** Review F28: the project as the folder held it before the day's first save, when the folder's own copy of it could not be made (a full
 *  or read-only .lykos/backups): kept here before the save writes over it. `whole` is the joined project, as text or bytes. */
async function keepStart(whole) {
  const text = typeof whole === 'string' ? whole : new TextDecoder().decode(whole);
  recoveryCount = await keepCopy(JSON.parse(text), DAY_START);
}

/** A copy of the window's project kept for recovery (Quit without saving while the abstracts cannot be read): what it holds is not lost. */
export async function keepUnsavedCopy(reason = 'not saved at quit') { recoveryCount = await keepCopy({ ...state }, reason); return recoveryCount; }

/** Loads the project, migrating anything left in localStorage by an older build. */
export async function load() {
  const read = await readSaved({ late: true });
  // The one-time trim drops imported sheet columns and old runs for good: the project as it was is kept as a recovery copy first (with its abstracts).
  if (read.pretrim && backend?.hasLateAbstracts?.()) { try { await mergeLate(await backend.lateAbstracts(), read.pretrim); } catch { /* said by whenAbstracts */ } }
  // review F13: no trim without a kept copy; a copy that cannot be kept leaves the project untrimmed (the next open tries again)
  if (read.pretrim) { try { read.recoveries = await keepCopy(read.pretrim, BEFORE_TRIM); trimProject(read.project); } catch (err) { console.warn('[store] pre-trim copy: the project is not trimmed', err); } }
  await keepAside(read);
  const t = performance.now();
  apply(read);
  takeLateAbstracts();
  timing('load: apply', t);
  // Once a session, some time after the project opens, unused figures go.
  if (!cleanupPlanned && typeof window !== 'undefined') {
    cleanupPlanned = true;
    const cleanup = setTimeout(() => { figureCleanup({ apply: true }).catch(() => {}).then(() => compactRecoveries()).catch(() => {})
      .then(() => import('./lib/raw-slim.mjs')).then(m => m.slimStoredRaw(get, update)).catch(() => {}); }, 30_000);
    cleanup.unref?.();
  }
  return state;
}

// ---- figure clean-up (plan §4.15b) -----------------------------------------
// A stored figure may go only when nothing that can still be opened names it:
// the project as it is here and as it is stored (another window may have saved
// since), every recovery copy the retention rule keeps, the folder's backups
// and its other files under .lykos (outputs logs, MCP definitions, copies kept
// before migrations), all scanned for hashes as text. A backup file of an
// app-storage project carries its figures inline and names none. A figure
// written in the last hour is kept (a window may be about to name it), and so
// is one whose age is not known; each removal is one step, all or nothing.
let cleanupPlanned = false;
async function figureReferences(stored) {
  // Only the stored figures matter: each is looked for by name, and the search
  // stops early once every one is known to be named.
  const hashes = stored.map(f => f.hash), all = () => refs.size >= hashes.length;
  // the project's own text a slice at a time (lib/state-size.mjs: stringified whole it held the page a second on 30,000 records)
  const refs = await (await import('./lib/state-size.mjs')).namedInState(() => state, () => version, hashes, namedIn);
  for (const key of await ownKeys()) {
    if (all()) return refs;
    const facts = await dbOp('readonly', s => s.get(metaKeyOf(key)));
    if (Array.isArray(facts?.figures)) for (const h of facts.figures) refs.add(h);
    else { const v = await dbOp('readonly', s => s.get(key)); namedIn(isPacked(v) ? await gunzipBlob(v.gz instanceof Uint8Array ? new Blob([v.gz]) : v.gz) : JSON.stringify(v || {}), hashes, refs); }
  }
  if (all()) return refs;
  if (backend?.referenceTexts) { for await (const text of backend.referenceTexts()) { namedIn(text, hashes, refs); if (all()) break; } }
  else if (!backend) namedIn(JSON.stringify((await dbOp('readonly', s => s.get('project'))) || {}), hashes, refs);
  return refs;
}
/**
 * What a clean-up would free, and with `apply` does it: `{ available, count,
 * bytes, removed, freed, failed, young, unknown, kept, total }`. Never during a
 * save: it waits for one in progress, and saves wait for it.
 */
export async function figureCleanup({ apply = false, now = Date.now() } = {}) {
  if (!loaded) throw new Error('The project has not finished loading');
  const store = figureStore();
  if (!store?.list) return { available: false, reason: 'This project keeps no figures apart.' };
  if (apply && !store.canRemove) return { available: false, reason: 'Figures are not removed from a folder opened in a browser.' };
  while (inflight || holding) { await (inflight || holding).catch?.(() => {}); }
  let release;
  holding = new Promise(r => { release = r; });
  try {
    try { await pruneRecoveries(now); } catch {}
    const stored = await store.list();
    const refs = stored.length ? await figureReferences(stored) : new Set();
    const plan = figureGarbage(stored, refs, now);
    let removed = 0, freed = 0;
    const failed = [];
    if (apply) {
      for (const f of plan.remove) {
        try { await store.remove(f.hash); removed++; freed += f.bytes; } catch { failed.push(f.hash); }
      }
      if (store.stamp) for (const f of plan.unknown) await store.stamp(f.hash).catch(() => {});
    }
    return { available: true, count: plan.remove.length, bytes: plan.bytes, removed, freed, failed, young: plan.young.length, unknown: plan.unknown.length, kept: plan.kept, total: stored.length };
  } finally {
    holding = null;
    release();
  }
}

/** The project as stored, normalised, with its recovery-copy count; nothing in memory changes. `reuse`: keep unchanged sections (`kept`). */
async function readSaved({ reuse = false, late = false } = {}) {
  let saved = null, pretrim = null, kept = null, seen = null;
  const onTrim = copy => { pretrim = copy; };
  // review F7: what the normalizers drop is listed (lib/normalize-report.mjs, loaded beside the read, off the startup graph)
  const reporting = import('./lib/normalize-report.mjs').then(m => m.createReport(), () => null);
  // the recovery copies are counted beside the read (an IndexedDB open and a key list: 21 ms of the opening when it came after it)
  const counting = dbOp('readonly', s => s.getAllKeys()).then(k => k.filter(ownsRecovery).length, () => null);
  if (backend) {
    // A folder that cannot be read must not look like an empty project: an
    // empty project would be saved over the real one on the first edit. The machine's keys are read beside it.
    const keys = inDesktop() && backend.credentialId ? readModelCredentialsNative(backend.credentialId) : null;
    keys?.catch(() => {});
    // the read's own count, told as it completes (not asked after: another read may have completed meanwhile)
    const onCount = n => { seen = n; };
    const raw = reuse && backend.lastKept ? await backend.read({ reuse: state, onCount }) : await backend.read({ onCount, late });
    kept = reuse ? backend.lastKept?.() || null : null;
    await readChunked();   // lib/project-format.mjs, for apply's base of the chunked sections
    const report = await reporting;
    let t = performance.now();
    saved = normalizeProject(raw, { onTrim, report });
    t = timing('load: normalize', t);
    if (keys) { saved = withLocalCredentials(saved, await keys); timing('load: keys wait', t); }
  // Storage that cannot be read is an error, as a folder's is: read as no
  // project, the local project would open empty. Only a runtime without
  // IndexedDB at all (node) starts from nothing.
  } else if (typeof indexedDB !== 'undefined') saved = await dbOp('readonly', s => s.get('project'));
  if (!saved && !backend) {
    try {
      const legacy = localStorage.getItem(KEY);
      if (legacy) {
        saved = JSON.parse(legacy);
        localStorage.removeItem(KEY);   // it does not fit here; do not keep two copies
      }
    } catch {}
  }
  const report = await reporting;
  const project = backend ? saved : normalizeProject(saved, { onTrim, report });   // a backend's copy was normalized above
  const t = performance.now();
  const recoveries = await counting;
  timing('load: recoveries', t);
  return { project, recoveries, pretrim, kept, seen, report: report?.entries.length ? report : null };
}

// Review F7: a read whose normalizing dropped values keeps the project as read as a recovery copy before it replaces the open one, once
// a session for the same values; the hub says so (asideState), and says a copy that failed too (the read still opens).
async function keepAside(read) {
  // a read that drops nothing leaves a save that waits for an earlier copy waiting: a read again reuses the sections in memory, so it
  // cannot tell whether the values set aside are still on disk
  if (!read?.report) return;
  const { asideOf } = await import('./lib/normalize-report.mjs');
  const pending = asideOf(read.report, read.project);
  if (asideSeen.has(pending.sig)) return;
  try { read.recoveries = await keptAside(pending); }
  catch (err) {
    console.warn('[store] the copy before normalize', err);
    // every save waits until this copy is kept (write() tries it again): the first save would make the loss permanent
    aside = { ...pending.summary, kept: false, error: String(err?.message || err), pending };
  }
}
async function keptAside({ copy, summary, sig, paths }) {
  let n = recoveryCount, file = '';
  try { n = await keepCopy(copy, BEFORE_NORMALIZE, undefined, { aside: { ...summary, paths } }); }
  catch (err) {
    // the app's storage refuses it: a folder keeps it as a file of its own in .lykos/backups instead, so a lasting refusal holds no save
    if (!backend?.keepAsideFile) throw err;
    file = await backend.keepAsideFile(JSON.stringify(portableState(copy)));
  }
  asideSeen.add(sig);
  aside = { ...summary, kept: true, error: '', ...(file ? { file } : {}) };
  return n;
}
/** The other tab's save as a read gives it: normalized, what it drops kept as a copy, trimmed once its copy is kept. */
async function normalizeRead(raw) {
  const report = await import('./lib/normalize-report.mjs').then(m => m.createReport(), () => null);
  let pretrim = null;
  const project = normalizeProject(raw, { report, onTrim: c => { pretrim = c; } });
  if (pretrim) { try { await keepCopy(pretrim, BEFORE_TRIM); trimProject(project); } catch (err) { console.warn('[store] pre-trim copy: not trimmed', err); } }
  await keepAside({ project, report: report?.entries.length ? report : null });
  return project;
}

// Synchronous from here on: an edit cannot land between the project being
// replaced and the tab being marked clean, where it would be neither saved nor
// shown as unsaved.
let baseFor = null, planBase = () => {};
function apply({ project, recoveries, kept = null, seen = null }) {
  seenReads = seen;
  backend?.took?.(seen);   // the shell's merge base is this read's from now on
  if (!backend?.hasLateLog?.()) lateLog = null;
  logRead = Array.isArray(project?.screeningLog) ? project.screeningLog.length : 0;   // a read that brings the whole log (the open's sets it again, takeLateAbstracts)
  if (!abstractsIn && backend && !backend.hasLateAbstracts?.()) { abstractsIn = true; abstractsFailed = null; if (saveFailed.startsWith(LATE_FAILED)) saveFailed = ''; }   // a whole read brought them
  generation++;
  indexVersion++;
  if (recoveries != null) recoveryCount = recoveries;
  // sections a read again kept (readSaved reuse) keep their base; hashing all held a frame 746 ms (1 Nov 2026)
  const held = kept?.size && Array.isArray(baseParts) ? new Map(baseParts.filter(e => kept.has(e[0])).map(e => [e[0], e])) : null;
  // the chunked sections the read's head names (readSaved loaded lib/project-format.mjs when there are any)
  const entries = backend?.chunkedEntries?.() || new Map();
  chunkedKeys = new Set(entries.keys());
  const partsOf = (exported, hashIt) => baseOf(exported, entries, { hashIt, held });
  state = project;
  forgetUndo(); forgetKept();
  // the base: a shell-kept one is hashed once quiet and only if nothing changed meanwhile (else unknown: the next save writes)
  baseFor = project;
  planBase = (at = version + 1) => { clearTimeout(hashT); hashT = setTimeout(() => { if (version === at && state === project) { baseParts = partsOf(exportableState(project), true); base = null; } }, 1500); hashT.unref?.(); };
  if (!backend || !hashedBase()) { setBase(backend ? partsOf(exportableState(project), false) : null); planBase = () => {}; }
  else { setBase(null); planBase(); }
  // What the project holds of a person's own settings fills the app-wide ones that are empty (lib/app-settings.mjs); the project is not changed.
  adoptFrom(state.settings);
  savedAt = state.savedAt || 0;
  saveToken = state.saveToken || '';
  dirty = false;
  loaded = true;
  version++;
  emit();
}

/**
 * Which project is open, as an identity: work that outlives a view (a
 * download, a lookup, an open form) checks it is still the same project
 * before it writes. Projects themselves are folders (lib/projects.mjs).
 */
export const projects = () => ({ current: backend?.channel || 'local', list: [] });

// ---- reading and writing -------------------------------------------------
/** The project (while an update runs, its tracking proxy). */
export const get = () => (topProxy && updating > 0 ? topProxy : state);
export const getVersion = () => version;
/** Revision of research inputs. Only audited non-research writes may opt out. */
export const getIndexVersion = () => indexVersion;

/** Views repaint after something outside the project changed what it reads (an app-wide setting). Research mutations use update(). */
export function notify() { version++; emit(); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const l of listeners) l(state); }

/**
 * Applies a change. The reducer receives the live state and may mutate it —
 * cloning a 3 MB project to change one field is what made typing slow.
 * Callers must not hold on to nested objects across an update.
 */
let updating = 0;
/** Whether a reducer is running: the live state may differ from what the version says (a cache keyed on getVersion must not be read). */
export const inUpdate = () => updating > 0;

// ---- Undo and Redo ----------------------------------------------------------
// A change made in answer to the person (a key, a click, a drop or a paste in the window in the 1.5 s before it) is a step of Undo: its
// reducer runs through lib/change-recorder.mjs, which keeps what each write replaced, and lib/undo-history.mjs keeps the steps. Changes from
// timers, syncs and other programs are not steps. Anything that replaces the project (a load, another window's save, a restore) empties it.
const GESTURE_MS = 1500;
let gestureAt = -Infinity, travelling = false;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  for (const type of ['pointerdown', 'keydown', 'input', 'change', 'drop', 'paste']) window.addEventListener(type, () => { gestureAt = Date.now(); }, { capture: true, passive: true });
}
/** Marks the next change as the person's own (a test, or a command run from the palette by keyboard already counts). */
export const markGesture = () => { gestureAt = Date.now(); };

export const onUndoState = fn => { undoListeners.add(fn); return () => undoListeners.delete(fn); };
export const undoState = () => { const h = historyOf(); return { canUndo: h.canUndo, canRedo: h.canRedo, undoLabel: h.undoLabel, redoLabel: h.redoLabel }; };
const undoChanged = () => { for (const l of undoListeners) { try { l(undoState()); } catch {} } };
/** The next change starts a step of its own (the shell calls it on a page change). */
export const closeUndoStep = () => historyOf().close();
// a removal's own step (lib/undo-removal.mjs): every change from beginStep() to endStep() is one step, a gesture's or not
export const beginStep = () => historyOf().begin?.();
export const endStep = label => historyOf().end?.(label) || null;
export const lastStep = () => historyOf().last || null;
function forgetUndo() { const h = historyOf(); if (!h.canUndo && !h.canRedo) return; h.clear(); undoChanged(); }
function travel(go) {
  if (!loaded || backend?.readOnly || updating) return null;
  travelling = true;
  let r = null;
  try { r = go(); } finally { travelling = false; }
  if (!r) return null;
  if (r.keys) for (const k of r.keys) touch(k); else touchAll = true;
  dirty = true; indexVersion++; version++;
  schedulePersist(); emit(); undoChanged();
  return r;
}
/** Takes back the last step; answers { label, writes, keys } or null when there is nothing to undo. */
export const undo = () => travel(() => historyOf().undo());
/** Puts back the last step undone. */
export const redo = () => travel(() => historyOf().redo());

export function update(fn, { indexNeutral = false, label = '' } = {}) {
  let next, steps = false;
  const step = !!undoKit && loaded && !travelling && updating === 0 && (undoKit.history.grouping || Date.now() - gestureAt < GESTURE_MS);
  const outer = !topProxy, s = topProxy ||= tracking(state);
  const own = v => (v === s ? state : v);
  updating++;
  try {
    if (!step) next = own(fn(s));
    else {
      let rec = null;
      try { rec = undoKit.recordChanges(s, fn, { outer: rawOf }); }
      catch (err) {
        if (!Array.isArray(err?.changes)) throw err;
        // Taken back and run again as before there was a recorder: a reducer that cannot run through it (it clones what it reads) still
        // works, and one that throws leaves what it changed before the throw, as it always did. That change is not a step.
        undoKit.undoChanges(err.changes);
        next = own(fn(s));
      }
      if (rec) {
        next = own(rec.result);
        if (next && next !== state) forgetUndo();
        else if (rec.changes.length) { undoKit.history.push(rec.changes, label); steps = changed = true; }
      }
    }
    // the outer reducer would go on writing to the object replaced
    if (!outer && next && next !== state) { next = undefined; throw new Error('An update inside another update cannot replace the project'); }
  }
  finally {
    updating--;
    if (outer) topProxy = null;
    // Whatever the reducer changed before throwing is saved too, and the views redraw.
    dirty = true;
    const replaced = next && next !== state;
    if (replaced) { touchAll = true; if (chunkedKeys.size) for (const k of Object.keys(next)) next[k] = unwrapped(next[k]); }
    if (next) { if (replaced) generation++; state = next; }
    if (!indexNeutral || replaced) indexVersion++;
    version++;
    schedulePersist();
    emit();
    if (steps) undoChanged();
  }
}

/**
 * Forces a write, for an action whose result must be on disk immediately —
 * switching projects, importing, reloading. A write already in progress is
 * waited for, and whatever changed during it is then written too. Answers whether
 * the project is on disk: false after a refused write, which does not throw (saveError()
 * says why). A caller that is about to discard the window must read it.
 */
export async function persist({ full = false } = {}) {
  if (full) fullNext = true;   // the save on close compares every key
  while (inflight) await inflight.catch(() => {});
  await flush();
  // Background completions can mutate the project while Close waits. Keep
  // the durability barrier until their revisions are written as well.
  while (loaded && !saveFailed && (dirty || pending || inflight)) {
    if (inflight) await inflight.catch(() => {});
    else await flush();
  }
  // the late abstracts' failure is said, but a window with no edits has nothing unsaved
  return !loaded || !saveFailed || (!dirty && !pending && saveFailed.startsWith(LATE_FAILED));
}

/**
 * Resolves once the edits made so far are written, without forcing a write of
 * its own: a run of screening decisions is then one save when the reviewer
 * pauses (the debounce above), not a clone of the whole project per decision.
 */
let writtenVersion = -1, savedWaiters = [];
export function whenSaved() {
  if (!loaded || (!pending && !inflight) || writtenVersion >= version) return Promise.resolve();
  return new Promise(resolve => savedWaiters.push({ v: version, resolve }));
}

/** The project as a file to hand to someone: no machine-private keys, no save identity. */
export function exportableState(st = state) {
  const out = portableState(st);
  delete out.saveToken;
  // what the project holds in memory says PROJECT_FORMAT; a whole file says WHOLE_FORMAT (a folder's save puts its own format on it)
  if (typeof out.format === 'number' && out.format > WHOLE_FORMAT) out.format = WHOLE_FORMAT;
  return out;
}

/**
 * The same, with its stored figures written back in, for a file that has to
 * stand on its own (Settings › Project file › Export, a recovery copy saved
 * as a file). The folder's own project.json keeps figures by name instead.
 */
export async function exportableWithFigures(st = state) {
  if (st === state && !abstractsIn) { await whenAbstracts(); st = state; }
  return inlineFigures(structuredClone(exportableState(st)));
}

/**
 * Replaces the open project with an imported one (Settings › Project file ›
 * Import, and Reset). The project as it stood is kept as a recovery copy
 * first; if that copy cannot be made nothing is replaced. The file's own
 * connection keys are never taken, and this machine's keys stay.
 */
export async function replaceProject(data, { source = 'The file' } = {}) {
  const boundary = generation;
  if (!loaded) throw new Error('The project has not finished loading');
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.papers))
    throw new Error(`${source} is not a Lykos project file`);
  const incoming = portableState(data);
  delete incoming.saveToken; delete incoming.savedAt;
  const next = normalizeProject(withLocalCredentials(incoming, credentialsOf(state)), { source });
  await keepCurrentForReplacement('before import', boundary, () => update(() => next));
  await persist();
  if (saveFailed) throw new Error(`Imported, but not yet saved: ${saveFailed}`);
  return next;
}

async function keepCurrentForReplacement(reason, boundary, replace) {
  for (;;) {
    await persist();
    if (generation !== boundary) throw new Error('The project changed before it could be replaced. Try again.');
    if (saveFailed) throw new Error(`Save the current project first: ${saveFailed}`);
    const revision = version;
    const count = await keepCopy(state, reason);   // keepCopy takes its own snapshot as text before it awaits
    if (generation !== boundary) throw new Error('The project changed while its recovery copy was being saved.');
    if (version === revision && !dirty) { recoveryCount = count; replace(); return; }
    // Include edits that arrived while the previous recovery copy was saved.
  }
}

export const paper = id => state.papers.find(p => p.id === id);
export const valueOf = (paperId, fieldId) => state.values[`${paperId}:${fieldId}`];
