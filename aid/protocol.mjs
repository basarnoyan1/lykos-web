import { durableAction } from '../lib/aid-proposals.mjs';
// Model actions for the protocol view (lib/aid.mjs).
//
// This file is the pattern the others follow: an action states when it is
// offered, sends a prompt from lib/prompts-views.mjs (guard and instructions first,
// then `brief`: the project, the view, what is in focus, any selection, then the
// data of the call), asks for JSON, keeps
// only what the reply supports, and returns items whose accept() is the only
// thing that changes the project.
import { register, jsonOf } from '../lib/aid.mjs';
import { complete } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { get, update } from '../store.mjs';

const criteriaOf = s => (s.protocol?.criteria || []).filter(c => c.text);

/**
 * The criteria a run covers: those a selection touches, else the one in
 * focus, else all of them.
 */
export function chooseCriteria(crit, { selection, focus } = {}) {
  const chosen = selection ? crit.filter(c => selection.includes(c.text.slice(0, 30))) : [];
  if (chosen.length) return chosen;
  const one = focus?.kind === 'criterion' && crit.find(c => c.id === focus.label);
  return one ? [one] : crit;
}

/**
 * Reads the model's reply against the criteria sent. "Already testable" is
 * said only when the model answered with an explicit, empty rewrites list; a
 * reply that cannot be read, or has no such list, is no answer at all.
 */
export function readRewrites(reply, target) {
  let parsed = null;
  try { parsed = jsonOf(reply); } catch { parsed = null; }
  const got = Array.isArray(parsed?.rewrites) ? parsed.rewrites : null;
  if (!got) return { rewrites: [], note: 'No answer from the model' };
  const byId = new Map(target.map(c => [c.id, c]));
  const rewrites = got.filter(r => r && byId.has(r.id) && typeof r.text === 'string' && r.text.trim()
    && r.text.trim() !== byId.get(r.id).text.trim());
  const note = !got.length ? (target.length === 1 ? `${target[0].id} already reads as testable` : 'Every criterion already reads as testable')
    : rewrites.length < got.length ? `${got.length - rewrites.length} dropped: not a criterion sent, or unchanged` : '';
  return { rewrites, note };
}

const proposeRewrite = durableAction('criterion', ({ id, before, text }) => {
  // A criterion edited or removed since the run is not overwritten:
  // the rewrite answered a text that no longer stands.
  const c = (get().protocol?.criteria || []).find(x => x.id === id);
  if (!c) return { refused: `${id} was removed` };
  if (c.text !== before) return { refused: `${id} changed since; run again` };
  update(s => {
    const x = (s.protocol?.criteria || []).find(y => y.id === id);
    if (x) x.text = text;
    return s;
});
return `${id} replaced`;
});

register('protocol', [
  {
    id: 'testable-criteria',
    label: 'Make criteria testable',
    icon: 'protocol',
    task: 'write',
    when: s => criteriaOf(s).length > 0,
    async run({ cfg, signal, brief, selection, focus }) {
      const target = chooseCriteria(criteriaOf(get()), { selection, focus });
      const out = await complete(cfg, P.messagesOf(P.protocolTestable, { brief, criteria: target }), { prompt: P.protocolTestable, signal, temperature: 0, json: true });
      const { rewrites, note } = readRewrites(out, target);
      // The text each proposal rewrote, as it stood when the model read it.
      const was = new Map(target.map(c => [c.id, c.text]));
      return {
        prompt: promptRef(P.protocolTestable),
        title: target.length === 1 ? `${target[0].id} made testable` : 'Criteria made testable',
        note,
        items: rewrites.map(r => ({
          label: String(r.text).trim().slice(0, 300),
          detail: `${r.id} now: ${was.get(r.id)}${r.why ? `\n${String(r.why).slice(0, 160)}` : ''}`,
          acceptLabel: `Replace ${r.id}`,
          ...proposeRewrite({ id: r.id, before: was.get(r.id), text: String(r.text).trim().slice(0, 300) }),
        })),
      };
    },
  },
]);
