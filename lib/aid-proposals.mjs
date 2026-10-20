// Typed application handlers for view actions. Persist only the validated data
// needed to apply a proposal; never a model connection, closure or project copy.
import { registerProposalHandler, registerProposalDescriber, describeProposalPayload } from './proposal-handlers.mjs';
import { get } from '../store.mjs';

/** `describe(data, state)`, when given, says what a stored item of this kind reads as now (lib/proposal-handlers.mjs). */
export function durableAction(name, apply, describe = null) {
  const kind = `view-action:${name}`;
  registerProposalHandler(kind, (payload, context) => {
    // a kind whose describer says live checks the live state in apply(): it is held to the project only
    const live = describe && describeProposalPayload(payload, get())?.live;
    (live ? context.guardBoundary || context.guard : context.guard)();
    if (payload.version !== 1) return { refused: 'This proposal uses an unsupported version. Run the action again.' };
    return apply(payload.data, context);
  });
  if (describe) registerProposalDescriber(kind, (payload, state) => (payload.version === 1 ? describe(payload.data, state) : null));
  return (data, afterApply) => {
    const payload = { kind, version: 1, data: structuredClone(data) };
    return { payload, accept: context => {
      const result = apply(payload.data, context || {});
      const done = value => { if (!value?.refused) afterApply?.(); return value; };
      return result?.then ? result.then(done) : done(result);
    } };
  };
}
