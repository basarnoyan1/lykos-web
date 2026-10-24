// The assistant's two submission tools (lib/chat-tools.mjs, group manuscript): list_submissions reads the tracker; propose_submission
// files one event (or a new submission) as a proposal that a person accepts in Proposals. Only from text the person gave in the chat:
// the proposal carries its quoted source, its date must be the letter's, and nothing here looks anything up. No proposal sets a
// follow-up date (chaseOn): that is the person's decision. Accepting writes through the same model as the page (lib/submissions.mjs),
// so a kind or date that is not real is refused with the reason, also when the proposal is replayed from the ledger.
import { get, update } from '../store.mjs';
import { file } from './aid.mjs';
import { durableAction } from './aid-proposals.mjs';
import { proposalFor, applyProposal, syncTasks, listForAssistant } from './submissions.mjs';
import { dateValue } from './date-picker.mjs';

const today = () => dateValue(new Date());

/** Writes an accepted proposal: the event, then the tasks it keeps (syncTasks). */
function apply(data, context = {}) {
  context.guard?.();
  const check = proposalFor(data, get().submissions, today());
  if (check.error) return { refused: check.error };
  let refused = '';
  update(s => {
    try {
      const r = syncTasks(applyProposal(s.submissions, check.data), s.todos);
      s.submissions = r.submissions; s.todos = r.todos;
    } catch (err) { refused = String(err?.message || err); }
    return s;
  });
  return refused ? { refused } : 'Submission recorded';
}
const proposal = durableAction('submission', apply);

/** list_submissions: the journals so far, newest first, with their events (letters cut to 2,000 characters). */
export const listSubmissions = (state = get()) => listForAssistant(state.submissions, today());

/** propose_submission: validates, then files one proposal; an invalid one throws its reason back to the model. */
export function proposeSubmission(state, args = {}, { model = '', prompt = '' } = {}) {
  const check = proposalFor(args, state.submissions, today());
  if (check.error) throw new Error(check.error);
  const { payload, accept } = proposal(check.data);
  return file({ view: 'submissions', title: 'Submission', meta: model, prompt,
    items: [{ label: check.label, detail: `Source: ${check.detail}`, acceptLabel: 'Accept', payload, accept }] });
}
