// Pure note organisation and selection edits, shared by the workspace and tests.
export const noteTags = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(x => String(x).trim().replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 20);
export function selectNotes(notes, { query = '', filter = 'active', sort = 'updated' } = {}) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return notes.filter(n => (filter === 'trash' ? !!n.deletedAt : !n.deletedAt && (filter === 'archive' ? n.archived : !n.archived)) && (filter !== 'pinned' || n.pinned) && words.every(w => `${n.title} ${n.text} ${noteTags(n.tags).join(' ')}`.toLowerCase().includes(w)))
    .sort((a,b) => Number(!!b.pinned) - Number(!!a.pinned) || (sort === 'title' ? a.title.localeCompare(b.title) : String(b.updated || b.at).localeCompare(String(a.updated || a.at))));
}
export function formatNote(text, start, end, command) {
  const selected = text.slice(start, end);
  const wrappers = { bold: ['**', '**', 'bold text'], italic: ['*', '*', 'italic text'], link: ['[', '](https://)', 'link text'] };
  let replacement, from = start, to = end, selectionStart, selectionEnd;
  if (wrappers[command]) {
    const [before, after, fallback] = wrappers[command];
    const body = selected || fallback; replacement = before + body + after;
    selectionStart = start + before.length; selectionEnd = selectionStart + body.length;
  } else if (command === 'table') {
    replacement = '\n\n| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |\n';
  } else {
    const prefix = { heading: '## ', bullet: '- ', task: '- [ ] ', quote: '> ' }[command];
    if (!prefix) return {text,start,end};
    from = start > 0 ? text.lastIndexOf('\n', start - 1) + 1 : 0;
    to = text.indexOf('\n', end); if (to < 0) to = text.length;
    replacement = text.slice(from,to).split('\n').map(line => prefix + line).join('\n');
  }
  return {text:text.slice(0,from)+replacement+text.slice(to),start:selectionStart ?? from+replacement.length,end:selectionEnd ?? from+replacement.length};
}

/** Bounded local recovery snapshots; never silently discard the current version on restore. */
export function checkpointNote(note, at = new Date().toISOString()) {
  const version = { title:note.title, text:note.text, tags:noteTags(note.tags), at };
  const versions = Array.isArray(note.versions) ? note.versions : [];
  if (versions[0]?.text === version.text && versions[0]?.title === version.title) return;
  note.versions = [version, ...versions].slice(0, 30);
}
export function restoreNoteVersion(note, index) {
  const version = note.versions?.[index]; if (!version) return false;
  checkpointNote(note);
  Object.assign(note,{text:version.text,title:version.title,tags:noteTags(version.tags),customTitle:true,updated:new Date().toISOString()});
  return true;
}
