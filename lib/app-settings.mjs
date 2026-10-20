// App-wide settings (plan §6.2a): a person's name and initials, model connections with keys, the PubMed contact and key, and the Sent log
// (plan §3.3) belong to them, not to one review. Kept once per installation: in the desktop app a private file (src-tauri/src/app_settings.rs,
// mode 0600, written atomically), in a browser one IndexedDB record. Never in a project file, backup, recovery copy, export or MCP answer.
// A project reads them through settingsOf(state): app-wide first, then what the project holds of its own, which wins. adoptFrom() moves what an
// older version kept per project into the store the first time it opens, without touching the project file; `adopted` remembers what it took.
import { loadChatGptAccounts } from './chatgpt.mjs';
import { inDesktop, readAppSettingsNative, writeAppSettingsNative } from './native.mjs';

export const SCALARS = ['reviewerName', 'reviewerInitials', 'ncbiEmail', 'ncbiKey'];
/** The shell's limits (app_settings.rs). */
export const LIMITS = { reviewerName: 200, reviewerInitials: 32, ncbiEmail: 254, ncbiKey: 512, openalexKey: 512, braveKey: 512, tinyfishKey: 512, zoteroUserId: 32, zoteroKey: 64,
  provider: 64, base: 2048, key: 512, workspaceId: 128, model: 256, label: 200, id: 64, listed: 256,
  profiles: 64, models: 2000, tasks: 32, task: 64, adoptedFields: 128, adoptedValues: 16, adopted: 512, adoptedName: 96, sent: 1000, excerpt: 200 };

const DB = 'lykos-app', STORE = 'state', RECORD = 'settings';

const emptyValues = () => ({ format: 1, reviewerName: '', reviewerInitials: '', ncbiEmail: '', ncbiKey: '', openalexKey: '', braveKey: '', tinyfishKey: '', zoteroUserId: '', zoteroKey: '',
  ai: null, models: { profiles: [], tasks: {}, jevDerived: false }, adopted: {}, sentLog: [] });

const str = (v, max) => (typeof v === 'string' ? v : '').replace(/\0/g, '').slice(0, max);
const own = v => typeof v === 'string' && v.trim() !== '';
const baseOf = b => String(b || '').trim().replace(/\/+$/, '');

function cleanProfile(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const id = str(p.id, LIMITS.id);
  if (!id) return null;
  const out = { id };
  for (const [k, max] of [['label', LIMITS.label], ['provider', LIMITS.provider], ['base', LIMITS.base], ['key', LIMITS.key], ['workspaceId', LIMITS.workspaceId], ['model', LIMITS.model]])
    if (p[k] != null) out[k] = str(p[k], max);
  if (Array.isArray(p.models)) out.models = p.models.filter(x => typeof x === 'string').slice(0, LIMITS.models).map(x => str(x, LIMITS.listed));
  for (const k of ['keyEdited', 'keyInherited']) if (typeof p[k] === 'boolean') out[k] = p[k];
  // the data classes allowed for a host (lib/egress.mjs)
  if (p.sends && typeof p.sends === 'object' && Array.isArray(p.sends.classes)) out.sends = { host: str(p.sends.host, 256), classes: p.sends.classes.filter(x => typeof x === 'string').slice(0, 8).map(x => str(x, 16)) };
  return out;
}
const cleanSent = e => {
  if (!e || typeof e !== 'object') return null;
  const o = { chars: Math.max(0, +e.chars || 0), parts: Math.max(0, +e.parts || 0), classes: [].concat(e.classes || []).slice(0, 8).map(x => str(x, 16)), excerpt: str(e.excerpt, LIMITS.excerpt) };
  for (const k of ['id', 'at', 'profileId', 'connection', 'provider', 'host', 'route', 'model', 'kind', 'hash']) o[k] = str(e[k], 256);
  return o.id && o.at ? o : null;
};
const cleanAi = a => a && typeof a === 'object' && !Array.isArray(a)
  ? { provider: str(a.provider, LIMITS.provider), base: str(a.base, LIMITS.base), key: str(a.key, LIMITS.key), model: str(a.model, LIMITS.model) } : null;

/** A settings document reduced to the whitelist the shell accepts, every value clamped to its limit. */
export function sanitize(doc) {
  const d = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  const out = emptyValues();
  for (const k of SCALARS) out[k] = str(d[k], LIMITS[k]);
  for (const k of ['openalexKey', 'braveKey', 'tinyfishKey', 'zoteroUserId', 'zoteroKey']) out[k] = str(d[k], LIMITS[k]);
  const ai = cleanAi(d.ai);
  out.ai = ai && (ai.provider || ai.key || ai.base || ai.model) ? ai : null;
  const seen = new Set();
  for (const p of (Array.isArray(d.models?.profiles) ? d.models.profiles : []).slice(0, LIMITS.profiles)) {
    const c = cleanProfile(p);
    if (c && !seen.has(c.id)) { seen.add(c.id); out.models.profiles.push(c); }
  }
  for (const [t, id] of Object.entries(d.models?.tasks && typeof d.models.tasks === 'object' ? d.models.tasks : {}).slice(0, LIMITS.tasks))
    if (/^[A-Za-z0-9_-]{1,32}$/.test(t) && own(id)) out.models.tasks[t] = str(id, LIMITS.task);
  out.models.jevDerived = d.models?.jevDerived === true;
  for (const [f, list] of Object.entries(d.adopted && typeof d.adopted === 'object' && !Array.isArray(d.adopted) ? d.adopted : {}).slice(0, LIMITS.adoptedFields))
    if (f && f.length <= LIMITS.adoptedName && Array.isArray(list))
      out.adopted[f] = list.filter(x => typeof x === 'string').slice(-LIMITS.adoptedValues).map(x => str(x, LIMITS.adopted));
  out.sentLog = (Array.isArray(d.sentLog) ? d.sentLog : []).slice(0, LIMITS.sent).map(cleanSent).filter(Boolean);
  return out;
}

// ---- the store
let values = emptyValues();
let ready = false;       // read (or found unreadable)
let loadError = '';      // why it could not be read; saving is then refused
let saveFailure = '';
let durable = true;      // what is in memory has been written
let loading = null;
let timer = null, inflight = null, changes = 0;
const listeners = new Set();
const emit = () => { for (const l of listeners) l(); };
export const onAppSettings = fn => { listeners.add(fn); return () => listeners.delete(fn); };

/** Where the values are kept: the desktop file, browser storage, or nowhere (a test run). */
export const appSettingsWhere = () => inDesktop() ? 'app' : typeof indexedDB !== 'undefined' ? 'browser' : 'memory';
export const appSettingsStatus = () => ({ ready, error: loadError || saveFailure, readOnly: Boolean(loadError), durable, where: appSettingsWhere() });
/** The stored values. Read only: change them through updateApp. */
export const appValues = () => values;

let idb = null;
const openDb = () => idb ||= new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => { req.result.onclose = () => { idb = null; }; resolve(req.result); };
  req.onerror = () => { idb = null; reject(req.error); };
});
const idbOp = (mode, fn) => openDb().then(d => new Promise((resolve, reject) => {
  const t = d.transaction(STORE, mode), r = fn(t.objectStore(STORE));
  t.oncomplete = () => resolve(r?.result);
  t.onerror = () => reject(t.error);
}));
const readStored = async () => inDesktop() ? readAppSettingsNative()
  : typeof indexedDB !== 'undefined' ? idbOp('readonly', s => s.get(RECORD)) : null;
const writeStored = doc => inDesktop() ? writeAppSettingsNative(doc)
  : typeof indexedDB !== 'undefined' ? idbOp('readwrite', s => s.put(doc, RECORD)) : Promise.resolve();

/** Reads the stored values once; an unreadable storage leaves them empty and read only. */
export function loadAppSettings() {
  return loading ||= (async () => {
    const early = values.sentLog;
    try { values = sanitize(await readStored()); loadError = ''; }
    catch (e) { values = emptyValues(); loadError = String(e?.message || e || 'unreadable').slice(0, 160); }
    if (early.length) { values.sentLog = mergeSent(early, values.sentLog); if (!loadError) { changes++; schedule(); } }
    try { await loadChatGptAccounts(); } catch {}
    ready = true; durable = true;
    emit();
  })();
}

// Another browser window saved the record: taken unless this one has edits waiting.
const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lykos-app-settings') : null;
chan?.unref?.();
chan?.addEventListener('message', async () => {
  if (!ready || loadError || timer || inflight) return;
  try { const next = sanitize(await readStored()); if (!timer && !inflight) { values = next; emit(); } } catch {}
});

async function write() {
  timer = null;
  if (loadError) return;
  const at = changes;
  try {
    await writeStored(structuredClone(values));
    saveFailure = '';
    if (at === changes) durable = true;
    if (!inDesktop()) chan?.postMessage(at);
  } catch (e) {
    saveFailure = String(e?.message || e || 'not saved').slice(0, 160);
  }
  emit();
}
function schedule() {
  durable = false;
  if (timer) return;
  timer = setTimeout(() => { inflight = write().finally(() => { inflight = null; }); }, 250);
  timer?.unref?.();
}
/** Writes what is waiting; resolves once the storage answered. */
export async function flushAppSettings() {
  if (timer) { clearTimeout(timer); timer = null; inflight = write().finally(() => { inflight = null; }); }
  await inflight;
}
if (typeof addEventListener === 'function' && typeof document !== 'undefined') {
  addEventListener('pagehide', () => { if (timer) flushAppSettings(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) flushAppSettings(); });
}

/** Changes the app-wide values: `fn` receives a working copy and edits it. */
export function updateApp(fn) {
  if (loadError) throw new Error('App-wide settings could not be read, so they are not changed');
  const next = structuredClone(values);
  fn(next);
  values = sanitize(next);
  changes++;
  schedule();
  emit();
}

// ---- the Sent log (lib/sent-log.mjs; never in a project)
const mergeSent = (a, b) => [...new Map([...a, ...b].map(e => [e.id, e])).values()].sort((x, y) => (y.at > x.at) - (y.at < x.at)).slice(0, LIMITS.sent);
export const appSent = () => values.sentLog;
/** Replaces the log; unread or unreadable storage keeps it in memory only. */
export function setSent(list) {
  values.sentLog = (list || []).slice(0, LIMITS.sent).map(cleanSent).filter(Boolean);
  if (ready && !loadError) { changes++; schedule(); }
  emit();
}
export const adoptSent = list => setSent(mergeSent(values.sentLog, [].concat(list || []).map(cleanSent).filter(Boolean)));

/** Test seam. */
export function resetAppSettings() {
  clearTimeout(timer); timer = null; inflight = null;
  values = emptyValues(); ready = false; loadError = ''; saveFailure = ''; durable = true; loading = null; idb = null; changes = 0;
}

// ---- layers: app-wide, then the project
const adoptedHas = (field, v) => (values.adopted[field] || []).includes(v);
const note = (field, v) => {
  if (!v) return;
  const list = values.adopted[field] ||= [];
  if (list.includes(v)) return;
  list.push(v);
  if (list.length > LIMITS.adoptedValues) list.shift();
  if (Object.keys(values.adopted).length > LIMITS.adoptedFields) delete values.adopted[Object.keys(values.adopted)[0]];
};
const connection = p => `${p.provider || ''}|${baseOf(p.base)}|${p.model || ''}`;
/** A project's leftover copy of a connection the store holds (same endpoint and model, or the one it took; no key of its own, or the one it took): it follows the app-wide profile. */
const staleCopy = (app, mine, keyField, connField) => (connection(app) === connection(mine) || (connField && adoptedHas(connField, connection(mine))))
  && (!mine.key || mine.key === app.key || adoptedHas(keyField, mine.key));
const profileKeyField = id => `profileKey:${id}`;
const profileConnField = id => `profile:${id}`;

/** The value a project reads for one of the four plain settings. */
function scalar(k, mine) {
  const app = values[k] || '';
  return !own(mine) || mine === app || adoptedHas(k, mine) ? app : mine;
}

/** The profiles a project sees, with where each came from: 'app', 'override' (this project holds a different one under the same id) or 'project'. */
export function layers(state) {
  const mine = state?.settings || {};
  const mineProfiles = (Array.isArray(mine.models?.profiles) ? mine.models.profiles : []).filter(p => p && p.id);
  const merged = values.models.profiles.slice();
  const origin = new Map(merged.map(p => [p.id, 'app']));
  for (const pp of mineProfiles) {
    const at = merged.findIndex(x => x.id === pp.id);
    if (at < 0) { merged.push(pp); origin.set(pp.id, 'project'); continue; }
    if (origin.get(pp.id) !== 'app' || staleCopy(merged[at], pp, profileKeyField(pp.id), profileConnField(pp.id))) continue;
    merged[at] = pp; origin.set(pp.id, 'override');
  }
  // a pre-profiles project's one connection is a profile of its own beside app-wide ones
  const legacy = mine.ai;
  if (own(legacy?.provider) && !mineProfiles.length && merged.length) {
    const covered = merged.some(p => staleCopy(p, legacy, 'aiKey', 'aiConn'));
    if (!covered) {
      const id = merged.some(p => p.id === 'p1') ? 'legacy-project' : 'p1';
      merged.push({ id, label: legacy.model || legacy.provider, ...legacy }); origin.set(id, 'project');
    }
  }
  const tasks = { ...values.models.tasks };
  const pinned = [];
  for (const [t, id] of Object.entries(mine.models?.tasks || {})) {
    if (!own(id) || id === tasks[t] || adoptedHas(`task:${t}`, id)) continue;
    tasks[t] = id; pinned.push(t);
  }
  return { profiles: merged, origin, tasks, pinned };
}

/** The settings a project reads (the shape of project.settings): app-wide values, then the project's own over them. */
export function settingsOf(state) {
  const mine = state?.settings || {};
  const out = { ...mine };
  for (const k of SCALARS) out[k] = scalar(k, mine[k]);
  out.braveKey = values.braveKey || '';
  out.tinyfishKey = values.tinyfishKey || '';
  out.openalexKey = values.openalexKey || '';
  const { profiles, tasks } = layers(state);
  out.models = { ...(mine.models || {}), profiles, tasks, jevDerived: Boolean(mine.models?.jevDerived || values.models.jevDerived) };
  const app = values.ai?.provider ? values.ai : null;
  out.ai = own(mine.ai?.provider) && !(app && staleCopy(app, mine.ai, 'aiKey', 'aiConn')) ? mine.ai : (app || mine.ai);
  if (out.ai === undefined) delete out.ai;
  return out;
}

/** What this project holds of its own that differs from the app-wide value. */
export function overridesOf(state) {
  const mine = state?.settings || {};
  const { origin, pinned } = layers(state);
  const app = values.ai?.provider ? values.ai : null;
  return {
    scalars: SCALARS.filter(k => own(mine[k]) && mine[k] !== (values[k] || '') && !adoptedHas(k, mine[k])),
    profiles: [...origin].filter(([, o]) => o !== 'app').map(([id, o]) => ({ id, kind: o })),
    tasks: pinned,
    ai: own(mine.ai?.provider) && Boolean(app) && !staleCopy(app, mine.ai, 'aiKey', 'aiConn'),
  };
}

/** The project's settings with one override dropped. */
export function withoutOverride(settings, what) {
  const s = { ...(settings || {}) };
  if (SCALARS.includes(what)) delete s[what];
  else if (what === 'ai') delete s.ai;
  else if (what.startsWith('task:') && s.models) { const tasks = { ...(s.models.tasks || {}) }; delete tasks[what.slice(5)]; s.models = { ...s.models, tasks }; }
  else if (what.startsWith('profile:') && s.models) s.models = { ...s.models, profiles: (s.models.profiles || []).filter(p => p.id !== what.slice(8)) };
  return s;
}

/** A project's own value, put there on purpose, is no longer a leftover copy: forget it as such. */
export function pinOverride(field, value) {
  if (!adoptedHas(field, value) || loadError) return;
  updateApp(v => { v.adopted[field] = (v.adopted[field] || []).filter(x => x !== value); });
}

// ---- moving what a project holds into the app-wide store
/** First run on a project: its name, initials, PubMed contact and key, connections (with keys) and task assignments fill app-wide values that are empty. Nothing app-wide is replaced; a differing project value stays as an override. Answers whether the store changed; the project is not touched. */
export function adoptFrom(mine) {
  if (!ready || loadError || !mine || typeof mine !== 'object') return false;
  const before = JSON.stringify(values);
  const v = values;
  for (const k of SCALARS) {
    const pv = str(mine[k], LIMITS[k]);
    if (!own(pv)) continue;
    if (!v[k] && !adoptedHas(k, pv)) v[k] = pv;
    if (v[k] === pv) note(k, pv);
  }
  const ai = cleanAi(mine.ai);
  if (ai && own(ai.provider)) {
    const sig = connection(ai);
    if (!v.ai?.provider && !adoptedHas('aiConn', sig)) v.ai = { ...ai };
    if (v.ai && connection(v.ai) === sig) {
      if (!v.ai.key && ai.key) v.ai = { ...v.ai, key: ai.key };
      if (ai.key && v.ai.key === ai.key) note('aiKey', ai.key);
      note('aiConn', sig);
    }
  }
  const profiles = (Array.isArray(mine.models?.profiles) ? mine.models.profiles : []).map(cleanProfile).filter(Boolean);
  const fresh = v.models.profiles.length === 0;
  for (const pp of profiles) {
    const at = v.models.profiles.findIndex(x => x.id === pp.id);
    if (at < 0) {
      if (fresh && v.models.profiles.length < LIMITS.profiles && !adoptedHas(`profile:${pp.id}`, connection(pp))) v.models.profiles.push(pp);
      else continue;
    }
    const ap = v.models.profiles.find(x => x.id === pp.id);
    if (connection(ap) !== connection(pp)) continue;    // a different profile under the same id: the project's own
    if (!ap.key && pp.key) ap.key = pp.key;
    if (pp.key && ap.key === pp.key) note(profileKeyField(pp.id), pp.key);
    note(`profile:${pp.id}`, connection(pp));
  }
  for (const [t, id] of Object.entries(mine.models?.tasks || {})) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(t) || !own(id) || !v.models.profiles.some(p => p.id === id)) continue;
    if (!v.models.tasks[t] && !adoptedHas(`task:${t}`, id)) v.models.tasks[t] = str(id, LIMITS.task);
    if (v.models.tasks[t] === id) note(`task:${t}`, id);
  }
  if (mine.models?.jevDerived === true && v.models.profiles.length) v.models.jevDerived = true;
  const after = JSON.stringify(values);
  if (after === before) return false;
  changes++;
  schedule();
  emit();
  return true;
}

/** A project's settings as its record keeps them: a key that only repeats an app-wide one is dropped, once the store has written it. */
export function storableSettings(settings) {
  if (!ready || loadError || !durable || !settings) return settings;
  const s = { ...settings };
  if (s.ncbiKey && (s.ncbiKey === values.ncbiKey || adoptedHas('ncbiKey', s.ncbiKey))) delete s.ncbiKey;
  const app = values.ai?.provider ? values.ai : null;
  if (s.ai?.key && app && staleCopy(app, s.ai, 'aiKey', 'aiConn')) s.ai = { ...s.ai, key: '' };
  if (Array.isArray(s.models?.profiles)) s.models = { ...s.models, profiles: s.models.profiles.map(p => {
    const ap = p?.key || p?.workspaceId ? values.models.profiles.find(x => x.id === p.id) : null;
    if (!ap || !staleCopy(ap, p, profileKeyField(p.id), profileConnField(p.id))) return p;
    const { workspaceId, ...rest } = p;   // a workspace id is kept beside the key, so it leaves the project with it
    return { ...rest, key: '' };
  }) };
  return s;
}

export const maskKey = key => !key ? '' : key.length < 9 ? '••••' : `••••${key.slice(-4)}`;
