// A piece of a chat request handed to another connected model (owner, 15 Nov 2026: "in app assistant also should be able to choose other models
// during chat like when said 'Use Fable to do it...' choose a Fable agent"). The chat's hand_to_model tool (lib/chat-tools.mjs) runs it:
//
//   connectedModels(state)        every model the person's connections can run: the profile's own model, the models it lists, and the catalogue
//                                 a Claude or ChatGPT connection knows without a fetch. Jev (a decision model) and retired clients are not offered.
//   matchModel(asked, list, now)  the model a request names ("Fable", "GPT-5.1 mini", "Claude"), or a kind of helper ("a cheaper model", "a local
//                                 model"), with why it was chosen; or { none, available } with the names to offer. Never a silent substitute.
//   handoffFacts(cfg, task, st)   the run's preview (lib/run-preview.mjs runFacts: where it goes, the app's token estimate and list-price cost)
//   isPaid(cfg)                   a run that may cost money: anything not on this Mac and not listed at zero
//   handoff(...)                  match, say, ask before a paid run (the run preview, as every model run asks), show it in the chat's step list
//                                 with the model's name, run it read-only on that model, and return its answer for the chat to use
//
// The helper runs as a team member does (lib/model-teams.mjs): its own thread, read-only tools, a bounded budget, nested so it cannot hand off
// again or propose settings. Its calls are recorded in AI usage by lib/ai.mjs like any other.
import { lib_app_settings$settingsOf as settingsOf } from "../boot.mjs";
import { configured, cachedModels, modelInfo, routeOf, shortModel, isJev, PROVIDERS, RETIRED_PROVIDERS } from './ai.mjs';
import { nextPlan } from './work-plan.mjs';

export const HANDOFF_BUDGET = Object.freeze({ calls: 8, tokens: 40000 });
/** The answer a helper is expected to give, in tokens: the out side of the estimate (the budget above is the ceiling). */
export const HANDOFF_OUT = 2000;
export const HANDOFF_ROLE = 'The Lykos assistant handed you one piece of the person\'s request. Do only that piece, with read-only tools, and answer it in full for the assistant to use. You cannot change the project, hand work on or propose settings.';

const clip = (v, n) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const tokensOf = s => String(s || '').toLowerCase().split(/[^\p{L}\p{N}.]+/u).flatMap(t => [t, ...t.split('.')]).filter(Boolean);
// words a request wraps a model's name in ("use", "ask a ... model to")
const FILLER = new Set(['use', 'using', 'ask', 'have', 'let', 'get', 'with', 'via', 'on', 'the', 'a', 'an', 'model', 'models', 'agent', 'helper', 'llm', 'ai', 'to', 'do', 'it', 'please', 'run', 'by', 'from']);
const CHEAP = /\b(cheap|cheaper|cheapest|less expensive|lower[- ]cost|inexpensive|budget)\b/i;
const LOCAL = /\b(local|locally|offline|on (?:this|my) (?:mac|machine|computer)|on[- ]device)\b/i;

const nameOf = id => shortModel(id);
const priceOf = (cfg, id) => { const i = modelInfo(cfg, id); return Number.isFinite(i.promptPrice) ? i.promptPrice + (Number.isFinite(i.completionPrice) ? i.completionPrice : 0) : null; };

/** Every model a connection of this project can run, in the person's order: [{ profile, id, name, route, price }]. */
export function connectedModels(state) {
  const out = [], seen = new Set();
  for (const p of settingsOf(state).models?.profiles || []) {
    if (!p || RETIRED_PROVIDERS.has(p.provider) || isJev(p) || !configured(p)) continue;
    const own = p.model || PROVIDERS[p.provider]?.defaultModel || '';
    const catalogue = ['anthropic', 'chatgpt'].includes(p.provider) ? cachedModels(p).map(r => r.id) : [];
    for (const id of [own, ...(Array.isArray(p.models) ? p.models : []), ...catalogue]) {
      if (!id || seen.has(`${p.id}\n${id}`)) continue;
      seen.add(`${p.id}\n${id}`);
      out.push({ profile: p, id, name: nameOf(id), own: id === own, route: routeOf(p), price: priceOf(p, id) });
    }
  }
  return out;
}

/** The names to offer when nothing matched: each model once, the connection's own model first. */
export const availableNames = list => [...new Set([...list.filter(m => m.own), ...list.filter(m => !m.own)].map(m => m.name))].slice(0, 20);

const chosen = (m, why) => ({ cfg: { ...m.profile, model: m.id }, id: m.id, name: m.name, connection: m.profile.label || PROVIDERS[m.profile.provider]?.label || m.profile.provider, why });

/**
 * The model `asked` names, from `list` (connectedModels). `current` is the chat's own { cfg } so "cheaper" means cheaper than it.
 * Returns { cfg, id, name, connection, why } or { none: true, asked, reason, available }.
 */
export function matchModel(asked, list, { current = null } = {}) {
  const text = String(asked || '').trim(), none = reason => ({ none: true, asked: clip(text, 80), reason, available: availableNames(list) });
  if (!text) return none('No model was named.');
  if (!list.length) return none('No model is connected.');
  if (LOCAL.test(text)) {
    const m = list.find(x => x.route === 'local' && x.own) || list.find(x => x.route === 'local');
    return m ? chosen(m, 'the connected model that runs on this Mac') : none('No connected model runs on this Mac.');
  }
  if (CHEAP.test(text)) {
    const priced = list.filter(x => x.price != null).sort((a, b) => a.price - b.price);
    if (!priced.length) return none('No connected model has a known price, so none can be called cheaper.');
    const now = current?.cfg ? priceOf(current.cfg, current.cfg.model) : null, m = priced[0];
    if (now != null && m.price >= now) return none(`No connected model is cheaper than ${nameOf(current.cfg.model)}.`);
    return chosen(m, now != null ? `the cheapest connected model by list price, cheaper than ${nameOf(current.cfg.model)}` : 'the cheapest connected model by list price');
  }
  const words = tokensOf(text).filter(w => !FILLER.has(w));
  if (!words.length) return none('No model was named.');
  const fits = m => { const hay = tokensOf(`${m.id} ${m.name} ${m.profile.label || ''} ${PROVIDERS[m.profile.provider]?.label || ''}`);
    return words.every(w => hay.some(h => h === w || (w.length >= 3 && h.startsWith(w)))); };
  const hits = list.filter(fits);
  if (!hits.length) return none(`No connected model is called “${clip(text, 60)}”.`);
  // several fit ("Claude"): the connection's own model if it is one of them, else the first in the catalogue's order (newest first)
  const m = hits.find(x => x.own) || hits[0];
  return chosen(m, hits.length > 1 ? `named in the request; of ${hits.length} connected models that fit, the first` : 'named in the request');
}

/** A run that may cost money: anything not on this Mac and not listed at zero (a price not known counts as paid). */
export function isPaid(cfg) {
  if (routeOf(cfg) === 'local') return false;
  const i = modelInfo(cfg, cfg.model);
  return !(i.promptPrice === 0 && i.completionPrice === 0);
}

/** The token estimate a hand-off starts from: the chat's instructions, the project brief and the task, at four characters a token. */
export async function handoffTokens(task, st) {
  const [{ CHAT_SYSTEM }, { chatBrief }] = await Promise.all([import('./agent.mjs'), import('./context.mjs')]);
  return { inTokens: Math.ceil((CHAT_SYSTEM.length + chatBrief(st, task, null).length + String(task).length + HANDOFF_ROLE.length) / 4), outTokens: HANDOFF_OUT };
}

/** The preview's facts for this run (the same rows the run dialog shows) and their lines as words. */
export async function handoffFacts(cfg, task, st) {
  const { runFacts } = await import('./run-preview.mjs');
  const tokens = await handoffTokens(task, st), facts = runFacts({ cfgs: [cfg], tokens, budget: HANDOFF_BUDGET, classes: ['metadata'] });
  return { tokens, facts, lines: facts.rows.flatMap(r => r.key === 'where' || r.key === 'run' ? r.detail : []) };
}

/** The step list with the hand-off shown as a step of its own, under way, after the step it serves. Returns { plan, back(ok) }. */
export function handoffStep(prev, label) {
  const steps = prev?.steps || [];
  if (!steps.length) {
    const plan = nextPlan(null, { steps: [label] });
    return { plan, back: ok => (ok ? nextPlan(plan, { advance: true }) : null) };
  }
  const was = steps.findIndex(s => s.state === 'running'), at = was < 0 ? steps.length : was + 1;
  const list = steps.map(s => ({ title: s.name, status: { running: 'in_progress', done: 'completed' }[s.state] || 'pending', total: s.total, unit: s.unit }));
  list.splice(at, 0, { title: label, status: 'pending' });
  if (list.length > 12) return { plan: null, back: () => null };   // a full list stays as it is: the step is still named in the tool's record
  const plan = nextPlan(prev, { steps: list, start: at + 1 });
  return { plan, back: ok => {
    if (ok) return nextPlan(plan, { done: [at + 1], ...(was >= 0 ? { start: was + 1 } : {}) });
    const without = plan.steps.filter((_, i) => i !== at).map(s => ({ title: s.name, status: { running: 'in_progress', done: 'completed' }[s.state] || 'pending', total: s.total, unit: s.unit }));
    return without.length ? nextPlan(plan, { steps: without, ...(was >= 0 ? { start: was + 1 } : {}) }) : null;
  } };
}

const defaultAsk = async ({ cfg, name, why, tokens }) => {
  const { runPreview } = await import('./run-preview.mjs');
  return (await runPreview({ id: 'handoff-preview', title: `Hand this to ${name}?`, detail: `Chosen as ${why}`, confirm: 'Run', cfgs: [cfg], tokens, budget: HANDOFF_BUDGET, classes: ['metadata'], submit: () => true })) === true;
};
const defaultRun = async ({ cfg, task, signal, threadId }) => {
  const { chatTurn } = await import('./agent.mjs');
  return chatTurn({ thread: { id: `${threadId || 'chat'}:handoff:${Date.now().toString(36)}`, messages: [] }, text: task, cfg, scope: { kind: 'project' }, readOnly: true, nested: true,
    budget: { ...HANDOFF_BUDGET }, signal, roleInstructions: HANDOFF_ROLE });
};

/**
 * The tool's whole run. `a` is { model, task, why? }; `current` the chat's { cfg }. `plan()` and `showPlan(plan)` read and draw the step list;
 * `askFirst` and `run` are the run dialog and the helper's turn (a test passes fakes). Returns the tool's answer object and a record line.
 */
export async function handoff(a, { state, current = null, threadId = null, signal, plan = () => null, showPlan = () => {}, askFirst = defaultAsk, run = defaultRun, list = null } = {}) {
  const task = clip(a?.task, 4000);
  if (!task) return { data: { error: 'Pass task: the piece of the request to hand over, in full.' }, record: 'Not handed over' };
  const models = list || connectedModels(state), m = matchModel(a?.model, models, { current });
  if (m.none) return { data: { handed: false, reason: m.reason, available: m.available, note: 'Tell the person in one line that no connected model matches and list these; do not hand the work to another model in its place.' }, record: `No model “${clip(a?.model, 40)}”` };
  const { tokens, lines } = await handoffFacts(m.cfg, task, state);
  const paid = isPaid(m.cfg);
  if (paid && !(await askFirst({ cfg: m.cfg, name: m.name, why: m.why, tokens, task }))) {
    return { data: { handed: false, model: m.name, cancelled: true, estimate: lines, note: 'The person declined the run. Say so in one line; do not run it another way.' }, record: `Declined: ${m.name}` };
  }
  if (signal?.aborted) return { data: { error: 'run stopped' }, record: 'Stopped' };
  const step = handoffStep(plan(), `${m.name}: ${clip(task, 60)}`);
  if (step.plan) showPlan(step.plan);
  let out;
  try { out = await run({ cfg: m.cfg, task, signal, threadId }); }
  catch (e) {
    const back = step.back(false); if (back) showPlan(back);
    if (signal?.aborted) return { data: { error: 'run stopped' }, record: 'Stopped' };
    return { data: { handed: true, model: m.name, error: clip(e?.message || e, 300) }, record: `${m.name} failed: ${clip(e?.message || e, 80)}` };
  }
  const back = step.back(out?.reason !== 'error'); if (back) showPlan(back);
  const usage = out?.usage || {};
  return { data: { handed: true, model: m.name, id: m.id, connection: m.connection, why: m.why, paid, estimate: lines, status: out?.reason || 'done', answer: clip(out?.text, 8000),
    usage: { tokensIn: usage.prompt || 0, tokensOut: usage.completion || 0, ...(Number.isFinite(usage.cost) ? { cost: usage.cost } : {}) },
    note: `Say that ${m.name} did this piece and why it was chosen, then use its answer; it is a model's reading, so check a figure before relying on it.` },
    record: `${m.name}: ${clip(task, 50)}` };
}
