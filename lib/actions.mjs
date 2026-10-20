// A to-do added by hand from elsewhere in the app (a reply's "To do", the protocol's deadlines): a line in the task list.
// Suggested tasks (a model's or the rule parser's) go through lib/task-suggest.mjs instead: the add_task op, its checks and its notes.
import { update } from '../store.mjs';
import { day } from './dates.mjs';

export const addTodo = (text, due = '') => update(x => {
  if ((x.todos || []).some(t => t.text === text && !t.done)) return x;
  x.todos = [...(x.todos || []), { id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text, due: due || '', done: false, at: new Date().toISOString() }];
  return x;
});

/** "tomorrow", "25 Sep" for a due date. */
export const dueLabel = iso => {
  const d = new Date(`${iso}T12:00:00`); if (Number.isNaN(d)) return iso;
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const days = Math.round((d - today) / 864e5);
  if (days === 0) return 'today'; if (days === 1) return 'tomorrow'; if (days === -1) return 'yesterday';
  return day(iso);
};
