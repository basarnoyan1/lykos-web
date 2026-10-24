// The composer's model menu (Gumloop's "Recommended, Smartest, Fastest" over the providers, Base44's "Auto: matched for each request"; owner via
// the Mobbin review, 2026-10-23): the models the person has configured, each by its readable name (lib/model-names.mjs), led by the one
// recommended for this chat's mode with a one-word reason. Only configured models are offered; nothing here calls a provider.
//
//   modelChoices({ profiles, routes, extra })   every configured model once: { profileId, model, name, provider }
//   tierOf(model)                                'strong' | 'balanced' | 'fast', read from the model's name (its maker's own words)
//   recommend(choices, { mode, route })          { choice, reason }: Research the strongest, Ask the fastest, Act a balanced one or the chat's own
//   modelMenu(...)                               the menu's entries and options: Recommended, Models (searchable past eight), then the rest
import { modelName } from './model-names.mjs';

// What a maker's names say about a model. A model whose name says nothing is 'balanced'.
const STRONG = /\b(opus|fable|o[13](?!-mini)|gpt-5(?:\.\d+)?(?![\w.-]*(mini|nano))|ultra|pro\b|max\b|large|405b|235b|r1\b|reasoner|thinking)/i;
const FAST = /\b(haiku|mini|nano|flash|lite|small|tiny|instant|turbo|[1-9]b\b|1[0-4]b\b)/i;
export function tierOf(model) {
  const id = String(model || '').toLowerCase().replace(/[/:_]/g, ' ').replace(/-/g, ' ');
  const name = `${id} ${modelName(model).toLowerCase()}`;
  if (FAST.test(name)) return 'fast';
  if (STRONG.test(name)) return 'strong';
  return 'balanced';
}
const RANK = { strong: 0, balanced: 1, fast: 2 };

/**
 * Every configured model once, in the order the person set them up: each connection's own model, then the models the task routes name
 * (Settings › Models), then `extra` (the chat's own choice). `profiles` are the usable connections (not the Jev profile).
 */
export function modelChoices({ profiles = [], routes = {}, extra = [] } = {}) {
  const out = [], seen = new Set();
  const add = (p, model) => {
    if (!p || !model) return; const key = `${p.id}\n${model}`; if (seen.has(key)) return; seen.add(key);
    out.push({ profileId: p.id, model, name: modelName(model) || model, provider: (p.label && p.label !== model && p.label !== p.model ? p.label : p.provider) || '' });   // the connection's own name, not its model again
  };
  for (const p of profiles) add(p, p.model);
  for (const r of Object.values(routes || {})) add(profiles.find(p => p.id === r?.profileId), r?.model);
  for (const x of extra) add(profiles.find(p => p.id === x?.profileId), x?.model);
  return out;
}

/** The recommendation for a mode: `route` is the chat task's own model ({ profileId, model }), the fallback. Null when nothing is configured. */
export function recommend(choices = [], { mode = 'act', route = null } = {}) {
  if (!choices.length) return null;
  const by = tier => choices.filter(c => tierOf(c.model) === tier);
  const own = route && choices.find(c => c.profileId === route.profileId && c.model === route.model);
  if (mode === 'research') { const c = by('strong')[0] || by('balanced')[0]; if (c) return { choice: c, reason: tierOf(c.model) === 'strong' ? 'Strongest' : 'Balanced' }; }
  if (mode === 'ask') { const c = by('fast')[0] || by('balanced')[0]; if (c) return { choice: c, reason: tierOf(c.model) === 'fast' ? 'Fastest' : 'Balanced' }; }
  if (mode === 'act') { const c = by('balanced')[0]; if (c) return { choice: c, reason: 'Balanced' }; }
  if (own) return { choice: own, reason: 'Default' };
  const c = choices.slice().sort((a, b) => RANK[tierOf(a.model)] - RANK[tierOf(b.model)])[0];
  return { choice: c, reason: { strong: 'Strongest', balanced: 'Balanced', fast: 'Fastest' }[tierOf(c.model)] };
}

/** Menus search their rows once the list is long (Gumloop): more than this many models. */
export const SEARCH_FROM = 8;

/**
 * The chat's model menu: [items, options, searchable] for lib/menu.mjs showMenu (searchable: add lib/menu-search.mjs's field). `quick` is lib/model-controls.mjs quickModelItems (its catalog chooser
 * becomes More models…, its effort stays), `use(route)` switches the chat, `tail` the entries after (team, budget, connections).
 */
export function modelMenu({ cfg, profiles = [], routes = {}, chatRoute = {}, mode = 'act', quick = [], use, tail = [] }) {
  const choices = modelChoices({ profiles, routes, extra: [{ profileId: cfg.id, model: cfg.model }] });
  const rec = recommend(choices, { mode, route: { profileId: chatRoute.id, model: chatRoute.model } });
  const pick = c => () => use({ profileId: c.profileId, model: c.model, effort: '' });
  const [chooseItem, , effortItem] = quick;
  const items = [
    ...(rec ? [{ heading: 'Recommended' }, { label: rec.choice.name, meta: rec.reason, icon: 'sparkle', searchable: true, run: pick(rec.choice) }, '-'] : []),
    ...(choices.length ? [{ heading: 'Models' }, ...choices.map(c => ({ label: c.name, meta: c.provider, checked: c.profileId === cfg.id && c.model === cfg.model, searchable: true, run: pick(c) }))] : []),
    ...(chooseItem ? [{ ...chooseItem, label: 'More models…', meta: '' }] : []),
    '-', ...(effortItem ? [effortItem] : []), ...tail];
  return [items, { align: 'end', matchWidth: false, minWidth: 240 }, choices.length > SEARCH_FROM];
}
