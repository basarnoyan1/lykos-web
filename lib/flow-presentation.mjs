import { plural } from './dates.mjs';
import { BLOCKS, FIELD_OPTIONS } from './flow-blocks.mjs';
import { SITES } from './site-search.mjs';
import { resolveFlowText } from './flow-text.mjs';
import { SOURCES } from './sources.mjs';
const option=(key,value)=>FIELD_OPTIONS[key]?.find(([id])=>id===value)?.[1];
// a counted noun as lib/dates.mjs writes it ("3 branches", "1,200 records")
const count=(n,label)=>plural(n,label,/(?:ch|sh|s|x)$/.test(label)?`${label}es`:`${label}s`);
const text=value=>resolveFlowText(String(value||''),{count:'Record count',output:'Previous step’s output'}).trim();
const endpoint=value=>{try{const url=new URL(value);return url.host+url.pathname;}catch{return '';}};
export function blockPresentation(block,{modelTeams=[],collections=[],workflows=[],models=[],papers=[],flow={blocks:[],edges:[]},blockIndex,inputIndex}={}) {
  const type=block.type,model=models.find(m=>m.id===block.modelId),definition=BLOCKS.find(b=>b.id===type),collection=collections.find(c=>c.id===block.collection);
  const sourceName=id=>[...SOURCES,...SITES].find(s=>s.id===(id||'pubmed'))?.name||id;
  const title=block.label||definition?.label||type;
  let primary='',secondary='',attention='';
  const need=label=>{attention=label;return label;};
  const sourceLabels=()=>{const incoming=id=>inputIndex?.get(id)||(flow.edges||[]).filter(e=>e.to===id).map(e=>e.from);const found=new Set(),seen=new Set(),queue=[...incoming(block.id)],byId=blockIndex||new Map((flow.blocks||[]).map(b=>[b.id,b]));while(queue.length){const id=queue.pop();if(seen.has(id))continue;seen.add(id);const b=byId.get(id);if(!b)continue;if(b.type==='search')found.add(sourceName(b.source));else if(['library','zotero','http','input'].includes(b.type))found.add(b.type==='library'?'Library':b.type==='http'?endpoint(b.url)||'JSON':b.type==='input'?'Workflow input':'Zotero');else queue.push(...incoming(id));}return [...found].reverse().join(' + ');};
  switch(type) {
    case 'search':primary=SITES.some(s=>s.id===block.source)?`${sourceName(block.source)} · your session`:`${sourceName(block.source)} · up to ${block.limit||100}`;secondary=String(block.query||(block.executor==='ai'?block.instructions:'')||'').trim()||need(block.executor==='ai'?'Add search instructions':'Add a query');break;
    case 'library':primary=block.collection?(collection?.name||need('Collection unavailable')):'Project library';secondary=count(collection?.members?.length??papers.length,'record');break;
    case 'zotero':primary='Zotero · local library';secondary=`Up to ${block.limit||100} records`;break;
    case 'http':primary=endpoint(block.url)||need('Choose an endpoint');secondary=`GET · ${count(Number(block.pages||1),'page')}${block.itemsPath?' · '+block.itemsPath:''}`;break;
    case 'dedupe':primary='DOI · PMID · record ID';secondary=sourceLabels()||'Connected records';break;
    case 'new_records':primary='Compare with project library';secondary='Pass only new records';break;
    case 'collect':primary=block.collection?(collection?.name||need('Collection unavailable')):'Project library';secondary=block.review?'Approval before saving':'Skip existing records';break;
    case 'filter':case 'condition':{
      const rules=[block.query?`${option('matchField',block.matchField||'all')}: ${block.matchMode==='excludes'?'not ':''}${block.query}`:'',block.requireField?option('requireField',block.requireField):'',block.yearFrom||block.yearTo?`${block.yearFrom||'Any year'}–${block.yearTo||'present'}`:''].filter(Boolean);
      primary=rules[0]||'All records';secondary=rules.slice(1).join(' · ')||(type==='condition'?'Match / other branches':'No other filters');break;
    }
    case 'sort':primary=option('sortBy',block.sortBy||'year');secondary=option('direction',block.direction||'desc');break;
    case 'limit':primary=`First ${block.limit||100} records`;secondary='Keep current order';break;
    case 'enrich':primary='Crossref · DOI lookup';secondary='Fill missing metadata';break;
    case 'abstracts':primary='Europe PMC + PubMed';secondary='Fill missing abstracts';break;
    case 'team':primary=modelTeams.find(t=>t.id===block.teamId)?.name||need('Choose a model team');secondary=block.instructions||need('Add instructions');break;
    case 'task':primary=block.executor==='human'?'Human review':model?.model||model?.label||need('Choose a model');secondary=block.instructions||need('Add instructions');break;
    case 'criteria':primary=model?.model||model?.label||need('Choose a model');secondary=block.text?'Protocol → criteria for approval':need('Add protocol criteria');break;
    case 'screen_pass':primary=option('passNumber',String(block.passNumber||1));secondary=model?.model||model?.label||need('Choose a Jev model');break;
    case 'screening':primary='3 Jev passes · consensus';secondary=model?.model||model?.label||need('Choose a Jev model');break;
    case 'consensus':primary='3 independent screening passes';secondary='Proposals + language rule';break;
    case 'extraction':primary=model?.model||model?.label||need('Choose a model');secondary='Field proposals + evidence';break;
    case 'dual_review':primary=block.stage==='ft'?'Full text':'Title & abstract';secondary='Two reviewers · resolve conflicts';break;
    case 'prisma':primary='Project reporting counts';secondary='Preserve unknown totals';break;
    case 'screening_sheet':primary='CSV · screening decisions';secondary='Reviews + model proposals';break;
    case 'export':primary=option('format',block.format||'csv');secondary='Download from run results';break;
    case 'merge':primary=count((flow.edges||[]).filter(e=>e.to===block.id).length,'input');secondary='Combine records + labelled text';break;
    case 'fanout':primary=count((flow.edges||[]).filter(e=>e.from===block.id).length,'branch');secondary='Same input to each branch';break;
    case 'subworkflow':case 'batch':primary=workflows.find(f=>f.id===block.workflowId)?.name||need('Choose a workflow');secondary=type==='batch'?`${count(Number(block.batchSize||10),'record')} per batch`:'Wait for workflow output';break;
    case 'wait':primary=`${count(Number(block.waitSeconds||5),'second')}`;secondary='Delay this branch';break;
    case 'input':primary='Records + text from caller';secondary='Reusable workflow entry';break;
    case 'output':primary='Return records + text';secondary='Back to calling workflow';break;
    case 'note':case 'todo':case 'notify':primary=text(block.text)||need('Add content');secondary=block.review?'Approval required':({note:'Save in Notes',todo:'Project task list',notify:'Project notifications'})[type];break;
    default:primary=definition?.label||type;secondary='';
  }
  if(block.executor==='ai'&&type!=='task')secondary=`${model?.model||model?.label||need('Choose a model')} · ${secondary}`;
  return {title,primary,secondary,attention};
}
