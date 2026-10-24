// Design-stage propensity adjustment: complete minimum-cost assignment, or
// explicitly selected greedy 1:1 nearest-neighbor matching, without replacement.
// Outcomes are deliberately absent: matched/weighted outcome inference needs
// its own covariance model and is not supplied by these preprocessing weights.
import { logisticRegression } from './stats-regression.mjs';
import { cellValue } from './datasets.mjs';
import { isMissing } from './data-rules.mjs';

export const PROPENSITY_VERSION = 'propensity-design-v1';
export const MATCHING_CELL_LIMIT = 250_000;
const sum = xs => xs.reduce((a,b)=>a+b,0);
const mean = xs => sum(xs)/xs.length;
const variance = xs => { const m=mean(xs);return xs.length > 1 ? sum(xs.map(x=>(x-m)**2))/(xs.length-1) : 0; };
const logit = p => Math.log(p/(1-p));
const range = xs => xs.reduce(([lo,hi],x)=>[Math.min(lo,x),Math.max(hi,x)],[Infinity,-Infinity]);

/** Rectangular Hungarian assignment. Infinity forbids an edge; every row must be assigned. */
export function minimumCostAssignment(cost) {
  const n=cost.length,m=cost[0]?.length || 0;
  if (!n || n>m || cost.some(r=>r.length!==m || r.some(x=>x!==Infinity && !Number.isFinite(x)))) throw new Error('Invalid assignment matrix');
  if (n*m > MATCHING_CELL_LIMIT) throw new Error(`Matching exceeds the ${MATCHING_CELL_LIMIT.toLocaleString()} distance-cell limit`);
  const u=new Float64Array(n+1),v=new Float64Array(m+1),p=new Int32Array(m+1),way=new Int32Array(m+1);
  for(let i=1;i<=n;i++) {
    p[0]=i;let j0=0;
    const minv=new Float64Array(m+1).fill(Infinity),used=new Uint8Array(m+1);
    do {
      used[j0]=1;const i0=p[j0];let delta=Infinity,j1=0;
      for(let j=1;j<=m;j++) if(!used[j]) {
        const cur=cost[i0-1][j-1]-u[i0]-v[j];
        if(cur<minv[j]) { minv[j]=cur;way[j]=j0; }
        if(minv[j]<delta) { delta=minv[j];j1=j; }
      }
      if(!Number.isFinite(delta)) throw new Error('No complete assignment satisfies the caliper; widen it, reduce the ratio or revise the analysis population');
      for(let j=0;j<=m;j++) if(used[j]) { u[p[j]]+=delta;v[j]-=delta; } else minv[j]-=delta;
      j0=j1;
    } while(p[j0]!==0);
    do { const j1=way[j0];p[j0]=p[j1];j0=j1; } while(j0!==0);
  }
  const assignment=new Array(n);
  for(let j=1;j<=m;j++) if(p[j]) assignment[p[j]-1]=j-1;
  return { assignment,cost:sum(assignment.map((j,i)=>cost[i][j])) };
}

/** Declared matching on absolute logit distance, without replacement. */
export function matchScores(rows,{ratio=1,caliper=Infinity,algorithm='optimal'}={}) {
  if(!Number.isInteger(ratio) || ratio<1 || ratio>5 || !(caliper>=0)) throw new Error('Choose a ratio of 1–5 and a nonnegative caliper');
  if(!['optimal','nearest-neighbor'].includes(algorithm)) throw new Error('Choose optimal or nearest-neighbor matching');
  if(algorithm==='nearest-neighbor' && ratio!==1) throw new Error('Nearest-neighbor matching currently supports exactly 1:1');
  if(rows.some(r=>!(r.ps>0 && r.ps<1) || ![0,1].includes(r.treatment)) || new Set(rows.map(r=>r.id)).size!==rows.length) throw new Error('Matching needs distinct row IDs, binary treatment and interior propensity scores');
  if(algorithm==='nearest-neighbor') return nearestNeighborScores(rows,caliper);
  const treated=rows.filter(r=>r.treatment===1).sort((a,b)=>a.id.localeCompare(b.id));
  const controls=rows.filter(r=>r.treatment===0).sort((a,b)=>a.id.localeCompare(b.id));
  if(!treated.length || controls.length<ratio*treated.length) throw new Error(`Complete 1:${ratio} matching needs ${ratio*treated.length} controls for ${treated.length} treated rows; ${controls.length} are available`);
  const slots=treated.flatMap(r=>Array.from({length:ratio},()=>r));
  if(slots.length*controls.length > MATCHING_CELL_LIMIT) throw new Error(`Matching exceeds the ${MATCHING_CELL_LIMIT.toLocaleString()} distance-cell limit`);
  const distances=slots.map(t=>controls.map(c=>Math.abs(logit(t.ps)-logit(c.ps))));
  const result=minimumCostAssignment(distances.map(r=>r.map(d=>d<=caliper?d:Infinity)));
  const selected=new Map(),pairs=treated.map((t,i)=>{
    const matched=result.assignment.slice(i*ratio,(i+1)*ratio).map(j=>controls[j]);
    const set=`match${i+1}`;selected.set(t.id,{weight:1,set});matched.forEach(c=>selected.set(c.id,{weight:1/ratio,set}));
    return {set,treated:t.id,controls:matched.map(c=>c.id),distance:sum(matched.map(c=>Math.abs(logit(t.ps)-logit(c.ps))))};
  });
  return {pairs,cost:result.cost,rows:rows.map(r=>({...r,...(selected.get(r.id)||{weight:0,set:''})})),ratio,caliper};
}

function nearestNeighborScores(rows,caliper) {
  const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
  const treated=rows.filter(r=>r.treatment===1).sort(byId),controls=rows.filter(r=>r.treatment===0).sort(byId);
  if(!treated.length || !controls.length) throw new Error('Nearest-neighbor matching needs both treatment groups');
  if(treated.length*controls.length>MATCHING_CELL_LIMIT) throw new Error(`Matching exceeds the ${MATCHING_CELL_LIMIT.toLocaleString()} distance-cell limit`);
  const unused=new Set(controls.map(c=>c.id)),selected=new Map(),pairs=[];
  for(const t of treated) {
    let best=null,distance=Infinity;
    for(const c of controls) if(unused.has(c.id)) {
      const d=Math.abs(logit(t.ps)-logit(c.ps));
      if(d<=caliper && d<distance) {best=c;distance=d;}
    }
    if(!best) continue;
    const set=`match${pairs.length+1}`;unused.delete(best.id);selected.set(t.id,{weight:1,set});selected.set(best.id,{weight:1,set});
    pairs.push({set,treated:t.id,controls:[best.id],distance});
  }
  if(!pairs.length) throw new Error('No treated row has an unused control within the declared nearest-neighbor caliper');
  return {pairs,cost:sum(pairs.map(p=>p.distance)),rows:rows.map(r=>({...r,...(selected.get(r.id)||{weight:0,set:''})})),ratio:1,caliper,algorithm:'nearest-neighbor'};
}

/** ATE inverse-probability weights (optionally stabilized); ATT odds weights. */
export function iptwWeights(rows,{estimand='ATE',stabilized=false,treatedPrevalence=null}={}) {
  if(!['ATE','ATT'].includes(estimand) || rows.some(r=>!(r.ps>0 && r.ps<1) || ![0,1].includes(r.treatment))) throw new Error('IPTW requires ATE/ATT, binary treatment and scores strictly between 0 and 1');
  if(!rows.some(r=>r.treatment===1) || !rows.some(r=>r.treatment===0)) throw new Error('IPTW requires both treatment groups');
  if(estimand==='ATT' && stabilized) throw new Error('ATT uses treated=1 and control=PS/(1−PS); stabilization is offered for ATE');
  const pt=treatedPrevalence ?? mean(rows.map(r=>r.treatment));
  if(!(pt>0 && pt<1)) throw new Error('Invalid treatment prevalence');
  return rows.map(r=>{
    const weight=estimand==='ATT'?(r.treatment?1:r.ps/(1-r.ps)):
      r.treatment?(stabilized?pt:1)/r.ps:(stabilized?1-pt:1)/(1-r.ps);
    if(!Number.isFinite(weight)) throw new Error('A propensity weight is not finite; revise the declared trimming bounds');
    return {...r,set:'',weight};
  });
}

const weightedMean=(rows,key)=>{const scale=range(rows.map(r=>r.weight))[1];if(!(scale>0)) return null;const w=rows.map(r=>r.weight/scale),sw=sum(w);return sum(rows.map((r,i)=>w[i]*r.covariates[key]))/sw;};
export const effectiveSampleSize = weights => { const scale=range(weights)[1];if(!(scale>0)) return 0;const scaled=weights.map(w=>w/scale),sw=sum(scaled),sw2=sum(scaled.map(w=>w*w));return sw2>0?sw*sw/sw2:0; };

/** Fixed pre-adjustment SD denominators: treated for ATT; pooled for ATE. Binary levels are standardized too. */
export function balanceTable(before,after,{estimand='ATT'}={}) {
  const keys=Object.keys(before[0]?.covariates || {}),t=before.filter(r=>r.treatment===1),c=before.filter(r=>r.treatment===0);
  if(!t.length || !c.length) throw new Error('Balance requires both treatment groups');
  const at=after.filter(r=>r.treatment===1 && r.weight>0),ac=after.filter(r=>r.treatment===0 && r.weight>0);
  return keys.map(key=>{
    const tv=t.map(r=>r.covariates[key]),cv=c.map(r=>r.covariates[key]);
    const binary=[...tv,...cv].every(x=>x===0 || x===1);
    const vt=binary?mean(tv)*(1-mean(tv)):variance(tv),vc=binary?mean(cv)*(1-mean(cv)):variance(cv);
    const sd=Math.sqrt(estimand==='ATT'?vt:(vt+vc)/2);
    const b=mean(tv)-mean(cv),mt=weightedMean(at,key),mc=weightedMean(ac,key),a=mt==null || mc==null?null:mt-mc;
    const standardized=x=>x==null?null:sd>0?x/sd:x===0?0:null;
    return {variable:key,binary,denominator:sd,treatedBefore:mean(tv),controlBefore:mean(cv),treatedAfter:mt,controlAfter:mc,
      differenceBefore:b,differenceAfter:a,smdBefore:standardized(b),smdAfter:standardized(a)};
  });
}

function settingsOf(d,options={}) {
  const method=options.method || 'match',estimand=method==='match'?'ATT':options.estimand || 'ATE';
  const settings={method,estimand,treatment:options.treatment || '',treatedLevel:String(options.treatedLevel ?? ''),
    algorithm:options.algorithm || 'optimal',
    covariates:[...new Set(options.covariates || [])],idColumn:options.idColumn || '',scoreColumn:options.scoreColumn || '',
    ratio:Number(options.ratio ?? 2),caliper:options.caliper==='' || options.caliper==null?null:Number(options.caliper),
    caliperUnits:options.caliperUnits || 'sd',commonSupport:options.commonSupport || 'none',
    trimLower:Number(options.trimLower ?? 0),trimUpper:Number(options.trimUpper ?? 1),
    stabilized:method==='iptw' && estimand==='ATE' && Boolean(options.stabilized)};
  const ids=[settings.treatment,...settings.covariates,settings.idColumn,settings.scoreColumn].filter(Boolean);
  if(!['match','iptw'].includes(method) || !['ATE','ATT'].includes(estimand) || ids.some(id=>!d.columns.some(c=>c.id===id))) throw new Error('Choose valid source columns and a method');
  if(!['optimal','nearest-neighbor'].includes(settings.algorithm)) throw new Error('Choose optimal or nearest-neighbor matching');
  if(method==='match' && settings.algorithm==='nearest-neighbor' && settings.ratio!==1) throw new Error('Nearest-neighbor matching currently supports exactly 1:1');
  if(method==='match' && settings.algorithm==='nearest-neighbor' && settings.caliper!=null && !Object.hasOwn(options,'caliperUnits')) throw new Error('Declare whether the nearest-neighbor caliper uses baseline logit SDs or absolute logit distance');
  if(!settings.treatment || !settings.covariates.length || settings.covariates.includes(settings.treatment)) throw new Error('Choose treatment and pretreatment covariates');
  if(!(settings.trimLower>=0 && settings.trimUpper<=1 && settings.trimLower<settings.trimUpper)) throw new Error('Choose trimming bounds between 0 and 1');
  if(!['sd','absolute'].includes(settings.caliperUnits) || !['none','overlap'].includes(settings.commonSupport)) throw new Error('Invalid caliper or support rule');
  if(settings.caliper!=null && !(settings.caliper>=0 && Number.isFinite(settings.caliper))) throw new Error('Invalid caliper');
  return settings;
}

/** Exact scientific input record, including row identities, coding, rules and unit metadata. */
export function propensitySnapshot(d,options) {
  const settings=settingsOf(d,options);
  // Saved v1 designs predating algorithm selection used optimal assignment.
  // Preserve their original input record for status checks and frozen replay.
  if(!Object.hasOwn(options || {},'algorithm')) delete settings.algorithm;
  const ids=[...new Set([settings.treatment,...settings.covariates,settings.idColumn,settings.scoreColumn,d.rowKey].filter(Boolean))].sort();
  return JSON.stringify({version:PROPENSITY_VERSION,settings,datasetId:d.id,rowKey:d.rowKey || '',rowIds:d.rowIds || null,
    columns:ids.map(id=>d.columns.find(c=>c.id===id)),rows:d.rows.map(r=>Object.fromEntries(ids.map(id=>[id,r[id] ?? ''])))});
}

export function runPropensity(d,options={}) {
  const settings=settingsOf(d,options),snapshot=propensitySnapshot(d,settings),excluded=[];
  const column=id=>d.columns.find(c=>c.id===id),treatmentColumn=column(settings.treatment);
  const levels=[...new Set(d.rows.filter(r=>!isMissing(r[settings.treatment],treatmentColumn)).map(r=>String(r[settings.treatment]).trim()))].sort();
  if(levels.length!==2 || !levels.includes(settings.treatedLevel)) throw new Error('Treatment must have exactly two levels; choose the treated level');
  const numeric=c=>['number','integer'].includes(c.type);
  const specs=settings.covariates.map(id=>({column:id,type:numeric(column(id))?'numeric':'categorical'}));
  const covariateName=id=>{const label=column(id).label || id;return specs.filter(c=>(column(c.column).label || c.column)===label).length>1?`${label} [${id}]`:label;};
  const identifiers=d.rows.map((r,i)=>String(settings.idColumn?r[settings.idColumn] ?? '':d.rowIds?.[i] ?? (d.rowKey?r[d.rowKey]:`row:${i+1}`)).trim());
  if(identifiers.some(id=>!id) || new Set(identifiers).size!==identifiers.length) throw new Error('Row identifiers must be nonempty and unique');
  const prepared=[];
  d.rows.forEach((r,i)=>{
    const source={};let reason='';
    for(const id of [settings.treatment,...settings.covariates,...(settings.scoreColumn?[settings.scoreColumn]:[])]) {
      const c=column(id);
      if(isMissing(r[id],c)) { reason=`Missing ${c.label || id}`;break; }
      source[id]=numeric(c)?cellValue(r[id],c.type):String(r[id]).trim();
      if(source[id]==null) { reason=`Invalid ${c.label || id}`;break; }
    }
    if(reason) { excluded.push({id:identifiers[i],row:i+1,reason});return; }
    prepared.push({id:identifiers[i],row:i+1,source,treatment:String(r[settings.treatment]).trim()===settings.treatedLevel?1:0});
  });
  if(!prepared.some(r=>r.treatment===1) || !prepared.some(r=>r.treatment===0)) throw new Error('Complete cases must contain both treatment groups');
  let model=null;
  if(!settings.scoreColumn) {
    model=logisticRegression(prepared.map(r=>r.source),settings.treatment,specs,{event:settings.treatedLevel,profile:false});
    if(!model.converged || model.warnings.some(w=>w.code==='separation' || w.code==='not-converged')) throw new Error('The propensity logistic model is separated or did not converge; revise the covariates or supply reviewed scores');
    if(model.nUsed!==prepared.length) throw new Error('Propensity model excluded unexpected rows');
  }
  const covariateLevels=Object.fromEntries(specs.filter(c=>c.type==='categorical').map(c=>[c.column,[...new Set(prepared.map(r=>String(r.source[c.column])))].sort()]));
  const scored=prepared.map((r,i)=>({...r,ps:settings.scoreColumn?Number(r.source[settings.scoreColumn]):model.fitted[i],covariates:Object.fromEntries(specs.flatMap(c=>c.type==='numeric'?[[covariateName(c.column),r.source[c.column]]]:
    covariateLevels[c.column].map(level=>[`${covariateName(c.column)} = ${level}`,String(r.source[c.column])===level?1:0])))}));
  const interior=scored.filter(r=>{
    if(!(Number.isFinite(r.ps) && r.ps>0 && r.ps<1)) { excluded.push({id:r.id,row:r.row,reason:'Propensity score outside (0, 1): positivity'});return false; }
    return true;
  });
  const t=interior.filter(r=>r.treatment===1),c=interior.filter(r=>r.treatment===0);
  if(!t.length || !c.length) throw new Error('Positivity exclusions removed a treatment group');
  const tr=range(t.map(r=>r.ps)),cr=range(c.map(r=>r.ps)),overlap=[Math.max(tr[0],cr[0]),Math.min(tr[1],cr[1])];
  const eligible=interior.filter(r=>{
    const reason=r.ps<settings.trimLower || r.ps>settings.trimUpper?'Propensity trimming':
      settings.commonSupport==='overlap' && (r.ps<overlap[0] || r.ps>overlap[1])?'Outside common support':'';
    if(reason) excluded.push({id:r.id,row:r.row,reason});return !reason;
  });
  if(!eligible.some(r=>r.treatment===1) || !eligible.some(r=>r.treatment===0)) throw new Error('Trimming/support restrictions removed a treatment group');
  let adjusted,pairs=[],cost=null,absoluteCaliper=null;
  if(settings.method==='match') {
    absoluteCaliper=settings.caliper==null?Infinity:settings.caliper*(settings.caliperUnits==='sd'?Math.sqrt(variance(interior.map(r=>logit(r.ps)))):1);
    const matched=matchScores(eligible,{ratio:settings.ratio,caliper:absoluteCaliper,algorithm:settings.algorithm});
    adjusted=matched.rows;pairs=matched.pairs;cost=matched.cost;
    adjusted.filter(r=>r.weight===0).forEach(r=>excluded.push({id:r.id,row:r.row,reason:r.treatment?'Unmatched treated row: no unused control within the caliper':'Unmatched control'}));
  } else adjusted=iptwWeights(eligible,{estimand:settings.estimand,stabilized:settings.stabilized,treatedPrevalence:mean(interior.map(r=>r.treatment))});
  const balance=balanceTable(interior,adjusted,{estimand:settings.estimand});
  const used=new Map(adjusted.map(r=>[r.id,r]));
  const exclusions=new Map(excluded.map(e=>[e.id,e.reason]));
  const output=interior.map(r=>({...r,...(used.get(r.id)||{weight:0,set:''}),reason:exclusions.get(r.id) || ''}));
  const groupStats=group=>{const rows=adjusted.filter(r=>r.treatment===group && r.weight>0),weights=rows.map(r=>r.weight);return {n:rows.length,ess:effectiveSampleSize(weights),weightSum:sum(weights),maxWeight:weights.length?range(weights)[1]:null};};
  const frozen=JSON.parse(snapshot);
  return {version:PROPENSITY_VERSION,at:new Date().toISOString(),datasetId:d.id,datasetName:d.name,settings,inputSnapshot:snapshot,
    frozenData:{id:d.id,name:d.name,rowKey:frozen.rowKey,rowIds:frozen.rowIds,columns:frozen.columns,rows:frozen.rows},
    rows:output.map(({source,...r})=>r),excluded,pairs,totalDistance:cost,absoluteCaliper:Number.isFinite(absoluteCaliper)?absoluteCaliper:null,
    balance,overlap:{treated:tr,control:cr,common:overlap,empty:overlap[0]>overlap[1]},groups:{treated:groupStats(1),control:groupStats(0)},
    nInput:d.rows.length,nComplete:prepared.length,nScored:interior.length,nRetained:adjusted.filter(r=>r.weight>0).length,
    model:model?{coefficients:model.coefficients,converged:model.converged,iterations:model.iterations,warnings:model.warnings}:null,
    deterministic:true,seed:null,method:settings.method==='match'?(settings.algorithm==='nearest-neighbor'?'Greedy 1:1 nearest-neighbor matching on absolute propensity-logit distance, without replacement; ascending treated Row ID; equal-distance controls use ascending Row ID; ATT preprocessing weights for retained treated rows':`Complete 1:${settings.ratio} minimum-cost assignment on absolute propensity-logit distance, without replacement; ATT preprocessing weights`):
      `${settings.estimand} inverse-probability weights${settings.stabilized?' stabilized by the complete-case treatment prevalence':''}`,
    balanceMethod:`Standardized differences use fixed baseline ${settings.estimand==='ATT'?'treated':'pooled'} SDs; categorical levels use Bernoulli variances. No outcome inference.`,
    target:settings.method==='match'?(settings.algorithm==='nearest-neighbor'?'Treated complete cases satisfying the score restrictions and obtaining a nearest-neighbor match':'Treated complete cases satisfying the declared score restrictions'):'Complete cases satisfying the declared score restrictions',
    references:['https://kosukeimai.github.io/MatchIt/articles/matching-methods.html','https://kosukeimai.github.io/MatchIt/reference/method_nearest.html','https://ngreifer.github.io/WeightIt/reference/get_w_from_ps.html','https://ngreifer.github.io/cobalt/articles/cobalt.html']};
}

export function propensityStatus(saved,d) {
  if(!saved) return 'none';if(!d) return 'stale';
  try { return propensitySnapshot(d,saved.settings)===saved.inputSnapshot?'current':'stale'; } catch { return 'stale'; }
}
export function replayPropensity(saved) {
  if(saved?.version!==PROPENSITY_VERSION || !saved.frozenData) throw new Error('Unsupported propensity replay record');
  if(propensitySnapshot(saved.frozenData,saved.settings)!==saved.inputSnapshot) throw new Error('Frozen propensity inputs differ from the saved snapshot');
  return runPropensity(saved.frozenData,saved.settings);
}
export function propensityRows(saved) {
  const ids=new Set(saved.rows.map(r=>r.id));
  return [['Row ID','Source row','Treatment','Propensity score','Weight','Matched set','Exclusion reason'],
    ...saved.rows.map(r=>[r.id,r.row,r.treatment,r.ps,r.weight,r.set,r.reason]),
    ...saved.excluded.filter(e=>!ids.has(e.id)).map(e=>[e.id,e.row,'','','','',e.reason])];
}
export function propensityBalanceRows(saved) {
  return [['Variable','Treated before','Control before','Treated after','Control after','SD denominator','SMD before','SMD after'],
    ...saved.balance.map(r=>[r.variable,r.treatedBefore,r.controlBefore,r.treatedAfter,r.controlAfter,r.denominator,r.smdBefore,r.smdAfter])];
}
