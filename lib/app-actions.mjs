// Chat uses the same registered view actions and human proposal gate as menus.
import * as aid from './aid.mjs';
import { get } from '../store.mjs';
import { paperOf } from './change-ops.mjs';
const clip = (v,n=300) => String(v ?? '').slice(0,n);
export function actionContext(args={}, captured={}, state=get()) {
  const view = args.view || captured.view || 'overview';
  const ctx = view === captured.view ? {...captured} : {view};
  ctx.view = view;
  if(args.paper) {
    const p=paperOf(args.paper,state);if(!p)throw new Error('Record not found; use an id from query_library.');
    ctx.focus={kind:'paper',paperId:p.id,label:p.label,text:p.abstract||'',stage:args.stage||'ta'};
    ctx.document=null;ctx.selection='';
  }
  if(args.block) {
    const b=state.manuscript?.blocks?.find(b=>b.id===args.block);if(!b)throw new Error('Manuscript block not found; read manuscript_outline first.');
    ctx.focus={kind:'block',blockId:b.id,blockType:b.type,label:b.type,text:b.text||''};ctx.document=null;ctx.selection='';
  }
  if(args.stage && ctx.focus)ctx.focus={...ctx.focus,stage:args.stage};
  // Batch extraction remains available in the view; chat starts with one paper.
  return ctx;
}
export async function listAppActions(args={},captured={}) {
  await aid.ensureAid();
  if(!args.view)return {views:aid.actionViews(),current_view:captured.view||null,note:'Pass view to see available actions. Optional paper or block chooses its target; otherwise the captured screen focus is used.'};
  const ctx=actionContext(args,captured);
  const actions=aid.actionsFor(ctx.view,ctx).filter(a=>ctx.focus?.paperId||!['read-abstract','chart-sources','read-fulltext'].includes(a.id));
  return {view:ctx.view,target:clip(ctx.focus?.label),actions:actions.map(a=>({id:a.id,label:a.label,task:a.task,local:!!a.local,ready:!!a.local||aid.hasModel(a.task)})),note:'Run only actions requested by the user. Model actions use the configured task model; results await review in Proposals.'};
}
export async function runAppAction(args,captured={},signal) {
  if(signal?.aborted)throw new DOMException('Stopped','AbortError');
  await aid.ensureAid();
  if(signal?.aborted)throw new DOMException('Stopped','AbortError');
  const ctx=actionContext(args,captured);
  const a=aid.actionsFor(ctx.view,ctx).find(a=>a.id===args.action);
  if(!a)throw new Error('Action unavailable for this target; list_app_actions again.');
  if(!ctx.focus?.paperId&&['read-abstract','chart-sources','read-fulltext'].includes(a.id))throw new Error('Choose one paper for this extraction action.');
  const entry=await aid.run(ctx.view,a.id,{...ctx,signal});
  if(signal?.aborted)throw new DOMException('Stopped','AbortError');
  if(entry.status!=='done')throw new Error(entry.error||`Action ${entry.status}.`);
  return {entry_id:entry.id,title:entry.title,model:entry.meta,status:'awaiting_review',items:entry.items.slice(0,12).map(i=>({label:clip(i.label),detail:clip(i.detail,800),quote:clip(i.quote,800),requires_acceptance:!!i.accept})),total:entry.items.length,note:'Results are in Proposals. No proposed change has been accepted or applied.'};
}
