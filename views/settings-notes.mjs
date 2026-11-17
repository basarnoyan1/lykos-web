// Settings > Assistant notes: the short notes the person keeps for the assistant (lib/assistant-notes.mjs, plan §6.0b). Each is typed here, kept from a
// reply ("Remember this" in the reply row) or kept from a rejection reason (the last reasons are listed under the notes, each with Keep as a note).
// Every note is editable and deletable and shows where it came from. Nothing is added without a press.
import { store$get as get } from "../boot.mjs";
import { lib_html$esc as esc, lib_html$emptyState as emptyState } from "../boot.mjs";
import { lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow, lib_ui_actions$uiRowEnd as uiRowEnd } from "../boot.mjs";
import { lib_dialog$ask as ask, lib_dialog$confirmAsk as confirmAsk } from "../boot.mjs";
import { lib_menu$showMenu as showMenu } from "../boot.mjs";
import { lib_dates$plural as plural, lib_dates$day as day } from "../boot.mjs";
import { notesOf, notesSize, addNote, editNote, removeNote, keepableReasons, NOTE_MAX, NOTES_TOTAL_MAX, NOTES_COUNT_MAX, ORIGIN_NAME } from '../lib/assistant-notes.mjs';

const noteRow = n => uiRow({ attrs: { 'data-note': n.id, 'data-find': `${n.text} ${ORIGIN_NAME[n.origin]} ${n.from || ''}`.toLowerCase() },
  main: { html: esc(n.text), wrap: true, detail: [esc(ORIGIN_NAME[n.origin]), n.from ? esc(n.from) : '', esc(day(n.edited || n.at))].filter(Boolean) },
  end: uiRowEnd({ more: { label: `More for the note “${n.text.slice(0, 40)}”`, attrs: { 'data-note-more': n.id } } }) });

const reasonRow = (r, i) => uiRow({ attrs: { 'data-find': `${r.text} ${r.columnId}`.toLowerCase() },
  main: { html: esc(r.text), wrap: true, detail: [esc(r.from), esc(day(r.at))].filter(Boolean) },
  end: uiRowEnd({ primary: { id: `an-keep-${i}`, label: 'Keep as a note', attrs: { 'data-keep-reason': i } }, more: { label: `More for the reason “${r.text.slice(0, 40)}”`, attrs: { 'data-keep-more': i } } }) });

/** The section's rows. `srow` is the page's row builder. */
export function assistantNotesBody(srow, state = get()) {
  const list = notesOf(state), reasons = keepableReasons(state, 6);
  return `${srow('Notes', { find: 'assistant notes remember instructions memory',
    desc: `${list.length ? `${plural(list.length, 'note')}, ${notesSize(state)} of ${NOTES_TOTAL_MAX} characters` : 'None yet'}. The assistant reads them with every chat and model action`,
    actions: [{ id: 'an-add', label: 'Add note', icon: 'plus', disabled: list.length >= NOTES_COUNT_MAX }] })}
    ${list.length ? uiList({ id: 'an-list', label: 'Assistant notes', rows: list.map(noteRow) }) : emptyState({ title: 'No assistant notes', size: 'inline' })}
    ${reasons.length ? `<h3 class="setl-subhead">Recent rejection reasons</h3>${uiList({ id: 'an-reasons', label: 'Recent rejection reasons', rows: reasons.map(reasonRow) })}` : ''}`;
}

/** Binds the section. `ctx.rerender` repaints Settings. */
export function wireAssistantNotes(el, ctx) {
  const identity = get().project;
  const say = msg => ctx.say?.(msg);
  const guarded = fn => async (...a) => { if (get().project !== identity) return; try { await fn(...a); ctx.rerender(); } catch (err) { say(String(err?.message || err)); } };
  const words = (title, value = '', confirm = 'Save') => ask(title, { value, placeholder: `Up to ${NOTE_MAX} characters`, confirm });
  el.querySelector('#an-add')?.addEventListener('click', guarded(async () => { const t = await words('New assistant note', '', 'Add'); if (t != null) addNote(t, 'typed'); }));
  el.querySelectorAll('[data-note-more]').forEach(b => b.onclick = () => {
    const id = b.dataset.noteMore, note = notesOf().find(n => n.id === id); if (!note) return;
    showMenu(b, [{ label: 'Edit', icon: 'rename', run: guarded(async () => { const t = await words('Edit assistant note', note.text); if (t != null) editNote(id, t); }) },
      '-', { label: 'Delete note', icon: 'trash', danger: true, run: guarded(async () => {
        if (await confirmAsk('Delete this note?', { detail: 'The assistant stops reading it. Past answers are not changed.', confirm: 'Delete', danger: true })) removeNote(id);
      }) }], { align: 'end' });
  });
  const reasons = keepableReasons(get(), 6);
  el.querySelectorAll('[data-keep-reason]').forEach(b => b.onclick = guarded(() => { const r = reasons[+b.dataset.keepReason]; if (r) addNote(r.text, 'rejection', r.from); }));
  el.querySelectorAll('[data-keep-more]').forEach(b => b.onclick = () => {
    const r = reasons[+b.dataset.keepMore]; if (!r) return;
    showMenu(b, [{ label: 'Edit, then keep', icon: 'rename', run: guarded(async () => { const t = await words('Keep as a note', r.text, 'Keep'); if (t != null) addNote(t, 'rejection', r.from); }) }], { align: 'end' });
  });
}
