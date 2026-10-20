import { BLOCKS } from './flow-blocks.mjs';
import { SOURCES } from './sources.mjs';
import { SITES } from './site-search.mjs';
import { routedInput } from './flow-routing.mjs';
export function appendNodeLog(run,nodeId,event,message) {
  const logs=(run.nodeLogs||={})[nodeId]||=[];
  if(event==='progress'&&logs.at(-1)?.message===String(message))return;
  logs.push({at:new Date().toISOString(),event,message:String(message||event)});
  if(logs.length>200){logs.splice(0,logs.length-200);(run.logsTrimmed||={})[nodeId]=true;}
}
const inputLabel=b=>{if(!b)return 'Input';const label=b.label||BLOCKS.find(d=>d.id===b.type)?.label||b.type;return b.type==='search'?`${label} · ${[...SOURCES,...SITES].find(s=>s.id===(b.source||'pubmed'))?.name||b.source}`:label;};
export function blockInputs(run,nodeId) {
  if(run.flow.blocks.find(b=>b.id===nodeId)?.type==='input')return [{label:'Workflow caller',active:true,records:run.input?.records||[],text:run.input?.text||''}];
  return (run.flow.edges||[]).filter(e=>e.to===nodeId).map(edge=>({label:inputLabel(run.flow.blocks.find(b=>b.id===edge.from)),port:edge.port||'main',...routedInput(run.flow,run,edge)}));
}
