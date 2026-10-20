import { DEFAULT_KEEP_RUNS } from './project-trim.mjs';
import { outputRecords, setOutputRecords, researchSnapshot } from './flow-records.mjs';
import { acquireSearch } from './search-acquisition.mjs';
import { runModelTeam, validateTeam, modelTeams } from './model-teams.mjs';
import { runAgentStep, AGENT_TOOLS, acquireAgentSlot } from './flow-agent.mjs';
import { fetchWorkflowRecords, jsonEndpoint, jsonField } from './flow-http.mjs';
import { routedInput } from './flow-routing.mjs';
import { resolveFlowText, flowTextValues } from './flow-text.mjs';
import { FLOW_LIMITS } from './flow-limits.mjs';
import { scheduleGraph } from './flow-scheduler.mjs';
import { RESEARCH_TYPES, prepareResearch, commitResearch, assertResearchFresh, dualReviewReady } from './flow-research.mjs';
import { isJev } from './jev.mjs';
import { graphFlow, graphOrder, mergeRecords } from './flow-graph.mjs';
import { get, update, projects, subscribe, projectGeneration } from '../store.mjs';
import { run as job } from './jobs.mjs';
import { notify } from './notifications.mjs';
import { SOURCES, zoteroItems, lookupDoi, fetchAbstract } from './sources.mjs';
import { BLOCKS, FIELD_OPTIONS, FIELD_SCHEMAS, filterRecords, uniqueRecords, sortFlowRecords, exportFlowRecords } from './flow-blocks.mjs';
import { libraryIndex, addSearchRecords } from './search-library.mjs';
import { addFileNote } from './file-notes.mjs';
import { SITES, exportRecords, siteLogEntry } from './site-search.mjs';
// Web of Science and Scopus run in the person's own signed-in session (plan 4.10a), so
// a workflow block for them waits for that person and continues with the export file.
const siteOf = id => SITES.find(s => s.id === id) || null;
export { BLOCKS } from './flow-blocks.mjs';
import { configured } from './ai.mjs';

export { cronFields, cronMatches } from './flow-cron.mjs';
import { cronFields, cronMatches, dueCronSlot } from './flow-cron.mjs';
import { appendNodeLog } from './flow-inspection.mjs';
import { ensureVersion, nextRunNumber, rerunPlan, WRITE_BLOCKS } from './flow-versions.mjs';
import { settingsOf } from './app-settings.mjs';

/** Provider failures (provider-error.mjs) that are a connection or a busy server, not a wrong key, address or model: worth the configured retries. */
const TRANSIENT_KINDS = new Set(['unreachable', 'timeout', 'local-down', 'cors-or-down', 'blocked-or-down', 'server', 'rate-limit']);
export function validateFlow(flow, {draft=false}={}) {
  if(!flow || typeof flow.name!=='string' || !flow.name.trim())throw new Error('Name the workflow.');
  if(flow.concurrency!=null&&(!Number.isInteger(Number(flow.concurrency))||Number(flow.concurrency)<1||Number(flow.concurrency)>8))throw new Error('Parallel limit must be between 1 and 8.');
  if(flow.keepRuns!=null&&![10,25,50,100].includes(Number(flow.keepRuns)))throw new Error('Choose a supported run history limit.');
  if(flow.maxAgentConcurrency!=null&&(!Number.isInteger(Number(flow.maxAgentConcurrency))||Number(flow.maxAgentConcurrency)<1||Number(flow.maxAgentConcurrency)>16))throw new Error('Parallel agent calls must be between 1 and 16.');
  if(flow.maxAgentCalls!=null&&(!Number.isInteger(Number(flow.maxAgentCalls))||Number(flow.maxAgentCalls)<1||Number(flow.maxAgentCalls)>10000))throw new Error('Agent call limit must be between 1 and 10,000.');
  if(flow.enabled&&!flow.cron)throw new Error('Enter a schedule before enabling it.');
  if(flow.catchUp!=null&&!['skip','latest'].includes(flow.catchUp))throw new Error('Choose Skip or Latest on reopening for missed occurrences.');
  if(!Array.isArray(flow.blocks)||!flow.blocks.length||flow.blocks.length>FLOW_LIMITS.blocks)throw new Error(`Add between 1 and ${FLOW_LIMITS.blocks} blocks.`);
  if(flow.edges?.length>FLOW_LIMITS.edges)throw new Error(`Use at most ${FLOW_LIMITS.edges} connections.`);
  if(draft&&!flow.enabled){if(flow.blocks.some(b=>!BLOCKS.some(d=>d.id===b?.type)))throw new Error('Unknown workflow block.');graphOrder(flow,{allowDisconnected:true});return flow;}
  for(const b of flow.blocks){if(!b || !BLOCKS.some(x=>x.id===b.type))throw new Error('Unknown workflow block.');if(b.executor&&!['automatic','ai','human'].includes(b.executor))throw new Error('Choose Automatic, AI model, or Person for each task.');if(b.type==='search'&&!['ai','human'].includes(b.executor)&&!b.query?.trim())throw new Error('Enter the search or filter query.');if(['todo','notify','note'].includes(b.type)&&!['ai','human'].includes(b.executor)&&!b.text?.trim())throw new Error('Enter the task or notification text.');}
  for(const b of flow.blocks){if(b.type==='team'&&(!b.teamId||!String(b.instructions||'').trim()))throw new Error('Choose a team and describe its assignment.');if(b.type==='task'&&!String(b.instructions||'').trim())throw new Error('Describe what the AI or person should do.');if(b.type==='task'&&!['ai','human'].includes(b.executor))throw new Error('Assign the custom task to a person or AI model.');if(b.executor==='ai'&&!String(b.instructions||b.query||b.text||'').trim())throw new Error('Give the AI an instruction for this task.');if(b.executor==='ai'&&!b.modelId)throw new Error('Choose a model for each AI step.');}
  for(const [blockIndex,b] of flow.blocks.entries()){
    const invalidChoice = (field, values) => new Error(`Invalid blocks[${blockIndex}].${field} in block ${JSON.stringify(b.id || b.type)}: ${JSON.stringify(b[field]).slice(0,120)} is not supported. Use ${values.map(v=>JSON.stringify(v)).join(', ')}.`);
    if(b.tools&&(!Array.isArray(b.tools)||b.tools.some(t=>!AGENT_TOOLS.some(([id])=>id===t))))throw new Error('Unknown agent tool.');
    if(b.maxToolCalls!=null&&(!Number.isInteger(Number(b.maxToolCalls))||Number(b.maxToolCalls)<0||Number(b.maxToolCalls)>5))throw new Error('Tool-call limit must be between 0 and 5.');
    if(b.type==='http'){
      jsonEndpoint(b.url);if(!Number.isInteger(Number(b.pages??1))||Number(b.pages??1)<1||Number(b.pages??1)>10)throw new Error('Use 1–10 JSON pages.');
      for(const field of ['itemsPath','titlePath','idPath','abstractPath','yearPath'])jsonField({},b[field]||'');
    }
    if(['subworkflow','batch'].includes(b.type)&&!b.workflowId)throw new Error('Choose a workflow to run.');
    if(b.type==='batch'&&(!Number.isInteger(Number(b.batchSize??10))||Number(b.batchSize??10)<1||Number(b.batchSize??10)>100))throw new Error('Batch size must be between 1 and 100.');
    if(b.type==='wait'&&(!Number.isFinite(Number(b.waitSeconds??5))||Number(b.waitSeconds??5)<1||Number(b.waitSeconds??5)>3600))throw new Error('Wait must be between 1 and 3600 seconds.');
    if(b.onError&&!['stop','continue'].includes(b.onError))throw new Error('Choose a supported error policy.');
    if(b.retries!=null&&(!Number.isInteger(Number(b.retries))||Number(b.retries)<0||Number(b.retries)>3))throw new Error('Retries must be between 0 and 3.');
    if(b.type==='search'&&b.source&&!FIELD_SCHEMAS.source.enum.includes(b.source))throw invalidChoice('source',FIELD_SCHEMAS.source.enum);
    if(b.type==='search'&&siteOf(b.source)&&b.executor&&b.executor!=='automatic')throw new Error(`${siteOf(b.source).name} is searched by a person in their own session; leave it Automatic.`);
    if(b.type==='search'&&b.maxRecords!=null&&(!Number.isInteger(Number(b.maxRecords))||Number(b.maxRecords)<1||Number(b.maxRecords)>100000))throw new Error('Retrieval ceiling must be between 1 and 100,000.');
    if(['search','zotero','limit'].includes(b.type)&&b.limit!=null&&(!Number.isInteger(Number(b.limit))||Number(b.limit)<1||Number(b.limit)>100))throw new Error('Record limit must be between 1 and 100.');
    const def=BLOCKS.find(d=>d.id===b.type);if(!def)throw new Error(`Unknown block type "${b.type}".`);
    for(const f of def.fields)if(FIELD_OPTIONS[f]&&b[f]!=null&&!FIELD_OPTIONS[f].some(([v])=>v===b[f]))throw invalidChoice(f,FIELD_OPTIONS[f].map(([v])=>v));
    if(['filter','condition'].includes(b.type)){
      for(const f of ['yearFrom','yearTo'])if(b[f]!==''&&b[f]!=null&&(!Number.isInteger(Number(b[f]))||Number(b[f])<1000||Number(b[f])>9999))throw new Error('Use a four-digit year.');
      if(b.yearFrom&&b.yearTo&&Number(b.yearFrom)>Number(b.yearTo))throw new Error('From year must precede through year.');
    }
  }
  for(const b of flow.blocks) {
    const def=BLOCKS.find(d=>d.id===b.type);
    if((RESEARCH_TYPES.has(b.type)||['merge','condition','input','output','subworkflow','batch','wait','http'].includes(b.type))&&b.executor&&b.executor!=='automatic')throw new Error('Research blocks use their built-in executor.');
    if(def.model&&!b.modelId)throw new Error(`Choose a model for ${def.label}.`);
    if(b.type==='criteria'&&!String(b.text||'').trim())throw new Error('Enter protocol criteria to structure.');
  }
  if(flow.cron)cronFields(flow.cron);
  const plan=graphOrder(flow);
  for(const b of plan.blocks)if(['note','todo','notify'].includes(b.type)&&!['ai','human'].includes(b.executor)&&flowTextValues(b.text).some(v=>v.key==='output')&&!plan.incoming.get(b.id).length)throw new Error('Connect a previous step to use its output.');
  for(const b of plan.blocks)if(b.type==='consensus') {
    const inputs=plan.incoming.get(b.id).map(id=>plan.blocks.find(n=>n.id===id));
    if(inputs.length!==3||inputs.some(n=>n.type!=='screen_pass')||new Set(inputs.map(n=>String(n.passNumber||'1'))).size!==3)throw new Error('Connect three distinct screening passes directly to consensus.');
  }
  return flow;
}
const active = new Set();
const stamp = () => new Date().toISOString();
const modelProfile = id => {
  const settings = settingsOf(get()), profile = settings.models?.profiles?.find(p => p.id === id);
  return profile || (id === 'legacy' ? settings.ai : null);
};
export function workflowModels() {
  const s = settingsOf(get());
  return s.models?.profiles?.length ? s.models.profiles : s.ai?.provider ? [{...s.ai,id:'legacy',label:s.ai.model || s.ai.provider}] : [];
}
async function lockFlow(id, fn) {
  if (globalThis.navigator?.locks) return navigator.locks.request(`lykos-flow:${projects().current}:${id}`, {ifAvailable:true}, lock => {
    if (!lock) throw new Error('This workflow is running in another window.'); return fn();
  });
  return fn();
}
function checkModels(flow) {
  for (const b of flow.blocks) { if(b.type==='team')validateTeam(modelTeams().find(t=>t.id===b.teamId),workflowModels()); const def=BLOCKS.find(d=>d.id===b.type),cfg=modelProfile(b.modelId);if(b.executor==='ai'&&isJev(cfg))throw new Error('Choose a text model for agent tasks.');if((b.executor==='ai'||def.model)&&!configured(cfg))throw new Error('Configure the selected AI model in Settings first.');if(def.model && (def.model==='jev')!==isJev(cfg))throw new Error(`Choose a ${def.model==='jev'?'Jev decision':'text'} model for ${def.label}.`); }
}
export function workflowDefinitions(flow, saved, path=[], budget={nodes:0}) {
  budget.nodes+=flow.blocks.length;if(budget.nodes>10000)throw new Error('Called workflows exceed 10,000 planned blocks.');
  if(path.includes(flow.id))throw new Error('Workflows cannot call themselves, directly or indirectly.');
  if(path.length>=5)throw new Error('Use at most five nested workflow levels.');
  const definitions={};
  for(const block of flow.blocks.filter(b=>['subworkflow','batch'].includes(b.type))) {
    const original=saved.find(f=>f.id===block.workflowId);if(!original)throw new Error('A called workflow was removed.');
    const target=graphFlow(structuredClone(original));target.enabled=false;validateFlow(target);
    if(target.blocks.filter(b=>b.type==='input').length!==1||target.blocks.filter(b=>b.type==='output').length!==1)throw new Error(`${target.name} needs one Workflow input and one Workflow output block.`);
    definitions[target.id]=target;Object.assign(definitions,workflowDefinitions(target,saved,[...path,flow.id],budget));
  }
  return definitions;
}
export function retainWorkflowRuns(runs,flowId,keep=100) {
  let count=0;const removed=new Set();
  for(const r of runs)if(r.flowId===flowId&&!r.parentRunId&&!['running','waiting'].includes(r.status)&&++count>keep)removed.add(r.id);
  return runs.filter(r=>!removed.has(r.id)&&!removed.has(r.rootRunId));
}
function makeRun(flow, extras={}) {
  return {id:crypto.randomUUID(),flowId:flow.id,name:flow.name,flow,at:stamp(),status:'running',engineVersion:2,teamSnapshots:structuredClone(modelTeams()),steps:[],outputs:{},recordPool:{},texts:{},payloads:{},nodeStates:{},nodeDetails:{},pendingNodes:{},approvals:{},children:{},next:0,...extras};
}
const starter = () => settingsOf(get()).reviewerName || 'You';
/** trigger: 'manual' | 'schedule' | 'assistant'. The run records its number and the version it ran. */
export async function runFlow(id, {trigger='manual'}={}) {
  return lockFlow(id, async () => {
    const saved = get().workflows?.find(f => f.id === id); if (!saved) throw new Error('Workflow not found.');
    // A run this workflow makes when another calls it (parentRunId) belongs to the caller, not to it.
    if ((get().workflowRuns || []).some(r => r.flowId === id && !r.parentRunId && ['running','waiting'].includes(r.status))) throw new Error('Finish or stop the current run before starting another.');
    const flow = graphFlow(structuredClone(saved)); validateFlow(flow);
    const definitions=workflowDefinitions(flow,get().workflows||[]);
    for(const target of [flow,...Object.values(definitions)])checkModels(target);
    const run = makeRun(flow,{definitions,trigger,by:trigger==='schedule'?'Schedule':starter(),number:nextRunNumber(get().workflowRuns,id)});
    update(s => { run.version=ensureVersion(s,saved,starter()); s.workflowRuns = retainWorkflowRuns([run,...(s.workflowRuns || [])],id,Number(flow.keepRuns||DEFAULT_KEEP_RUNS)); return s; });
    return executeRun(run.id);
  });
}
/**
 * Run a finished run's workflow snapshot again as a new run. Blocks upstream of
 * `from` that settled keep their earlier output (rerunPlan); with no `from`,
 * only the blocks that did not finish run again.
 */
export async function rerunFlow(runId, {from=[], all=false}={}) {
  const old=get().workflowRuns?.find(r=>r.id===runId);
  if(!old||old.parentRunId)throw new Error('Choose a workflow run.');
  if(old.imported)throw new Error('Imported history is kept as recorded. Run the workflow to start a new run.');
  if(['running','waiting'].includes(old.status))throw new Error('Finish or stop this run first.');
  return lockFlow(old.flowId,async()=>{
    if(active.has(old.flowId)||(get().workflowRuns||[]).some(r=>r.flowId===old.flowId&&!r.parentRunId&&['running','waiting'].includes(r.status)))throw new Error('Finish or stop the current run before starting another.');
    const flow=graphFlow(structuredClone(old.flow));flow.enabled=false;validateFlow(flow);
    const definitions=old.definitions||workflowDefinitions(flow,get().workflows||[]);
    for(const target of [flow,...Object.values(definitions)])checkModels(target);
    const plan=all?{keep:[],rerun:flow.blocks.map(b=>b.id)}:rerunPlan(old,from);
    if(!plan.rerun.length)throw new Error('Every block of this run finished. Choose a block to run again.');
    const run=makeRun(flow,{definitions,trigger:'rerun',by:starter(),rerunOf:old.id,version:old.version,number:nextRunNumber(get().workflowRuns,old.flowId)});
    for(const id of plan.keep){
      run.nodeStates[id]=old.nodeStates[id];setOutputRecords(run,id,outputRecords(old,id));run.texts[id]=old.texts?.[id]||'';
      if(old.payloads?.[id])run.payloads[id]=old.payloads[id];
      run.nodeDetails[id]={...(old.nodeDetails?.[id]||{}),reused:true};
      run.steps.push(...(old.steps||[]).filter(step=>step.nodeId===id));
    }
    update(s=>{s.workflowRuns=retainWorkflowRuns([run,...(s.workflowRuns||[])],old.flowId,Number(flow.keepRuns||DEFAULT_KEEP_RUNS));const r=s.workflowRuns.find(r=>r.id===run.id);for(const id of plan.keep)appendNodeLog(r,id,'reused',`Output kept from an earlier run`);return s;});
    return executeRun(run.id);
  });
}
/**
 * The checks a workflow must pass before it can run, each with the reason it
 * fails. A reason already given by an earlier check is not repeated.
 */
export function preflight(flow) {
  const attempt=fn=>{try{fn();return '';}catch(error){return error.message;}};
  const f=graphFlow(structuredClone(flow||{}));f.enabled=false;
  const checks=[
    ['Named',()=>{if(!String(f.name||'').trim())throw new Error('Name the workflow.');}],
    ['Blocks connected',()=>{if(!f.blocks.length)throw new Error('Add a block.');graphOrder(f);}],
    ['Settings complete',()=>validateFlow(f)],
    ['Models configured',()=>checkModels(f)],
    ...(f.blocks.some(b=>['subworkflow','batch'].includes(b.type))?[['Called workflows ready',()=>workflowDefinitions(f,get().workflows||[])]]:[]),
    ...(flow?.cron?[['Schedule valid',()=>cronFields(flow.cron)]]:[]),
  ];
  const seen=new Set();
  return checks.map(([label,fn])=>{const error=attempt(fn);const repeat=error&&seen.has(error);if(error)seen.add(error);return {label,ok:!error,blocked:repeat,error:repeat?'':error};});
}
export async function resumeFlow(runId, opts={}) {
  const run = get().workflowRuns?.find(r => r.id === runId);
  if (!run || run.status !== 'waiting') throw new Error('This run is not waiting for review.');
  // A called workflow's run waits inside its caller's run and is resumed through it.
  if (run.parentRunId && !delegating.has(runId)) throw new Error('Resume this review from the workflow that called it.');
  return resumeRun(runId, run, opts);
}
const delegating = new Set();   // child runs a parent is resuming right now
async function resumeRun(runId, run, {nodeId,approve=true,text,recordIds,query,files}={}) {
  return lockFlow(run.flow.id, async () => {
    if(active.has(run.flow.id)||run.status!=='waiting')throw new Error('This run is already continuing.');
    const pending = nodeId ? run.pendingNodes?.[nodeId] : run.pending;
    if (!pending) throw new Error('Choose a waiting block.');
    if (!approve) {stopFlow(runId);return {status:'cancelled'};}
    if(pending.delegateRunId){
      delegating.add(pending.delegateRunId);
      try { await resumeFlow(pending.delegateRunId,{nodeId:pending.delegateNodeId,approve,text,recordIds,query,files}); }
      finally { delegating.delete(pending.delegateRunId); }
      update(s=>{const run=s.workflowRuns.find(r=>r.id===runId);if(run)run.status='running';return s;});
      return executeRun(runId);
    }
    const pendingBlock=run.flow.blocks.find(b=>b.id===pending.nodeId);
    if(pending.kind==='human'&&['task','todo','notify','note'].includes(pendingBlock.type)&&!String(text||'').trim())throw new Error('Enter the completed result before continuing.');
    if(pending.kind==='human'&&pendingBlock.type==='search'&&!String(query||'').trim())throw new Error('Enter the search query before continuing.');
    let records=pending.records;
    if(pending.kind==='dual_review') {
      assertResearchFresh(get(),pending.payload);
      if(dualReviewReady(get(),records,pendingBlock.stage).pending.length)throw new Error('Complete both reviews and resolve conflicts in Screening before continuing.');
    }
    if(pending.kind==='criteria'&&text!==undefined&&text!==pending.text)throw new Error('Criteria preview is read-only. Stop this run to revise the source criteria.');
    let searchLog=null;
    if (pending.kind==='site') {
      // the export file of the person's own search is the block's output and its search-log entry
      const site=siteOf(pending.site), given=(files||[]).filter(f=>String(f?.text||'').trim());
      if(!given.length)throw new Error(`Add the ${site.name} export file before continuing.`);
      records=given.flatMap(f=>exportRecords(site,f.text).records);
      if(!records.length)throw new Error('The export file has no records.');
      searchLog={...siteLogEntry({site,query:pending.query,at:stamp(),total:records.length,retrieved:records.length,files:given}),sourceId:site.id,workflow:run.flowId};
    } else if (recordIds) { const allowed=new Set(records.map(r=>r.id||r.key));if(recordIds.some(id=>!allowed.has(id)))throw new Error('The selection contains an unknown record.');records=records.filter(r=>recordIds.includes(r.id||r.key)); }
    const approval={records,query,text: text ?? pending.text ?? '',at:stamp(),reviewer:settingsOf(get()).reviewerName||'You',...(searchLog?{searchLog}:{})};
    update(s=>{const r=s.workflowRuns.find(r=>r.id===runId);appendNodeLog(r,pending.nodeId,'approval','Approved by '+approval.reviewer);(r.approvals||={})[pending.nodeId]=approval;r.status='running';(r.nodeStates||={})[pending.nodeId]='queued';return s;});
    return executeRun(runId);
  });
}
export async function retryFlow(runId) {
  const run=get().workflowRuns?.find(r=>r.id===runId);
  if(!run||run.status!=='failed')throw new Error('Choose a failed run.');
  if(run.engineVersion!==2)throw new Error('This older run has no recovery checkpoints. Start a new run.');
  return lockFlow(run.flow.id,async()=>{
    if(active.has(run.flow.id))throw new Error('This workflow is still running.');
    if(get().workflowRuns.some(r=>r.id!==runId&&r.flowId===run.flowId&&!r.parentRunId&&['running','waiting'].includes(r.status)))throw new Error('Finish the current run first.');
    update(s=>{const r=s.workflowRuns.find(r=>r.id===runId);r.status='running';r.error=null;r.endedAt=null;r.cancelRequested=false;for(const id of Object.keys(r.nodeStates))if(['failed','running','cancelled'].includes(r.nodeStates[id]))r.nodeStates[id]='queued';return s;});
    return executeRun(runId);
  });
}
export function stopFlow(runId) {
  update(s=>{const ids=new Set([runId]);let changed=true;while(changed){changed=false;for(const r of s.workflowRuns||[])if(ids.has(r.parentRunId)&&!ids.has(r.id)){ids.add(r.id);changed=true;}}
    for(const r of s.workflowRuns||[])if(ids.has(r.id)&&['running','waiting'].includes(r.status)){r.cancelRequested=true;if(r.status==='waiting'){r.status='cancelled';r.endedAt=stamp();for(const id of Object.keys(r.pendingNodes||{})){r.nodeStates[id]='cancelled';appendNodeLog(r,id,'cancelled','Stopped');}r.pending=null;}}return s;
  });
}
function syncPending(run) { run.pending=Object.values(run.pendingNodes||{})[0]||null; }
async function executeRun(runId, ancestorStopped=()=>false) {
  const run=get().workflowRuns.find(r=>r.id===runId), flow=run.flow, identity=get().project, generation=projectGeneration();
  if(active.has(flow.id))throw new Error('This workflow is already running.');
  const controller=new AbortController(); let handle=null;
  const unwatch=subscribe(()=>{if(projectGeneration()!==generation||get().project!==identity||run.cancelRequested||ancestorStopped()||handle?.stopped())controller.abort();});
  active.add(flow.id);
  const same=()=>{if(projectGeneration()!==generation||get().project!==identity)throw new Error('Project changed; workflow stopped.');};
  const patch=fn=>{same();update(s=>{const r=s.workflowRuns.find(r=>r.id===runId),before={...r.nodeStates};fn(r);for(const [id,state] of Object.entries(r.nodeStates||{}))if(before[id]!==state)appendNodeLog(r,id,state,({running:'Started',waiting:'Waiting for review',skipped:'No active input',retrying:'Retry scheduled',failed:r.nodeDetails[id]?.error,cancelled:'Stopped',error:'Continuing on error output'})[state]||state);return s;});};
  try { return await job('workflow',flow.name,async h=>{
    handle=h;
    const plan=graphOrder(flow);
    // Upgrade waiting legacy runs without replaying their completed steps.
    run.pendingNodes ||= run.pending ? {[run.pending.nodeId]:run.pending} : {};
    run.approvals ||= {};run.nodeDetails ||= {};run.nodeStates ||= {};
    for(const step of run.steps)run.nodeStates[step.nodeId]=step.status||'done';
    for(const b of flow.blocks)if(['subworkflow','batch'].includes(b.type)&&run.nodeStates[b.id]==='waiting')run.nodeStates[b.id]='queued';
    if(run.approval&&run.pending)run.approvals[run.pending.nodeId]=run.approval;
    const stopped=()=>controller.signal.aborted||h.stopped()||run.cancelRequested||ancestorStopped();
    const executeNode=async block=>{
      const index=plan.blocks.findIndex(b=>b.id===block.id), pending=run.pendingNodes[block.id];
      const started=Date.now();
      const progress=message=>{h.progress(message);patch(r=>appendNodeLog(r,block.id,'progress',message));};
      try {
      same();if(stopped())throw new Error('Workflow stopped.');progress(BLOCKS.find(b=>b.id===block.type).label);
      const edges=flow.edges.filter(e=>e.to===block.id),inputs=edges.map(e=>routedInput(flow,run,e));
      if(edges.length&&!inputs.some(i=>i.active)){patch(r=>{r.nodeStates[block.id]='skipped';r.outputs[block.id]=[];r.texts[block.id]='';r.steps.push({nodeId:block.id,type:block.type,status:'skipped',count:0,at:stamp()});});return;}
      const parents=edges.filter((e,i)=>inputs[i].active).map(e=>e.from);let records=mergeRecords(inputs.filter(i=>i.active).map(i=>i.records)),output=inputs.filter(i=>i.active).map(i=>i.text).filter(Boolean).join('\n\n');
      patch(r=>{r.nodeStates[block.id]='running';r.nodeDetails[block.id]={attempts:(r.nodeDetails[block.id]?.attempts||0)+1,startedAt:stamp(),inputCount:records.length,waitUntil:r.nodeDetails[block.id]?.waitUntil,tools:r.nodeDetails[block.id]?.tools||[],error:null};});
      let checked=null, query=block.query, assignedText=false, artifact=null, researchPayload=null, searchLog=null;
      const payloads=parents.map(id=>run.payloads?.[id]).filter(Boolean);
      const approval=run.approvals[block.id];
      const humanCompletion=approval&&pending.kind==='human';
      if(approval){researchPayload=pending.payload;artifact=pending.artifact;searchLog=approval.searchLog||pending.searchLog;records=approval.records;output=approval.text;query=approval.query||query;checked={at:approval.at,reviewer:approval.reviewer};assignedText=!!pending.resolvedText||['ai','human'].includes(block.executor);}
      else {
        if(block.type==='input'){records=structuredClone(run.input?.records||[]);output=run.input?.text||'';}
        if(block.type==='library'){
          const collection=block.collection?get().collections?.find(c=>c.id===block.collection):null;
          if(block.collection&&!collection)throw new Error('The source collection was removed.');
          const members=collection?new Set(collection.members||[]):null;
          records=structuredClone((get().papers||[]).filter(p=>!members||members.has(p.id)));
        }
        if(block.type==='team') {
          const root=get().workflowRuns.find(r=>r.id===(run.rootRunId||run.id));
          const team=root.teamSnapshots?.find(t=>t.id===block.teamId);
          if(!team)throw new Error('This run has no saved team configuration. Start a new run.');
          const controller=new AbortController();
          const unwatch=subscribe(()=>{if(get().project!==identity||stopped())controller.abort();});
          let answer;
          try { answer=await runModelTeam({team,profiles:workflowModels(),text:block.instructions,scope:{kind:'project'},thread:{id:`workflow:${runId}:${block.id}`,messages:[]},
            context:JSON.stringify({records:records.slice(0,100).map(r=>({id:r.id||r.key,title:r.title,abstract:r.abstract})),totalRecords:records.length,previousOutput:output}).slice(0,60000),draftsOnly:true,signal:controller.signal,budget:{calls:40,tokens:150000},
            beforeModel:async()=>{const release=await acquireAgentSlot(root.id,Number(root.flow.maxAgentConcurrency||4),()=>{same();if(stopped())throw new Error('Workflow stopped.');});try{same();if(stopped())throw new Error('Workflow stopped.');if((root.agentCalls||0)>=Number(root.flow.maxAgentCalls||1000))throw new Error('Workflow agent-call limit reached.');patch(()=>{root.agentCalls=(root.agentCalls||0)+1;appendNodeLog(run,block.id,'model','Team model call started');});return release;}catch(error){release();throw error;}},
            onAgent:agents=>{if(get().project===identity&&!stopped())patch(r=>{r.nodeDetails[block.id].agents=structuredClone(agents);});},
            onStep:entry=>{if(get().project===identity&&!stopped())patch(r=>{(r.nodeDetails[block.id].tools||=[]).push({...entry,at:stamp()});});}
          }); } finally {unwatch();controller.abort();}
          same();if(stopped())throw new Error('Workflow stopped.');
          output=answer.text;researchPayload={kind:'model_team',teamId:team.id,agents:answer.agents,blocks:answer.blocks||[],cites:answer.cites,usage:answer.usage,metrics:answer.metrics};
          artifact={name:'team-findings.json',type:'application/json',text:JSON.stringify({team:team.name,...researchPayload,answer:output},null,2)};
          patch(r=>{r.nodeStates[block.id]='waiting';r.pendingNodes[block.id]={nodeId:block.id,kind:'human',instructions:'Review the coordinated answer and team findings before continuing.',records,text:output,payload:researchPayload,artifact,resolvedText:true};syncPending(r);});
          return {status:'waiting',runId,nodeId:block.id,count:records.length};
        }
        if(block.executor==='human') {
          const text=['todo','notify','note'].includes(block.type)?resolveFlowText(block.text,{count:records.length,output}):output;
          patch(r=>{(r.nodeStates||={})[block.id]='waiting';r.pendingNodes[block.id]={nodeId:block.id,kind:'human',instructions:block.instructions||BLOCKS.find(b=>b.id===block.type).description,records,text,query};syncPending(r);});
          return {status:'waiting',runId,nodeId:block.id,count:records.length};
        }
        if(block.executor==='ai') {
          const cfg=modelProfile(block.modelId);if(isJev(cfg))throw new Error('Choose a text model for agent tasks.');if(!configured(cfg))throw new Error('The model for this task is no longer configured.');
          const previousOutputs=parents.map(id=>({nodeId:id,label:flow.blocks.find(b=>b.id===id)?.label||id,text:run.texts[id]||'',recordIds:outputRecords(run,id).map(r=>r.id||r.key)}));
          const root=get().workflowRuns.find(r=>r.id===(run.rootRunId||run.id));
          const parsed=await runAgentStep({block,records,output,previousOutputs,cfg,signal:controller.signal,settings:settingsOf(get()),check:()=>{same();if(stopped())throw new Error('Workflow stopped.');},
            onCall:async()=>{const release=await acquireAgentSlot(root.id,Number(root.flow.maxAgentConcurrency||4),()=>{same();if(stopped())throw new Error('Workflow stopped.');});try{if((root.agentCalls||0)>=Number(root.flow.maxAgentCalls||1000))throw new Error('Workflow agent-call limit reached.');patch(()=>{root.agentCalls=(root.agentCalls||0)+1;appendNodeLog(run,block.id,'model','Model call started');});return release;}catch(error){release();throw error;}},
            onTool:entry=>patch(r=>{(r.nodeDetails[block.id].tools||=[]).push({...entry,at:stamp()});appendNodeLog(r,block.id,'tool',`${entry.tool} · ${entry.count} records`);})});
          records=parsed.records;output=parsed.text;assignedText=true;
          if(block.type==='search'){query=String(parsed.query||'').trim();if(!query)throw new Error('The model did not provide a search query.');}
        }
      }
      const site=block.type==='search'&&siteOf(block.source);
      if(site&&!approval){patch(r=>{r.nodeStates[block.id]='waiting';r.pendingNodes[block.id]={nodeId:block.id,kind:'site',site:site.id,instructions:`Run this query in ${site.name} under Search, export the records as RIS and add the export file.`,records:[],text:'',query};syncPending(r);});return {status:'waiting',runId,nodeId:block.id,count:0};}
      if(RESEARCH_TYPES.has(block.type)&&(!approval||pending?.kind==='dual_review')) {
        const result=await prepareResearch(block,{s:researchSnapshot(get(),records,{allRecords:['prisma','screening_sheet'].includes(block.type)}),records,payloads,cfg:modelProfile(block.modelId),stop:stopped,progress,signal:controller.signal});same();if(stopped())throw new Error('Workflow stopped.');
        records=result.records;output=block.type==='fanout'?output:result.text||'';researchPayload=result.payload;artifact=result.artifact;
        if(result.gate) {
          patch(r=>{(r.nodeStates||={})[block.id]='waiting';r.pendingNodes[block.id]={nodeId:block.id,kind:result.gate,instructions:BLOCKS.find(b=>b.id===block.type).description,records,text:output,payload:researchPayload,artifact};syncPending(r);});
          return {status:'waiting',runId,nodeId:block.id,count:records.length};
        }
      }
      if(!approval||humanCompletion) {
        if(['subworkflow','batch'].includes(block.type)) {
          const root=get().workflowRuns.find(r=>r.id===(run.rootRunId||run.id)),target=root.definitions?.[block.workflowId];
          if(!target)throw new Error('The workflow snapshot is unavailable. Start a new run.');
          if(!run.children?.[block.id]) {
            const groups=block.type==='batch'?Array.from({length:Math.ceil(records.length/Number(block.batchSize??10))},(_,i)=>records.slice(i*Number(block.batchSize??10),(i+1)*Number(block.batchSize??10))):[records];
            if(groups.length>100)throw new Error('Use at most 100 batches per block. Increase the batch size.');
            const total=(root.expandedBlocks||flow.blocks.length)+groups.length*target.blocks.length;if(total>10000)throw new Error('This run exceeds 10,000 expanded blocks.');
            patch(r=>{root.expandedBlocks=total;(r.children||={})[block.id]=groups.map((group,i)=>{
              const child=makeRun(structuredClone(target),{parentRunId:runId,parentNodeId:block.id,rootRunId:root.id,input:{records:structuredClone(group),text:output},iteration:i+1});
              child.flow.id=child.id;get().workflowRuns.push(child);return child.id;
            });});
          }
          for(const key of Object.keys(run.pendingNodes))if(run.pendingNodes[key].parentNodeId===block.id)delete run.pendingNodes[key];
          const childRuns=run.children[block.id].map(id=>get().workflowRuns.find(r=>r.id===id));
          for(const child of childRuns) {
            if(stopped())throw new Error('Workflow stopped.');
            if(child.status==='done')continue;
            if(child.status==='cancelled')throw new Error('A called workflow was stopped.');
            if(child.status==='failed')for(const id of Object.keys(child.nodeStates))if(['failed','running'].includes(child.nodeStates[id]))child.nodeStates[id]='queued';
            child.status='running';child.error=null;await executeRun(child.id,stopped);
          }
          const gates=childRuns.flatMap(child=>Object.values(child.pendingNodes||{}).map(p=>({child,p})));
          if(gates.length){patch(r=>{r.nodeStates[block.id]='waiting';for(const {child,p} of gates){const id=block.id+'::'+child.id+'::'+p.nodeId;r.pendingNodes[id]={...p,nodeId:id,parentNodeId:block.id,delegateRunId:p.delegateRunId||child.id,delegateNodeId:p.delegateNodeId||p.nodeId,block:p.block||child.flow.blocks.find(b=>b.id===p.nodeId),label:`${block.label||target.name} · ${child.iteration} · ${p.label||child.flow.blocks.find(b=>b.id===p.nodeId)?.label||p.kind}`};}syncPending(r);});return;}
          const results=childRuns.map(child=>{const out=child.flow.blocks.find(b=>b.type==='output');return {records:outputRecords(child,out.id),text:child.texts[out.id]||''};});records=mergeRecords(results.map(r=>r.records));output=results.map(r=>r.text).filter(Boolean).join('\n\n');
        }
        if(block.type==='wait') {
          const until=run.nodeDetails[block.id].waitUntil||Date.now()+Number(block.waitSeconds||5)*1000;patch(r=>{r.nodeDetails[block.id].waitUntil=until;});
          while(Date.now()<until){if(stopped())throw new Error('Workflow stopped.');await new Promise(resolve=>setTimeout(resolve,Math.min(250,until-Date.now())));same();}
        }
        if(block.type==='http'){records=await fetchWorkflowRecords(block,{stopped,progress});same();output=`${records.length} records from ${new URL(block.url).hostname}`;}
        if(block.type==='search'){const saved=run.searchCheckpoints?.[block.id],checkpoint=saved?{...saved,records:outputRecords(run,`search-checkpoint:${block.id}`)}:null;const result=await acquireSearch(block.source||'pubmed',query,{limit:Number(block.limit||100),all:block.acquisition==='all',maxRecords:Number(block.maxRecords||10000),settings:settingsOf(get()),signal:controller.signal,onProgress:progress,checkpoint,onCheckpoint:page=>patch(r=>{const {records,...meta}=page;setOutputRecords(r,`search-checkpoint:${block.id}`,records);(r.searchCheckpoints||={})[block.id]=meta;})});same();if(stopped())throw new Error('Workflow stopped.');records=result.records;output=`${records.length} records retrieved · ${result.complete?'Complete':result.stoppedAtLimit?'Ceiling reached; more records may remain':'Partial retrieval'} · ${result.pages} page${result.pages===1?'':'s'}`;searchLog={source:SOURCES.find(x=>x.id===(block.source||'pubmed'))?.name||block.source,kind:SOURCES.find(x=>x.id===(block.source||'pubmed'))?.kind||'database',sourceId:block.source||'pubmed',query,at:stamp(),date:stamp(),total:result.total,retrieved:result.records.length,complete:result.complete,stoppedAtLimit:result.stoppedAtLimit,pages:result.pages,workflow:flow.id};}
        if(block.type==='filter'&&!['ai','human'].includes(block.executor))records=filterRecords(records,block);
        if(block.type==='zotero'){records=await zoteroItems({limit:Number(block.limit||100)});same();if(stopped())throw new Error('Workflow stopped.');}
        if(block.type==='dedupe')records=uniqueRecords(records);
        if(block.type==='new_records'){const index=libraryIndex(get().papers||[]);records=records.filter(r=>!index.find(r));}
        if(block.type==='sort')records=sortFlowRecords(records,block);
        if(block.type==='limit')records=records.slice(0,Number(block.limit||100));
        if(['enrich','abstracts'].includes(block.type)){
          if(records.length>100)throw new Error('Limit enrichment to 100 records per run.');
          records=structuredClone(records);let changed=0,missing=0;
          for(const r of records){
            same();if(stopped())throw new Error('Workflow stopped.');progress(`${BLOCKS.find(b=>b.id===block.type).label}: ${records.indexOf(r)+1} / ${records.length}`);
            if(block.type==='enrich'&&r.doi){const meta=await lookupDoi(r.doi,{signal:controller.signal});if(meta){for(const [key,value] of Object.entries(meta))if(!['key','id','source'].includes(key)&&(!r[key]||Array.isArray(r[key])&&!r[key].length)&&value)r[key]=value;changed++;}else missing++;}
            else if(block.type==='abstracts'&&!r.abstract&&(r.doi||r.pmid)){const abstract=await fetchAbstract(r,{signal:controller.signal});if(abstract){r.abstract=abstract;changed++;}else missing++;}
          }
          same();if(stopped())throw new Error('Workflow stopped.');output=`${changed} records enriched; ${missing} not found.`;
        }
        if((block.review||flow.protected&&WRITE_BLOCKS.has(block.type))&&!humanCompletion){const resolvedText=['note','todo','notify'].includes(block.type);if(resolvedText&&!assignedText)output=resolveFlowText(block.text,{count:records.length,output});patch(r=>{(r.nodeStates||={})[block.id]='waiting';r.pendingNodes[block.id]={nodeId:block.id,kind:'review',resolvedText,instructions:block.instructions||BLOCKS.find(b=>b.id===block.type).description,records,text:output,query,payload:researchPayload,artifact,searchLog};syncPending(r);});return {status:'waiting',runId,nodeId:block.id,count:records.length};}
      }
      if(block.type==='merge')output=edges.flatMap((edge,i)=>inputs[i].active?[`${flow.blocks.find(b=>b.id===edge.from)?.label||edge.from}\n${inputs[i].text}`]:[]).join('\n\n');
      same();if(stopped())throw new Error('Workflow stopped.');
      const text=()=>assignedText?output:resolveFlowText(block.text,{count:records.length,output});
      if(block.type==='export'){const format=block.format||'csv';artifact={name:`references.${format}`,type:'text/plain',text:exportFlowRecords(records,format)};}
      if(['note','todo','notify'].includes(block.type))output=text();
      // Validate every fallible mutation before changing the live state.
      if(block.type==='note'&&!output.trim())throw new Error('The note has no content. Connect a text-producing step or write note text.');
      if(block.type==='collect'&&block.collection&&!get().collections?.some(c=>c.id===block.collection))throw new Error('The destination collection was removed.');
      if(researchPayload&&['criteria','screening','consensus','extraction'].includes(block.type))commitResearch(researchSnapshot(get(),records),researchPayload,runId,block.id,records);
      update(s=>{
        if(researchPayload&&['criteria','screening','consensus','extraction'].includes(block.type))commitResearch(s,researchPayload,runId,block.id,records);
        if(searchLog)s.searches=[...(s.searches||[]),searchLog];
        if(block.type==='collect')addSearchRecords(s,records.map(record=>({...record,id:record.id||record.key||crypto.randomUUID(),label:record.label||record.title,year:String(record.year||''),pdf:record.pdf||null})),block.collection||'');
        if(block.type==='note')addFileNote(s,{text:output,source:{kind:'workflow',workflowId:flow.id,label:flow.name}});
        if(block.type==='todo')s.todos=[...(s.todos||[]),{id:crypto.randomUUID(),text:output,done:false,at:stamp(),workflow:flow.id}];
        if(block.type==='notify')notify(s,{title:output,view:'workflows'});
        const r=s.workflowRuns.find(r=>r.id===runId);
        appendNodeLog(r,block.id,'done',`Completed · ${records.length} record${records.length===1?'':'s'}`);r.nodeStates[block.id]='done';(r.payloads||={})[block.id]=researchPayload;setOutputRecords(r,block.id,records);r.texts[block.id]=output;r.next=index+1;
        delete r.pendingNodes[block.id];delete r.approvals[block.id];r.approval=null;syncPending(r);
        Object.assign(r.nodeDetails[block.id],{endedAt:stamp(),durationMs:Date.now()-started,outputCount:records.length});
        r.steps.push({nodeId:block.id,type:block.type,count:records.length,text:output,...(artifact?{artifact}:{}),model:block.executor==='ai'||BLOCKS.find(b=>b.id===block.type).model?modelProfile(block.modelId)?.model:undefined,checked,at:stamp()});return s;
      });
      } catch(error) {
        if(projectGeneration()===generation&&get().project===identity)patch(r=>{r.nodeStates[block.id]=stopped()?'cancelled':'failed';r.nodeDetails[block.id]={...r.nodeDetails[block.id],error:error.message,endedAt:stamp(),durationMs:Date.now()-started};});
        if(stopped())throw new DOMException(projectGeneration()!==generation?'Project changed; workflow stopped.':'Workflow stopped.','AbortError');
        throw error;
      }
    };
    const executeWithRetry=async block=>{
      for(let retry=0;;retry++) {
        try{return await executeNode(block);}catch(error){
          const transient=TRANSIENT_KINDS.has(error.kind)||/\b(429|50[0234])\b|network|fetch failed|timed? ?out|temporarily unavailable/i.test(error.message);
          if(stopped()||get().project!==identity)throw error;
          if(!transient||retry>=Number(block.retries||0)){
            if(block.onError!=='continue')throw error;
            for(const childId of run.children?.[block.id]||[])stopFlow(childId);
            patch(r=>{r.nodeStates[block.id]='error';r.outputs[block.id]=[];r.texts[block.id]='';r.steps.push({nodeId:block.id,type:block.type,status:'error',count:0,text:error.message,at:stamp()});});return;
          }
          patch(r=>{r.nodeStates[block.id]='retrying';});
          await new Promise(resolve=>setTimeout(resolve,Math.min(4000,1000*2**retry)));
        }
      }
    };
    const status=await scheduleGraph({blocks:plan.blocks,incoming:plan.incoming,concurrency:Number(flow.concurrency||3),state:id=>run.nodeStates[id],execute:executeWithRetry,stopped});
    if(status==='waiting'){patch(r=>{r.status='waiting';syncPending(r);});return {status:'waiting',runId,nodeId:run.pending.nodeId,count:run.pending.records.length};}
    patch(r=>{r.status='done';r.endedAt=stamp();});return {status:'done',runId,count:run.steps.at(-1)?.count||0};
  }); } catch(err){if(projectGeneration()===generation&&get().project===identity)patch(r=>{for(const id of Object.keys(r.nodeStates||{}))if(r.nodeStates[id]==='running')r.nodeStates[id]='failed';r.status=r.cancelRequested||ancestorStopped()?'cancelled':'failed';r.error=err.message;r.endedAt=stamp();});throw err;}finally{unwatch();controller.abort();active.delete(flow.id);}
}
// An interrupted run is not replayed: an earlier task may already have written data.
export async function reconcileFlowRuns() {
  const identity=get().project;
  for(const saved of get().workflowRuns||[]) {
    if(saved.status!=='running'||active.has(saved.flowId))continue;
    try { await lockFlow(saved.flowId,async()=>{
      if(get().project!==identity)return;
      update(s=>{const r=s.workflowRuns?.find(r=>r.id===saved.id);if(r?.status==='running'){r.status='failed';r.error='Interrupted before completion. Review the completed steps before running again.';r.endedAt=stamp();}return s;});
    }); } catch { /* Another window owns this active run. */ }
  }
}
// The minute each scheduled workflow was last checked in this window, per open project. A check that finds nothing due
// is not written to the project: written, it saved the whole project every minute a schedule was on. The saved
// scheduleCheckedSlot is written on the first check and when a run is due; every due minute also sets lastSlot, so a
// catch-up after a restart that scans from an older check finds the same latest unhandled occurrence (lib/flow-cron.mjs).
const checkedSlots=new WeakMap();
export async function runDueFlows(now=new Date()) {
  const slot=Math.floor(now.getTime()/60000),identity=get().project,work=[];
  if(identity&&!checkedSlots.has(identity))checkedSlots.set(identity,new Map());
  const checked=identity?checkedSlots.get(identity):new Map();
  for(const f of get().workflows||[]) {
    const last=checked.get(f.id)??f.scheduleCheckedSlot;
    if(!f.enabled||!f.cron||active.has(f.id)||last===slot)continue;
    try {
      checked.set(f.id,slot);
      const due=dueCronSlot({...f,scheduleCheckedSlot:last},now);
      // A schedule never checked before records its first check, so an occurrence missed while the app is closed is caught up.
      if(due==null&&Number.isInteger(f.scheduleCheckedSlot))continue;
      update(s=>{const flow=s.workflows.find(x=>x.id===f.id);if(flow)flow.scheduleCheckedSlot=slot;return s;});
      if(due==null)continue;
      const busy=(get().workflowRuns||[]).some(r=>r.flowId===f.id&&!r.parentRunId&&['running','waiting'].includes(r.status));
      update(s=>{const flow=s.workflows.find(x=>x.id===f.id);if(flow){flow.lastSlot=due;flow.scheduleStatus=busy?'Skipped · run still active':due<slot?'Started · latest missed occurrence':'Started';flow.scheduleAt=now.toISOString();flow.scheduledFor=new Date(due*60000).toISOString();flow.scheduleError=null;}return s;});
      if(busy)continue;
      work.push(runFlow(f.id,{trigger:'schedule'}).catch(error=>{if(get().project!==identity)return;update(s=>{const flow=s.workflows.find(x=>x.id===f.id);if(flow){flow.scheduleStatus='Failed';flow.scheduleError=error.message;}return s;});}));
    }catch(error){update(s=>{const flow=s.workflows.find(x=>x.id===f.id);if(flow){flow.lastSlot=slot;flow.scheduleStatus='Invalid schedule';flow.scheduleError=error.message;}return s;});}
  }
  await Promise.all(work);
}
