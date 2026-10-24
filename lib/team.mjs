// The people working on a project (plan §2, "Working as a team"): who is at this window, and the team a project knows. A person is
// { id, name, initials, email? }; `id` is the email when Google sign-in gave one, else the initials. The project keeps `s.team`, an id-keyed
// list, so two people joining at once merge (lib/project-merge.mjs); people seen deciding in dual screening count too.

import { currentPerson, byMe, initialsOf } from './app-settings.mjs';
export { currentPerson, byMe, initialsOf };

/** The team: everyone the project lists, then initials seen in dual screening, without repeats. */
export function teamOf(s) {
  const out = [...(s.team || [])], seen = new Set(out.flatMap(p => [p.id, p.initials].filter(Boolean)));
  for (const stage of Object.values(s.dual || {})) for (const rec of Object.values(stage || {})) for (const who of Object.keys(rec || {}))
    if (!seen.has(who)) { seen.add(who); out.push({ id: who, name: who, initials: who }); }
  return out;
}

/** Adds the person at this window to `s.team`, or updates their name; answers whether anything changed. Mutates `s`. */
export function joinTeam(s) {
  const m = currentPerson(s);
  if (!m.id) return false;
  const list = s.team || [], at = list.findIndex(p => p.id === m.id);
  if (at >= 0 && list[at].name === m.name && list[at].initials === m.initials) return false;
  s.team = at >= 0 ? list.map((p, i) => i === at ? { ...p, ...m } : p) : [...list, m];
  return true;
}

/** The person a label names: an id, initials or name, case-insensitive. */
export const personOf = (s, who) => {
  const w = String(who || '').toLowerCase();
  return w ? teamOf(s).find(p => [p.id, p.initials, p.name].some(x => String(x || '').toLowerCase() === w)) || null : null;
};
