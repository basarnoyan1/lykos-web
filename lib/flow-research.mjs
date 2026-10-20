// Typed research outputs. Preparation never changes reviewer decisions or accepted values.
import { structureCriteria, mergeRules } from './criteria.mjs';
import { decide, screenMany, isJev } from './jev.mjs';
import { abstractQuestions, abstractState, abstractPass, abstractConsensus, enforceLanguageRule } from './jev-abstract.mjs';
import { rulesKey } from './rules-key.mjs';
import { extractFromAbstract } from './helpers.mjs';
import { fields } from './fields.mjs';
import { numberInQuote, parseNumber } from './numbers.mjs';
import { applyJevCrossCheck } from './screening-batch.mjs';
import { derive } from './prisma-counts.mjs';

export const RESEARCH_TYPES = new Set(['fanout','criteria','screen_pass','consensus','screening','dual_review','extraction','prisma','screening_sheet']);
const rulesOf = (s,stage='ta') => (s.protocol?.criteria || []).filter(r => (r.question || r.text) && (stage==='ft'||r.stage !== 'Full text'));
const evidence = r => JSON.stringify([r.id,r.title,r.doi,r.abstract,r.language,r.languages,r.languageSource]);
const snapshot = records => records.map(r=>({id:r.id,evidence:evidence(r)}));
// Two snapshots: `snapshot` is the evidence the step read (records an earlier
// block in the run may have enriched, with an abstract say); `library` is each
// Library record as it stood when the step began. A change to the Library
// during the run is what makes a result stale, not an enrichment within it.
const librarySnapshot = (s,records) => { const byId=new Map((s.papers||[]).map(p=>[p.id,p])); return records.map(r=>({id:r.id,evidence:evidence(byId.get(r.id)||{})})); };
export function assertResearchFresh(s,payload) {
  if(payload.rulesSnapshot && payload.rulesSnapshot !== rulesKey(rulesOf(s,payload.criteriaStage))) throw new Error('Criteria changed during this run. Start a new run.');
  for(const item of payload.library || payload.snapshot || []) if(evidence((s.papers||[]).find(r=>r.id===item.id)||{}) !== item.evidence) throw new Error('A record changed during this run. Start a new run.');
}
export function dualReviewReady(s,records,stage='ta') {
  const key=stage==='ft'?'fulltext':'screening';
  const pending=records.filter(r=>{
    const reviews=Object.entries(s.dual?.[stage]?.[r.id]||{}).filter(([who,d])=>who.trim()&&['include','exclude'].includes(d.decision)&&!d.needsCriteriaReview);
    const final=s[key]?.[r.id];
    return reviews.length<2 || !final || !['include','exclude'].includes(final.decision) || final.needsCriteriaReview || (!final.resolved && !reviews.every(([,d])=>d.decision===final.decision));
  });
  return {pending,records:records.filter(r=>s[key]?.[r.id]?.decision==='include')};
}
const csv = rows => rows.map(row=>row.map(v=>{let t=String(v??'');if(/^[\s]*[=+@-]/.test(t))t="'"+t;return '"'+t.replaceAll('"','""')+'"';}).join(',')).join('\r\n');
export function screeningSheet(s,records) {
  return csv([['ID','Title','DOI','Year','Title/abstract decision','Title/abstract reason','Full-text decision','Full-text reason','Independent reviews','Model proposal','Model rationale','Model run'],...records.map(r=>{
    const ta=s.screening?.[r.id],ft=s.fulltext?.[r.id],p=s.proposals?.ta?.[r.id];
    return [r.id,r.title,r.doi,r.year,ta?.decision,ta?.reason,ft?.decision,ft?.reason,JSON.stringify({ta:s.dual?.ta?.[r.id]||{},ft:s.dual?.ft?.[r.id]||{}}),p?.verdict,p?.reason||p?.triageNote,p?.runId];
  })]);
}
export function combinePasses(payloads,records,rules) {
  if(payloads.length!==3 || payloads.some(p=>p?.kind!=='screen_pass') || new Set(payloads.map(p=>p.passNumber)).size!==3 || payloads.some(p=>![1,2,3].includes(p.passNumber))) throw new Error('Consensus needs passes 1, 2 and 3 from separate screening blocks.');
  const snap=snapshot(records), hash=rulesKey(rules), expected=new Map(snap.map(r=>[r.id,r.evidence]));
  for(const p of payloads) if(p.rulesSnapshot!==hash || p.snapshot.length!==snap.length || p.snapshot.some(r=>expected.get(r.id)!==r.evidence) || p.items.length!==records.length || new Set(p.items.map(i=>i.id)).size!==records.length || p.items.some(i=>!expected.has(i.id))) throw new Error('All passes must use the same records and criteria.');
  return {kind:'screening',snapshot:snap,library:payloads[0].library,rulesSnapshot:hash,model:payloads.map(p=>p.model).join(' / '),items:records.map(record=>{
    const passes=[...payloads].sort((a,b)=>a.passNumber-b.passNumber).map(p=>p.items.find(i=>i.id===record.id).pass);
    const proposal=enforceLanguageRule(abstractConsensus(passes,rules),record,rules);
    return {id:record.id,proposal:{...proposal,rulesSnapshot:hash}};
  })};
}
export async function prepareResearch(block,{s,records,payloads=[],cfg,stop=()=>false,progress=()=>{},services={},signal}) {
  const check=()=>{if(stop())throw new Error('Workflow stopped.');};
  const criteriaStage=block.type==='dual_review'?block.stage||'ta':'ta';
  const rules=rulesOf(s,criteriaStage), base={snapshot:snapshot(records),library:librarySnapshot(s,records),rulesSnapshot:rulesKey(rules),criteriaStage};
  if(['screen_pass','screening','extraction','dual_review'].includes(block.type)) {
    // Decisions and values are kept on Library records; a search result not saved there has nowhere to go.
    const missing=records.filter(r=>!(s.papers||[]).some(p=>p.id===r.id)).length;
    if(missing)throw new Error(`Research steps need Library records; ${missing} of these ${missing===1?'is':'are'} not in the Library. Save them to the Library first.`);
    if(records.length>100)throw new Error('Limit research steps to 100 records per run.');
  }
  if(['screen_pass','screening'].includes(block.type)&&!rules.length)throw new Error('Add eligibility criteria to the protocol first.');
  if(['screen_pass','screening'].includes(block.type)&&!isJev(cfg))throw new Error('Choose a Jev decision model for screening.');
  if(['criteria','extraction'].includes(block.type)&&isJev(cfg))throw new Error('Choose a text model for this step.');
  if(block.type==='fanout')return {records,payload:payloads.length===1?payloads[0]:null,text:`${records.length} records to each branch`};
  if(block.type==='criteria') {
    const proposal=await (services.structureCriteria||structureCriteria)(block.text,cfg,{signal});check();
    if(!proposal.rules.length)throw new Error('No criteria were proposed.');
    return {records,payload:{kind:'criteria',proposal,protocol:JSON.stringify(s.protocol||{})},gate:'criteria',text:proposal.rules.map((r,i)=>`${i+1}. ${r.text}\n${r.kind} · ${r.stage}\nQuestion: ${r.question||r.text}\nYes: ${r.yes||'—'}\nNo: ${r.no||'—'}`).join('\n\n')};
  }
  if(block.type==='screen_pass') {
    const passNumber=Number(block.passNumber||1),items=[];
    for(const record of records) {check();progress(`Pass ${passNumber}: ${items.length+1} / ${records.length}`);const answers=await (services.decide||decide)(cfg,abstractState(record,rules),abstractQuestions(passNumber-1),{signal});check();items.push({id:record.id,pass:abstractPass(answers,passNumber)});}
    return {records,payload:{...base,kind:'screen_pass',passNumber,items,model:cfg.model},text:`Pass ${passNumber} · ${items.length} records`,artifact:{name:`screening-pass-${passNumber}.json`,type:'application/json',text:JSON.stringify({passNumber,model:cfg.model,rulesSnapshot:base.rulesSnapshot,items},null,2)}};
  }
  if(block.type==='consensus') {
    const payload=combinePasses(payloads,records,rules);assertResearchFresh(s,payload);
    return {records,payload,text:`${payload.items.length} screening proposals`};
  }
  if(block.type==='screening') {
    const items=[],errors=[];
    await (services.screenMany||screenMany)(records,rules,cfg,{stop,signal,skipDecided:false,onEach:(r,p)=>{if(p instanceof Error)errors.push(p);else items.push({id:r.id,proposal:p});progress(`${items.length} / ${records.length}`);}});check();
    if(errors.length)throw errors[0];if(items.length!==records.length)throw new Error('Screening did not finish.');
    return {records,payload:{...base,kind:'screening',items,model:cfg.model},text:`${items.length} screening proposals`};
  }
  if(block.type==='dual_review') {
    const ready=dualReviewReady(s,records,block.stage);
    return {records:ready.pending.length?records:ready.records,payload:{...base,kind:'dual_review',stage:block.stage||'ta'},gate:ready.pending.length?'dual_review':null,text:ready.pending.length?`${ready.pending.length} records await two reviewers and a resolved decision in Screening.`:`${ready.records.length} included records`};
  }
  if(block.type==='extraction') {
    const columns=fields(s),items=[];let done=0;
    for(const r of records) {check();progress(`Extracting: ${++done} / ${records.length}`);if(!r.abstract)continue;
      for(const v of await (services.extractFromAbstract||extractFromAbstract)(r,columns,cfg,{signal})) {
        const col=columns.find(c=>c.id===v.field);
        if(!col || !v.quote || !`${r.title||''}\n\n${r.abstract}`.toLowerCase().includes(v.quote.toLowerCase()))continue;
        if(['integer','number'].includes(col.type)&&(!Number.isFinite(parseNumber(v.value))||!numberInQuote(v.value,v.quote)))continue;
        if(s.values?.[`${r.id}:${v.field}`]||s.proposals?.[`${r.id}:${v.field}`])continue;
        items.push({id:r.id,...v});
      }check();
    }
    return {records,payload:{...base,kind:'extraction',columns:JSON.stringify(columns),items,model:cfg.model},text:`${items.length} values proposed`};
  }
  if(block.type==='prisma') {
    const derived=derive(s),entered=s.prisma||{},counts={...derived,...entered};
    return {records,text:`${Object.keys(counts).length} recorded counts`,artifact:{name:'prisma-counts.json',type:'application/json',text:JSON.stringify({at:new Date().toISOString(),derived,entered,counts},null,2)}};
  }
  if(block.type==='screening_sheet')return {records,text:`${records.length} records exported`,artifact:{name:'screening-sheet.csv',type:'text/csv',text:screeningSheet(s,records)}};
}
export function commitResearch(s,payload,runId,nodeId,records) {
  if(!payload || !['criteria','screening','extraction'].includes(payload.kind))return s;
  assertResearchFresh(s,payload);
  const at=new Date().toISOString();
  if(payload.kind==='criteria') {
    if(JSON.stringify(s.protocol||{})!==payload.protocol)throw new Error('Protocol changed while awaiting approval. Start a new run.');
    const p=s.protocol||{};s.protocol={...p,criteria:mergeRules(p.criteria||[],payload.proposal.rules),amendments:[...(p.amendments||[]),{at,note:'Workflow criteria approved',workflow:runId}]};
    for(const key of ['screening','fulltext'])for(const d of Object.values(s[key]||{}))d.needsCriteriaReview=true;
    for(const stage of Object.values(s.dual||{}))for(const reviewers of Object.values(stage))for(const d of Object.values(reviewers))d.needsCriteriaReview=true;
  }
  if(payload.kind==='screening') {
    const selected=new Set(records.map(r=>r.id)), byId=new Map(s.papers.map(p=>[p.id,p]));
    applyJevCrossCheck(s,{id:`${runId}:${nodeId}`,rulesSnapshot:payload.rulesSnapshot,model:payload.model,records:payload.items.filter(i=>selected.has(i.id)).map(i=>({id:i.id,identity:byId.get(i.id),proposal:i.proposal}))});
  }
  if(payload.kind==='extraction') {
    if(JSON.stringify(fields(s))!==payload.columns)throw new Error('Extraction fields changed during the run.');
    s.proposals ||= {};const selected=new Set(records.map(r=>r.id));
    for(const v of payload.items) {const key=`${v.id}:${v.field}`;if(!selected.has(v.id)||s.values?.[key]||s.proposals[key])continue;
      s.proposals[key]={paper_id:v.id,column_id:v.field,value:v.value,availability:'present',origin:'model',model:payload.model,run_id:runId,at,evidence:[{kind:'abstract',quote:v.quote}],rationale:`Abstract: ${v.quote}`};
    }
  }
  return s;
}
