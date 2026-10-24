// The changes the assistant can propose, one entry per op (plan §6, G4).
//
// An op takes the model's arguments and returns either { error } (nothing is
// proposed; the model is told why) or { it, skipped? }: an item a person sees
// and accepts. `it.accept()` is the only code that writes. Every op checks
// what it names (the record, collection, criterion, block or outcome exists),
// checks any quote against its source, and records what it saw when it was
// proposed so that accept() refuses, saying why, when the project has changed
// underneath it (plan 6.0a). lib/changes.mjs files the items as one proposal
// and logs each accepted change with the model and the prompt version.
//
// The op names and fields are the same for the in-app assistant and the MCP
// server's app tools (propose_changes), which read this table.
import { trackedRewrite, trackedInsert, assistantChange } from './tracked-edit.mjs';
import { get, update } from '../store.mjs';
import * as coll from './collections.mjs';
import { addLabel, setLabel, labelList } from './screen-labels.mjs';
import { addBatches } from './screen-assign.mjs';
import { addField, fields as fieldList } from './fields.mjs';
import { setArms } from './multi-arm.mjs';
import { setAnswer, answersBy, secondOn, STUDY } from './rob-review.mjs';
import { allTools, appraisalTool } from '../schema.mjs';
import { addOutcome, setOutcomeMeasure, outcomes as outcomeList } from './outcomes.mjs';
import { setUpOutcome, renameEverywhere } from './outcome-links.mjs';
import { MEASURES } from './effect-measures.mjs';
import { hashText, blankBlock, citations, resultTokens } from './manuscript.mjs';
import { manuscriptOutputProposal, blockLocation } from './manuscript-suggestions.mjs';
import { numbersChanged } from './numbers.mjs';
import { checklistOf, checklistStates } from './checklist.mjs';
import { addFileNote } from './file-notes.mjs';
import { SOURCES } from './sources.mjs';
const RUN_SEARCH_MAX = 2000;
import { settingsOf } from './app-settings.mjs';
import { patchTask, normaliseTask, normaliseTasks, removeTasks, removalEffects, noteRemoval, tasksSignature, STATUSES, PRIORITIES } from './tasks.mjs';
import { cleanSuggestion, suggestionState, suggestionDetail, addSuggested } from './task-suggest.mjs';
import { day as dateDay } from './dates.mjs';
import { titleOf } from './note-templates.mjs';
import { quoteFound } from './quotes.mjs';
import { index as docIndex, locateIn } from './doctext.mjs';

const clip = (s, n) => { s = String(s ?? '').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };
const oneOf = (v, list) => list.includes(v);
const low = s => String(s ?? '').trim().toLowerCase();

/** A record by id, label or DOI. */
export function paperOf(ref, s = get()) {
  const r = low(ref); if (!r) return null;
  const ps = s.papers || [];
  return ps.find(p => p.id === ref) || ps.find(p => low(p.label) === r) || ps.find(p => low(p.doi) === r) || null;
}
/** Records for a list of references: the ones found, and the references that were not. */
function papersOf(refs, { max = 500 } = {}) {
  const list = Array.isArray(refs) ? refs.slice(0, max) : [];
  const found = [], missing = [];
  for (const r of list) { const p = paperOf(r); if (p && !found.some(x => x.id === p.id)) found.push(p); else if (!p) missing.push(String(r)); }
  return { found, missing };
}
const who = () => settingsOf(get()).reviewerInitials || '';
const names = (ps, n = 4) => ps.slice(0, n).map(p => p.label || p.id).join(', ') + (ps.length > n ? ` and ${ps.length - n} more` : '');

/**
 * Whether a quote is in a record: on the page it names (or anywhere in the
 * PDF) when there is a document, else in the title and abstract. Returns the
 * page and rectangles when the PDF locates it.
 */
export async function verifyQuote(paper, quote, page = null) {
  const q = String(quote || '').trim();
  if (q.length < 8) return null;
  if (paper.pdf) {
    try {
      const idx = await docIndex(paper.id);
      const pages = Number.isInteger(page) && page >= 1 && page <= idx.pages.length ? [idx.pages[page - 1]] : idx.pages;
      const hit = locateIn(pages, q);
      if (hit) return { page: Number.isInteger(page) && page >= 1 ? page : hit.page, rects: hit.rects, source: 'pdf' };
    } catch { /* fall back to the abstract */ }
  }
  return quoteFound(q, `${paper.title || ''}\n${paper.abstract || ''}`) ? { page: null, rects: null, source: 'abstract' } : null;
}

const collectionOf = ref => { const r = low(ref); return coll.collections().find(c => c.id === ref) || coll.collections().find(c => low(c.name) === r) || null; };

function addNoteTo(st, { paper, kind, text, page = '', rects = null, model = '' }) {
  if ((st.notes || []).some(n => n.paper === paper && n.text === text)) return false;
  st.notes = [...(st.notes || []), { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, paper, kind, text, page: page ?? '', rects,
    extractor: `model:${model || 'unknown'}`, verification: 'unverified', at: new Date().toISOString() }];
  return true;
}

/** The exact substring replaced inside a paragraph's runs, so formatting outside it survives; null unless it occurs once. */
function replaceIn(b, from, to) {
  const at = b.text.indexOf(from);
  if (at < 0 || b.text.indexOf(from, at + 1) >= 0) return null;
  const text = b.text.slice(0, at) + to + b.text.slice(at + from.length);
  const rs = b.runs?.length ? b.runs : null;
  const hit = rs ? rs.filter(r => !r.cite && String(r.t || '').includes(from)) : [];
  const runs = hit.length === 1 ? rs.map(r => (r === hit[0] ? { ...r, t: r.t.replace(from, () => to) } : r)) : [{ t: text }];
  return { text, runs };
}
const blockOf = (s, id) => (s.manuscript?.blocks || []).find(b => b.id === id) || null;
const marks = t => JSON.stringify([citations(t).map(c => `${c.key} ${c.locator}`), resultTokens(t).map(r => r.key)]);
const sameTokens = (a, b) => marks(a) === marks(b);

// ---- settings a person may hand to the assistant ----------------------------------------------------
export const SETTING_KEYS = {
  aiDetail: { doc: 'brief | standard | full: how long a model\'s notes and rationales may be', check: v => oneOf(v, ['brief', 'standard', 'full']) },
  aiLocalOnly: { doc: 'true | false: refuse any model connection that is not on this machine', check: v => typeof v === 'boolean' },
  'task:<task>': { doc: 'the id of an existing model profile that runs the task (chat, fill, screen, extract, appraise, write, query, compact, tasks, decide)', check: () => true },
};

const TASK_IDS = ['chat', 'fill', 'tasks', 'screen', 'decide', 'extract', 'appraise', 'write', 'query', 'compact'];

// ---- a task change in words (update_task): run and describe say the same, so a stored proposal reads as a fresh one --------------
/** The fields update_task would write, checked: a patch, or { error }. */
function taskPatch(c) {
  const patch = {};
  if (c.text != null) { if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 2000) return { error: 'Task text must contain 1–2000 characters.' }; patch.text = c.text.trim(); }
  if (c.status != null) { if (!oneOf(c.status, ['todo', 'doing', 'waiting', 'done'])) return { error: 'Invalid task status.' }; patch.status = c.status; }
  if (c.priority != null) { if (!oneOf(c.priority, ['none', 'low', 'high'])) return { error: 'Invalid task priority.' }; patch.priority = c.priority; }
  if (c.due != null) { if (typeof c.due !== 'string' || (c.due && !/^\d{4}-\d{2}-\d{2}$/.test(c.due))) return { error: 'Use a YYYY-MM-DD due date or empty text.' }; patch.due = c.due; }
  return patch;
}
/** What will change, in words: never the raw patch ({"status":"done"} on a row said nothing a person could act on). */
function taskWords(patch) {
  const words = [];
  if (patch.status != null) words.push(patch.status === 'done' ? 'Mark as done' : `Set status to ${(STATUSES.find(([k]) => k === patch.status) || [0, patch.status])[1].toLowerCase()}`);
  if (patch.priority != null) words.push(`Priority: ${(PRIORITIES.find(([k]) => k === patch.priority) || [0, patch.priority])[1].toLowerCase()}`);
  if (patch.due != null) words.push(patch.due ? `Due ${dateDay(patch.due)}` : 'Clear the due date');
  if (patch.text != null) words.push(`Rename to “${patch.text.length > 80 ? `${patch.text.slice(0, 79)}…` : patch.text}”`);
  return words;
}
/** The accept verb: a status change names the status, anything else is an update. */
function taskVerb(patch) {
  if (Object.keys(patch).length !== 1 || patch.status == null) return 'Update';
  return patch.status === 'done' ? 'Mark done' : patch.status === 'todo' ? 'Mark to do' : `Mark ${patch.status}`;
}

// ---- the ops -----------------------------------------------------------------------------------------
// doc: the fields, in the words a model needs. views: where the reviewer would do it themselves. live: accept() checks the live state
// itself (the task as it is now), so an older proposal is not refused because something else in the project changed since.
export const CHANGE_OPS = {
  update_task: {group:'changes',live:true,views:['tasks','overview'],doc:'{id: task id, text?, status: todo|doing|waiting|done, priority: none|low|high, due?: YYYY-MM-DD or empty}',
    async run(c) {
      const task=(get().todos||[]).find(t=>t.id===c.id);if(!task)return {error:'Task not found; read_project tasks first.'};
      const patch=taskPatch(c);if(patch.error)return patch;
      if(!Object.keys(patch).length)return {error:'Choose task fields to change.'};
      const was=JSON.stringify(normaliseTask(task));
      return {it:{label:task.text,detail:taskWords(patch).join('; '),acceptLabel:taskVerb(patch),accept:()=>{
        const live=(get().todos||[]).find(t=>t.id===c.id);if(!live||JSON.stringify(normaliseTask(live))!==was)return {refused:'Task changed; propose again.'};
        const before=structuredClone(live);
        update(st=>{patchTask(st.todos,c.id,patch);return st;});
        // Undo puts the task back exactly as it was, while the tasks stay as this acceptance (and the others with it) left them.
        return {done:'Updated',key:()=>tasksSignature(get().todos),undo:()=>update(st=>{const i=(st.todos||[]).findIndex(t=>t.id===c.id);if(i>=0)st.todos[i]=structuredClone(before);return st;})};
      }}};
    },
    // The row reads the task as it is now: its own words, what will change, or why there is nothing left to do.
    describe(c,s) {
      const patch=taskPatch(c);if(patch.error||!Object.keys(patch).length)return null;
      const detail=taskWords(patch).join('; '),acceptLabel=taskVerb(patch);
      const task=normaliseTasks(s?.todos).find(t=>t.id===c.id);
      if(!task)return {detail,acceptLabel,stale:'Task removed'};
      if(Object.entries(patch).every(([k,v])=>task[k]===v)){
        const only=Object.keys(patch).length===1&&patch.status;
        return {label:task.text,detail,acceptLabel,stale:only==='done'?'Already done':only==='todo'?'Already to do':'Already set'};
      }
      return {label:task.text,detail,acceptLabel};
    }},
  add_task: {group:'changes',live:true,views:['tasks','overview'],doc:'{text, due?: YYYY-MM-DD, priority?: none|low|high, link?: {view, paperId?}, why?: one sentence}. Suggests a task; it is added only when a person accepts, with a note saying who suggested it. Not proposed when an open task says the same.',
    async run(c,ctx={}) {
      const x=cleanSuggestion(c);if(x.error)return x;
      const stale=suggestionState(x.text,get());if(stale)return {error:stale==='Dismissed'?'This task was dismissed before; do not suggest it again.':'An open task already says this.'};
      return {it:{label:x.text,detail:suggestionDetail(x),acceptLabel:'Add',accept:()=>addSuggested(x,{model:ctx.model,source:ctx.source})}};
    },
    describe(c,s) {
      const x=cleanSuggestion(c);if(x.error)return null;
      const stale=suggestionState(x.text,s);
      return {label:x.text,detail:suggestionDetail(x),acceptLabel:'Add',...(stale?{stale}:{})};
    }},
  remove_tasks: {group:'changes',live:true,views:['tasks','overview'],doc:'{ids: [task ids, at most 50]}. Proposes removing tasks; nothing is removed until a person accepts. Subtasks of a removed task move up a level and tasks that waited for it stop waiting. Undo is offered on the Tasks page while the tasks stay unchanged.',
    async run(c) {
      const ids=[...new Set((Array.isArray(c.ids)?c.ids:[]).filter(x=>typeof x==='string'&&x))];
      if(!ids.length)return {error:'Name the task ids to remove (read_project tasks first).'};
      if(ids.length>50)return {error:'Remove at most 50 tasks in one proposal.'};
      const all=normaliseTasks(get().todos),missing=ids.filter(id=>!all.some(t=>t.id===id));
      if(missing.length)return {error:`Task not found: ${missing.slice(0,5).join(', ')}; read_project tasks first.`};
      const named=ids.map(id=>all.find(t=>t.id===id)),fx=removalEffects(all,ids),was=JSON.stringify(named);
      const effects=[fx.lifted?`${fx.lifted} ${fx.lifted===1?'subtask moves':'subtasks move'} up a level.`:'',fx.unblocked?`${fx.unblocked} ${fx.unblocked===1?'task stops':'tasks stop'} waiting.`:''].filter(Boolean);
      const lines=named.slice(0,6).map(t=>t.text);if(named.length>6)lines.push(`${named.length-6} more`);
      return {it:{label:ids.length===1?`Remove task: ${named[0].text}`:`Remove ${ids.length} tasks`,detail:[...lines,...effects].join('\n'),acceptLabel:'Remove',accept:()=>{
        const live=normaliseTasks(get().todos),now=ids.map(id=>live.find(t=>t.id===id));
        if(now.some(t=>!t)||JSON.stringify(now)!==was)return {refused:'Tasks changed; propose again.'};
        let result=null;update(st=>{result=removeTasks(st.todos,ids);st.todos=result.list;return st;});
        const text=`${result.removed.length} ${result.removed.length===1?'task':'tasks'} removed`;noteRemoval(result,text);
        return `${text}. Undo is on the Tasks page while the tasks stay as they are.`;
      }}};
    },
    describe(c,s) {
      const ids=[...new Set((Array.isArray(c.ids)?c.ids:[]).filter(x=>typeof x==='string'&&x))];if(!ids.length)return null;
      const all=normaliseTasks(s?.todos),named=ids.map(id=>all.find(t=>t.id===id)).filter(Boolean);
      const label=ids.length===1?(named[0]?.text||''):`Remove ${ids.length} tasks`;
      if(!named.length)return {...(label?{label}:{}),detail:'',acceptLabel:'Remove',stale:ids.length===1?'Task removed':'Already removed'};
      const lines=named.slice(0,6).map(t=>t.text);if(named.length>6)lines.push(`${named.length-6} more`);
      return {label,detail:ids.length===1?'':lines.join('\n'),acceptLabel:'Remove',...(named.length<ids.length?{stale:'Changed since'}:{})};
    }},
  create_project_note: {group:'changes',views:['notes'],doc:'{title?, text: note Markdown, paper?: record id or label}. Creates a draft project note after acceptance.',
    async run(c,ctx) {
      if(typeof c.text!=='string'||!c.text.trim()||c.text.length>20000)return {error:'Note text must contain 1–20000 characters.'};
      const p=c.paper?paperOf(c.paper):null;if(c.paper&&!p)return {error:'Record not found.'};
      const text=c.text.trim(),title=clip(c.title||titleOf(text),120);
      return {it:{label:`Create note: ${title}`,detail:text,acceptLabel:'Create',accept:()=>{
        if(p&&!(get().papers||[]).some(x=>x.id===p.id))return {refused:'Record removed; propose again.'};
        if((get().projectNotes||[]).some(n=>n.title===title&&n.text===text))return 'Already there';
        const at=new Date().toISOString();update(st=>{st.projectNotes=[...(st.projectNotes||[]),{id:`n${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`,title,text,at,updated:at,extractor:`model:${ctx.model}`,verified:false,...(p?{paperId:p.id}:{})}];return st;});return 'Created';
      }}};
    }},
  edit_project_note: {group:'changes',views:['notes'],doc:'{id, expected_hash: text_hash from read_project notes, title?, text}. Replaces a project note after review; stale edits refused.',
    async run(c,ctx) {
      const n=(get().projectNotes||[]).find(n=>n.id===c.id);if(!n)return {error:'Note not found; read_project notes first.'};
      if(c.expected_hash!==hashText(n.text))return {error:'Note hash changed; read it again before editing.'};
      if(typeof c.text!=='string'||!c.text.trim()||c.text.length>20000)return {error:'Note text must contain 1–20000 characters.'};
      const was=JSON.stringify(n),text=c.text.trim(),title=clip(c.title||titleOf(text),120);
      return {it:{label:`Edit note: ${n.title}`,detail:text,acceptLabel:'Replace',accept:()=>{
        const live=(get().projectNotes||[]).find(n=>n.id===c.id);if(!live||JSON.stringify(live)!==was)return {refused:'Note changed; propose again.'};
        update(st=>{const note=st.projectNotes.find(n=>n.id===c.id);Object.assign(note,{title,text,updated:new Date().toISOString(),extractor:`model:${ctx.model}`,verified:false});return st;});return 'Replaced';
      }}};
    }},

  create_collection: { group: 'changes', views: ['library'], doc: '{name, parent?: collection id or name}',
    async run(c) {
      const name = clip(c.name, 80); if (!name) return { error: 'create_collection needs a name' };
      const parent = c.parent ? collectionOf(c.parent) : null;
      if (c.parent && !parent) return { error: `no collection "${clip(c.parent, 60)}"` };
      if (coll.collections().some(x => (x.parent ?? null) === (parent?.id ?? null) && low(x.name) === low(name))) return { error: `"${name}" exists there` };
      return { it: { label: `Create collection ${name}`, detail: parent ? `inside ${parent.name}` : '', acceptLabel: 'Create',
        accept: () => { coll.add(name, parent?.id ?? null); return 'Created'; } } };
    } },

  add_to_collection: { group: 'changes', views: ['library'], doc: '{collection: id or name, papers: [id, label or doi], create?: true to make the collection}',
    async run(c) { return membership(c, true); },
    describe(c, s) {
      const found = papersIn(c.papers, s), target = (s?.collections || []).find(x => x.id === c.collection) || (s?.collections || []).find(x => low(x.name) === low(c.collection));
      const name = target?.name || clip(c.collection, 80);
      if (!found.length) return { label: `Add to collection ${name}`, detail: '', acceptLabel: 'Add', stale: 'Records removed' };
      const have = new Set(target?.members || []);
      return { label: `Add to collection ${name}`, detail: `${found.length} ${found.length === 1 ? 'record' : 'records'}: ${names(found)}`, acceptLabel: 'Add', ...(found.every(p => have.has(p.id)) ? { stale: 'Already added' } : {}) };
    } },
  remove_from_collection: { group: 'changes', views: ['library'], doc: '{collection, papers: [...]}',
    async run(c) { return membership(c, false); } },

  add_note: { group: 'changes', views: ['library', 'screening', 'extraction', 'appraisal'], doc: '{paper, text, kind: "comment"|"quote", quote?: verbatim from the record (required for kind quote), page?}',
    async run(c, ctx) {
      const p = paperOf(c.paper); if (!p) return { error: `no record "${clip(c.paper, 60)}"` };
      const kind = c.kind === 'quote' ? 'quote' : 'comment';
      const text = clip(c.text, 2000); if (!text) return { error: 'add_note needs text' };
      let where = { page: Number.isInteger(c.page) ? c.page : null, rects: null };
      if (kind === 'quote') {
        const q = String(c.quote || '').trim() || text;
        const hit = await verifyQuote(p, q, where.page);
        if (!hit) return { error: 'the quote is not in this record (title, abstract or the PDF page named); quote it verbatim' };
        where = { page: hit.page, rects: hit.rects };
      }
      return { it: { label: `Note on ${p.label}`, detail: text, acceptLabel: 'Add', where: { paperId: p.id, locator: where.page ? { page: where.page } : null, label: p.label },
        accept: () => { let ok; update(st => { ok = addNoteTo(st, { paper: p.id, kind, text, page: where.page ?? '', rects: where.rects, model: ctx.model }); return st; }); return ok ? 'Added' : 'Already there'; } } };
    } },

  add_file_note: { group: 'changes', views: ['files'], doc: '{path, text, quote?, todo?: true to add a to-do}',
    async run(c) {
      const path = clip(c.path, 600), text = clip(c.text, 2000);
      if (!path || !text) return { error: 'add_file_note needs path and text' };
      return { it: { label: `File note on ${path.split('/').pop()}`, detail: text, acceptLabel: 'Add',
        accept: () => { update(st => { addFileNote(st, { text, source: { path, label: path.split('/').pop() }, anchor: { kind: 'text', quote: String(c.quote || ''), prefix: '', suffix: '', start: 0, end: String(c.quote || '').length }, todo: c.todo === true }); return st; }); return 'Added'; } } };
    } },

  set_protocol: { group: 'changes', views: ['protocol'], doc: '{field: title|population|intervention|comparator|outcome|designs, value}',
    async run(c) {
      const FIELDS = ['title', 'population', 'intervention', 'comparator', 'outcome', 'designs'];
      if (!oneOf(c.field, FIELDS)) return { error: `field must be one of ${FIELDS.join(', ')}` };
      const value = clip(c.value, 1200); if (!value) return { error: 'set_protocol needs a value' };
      const read = s => c.field === 'title' ? s.protocol?.title || '' : s.protocol?.pico?.[c.field] || '';
      const was = read(get());
      if (was === value) return { error: 'the protocol already says that' };
      return { it: { label: `Protocol ${c.field}`, detail: was ? `− ${clip(was, 300)}\n+ ${value}` : value, acceptLabel: 'Apply',
        accept: () => {
          if (read(get()) !== was) return { refused: 'the protocol changed since; ask again' };
          update(s => { const p = s.protocol = { title: '', pico: {}, criteria: [], ...(s.protocol || {}) };
            if (c.field === 'title') p.title = value; else p.pico = { ...(p.pico || {}), [c.field]: value };
            if ((s.protocolVersions || []).length) p.amendments = [...(p.amendments || []), { at: new Date().toISOString(), note: `Assistant proposal accepted: ${c.field}` }];
            return s; });
          return 'Applied';
        } } };
    } },

  edit_criterion: { group: 'changes', views: ['protocol'], doc: '{id, text?, stage?: "Title/abstract"|"Full text", kind?: include|exclude|group, question?, yes?, no?}',
    async run(c) {
      const cur = (get().protocol?.criteria || []).find(x => x.id === c.id);
      if (!cur) return { error: `no criterion "${clip(c.id, 40)}"` };
      const patch = {};
      if (c.text != null) { const t = clip(c.text, 600); if (!t) return { error: 'text cannot be empty' }; patch.text = t; }
      if (c.stage != null) { if (!oneOf(c.stage, ['Title/abstract', 'Full text'])) return { error: 'stage must be "Title/abstract" or "Full text"' }; patch.stage = c.stage; }
      if (c.kind != null) { if (!oneOf(c.kind, ['include', 'exclude', 'group'])) return { error: 'kind must be include, exclude or group' }; patch.kind = c.kind; }
      for (const k of ['question', 'yes', 'no']) if (c[k] != null) patch[k] = clip(c[k], 400);
      const changed = Object.keys(patch).filter(k => (cur[k] ?? '') !== patch[k]);
      if (!changed.length) return { error: 'nothing would change' };
      const before = JSON.stringify(cur);
      return { it: { label: `Edit criterion ${cur.id}`, detail: changed.map(k => `${k}: ${clip(cur[k] || '—', 160)} → ${clip(patch[k], 160)}`).join('\n'), acceptLabel: 'Apply',
        accept: () => {
          const now = (get().protocol?.criteria || []).find(x => x.id === cur.id);
          if (!now || JSON.stringify(now) !== before) return { refused: `${cur.id} changed since; ask again` };
          update(s => { s.protocol.criteria = s.protocol.criteria.map(x => x.id === cur.id ? { ...x, ...patch } : x);
            s.protocol.amendments = [...(s.protocol.amendments || []), { at: new Date().toISOString(), note: `Assistant proposal accepted: criterion ${cur.id} (${changed.join(', ')})` }]; return s; });
          return 'Applied';
        } } };
    } },

  run_workflow: { group: 'changes', views: ['workflows'], doc: '{id: workflow id}',
    async run(c) {
      const f = (get().workflows || []).find(x => x.id === c.id);
      if (!f) return { error: `no workflow "${clip(c.id, 60)}"` };
      return { it: { label: `Run workflow ${f.name}`, detail: `${(f.blocks || []).length} blocks: ${(f.blocks || []).map(b => b.type).slice(0, 8).join(', ')}`, acceptLabel: 'Run',
        accept: async () => { const { runFlow } = await import('./flow-runner.mjs'); await runFlow(f.id, { trigger: 'assistant' }); return 'Started'; } } };
    } },

  set_setting: { group: 'changes', views: ['settings'], doc: `{key, value}; keys: ${Object.entries(SETTING_KEYS).map(([k, v]) => `${k} (${v.doc})`).join('; ')}`,
    async run(c) {
      const key = String(c.key || '');
      if (key.startsWith('task:')) {
        const task = key.slice(5);
        if (!TASK_IDS.includes(task)) return { error: `task must be one of ${TASK_IDS.join(', ')}` };
        const { profiles, modelFor } = await import('./model-settings.mjs');
        const p = profiles().find(x => x.id === c.value); if (!p) return { error: `no model profile "${clip(c.value, 40)}"; ids: ${profiles().map(x => x.id).join(', ') || 'none'}` };
        const was = modelFor(task);
        return { it: { label: `Model for ${task}`, detail: `${was.label || was.model || 'default'} → ${p.label || p.model}`, acceptLabel: 'Apply',
          accept: async () => { const { setTaskModel } = await import('./model-settings.mjs'); setTaskModel(task, p.id); return 'Applied'; } } };
      }
      const def = SETTING_KEYS[key];
      if (!def || key.includes('<')) return { error: `setting must be one of: ${Object.keys(SETTING_KEYS).join(', ')}` };
      if (!def.check(c.value)) return { error: `${key}: ${def.doc}` };
      const was = get().settings?.[key];
      return { it: { label: `Setting ${key}`, detail: `${was ?? 'unset'} → ${c.value}`, acceptLabel: 'Apply',
        accept: () => { update(s => { s.settings = { ...(s.settings || {}), [key]: c.value }; return s; }); return 'Applied'; } } };
    } },

  set_search_query: { live: true, group: 'search', views: ['search'], doc: `{source: ${SOURCES.map(s => s.id).join('|')}, query, note?}`,
    async run(c) {
      const source = SOURCES.find(s => s.id === c.source || low(s.name) === low(c.source));
      if (!source) return { error: `source must be one of ${SOURCES.map(s => s.id).join(', ')}` };
      const query = clip(c.query, 4000); if (!query) return { error: 'set_search_query needs a query' };
      return { it: { label: `Search box: ${source.name}`, detail: query, acceptLabel: 'Fill search',
        accept: async () => { const { loadQuery } = await import('../views/search.mjs'); loadQuery(query, source.id); return 'Placed in the Search view; nothing was run'; } } };
    } },

  // A search run and its records brought in (owner, 2026-10-22, the paper run: "run the searches and import"): the query runs once now, so
  // the item says how many records it brings; accepting it fetches them all into the Library as the page's Add all does, and logs the run.
  run_search: { live: true, group: 'search', views: ['search'], doc: `{source: ${SOURCES.map(s => s.id).join('|')}, query}; runs it now for the count (at most ${RUN_SEARCH_MAX.toLocaleString('en')} records: narrow a broader query), and accepting adds every record to the Library and logs the search`,
    async run(c) {
      const source = SOURCES.find(s => s.id === c.source || low(s.name) === low(c.source));
      if (!source) return { error: `source must be one of ${SOURCES.map(s => s.id).join(', ')}` };
      const query = clip(c.query, 4000); if (!query) return { error: 'run_search needs a query' };
      const [sources, { settings }] = await Promise.all([import('./sources.mjs'), import('./model-settings.mjs')]);
      let total;
      try { total = Number((await sources.runSearch(source.id, query, { offset: 0, limit: 1, settings: settings() })).total) || 0; }
      catch (err) { return { error: `${source.name} did not answer: ${clip(err?.message || err, 160)}` }; }
      if (!total) return { error: `${source.name} finds no records for that query; broaden it` };
      if (total > RUN_SEARCH_MAX) return { error: `${source.name} finds ${total.toLocaleString('en')} records; narrow the query (at most ${RUN_SEARCH_MAX.toLocaleString('en')})` };
      return { it: { label: `Search ${source.name}: ${total.toLocaleString('en')} ${total === 1 ? 'record' : 'records'}`, detail: query, acceptLabel: 'Add records',
        accept: async () => { const { addAll } = await import('./search-run.mjs'); return addAll({ query, sourceId: source.id, total, settings: settings() }); } } };
    } },

  label: { group: 'screening', views: ['screening', 'library'], doc: '{papers: [...], label: name, create?: true to make the label, remove?: true to take it off}',
    async run(c) {
      const { found, missing } = papersOf(c.papers); if (!found.length) return { error: 'no known records in papers' };
      const name = clip(c.label, 60); if (!name) return { error: 'label needs a name' };
      const have = labelList(get()).find(l => low(l.name) === low(name) || l.id === c.label);
      if (!have && (c.remove || c.create !== true)) return { error: `no label "${name}"; pass create: true to make it` };
      return { skipped: missing.length ? [`${missing.length} unknown: ${missing.slice(0, 4).join('; ')}`] : [], it: {
        label: `${c.remove ? 'Remove' : 'Add'} label ${have?.name || name}`, detail: `${found.length} ${found.length === 1 ? 'record' : 'records'}: ${names(found)}`, acceptLabel: c.remove ? 'Remove' : 'Label',
        accept: () => {
          const l = have || addLabel(name, { by: who() }); if (!l) return { refused: 'the label could not be made' };
          for (const p of found) setLabel(p.id, l.id, !c.remove, { by: who() });
          return `${found.length} ${c.remove ? 'unlabelled' : 'labelled'}`;
        } } };
    },
    describe(c, s) {
      const found = papersIn(c.papers, s), name = clip(c.label, 60), have = labelList(s).find(l => low(l.name) === low(name) || l.id === c.label);
      const label = `${c.remove ? 'Remove' : 'Add'} label ${have?.name || name}`, acceptLabel = c.remove ? 'Remove' : 'Label';
      if (!found.length) return { label, detail: '', acceptLabel, stale: 'Records removed' };
      return { label, detail: `${found.length} ${found.length === 1 ? 'record' : 'records'}: ${names(found)}`, acceptLabel };
    } },

  assign_screening: { group: 'screening', views: ['screening'], doc: '{stage: ta|ft, reviewer: initials, papers: [...], name?}',
    async run(c) {
      const stage = c.stage === 'ft' ? 'ft' : 'ta';
      const reviewer = clip(c.reviewer, 32); if (!reviewer) return { error: 'assign_screening needs a reviewer (their initials)' };
      const { found, missing } = papersOf(c.papers, { max: 2000 }); if (!found.length) return { error: 'no known records in papers' };
      const name = clip(c.name, 80) || `Assigned to ${reviewer}`;
      return { skipped: missing.length ? [`${missing.length} unknown`] : [], it: { label: `Assign ${found.length} to ${reviewer} (${stage === 'ft' ? 'full text' : 'title/abstract'})`, detail: names(found), acceptLabel: 'Assign',
        accept: () => { addBatches([{ name, stage, ids: found.map(p => p.id), reviewers: [reviewer], kind: 'manual' }], { by: who() }); return 'Assigned'; } } };
    } },

  add_field: { live: true, group: 'extraction', views: ['extraction'], doc: '{label, type: text|number|integer|category, options?: [levels], unit?, definition?, instructions?}',
    async run(c) {
      const label = clip(c.label, 80); if (!label) return { error: 'add_field needs a label' };
      const type = oneOf(c.type, ['text', 'number', 'integer', 'category']) ? c.type : 'text';
      if (fieldList(get()).some(f => low(f.label) === low(label))) return { error: `a field "${label}" exists` };
      const attrs = {}; for (const k of ['unit', 'definition', 'instructions']) if (c[k]) attrs[k] = clip(c[k], 400);
      const options = type === 'category' ? (Array.isArray(c.options) ? c.options.map(o => clip(o, 60)).filter(Boolean).slice(0, 30) : []) : [];
      if (type === 'category' && options.length < 2) return { error: 'a category field needs at least two options' };
      return { it: { label: `Add field ${label}`, detail: [type, options.join(' | '), attrs.unit && `unit ${attrs.unit}`, attrs.definition].filter(Boolean).join('\n'), acceptLabel: 'Add',
        accept: () => { if (fieldList(get()).some(f => low(f.label) === low(label))) return { refused: `a field "${label}" exists now` }; addField({ label, type, options, ...attrs }); return 'Added'; } } };
    } },

  set_arms: { group: 'extraction', views: ['analysis', 'extraction'], doc: '{paper, arms: [treated arm labels, at least 2], control?}',
    async run(c) {
      const p = paperOf(c.paper); if (!p) return { error: `no record "${clip(c.paper, 60)}"` };
      const arms = (Array.isArray(c.arms) ? c.arms : []).map(a => clip(a, 80)).filter(Boolean).slice(0, 8);
      if (arms.length < 2) return { error: 'a multi-arm study needs at least two treated arms' };
      return { it: { label: `Treated arms of ${p.label}`, detail: `${arms.join(' | ')}${c.control ? `\ncontrol: ${clip(c.control, 80)}` : ''}`, acceptLabel: 'Set arms',
        accept: () => { update(st => setArms(st, p.id, arms, clip(c.control, 80))); return 'Set'; } } };
    } },

  appraise: { group: 'appraisal', views: ['appraisal'], doc: '{paper, domain: domain id, judgement: one of the instrument\'s levels, quote: verbatim from the record, page?, rationale?, tool?, reviewer?: "a" or "b", required when two-reviewer appraisal is on}',
    async run(c, ctx) {
      const s = get();
      const p = paperOf(c.paper); if (!p) return { error: `no record "${clip(c.paper, 60)}"` };
      // With two reviewers the draft is filed for one named reviewer's slot; it never fills the other's, and nothing is written until a person accepts.
      const two = secondOn(s);
      const slot = two ? String(c.reviewer || '').toLowerCase() : 'a';
      if (two && slot !== 'a' && slot !== 'b') return { error: 'two-reviewer appraisal is on: name the reviewer slot the draft is for, reviewer "a" or "b"' };
      if (!two && c.reviewer != null && String(c.reviewer).toLowerCase() !== 'a') return { error: 'one-reviewer appraisal: there is no reviewer b' };
      const tool = c.tool ? allTools(s).find(t => t.id === c.tool) : appraisalTool(s.appraisalTool || 'rob2', s);
      if (!tool) return { error: `tool must be one of ${allTools(s).map(t => t.id).join(', ')}` };
      const domain = tool.domains.find(d => d.id === c.domain || d.short === c.domain);
      if (!domain) return { error: `${tool.name} domains: ${tool.domains.map(d => `${d.id} (${d.short})`).join(', ')}` };
      if (!oneOf(c.judgement, tool.judgements)) return { error: `${tool.name} judgements: ${tool.judgements.join(', ')}` };
      const hit = await verifyQuote(p, c.quote, Number.isInteger(c.page) ? c.page : null);
      if (!hit) return { error: 'a judgement rests on a quote: give the words of the record that bear on the domain, verbatim' };
      const priorOf = st => answersBy(st, p.id, tool.id, STUDY, slot)[domain.id] ?? '';
      const prior = priorOf(s);
      const rationale = clip(c.rationale, 400);
      const whose = two ? `Reviewer ${slot.toUpperCase()}'s` : 'your';
      return { it: { label: `${p.label}: ${tool.name} ${domain.short} ${c.judgement}${two ? ` (reviewer ${slot.toUpperCase()})` : ''}`, detail: `${domain.label}\n"${clip(c.quote, 300)}"${rationale ? `\n${rationale}` : ''}\nRecorded as ${whose} answer; a draft until you accept it.`, acceptLabel: 'Record',
        where: { paperId: p.id, locator: hit.page ? { page: hit.page } : null, label: `${p.label}${hit.page ? `, p. ${hit.page}` : ', abstract'}` },
        accept: () => {
          if (secondOn(get()) !== two) return { refused: 'the number of reviewers changed since; ask again' };
          if (priorOf(get()) !== prior) return { refused: `${domain.short} changed since; ask again` };
          update(st => {
            setAnswer(st, { paperId: p.id, toolId: tool.id, who: slot, domain: domain.id, value: c.judgement, toolIds: allTools(st).map(t => t.id) });
            addNoteTo(st, { paper: p.id, kind: 'quote', text: `${tool.name} ${domain.short}: "${clip(c.quote, 600)}"`, page: hit.page ?? '', rects: hit.rects, model: ctx.model });
            if (rationale) addNoteTo(st, { paper: p.id, kind: 'comment', text: `${tool.name} ${domain.short} (${c.judgement}): ${rationale}`, page: hit.page ?? '', model: ctx.model });
            return st;
          });
          return 'Recorded';
        } } };
    } },

  set_outcome: { group: 'analysis', views: ['analysis'], doc: `{outcome?: id of an existing outcome, name?, measure?: ${MEASURES.map(m => m.id).join('|')}}; without outcome a new one is added. Running the model stays in Analysis.`,
    async run(c) {
      if (c.measure != null && !MEASURES.some(m => m.id === c.measure)) return { error: `measure must be one of ${MEASURES.map(m => m.id).join(', ')}` };
      const name = clip(c.name, 120);
      if (!c.outcome) {
        if (!name) return { error: 'a new outcome needs a name' };
        const same = outcomeList(get()).find(o => String(o.name || '').trim().toLowerCase() === name.trim().toLowerCase());
        if (same) return { error: `an outcome named "${same.name}" exists (${same.id}): pass outcome "${same.id}" to change it rather than add a copy` };
        return { it: { label: `Add outcome ${name}`, detail: c.measure || 'RR', acceptLabel: 'Add', accept: () => { update(st => { setUpOutcome(st, addOutcome(st, name, c.measure || 'RR')); return st; }); return 'Added'; } } };
      }
      const o = outcomeList(get()).find(x => x.id === c.outcome);
      if (!o) return { error: `no outcome "${clip(c.outcome, 40)}"; ids: ${outcomeList(get()).map(x => x.id).join(', ')}` };
      if (!name && !c.measure) return { error: 'nothing to change: give name or measure' };
      return { it: { label: `Outcome ${o.name}`, detail: [name && `name → ${name}`, c.measure && `measure ${o.measure} → ${c.measure}`].filter(Boolean).join('\n'), acceptLabel: 'Apply',
        accept: () => { update(st => { if (name) renameEverywhere(st, o.id, name); if (c.measure) setOutcomeMeasure(st, o.id, c.measure); return st; }); return 'Applied'; } } };
    } },

  edit_paragraph: { group: 'manuscript', views: ['manuscript'], doc: '{block: block id from manuscript_outline, replace_text: whole new text, or find + replace for one exact passage}; from the chat it is written in the paragraph as a tracked change the person accepts or rejects',
    async run(c) {
      const b = blockOf(get(), c.block); if (!b) return { error: `no manuscript block "${clip(c.block, 40)}"; read manuscript_outline for ids` };
      if (['table', 'figure', 'toc', 'bib'].includes(b.type)) return { error: 'that block is not a paragraph' };
      let next;
      if (c.find != null) {
        const r = replaceIn(b, String(c.find), String(c.replace ?? ''));
        if (!r) return { error: 'the text to find must occur exactly once in that paragraph' };
        next = r;
      } else if (c.replace_text != null) next = { text: String(c.replace_text), runs: [{ t: String(c.replace_text) }] };
      else return { error: 'give replace_text, or find and replace' };
      if (!next.text.trim()) return { error: 'the paragraph would be empty' };
      if (!sameTokens(b.text, next.text)) return { error: 'citation and result markers must stay as they are: keep every [@key] and {{result}} in place' };
      const hash = hashText(b.text), moved = numbersChanged(b.text, next.text);
      return { it: { label: `Edit ${b.type === 'p' ? 'paragraph' : 'heading'}`, detail: `− ${clip(b.text, 320)}\n+ ${clip(next.text, 320)}${moved ? `\nNumbers changed: ${moved}` : ''}`, acceptLabel: 'Accept', manuscriptEdit: true,
        accept: () => {
          const now = blockOf(get(), b.id);
          if (!now) return { refused: 'the paragraph is gone' };
          if (hashText(now.text) !== hash) return { refused: 'the paragraph changed since; ask again' };
          update(s => { const x = blockOf(s, b.id); x.text = next.text; x.runs = next.runs; return s; });
          return 'Applied';
        },
        // from the chat: written in the paragraph as a tracked change by the assistant (lib/tracked-edit.mjs), for a person to decide
        write: () => {
          const change = assistantChange(); let done = false;
          update(s => { const i = s.manuscript?.blocks?.findIndex(x => x.id === b.id) ?? -1, x = s.manuscript?.blocks?.[i];
            const y = x && hashText(x.text) === hash ? trackedRewrite(x, next.text, change) : null;
            if (y) { s.manuscript.blocks[i] = y; done = true; } return s; });
          return done ? { view: 'manuscript', block: b.id, write: change.write, label: `Edited ${b.type === 'p' ? 'paragraph' : 'heading'}` } : null;
        } } };
    } },

  insert_paragraph: { group: 'manuscript', views: ['manuscript'], doc: '{after: block id or "start", text, type?: p|h1|h2|h3}; from the chat, a tracked insertion',
    async run(c) {
      const text = clip(c.text, 8000); if (!text) return { error: 'insert_paragraph needs text' };
      const type = oneOf(c.type, ['p', 'h1', 'h2', 'h3']) ? c.type : 'p';
      const blocks = get().manuscript?.blocks || [];
      if (c.after !== 'start' && !blocks.some(b => b.id === c.after)) return { error: 'after must be "start" or a block id from manuscript_outline' };
      const place = blockLocation(get(), c.after, { after: true });
      return { it: { label: `Insert ${type === 'p' ? 'paragraph' : 'heading'}`, detail: `After ${place}`, acceptLabel: 'Accept', manuscriptEdit: true,
        accept: () => {
          const cur = get().manuscript?.blocks || [];
          const at = c.after === 'start' ? 0 : cur.findIndex(b => b.id === c.after) + 1;
          if (c.after !== 'start' && at === 0) return { refused: 'the block it followed is gone' };
          update(s => { const b = blankBlock(type, text); b.runs = [{ t: text }]; s.manuscript ||= { blocks: [], snapshot: {} }; s.manuscript.blocks ||= []; s.manuscript.blocks = [...s.manuscript.blocks.slice(0, at), b, ...s.manuscript.blocks.slice(at)]; return s; });
          return 'Inserted';
        },
        write: () => {
          const change = assistantChange(); let id = null;
          // a project without a manuscript gets one: an insertion is how the first paragraph arrives
          update(s => { s.manuscript ||= { blocks: [], snapshot: {} }; s.manuscript.blocks ||= []; const r = trackedInsert(s.manuscript.blocks, c.after, { type, text }, change); if (r) { s.manuscript.blocks = r.blocks; id = r.id; } return s; });
          return id ? { view: 'manuscript', block: id, write: change.write, label: `Added ${type === 'p' ? 'paragraph' : 'heading'}` } : null;
        } } };
    } },

  insert_manuscript_output: { group: 'manuscript', views: ['manuscript'], doc: '{after: existing block id or "start", spec: validated output spec (same as propose_output), caption?: string}. Creates a data-backed table or chart and proposes inserting it into the paper with a caption.', run: manuscriptOutputProposal },

  // The journal the paper is for (owner, 2026-10-22, the paper run: the assistant chose one and could only leave a note): the first of the
  // project's journals is the target; its reference style and journal profile follow it, as when the author picks it (lib/journal-context.mjs).
  set_target_journal: { live: true, group: 'manuscript', views: ['submissions', 'overview', 'manuscript'], doc: '{journal: full journal name, alternatives?: [other journals, best first]}',
    async run(c) {
      const journal = clip(c.journal, 160); if (!journal) return { error: 'set_target_journal needs a journal' };
      const others = (Array.isArray(c.alternatives) ? c.alternatives : []).map(x => clip(x, 160)).filter(x => x && low(x) !== low(journal)).slice(0, 5);
      const now = get().project?.journals || [];
      return { it: { label: `Target journal: ${journal}`, detail: [now[0] && low(now[0]) !== low(journal) ? `Replaces ${now[0]}` : '', others.length ? `Then: ${others.join('; ')}` : '', 'Its reference style and journal profile follow it'].filter(Boolean).join('\n'), acceptLabel: 'Set target',
        accept: async () => { const { setJournals } = await import('./journal-context.mjs'); update(st => setJournals(st, [journal, ...others, ...(st.project?.journals || [])])); return `Target: ${journal}`; } } };
    } },

  set_report_item: { group: 'manuscript', views: ['reporting'], doc: '{item: checklist item number, state: "done"|"na"|"", where?: where it is reported, note?}',
    async run(c) {
      const s = get(), list = checklistOf(s);
      const row = list.items.find(([n]) => n === String(c.item)); if (!row) return { error: `${list.name} items: ${list.items.map(([n]) => n).join(', ')}` };
      if (!oneOf(c.state, ['done', 'na', ''])) return { error: 'state must be done, na or empty' };
      const patch = { state: c.state, ...(c.where != null ? { where: clip(c.where, 300) } : {}), ...(c.note != null ? { note: clip(c.note, 400) } : {}) };
      const prior = JSON.stringify(checklistStates(s)[row[0]] || {});
      return { it: { label: `${list.name} ${row[0]} ${row[1]}`, detail: [c.state || 'not reviewed', patch.where && `where: ${patch.where}`].filter(Boolean).join('\n'), acceptLabel: 'Set',
        accept: () => {
          if (JSON.stringify(checklistStates(get())[row[0]] || {}) !== prior) return { refused: 'the item changed since; ask again' };
          update(st => { const k = checklistOf(st).key; st[k] = { ...(st[k] || {}), [row[0]]: { ...((st[k] || {})[row[0]] || {}), ...patch } }; return st; }); return 'Set';
        } } };
    },
    describe(c, s) {
      const list = checklistOf(s), row = list.items.find(([n]) => n === String(c.item)); if (!row) return null;
      const now = checklistStates(s)[row[0]] || {};
      return { label: `${list.name} ${row[0]} ${row[1]}`, detail: [c.state || 'not reviewed', c.where && `where: ${clip(c.where, 300)}`].filter(Boolean).join('\n'), acceptLabel: 'Set',
        ...((now.state || '') === c.state && (c.where == null || (now.where || '') === clip(c.where, 300)) ? { stale: 'Already set' } : {}) };
    } },
};

/** The records a stored change names, read from the state given (describe is pure). */
const papersIn = (refs, s) => { const out = []; for (const r of Array.isArray(refs) ? refs.slice(0, 500) : []) { const p = paperOf(r, s || {}); if (p && !out.some(x => x.id === p.id)) out.push(p); } return out; };

function membership(c, add) {
  const { found, missing } = papersOf(c.papers); if (!found.length) return { error: 'no known records in papers' };
  const target = collectionOf(c.collection);
  if (!target && !(add && c.create === true)) return { error: `no collection "${clip(c.collection, 60)}"${add ? '; pass create: true to make it' : ''}` };
  const name = target?.name || clip(c.collection, 80);
  return { skipped: missing.length ? [`${missing.length} unknown: ${missing.slice(0, 4).join('; ')}`] : [], it: {
    label: `${add ? 'Add to' : 'Remove from'} collection ${name}`, detail: `${found.length} ${found.length === 1 ? 'record' : 'records'}: ${names(found)}`, acceptLabel: add ? 'Add' : 'Remove',
    accept: () => {
      let id = collectionOf(target?.id || name)?.id;
      if (!id) { if (!add) return { refused: 'the collection is gone' }; id = coll.add(name); }
      update(s => { s.collections = (s.collections || []).map(x => { if (x.id !== id) return x;
        const m = new Set(x.members || []); for (const p of found) add ? m.add(p.id) : m.delete(p.id); return { ...x, members: [...m] }; }); return s; });
      return `${found.length} ${add ? 'added' : 'removed'}`;
    } } };
}

// The ops lib/changes.mjs implements itself (files, criteria, decisions, workflows, to-dos), described here so
// one table names every op.
export const LEGACY_OPS = {
  import_files: { group: 'changes', views: ['library', 'files'], doc: '{paths: PDF paths in the project folder to add to the library}' },
  write_file: { group: 'changes', views: ['files'], doc: '{path, content}: a text or code file, created or replaced' },
  edit_file: { group: 'changes', views: ['files'], doc: '{path, find, replace}: find must occur exactly once' },
  add_criterion: { group: 'changes', views: ['protocol'], doc: '{text, stage: "Title/abstract"|"Full text", kind?: include|exclude|group, question?, yes?, no?}' },
  screen: { group: 'screening', views: ['screening'], doc: '{paper: label, id or doi, decision: include|exclude|uncertain, reason (required for exclude), stage: ta|ft, note?}' },
  add_todo: { group: 'changes', views: ['overview'], doc: '{text}: an older name for add_task' },
  save_workflow: { group: 'workflows', views: ['workflows'], doc: '{flow: complete workflow object with name, blocks, edges; id for edits, cron optional}. Read read_project(section:"workflows", offset:0) first for canonical field values, limits and model IDs. Propose one workflow per call; wait for its result before continuing. Use exact enum values, not display labels. Filing creates a proposal; acceptance saves it with its schedule disabled.' },
};
const ALL = { ...LEGACY_OPS, ...CHANGE_OPS };
/** Every op name, and the docs for a group of them (what discover_tools returns when the group loads). */
export const OP_NAMES = Object.keys(ALL);
export const opDocs = group => Object.entries(ALL).filter(([, o]) => o.group === group).map(([name, o]) => `${name} ${o.doc}`);
export const opDoc = op => ALL[op]?.doc || '';
export const opGroups = () => [...new Set(Object.values(ALL).map(o => o.group))];
/** Ops a reviewer could do in a view, by name: for "what can you do here". */
export const opsForView = view => Object.entries(ALL).filter(([, o]) => o.views?.includes(view)).map(([n]) => n);
