// Note templates and the project's own notes (amendment "Workspace: backup,
// dashboard, tasks, timeline and translation").
//
// A template is Markdown with a small, closed set of variables. Nothing is
// executed: a variable this list does not know is left in the text as it was
// written and reported, so a typo is visible rather than silently empty.
//
//   {{date}} {{time}} {{week}}   today, now, the ISO week (2026-W40)
//   {{project}}                  the project's name
//   {{author}}                   you: the name in Settings (not a paper's author)
//   {{paper}}                    the chosen paper as "Label · Title"
//   {{paper.title}} {{paper.authors}} {{paper.year}} {{paper.doi}}
//   {{deadlines}}                open tasks due in the next 14 days, one per line
//
//   state.projectNotes   [{ id, title, text, template, paperId?, at, updated }]
//   state.noteTemplates  [{ id, name, body }]   the researcher's own templates
//
// Pure.
import { isoWeek } from './journal.mjs';
import { dueTasks } from './tasks.mjs';

export const BUILT_IN_TEMPLATES = [
  { id: 'meeting', name: 'Meeting minutes', body: '# Meeting minutes · {{date}}\n\nProject: {{project}}\nRecorded by: {{author}}\n\n## Attendees\n- \n\n## Agenda\n1. \n\n## Discussion\n\n## Decisions\n- \n\n## Actions\n- [ ] Who, what, by when\n' },
  { id: 'journal-club', name: 'Journal club brief', body: '# Journal club · {{paper}}\n\nDate: {{date}}\nPresenter: {{author}}\n\n## Citation\n{{paper.authors}} ({{paper.year}}). {{paper.title}}. {{paper.doi}}\n\n## Question\n- Population:\n- Intervention or exposure:\n- Comparison:\n- Outcome:\n\n## Design and methods\n\n## Key results\n\n## Appraisal\n- Risk of bias:\n- Applicability:\n\n## Take-home message\n' },
  { id: 'literature', name: 'Literature note', body: '# {{paper.title}}\n\n{{paper.authors}} ({{paper.year}}) {{paper.doi}}\nNote by {{author}}, {{date}}\n\n## Question\n\n## Methods\n\n## Key numbers, with page\n- \n\n## Limitations\n\n## Relevance to {{project}}\n' },
  { id: 'deviation', name: 'Protocol deviation', body: '# Protocol deviation · {{date}}\n\nProject: {{project}}\nReported by: {{author}}\n\n## What happened\n\n## Participant or record affected\n\n## Protocol section\n\n## Why\n\n## Effect on data or safety\n\n## Action taken\n\n## Reported to\n- [ ] Principal investigator\n- [ ] Ethics committee, if its rules require it\n' },
  { id: 'decision', name: 'Decision record', body: '# Decision · {{date}}\n\nProject: {{project}}\nDecided by: {{author}}\n\n## Decision\n\n## Context\n\n## Options considered\n1. \n\n## Reasons\n\n## Consequences and follow-up\n- [ ] \n' },
  { id: 'weekly', name: 'Weekly progress for a supervisor', body: '# Weekly progress · {{week}}\n\nProject: {{project}}\nFrom: {{author}}\nDate: {{date}}\n\n## Done this week\n- \n\n## Planned for next week\n- \n\n## Questions for my supervisor\n- \n\n## Deadlines in the next two weeks\n{{deadlines}}\n' },
];

export const VARIABLES = ['date', 'time', 'week', 'project', 'author', 'paper', 'paper.title', 'paper.authors', 'paper.year', 'paper.doi', 'deadlines'];
const KNOWN = new Set(VARIABLES);
const VAR = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g;

/** The variables a template uses, in order of first use. */
export const variablesIn = body => [...new Set([...String(body || '').matchAll(VAR)].map(m => m[1]))];
/** Whether filling the template needs a paper chosen. */
export const needsPaper = body => variablesIn(body).some(v => v === 'paper' || v.startsWith('paper.'));

const pad = n => String(n).padStart(2, '0');
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const authorText = a => (typeof a === 'string' ? a : a?.name || [a?.given, a?.family].filter(Boolean).join(' ')).trim();
const authorsOf = p => {
  const names = (p?.authors || []).map(authorText).filter(Boolean);
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} et al.` : names.join(', ');
};
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * The values for a template: `{ state, paper, author, now }`. A value that is
 * not available (no paper chosen) is absent, so its variable stays visible.
 */
export function templateValues({ state = {}, paper = null, author = '', now = new Date() } = {}) {
  const date = localDay(now);
  const v = {
    date, time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, week: isoWeek(date).key,
    project: String(state.project?.name || state.paper?.title || 'Untitled project'),
    author: String(author || '').trim() || 'Me',
    deadlines: (() => {
      const soon = dueTasks(state.todos).filter(t => t.due <= addDays(date, 14));
      return soon.length ? soon.map(t => `- ${t.due} ${t.text}`).join('\n') : '- None recorded';
    })(),
  };
  if (paper) Object.assign(v, {
    paper: [paper.label, paper.title].filter(Boolean).join(' · ') || paper.id,
    'paper.title': String(paper.title || paper.label || ''),
    'paper.authors': authorsOf(paper),
    'paper.year': String(paper.year || ''),
    'paper.doi': paper.doi ? `https://doi.org/${paper.doi}` : '',
  });
  return v;
}

/**
 * Fills a template. `{ text, unknown, missing }`: unknown lists variables this
 * set does not have, missing those it has but could not fill (no paper
 * chosen); both are left in the text as written.
 */
export function fillTemplate(body, values) {
  const unknown = new Set(), missing = new Set();
  const text = String(body || '').replace(VAR, (whole, name) => {
    if (!KNOWN.has(name)) { unknown.add(name); return whole; }
    if (values[name] == null) { missing.add(name); return whole; }
    return String(values[name]);
  });
  return { text, unknown: [...unknown], missing: [...missing] };
}

/** A note's title: its first heading, else its first line, else the fallback. */
export function titleOf(text, fallback = 'Untitled note') {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const h = lines.find(l => /^#{1,6}\s/.test(l));
  return (h ? h.replace(/^#{1,6}\s+/, '') : lines[0] || fallback).slice(0, 120);
}

/** Every template the project offers: built-ins, then the researcher's own. */
export function allTemplates(state) {
  return [...BUILT_IN_TEMPLATES.map(t => ({ ...t, builtIn: true })), ...normaliseTemplates(state?.noteTemplates)];
}
export function normaliseTemplates(list) {
  return (Array.isArray(list) ? list : []).filter(t => t && typeof t === 'object' && String(t.name || '').trim() && typeof t.body === 'string')
    .map(t => ({ id: String(t.id || `tpl${Math.random().toString(36).slice(2, 8)}`), name: String(t.name).trim().slice(0, 80), body: t.body.slice(0, 20000) }));
}
export function normaliseNotes(list) {
  return (Array.isArray(list) ? list : []).filter(n => n && typeof n === 'object' && n.id && typeof n.text === 'string')
    .map(n => ({ ...n, id: String(n.id), title: String(n.title || titleOf(n.text)), at: String(n.at || ''), updated: String(n.updated || n.at || '') }));
}

const newId = p => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** A new project note from a template; answers the note and what could not be filled. */
export function noteFromTemplate(template, ctx) {
  const { text, unknown, missing } = fillTemplate(template.body, templateValues(ctx));
  const at = (ctx.now || new Date()).toISOString();
  return { note: { id: newId('n'), title: titleOf(text, template.name), text, template: template.id, ...(ctx.paper ? { paperId: ctx.paper.id } : {}), at, updated: at }, unknown, missing };
}
