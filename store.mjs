// Project state.
//
// The shape is deliberately the plan's 5.1 evidence contract, so moving it
// behind Rust later is a transport change and not a rewrite.
//
// Two things this has to get right at the scale the plan targets — 10,000
// records — and the first version got both wrong. Cloning the whole project on
// every edit cost 18 ms at 2,000 records, which is every keystroke in a text
// field. And localStorage is synchronous and capped near 5 MB, which a project
// that size exceeds on its own. State is now mutated in place behind a
// versioned snapshot and persisted to IndexedDB on an idle debounce.
import { gzipText, gunzipBlob } from './lib/gzip.mjs';
import { trimProject, trimWouldDrop } from './lib/project-trim.mjs';
import { compactScreening } from './lib/rules-key.mjs';
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
import { normalizeDeclarations } from './lib/declarations.mjs';
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
export const PROJECT_FORMAT = 1;

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
export function normalizeProject(saved, { source = 'The project file', onTrim = null } = {}) {
  assertProject(saved ?? {}, { source });
  saved ??= {};
  // A fresh copy of the defaults: a project without papers must not push its
  // first paper into EMPTY's own array, shared with every later load.
  const next = { ...structuredClone(EMPTY), ...saved, format: PROJECT_FORMAT };
  for (const k of Object.keys(EMPTY)) if (next[k] == null && EMPTY[k] != null) next[k] = structuredClone(EMPTY[k]);
  for (const k of Object.keys(next.values)) next.values[k] = migrateValue(next.values[k]);
  // Evidence tables imported before arms joined each two-arm study's cells; one value per arm now (lib/arms.mjs).
  (next.templates || []).forEach((t, i) => { if (!needsArmSplit(t, next.values)) return; const r = splitJoinedArms({ template: t, values: next.values }); next.templates[i] = r.template; next.values = r.values; });
  compactScreening(next);   // older projects carried the rules on every proposal
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
  next.declarations = normalizeDeclarations(next.declarations, next.paper);
  next.reviewRounds = normalizeReviewRounds(next.reviewRounds);
  if (!Array.isArray(next.reviewRuns)) next.reviewRuns = [];   // a manuscript version's review runs (lib/review-checks.mjs normalises them where they are read)
  next.submissions = normaliseSubmissions(next.submissions);   // absent or malformed: an empty list; unknown keys kept
  normalizeGovernance(next);   // registration, ethics, sap, spiritSchedule, checklistChoice
  normalizeWorkspace(next);    // reading, journal, projectNotes, noteTemplates, milestones (lib/workspace-records.mjs)
  // kept analyses of the datasets (lib/dataset-analysis.mjs): an entry without its result is dropped
  if (next.qual != null) next.qual = normalizeQual(next.qual);
  if (next.datasetAnalyses != null) next.datasetAnalyses = Array.isArray(next.datasetAnalyses) ? next.datasetAnalyses.filter(a => a && a.id && a.datasetId && a.result && typeof a.result === 'object') : [];
  // The trim is one-way: what it would drop (imported sheet columns, old workflow runs) is handed over first, so a copy can be kept (finding 13).
  if (onTrim && trimWouldDrop(next)) onTrim({ ...next });
  if ('sentLog' in next) { adoptSent(next.sentLog); delete next.sentLog; }   // app-wide, never in a project
  trimProject(next);   // once: retrieval logs, imported sheet rows and old workflow runs kept to what is read (lib/project-trim.mjs)
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
let credentialsFailed = '';   // why the model keys were not written to the shell's credentials file; the project itself is saved either way
export const credentialsError = () => credentialsFailed;
// The open project was replaced by the one on disk (a second window, a sync service). Told after the swap, with the recovery count.
const replacedListeners = new Set();
export const onProjectReplaced = fn => { replacedListeners.add(fn); return () => replacedListeners.delete(fn); };
const projectReplaced = () => { for (const l of replacedListeners) { try { l({ copies: recoveryCount }); } catch {} } };
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
export function useBackend(b) {
  generation++;
  indexVersion++;
  clearTimeout(backupT); backupT = null; backupDue = false; backupVersion = -1;
  backupHealth = { status: inDesktop() || b?.credentialId || (b?.backupName && tabSafe()) ? 'pending' : 'unavailable', error: '', at: '' };
  backend = b;
  loaded = false;   // a new place is not loaded until load() reads it
  credentialsFailed = '';
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
 * project's copies are never considered. Answers the keys to prune.
 */
export const RECOVERY_KEEP = 6, RECOVERY_DAYS = 7;
export function recoveryPrunable(keys, now = Date.now()) {
  const dated = keys.map(k => ({ k, t: recoveryMadeAt(k) })).filter(x => x.t != null).sort((a, b) => b.t - a.t);
  const keep = new Set(dated.slice(0, RECOVERY_KEEP).map(x => x.k));
  const days = new Set();
  for (const x of dated) {
    if (now - x.t > RECOVERY_DAYS * 86_400_000) break;
    const day = new Date(x.t).toDateString();
    if (!days.has(day)) { days.add(day); keep.add(x.k); }
  }
  return dated.filter(x => !keep.has(x.k)).map(x => x.k);
}
const ownKeys = async () => (await dbOp('readonly', s => s.getAllKeys())).filter(ownsRecovery);
/** Prunes the open project's copies by the retention rule; answers how many it keeps. */
async function pruneRecoveries(now = Date.now()) {
  const keys = await ownKeys();
  const drop = recoveryPrunable(keys, now);
  if (drop.length) await dbOp('readwrite', s => { for (const k of drop) { s.delete(k); s.delete(metaKeyOf(k)); } });
  return keys.length - drop.length;
}
/** Keeps the open project as it is now (`copy`) as a compressed recovery copy, then applies the retention rule; answers the count. */
async function keepCopy(copy, reason, key = recoveryKey()) {
  const snap = snapshotOf(copy, reason);   // taken now, before anything else can change the state
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
  const boundary = generation;
  const copy = await readRecovery(key);
  if (generation !== boundary) throw new Error('The project changed while the recovery copy was being read.');
  if (!copy?.papers || !copy?.values) throw new Error('Recovery copy is unavailable');
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

function flush() {
  clearTimeout(pending);
  pending = null;
  if (!loaded) return Promise.resolve();
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
  let wrote = false;
  const writing = version;   // the edits this write carries
  try {
    // Rendered figures leave the project before it is written: stored by
    // hash beside it, named in the result (lib/figures.mjs). A figure the
    // store does not take stays inline and is saved with the project.
    try { await externalizeFigures(state); } catch {}
    if (backend) {
      // A folder project: the backend answers stale when the copy on disk is
      // newer than the one this window read, and this window reloads instead.
      const at = Math.max(Date.now(), savedAt + 1);
      const writingVersion = version;
      state.savedAt = at;
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
      const result = await backend.write(backend.credentialId ? state : { ...state, settings: storableSettings(state.settings) });
      if (result?.backup) setBackupHealth(result.backup);
      if (result?.stale) {
        // Someone else's save is newer and is loaded. This window's unsaved
        // edits are kept as a recovery copy first, never simply dropped; if
        // the copy cannot be kept, nothing is loaded and the save error says so.
        if (dirty) recoveryCount = await keepCopy({ ...state }, 'newer save on disk');
        const at = version;
        const next = await readSaved();
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
      savedAt = at;
      dirty = version !== writingVersion;
    } else {
      const nextAt = Math.max(Date.now(), savedAt + 1);
      const nextToken = newToken();
      const writingVersion = version;
      const outcome = await commitProject({ ...state, settings: storableSettings(state.settings), savedAt: nextAt, saveToken: nextToken }, savedAt, saveToken);
      wrote = true;
      if (outcome.conflict) {
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
        state = normalizeProject(outcome.disk);
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
  if (backend && !backend.backupName) { dirty = true; await persist(); }
  else if (inDesktop() || tabSafe()) { clearTimeout(backupT); backupT = null; backupDue = true; backupVersion = -1; await runBackup(); }
  return backupState();
}

// A save elsewhere: take it, unless this tab has edits of its own in flight.
// The read is asynchronous; an edit made while it runs wins, and this tab's
// next save reconciles the two (a newer save on disk becomes a conflict).
async function onAnnounce(e) {
  if (!e.data?.savedAt || e.data.savedAt <= savedAt) return;
  if (dirty || pending || flushing) return;   // will be reconciled on this tab's next flush
  const at = version;
  let next;
  try { next = await readSaved(); } catch { return; }
  if (version !== at || dirty || pending || flushing) return;
  apply(next);
}
useBackend(null);

if (typeof window !== 'undefined') {
  // A debounced write must not be the reason an edit is lost on close.
  addEventListener('pagehide', () => { if (pending || dirty) flush(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && (pending || dirty)) flush();
  });
}

/** Loads the project, migrating anything left in localStorage by an older build. */
export async function load() {
  const read = await readSaved();
  // The one-time trim drops imported sheet columns and old runs for good: the project as it was is kept as a recovery copy first.
  if (read.pretrim) { try { read.recoveries = await keepCopy(read.pretrim, 'before trim'); } catch (err) { console.warn('[store] pre-trim copy', err); } }
  apply(read);
  // Once a session, some time after the project opens, unused figures go.
  if (!cleanupPlanned && typeof window !== 'undefined') {
    cleanupPlanned = true;
    const cleanup = setTimeout(() => { figureCleanup({ apply: true }).catch(() => {}).then(() => compactRecoveries()).catch(() => {}); }, 30_000);
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
  const refs = namedIn(JSON.stringify(state), hashes);
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

/** The project as stored, normalised, with its recovery-copy count; nothing in memory changes. */
async function readSaved() {
  let saved = null, pretrim = null;
  const onTrim = copy => { pretrim = copy; };
  if (backend) {
    // A folder that cannot be read must not look like an empty project: an
    // empty project would be saved over the real one on the first edit.
    saved = normalizeProject(await backend.read(), { onTrim });
    if (inDesktop() && backend.credentialId) saved = withLocalCredentials(saved,
      await readModelCredentialsNative(backend.credentialId));
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
  const project = normalizeProject(saved, { onTrim });
  let recoveries = null;
  try { recoveries = (await dbOp('readonly', s => s.getAllKeys())).filter(ownsRecovery).length; } catch {}
  return { project, recoveries, pretrim };
}

// Synchronous from here on: an edit cannot land between the project being
// replaced and the tab being marked clean, where it would be neither saved nor
// shown as unsaved.
function apply({ project, recoveries }) {
  generation++;
  indexVersion++;
  if (recoveries != null) recoveryCount = recoveries;
  state = project;
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
export const get = () => state;
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
export function update(fn, { indexNeutral = false } = {}) {
  let next;
  try { next = fn(state); }
  finally {
    // Whatever the reducer changed before throwing is saved too, and the views redraw.
    dirty = true;
    const replaced = next && next !== state;
    if (next) { if (replaced) generation++; state = next; }
    if (!indexNeutral || replaced) indexVersion++;
    version++;
    schedulePersist();
    emit();
  }
}

/**
 * Forces a write, for an action whose result must be on disk immediately —
 * switching projects, importing, reloading. A write already in progress is
 * waited for, and whatever changed during it is then written too. Answers whether
 * the project is on disk: false after a refused write, which does not throw (saveError()
 * says why). A caller that is about to discard the window must read it.
 */
export async function persist() {
  while (inflight) await inflight.catch(() => {});
  await flush();
  // Background completions can mutate the project while Close waits. Keep
  // the durability barrier until their revisions are written as well.
  while (loaded && !saveFailed && (dirty || pending || inflight)) {
    if (inflight) await inflight.catch(() => {});
    else await flush();
  }
  return !loaded || !saveFailed;
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
  return out;
}

/**
 * The same, with its stored figures written back in, for a file that has to
 * stand on its own (Settings › Project file › Export, a recovery copy saved
 * as a file). The folder's own project.json keeps figures by name instead.
 */
export const exportableWithFigures = (st = state) => inlineFigures(structuredClone(exportableState(st)));

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
