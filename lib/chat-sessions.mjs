// Conversation labels and a bounded history query. No model call or migration
// is needed to give older numbered chats a useful title.
/** A turn's ceiling: the built-in budget of a chat (a team's is larger) and the bounds every budget is held to. */
export const BUDGET_DEFAULT = Object.freeze({ calls: 20, tokens: 80000 });
export const TEAM_BUDGET_DEFAULT = Object.freeze({ calls: 40, tokens: 150000 });
export const BUDGET_LIMITS = Object.freeze({ calls: Object.freeze([1, 48]), tokens: Object.freeze([1000, 200000]) });
/** Allocate a bounded larger default for substantial work; never override a chosen ceiling. */
export function taskBudget(text, base = BUDGET_DEFAULT, { paperCount = 0, explicit = false } = {}) {
  const work = /\b(check|review|audit|verify|appraise|compare|extract|research|investigate|analy[sz]e)\b/i.test(text);
  const broad = /\b(all|every|each|one by one|remaining|other studies|across)\b/i.test(text) && /\b(papers?|studies|appraisals?|results?|records?|sources?)\b/i.test(text);
  const deliverables = /\b(protocol|manuscript|systematic review|multiple deliverables|comprehensive)\b/i.test(text);
  const major = (work && broad) || (deliverables && /\b(write|draft|create|build|produce|prepare|review|audit|research|investigate|analy[sz]e)\b/i.test(text));
  if (!major || explicit) return { ...base, major };
  const large = paperCount > 8 || deliverables;
  return { calls: Math.min(BUDGET_LIMITS.calls[1], Math.max(base.calls, large ? 40 : 32)),
    tokens: Math.min(BUDGET_LIMITS.tokens[1], Math.max(base.tokens, large ? 200000 : 160000)), major };
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
