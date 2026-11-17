// Serializable proposals reconstruct their application through typed handlers.
const handlers = new Map();
export const registerProposalHandler = (kind, handler) => handlers.set(kind, handler);
export const hasProposalHandler = payload => !!payload && handlers.has(payload.kind);
export async function applyProposalPayload(payload, context) {
  const handler = handlers.get(payload?.kind);
  if (!handler) return { refused: 'This proposal cannot be restored. Run the action again.' };
  return handler(payload, context);
}

// What a stored proposal says is read from its payload and the project as they are now, never from text saved with it (plan §6):
// a describer is pure, takes the state it is given and returns { label?, detail?, acceptLabel?, stale? } or null.
const describers = new Map();
export const registerProposalDescriber = (kind, describe) => describers.set(kind, describe);
export function describeProposalPayload(payload, state) {
  const describe = describers.get(payload?.kind);
  if (!describe) return null;
  try { return describe(payload, state) || null; } catch { return null; }
}
