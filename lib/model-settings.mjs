// The model profiles and the settings a project reads: which connection serves a task (modelFor), the profile list and where each profile is
// saved (app-wide or this project's own). Views/settings.mjs, the Settings page, re-exports all of it; the shell, the assistant and the agent
// import from here so that the page itself loads when it is opened (app.mjs `viewOf`), not at start.
import { get, update } from '../store.mjs';
import { PROVIDERS, RETIRED_PROVIDERS, modelInfo } from './ai.mjs';
import { ask } from './dialog.mjs';
import { BUDGET_DEFAULT } from './chat-sessions.mjs';
import { layers, updateApp, appValues, appSettingsStatus, withoutOverride, pinOverride, settingsOf } from './app-settings.mjs';

const DEFAULTS = { ncbiEmail: '', ncbiKey: '', measure: 'RR', method: 'REML',
  reviewerName: '', reviewerInitials: '', dualScreening: false, screenSecond: '',
  ai: { provider: '', base: '', key: '', model: '' } };
// What a project reads: app-wide values, then the project's own over them, then these
// (lib/app-settings.mjs). Writes never start from this object: it holds app-wide values,
// which must not be copied into a project. A project's own settings are get().settings.
export const settings = () => ({ ...DEFAULTS, ...settingsOf(get()) });
export const own = v => typeof v === 'string' && v.trim() !== '';
/** Writes one setting the project holds of its own. */
export const saveOwn = (k, v) => update(st => { st.settings = { ...(st.settings || {}), [k]: v }; return st; });
/** Writes a project's own settings object whole (or one changed by withoutOverride). */
export const putOwn = next => update(st => { st.settings = next; return st; });
/** The budget a chat without its own takes (a chat's own is set in the popover on its model picker). */
export const chatBudgetOf = cfg => ({ calls: Number(cfg.chatBudget?.calls) || BUDGET_DEFAULT.calls, tokens: Number(cfg.chatBudget?.tokens) || BUDGET_DEFAULT.tokens });

// ---- model profiles, one per task ------------------------------------------
// A review uses more than one model: a cheap one to sort notes into tasks, a
// decision model for screening, a strong one for writing. Profiles hold the
// connections; `tasks` says which profile does which job; an unassigned task
// uses the first profile. The old single `ai` setting becomes the first profile.
export const TASKS = [
  ['chat',     'Chat'],
  ['fill',     'Fill and verify'],
  ['tasks',    'Task notes'],
  ['screen',   'Screening'],
  ['decide',   'Fast screening'],
  ['extract',  'Extraction'],
  ['appraise', 'Appraisal'],
  ['write',    'Writing'],
  ['query',    'Search strategy'],
  ['compact',  'Compaction'],
  ['review',   'Manuscript review'],
];
/** Profiles a saved project still holds for the removed Codex and Claude Code clients. They are not offered or used. */
export const retiredProfiles = () => (settings().models?.profiles || []).filter(p => RETIRED_PROVIDERS.has(p.provider));
export function profiles() {
  const s = settings();
  const list = (s.models?.profiles || []).filter(p => !RETIRED_PROVIDERS.has(p.provider));
  if (list.length) return list;
  if ((s.models?.profiles || []).length) return [];
  return s.ai?.provider && !RETIRED_PROVIDERS.has(s.ai.provider) ? [{ id: 'p1', label: s.ai.model || s.ai.provider, ...s.ai }] : [];
}
export const connectionBase = base => String(base || '').trim().replace(/\/+$/, '');
export function defaultProfileKey(profile, list) {
  if (profile.key || profile.keyEdited || !profile.provider || !profile.base) return profile;
  const source = list.find(p => p.id !== profile.id && p.provider === profile.provider && p.key &&
    connectionBase(p.base) === connectionBase(profile.base));
  return source ? { ...profile, key: source.key, keyInherited: true } : profile;
}
export function changeProfileProvider(profile, provider, list) {
  const definition = PROVIDERS[provider];
  const changed = profile.provider && profile.provider !== provider;
  const peer = list.find(p => p.id !== profile.id && p.provider === provider && p.key && p.base);
  const next = { ...profile, provider,
    base: definition?.base || (!changed && profile.base) || peer?.base || '',
    ...(changed ? { key: '', workspaceId: '', keyEdited: false, keyInherited: false, models: [], ...((provider === 'chatgpt' || profile.provider === 'chatgpt') ? { model: '' } : {}) } : {}),
  };
  if (definition?.defaultModel && !next.model) next.model = definition.defaultModel;
  return defaultProfileKey(next, list);
}
/**
 * Writes the profile list back to the layer each profile came from. A profile only this
 * project has (or one it holds its own version of) goes to the project; the rest are
 * app-wide, and a profile new to the list is app-wide too. A profile left out of the list is removed.
 */
export function setProfiles(list) {
  const { origin } = layers(get());
  const keep = new Map(list.map(p => [p.id, p]));
  const appIds = new Set(appValues().models.profiles.map(p => p.id));
  const app = [];
  for (const a of appValues().models.profiles) {
    const p = keep.get(a.id);
    if (p) app.push(origin.get(a.id) === 'override' ? a : p);
  }
  for (const p of list) if (!appIds.has(p.id) && origin.get(p.id) !== 'project') app.push(p);
  const mine = new Map(list.filter(p => ['project', 'override'].includes(origin.get(p.id))).map(p => [p.id, { ...p }]));
  updateApp(v => { v.models.profiles = app.map(p => ({ ...p })); });
  // The project's own list changes only when its own profiles did; a leftover copy of an app-wide profile stays as it was.
  const raw = get().settings?.models?.profiles || [];
  const next = [];
  for (const r of raw) {
    if (mine.has(r.id)) next.push(mine.get(r.id));
    else if (origin.get(r.id) === 'app' && keep.has(r.id)) next.push(r);
  }
  for (const [id, m] of mine) if (!raw.some(r => r.id === id)) next.push(m);
  if (JSON.stringify(next) !== JSON.stringify(raw))
    update(st => { st.settings = { ...(st.settings || {}), models: { ...(st.settings?.models || {}), profiles: next } }; return st; });
}
/** The app-wide profile list starts from a legacy single connection, as it always did, once a change is made. */
function materializeLegacy() {
  if (appValues().models.profiles.length || layers(get()).profiles.length) return;
  const list = profiles();
  if (list.length) setProfiles(list);
}
/**
 * An OpenRouter key reaches Jev too: when an app-wide profile with that key exists and
 * no Jev profile does, one is added from it and given the fast-screening
 * task. Runs once at start; removing the Jev profile afterwards is respected
 * because the marker stays.
 */
export function ensureJevProfile() {
  const s = settings(); const list = profiles();
  if (s.models?.jevDerived || list.some(p => p.provider === 'jev') || appSettingsStatus().readOnly) return false;
  const src = list.find(p => p.provider === 'openrouter' && p.key && layers(get()).origin.get(p.id) === 'app');
  if (!src) return false;
  const jev = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: 'Jev', provider: 'jev', base: PROVIDERS.jev.base, key: src.key, model: PROVIDERS.jev.defaultModel };
  setProfiles([...list, jev]);
  updateApp(v => { v.models.tasks.decide = jev.id; v.models.jevDerived = true; });
  return true;
}
/** The OpenRouter profile whose key other OpenRouter models can share. */
export const openRouterSource = () => profiles().find(p => p.provider === 'openrouter' && p.key) || null;
/** One more OpenRouter model on the same key, as its own profile; its id. */
export function addOpenRouterModel(model) {
  const src = openRouterSource(); const m = String(model || '').trim();
  if (!src || !m) return '';
  const list = profiles().map(p => ({ ...p }));
  const have = list.find(p => p.provider === 'openrouter' && p.model === m);
  if (have) return have.id;
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
  list.push({ id, label: m.split('/').pop(), provider: 'openrouter', base: src.base || PROVIDERS.openrouter.base, key: src.key, model: m });
  setProfiles(list);
  return id;
}
/** Asks for a model id, adds it on the shared key, and gives it to `task` when one is named. */
export async function askOpenRouterModel(task = '') {
  const m = await ask('OpenRouter model', { placeholder: 'vendor/model', confirm: 'Add' });
  const id = addOpenRouterModel(m);
  if (id && task) setTaskModel(task, id);
  return id;
}
/**
 * The profile a task uses from now on; an empty id returns the task to the first profile.
 * App-wide unless this project pins the task (or `scope` says 'project'), in which case the pin moves.
 */
export function setTaskModel(task, id, scope = '') {
  if (get().settings?.models?.routes?.[task]) setTaskRoute(task, null);
  const pinnedHere = own(get().settings?.models?.tasks?.[task]);
  if ((scope || (pinnedHere ? 'project' : 'app')) === 'project') {
    update(st => { const models = { ...(st.settings?.models || {}) }; const tasks = { ...(models.tasks || {}) };
      if (id) tasks[task] = id; else delete tasks[task];
      st.settings = { ...(st.settings || {}), models: { ...models, tasks } }; return st; });
    if (id) pinOverride(`task:${task}`, id);
    return;
  }
  materializeLegacy();
  updateApp(v => { if (id) v.models.tasks[task] = id; else delete v.models.tasks[task]; });
}
/** A profile only this project has becomes an app-wide one, and the project stops holding it. */
export function makeProfileAppWide(id) {
  const p = (get().settings?.models?.profiles || []).find(x => x.id === id);
  if (!p || appValues().models.profiles.some(x => x.id === id)) return false;
  updateApp(v => { v.models.profiles.push({ ...p }); });
  putOwn(withoutOverride(get().settings, `profile:${id}`));
  return true;
}
/**
 * A reviewer identity this project keeps for itself (blinded screening): the value is the project's own
 * unless it is the app-wide one, and an empty value drops it.
 */
export function pinScalar(field, value) {
  const v = String(value ?? '').trim();
  if (!v || v === (appValues()[field] || '')) { if (own(get().settings?.[field])) putOwn(withoutOverride(get().settings, field)); return; }
  pinOverride(field, v);
  saveOwn(field, v);
}
/** The app-wide value of a plain setting. */
export const saveApp = (field, value) => updateApp(v => { v[field] = value; });
/** A menu of the profiles, the one a task uses selected. */
export function profileOptions(task) {
  const cur = modelFor(task);
  return profiles().map(p => `<option value="${String(p.id).replace(/"/g, '&quot;')}"${p.id === cur.id ? ' selected' : ''}>${String(p.label || p.model || p.provider).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</option>`).join('')
    + (openRouterSource() ? '<option value="__or">OpenRouter model…</option>' : '');
}
// Tasks that only fold or sort text: with two or more profiles and known prices they go to the cheapest one
// unless the person assigned one. Everything else defaults to the first profile, the person's primary.
const CHEAP_TASKS = new Set(['compact', 'tasks', 'review']);   // review: one short call per paragraph or section, many per version
export function cheapestProfile(list) {
  if (list.length < 2) return null;
  const priced = list.map(p => ({ p, price: modelInfo(p, p.model || PROVIDERS[p.provider]?.defaultModel).promptPrice })).filter(x => Number.isFinite(x.price));
  return priced.length ? priced.sort((a, b) => a.price - b.price)[0].p : null;
}
/** Quick task routes belong to this project; credentials remain in connection profiles. */
export function setTaskRoute(task, route = null) {
  if (!TASKS.some(([id]) => id === task)) throw new Error('Unknown model task.');
  update(s => { const models = s.settings.models ||= {}; const routes = models.routes ||= {};
    if (route) routes[task] = { profileId: String(route.profileId || '').slice(0,64), model: String(route.model || '').slice(0,256), effort: String(route.effort || '').slice(0,16) };
    else delete routes[task]; return s; });
}
export function modelFor(task) {
  const s = settings(); const list = profiles();
  const id = s.models?.tasks?.[task] || (task === 'chat' ? s.models?.tasks?.assist : null);
  const route = s.models?.routes?.[task];
  if (route) { const profile = list.find(p => p.id === route.profileId); return profile ? {...profile,model:route.model||profile.model,effort:route.effort||''} : {provider:'',model:'',id:route.profileId}; }
  const assigned = list.find(p => p.id === id);
  if (assigned) return assigned;
  // An unassigned folding task also takes the connection's cheap model where the provider names one (Claude Haiku on a Claude connection).
  const cheap = CHEAP_TASKS.has(task) && (cheapestProfile(list) || list[0]);
  if (cheap) return PROVIDERS[cheap.provider]?.cheapModel ? { ...cheap, model: PROVIDERS[cheap.provider].cheapModel, effort: '' } : cheap;
  return list[0] || { provider: '', base: '', key: '', model: '' };
}

/** The second model for two-model screening, or null when it is off (the default) or the same connection as the first. */
export function secondScreenModel() {
  const id = settings().screenSecond; if (!id) return null;
  const p = profiles().find(x => x.id === id);
  return p && p.id !== modelFor('screen').id ? p : null;
}
