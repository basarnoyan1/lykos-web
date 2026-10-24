// What the shell needs to know about a page before it is loaded: its name and icon for the sidebar and the palette, and the number beside
// its row. Views load on first use (app.mjs `viewOf`), so these are drawn from here and never by importing the view. A view re-exports its
// own `count` from this file; its `meta` stays a literal in the view (lint-icons and the review matrix read it from the source) and
// `app/test/view-registry.test.mjs` holds the two equal. Everything here reads `lib/` and the store only: a count that needed a view's own state
// would defeat the lazy load.
import { get } from '../store.mjs';
import { settings } from '../lib/model-settings.mjs';
import { studies, queue, isDual, conflicts } from '../lib/screen.mjs';
import { researchType } from '../lib/workflow.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { ensureWatch, stopWatch } from '../lib/import-watch.mjs';
import { normaliseTasks } from '../lib/tasks.mjs';
import { dateValue } from '../lib/date-picker.mjs';
import { visibleNotifications, groupRepeats } from '../lib/notifications.mjs';
import * as ipd from '../lib/ipd.mjs';
import { datasets } from '../lib/datasets.mjs';
import { readQual } from '../lib/qual.mjs';
import { readQes } from '../lib/qes.mjs';
import { assessmentOf } from '../lib/cerqual.mjs';
import { outcomes, analysisOf } from '../lib/outcomes.mjs';
import { PRISMA_FIELDS } from '../schema.mjs';
import { isPrimaryType } from '../lib/research-types.mjs';
// lazy: outside the start-up graph
let guideMod = null;
import('../lib/guide-steps.mjs').then(m => { guideMod = m; }, () => {});

/** A note's done state follows its task when it has one (lib/tasks.mjs). */
export const noteDone = (s, n) => n.todoId ? s.todos?.find(t => t.id === n.todoId)?.done ?? n.done : n.done;

// The watched import folder (lib/import-watch.mjs) runs while a folder project is open. The shell asks every view for its count at start and
// after each change, which is where the Library makes sure the poll is running.
let watchFor = null;
function keepWatching() {
  const folder = activeFolder();
  if (folder === watchFor) return;
  watchFor = folder;
  if (!folder) { stopWatch(); return; }
  import('../lib/project-folder.mjs').then(m => m.projectLayout(folder, researchType(get()).id)).then(l => { if (activeFolder() === folder) ensureWatch(folder, l.dirFor('search')); }).catch(err => console.warn('[import-watch]', err.message));
}

// A study counts as appraised once its study-level answers hold one, under its instrument (lib/study-instrument.mjs) or in the first RoB 2 shape.
const appraised = (s, paperId) => Object.values(s.assessments?.[paperId] || {}).some(v => (v && typeof v === 'object' ? Object.values(v).some(Boolean) : Boolean(v)));

/** Open tasks due within a week, overdue included: what needs doing soon. */
function tasksDueSoon() {
  const week = new Date(); week.setDate(week.getDate() + 7);
  return normaliseTasks(get().todos).filter(t => !t.done && t.due && t.due <= dateValue(week)).length || '';
}

function screeningOpen() {
  const s = get(); const by = settings().reviewerInitials || settings().reviewerName || '';
  return queue(s, 'ta', by).open.length + queue(s, 'ft', by).open.length + (isDual(s) ? conflicts(s, 'ta').length + conflicts(s, 'ft').length : 0);
}

// counts the rail shows: what waits on a person
export const RAIL_COUNTS = new Set(['screening', 'tasks', 'notes', 'notifications', 'reporting', 'guide']);

const prismaBlank = (s = get()) => (s.papers || []).length && !isPrimaryType(researchType(s).id) ? PRISMA_FIELDS.filter(f => (s.prisma?.[f.id] ?? '') === '').length : 0;

export const REGISTRY = {
  advancedAnalysis: { meta: { title: 'Advanced analysis', icon: 'advanced' }, count: (s = get()) => (s.advancedAnalyses || []).length },
  trialOperations: { meta: { title: 'Trial operations', icon: 'trial-operations' } },
  imaging: { meta: { title: 'DICOM images', icon: 'imaging' } },
  workflows: { meta: { title: 'Workflows', icon: 'workflow' }, count: () => get().workflows?.length || 0 },
  tasks: { meta: { title: 'Tasks', icon: 'tasks' }, count: tasksDueSoon },
  dashboard: { meta: { title: 'All projects', icon: 'projects' }, count: () => 0 },
  guide: { meta: { title: 'Getting started', icon: 'flag' }, count: (s = get()) => { try { if (globalThis.localStorage?.getItem('lykos.guide.hidden') === '1') return ''; } catch { /* no storage */ } return guideMod ? guideMod.guideCount(s) : ''; } },
  notes: { meta: { title: 'Notes', icon: 'note', layout: 'flush' }, count: (s = get()) => (s.fileNotes || []).filter(n => !n.archived && !noteDone(s, n)).length },
  changes: { meta: { title: 'Changes', icon: 'changes', layout: 'flush' } },
  notifications: { meta: { title: 'Notifications', icon: 'bell' }, count: () => groupRepeats(visibleNotifications(get()).filter(n => !n.read)).length },
  overview: { meta: { title: 'Overview', icon: 'home' }, count: () => 0 },
  case: { meta: { layout: 'sheet', title: 'Case', icon: 'case-record' }, count: () => { const t = get().caseReport?.timeline; return Array.isArray(t) ? t.length : 0; } },   // as lib/case-report.mjs caseOf, which the page loads
  syntheses: { meta: { title: 'Syntheses', icon: 'matrix' } },
  protocol: { meta: { layout: 'flush', title: 'Protocol', icon: 'protocol' }, count: () => (get().protocol?.criteria || []).length },
  search: { meta: { title: 'Literature', icon: 'literature' }, count: () => (get().searches || []).length },
  library: { meta: { title: 'Library', icon: 'library' }, count: () => { keepWatching(); return get().papers.length; } },
  screening: { meta: { title: 'Screening', icon: 'screening' }, count: screeningOpen },
  extraction: { meta: { title: 'Extraction', icon: 'extraction' }, count: () => Object.keys(get().values).length + Object.keys(get().proposals || {}).filter(k => k.includes(':')).length },
  patients: { meta: { title: 'Patient data', icon: 'patients' }, count: () => ipd.participants().length },
  datasets: { meta: { title: 'Datasets', icon: 'dataset' }, count: () => datasets(get()).length },
  coding: { meta: { title: 'Coding', icon: 'coding' }, count: () => readQual(get()).documents.length },
  appraisal: { meta: { title: 'Appraisal', icon: 'appraisal' }, count: () => {
    const s = get();
    return studies(s).filter(p => appraised(s, p.id)).length;
  } },
  analysis: { meta: { title: 'Analysis', icon: 'analysis' }, count: () => { const s = get(); return outcomes(s).filter(o => analysisOf(s, o.id)).length + (s.propensityAnalyses || []).length; } },
  dta: { meta: { title: 'Analysis', icon: 'analysis' }, count: () => get().dta ? 1 : 0 },
  umbrella: { meta: { title: 'Analysis', icon: 'analysis' }, count: () => (get().umbrella?.results || []).length },
  synthesis: { meta: { title: 'Synthesis', icon: 'layers' }, count: () => readQes(get()).codes.length },
  nma: { meta: { title: 'Analysis', icon: 'analysis' }, count: () => get().nma?.result ? 1 : 0 },
  certainty: { meta: { title: 'Certainty', icon: 'certainty' }, count: () => (get().grade || []).length },
  confidence: { meta: { title: 'Confidence', icon: 'confidence' }, count: () => readQes(get()).analytical.filter(t => assessmentOf(t).assessed).length },
  manuscript: { meta: { title: 'Manuscript', icon: 'manuscript' }, count: () => (get().manuscript?.blocks || []).length ? 1 : 0 },
  outputs: { meta: { title: 'Tables and figures', icon: 'outputs' }, count: () => (get().outputs || []).length },
  reporting: { meta: { title: 'Reporting', icon: 'flow' }, count: s => prismaBlank(s) },
  submissions: { meta: { title: 'Submission', icon: 'send' }, count: () => 0 },
  settings: { meta: { title: 'Settings', icon: 'settings' }, count: () => 0 },
  files: { meta: { title: 'Files', icon: 'file', layout: 'flush' } },
  folder: { meta: { title: 'Project folder', icon: 'folder' }, count: () => 0 },
};
