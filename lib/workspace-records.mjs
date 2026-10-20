// The project's own planning records, brought into shape on load (store.mjs
// normalizeProject): the reading list, the journal, notes and note templates,
// and milestones. Each is absent until first used and is only cleaned when
// present, so a project that never used one is saved as it was. Tasks are
// read through lib/tasks.mjs normaliseTask instead, leaving the to-do list
// exactly as older builds wrote it. Pure.
import { normaliseReading } from './reading.mjs';
import { normaliseJournal } from './journal.mjs';
import { normaliseNotes, normaliseTemplates } from './note-templates.mjs';
import { normaliseMilestones } from './timeline.mjs';

export function normalizeWorkspace(next) {
  if (next.reading != null) next.reading = normaliseReading(next.reading);
  if (next.journal != null) next.journal = normaliseJournal(next.journal);
  if (next.journalMany != null) next.journalMany = next.journalMany === true;
  if (next.projectNotes != null) next.projectNotes = normaliseNotes(next.projectNotes);
  if (next.noteTemplates != null) next.noteTemplates = normaliseTemplates(next.noteTemplates);
  if (next.milestones != null) next.milestones = normaliseMilestones(next.milestones);
  return next;
}
