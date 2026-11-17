// The settings the chat may change, each through the writer the Settings page uses (owner, 15 Nov 2026: "it should be able to change themes or
// any settings at all but behind a confirmation of what to do"). The chat's change_settings tool (lib/chat-tools.mjs) never writes: it turns a
// request into a card that states each change, from what to what (lib/chat-blocks.mjs, block 'settings'); Apply writes exactly those, Cancel
// writes nothing, and an applied card can be undone from the same card.
//
//   catalogue()                 what may be changed: key, label, section, scope, the values it takes and its value now
//   proposeSettings(list)       [{ key, value }] → { changes: [{ key, label, section, scope, from, to, fromText, toText }], refused, unknown, same }
//   applySettings(changes)      writes each `to`; returns the changes with `before`, the value each held when applied (what undo puts back)
//   undoSettings(changes)       the restore point's rule (lib/answer-restore.mjs): a setting still at the card's value moves back ('back');
//                               one changed since by someone else stays ('kept', and the card says so)
//   decideCard(how, at)         a press on the card: 'apply', 'cancel' or 'undo' on block `at` = { threadId, message, block }; the block's new
//                               state is saved with the thread, so the card reads the same after a restart and Undo still works
//
// Never offered: secrets (keys, tokens, cookies, passwords, sign-ins) and settings that grant a permission the person must give themselves
// (what data may leave this Mac, what a connection may receive, add-on code, MCP access, patient-data handling, institutional sign-in).
// A request for one is refused with the reason and where the person sets it.
import { store$get as get, store$update as update } from "../boot.mjs";
import { lib_app_settings$settingsOf as settingsOf } from "../boot.mjs";

const clip = (v, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const low = v => String(v ?? '').trim().toLowerCase();
const mine = () => get().settings || {};
const ms = () => import('./model-settings.mjs');

/** A choice from its id or its label, case aside; undefined when it is neither. */
const pick = (choices, v) => { const t = low(v); const hit = choices.find(([id, label]) => low(id) === t || low(label) === t); return hit ? hit[0] : undefined; };
const choiceOf = list => ({ type: 'choice', choices: list });
const numberIn = (min, max, step = 1) => ({ type: 'number', min, max, parse: v => { const n = Number(String(v).replace(/[\s,]/g, '')); return Number.isFinite(n) && n >= min && n <= max && n % step === 0 ? n : undefined; } });
const textUpTo = (max, test = () => true) => ({ type: 'text', parse: v => (typeof v === 'string' && v.length <= max && test(v.trim()) ? v.trim() : undefined) });
const saveOwn = async (k, v) => (await ms()).saveOwn(k, v);
const saveApp = async (k, v) => (await ms()).saveApp(k, v);

async function profileChoices(none = 'App default') {
  const { profiles } = await ms();
  return [['', none], ...profiles().map(p => [p.id, p.label || p.model || p.provider])];
}
const dualOf = d => (d && typeof d === 'object' ? (d.ta && d.ft ? '1' : d.ta ? 'ta' : d.ft ? 'ft' : '') : d ? '1' : '');   // views/settings.mjs dualChoice

// [key, label, section, scope, spec]: spec has choices (or parse), read() and write(v). Scope: 'this computer', 'every project', 'this project'.
const ENTRIES = () => {
  const out = [
    ['theme', 'Theme', 'Appearance', 'this computer', { ...choiceOf(async () => { const t = await import('./theme.mjs'); return [['system', 'Match the system'], ...t.THEMES.map(x => [x.id, x.label])]; }),
      read: async () => (await import('./theme.mjs')).preference(), write: async v => (await import('./theme.mjs')).set(v) }],
    ['reviewerName', 'Your name', 'You', 'every project', { ...textUpTo(200), read: () => settingsOf(get()).reviewerName || '', write: v => saveApp('reviewerName', v) }],
    ['reviewerInitials', 'Your initials', 'You', 'every project', { ...textUpTo(32), read: () => settingsOf(get()).reviewerInitials || '', write: v => saveApp('reviewerInitials', v) }],
    ['ncbiEmail', 'PubMed contact email', 'Sources', 'every project', { ...textUpTo(254, v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)), read: () => settingsOf(get()).ncbiEmail || '', write: v => saveApp('ncbiEmail', v) }],
    ['aiDetail', 'Length of notes', 'Models', 'this project', { ...choiceOf(async () => [['brief', 'Brief'], ['standard', 'Standard'], ['full', 'Full']]), read: () => mine().aiDetail || 'standard', write: v => saveOwn('aiDetail', v) }],
    ['agent.calls', 'Tool calls per run', 'Models', 'this project', { ...numberIn(1, 400), read: async () => (await ms()).settings().agent?.calls || 40, write: async v => saveOwn('agent', { ...((await ms()).settings().agent || {}), calls: v }) }],
    ['agent.tokens', 'Tokens per run', 'Models', 'this project', { ...numberIn(1000, 10_000_000, 1000), read: async () => (await ms()).settings().agent?.tokens || 150000, write: async v => saveOwn('agent', { ...((await ms()).settings().agent || {}), tokens: v }) }],
    ['agent.parallel', 'Parallel runs in a batch', 'Models', 'this project', { ...choiceOf(async () => [1, 2, 3, 4].map(n => [n, String(n)])), read: async () => (await ms()).settings().agent?.parallel || 1, write: async v => saveOwn('agent', { ...((await ms()).settings().agent || {}), parallel: Number(v) }) }],
    ['dualScreening', 'Reviewers', 'Reviewers', 'this project', { ...choiceOf(async () => [['', 'One reviewer'], ['1', 'Two reviewers, blinded'], ['ta', 'Two, title and abstract only'], ['ft', 'Two, full text only']]),
      read: () => dualOf(mine().dualScreening), write: v => saveOwn('dualScreening', v === '1' ? true : v ? { ta: v === 'ta', ft: v === 'ft' } : false) }],
    ['screenSecond', 'Second screening model', 'Reviewers', 'this project', { ...choiceOf(() => profileChoices('None')), read: () => mine().screenSecond || '', write: v => saveOwn('screenSecond', v) }],
    ['retractionFreshDays', 'Retraction check', 'Reviewers', 'this project', { ...choiceOf(async () => [7, 14, 30, 60, 90].map(n => [n, `Every ${n} days`])),
      read: async () => (await import('./integrity.mjs')).freshDays(mine()), write: v => saveOwn('retractionFreshDays', Number(v)) }],
    ['measure', 'Effect measure', 'Analysis defaults', 'this project', { ...choiceOf(async () => (await import('./effect-measures.mjs')).MEASURES.map(m => [m.id, m.label])), read: () => mine().measure || '', write: v => saveOwn('measure', v) }],
    ['method', 'Meta-analysis model', 'Analysis defaults', 'this project', { ...choiceOf(async () => [['REML', 'Random effects (REML)'], ['DL', 'Random effects (DerSimonian–Laird)'], ['EE', 'Common effect']]), read: () => mine().method || '', write: v => saveOwn('method', v) }],
    // as the Settings page writes it: a style chosen by hand outlasts a change of journal; "auto" hands the choice back to the journal
    ['refStyle', 'Reference style', 'Analysis defaults', 'this project', { ...choiceOf(async () => [['auto', 'From the journal'], ...(await import('./cite.mjs')).STYLES.map(s => [s.id, s.label])]),
      read: () => (mine().refStyleManual && mine().refStyle) || 'auto',
      write: async v => { const { STYLES } = await import('./cite.mjs'), byHand = v !== 'auto';
        await saveOwn('refStyleManual', byHand); await saveOwn('refStyle', byHand ? v : '');
        await saveOwn('citationStyle', byHand ? (STYLES.find(x => x.id === v)?.numbered ? 'numbered' : 'author-year') : ''); await saveOwn('journalPreset', ''); await saveOwn('journalPresetName', ''); } }],
    ['previewLimit', 'Stored PDF previews', 'Storage', 'this computer', { ...choiceOf(async () => (await import('./cache-budget.mjs')).limitOptions()),
      read: async () => (await import('./cache-budget.mjs')).previewLimit(), write: async v => (await import('./cache-budget.mjs')).setPreviewLimit(v) }],
    ['rIdleMinutes', 'Release R after idle', 'R engine', 'this computer', { ...choiceOf(async () => (await import('./r.mjs')).IDLE_MINUTES.map(n => [n, `${n} min`])),
      read: async () => (await import('./r.mjs')).resourcePolicy().idleMinutes, write: async v => { const r = await import('./r.mjs'); r.setResourcePolicy({ ...r.resourcePolicy(), idleMinutes: Number(v) }); } }],
  ];
  return out;
};

// the task models (Settings › Models, Task defaults) and each connection's model and name (its options; never its key, address or provider)
async function dynamicEntries() {
  const { TASKS, profiles, setTaskModel, setProfiles } = await ms(), { cachedModels, shortModel } = await import('./ai.mjs');
  const tasks = TASKS.map(([task, label]) => [`task:${task}`, `Model for ${label.toLowerCase()}`, 'Models', 'every project', { ...choiceOf(() => profileChoices()),
    read: () => settingsOf(get()).models?.tasks?.[task] || '', write: v => setTaskModel(task, v) }]);
  const conn = profiles().flatMap(p => {
    const name = p.label || p.model || p.provider, edit = (k, v) => setProfiles(profiles().map(x => (x.id === p.id ? { ...x, [k]: v } : x)));
    const ids = [...new Set([p.model, ...(p.models || []), ...(['anthropic', 'chatgpt'].includes(p.provider) ? cachedModels(p).map(r => r.id) : [])].filter(Boolean))];
    return [[`connection:${p.id}.model`, `${name}: model`, 'Models', 'every project', { ...choiceOf(async () => ids.map(id => [id, shortModel(id)])), read: () => profiles().find(x => x.id === p.id)?.model || '', write: v => edit('model', v) }],
      [`connection:${p.id}.label`, `${name}: name`, 'Models', 'every project', { ...textUpTo(200, v => !!v), read: () => profiles().find(x => x.id === p.id)?.label || '', write: v => edit('label', v) }]];
  });
  return [...tasks, ...conn];
}

// [test, reason]: tried in order before the catalogue, so a secret is refused by name even where no entry would match it
const REFUSED = [
  // "token" as a credential (elsevierToken), not the run limit "agent.tokens"
  [/key|token(?!s$)|cookie|password|secret|credential|sign[- ]?in|account|oauth/i, 'a secret; enter it yourself in Settings'],
  [/^aiLocalOnly$|local[- ]?only/i, 'a permission; whether project data may leave this Mac is yours to set, in Settings › Models'],
  [/sends|egress|scope|receive|allow/i, 'a permission; what a connection may receive is yours to allow, in Settings › Models'],
  [/mcp/i, 'a permission; which programs may read your projects is yours to set, in Settings › MCP access'],
  [/addon|add-on|extension/i, 'a permission; which add-ons may run is yours to set, in Settings › Extensions'],
  [/patient/i, 'a permission; how patient data is handled is yours to set, in Settings › General'],
  [/openathens|ezproxy|proxy|institution/i, 'an institutional sign-in; set it yourself in Settings › Literature access'],
  [/^connection:[^.]+\.(provider|base|url|workspace|sends)$|\.(provider|base|workspaceId)$/i, 'a connection\'s address and provider are set up by you, in Settings › Models'],
  [/drive|zotero/i, 'an account link; set it yourself in Settings'],
];
// the names a refused request is shown by: the Settings page's own where it has one, else the key in words ("ncbiKey" → "Ncbi key")
const REFUSED_LABELS = { ncbiKey: 'PubMed API key', braveKey: 'Brave Search key', tinyfishKey: 'TinyFish key', openalexKey: 'OpenAlex key', zoteroKey: 'Zotero key', zoteroUserId: 'Zotero user',
  elsevierKey: 'Elsevier key', elsevierToken: 'Elsevier token', springerKey: 'Springer key', semanticScholarKey: 'Semantic Scholar key', coreKey: 'CORE key', ezproxyCookie: 'EZproxy cookie',
  ezproxyUrl: 'EZproxy address', openathensDomain: 'OpenAthens domain', aiLocalOnly: 'Local models only', patientData: 'Patient data' };
export const refusedLabel = key => REFUSED_LABELS[key] || (s => s.charAt(0).toUpperCase() + s.slice(1))(String(key).replace(/^connection:[^.]+\./, 'connection ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._:-]+/g, ' ').toLowerCase().trim());
export const refusalOf = key => REFUSED.find(([re]) => re.test(String(key)))?.[1] || '';

let cache = null;
async function entries() { return [...(cache ||= ENTRIES()), ...(await dynamicEntries())].map(([key, label, section, scope, spec]) => ({ key, label, section, scope, ...spec })); }
const find = (list, key) => { const k = low(key); return list.find(e => low(e.key) === k) || list.find(e => low(e.label) === k); };
/** Whether a request names a setting by its label ("Set the tool calls per run to 60", "two reviewers"): the chat then offers
 *  change_settings (lib/agent.mjs). Labels, not a list of words kept apart, so a new setting is found as soon as it is listed. */
export function namesSetting(text) {
  const t = low(text).replace(/[-–]/g, ' ');
  return (cache ||= ENTRIES()).some(([, label]) => { const l = low(label).replace(/[-–]/g, ' '); return l.length > 4 && (t.includes(l) || l.split(' ').length > 1 && l.split(' ').filter(w => w.length > 3).every(w => t.includes(w))); });
}
async function textOf(e, v) {
  if (e.type === 'choice') { const c = (await e.choices()).find(([id]) => same(id, v) || String(id) === String(v)); return c ? c[1] : String(v ?? ''); }
  if (e.type === 'number') return Number(v).toLocaleString('en-US');
  return v === '' || v == null ? 'none' : String(v);
}

/** What may be changed, with each value now (no secrets: none is listed). */
export async function catalogue() {
  const out = [];
  for (const e of await entries()) {
    const now = await e.read();
    out.push({ key: e.key, label: e.label, section: e.section, scope: e.scope, now: await textOf(e, now),
      ...(e.type === 'choice' ? { values: (await e.choices()).map(([id, label]) => `${id}${String(id) === label ? '' : ` (${label})`}`) } : e.type === 'number' ? { values: `${e.min} to ${e.max}` } : { values: 'text' }) });
  }
  return out;
}

/** A request's changes, checked and worded; nothing is written. */
export async function proposeSettings(list) {
  const all = await entries(), changes = [], refused = [], unknown = [], unchanged = [], seen = new Set();
  for (const item of (Array.isArray(list) ? list : []).slice(0, 12)) {
    const key = clip(item?.key, 120), why = refusalOf(key);
    if (why) { refused.push({ key, label: refusedLabel(key), reason: why }); continue; }
    const e = find(all, key);
    if (!e) { unknown.push({ key, note: 'not a setting the assistant may change; call change_settings without changes for the list' }); continue; }
    if (seen.has(e.key)) continue; seen.add(e.key);
    const to = e.type === 'choice' ? pick(await e.choices(), item.value) : e.parse(item.value);
    if (to === undefined) { unknown.push({ key: e.key, note: `value must be ${e.type === 'choice' ? `one of: ${(await e.choices()).map(([id, l]) => `${id} (${l})`).join(', ')}` : e.type === 'number' ? `a number from ${e.min} to ${e.max}` : 'text'}` }); continue; }
    const from = await e.read();
    if (same(from, to) || String(from) === String(to)) { unchanged.push({ key: e.key, label: e.label, now: await textOf(e, from) }); continue; }
    changes.push({ key: e.key, label: e.label, section: e.section, scope: e.scope, from, to, fromText: await textOf(e, from), toText: await textOf(e, to) });
  }
  return { changes, refused, unknown, same: unchanged };
}

/** Writes each change's `to` through the page's writer; returns the changes with `before` (each value as it stood when applied). */
export async function applySettings(changes) {
  const all = await entries(), done = [];
  for (const c of changes || []) {
    if (refusalOf(c.key)) throw new Error(`${c.label || c.key} is not the assistant's to change`);
    const e = find(all, c.key); if (!e) throw new Error(`${c.label || c.key} is no longer a setting here`);
    const before = await e.read();
    await e.write(c.to);
    done.push({ ...c, before });
  }
  return done;
}

/** Puts back each setting still at the value the card applied; one changed since stays. Returns { back: [labels], kept: [labels] }. */
export async function undoSettings(changes) {
  const all = await entries(), back = [], kept = [];
  for (const c of [...(changes || [])].reverse()) {
    const e = find(all, c.key); if (!e) { kept.push(c.label || c.key); continue; }
    const now = await e.read();
    if (!(same(now, c.to) || String(now) === String(c.to))) { kept.push(c.label); continue; }
    await e.write(c.before !== undefined ? c.before : c.from);
    back.unshift(c.label);
  }
  return { back, kept: kept.reverse() };
}

const NEXT = { apply: 'proposed', cancel: 'proposed', undo: 'applied' };
/** A press on a settings card: writes (Apply, Undo) and the card's new state, kept with the thread. Returns the block as it now stands. */
export async function decideCard(how, { threadId, message, block }) {
  const blockOf = st => st.threads?.find(t => t.id === threadId)?.messages?.[message]?.blocks?.[block];
  const b = blockOf(get());
  if (!b || b.type !== 'settings' || !NEXT[how]) throw new Error('This card is no longer in the chat');
  if ((b.state || 'proposed') !== NEXT[how]) return b;   // a second press, or a press on a card decided elsewhere, writes nothing
  const patch = how === 'apply' ? { state: 'applied', changes: await applySettings(b.changes), at: new Date().toISOString() }
    : how === 'undo' ? { state: 'undone', kept: (await undoSettings(b.changes)).kept }
    : { state: 'cancelled' };
  update(st => { const x = blockOf(st); if (x) Object.assign(x, patch); return st; });
  return blockOf(get());
}
