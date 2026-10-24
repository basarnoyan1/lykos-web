// Two cells of a task row, read by the Overview's task block (views/overview.mjs) and by the task lists (lib/hub-tasks.mjs, which re-exports them):
// kept apart so that the Overview need not load the whole list model.
import { dueBucket, dueText, titleParts } from './tasks.mjs';
import { esc } from './html.mjs';

/** A title with a short lead ("Confirm with a colleague: The four-table split") sets the lead a little heavier; the stored text is never changed. */
export function titleHtml(text) {
  const p = titleParts(text);
  return p ? `<span class="tk-lead">${esc(p.lead)}</span>${esc(p.rest)}` : esc(text || 'Untitled task');
}

/** A due date as a cell value: heavier when overdue, set in the ink when today; a done task's date is quiet. */
export function dueHtml(t, today, locale) {
  if (!t.due) return '';
  const b = t.done ? '' : dueBucket(t, today);
  return `<span class="tk-due${b === 'overdue' ? ' overdue' : b === 'today' ? ' today' : ''}" title="${esc(t.due)}">${esc(dueText(t.due, today, locale))}</span>`;
}
