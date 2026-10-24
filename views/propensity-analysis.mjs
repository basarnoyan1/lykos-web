// Propensity preprocessing and balance, beside the primary study analyses.
import { get, update, projectGeneration } from '../store.mjs';
import { analysisSources, sourceById, columnsFor } from '../lib/dataset-analysis.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { downloadCsv, wireDownload } from '../lib/figure.mjs';
import { uiBar } from '../lib/ui-actions.mjs';
import { saveFile } from '../lib/save.mjs';
import { PROPENSITY_VERSION, runPropensity, propensitySnapshot, propensityStatus, replayPropensity, propensityRows, propensityBalanceRows } from '../lib/propensity.mjs';
import { loadReplayEngine } from '../lib/primary-replay.mjs';
import { isMissing } from '../lib/data-rules.mjs';
import { rerenderForm } from '../lib/form-rerender.mjs';
import { formFit, formCells } from '../lib/ui-components.mjs';
import { plural } from '../lib/dates.mjs';

let selectedRun = null;
let pendingRun = null;
let runError = null;
const fx=(x,d=3)=>x==null || !Number.isFinite(x)?'—':Number(x).toFixed(d);
const configuration=(s,id)=>({method:'match',algorithm:'optimal',estimand:'ATE',treatment:'',treatedLevel:'',covariates:[],idColumn:'',scoreColumn:'',ratio:2,
  caliper:0.2,caliperUnits:'sd',commonSupport:'none',trimLower:0,trimUpper:1,stabilized:true,...s.propensitySetup?.[id]});
const treatmentLevels=(d,id)=>{
  const column=d.columns.find(c=>c.id===id);
  return [...new Set(d.rows.filter(r=>!isMissing(r[id],column)).map(r=>String(r[id]).trim()))].sort();
};
function currentConfiguration(s,d) {
  const cfg=configuration(s,d.id),ids=new Set(d.columns.map(c=>c.id));
  if (!ids.has(cfg.treatment) || treatmentLevels(d,cfg.treatment).length!==2) cfg.treatment='';
  if (!cfg.treatment || !treatmentLevels(d,cfg.treatment).includes(cfg.treatedLevel)) cfg.treatedLevel='';
  if (!ids.has(cfg.idColumn) || cfg.idColumn===cfg.treatment) cfg.idColumn='';
  if (!ids.has(cfg.scoreColumn) || cfg.scoreColumn===cfg.treatment || cfg.scoreColumn===cfg.idColumn) cfg.scoreColumn='';
  const available=new Set(columnsFor(d,'any').map(c=>c.id));
  cfg.covariates=cfg.covariates.filter(id=>available.has(id) && ![cfg.treatment,cfg.idColumn,cfg.scoreColumn].includes(id));
  return cfg;
}

function savedPanel(saved,result) {
  return saved.length?`<div class="panel"><div class="panel-head"><h2>Kept runs</h2></div><div class="panel-body an-settings">
    <label class="field" data-span="2"><span>Saved propensity design</span><select id="ps-saved"><option value="">Choose a saved design</option>${saved.map(r=>`<option value="${esc(r.id)}"${r.id===result?.id?' selected':''}>${esc(r.datasetName || r.datasetId)}, ${esc(r.settings.method==='match'?`${r.settings.algorithm==='nearest-neighbor'?'Nearest neighbor':'Optimal'} 1:${r.settings.ratio}`:`IPTW ${r.settings.estimand}`)}, ${esc(String(r.at || '').slice(0,19).replace('T',' '))}</option>`).join('')}</select></label>
    </div></div>`:'';
}

function wireSaved(el,ctx,result) {
  el.querySelector('#ps-saved')?.addEventListener('change',e=>{selectedRun=e.target.value || null;rerenderForm(el,ctx);});
  if (!result) return;
  wireDownload(el.querySelector('#ps-download'),[{label:'Export rows as CSV',icon:'export',run:()=>downloadCsv(propensityRows(result),'propensity-rows.csv')},
    {label:'Export balance as CSV',icon:'export',run:()=>downloadCsv(propensityBalanceRows(result),'propensity-balance.csv')},
    {label:'Export run as JSON',icon:'export',run:()=>saveFile(JSON.stringify(result,null,2),'propensity-run.json','application/json')}]);
  el.querySelector('#ps-replay').onclick=()=>{
    const message=el.querySelector('#ps-replay-message');
    try {
      const replay=replayPropensity(result),same=JSON.stringify([replay.rows,replay.pairs,replay.balance,replay.excluded])===JSON.stringify([result.rows,result.pairs,result.balance,result.excluded]);
      message.textContent=same?'Replay reproduced the saved design with the current engine.':'Replay differs from the saved design.';
    } catch(err) {message.textContent=err.message;}
  };
}

// Run and keep waits for these, in order; the title bar's status says the first one missing.
const needsOf=cfg=>pendingRun?'Preparing the replay':!cfg.treatment?'Choose the treatment':!cfg.treatedLevel?'Choose the treated level':!cfg.covariates.length?'Choose covariates'
  :cfg.method==='match'&&cfg.algorithm==='nearest-neighbor'&&!cfg.caliperUnits?'Choose caliper units':'';
const sourceOf=s=>sourceById(s.propensityDatasetId,s) || analysisSources(s)[0];
// Run and keep is the title bar's: the page drawn last binds what it runs.
const acts={};

/** The propensity part of the title bar (views/analysis.mjs page()): Run and keep, and beside the title what it waits for or the covariates chosen. */
export function propensityPage() {
  const s=get(),d=sourceOf(s);
  if(!d) return {title:'Propensity adjustment',actions:[]};
  const cfg=currentConfiguration(s,d),needs=needsOf(cfg);
  return {title:'Propensity adjustment',...(needs?{status:{text:needs,ch:24}}:{}),
    actions:[{id:'ps-run',label:'Run and keep',icon:'run',role:'primary',disabled:!!needs,run:button=>acts.run?.(button)}]};
}

export function renderPropensity(el,ctx) {
  const s=get(),sources=analysisSources(s),d=sourceOf(s),saved=s.propensityAnalyses || [];
  const result=saved.find(r=>r.id===selectedRun) || (d?saved.filter(r=>r.datasetId===d.id):saved).at(-1);
  const resultSource=result?sourceById(result.datasetId,s):null,status=propensityStatus(result,resultSource);
  if(!d) {
    el.innerHTML=emptyState({icon:'analysis',title:'No participant dataset',actions:[{id:'ps-data',label:'Datasets',icon:'dataset',primary:true}]})
      +savedPanel(saved,result)+(result?resultHtml(result,'unavailable'):'');
    el.querySelector('#ps-data').onclick=()=>ctx.go('datasets');wireSaved(el,ctx,result);return;
  }
  const cfg=currentConfiguration(s,d);
  // A select whose longest option needs more than one column's width (about 22 characters at 200px) is declared wide.
  const wide=options=>options.some(([,l])=>String(l).length>22)?' data-span="2"':'';
  const select=(key,label,options,cur=cfg[key])=>`<label class="field"${wide(options)}><span>${esc(label)}</span><select data-ps="${key}" data-form-key="ps:${key}">${options.map(([v,l])=>`<option value="${esc(v)}"${String(cur)===String(v)?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
  const input=(key,label)=>`<label class="field"><span>${esc(label)}</span><input data-ps="${key}" data-form-key="ps:${key}" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(cfg[key] ?? '')}"></label>`;
  const fit=html=>formFit(formCells(html));
  const stabilized=()=>`<label class="cr-check"><input type="checkbox" data-ps="stabilized" data-form-key="ps:stabilized"${cfg.stabilized?' checked':''}><span>Stabilized ATE weights</span></label>`;
  const section=(id,title,body)=>`<section class="an-section" aria-labelledby="${id}"><h3 id="${id}">${esc(title)}</h3>${body}</section>`;
  const treatment=d.columns.filter(c=>c.type!=='date' && treatmentLevels(d,c.id).length===2),levels=cfg.treatment?treatmentLevels(d,cfg.treatment):[];
  const covariates=columnsFor(d,'any').filter(c=>![cfg.treatment,cfg.idColumn,cfg.scoreColumn].includes(c.id));
  let setupChanged=false;
  if(result?.datasetId===d.id) {try {setupChanged=propensitySnapshot(d,cfg)!==result.inputSnapshot;} catch {setupChanged=true;}}
  const datasets=sources.map(ds=>[ds.id,ds.name]);
  // the three groups' fields; a check beside them (Stabilized ATE weights) is a cell of the grid like a field
  const dataFields=`<label class="field"${wide(datasets)}><span>Dataset</span><select id="ps-source">${datasets.map(([v,l])=>`<option value="${esc(v)}"${v===d.id?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`
    +select('treatment','Treatment',[['','Choose'],...treatment.map(c=>[c.id,c.label])])+select('treatedLevel','Treated level',[['','Choose'],...levels.map(l=>[l,l])])
    +select('idColumn','Row identifier',[['','Stored ID / source row number'],...d.columns.filter(c=>![cfg.treatment,cfg.scoreColumn].includes(c.id)).map(c=>[c.id,c.label])]);
  const modelFields=select('scoreColumn','Propensity score',[['','Fit logistic model'],...columnsFor(d,'numeric').filter(c=>![cfg.treatment,cfg.idColumn].includes(c.id)).map(c=>[c.id,c.label])]);
  const adjustFields=select('method','Adjustment',[['match','Propensity score matching'],['iptw','Inverse probability weighting']])
    +(cfg.method==='match'?select('algorithm','Matching algorithm',[['optimal','Optimal complete assignment'],['nearest-neighbor','Nearest neighbor 1:1, may drop treated rows']])+select('ratio','Controls per treated',(cfg.algorithm==='nearest-neighbor'?[1]:[1,2,3,4,5]).map(n=>[n,`1:${n}`]))+input('caliper','Logit caliper, blank for none')+select('caliperUnits','Caliper units',[['','Choose units'],['sd','Baseline logit SD'],['absolute','Absolute logit distance']])
      :select('estimand','Estimand',[['ATE','ATE'],['ATT','ATT']])+(cfg.estimand==='ATE'?stabilized():''))
    +select('commonSupport','Common support',[['none','Keep all interior scores'],['overlap','Restrict to overlapping ranges']])+input('trimLower','PS lower bound')+input('trimUpper','PS upper bound');
  el.innerHTML=`<div class="panel">
    <div class="panel-body">
      ${section('ps-h-data','Data',`<div class="an-settings"${fit(dataFields)}>${dataFields}</div>`)}
      ${section('ps-h-model','Model',`<div class="an-settings"${fit(modelFields)}>${modelFields}
        <div class="field an-checks" role="group" aria-label="Pretreatment covariates"><span>Pretreatment covariates</span>
        ${covariates.map(c=>`<label class="cr-check"><input type="checkbox" data-ps-cov="${esc(c.id)}" data-form-key="${esc(`ps:cov:${c.id}`)}"${cfg.covariates.includes(c.id)?' checked':''}><span>${esc(c.label)}</span></label>`).join('') || '<span>No eligible covariate columns</span>'}</div></div>
        `)}
      ${section('ps-h-adjust',cfg.method==='match'?'Matching':'Weighting',`<div class="an-settings"${fit(adjustFields)}>${adjustFields}</div>`)}
      <div class="note" id="ps-message" role="status">${runError?.epoch===projectGeneration() && runError.datasetId===d.id?esc(runError.message):''}</div></div></div>
    ${savedPanel(saved,result)}
    ${result?resultHtml(result,resultSource?status:'unavailable',setupChanged):''}`;
  const change=(key,value)=>{
    runError=null;
    const next={...cfg,[key]:value};
    if(key==='algorithm'&&value==='nearest-neighbor'&&value!==cfg.algorithm){next.ratio=1;next.caliperUnits='';}
    if(key==='treatment' && value!==cfg.treatment) next.treatedLevel='';
    if(key==='treatment' && value===next.idColumn) next.idColumn='';
    if(key==='treatment' && value===next.scoreColumn) next.scoreColumn='';
    next.covariates=next.covariates.filter(id=>![next.treatment,next.idColumn,next.scoreColumn].includes(id));
    update(st=>{st.propensitySetup ||= {};st.propensitySetup[d.id]=next;return st;});rerenderForm(el,ctx);
  };
  el.querySelector('#ps-source').onchange=e=>{update(st=>{st.propensityDatasetId=e.target.value;return st;});selectedRun=null;rerenderForm(el,ctx);};
  el.querySelectorAll('[data-ps]').forEach(x=>x.onchange=()=>change(x.dataset.ps,x.type==='checkbox'?x.checked:x.value));
  el.querySelectorAll('[data-ps-cov]').forEach(x=>x.onchange=()=>{
    const cov=cfg.covariates.filter(id=>id!==x.dataset.psCov);if(x.checked) cov.push(x.dataset.psCov);change('covariates',cov);
  });
  acts.run=async button=>{
    if(pendingRun) return;
    runError=null;
    const message=el.querySelector('#ps-message');if(button) button.disabled=true;
    const run={data:structuredClone(d),settings:structuredClone(cfg),epoch:projectGeneration()};pendingRun=run;
    try {
      const result=runPropensity(run.data,run.settings);let replayNotice=null;
      message.textContent='Preparing the frozen replay source…';
      try {const pack=await loadReplayEngine();result.implementation={engineFingerprint:pack.fingerprint,version:PROPENSITY_VERSION};}
      catch {result.implementation={engineFingerprint:null,version:PROPENSITY_VERSION};replayNotice='Replay source unavailable. Frozen inputs are kept; rebuild and rerun for an executable export.';}
      if(projectGeneration()!==run.epoch) return;
      const currentSource=sourceById(run.data.id,get());
      if(!currentSource || propensitySnapshot(currentSource,currentConfiguration(get(),currentSource))!==result.inputSnapshot) throw new Error('Source data or setup changed while preparing replay. Run the current design again.');
      if(replayNotice) result.replayNotice=replayNotice;
      result.id=`ps${Date.now().toString(36)}-${(get().propensityAnalyses || []).length+1}`;
      update(st=>{st.propensityAnalyses=[...(st.propensityAnalyses || []),result];return st;});selectedRun=result.id;
      ctx.refreshCounts?.();
    } catch(err) {if(projectGeneration()===run.epoch)runError={epoch:run.epoch,datasetId:run.data.id,message:err.message};}
    finally {pendingRun=null;if(projectGeneration()===run.epoch) ctx.rerender();}
  };
  wireSaved(el,ctx,result);
}

function resultHtml(r,status,setupChanged=false) {
  const label=id=>r.frozenData?.columns.find(c=>c.id===id)?.label || id;
  return `<div class="panel">${uiBar({kind:'head',label:'Saved design',id:'ps-result-head',lead:{title:'Saved design'},message:{id:'ps-source-status',text:status==='unavailable'?'Source unavailable, saved inputs retained':status==='stale'?'Source changed, saved inputs retained':'Source unchanged'},
      actions:[{id:'ps-download',label:'Download',icon:'download',menu:true},{id:'ps-replay',label:'Replay saved',icon:'refresh'}]})}
    <div class="panel-body"><p>${esc(r.method)}</p>${setupChanged?'<div class="note">Setup changed, saved settings retained</div>':''}${r.replayNotice?`<div class="note">${esc(r.replayNotice)}</div>`:''}<div class="note" id="ps-replay-message" role="status"></div>
      <table><tbody><tr><th>Dataset</th><td>${esc(r.datasetName || r.datasetId)}</td></tr>
        <tr><th>Treatment / treated level</th><td>${esc(label(r.settings.treatment))} / ${esc(r.settings.treatedLevel)}</td></tr>
        <tr><th>Pretreatment covariates</th><td>${esc(r.settings.covariates.map(label).join(', '))}</td></tr>
        <tr><th>Propensity scores</th><td>${esc(r.settings.scoreColumn?label(r.settings.scoreColumn):'Fitted logistic model')}</td></tr>
        ${r.settings.method==='match'?`<tr><th>Matching algorithm</th><td>${r.settings.algorithm==='nearest-neighbor'?'Nearest neighbor 1:1, no replacement, ascending Row ID':'Optimal complete assignment, no replacement'}</td></tr><tr><th>Declared caliper</th><td>${r.settings.caliper==null?'None':`${esc(r.settings.caliper)} ${r.settings.caliperUnits==='sd'?'baseline logit SDs':'absolute logit distance'}`}</td></tr>`:''}
        <tr><th>Score restrictions</th><td>${r.settings.trimLower} to ${r.settings.trimUpper}; ${r.settings.commonSupport==='overlap'?'common support':'all interior scores'}</td></tr>
        <tr><th>Input / complete / retained</th><td>${r.nInput} / ${r.nComplete} / ${r.nRetained}</td></tr>
        <tr><th>Treated / control rows</th><td>${r.groups.treated.n} / ${r.groups.control.n}</td></tr>
        <tr><th>Effective sample size</th><td>${fx(r.groups.treated.ess,1)} / ${fx(r.groups.control.ess,1)}</td></tr>
        <tr><th>Largest weight</th><td>${fx(r.groups.treated.maxWeight)} / ${fx(r.groups.control.maxWeight)}</td></tr>
        <tr><th>PS treated range</th><td>${r.overlap.treated.map(x=>fx(x)).join(' to ')}</td></tr>
        <tr><th>PS control range</th><td>${r.overlap.control.map(x=>fx(x)).join(' to ')}</td></tr>
        <tr><th>Common range</th><td>${r.overlap.empty?'No overlap':r.overlap.common.map(x=>fx(x)).join(' to ')}</td></tr>
        ${r.totalDistance!=null?`<tr><th>Total absolute logit distance</th><td>${fx(r.totalDistance)}</td></tr><tr><th>Absolute caliper</th><td>${r.absoluteCaliper==null?'None':fx(r.absoluteCaliper)}</td></tr>`:''}
        <tr><th>Target population</th><td>${esc(r.target)}</td></tr></tbody></table>
      <p data-ui-help>Weights and matched sets are exported for outcome analysis. Inference must account for weighting or matched dependence; this design supplies no outcome intervals.</p>
      ${r.model?.warnings?.length?`<div class="note">${r.model.warnings.map(w=>esc(w.message)).join('; ')}</div>`:''}
    </div></div>
    <div class="panel"><div class="panel-head"><h2>Covariate balance</h2></div><div class="panel-body"><div class="note">${esc(r.balanceMethod)}</div>
      <table><thead><tr><th scope="col">Variable</th><th class="num" scope="col">Treated before</th><th class="num" scope="col">Control before</th><th class="num" scope="col">Treated after</th><th class="num" scope="col">Control after</th><th class="num" scope="col">SMD before</th><th class="num" scope="col">SMD after</th></tr></thead><tbody>
        ${r.balance.map(b=>`<tr><th scope="row">${esc(b.variable)}</th><td class="num">${fx(b.treatedBefore)}</td><td class="num">${fx(b.controlBefore)}</td><td class="num">${fx(b.treatedAfter)}</td><td class="num">${fx(b.controlAfter)}</td><td class="num">${fx(b.smdBefore)}</td><td class="num">${fx(b.smdAfter)}</td></tr>`).join('')}</tbody></table></div></div>
    ${r.excluded.length?`<div class="panel"><div class="panel-head"><h2>Exclusions</h2><span class="meta">${r.excluded.length}</span></div><div class="panel-body"><table><thead><tr><th>Row ID</th><th>Source row</th><th>Reason</th></tr></thead><tbody>${r.excluded.map(e=>`<tr><td>${esc(e.id)}</td><td>${e.row}</td><td>${esc(e.reason)}</td></tr>`).join('')}</tbody></table></div></div>`:''}`;
}
