// The model teams a project holds, read on their own: the shell lists them (the chat's session names, the team menu) while the code that runs a
// team (lib/model-teams.mjs, with the agent) loads when a chat is first used (lib/assistant.mjs `engine`).
import { get } from '../store.mjs';
export const modelTeams = () => get().modelTeams || [];
