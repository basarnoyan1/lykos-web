// Conversation labels and a bounded history query. No model call or migration
// is needed to give older numbered chats a useful title.
/** A turn's ceiling: the built-in budget of a chat (a team's is larger) and the bounds every budget is held to. */
// tokens count every call of the turn, each resending the transcript: a ceiling that ends real reading after a few pages is no ceiling but a stop
// (assistant review, 2026-10-23), so the default holds a turn of ten or more full reads
export const BUDGET_DEFAULT = Object.freeze({ calls: 24, tokens: 400000 });
export const TEAM_BUDGET_DEFAULT = Object.freeze({ calls: 40, tokens: 600000 });
export const BUDGET_LIMITS = Object.freeze({ calls: Object.freeze([1, 48]), tokens: Object.freeze([1000, 1000000]) });
/** Allocate a bounded larger default for substantial work; never override a chosen ceiling. */
export function taskBudget(text, base = BUDGET_DEFAULT, { paperCount = 0, explicit = false } = {}) {
  const work = /\b(check|review|audit|verify|appraise|compare|extract|research|investigate|analy[sz]e)\b/i.test(text);
  const broad = /\b(all|every|each|one by one|remaining|other studies|across)\b/i.test(text) && /\b(papers?|studies|appraisals?|results?|records?|sources?)\b/i.test(text);
  const deliverables = /\b(protocol|manuscript|systematic review|multiple deliverables|comprehensive)\b/i.test(text);
  const major = (work && broad) || (deliverables && /\b(write|draft|create|build|produce|prepare|review|audit|research|investigate|analy[sz]e)\b/i.test(text));
  if (!major || explicit) return { ...base, major };
  const large = paperCount > 8 || deliverables;
  return { calls: Math.min(BUDGET_LIMITS.calls[1], Math.max(base.calls, large ? 40 : 32)),
    tokens: Math.min(BUDGET_LIMITS.tokens[1], Math.max(base.tokens, large ? 800000 : 600000)), major };
}
const genericName = /^(?:Chat \d+|New chat|New team chat)$/i;
const greeting = /^(?:hey|hi|hello|thanks|thank you|merhaba|selam)(?: there| team| everyone)?[!.\s]*$/i;
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
export function sessionTitle(thread, teamName = '') {
  if (!thread) return 'New chat';
  const name = clean(thread.name);
  if (name && (thread.nameManual || (!genericName.test(name) && name !== teamName))) return name;
  const questions = (thread.messages || []).filter(m => m.role === 'user' && clean(m.text));
  const text = clean((questions.find(m => !greeting.test(clean(m.text))) || questions[0])?.text);
  if (!text) return thread.teamId ? 'New team chat' : 'New chat';
  return text.length <= 60 ? text : `${text.slice(0, 57).trimEnd()}…`;
}
export function sessionTime(thread) {
  const at = thread.messages?.at(-1)?.at;
  return Math.max((at && Date.parse(at)) || 0, Number(thread.createdAt) || 0);
}

// The composer's mode (lib/agent.mjs chatTurn): Ask answers with read-only tools; Act proposes changes (the default); Research loads the
// research, literature, web and document tools, plans first and has twice the budget, within the limits.
export const MODES = Object.freeze([
  Object.freeze({ id: 'ask', label: 'Ask', detail: 'Answers only' }),
  Object.freeze({ id: 'act', label: 'Act', detail: 'Proposes changes' }),
  Object.freeze({ id: 'research', label: 'Research', detail: 'Searches and reads widely' }),
]);
export const MODE_IDS = Object.freeze(MODES.map(m => m.id));
export const DEFAULT_MODE = 'act';
export const modeOf = thread => (MODE_IDS.includes(thread?.mode) ? thread.mode : DEFAULT_MODE);
export const modeLabel = id => (MODES.find(m => m.id === id) || MODES[1]).label;

export function modeBudget(budget, mode) {
  if (mode !== 'research') return budget;
  return { ...budget, calls: Math.min(BUDGET_LIMITS.calls[1], budget.calls * 2), tokens: Math.min(BUDGET_LIMITS.tokens[1], budget.tokens * 2), major: true };
}
export const modeTools = mode => ({ readOnly: mode === 'ask' });
// Reads: papers in full or by abstract (gap review row 10)
export const READS = Object.freeze({ full: 'Full papers', abstracts: 'Abstracts only' });
export const READS_DETAIL = Object.freeze({ full: 'Reads the PDFs it holds', abstracts: 'Faster, less detail' });
export const readsOf = thread => (thread?.reads === 'abstracts' ? 'abstracts' : 'full');
