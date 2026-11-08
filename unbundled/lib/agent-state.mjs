// Whether another program (an AI agent, a build script) is editing the project folder right now, as lib/agent-activity.mjs last read it.
// Kept apart, with nothing imported, so the store and the folder recorder can ask without loading the reader.
let editing = null, endedAt = 0;
/** The activity being shown ({ by, what, areas, since }) or null. */
export const agentEditing = () => editing;
/** When the last activity ended (ms), 0 when none has. */
export const agentEndedAt = () => endedAt;
/** Set by the reader: an activity, or null when it ended. */
export function setAgentEditing(a, now = Date.now()) { if (editing && !a) endedAt = now; editing = a || null; }
/** True while an agent edits, and for `graceMs` after it stopped (its last write may still be arriving). */
export const agentRecent = (graceMs = 120000, now = Date.now()) => !!editing || (endedAt > 0 && now - endedAt < graceMs);
