// What a project opening does for the people working on it (plan §2, "Working as a team"), loaded after the shell: in a project shared in
// Google Drive the person at this window joins its team (lib/team.mjs), and open comments that name them are said once (lib/comments.mjs).
import { joinTeam, currentPerson } from './team.mjs';
import { mentionsOf } from './comments.mjs';

export function startTeam({ drive, get, update, notice, showMentions }) {
  // a probe first: opening a project the person already joined writes nothing
  if (drive && joinTeam(structuredClone({ team: get().team, settings: get().settings }))) update(s => { joinTeam(s); });
  const n = mentionsOf(get(), currentPerson(get())).length;
  if (n) notice({ id: 'mentions', label: 'Mentioned', text: `${n === 1 ? 'A comment mentions' : `${n} comments mention`} you`, actions: [{ id: 'mentions-show', label: 'Show', run: showMentions }] });
}
