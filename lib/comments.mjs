// Comments on a record, a table or figure of the paper (plan §2, "Working as a team"). `s.comments` is an id-keyed list, so comments two
// people add at once both survive a merge (lib/project-merge.mjs):
//   { id, target: { kind: 'record' | 'item', id }, text, by, at, done?, mentions: [person id] }
// "@Name", "@initials" or "@email" names a teammate (lib/team.mjs); the manuscript's own range comments are read for mentions too.
import { teamOf } from './team.mjs';

const sameTarget = (a, b) => a?.kind === b?.kind && a?.id === b?.id;

/** The people a text names with @: ids from the team, matched on the longest name first, without repeats. */
export function mentionsIn(text, team) {
  const t = ` ${String(text || '').toLowerCase()}`, out = [];
  const keys = team.flatMap(p => [p.name, p.initials, p.email].filter(Boolean).map(k => [String(k).toLowerCase(), p.id])).sort((a, b) => b[0].length - a[0].length);
  for (const [k, id] of keys) {
    const at = t.indexOf(`@${k}`);
    if (at < 0 || out.includes(id)) continue;
    const before = t[at - 1], after = t[at + k.length + 1];
    if (/\s|\(/.test(before) && (after === undefined || !/[\p{L}\p{N}]/u.test(after))) out.push(id);
  }
  return out;
}

/** Adds a comment; answers it, or throws for an empty one. Mutates `s`. */
export function addComment(s, { target, text, by, at = new Date().toISOString(), id = crypto.randomUUID() }) {
  const body = String(text || '').trim();
  if (!body) throw new Error('Write a comment first');
  const c = { id, target: { kind: target.kind, id: String(target.id) }, text: body.slice(0, 4000), by: String(by || ''), at, mentions: mentionsIn(body, teamOf(s)) };
  s.comments = [...(s.comments || []), c];
  return c;
}

export function setCommentDone(s, id, done) {
  s.comments = (s.comments || []).map(c => c.id === id ? { ...c, done: !!done } : c);
}
/** Removes a comment; only its author's own. Answers whether it did. */
export function removeComment(s, id, by) {
  const c = (s.comments || []).find(x => x.id === id);
  if (!c || c.by !== by) return false;
  s.comments = s.comments.filter(x => x.id !== id);
  return true;
}

/** The comments on one target, oldest first; open ones before resolved. */
export const commentsOn = (s, target) => (s.comments || []).filter(c => sameTarget(c.target, target)).sort((a, b) => (!!a.done - !!b.done) || String(a.at).localeCompare(String(b.at)));

/**
 * Open comments that name `person` (an id from lib/team.mjs), newest first, with where they are:
 * [{ id, text, by, at, target }] — the manuscript's range comments as target { kind: 'manuscript', id }.
 */
export function mentionsOf(s, person) {
  if (!person?.id) return [];
  const team = teamOf(s), own = new Set([person.id, person.initials].filter(Boolean));
  const out = (s.comments || []).filter(c => !c.done && c.by !== person.initials && (c.mentions || []).some(m => own.has(m)));
  for (const [id, c] of Object.entries(s.manuscript?.comments || {})) {
    if (c.done || c.initials === person.initials) continue;
    if (mentionsIn(c.text, team).some(m => own.has(m))) out.push({ id, text: c.text, by: c.initials || c.author || '', at: c.date || '', target: { kind: 'manuscript', id } });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
