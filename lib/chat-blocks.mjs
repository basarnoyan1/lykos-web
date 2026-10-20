import { icon } from './icons.mjs';
import { artifactHtml } from './research-artifacts.mjs';
import { esc, sanitizeSvg } from './html.mjs';
import { projectLibraryIndex } from './project-index.mjs';
import { safeAnswerUrl, CHAT_VIEWS } from './chat-content.mjs';
import { renderChatInline } from './chat-math.mjs';
import { renderOutput, previewHtml } from './output-render.mjs';
import { survivalInputStatus, chatSurvivalPlot } from './survival-run.mjs';
import { uiLink, disclosure } from './ui-components.mjs';
import { uiBar, uiList, uiRow } from './ui-actions.mjs';
import { doiQuery, doiRecords } from './doi.mjs';
import { suggestionState } from './task-suggest.mjs';
import { studyColumn } from './chat-study.mjs';
import { queryWords } from './assistant-work.mjs';
const btn=(action,key,text,disabled=false)=>`<button type="button" data-chat-action="${action}" data-chat-key="${key}"${disabled?' disabled':''}>${esc(text)}</button>`;
// A block's acts are builder bars: the id carries where the block is drawn (log, details, live) so one block shown twice never repeats an id.
const act=(mode,action,key,label,extra={})=>({id:`chat-${mode}-${action}-${key}`,label,attrs:{'data-chat-action':action,'data-chat-key':key},...extra});
const actBar=(mode,name,key,label,actions,cls)=>actions.length?uiBar({kind:'foot',label,id:`chat-${mode}-${name}-${key}`,...(cls?{cls}:{}),actions}):'';
const GENERIC_TITLE=/^(query result|results?)$/i;
const shownTitle=b=>b.type==='table'&&GENERIC_TITLE.test(String(b.title||'').trim())&&b.provenance?.query?.from?queryWords(b.provenance.query)||b.title:b.title;
const viewLabel=view=>view==='search'?'Literature':view.charAt(0).toUpperCase()+view.slice(1);
const taskExists=(s,text)=>(s.todos||[]).some(t=>t.text===text);
export const paperTask=p=>`Read: ${p.title}`.slice(0,240);
export const paperUrl=p=>safeAnswerUrl(p.url)|| (p.pmid?`https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(p.pmid)}/`:p.doi?`https://doi.org/${encodeURIComponent(p.doi)}`:'');
// The records of a papers block as a list: the title opens the preview, the authors and a source link are the detail line, and (in the details view)
// Add to Library and Create task are the two control columns.
function paperList(records,b,key,state,index,{detailed,mode}) {
 const shown=records.slice(0,detailed?20:3);
 if(!shown.length)return '';
 return uiList({label:'Records',cls:'chat-paper-list',cols:detailed?['add','task']:[],rows:shown.map(p=>{
  const id=`${key}:${b.records.indexOf(p)}`,known=index.find(p),url=paperUrl(p),task=taskExists(state,paperTask(p));
  const meta=[p.authors?.slice(0,2).join(', '),p.year,p.journal].filter(Boolean).join(' · ');
  return uiRow({cls:'chat-paper',main:{html:`<button class="chat-paper-title" data-chat-action="preview" data-chat-key="${id}">${esc(p.title||'Untitled record')}</button>`,wrap:true,
    detail:[esc(meta),url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Source ↗</a>`:'']},
   cells:detailed?[{col:'add',kind:'control',html:btn('add',id,known?'In Library':'Add to Library',!!known)},{col:'task',kind:'control',html:btn('paper-task',id,task?'Task added':'Create task',task)}]:[]});
 })});
}
export function renderAnswerBlocks(blocks,turn,state,{detailed=false,offset=0,live=false}={}) {
 let index;
 const mode=live?'live':detailed?'detail':'log';
 return (blocks||[]).slice(0,12).map((b,j)=>{
  const key=`${turn}:${j+offset}`;let body='';
  if(b.type==='budget'&&b.budget){const p=b.budget,phases=Array.isArray(p.phases)?p.phases:[],quantity=n=>Number.isFinite(Number(n))?Number(n).toLocaleString():'Unavailable';body=`<p class="chat-block-note">${esc(quantity(p.ceiling?.calls))} model calls · ${esc(quantity(p.ceiling?.tokens))} measured tokens</p>${phases.length?`<table aria-label="Research phase allocations"><thead><tr><th scope="col">Phase</th><th scope="col">Calls</th><th scope="col">Tokens</th></tr></thead><tbody>${phases.map(x=>`<tr><th scope="row">${esc(x?.title)}</th><td>${esc(quantity(x?.calls))}</td><td>${esc(quantity(x?.tokens))}</td></tr>`).join('')}</tbody></table>`:''}<p class="chat-block-note">${esc(p.outputLimit?.note||'Budget estimates require provider usage checks.')}</p>`;}
  if(b.type==='claims'&&b.report){const claims=(Array.isArray(b.report.claims)?b.report.claims:[]).filter(Boolean).map(c=>({...c,issues:Array.isArray(c.issues)?c.issues:['Claim checks unavailable.']}));body=`<p class="chat-block-note">${claims.filter(c=>!c.issues.length).length} with located evidence · ${claims.filter(c=>c.issues.length).length} unresolved</p><table aria-label="Evidence claim checks"><thead><tr><th scope="col">Claim</th><th scope="col">Check</th><th scope="col">Evidence</th></tr></thead><tbody>${(detailed?claims:claims.slice(0,4)).map(c=>`<tr><th scope="row">${esc(c.text)}</th><td>${esc(c.issues.length?c.issues.join(' '):'Evidence located; human review required')}</td><td>${esc((Array.isArray(c.locators)?c.locators:[]).filter(Boolean).map(e=>`${e.doc_id}${e.page?` · p. ${e.page}`:''}${e.located?'':' · Unverified'}`).concat((Array.isArray(c.result_tokens)?c.result_tokens:[]).filter(Boolean).map(t=>`{{${t.key}}}`)).join('; '))}</td></tr>`).join('')}</tbody></table><p class="chat-block-note">${esc(b.report.note)}</p>`;}
  if(b.type==='papers'){
   index??=projectLibraryIndex(state);
   const doi=doiQuery(b.query),records=doiRecords(b.query,b.records),total=doi?records.length:b.total;
   body=`${b.query?`<p class="chat-block-note">${esc(b.query)}</p>`:''}${doi&&!records.length?`<p class="chat-block-note">No exact DOI match in ${esc(b.title||'this source')}.</p>`:''}${paperList(records,b,key,state,index,{detailed,mode})}${total!=null?`<p class="chat-block-note">${Math.min(records.length,detailed?20:3)} shown · ${esc(total)} matching ${total===1?'record':'records'}</p>`:''}`;
  }
  if(b.type==='progress'){
   const c=b.counts||{},total=Number(b.total)||0,attached=Number(c.attached_pdf)||0,decided=(Number(c.include)||0)+(Number(c.exclude)||0);
   body=`<div class="chat-progress"><div><span>PDFs attached</span><strong>${attached} / ${total}</strong></div><progress aria-label="PDFs attached" value="${attached}" max="${Math.max(1,total)}"></progress><div><span>Screening decided</span><strong>${decided} / ${total}</strong></div><progress aria-label="Screening decided" value="${decided}" max="${Math.max(1,total)}"></progress><p class="chat-block-note">${esc(c.missing_pdf||0)} missing attachments · ${esc(c.undecided||0)} undecided · ${esc(c.uncertain||0)} uncertain</p></div>${actBar(mode,'progress',key,'Progress actions',[act(mode,'view',`${key}:library`,'Open Library'),act(mode,'view',`${key}:screening`,'Open Screening')])}<p class="chat-block-note">Counts at response time</p>`;
  }
  // Suggested tasks: Add is the acceptance (lib/task-suggest.mjs addSuggested, the add_task op's own write); its label never changes, so
  // nothing moves: a suggestion an open task already says is drawn disabled with the reason as its tooltip.
  if(b.type==='actions' && b.items?.length)body=uiList({label:'Suggested tasks',cls:'chat-action-list',cols:['task'],rows:(b.items||[]).slice(0,detailed?8:3).map((a,k)=>{
   const have=suggestionState(a.text,state),nav=a.view&&CHAT_VIEWS.includes(a.view);
   return uiRow({main:{html:nav?`<button class="chat-action-name" data-chat-action="navigate" data-chat-key="${key}:${k}">${esc(a.text)}</button>`:esc(a.text)},
    cells:[{col:'task',...(detailed||nav?{kind:'control',html:`<button type="button" class="quiet" data-chat-action="task" data-chat-key="${key}:${k}" aria-label="${esc(have?`${have}: ${a.text}`:`Add to tasks: ${a.text}`)}" title="${esc(have||'Add to tasks')}"${have?' disabled':''}>Add</button>`}:{kind:'visual',html:''})}]});})});
  // A table with no rows is one line, not a bare header with its Copy and Download; a stored query result is named for what it asked, so a stack of them is told apart.
  const emptyTable=b.type==='table'&&!(b.rows||[]).length;
  const study=b.type==='table'&&!emptyTable?studyColumn(state,b.columns,b.rows||[]):null;
  if(emptyTable)body='<p class="chat-block-note">No rows matched.</p>';
  else if(b.type==='table')body=`<div class="chat-table-wrap" tabindex="0" aria-label="${esc(shownTitle(b))}"><table style="--cols:${(b.columns||[]).length||1}"><thead><tr>${(b.columns||[]).map(x=>`<th>${renderChatInline(x)}</th>`).join('')}</tr></thead><tbody>${(b.rows||[]).slice(0,detailed?100:4).map((r,k)=>`<tr>${r.map((x,c)=>`<td>${study?.col===c&&study.ids[k]!=null?`<button type="button" class="chat-paper-title" data-chat-action="study" data-chat-key="${key}:${k}" data-paper-id="${esc(study.ids[k])}" title="Open study">${renderChatInline(x)}</button>`:renderChatInline(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  if(b.type==='metrics')body=`<dl class="chat-metrics">${(b.items||[]).map(x=>`<div><dt>${esc(x.label)}</dt><dd>${esc(x.value)} ${esc(x.unit||'')}</dd></div>`).join('')}</dl>`;
  if(b.type==='bars'){
   const max=Math.max(1,...(b.items||[]).map(x=>Number(x.value)||0));
   body=`<div class="chat-bars">${(b.items||[]).map(x=>`<div><span>${esc(x.label)}</span><strong>${esc(x.value)} ${esc(x.unit||'')}</strong><progress aria-label="${esc(x.label)}" max="${max}" value="${Math.max(0,Number(x.value)||0)}"></progress></div>`).join('')}</div>`;
  }
  // A proposed table or figure, drawn from the project as it is now.
  if(b.type==='output'&&b.spec){
   let inner;try{inner=previewHtml(renderOutput(state,b.spec),{rows:6,groups:1,width:380});}catch(error){inner=`<p class="chat-block-note">${esc(error.message)}</p>`;}
   body=`<div class="chat-output">${inner}</div>${btn('view',`${key}:outputs`,'Open tables and figures')}`;
  }
  if(b.type==='workflow'){
   const r=b.data||{};
   body=`${r.status?`<p>${esc(r.status)}${r.error?` · ${esc(r.error)}`:''}</p>`:''}${r.items?`<ul class="chat-workflow-list">${r.items.map(x=>`<li><strong>${esc(x.label||x.name||x.id)}</strong><span>${esc(x.state||x.status||'')}</span></li>`).join('')}</ul>`:''}${r.logs?.length?`<details><summary>Block log · ${r.logs.length}</summary>${r.logs.map(l=>`<p class="chat-block-note">${esc(l.event)} · ${esc(l.message)}</p>`).join('')}</details>`:''}${r.text?`<details><summary>Output</summary><p>${esc(r.text)}</p></details>`:''}${btn('view',`${key}:workflows`,'Open workflows')}`;
  }
  if(b.type==='artifact'&&b.artifact)body=detailed?artifactHtml(b.artifact):`<p class="chat-block-note">Draft ${esc(b.artifact.kind)} · ${b.artifact.sections.length} sections${b.artifact.sources.length?` · ${b.artifact.sources.length} sources`:''}</p>`;
  if(b.type==='survival'&&b.analysis?.ext?.km){
   const status=survivalInputStatus(state,b.analysis),ext=b.analysis.ext,excluded=ext.population?.excluded||[];
   body=`${status==='stale'?'<p class="chat-block-note" role="status">Patient data changed. This figure shows the frozen cohort at response time; draw it again before using current results.</p>':status==='untracked'?'<p class="chat-block-note">This figure has no verified input snapshot.</p>':''}<div class="chat-table-wrap" role="region" tabindex="0" aria-label="Kaplan–Meier curve and number at risk"><div class="chat-survival-figure chart-svg">${sanitizeSvg(chatSurvivalPlot(b.analysis,'screen'))}</div></div>${ext.km.warnings.map(w=>`<p class="chat-block-note">${esc(w)}</p>`).join('')}${detailed&&excluded.length?disclosure({title:'Excluded patients',meta:String(excluded.length),body:`<ul>${excluded.map(x=>`<li>${esc(x.id)} · ${esc(x.why)}</li>`).join('')}</ul>`}):''}`;
  }
  if(b.type==='plan'&&b.plan){
   const steps=b.plan.steps,done=steps.filter(s=>s.status==='done').length;
   const pending=steps.filter(s=>s.status!=='done');
   const shown=detailed||live?steps:pending.length?pending.slice(0,3):steps.slice(-3);
   body=`<p class="chat-block-note">${esc(b.plan.objective)}</p><ol class="research-plan">${shown.map(s=>`<li data-state="${s.status}"><span class="plan-status" title="${esc(s.status)}">${icon(s.status==='done'?'check':s.status==='blocked'?'close':s.status==='active'?'run':'minus')}</span><div>${!live&&CHAT_VIEWS.includes(s.view)?uiLink({ label: s.title, attrs: { 'data-chat-action': 'plan-step', 'data-chat-key': `${key}:${steps.indexOf(s)}` } }):`<span>${esc(s.title)}</span>`}${(detailed||live&&['active','blocked'].includes(s.status))&&s.detail?`<p class="meta">${esc(s.detail)}</p>`:''}</div><span class="meta">${esc(s.status)}</span></li>`).join('')}</ol><p class="chat-block-note">${done} of ${steps.length} steps completed</p>${detailed&&b.plan.deliverables.length?`<p>${esc(b.plan.deliverables.join(' · '))}</p>`:''}`;
  }
  if(b.type==='progress'&&!detailed){const c=b.counts||{};body=`<p class="chat-block-note">${esc(c.attached_pdf||0)} PDFs attached · ${esc(c.undecided||0)} undecided · ${esc(c.uncertain||0)} uncertain</p><p class="chat-block-note">Counts at response time</p>`;}
  const downloadable=['artifact','table','metrics','bars','output','survival'].includes(b.type);
  if(['claims','budget'].includes(b.type)&&body)body=`<div class="chat-table-wrap" role="region" tabindex="0" aria-label="${esc(b.title||'Research results')}">${body}</div>`;
  const truncated=(b.type==='table'&&(b.rows||[]).length>4)||(b.type==='actions'&&(b.items||[]).length>3);
  const needsDetails=truncated||!['table','actions','metrics','bars'].includes(b.type);
  const controls=body&&!live&&!emptyTable ? actBar(mode,'controls',key,'Block actions',[
   ...(b.type==='table'?[act(mode,'copy-table',key,'Copy table')]:[]),
   ...(!detailed&&needsDetails?[act(mode,'details',key,b.type==='actions'?`All ${b.items.length} steps`:'Details')]:[]),
   ...(downloadable?[act(mode,'download',key,'Download',{icon:'download',menu:true})]:[]),
   ...(b.type==='artifact'&&detailed?[act(mode,'manuscript',key,'Insert in manuscript')]:[]),
   ...(b.type==='plan'&&b.plan?.steps?.some(s=>s.status!=='done')?[act(mode,'continue',key,'Continue research')]:[])],'chat-block-controls') : '';
  const title=b.type==='actions'?'Suggested tasks':shownTitle(b)||'Answer details';   // one word for model-suggested work, whatever the model titled it
  return body?`<section class="chat-block" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${body}${b.note&&!emptyTable?`<p class="chat-block-note">${esc(b.note)}</p>`:''}${controls}</section>`:'';
 }).join('');
}
export function wireAnswerBlocks(host,turns,actions) {
 host.querySelectorAll('[data-chat-action]').forEach(button=>button.onclick=async()=>{
  const [i,j,k]=button.dataset.chatKey.split(':'),b=turns[+i]?.blocks?.[+j];if(!b)return;
  const action=button.dataset.chatAction,record=b.records?.[+k],p=record&&doiRecords(b.query,[record]).length?record:null,item=b.items?.[+k];
  try{
   if(action==='study'&&button.dataset.paperId)actions.study?.(button.dataset.paperId);
   if(action==='details')actions.details?.(+i,+j);
   if(action==='download')actions.download?.(b,button);
   if(action==='manuscript')actions.manuscript?.(b.artifact,button);
   if(action==='continue')await actions.continue?.(b.plan);
   if(action==='plan-step'){const step=b.plan?.steps?.[+k];if(step&&CHAT_VIEWS.includes(step.view))await actions.go(step.view,step.paperId);}
   if(action==='preview'&&p)await actions.preview(p);
   if(action==='add'&&p)await actions.add(p);
   if(action==='paper-task'&&p)actions.task(paperTask(p));
   if(action==='task'&&item){const r=await actions.suggest?.(item);if(r?.refused)throw new Error(r.refused);}
   if(action==='navigate'&&item&&CHAT_VIEWS.includes(item.view))await actions.go(item.view,item.paperId);
   if(action==='view'&&CHAT_VIEWS.includes(k))await actions.go(k);
   if(action==='copy-table'){await navigator.clipboard.writeText([b.columns,...b.rows].map(r=>r.join('\t')).join('\n'));button.textContent='Copied';return;}
   if(['add','task','paper-task'].includes(action))actions.refresh();
  }catch(error){button.textContent='Try again';const note=button.closest('.chat-block')?.querySelector('.chat-block-error')||Object.assign(document.createElement('p'),{className:'chat-block-note chat-block-error',role:'alert'});note.textContent=String(error.message||error);button.closest('.chat-block')?.append(note);}
 });
}
