// Durable selection anchors: offsets are a hint; quote/context must still match.
export function textAnchor(text, start, end, extra = {}) {
  return { kind: 'text', start, end, quote: text.slice(start, end), prefix: text.slice(Math.max(0, start - 40), start), suffix: text.slice(end, end + 40), ...extra };
}
export function locateAnchor(text, a) {
  if (!a?.quote) return null;
  a = { prefix: '', suffix: '', ...a };
  if (text.slice(a.start, a.end) === a.quote && text.slice(Math.max(0, a.start - a.prefix.length), a.start) === a.prefix && text.slice(a.end, a.end + a.suffix.length) === a.suffix) return { start: a.start, end: a.end };
  const hits = []; let from = 0;
  while (from <= text.length) { const at = text.indexOf(a.quote, from); if (at < 0) break; hits.push(at); from = at + 1; }
  const matches = hits.filter(at => (!a.prefix || text.slice(Math.max(0, at - a.prefix.length), at) === a.prefix) && (!a.suffix || text.slice(at + a.quote.length, at + a.quote.length + a.suffix.length) === a.suffix));
  const at = matches.length === 1 ? matches[0] : hits.length === 1 ? hits[0] : null;
  return at === null ? null : { start: at, end: at + a.quote.length };
}
export function addFileNote(s, { text, source, anchor, todo = false }) {
  if (!text.trim()) throw new Error('Write a note first.');
  const id = crypto.randomUUID(), at = new Date().toISOString();
  const note = { id, text: text.trim(), source, anchor, at, done: false, todoId: todo ? `note-${id}` : null };
  s.fileNotes = [note, ...(s.fileNotes || [])];
  if (todo) s.todos = [...(s.todos || []), { id: note.todoId, text: note.text, done: false, at, noteId: id }];
  return note;
}
export function completeFileNote(s, id, done) {
  const note = s.fileNotes?.find(n => n.id === id); if (!note) return;
  note.done = done; const task = s.todos?.find(t => t.id === note.todoId); if (task) task.done = done;
}
