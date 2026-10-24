import { trackedRewrite, assistantChange } from './tracked-edit.mjs';
import { announceWrites } from './assistant-shell.mjs';
import { manuscriptDiff } from './manuscript-suggestions.mjs';
// Typed research assistance. Statistics are delegated to existing checked engines;
// source review and all scientific changes remain explicit human proposals.
import { get, update } from '../store.mjs';
import * as store from '../store.mjs';
import { results } from './results.mjs';
import { outcomes, timepointsOf, slotId, analysisOf as pooledOf } from './outcomes.mjs';
import { pooledInputStatus } from './analysis-inputs.mjs';
import { survivalInputStatus } from './survival-run.mjs';
import { ANALYSES, sourceById, runAnalysis, analysisEntry, analysisPopulation, fitsRole, levelsOf, isStale } from './dataset-analysis.mjs';
import { ADVANCED_METHODS, advancedSourceById, prepareAdvanced, runAdvanced, advancedInputStatus } from './advanced-primary.mjs';
import { propensityStatus, propensitySnapshot, runPropensity } from './propensity.mjs';
import { dtaStatus } from './dta.mjs';
import { nmaStatus } from './nma.mjs';
import { researchRecords, proposalSourceSnapshot } from './research-ledger.mjs';
import { file } from './aid.mjs';
import { registerProposalHandler } from './proposal-handlers.mjs';
import { hashText, citations, resultTokens } from './manuscript.mjs';
import { index as documentIndex, locateIn } from './doctext.mjs';
import { quoteFound } from './quotes.mjs';
import { settingsOf } from './app-settings.mjs';
import { outputLimitPolicy } from './ai.mjs';
import { plannedAnalyses, sapDeviations } from './governance.mjs';
import { numbersIn } from './numbers.mjs';
import { recordFingerprint, recordChanges } from './progress.mjs';
const clone = value => structuredClone(value);
const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const need = (ok, message) => { if (!ok) throw new Error(message); };
const textOf = b => b.text ?? (b.runs || []).map(r=>r.t).join('');
const resultKeys = text => resultTokens(text).map(r=>r.key);
const citationKeys = text => citations(text).map(c=>c.key);
const analyzedN = entry => { const n=entry.n??entry.result?.n??entry.ext?.counts?.n??entry.nRetained;return typeof n==='object'?n?.used??null:n??null; };
const population = entry => {
  const p = entry.population || entry.ext?.population || entry.result?.population;
  return p ? { ...clone(p), ...(p.participants ? { participants:p.participants.slice(0,100), participantsTotal:p.participants.length } : {}),
    ...(p.included ? { included:p.included.slice(0,100), includedTotal:p.included.length } : {}),
    ...(p.excluded ? { excluded:p.excluded.slice(0,100), excludedTotal:p.excluded.length } : {}) } : null;
};
function entries(state) {
  const out=[];
  const add=(id,family,entry,status,title)=>out.push({id,family,title:title||entry.method||entry.kind||family,status,at:entry.at||null,entry});
  for (const o of outcomes(state)) for(const t of timepointsOf(state,o.id)) {
    const slot=slotId(o.id,t.id),a=pooledOf(state,slot);if(a)add(`pooled:${slot}`,'pooled',a,pooledInputStatus(state,a,slot),`${o.name}, ${t.label||t.id}`);
  }
  for(const a of state.datasetAnalyses||[])add(`dataset:${a.id}`,a.kind?.startsWith('prediction')?'prediction':'dataset',a,!a.frozenData?'untracked':isStale(a,state)?'stale':'current');
  for(const a of state.advancedAnalyses||[])add(`advanced:${a.id}`,'advanced',a,advancedInputStatus(a,state),ADVANCED_METHODS.find(m=>m.id===a.kind)?.label);
  for(const a of state.propensityAnalyses||[])add(`propensity:${a.id}`,'propensity',a,propensityStatus(a,sourceById(a.datasetId,state)));
  if(state.survival)add('survival:saved','survival',state.survival,survivalInputStatus(state));
  if(state.dta)add('dta:saved','dta',state.dta,dtaStatus(state));
  if(state.nma?.result)add('nma:saved','nma',state.nma.result,nmaStatus(state));
  for(const r of researchRecords(state,{type:'survival'}))add(`chat:${r.id}`,'chat-survival',r.block.analysis,survivalInputStatus(state,r.block.analysis),r.block.title||'Chat Kaplan–Meier');
  return out;
}
export function analysisRegistry(state,{family}={}) {
  return entries(state).filter(r=>!family||r.family===family).map(({entry,...r})=>({...r,method:entry.method||entry.result?.method||entry.ext?.method||null,
    datasetId:entry.datasetId||null,n:analyzedN(entry),
    excluded:entry.population?.excluded?.length??entry.ext?.population?.excluded?.length??entry.result?.n?.dropped??entry.result?.dropped??entry.excluded?.length??null,
    reproducible:Boolean(entry.frozenData||entry.ext?.inputRows||entry.inputSnapshot||entry.rowsVersion),
    scriptAvailable:Boolean(entry.rScript?.code||entry.result?.rScript?.code||entry.ext?.km?.rScript?.code)}));
}
export function readAnalysisResult(state,{id: selected,includeScript=false}={}) {
  if(!selected)return {analyses:analysisRegistry(state),result_tokens:results(state).map(r=>({token:`{{${r.key}}}`,text:r.text,status:r.inputStatus||'current'}))};
  const row=entries(state).find(r=>r.id===selected);need(row,'Unknown saved analysis. List analyses first.');
  const a=row.entry,raw=a.result||a;
  // No frozen participant rows or SVGs are sent by default. Exact inputs remain in exports.
  const result=Object.fromEntries(Object.entries(raw).filter(([k])=>!['ext','plot','svg','rScript','frozenData','inputRows','rows','population','inputSnapshot'].includes(k)));
  return { ...analysisRegistry(state).find(r=>r.id===selected),inputs:clone(a.inputs||a.ext?.inputSpec||{}),options:clone(a.options||{}),population:population(a),result,
    warnings:raw.warnings||[],...(includeScript?{rScript:a.rScript||a.result?.rScript||a.ext?.km?.rScript||null}:{}),
    note:row.status==='current'?'Saved computed result. Review assumptions and diagnostics before interpretation.':'Historical result: inputs changed or provenance is unavailable. Rerun before treating this as current.' };
}
export function analysisReadiness(state,{datasetId,method,inputs={},options={},design={}}={}) {
  const d=datasetId?sourceById(datasetId,state):null;
  const issues=[],add=(severity,detail)=>issues.push({severity,detail});
  if(datasetId&&!d)add('error','Dataset is unavailable.');
  if(design.clustered&&!inputs.cluster)add('error','Declare the cluster/participant identifier before analyzing dependent observations.');
  if(design.repeated&&!['repeated','rm-anova','friedman','recurrent','paired'].includes(method))add('error','The selected method does not declare how repeated observations are handled.');
  if(design.competingRisks&&method!=='competing')add('error','Declare competing events and use a competing-risk method for cumulative incidence.');
  const native=ADVANCED_METHODS.find(m=>m.id===method),basic=ANALYSES.find(m=>m.kind===method);
  if(method&&(native||basic||method==='propensity')&&!d)add('error','Choose an available source dataset.');
  if(method&&!native&&!basic&&method!=='propensity')add('error','This method is not implemented. GLMM, Fine–Gray, multiple imputation and multinomial regression remain unavailable.');
  let prepared=null;
  if(basic){
    for(const key of Object.keys(inputs))if(!basic.inputs.some(i=>i.key===key))add('error',`Unsupported input ${key}.`);
    for(const [key,value] of Object.entries(options)){const spec=(basic.options||[]).find(o=>o.key===key);
      if(!spec)add('error',`Unsupported option ${key}.`);
      else if(spec.choices&&!spec.choices.some(c=>c[0]===value))add('error',`Unsupported choice for ${spec.label}.`);
      else if(spec.number&&!Number.isFinite(Number(value)))add('error',`Enter a finite ${spec.label}.`);
    }
  }
  if(native){
    const optionKeys={repeated:['correlation','refs'],'rm-anova':['timeOrder','groupOrder','posthoc','sphericityAssumed'],friedman:['timeOrder','groupOrder','posthoc'],ordinal:['order','refs'],competing:['censorLevel','landmarks'],recurrent:['eventLevel','refs']}[method];
    for(const key of Object.keys(options))if(!optionKeys.includes(key))add('error',`Unsupported option ${key}.`);
  }
  if(d&&method==='propensity'){
    const allowed=['method','algorithm','estimand','treatment','treatedLevel','covariates','idColumn','scoreColumn','ratio','caliper','caliperUnits','commonSupport','trimLower','trimUpper','stabilized'];
    for(const key of Object.keys(options))if(!allowed.includes(key))add('error',`Unsupported option ${key}.`);
    if(Object.keys(inputs).length)add('error','Propensity columns belong in the declared options; no input mappings are silently ignored.');
    try{const declared=JSON.parse(propensitySnapshot(d,options)).settings;
      if(declared.method==='match'&&(!Number.isInteger(declared.ratio)||declared.ratio<1||declared.ratio>5))add('error','Choose a matching ratio of 1–5.');
      const levels=[...new Set(d.rows.map(r=>String(r[declared.treatment]??'').trim()).filter(Boolean))];
      if(levels.length!==2||!levels.includes(declared.treatedLevel))add('error','Treatment needs two observed levels and an explicitly selected treated level.');
    }catch(e){add('error',e.message);}
  }
  if(d&&native)try{prepared=prepareAdvanced(advancedSourceById(datasetId,state),method,inputs,options);}catch(e){if(e.population)prepared={population:e.population};add('error',e.message);}
  if(d&&basic){
    for(const role of basic.inputs){
      if(role.levelOf){if(!role.optional||inputs[role.key]){if(!levelsOf(d,inputs[role.levelOf]).includes(inputs[role.key]))add('error',`Choose an observed ${role.label.toLowerCase()} level.`);}continue;}
      const chosen=Array.isArray(inputs[role.key])?inputs[role.key]:[inputs[role.key]].filter(Boolean);
      if(!role.optional&&!chosen.length)add('error',`Choose ${role.label}.`);
      if(role.multi&&inputs[role.key]&&!Array.isArray(inputs[role.key]))add('error',`${role.label} needs an explicit column list.`);
      for(const column of chosen){const c=d.columns.find(c=>c.id===column);if(!c)add('error',`Unknown column ${column}.`);else if(!fitsRole(d,c,role.role))add('error',`${role.label} requires a ${role.role} column with usable observed values.`);}
    }
    if(!issues.some(i=>i.severity==='error')){
      prepared={population:analysisPopulation(d,method,inputs,null)};
      if(!prepared.population.used)add('error','No usable rows remain for the declared analysis inputs.');
      // The checked pure engine gives meaningful small-cohort minima and
      // design errors. Large/model-development inputs keep a light preflight;
      // fitting, resampling and convergence are assessed on reviewed execution.
      if(prepared.population.used&&d.rows.length<=2000&&!method.startsWith('prediction-'))try{
        const checked=runAnalysis(d,method,inputs,options);
        if(!(checked.n?.used>0))add('error','The selected method has no usable analyzed observations.');
        prepared={population:analysisPopulation(d,method,inputs,checked)};
      }catch(e){add('error',e.message);}
    }
  }
  const used=new Set(Object.values(inputs).flatMap(v=>Array.isArray(v)?v:[v]).filter(v=>d?.columns.some(c=>c.id===v)));
  const missing=d?d.rows.filter(r=>[...used].some(k=>r[k]==null||String(r[k]).trim()==='')).length:0;
  if(missing)add('warning',`${missing} rows have missing requested values. Existing engines use their declared complete-case populations; no imputation is performed.`);
  const assumptions=native?.id==='repeated'?['Gaussian conditional residuals','Random intercept and specified time correlation','Missingness assumptions require reviewer assessment']:
    native?.id==='rm-anova'?['Strict complete balanced participant × categorical-time grid','Gaussian errors and equal between-group variances','Uncorrected within-subject F tests assume sphericity','Direct paired post-hoc tests, not estimated marginal means']:
    native?.id==='friedman'?['Complete paired blocks with explicit categorical-time order','Participants independent; rank test run separately within groups','Asymptotic Friedman and signed-rank p values; no between-group inference']:
    native?.id==='ordinal'?['Ordered outcome levels are explicit','Proportional odds must be assessed by the researcher']:
    native?.id==='competing'?['One first-event record per participant','Independent censoring','Unadjusted cause-specific cumulative incidence']:
    native?.id==='recurrent'?['Disjoint counting-process intervals','Andersen–Gill intensity assumptions','Cluster-robust inference; proportional hazards']:
    method==='propensity'?['No unmeasured confounding','Positivity and declared target population','Preprocessing/balance only; no outcome effect inference']:['Design, distribution and independence must be assessed by the researcher'];
  const planned=plannedAnalyses(state),outcomeColumn=inputs.outcome||inputs.y||inputs.x;
  const candidate=method&&d?{outcome:design.sapOutcome||d.columns.find(c=>c.id===outcomeColumn)?.label||'',method:native?.label||basic?.label||'Propensity preprocessing'}:null;
  const sapCheck=candidate?sapDeviations(planned,[candidate]):[];
  if(candidate&&!planned.length)add('warning','No analysis is declared in the SAP. Record the intended outcome, method and population before interpreting results.');
  else if(candidate&&sapCheck.some(r=>['changed','not planned'].includes(r.status)))add('warning','The proposed outcome or method differs from the free-text SAP. Review the displayed comparison and record any deviation.');
  return {method:method||null,dataset:d?{id:d.id,name:d.name,rows:d.rows.length,columns:d.columns}:null,ready:!issues.some(i=>i.severity==='error'),issues,assumptions,
    population:prepared?population(prepared):null,sap:clone(planned),sapCheck,available:{basic:ANALYSES.map(m=>({id:m.kind,label:m.label,inputs:m.inputs,options:m.options||[]})),advanced:ADVANCED_METHODS},
    note:'Readiness checks do not prove model assumptions or clinical appropriateness. Accept a frozen recipe to run the existing engine.'};
}
async function executeRecipe(payload,{guard,guardBoundary=guard,signal},deps={}) {
  if(signal?.aborted)throw new DOMException('Analysis stopped','AbortError');
  guard();const {recipe,frozenData}=payload;let entry;
  if(recipe.family==='advanced')entry=await (deps.runAdvanced||runAdvanced)(clone(frozenData),recipe.method,recipe.inputs,recipe.options,{signal});
  else if(recipe.family==='propensity'){entry=(deps.runPropensity||runPropensity)(clone(frozenData),recipe.options);entry.id=id('ps');}
  else {const result=(deps.runAnalysis||runAnalysis)(clone(frozenData),recipe.method,recipe.inputs,recipe.options);entry=analysisEntry(frozenData,recipe.method,recipe.inputs,recipe.options,result);}
  if(signal?.aborted)throw new DOMException('Analysis stopped','AbortError');
  guard(); // Source changes while native computation runs refuse the late result.
  const key=recipe.family==='advanced'?'advancedAnalyses':recipe.family==='propensity'?'propensityAnalyses':'datasetAnalyses';
  update(s=>{s[key]=[...(s[key]||[]),entry];return s;});guardBoundary();return `Saved ${entry.method||recipe.method}`;
}
export function proposeAnalysis(state,args,{model='',prompt='',deps={}}={}) {
  need(args.method,'Choose an implemented analysis method.');
  const report=analysisReadiness(state,args);need(report.ready,report.issues.filter(i=>i.severity==='error').map(i=>i.detail).join(' '));
  const method=args.method, family=ADVANCED_METHODS.some(m=>m.id===method)?'advanced':method==='propensity'?'propensity':'dataset';
  const d=family==='advanced'?advancedSourceById(args.datasetId,state):sourceById(args.datasetId,state);need(d,'Choose an available source dataset.');
  const payload={kind:'analysis-recipe',recipe:{family,method,inputs:clone(args.inputs||{}),options:clone(args.options||{})},frozenData:clone(d)};
  const owner=state.project,epoch=store.projectGeneration?.(),source=proposalSourceSnapshot(state);
  const guard=()=>{need(get().project===owner&&epoch===store.projectGeneration?.(),'The project was replaced.');need(proposalSourceSnapshot(get())===source,'Source data changed. Request the analysis again.');};
  return file({view:'analysis',title:`Run ${report.available.advanced.find(m=>m.id===method)?.label||report.available.basic.find(m=>m.id===method)?.label||'Propensity preprocessing'}`,meta:model,prompt,sourceSnapshot:source,
    note:'Review the frozen settings and assumptions. Acceptance runs the existing statistical engine.',items:[{label:'Run frozen analysis',detail:JSON.stringify({dataset:d.name,rows:d.rows.length,...payload.recipe,assumptions:report.assumptions,issues:report.issues},null,2),acceptLabel:'Run',pendingLabel:'Running',payload,
      accept:({signal}={})=>executeRecipe(payload,{guard,signal,guardBoundary:()=>need(get().project===owner&&epoch===store.projectGeneration?.(),'The project was replaced.')},deps)}]});
}
registerProposalHandler('analysis-recipe',executeRecipe);

export function adjudicationQueue(state,{stage='ta',limit=30,offset=0,target}={}) {
  need(['ta','ft','extraction'].includes(stage),'Choose title/abstract, full-text or extraction review.');const items=[];
  if(stage==='extraction'){for(const [key,p]of Object.entries(state.proposals||{}))if(key.includes(':')){
    const accepted=state.values?.[key],reasons=[];
    if(p.availability==='conflicting')reasons.push('Conflicting extraction evidence');
    if(accepted&&String(accepted.reported_value)!==String(p.value))reasons.push('Proposal differs from accepted value');
    if(p.availability==='present'&&!p.evidence?.length)reasons.push('No source locator');
    if(reasons.length)items.push({key,reasons,priority:reasons.length,accepted:accepted?{value:accepted.reported_value,evidence:accepted.evidence}:null,proposal:{value:p.value,evidence:p.evidence||[],rationale:p.rationale||''},action:'Review in Extraction; no automatic acceptance.'});
  }}else for(const p of state.papers||[]){
    const reviews=Object.entries(state.dual?.[stage]?.[p.id]||{}).filter(([who,d])=>who.trim()&&['include','exclude'].includes(d.decision));
    const reasons=[],final=state[stage==='ft'?'fulltext':'screening']?.[p.id];
    if(new Set(reviews.map(([,d])=>d.decision)).size>1&&!final?.resolved)reasons.push('Independent reviewers disagree');
    if(reviews.some(([,d])=>d.needsCriteriaReview)||final?.needsCriteriaReview)reasons.push('Criteria changed; reviews require reassessment');
    if(reviews.length===1)reasons.push('Second independent human review missing');
    if(reasons.length)items.push({paperId:p.id,label:p.label||p.title,reasons,priority:reasons.length,reviews:reviews.map(([reviewer,d])=>({reviewer,...clone(d)})),final:final||null,action:'Review in Screening; AI cannot satisfy a human checkpoint.'});
  }
  items.sort((a,b)=>b.priority-a.priority);
  const matches=target?items.filter(i=>(i.key||i.paperId)===target):items,start=Math.max(0,Math.floor(Number(offset)||0)),size=Math.min(100,Math.max(1,Math.floor(Number(limit)||30)));
  return {stage,total:matches.length,offset:start,items:matches.slice(start,start+size),nextOffset:start+size<matches.length?start+size:null,note:'Queues prioritize observable disagreements and missing evidence; they do not resolve decisions.'};
}
export function proposeAdjudication(state,{stage='ta',paperId,key,rationale,locators=[]},{model='',prompt=''}={}) {
  need(typeof rationale==='string'&&rationale.trim()&&rationale.length<=4000,'Supply a bounded draft rationale.');
  const queue=adjudicationQueue(state,{stage,limit:1,target:stage==='extraction'?key:paperId});
  need(queue.items.some(i=>stage==='extraction'?i.key===key:i.paperId===paperId),'Choose an unresolved item from the adjudication queue.');
  need(Array.isArray(locators)&&locators.length<=8,'Supply at most eight source locators.');
  const linked=locators.map(e=>{const p=(state.papers||[]).find(p=>p.id===e.doc_id);
    need(p&&typeof e.quote==='string'&&e.quote.trim().length>=3&&e.quote.length<=4000,'Each locator needs a known document and bounded quotation.');
    need(e.kind==='abstract'||Number.isInteger(e.page)&&e.page>0,'Each PDF locator needs a positive page number.');
    const located=e.kind==='abstract'&&quoteFound(e.quote,p.abstract||'');
    need(e.kind!=='abstract'||located,'The abstract quotation was not located.');
    return {...clone(e),located,review:e.kind==='abstract'?'Quote located; assess scientific meaning.':'PDF locator requires human verification in the source.'};});
  const draft={id:id('adjudication'),stage,paperId:paperId||null,key:key||null,rationale,locators:linked,status:'reviewed-draft',at:new Date().toISOString()};
  const payload={kind:'adjudication-draft',draft};
  return file({view:stage==='extraction'?'extraction':'screening',title:'Review adjudication rationale',meta:model,prompt,note:'This keeps a rationale draft. Final decisions remain in Screening or Extraction.',
    items:[{label:'Keep adjudication draft',detail:JSON.stringify(draft,null,2),acceptLabel:'Keep draft',payload,accept:()=>applyAdjudication(payload)}]});
}
function applyAdjudication({draft}) {
  const reviewer=settingsOf(get()).reviewerInitials||'';need(reviewer,'Set reviewer initials before keeping an adjudication draft.');
  update(s=>{s.adjudicationDrafts=[...(s.adjudicationDrafts||[]),{...draft,reviewer}];return s;});return 'Draft retained; resolve the decision in its review view';
}
registerProposalHandler('adjudication-draft',(p,{guard})=>{guard();return applyAdjudication(p);});
export function evidenceBaseline(state) {
  return {id:id('baseline'),at:new Date().toISOString(),protocol:hashText(JSON.stringify(state.protocol||{})),
    papers:(state.papers||[]).map(p=>recordFingerprint(state,p)),
    values:Object.fromEntries(Object.entries(state.values||{}).map(([k,v])=>[k,hashText(JSON.stringify(v))])),
    analyses:analysisRegistry(state),resultTokens:Object.fromEntries(results(state).map(r=>[r.key,hashText(JSON.stringify([r.raw,r.inputStatus||'current']))])),grade:hashText(JSON.stringify(state.grade||[])),
    manuscript:(state.manuscript?.blocks||[]).map(b=>({id:b.id,hash:hashText(textOf(b)),citations:citationKeys(textOf(b)),tokens:resultKeys(textOf(b))}))};
}
export function evidenceImpact(state,{baselineId}={}) {
  const before=(state.evidenceBaselines||[]).find(b=>b.id===baselineId)||(state.evidenceBaselines||[]).at(-1);
  if(!before)return {baseline:null,changes:[],affected:[],note:'Capture a reviewed evidence baseline before comparing updates.'};
  const now=evidenceBaseline(state),changes=recordChanges(before.papers||[],now.papers);
  for(const k of new Set([...Object.keys(before.values||{}),...Object.keys(now.values)]))if(before.values?.[k]!==now.values[k])changes.push({kind:'accepted-cell',key:k});
  for(const k of new Set([...Object.keys(before.resultTokens||{}),...Object.keys(now.resultTokens)]))if(before.resultTokens&&before.resultTokens[k]!==now.resultTokens[k])changes.push({kind:'result-token',key:k});
  if(before.protocol!==now.protocol)changes.push({kind:'protocol'});
  if(before.grade!==now.grade)changes.push({kind:'certainty'});
  const affected=analysisRegistry(state).filter(a=>a.status!=='current').map(a=>({kind:'analysis',id:a.id,status:a.status,action:'Review inputs and rerun if appropriate.'}));
  const changedIds=new Set(changes.map(c=>c.paperId).filter(Boolean)),changedCites=new Set([...now.papers,...(before.papers||[])].filter(p=>changedIds.has(p.id)).flatMap(p=>[p.id,p.key].filter(Boolean))),staleTokens=new Set([...results(state).filter(r=>r.inputStatus&&r.inputStatus!=='current').map(r=>r.key),...changes.filter(c=>c.kind==='result-token').map(c=>c.key)]);
  for(const b of now.manuscript)if(b.tokens.some(k=>staleTokens.has(k))||b.citations.some(k=>changedCites.has(k)||changedIds.has(k)))affected.push({kind:'manuscript',id:b.id,action:'Review linked results and source changes before updating this paragraph.'});
  for(const c of changes.filter(c=>c.paperId))affected.push({kind:'evidence-review',paperId:c.paperId,action:'Review screening, extraction and appraisal for this changed source.'});
  if(changes.some(c=>['accepted-cell','protocol','changed-record','new-record','removed-record'].includes(c.kind)))affected.push({kind:'certainty-review',action:'Reassess linked certainty judgments; no automatic GRADE change.'});
  return {baseline:{id:before.id,at:before.at},changes,affected,note:'A deterministic impact map, not automatic reruns or scientific decisions. Unchanged analyses remain available.'};
}
export function proposeEvidenceBaseline(state,{model='',prompt=''}={}) {
  const baseline=evidenceBaseline(state),owner=state.project,epoch=store.projectGeneration?.();
  const payload={kind:'evidence-baseline',baseline};
  return file({view:'overview',title:'Capture evidence baseline',meta:model,prompt,items:[{label:'Keep evidence baseline',detail:`${baseline.papers.length} records, ${Object.keys(baseline.values).length} accepted cells, ${baseline.analyses.length} analyses`,acceptLabel:'Keep',payload,
    accept:()=>{need(get().project===owner&&epoch===store.projectGeneration?.(),'The project was replaced.');update(s=>{s.evidenceBaselines=[...(s.evidenceBaselines||[]),baseline];return s;});return 'Baseline saved';}}]});
}
registerProposalHandler('evidence-baseline',({baseline},{guard})=>{guard();update(s=>{s.evidenceBaselines=[...(s.evidenceBaselines||[]),baseline];return s;});return 'Baseline saved';});

const numbers = t => numbersIn(t).map(n=>n.value);
export async function auditClaims(state,{claims=[]}={}, { index:pdfIndexFn=documentIndex }={}) {
  need(Array.isArray(claims)&&claims.length>0&&claims.length<=40,'Supply 1–40 explicit claims.');
  const sourceSnapshot=proposalSourceSnapshot(state),papers=clone(state.papers||[]),tokens=new Map(results(state).map(r=>[r.key,clone(r)])),documents=new Map();
  const audited=[];
  for(const c of claims){
    need(typeof c.text==='string'&&c.text.trim()&&c.text.length<=4000,'Each claim needs bounded text.');const locators=[],issues=[];
    for(const e of (c.locators||[]).slice(0,8)){
      const p=papers.find(p=>p.id===e.doc_id);let found=false,version=null;
      if(!p)issues.push('Unknown source document.');
      else if(e.kind==='abstract'){found=quoteFound(e.quote,p.abstract||'');version=hashText(p.abstract||'');}
      else if(Number.isInteger(e.page)&&e.page>0&&e.quote?.length>=3){
        if(!documents.has(p.id))documents.set(p.id,await pdfIndexFn(p.id,{fresh:true}).catch(()=>null));const d=documents.get(p.id);version=d?.hash||null;
        found=Boolean(d?.pages?.[e.page-1]&&locateIn([d.pages[e.page-1]],e.quote));
      }
      if(!found)issues.push('The stated quote was not located in its source.');
      if(e.document_version&&version&&e.document_version!==version){found=false;issues.push('The document version changed.');}
      locators.push({...clone(e),located:found,document_version:version});
    }
    const linked=(c.result_tokens||[]).map(key=>{const r=tokens.get(key.replace(/^\{\{|\}\}$/g,''));if(!r||r.inputStatus&&r.inputStatus!=='current')issues.push('A linked result is missing, stale or untracked.');return r?{key:r.key,raw:clone(r.raw),text:r.text,status:r.inputStatus||'current'}:null;}).filter(Boolean);
    if(!locators.some(e=>e.located)&&!linked.length)issues.push('No located source or current result supports this claim.');
    const claimNumbers=numbers(c.text.replace(/\{\{[^}]+\}\}/g,'')),sourceNumbers=[...locators.filter(e=>e.located).flatMap(e=>numbers(e.quote)),...linked.flatMap(r=>numbers(r.text))];
    if(claimNumbers.some(n=>!sourceNumbers.some(v=>Math.abs(n-v)<=1e-10)))issues.push('A literal quantity is not stated in the located evidence or saved result. Use result tokens or an explicitly reviewed derivation.');
    audited.push({id:c.id||id('claim'),text:c.text,locators,result_tokens:linked,issues:[...new Set(issues)],status:issues.length?'unresolved':'evidence-located',review:'Human assessment of meaning, direction and scientific support is still required.'});
  }
  return {at:new Date().toISOString(),sourceSnapshot,claims:audited,note:'Quote location and numeric consistency are checks, not proof that a source supports the claim.'};
}
export function proposeClaimReview(state,report,{model='',prompt=''}={}) {
  need(report.sourceSnapshot&&report.sourceSnapshot===proposalSourceSnapshot(state),'Source data changed since the claim check. Check the evidence again before proposing review.');
  const owner=state.project,epoch=store.projectGeneration?.();const items=report.claims.map(claim=>({
    label:claim.issues.length?'Keep unresolved claim':'Record human claim review',detail:JSON.stringify(claim,null,2),acceptLabel:claim.issues.length?'Keep unresolved':'Confirm support',payload:{kind:'claim-review',claim},
    accept:()=>{need(get().project===owner&&epoch===store.projectGeneration?.(),'The project was replaced.');return recordClaim(claim);} }));
  return file({view:'manuscript',title:'Evidence claim review',meta:model,prompt,sourceSnapshot:report.sourceSnapshot,note:'Confirm support only after comparing the claim with its sources. Failed checks remain unresolved.',items});
}
function recordClaim(claim){const reviewer=settingsOf(get()).reviewerInitials||settingsOf(get()).name||'';need(reviewer,'Set reviewer initials before recording claim review.');
  update(s=>{s.evidenceClaims=[...(s.evidenceClaims||[]).filter(c=>c.id!==claim.id),{...clone(claim),status:claim.issues.length?'unresolved':'human-reviewed',reviewer,reviewedAt:new Date().toISOString(),
    sourceSnapshot:claimSourceSnapshot(s,claim)}];return s;});return claim.issues.length?'Unresolved claim saved':'Human review recorded';}
registerProposalHandler('claim-review',({claim},{guard})=>{guard();return recordClaim(claim);});
function claimSourceSnapshot(state,claim){
  const tokenMap=new Map(results(state).map(r=>[r.key,r]));
  return JSON.stringify({sources:(claim.locators||[]).map(e=>{const p=(state.papers||[]).find(p=>p.id===e.doc_id);return {id:e.doc_id,source:p?[p.abstract,p.pdfHash,p.pdfAsset,p.documentVersion,p.pdf,p.pdfRel]:null};}),
    results:(claim.result_tokens||[]).map(t=>{const r=tokenMap.get(t.key);return r?[r.key,r.raw,r.inputStatus||'current']:null;})});
}
export function claimLedger(state){return (state.evidenceClaims||[]).map(c=>({...clone(c),currentSourceStatus:!c.sourceSnapshot?'untracked':c.sourceSnapshot===claimSourceSnapshot(state,c)?'current':'stale'}));}

export function proposeManuscriptUpdate(state,{block,text,result_tokens=[]},{model='',prompt='',write=false}={}) {
  const b=state.manuscript?.blocks?.find(b=>b.id===block);need(b&&!['table','figure','toc','bib'].includes(b.type),'Choose a manuscript paragraph.');
  need(typeof text==='string'&&text.trim()&&text.length<=12000,'Supply a bounded replacement paragraph.');const before=textOf(b),same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
  need(same(citations(before).map(c=>[c.key,c.locator]),citations(text).map(c=>[c.key,c.locator])),'Preserve existing citation markers exactly.');
  const original=resultKeys(before),next=resultKeys(text);need(original.every(k=>next.includes(k)),'Preserve existing result tokens.');
  const current=new Map(results(state).map(r=>[r.key,r]));
  for(const key of [...next,...result_tokens])need(current.has(key)&&(!current.get(key).inputStatus||current.get(key).inputStatus==='current'),`Result ${key} is missing, stale or untracked.`);
  const added=numbers(text.replace(/\{\{[^}]+\}\}|\[@[^\]]+\]/g,'')).filter(n=>!numbers(before.replace(/\{\{[^}]+\}\}|\[@[^\]]+\]/g,'')).includes(n));
  need(!added.length,'New quantities must use linked result tokens. Do not type computed numbers into a manuscript update.');
  const payload={kind:'manuscript-update',block,text,expectedHash:hashText(before),tokens:next.map(k=>({key:k,raw:clone(current.get(k).raw)}))};
  // from the chat: written in the paragraph as a tracked change by the assistant (lib/tracked-edit.mjs), the same checks passed
  if(write){const change=assistantChange();let done=false;
    update(s=>{const i=s.manuscript.blocks.findIndex(x=>x.id===block),x=s.manuscript.blocks[i],y=x&&hashText(textOf(x))===payload.expectedHash?trackedRewrite(x,text,change):null;
      if(y){y.researchUpdate={at:new Date().toISOString(),resultTokens:next};s.manuscript.blocks[i]=y;done=true;}return s;});
    if(done){const w={view:'manuscript',block,write:change.write,label:'Updated paragraph'};announceWrites([w]);return {written:w};}}
  const owner=state.project,epoch=store.projectGeneration?.();
  return file({view:'manuscript',title:'Update evidence-linked paragraph',meta:model,prompt,items:[{label:'Review paragraph change',manuscriptEdit:true,preview:manuscriptDiff(before,text),detail:`Before:\n${before}\n\nAfter:\n${text}`,acceptLabel:'Accept',payload,
    accept:()=>applyManuscript(payload,{guard:()=>need(get().project===owner&&epoch===store.projectGeneration?.(),'The project was replaced.')})}]});
}
function applyManuscript(p,{guard}){guard();const b=get().manuscript?.blocks?.find(b=>b.id===p.block);need(b&&hashText(textOf(b))===p.expectedHash,'The paragraph changed. Request an updated proposal.');const current=new Map(results(get()).map(r=>[r.key,r]));
  for(const t of p.tokens){const r=current.get(t.key);need(r&&(!r.inputStatus||r.inputStatus==='current')&&JSON.stringify(r.raw)===JSON.stringify(t.raw),'A linked result changed. Request an updated paragraph.');}
  update(s=>{const b=s.manuscript.blocks.find(b=>b.id===p.block);b.text=p.text;b.runs=[{t:p.text}];b.researchUpdate={at:new Date().toISOString(),resultTokens:p.tokens.map(t=>t.key)};return s;});return 'Paragraph updated';}
registerProposalHandler('manuscript-update',applyManuscript);

export function budgetPlan(state,{phases=[],calls,tokens,provider=''}={},cap={calls:20,tokens:80000}) {
  const ceiling={calls:Number(calls??cap.calls),tokens:Number(tokens??cap.tokens)};
  need(Number.isInteger(ceiling.calls)&&ceiling.calls>=1&&ceiling.calls<=48&&Number.isInteger(ceiling.tokens)&&ceiling.tokens>=1000&&ceiling.tokens<=200000,'Choose 1–48 calls and 1000–200000 tokens.');
  need(ceiling.calls<=cap.calls&&ceiling.tokens<=cap.tokens,'A plan cannot increase this turn’s budget. Propose a reviewed budget for a future turn.');
  need(Array.isArray(phases)&&phases.length<=16,'Use at most sixteen phases.');
  const allocations=phases.map(p=>({title:String(p.title||'').trim().slice(0,160),calls:Number(p.calls),tokens:Number(p.tokens)}));
  need(allocations.every(p=>p.title&&Number.isInteger(p.calls)&&p.calls>=0&&Number.isInteger(p.tokens)&&p.tokens>=0),'Each phase needs a title and nonnegative whole call/token allocations.');
  need(allocations.reduce((n,p)=>n+p.calls,0)<=ceiling.calls&&allocations.reduce((n,p)=>n+p.tokens,0)<=ceiling.tokens,'Phase allocations exceed the budget.');
  return {ceiling,phases:allocations,outputLimit:outputLimitPolicy({provider}),estimate:true,note:'Allocations are planning estimates. Execution has one enforced call ceiling and measured token accounting; no unlimited continuation.'};
}
export function proposeBudget(state,{threadId,calls,tokens},{model='',prompt=''}={}){
  const plan=budgetPlan(state,{calls,tokens},{calls:48,tokens:200000});need(state.threads?.some(t=>t.id===threadId),'Choose an existing chat.');const payload={kind:'chat-budget',threadId,budget:plan.ceiling};
  return file({view:'overview',title:'Change future chat budget',meta:model,prompt,items:[{label:'Apply future-turn budget',detail:`${calls} model calls, ${tokens} measured tokens. An active turn keeps its original ceiling.`,acceptLabel:'Apply',payload,accept:()=>applyBudget(payload)}]});
}
function applyBudget(p){update(s=>{const t=s.threads?.find(t=>t.id===p.threadId);need(t,'Chat was removed.');t.budget=clone(p.budget);return s;});return 'Future-turn budget updated';}
registerProposalHandler('chat-budget',(p,{guard})=>{guard();return applyBudget(p);});
