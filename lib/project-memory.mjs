// A derived view of the current project. Nothing is copied into a second
// persistent store: edits, decisions, and accepted evidence are searchable as
// soon as the project state changes. Draft text remains labelled as draft.
import { projectIndex } from './project-index.mjs';
import { hashText } from './manuscript.mjs';
import { pooledInputStatus } from './analysis-inputs.mjs';
import { researchType } from './workflow.mjs';
import { checklistOf, checklistStates } from './checklist.mjs';
import { analysisRegistry } from './research-copilot.mjs';
import { settingsOf } from './app-settings.mjs';
import { DEFAULT_COLUMNS } from './ipd.mjs';
import { isJev } from './jev.mjs';
import { foldSearch } from './search-ranking.mjs';
import { forms, near, slip } from './search-smart.mjs';
import { listForAssistant } from './submissions.mjs';
import { visibleNotifications, notificationTitle, notificationPlace } from './notifications.mjs';
import { workflowContract } from './flow-blocks.mjs';

const STOP_WORDS = new Set('the this that these those what which who how why about from with have has does are can you please tell show give some paper study record project'.split(' '));
const words = text => [...new Set(foldSearch(text).match(/[\p{L}\p{N}]{3,}/gu) || [])].filter(w => !STOP_WORDS.has(w));   // folded: accents, ı and İ do not matter
const clipped = (value, limit = 500) => String(value ?? '').slice(0, limit);

function submissionsBrief(state) {
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const all = listForAssistant(state.submissions, today);
  return all.total ? { summary: all.summary, journals: all.items.slice(0, 3).map(a => ({ journal: a.journal, status: a.status, events: a.events.length })), more_in: 'read_project submissions' } : { summary: 'No journal attempt recorded', more_in: 'the Submission page' };
}
export function projectOverview(state) {
  const papers = state.papers || [];
  const included = papers.filter(p => (state.fulltext?.[p.id] || state.screening?.[p.id])?.decision === 'include').length;
  const analysisStatus = state.analysis ? pooledInputStatus(state) : 'none';
  return {
    research_type: researchType(state).label,
    target_journals: (state.project?.journals || []).slice(0, 10).map(j => clipped(j, 180)),
    question: clipped(state.protocol?.title || state.paper?.title || '', 250),
    records: papers.length,
    included,
    accepted_cells: Object.keys(state.values || {}).length,
    pending_proposals: Object.keys(state.proposals || {}).length,
    notes: (state.notes || []).length + (state.projectNotes || []).length,
    searches: (state.searches || []).length,
    patients: (state.participants || []).length,
    appraised_studies: Object.keys(state.assessments || {}).length,
    certainty_outcomes: (state.grade || []).length,
    reporting_fields: Object.values(state.prisma || {}).filter(v => v !== '' && v != null).length,
    open_tasks: (state.todos || []).filter(t => !t.done).length,
    pooled_analysis: state.analysis ? analysisStatus === 'current'
      ? { status: 'current', measure: state.analysis.measure, estimate: state.analysis.estimate, lo: state.analysis.lo, hi: state.analysis.hi, k: state.analysis.k }
      : { status: analysisStatus } : null,
    manuscript_blocks: (state.manuscript?.blocks || []).length,
    saved_analyses: analysisRegistry(state),
    // where the paper went (the Submission page): the summary line and the last three journals with their status; a question about sending
    // the paper is answered from here, not by searching the library (owner, 2026-10-22: "did we send the paper" was answered "Lykos doesn't track submissions")
    submissions: submissionsBrief(state),
  };
}

export const PROJECT_SECTIONS = ['protocol', 'searches', 'library', 'screening', 'extraction', 'patient_data',
  'appraisal', 'analysis', 'certainty', 'manuscript', 'reporting', 'tasks', 'notes', 'workflows',
  'submissions', 'datasets', 'proposals', 'notifications'];

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isoDay = ms => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? new Date(Number(ms)).toISOString().slice(0, 10) : String(ms || '').slice(0, 10));

/**
 * Bounded, read-only pages of project state for questions the overview cannot
 * answer. `contract: false` leaves the workflow contract out of `workflows`,
 * so its rows are the saved workflows alone; `max` (at most 200) raises the
 * page size from 30 for a caller that keeps only a few fields of each row.
 */
export function readProjectSection(state, section, { offset = 0, limit = 20, max = 30, contract = true, today = localDay() } = {}) {
  if (!PROJECT_SECTIONS.includes(section)) throw new Error('unknown project section');
  offset = Number.isInteger(offset) ? Math.max(0, offset) : 0;
  limit = Number.isInteger(limit) ? Math.max(1, Math.min(Math.max(1, Math.min(200, Number(max) || 30)), limit)) : 20;
  const page=(rows,map)=>({section,total:rows.length,offset,items:rows.slice(offset,offset+limit).map(map)});
  // Slice before copying abstracts, runs or evidence. A page never formats
  // thousands of off-screen records merely to discard them afterwards.
  if(section==='library')return page(state.papers||[],p=>({id:p.id,label:p.label,title:p.title,authors:p.authors,year:p.year,journal:p.journal,doi:p.doi,language:p.language||p.lang||null,abstract:clipped(p.abstract,2200),pdf_attached:Boolean(p.pdf),pdf_name:p.pdfName||null}));
  if(section==='searches')return page(state.searches||[],r=>({source:r.source,query:r.query,at:r.at,total:r.total,retrieved:r.retrieved,status:r.status}));
  if(section==='manuscript')return page(state.manuscript?.blocks||[],b=>({id:b.id,type:b.type,text:clipText(b.text||(b.runs||[]).map(r=>r.t).join(''),2500)}));
  if(section==='extraction'){
    let total=0;const items=[];
    for(const [object,status] of [[state.values,'accepted'],[state.proposals,'unaccepted proposal']])for(const key in object||{}){
      if(status==='unaccepted proposal'&&!key.includes(':'))continue;
      const at=total++;if(at<offset||at>=offset+limit)continue;
      const v=object[key];items.push({key,status,value:status==='accepted'?v.reported_value:v.value,availability:v.availability,
        ...(status==='accepted'?{evidence:(v.evidence||[]).slice(0,3).map(e=>({kind:e.kind,doc_id:e.doc_id,page:e.page,quote:clipText(e.quote,300)}))}:{})});
    }
    return {section,total,offset,items};
  }
  if(section==='workflows'&&!contract)return page(state.workflows||[],f=>f);
  if(section==='submissions'){
    // The tracker as the person recorded it (lib/submissions.mjs): one row per journal, its events in one line, the last letter cut.
    const list=listForAssistant(state.submissions,today);
    return page(list.items,a=>{const letter=[...a.events].reverse().find(e=>e.letter)?.letter||'';
      return {id:a.id,journal:a.journal,status:a.status,elapsed_days:a.elapsed_days,chase_on:a.chase_on||'',manuscript_id:a.manuscript_id||'',file:a.file||'',
        events:a.events.map(e=>[e.word||e.kind,e.at,e.due?`due ${e.due}`:'',e.doi||''].filter(Boolean).join(' ')).join('; '),letter:clipText(letter,2000)};});
  }
  if(section==='datasets')return page(state.datasets||[],d=>({id:d.id,name:d.name,rows:(d.rows||[]).length,columns:(d.columns||[]).map(c=>c.label||c.id).join('; ').slice(0,600),
    source:[d.source?.file,d.source?.sheet].filter(Boolean).join(' / '),imported:String(d.source?.importedAt||d.at||'').slice(0,10)}));
  if(section==='proposals'){
    // The assistant's proposals waiting for a person (the ledger lib/aid.mjs keeps), newest first; accepting stays in the app.
    const ledger=[...(state.aiProposalLedger||[])].sort((a,b)=>(Number(b.at)||0)-(Number(a.at)||0));
    return page(ledger,e=>{const items=e.items||[],open=items.filter(i=>i.state==='open');
      return {id:e.id,view:e.view||'',title:e.title||'',by:e.meta||'',at:isoDay(e.at),open:open.length,items:items.length,first:clipText(open[0]?.label||items[0]?.label||'',200)};});
  }
  if(section==='notifications')return page(visibleNotifications(state),n=>({at:String(n.at||'').slice(0,16).replace('T',' '),title:notificationTitle(n),place:notificationPlace(n),tone:n.tone||'info',read:!!n.read,detail:clipText(n.detail,300)}));
  if(section==='workflows'){
    // The contract occupies only the first row, never repeated on later pages.
    // Do not construct it or copy off-page workflows just to discard them.
    const flows=state.workflows||[],items=[];
    if(offset===0){
      const settings=settingsOf(state),profiles=settings.models?.profiles?.length?settings.models.profiles:settings.ai?.provider?[{...settings.ai,id:'legacy',label:settings.ai.model||settings.ai.provider}]:[];
      items.push({...workflowContract(),customBlocks:state.workflowBlocks||[],
        models:profiles.map(p=>({id:p.id,label:p.label,model:p.model,provider:p.provider,kind:isJev(p)?'jev':'text'})),
        teams:(state.modelTeams||[]).map(t=>({id:t.id,name:t.name,leadProfileId:t.leadProfileId,members:(t.members||[]).map(m=>({id:m.id,role:m.role,profileId:m.profileId}))}))});
    }
    if(items.length<limit)items.push(...flows.slice(Math.max(0,offset-1),Math.max(0,offset-1)+limit-items.length));
    return {section,total:flows.length+1,offset,items};
  }
  const labels = new Map((state.papers || []).map(p => [p.id, p.label || p.title || p.id]));
  let rows;
  switch (section) {
    case 'protocol': rows = [{ title: state.protocol?.title || state.paper?.title || '',
      pico: state.protocol?.pico || {}, conventions: (state.templates||[]).slice(0,6).map(t=>({table:t.name,conventions:(t.conventions||[]).slice(0,8)})), criteria: state.protocol?.criteria || [],
      registration: state.paper?.registration || '', versions: (state.protocolVersions || []).map(v => ({ v: v.v, at: v.at, note: v.note })) }]; break;
    case 'screening': rows = (state.papers || []).filter(p => state.screening?.[p.id] || state.fulltext?.[p.id])
      .map(p => ({ paper_id: p.id, label: labels.get(p.id), title_abstract: state.screening?.[p.id] || null, full_text: state.fulltext?.[p.id] || null })); break;
    case 'patient_data': rows = (state.participants || []).map(p => ({ ...p, study: labels.get(p.study_id) || p.study_id })); break;
    case 'appraisal': rows = Object.entries(state.assessments || {}).map(([paper_id, judgements]) => ({ paper_id, label: labels.get(paper_id), instrument: state.appraisalTool || 'rob2', judgements })); break;
    case 'analysis': rows = analysisRegistry(state); break;
    case 'certainty': rows = state.grade || []; break;
    case 'reporting': rows = [
      ...Object.entries(state.prisma || {}).map(([id, value]) => ({ kind: 'prisma', id, value })),
      ...Object.entries(checklistStates(state)).map(([id, v]) => ({ kind: 'checklist', list: checklistOf(state).name, id, state: v.state, where: v.where }))]; break;
    case 'tasks': rows = state.todos || []; break;
    case 'notes': rows = [...(state.notes || []).map(n => ({ id: n.id, paper_id: n.paper, page: n.page, kind: n.kind, text: clipText(n.text, 1500) })), ...(state.projectNotes||[]).map(n=>({id:n.id,title:n.title,kind:'project_note',paper_id:n.paperId,text:clipText(n.text,4000),text_hash:hashText(n.text),truncated:n.text.length>4000,updated:n.updated}))]; break;
  }
  return { section, total: rows.length, offset, items: rows.slice(offset, offset + limit),
    ...(section === 'patient_data' ? { columns: state.ipdColumns?.length ? state.ipdColumns : DEFAULT_COLUMNS } : {}) };
}

const clipText = (value, limit) => String(value ?? '').slice(0, limit);

function visitMemory(state, paperId, visit) {
  const add = (kind, id, text, extra = {}) => { if (String(text || '').trim()) visit({ kind, id, text: clipped(text), ...extra }); };
  const p = state.protocol || {};
  add('protocol', 'question', [p.title, ...Object.entries(p.pico || {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join('; '));
  for (const c of p.criteria || []) add('criterion', String(c.id), c.text, { stage: c.stage });
  const index=projectIndex(state),papers=index.papers;
  for (const paper of (paperId ? [papers.get(paperId)].filter(Boolean) : papers.values())) {
    if (paperId && paper.id !== paperId) continue;
    add('paper', String(paper.id), [paper.title, paper.label, paper.year, paper.doi, paper.language || paper.lang, paper.journal].filter(Boolean).join('; '), { paper_id: paper.id });
    for (const [stage, decisions] of [['title_abstract', state.screening], ['full_text', state.fulltext]]) {
      const d = decisions?.[paper.id];
      if (d?.decision) add('screening_decision', `${paper.id}:${stage}`, `${paper.label || paper.id}; ${stage}: ${d.decision}${d.reason ? `; reason ${d.reason}` : ''}`, { paper_id: paper.id });
    }
  }
  for (const [key, v] of (paperId ? index.values.get(paperId)||[] : Object.entries(state.values||{}))) {
    let cut=key.lastIndexOf(':');while(cut>=0&&!papers.has(key.slice(0,cut)))cut=cut===0?-1:key.lastIndexOf(':',cut-1);if(cut<0)continue;
    const id = key.slice(0, cut), column = key.slice(cut + 1);
    if (!papers.has(id) || (paperId && id !== paperId)) continue;
    const evidence = (v.evidence || []).filter(e => e.kind === 'text' && e.quote).slice(0, 2)
      .map(e => `[${e.doc_id || id} p.${e.page} "${clipped(e.quote, 220).replaceAll('"', "'")}"]`).join(' ');
    add('accepted_cell', key, `${papers.get(id).label || id}; ${column}: ${v.reported_value ?? ''}; ${v.availability || ''}${evidence ? `; evidence ${evidence}` : ''}`,
      { paper_id: id, column_id: column, locator: (v.evidence || []).find(e => e.kind === 'text' && e.doc_id && e.page) || null });
  }
  for (const n of (paperId ? index.notes.get(paperId)||[] : state.notes||[])) {
    if (paperId && n.paper !== paperId) continue;
    if (n.paper && !papers.has(n.paper)) continue;
    add('note', String(n.id), `${n.kind || 'comment'}; ${clipped(n.text, 400)}`, { paper_id: n.paper, page: n.page });
  }
  for(const n of state.projectNotes||[]) {
    if(paperId && n.paperId!==paperId)continue;
    add('project_note',String(n.id),`${n.title||''}; ${clipped(n.text,1500)}`,{paper_id:n.paperId});
  }
  if (!paperId) {
    const a = state.analysis;
    const analysisStatus = a ? pooledInputStatus(state) : 'none';
    if (a && analysisStatus === 'current') add('analysis', 'pooled', `${a.measure || 'effect'}; estimate ${a.estimate}; CI ${a.lo} to ${a.hi}; k ${a.k}; I² ${a.i2}; method ${a.method || ''}`);
    else if (a) add('analysis_status', 'pooled', `Pooled analysis ${analysisStatus}; inspect accepted inputs before using the result`);
    for (const b of state.manuscript?.blocks || []) add('manuscript_draft', String(b.id), b.text || (b.runs || []).map(r => r.t).join(''));
  }
}

export function memoryEntries(state, { paperId = null } = {}) {
  const out = [];
  visitMemory(state, paperId, e => out.push(e));
  return out;
}

export function searchProject(state, query, { paperId = null, limit = 12 } = {}) {
  return rank(visit => visitMemory(state, paperId, visit), query, limit);
}
/** searchProject over entries listed once (memoryEntries), for a caller that searches the same state many times. */
export const searchEntries = (entries, query, { limit = 12 } = {}) => rank(visit => entries.forEach(visit), query, limit);

function rank(each, query, limit) {
  const terms = words(query).slice(0, 16);
  if (!terms.length) return [];
  const variants = terms.map(forms);   // each word, its Turkish or English stem and the app's name for it, worth a little less (lib/search-smart.mjs)
  const cap = Math.max(1, Math.min(20, limit));
  const pass = near => {
    const best = [];
    let order = 0;
    each(e => {
      const hay = foldSearch(`${e.kind} ${e.id} ${e.text}`);
      let sum = 0, hits = 0, hayWords = null;
      for (const fs of variants) {
        let w = 0;
        for (const f of fs) if (hay.includes(f.t)) { w = Math.max(w, f.w); if (w === 1) break; }
        if (!w && near && slip(fs[0].t)) { hayWords ||= hay.split(/[^a-z0-9]+/); if (hayWords.some(h => near(fs[0].t, h, slip(fs[0].t)))) w = 0.5; }
        if (w) { sum += w; hits++; }
      }
      if (!hits) { order++; return; }
      const row = { e, order: order++, score: sum / terms.length + (hits === terms.length ? 1 : 0) };
      if (best.length === cap && row.score <= best.at(-1).score) return;
      const at = best.findIndex(x => row.score > x.score);
      best.splice(at < 0 ? best.length : at, 0, row);
      if (best.length > cap) best.pop();
    });
    return best.map(x => x.e);
  };
  const found = pass(null);
  return found.length ? found : pass(near);   // a typing slip is looked for only when nothing matched as typed
}
