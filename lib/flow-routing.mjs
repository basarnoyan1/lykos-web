import { filterRecords } from './flow-blocks.mjs';
import { outputRecords } from './flow-records.mjs';
export const isSettled = status => ['done','skipped','error'].includes(status);
export function routedInput(flow, run, edge) {
  const state=run.nodeStates?.[edge.from]||(run.steps?.some(s=>s.nodeId===edge.from)?'done':undefined);
  if(edge.port==='error')return {active:state==='error',records:[],text:run.nodeDetails?.[edge.from]?.error||''};
  if(state!=='done')return {active:false,records:[],text:''};
  const source=flow.blocks.find(b=>b.id===edge.from);
  const records=outputRecords(run,edge.from),text=run.texts?.[edge.from]||'';
  if(source?.type!=='condition')return {active:true,records,text};
  const matched=new Set(filterRecords(records,source));
  const selected=records.filter(r=>(edge.port==='other')!==matched.has(r));
  return {active:selected.length>0,records:selected,text};
}
