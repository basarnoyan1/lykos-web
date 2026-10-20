import { showMenu } from './menu.mjs';
import { modelTeams } from './model-team-list.mjs';

/**
 * The menu of the open project's teams, to choose one for a chat or a workflow block (`choose(team)`); the last entry opens Settings > Teams
 * (`manage()`), where a team is made, changed or deleted. At most ten teams are listed, the rest are there.
 */
export function teamMenu(anchor, { choose, manage }) {
  const teams = modelTeams();
  showMenu(anchor, [...teams.slice(0, 10).map(team => ({ label: team.name, meta: `${team.members.length} members`, run: () => choose(team) })),
    ...(teams.length ? ['-'] : []), { label: 'Manage teams', run: () => manage() }]);
}
