// Assistant notes: the person's own standing notes to the assistant, kept in the project (plan §6.0b; docs/Assistant_Gaps_Review_2026-11.md G4, G8).
//
//   s.assistantNotes = [{ id, text, origin: 'typed' | 'reply' | 'rejection', from, at, edited? }]
//
// A note enters only by a press of the person: typed on the Assistant notes page, "Remember this" on a reply (the person confirms the words, the
// reply's first sentence is only the starting text), or "Keep as a note" on a rejection reason. Nothing a document or a model says is ever written
// here: the only writers are the functions below, called from the page and the reply row, and a test holds the list of files that mention the key.
// The notes go into every chat and model call after the project brief, tagged as the person's data (lib/context.mjs notesBrief); the whole list is
// what is sent, so the size bound is on the list itself: a note is at most NOTE_MAX characters, the list at most NOTES_TOTAL_MAX and NOTES_COUNT_MAX
// notes, and adding or editing past the bound is refused with the reason, never cut quietly.
// The last few reasons given for rejecting a field's proposals (state.rejections, lib/proposals.mjs reject) are read back by reasonsFor for the
// extraction prompt; they are the person's words too, bounded, and never written by anything but a person's Reject.
import { store$get as get, store$update as update } from "../boot.mjs";
import { lib_context$notesOf as notesOf, lib_context$notesBrief as notesBrief, lib_context$ORIGINS as ORIGINS } from "../boot.mjs";   // the part every brief needs lives there (it is on the startup path); this module loads with the page
export { notesOf, notesBrief, ORIGINS };

export const NOTE_MAX = 240;
export const NOTES_TOTAL_MAX = 1500;
export const NOTES_COUNT_MAX = 20;
export const ORIGIN_NAME = Object.freeze({ typed: 'Typed', reply: 'From a reply', rejection: 'From a rejection' });
export const REASONS_PER_FIELD = 3;
export const REASON_MAX = 120;

const one = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const nid = () => `an${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const sizeOf = list => list.reduce((n, x) => n + x.text.length, 0);

export const notesSize = (s = get()) => sizeOf(notesOf(s));

/** The first sentence of a text, as a starting point for a note (at most NOTE_MAX characters). */
export function firstSentence(text, max = NOTE_MAX) {
  const x = one(String(text || '').replace(/[`*_#>|]/g, ''));
  const m = /^(.+?[.!?])(\s|$)/.exec(x), y = m && m[1].length <= max ? m[1] : x;
  return y.length > max ? `${y.slice(0, max - 1)}…` : y;
}

/** Why a text cannot be a note, or ''. `list` is the notes without the one being edited. */
export function noteProblem(text, list) {
  const t = one(text);
  if (!t) return 'A note needs some words.';
  if (t.length > NOTE_MAX) return `A note is at most ${NOTE_MAX} characters (this one has ${t.length}).`;
  if (list.some(n => one(n.text).toLowerCase() === t.toLowerCase())) return 'The assistant already has this note.';
  if (sizeOf(list) + t.length > NOTES_TOTAL_MAX) return `The notes are limited to ${NOTES_TOTAL_MAX} characters together; shorten or delete one first.`;
  return '';
}

/** State in, state out: the notes with one more. Throws the reason it is refused. `from` names where it came from (a chat, a paper and field). */
export function withNote(s, text, origin = 'typed', from = '', at = new Date().toISOString()) {
  if (!ORIGINS.includes(origin)) throw new Error('A note comes from the person: typed, a reply they chose, or a rejection reason.');
  const list = notesOf(s), why = noteProblem(text, list);
  if (why) throw new Error(why);
  if (list.length >= NOTES_COUNT_MAX) throw new Error(`The assistant keeps at most ${NOTES_COUNT_MAX} notes; delete one first.`);
  return { ...s, assistantNotes: [...list, { id: nid(), text: one(text), origin, ...(from ? { from: one(from).slice(0, 120) } : {}), at }] };
}
export function withEdit(s, id, text) {
  const list = notesOf(s), at = list.findIndex(n => n.id === id);
  if (at < 0) throw new Error('This note is no longer in the list.');
  const why = noteProblem(text, list.filter((_, i) => i !== at));
  if (why) throw new Error(why);
  return { ...s, assistantNotes: list.map((n, i) => i === at ? { ...n, text: one(text), edited: new Date().toISOString() } : n) };
}
export const withoutNote = (s, id) => ({ ...s, assistantNotes: notesOf(s).filter(n => n.id !== id) });

/** The writers a person's press reaches. Each returns the note's id (add) or nothing, and throws the refusal's reason. */
export function addNote(text, origin = 'typed', from = '') {
  let id = '';
  update(s => { const next = withNote(s, text, origin, from); id = next.assistantNotes.at(-1).id; s.assistantNotes = next.assistantNotes; return s; });
  return id;
}
/** "Remember this" on a reply: the person words the note in a one-line box that starts from the reply's first sentence; a refusal is the box's title and it asks again. True once kept. `askText` is dialog.mjs's ask. */
export async function rememberReply(replyText, askText) {
  const identity = get().project;
  let text = firstSentence(replyText), why = '';
  for (;;) {
    const t = await askText(why || 'Remember this', { value: text, placeholder: 'A short note for this project', confirm: 'Remember' });
    if (t == null || get().project !== identity) return false;
    try { addNote(t, 'reply'); return true; } catch (err) { text = t; why = err.message; }
  }
}
export function editNote(id, text) { update(s => { s.assistantNotes = withEdit(s, id, text).assistantNotes; return s; }); }
export function removeNote(id) { update(s => { s.assistantNotes = withoutNote(s, id).assistantNotes; return s; }); }

// ---- rejection reasons ---------------------------------------------------------------------------------------------------------------------

/** The reasons given when proposals for a field were rejected, newest last, at most `n`; the same words twice count once. */
export function reasonsFor(s, columnId, n = REASONS_PER_FIELD) {
  const out = [];
  for (const r of s.rejections || []) {
    const k = String(r?.key || ''), at = k.indexOf(':');
    if (at < 0 || k.slice(at + 1) !== columnId) continue;
    const text = one(r.reason).slice(0, REASON_MAX);
    if (!text) continue;
    const seen = out.findIndex(x => x.toLowerCase() === text.toLowerCase());
    if (seen >= 0) out.splice(seen, 1);
    out.push(text);
  }
  return out.slice(-n);
}
/** The reasons of several fields, as { columnId: [reason, ...] } for the fields that have any. */
export function reasonsByField(s, columnIds) {
  const out = {};
  for (const id of columnIds) { const r = reasonsFor(s, id); if (r.length) out[id] = r; }
  return out;
}
/** Rejection reasons the person may keep as notes: the latest ones with words, newest first, not already a note. */
export function keepableReasons(s = get(), limit = 8) {
  const have = new Set(notesOf(s).map(n => one(n.text).toLowerCase()));
  const out = [];
  for (const r of [...(s.rejections || [])].reverse()) {
    const text = one(r?.reason).slice(0, NOTE_MAX);
    if (!text || have.has(text.toLowerCase()) || out.some(x => x.text.toLowerCase() === text.toLowerCase())) continue;
    const k = String(r.key || ''), at = k.indexOf(':'), paperId = at < 0 ? '' : k.slice(0, at), columnId = at < 0 ? k : k.slice(at + 1);
    out.push({ text, at: r.at || '', paperId, columnId, from: `Rejected in ${columnId}` });
    if (out.length >= limit) break;
  }
  return out;
}
