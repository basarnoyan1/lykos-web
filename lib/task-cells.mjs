// Two cells of a task row, read by the Overview's task block (views/overview.mjs) and by the task lists (lib/hub-tasks.mjs, which re-exports them):
// kept apart so that the Overview need not load the whole list model.
import { lib_tasks$dueBucket as dueBucket, lib_tasks$dueText as dueText } from "../boot.mjs";
import { lib_html$esc as esc } from "../boot.mjs";

/** A task's text as written, in the row's one title weight; the stored text is never changed. */
export function titleHtml(text) {
  return esc(text || 'Untitled task');
}

/** A due date as a cell value: heavier when overdue, set in the ink when today; a done task's date is quiet. */
export function dueHtml(t, today, locale) {
  if (!t.due) return '';
  const b = t.done ? '' : dueBucket(t, today);
  return `<span class="tk-due${b === 'overdue' ? ' overdue' : b === 'today' ? ' today' : ''}" title="${esc(t.due)}">${esc(dueText(t.due, today, locale))}</span>`;
}
