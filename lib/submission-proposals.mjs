// The assistant's two submission tools (lib/chat-tools.mjs, group manuscript): list_submissions reads the tracker; propose_submission
// files one event (or a new submission) as a proposal that a person accepts in Proposals. Only from text the person gave in the chat:
// the proposal carries its quoted source, its date must be the letter's, and nothing here looks anything up. No proposal sets a
// follow-up date (chaseOn): that is the person's decision. Accepting writes through the same model as the page (lib/submissions.mjs),
// so a kind or date that is not real is refused with the reason, also when the proposal is replayed from the ledger.
import { store$get as get, store$update as update } from "../boot.mjs";
import { file } from './aid.mjs';
import { durableAction } from './aid-proposals.mjs';
import { lib_submissions$proposalFor as proposalFor, lib_submissions$applyProposal as applyProposal, lib_submissions$syncTasks as syncTasks, lib_submissions$listForAssistant as listForAssistant, lib_submissions$normaliseSubmissions as normaliseSubmissions, lib_submissions$dayOf as dayOf } from "../boot.mjs";
import { lib_date_picker$dateValue as dateValue } from "../boot.mjs";

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

const PACKAGE_DIR = /(^|\/)submission[ _-]?(\d{4}-\d{2}-\d{2})$/i;
/**
 * propose_package_submission: a dated submission folder found in the project folder ("Manuscript/Submission 2026-10-28", its files as
 * `files`) becomes a proposal for a submitted attempt that day, with the newest manuscript file attached. The journal is the person's to
 * name on acceptance (`journal` when known). Returns null when the folder is not dated or an attempt already holds that day or folder.
 */
export function proposePackageSubmission(state, { dir = '', files = [], journal = '' } = {}) {
  const m = PACKAGE_DIR.exec(String(dir).replace(/\/+$/, ''));
  const at = m ? dayOf(m[2]) : '';
  // the journal is the owner's to name: a folder that does not say it is not proposed with a placeholder
  if (!at || !String(journal).trim()) return null;
  const list = normaliseSubmissions(state.submissions);
  if (list.some(a => a.file?.rel?.startsWith(`${dir}/`) || a.events.some(e => e.kind === 'submitted' && e.at === at))) return null;
  const docs = files.filter(f => /\.docx?$/i.test(f)), ms = docs.filter(f => /manuscript/i.test(f.slice(f.lastIndexOf('/') + 1))).sort().at(-1) || docs.sort().at(0) || '';
  const check = proposalFor({ journal: String(journal).trim(), event: { kind: 'submitted', at }, source: `Submission folder ${dir}`, ...(ms ? { file: { rel: ms } } : {}) }, list, today());
  if (check.error) return null;
  const { payload, accept } = proposal(check.data);
  return file({ view: 'submissions', title: 'Submission', meta: '', prompt: '',
    items: [{ label: check.label, detail: `Source: ${check.detail}`, acceptLabel: 'Accept', payload, accept }] });
}
