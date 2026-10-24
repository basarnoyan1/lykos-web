// What a chat is called and what it did, read from its messages with no model call (owner, 2026-10-23: the home's recent chats were
// "hello", "hello" and a suggestion's text). Used by the chat home (lib/chat-home.mjs), which names a chat this way when it shows it;
// a person's own name for a chat is never replaced.
//
//   chatTitle(thread, state, { taken })   a short phrase: the first real exchange's main action, else its question, cut to a few words
//   greetingOnly(thread)                  every question a greeting or an acknowledgement, every answer short: folded under Show all
//   chatOutcome(thread, state)            the quiet second line: what it changed (accepted, waiting), else its last topic
import { writeOpen } from './tracked-edit.mjs';

const GREETING = /^(?:hey|hi|hello|hiya|yo|good (?:morning|afternoon|evening)|thanks?|thank you(?: very much)?|ty|merhaba|selam|teşekkürler|ok(?:ay)?|k|yes|yeah|yep|no|nope|sure|great|cool|nice|got it|perfect|continue|go on|go ahead)(?: there| team| everyone)?[\s!.,?]*$/iu;
const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim();
/** A greeting, thanks or a one-word acknowledgement: not what a chat is about. */
export const isGreeting = text => GREETING.test(clean(text));
const substantive = m => m?.role === 'user' && clean(m.text) && !isGreeting(m.text);

// the polite or conversational start of a request, which a title leaves out
const LEADS = [/^(?:hey|hi|hello)[,!.]?\s+/i, /^(?:so|ok(?:ay)?|now|also|and|then)[,]?\s+/i, /^(?:can|could|would|will) you\s+(?:please\s+)?/i, /^please\s+/i,
  /^(?:i (?:want|need|would like|'d like)|we (?:want|need)|let'?s)\s+(?:you\s+)?(?:to\s+)?/i, /^help me (?:to\s+)?/i, /^(?:explain|tell|show) (?:to )?me\s+/i, /^is there (?:a|an|any)\s+/i];
// what a request from the home's rows carries after the request itself
const ASK_TAIL = /\.\s*(?:Do what you can now|Which are they|How do I)[\s\S]*$/i;
/** A request as a few words: its lead dropped, its first sentence, at most `words` words, no closing mark, a capital first. */
export function phrase(text, words = 6) {
  let t = clean(text).replace(ASK_TAIL, '');
  for (let again = true; again;) { again = false; for (const re of LEADS) if (re.test(t)) { t = t.replace(re, ''); again = true; } }
  t = t.split(/(?<=[.!?])\s+/)[0].replace(/[\s.!?…:;,]+$/, '');
  const w = t.split(' ');
  if (w.length > words) t = w.slice(0, words).join(' ').replace(/[\s,;:–-]+(?:a|an|the|of|in|on|for|to|and|or|with|by|at|from)$/i, '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

// a request a row of the home makes ("Fill 6 cells: Akgun 2024, Study data"): the subject first, so the chat is not the row's text again
const ROW_REQUEST = /^([A-Z][a-z]+) (\d+ [^:]+?): (.+)$/;
const SECTION = /^h[1-3]$/;
/** The main action of an answer, when it wrote in the manuscript: "Revised discussion paragraph", "Added methods paragraph". */
function actionOf(answer, state) {
  const w = (answer?.blocks || []).find(b => b.type === 'written');
  if (w) {
    const bs = state?.manuscript?.blocks || [], i = bs.findIndex(b => b.id === w.block);
    const head = i >= 0 ? bs.slice(0, i + 1).reverse().find(b => SECTION.test(b.type) && b.id !== w.block)?.text : '';
    const verb = /^added/i.test(w.label || '') ? 'Added' : 'Revised';
    return `${verb} ${head ? `${clean(head).toLowerCase().split(' ').slice(0, 3).join(' ')} ` : ''}paragraph`;
  }
  const artifact = (answer?.blocks || []).find(b => b.type === 'artifact' && b.artifact?.title);
  if (artifact) return phrase(artifact.artifact.title, 6);
  return '';
}

/** The chat's title: the main action of its first real exchange, else its first real question; `taken` are the labels shown beside it. */
export function chatTitle(thread, state = null, { taken = [] } = {}) {
  const msgs = thread?.messages || [], at = msgs.findIndex(substantive);
  if (at < 0) return '';
  const answer = msgs.slice(at + 1).find(m => m.role === 'assistant');
  const action = actionOf(answer, state);
  if (action) return action;
  const asked = clean(msgs[at].text).replace(ASK_TAIL, '');
  const row = ROW_REQUEST.exec(asked);
  let title = row ? `${phrase(row[3], 5)}: ${row[1].toLowerCase()} ${row[2]}` : phrase(asked);
  if (taken.some(t => clean(t).toLowerCase() === title.toLowerCase())) {
    const next = msgs.slice(at + 1).find(substantive);
    title = next ? `${title}, then ${phrase(next.text, 5).replace(/^./, c => c.toLowerCase())}` : title;
  }
  return title.length > 64 ? `${title.slice(0, 63).replace(/\s+\S*$/, '')}…` : title;
}

/** Every question a greeting or an acknowledgement and every answer short: a chat with nothing to return to. */
export const greetingOnly = thread => {
  const msgs = thread?.messages || [];
  return msgs.some(m => m.role === 'user') && !msgs.some(substantive) && msgs.filter(m => m.role === 'assistant').every(m => clean(m.text).length <= 280 && !(m.blocks || []).length);
};

const counted = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/**
 * The second line: what the chat changed, as parts ("2 changes accepted", "1 proposal waiting"), else its last topic when that is not the
 * title. [] when there is nothing to add.
 */
export function chatOutcome(thread, state = null, title = '') {
  const msgs = thread?.messages || [], blocks = state?.manuscript?.blocks || [], ledger = state?.aiProposalLedger || [];
  let accepted = 0, waiting = 0;
  for (const m of msgs) {
    if (m.role !== 'assistant') continue;
    for (const b of m.blocks || []) if (b.type === 'written' && b.write) { if (writeOpen(blocks, b.write)) waiting++; else if (b.decided !== 'reject') accepted++; }
    for (const id of m.proposals || []) for (const it of ledger.find(e => e.id === id)?.items || []) { if (it.state === 'accepted') accepted++; else if (it.state === 'open') waiting++; }
  }
  const parts = [accepted ? counted(accepted, 'change accepted', 'changes accepted') : '', waiting ? counted(waiting, 'proposal waiting', 'proposals waiting') : ''].filter(Boolean);
  if (parts.length) return parts;
  const last = [...msgs].reverse().find(substantive), topic = last ? phrase(last.text, 7) : '';
  return topic && topic.toLowerCase() !== String(title).toLowerCase() && !String(title).toLowerCase().startsWith(topic.toLowerCase()) ? [topic] : [];
}
