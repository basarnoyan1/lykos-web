// Advanced primary analyses use the pinned R packages, with frozen inputs and explicit fit gates.
import { get, update } from '../store.mjs';
import { analysisSources } from './dataset-analysis-core.mjs';
import { numeric } from './ipd.mjs';
import { rs } from './survival.mjs';
import { runR } from './r.mjs';
import { isRepeatedFactor, prepareRepeatedDesign, repeatedFactorScript } from './repeated-primary.mjs';

export const ADVANCED_METHODS = [
  { id: 'repeated', label: 'Repeated measures (random intercept)', packages: ['nlme'], outcome: 'number', cluster: true, time: true, predictors: true },
  { id: 'rm-anova', label: 'Repeated measures (categorical-time ANOVA)', packages: [], outcome: 'number', cluster: true, time: true, timeCategorical: true, group: true },
  { id: 'friedman', label: 'Repeated measures (Friedman)', packages: [], outcome: 'number', cluster: true, time: true, timeCategorical: true, group: true },
  { id: 'ordinal', label: 'Ordinal proportional odds', packages: ['MASS'], outcome: 'category', predictors: true },
  { id: 'competing', label: 'Competing risks (cumulative incidence)', packages: ['survival'], outcome: 'category', cluster: true, time: true, group: true },
  { id: 'recurrent', label: 'Recurrent events (counting-process Cox)', packages: ['survival'], outcome: 'binary', cluster: true, time: true, start: true, predictors: true, strata: true },
];
export const advancedMethod = id => ADVANCED_METHODS.find(x => x.id === id);
export function advancedSources(state = get()) {
  return analysisSources(state).map(d => d.id !== 'patients' ? d : {
    ...d, columns: [...d.columns, { id: '__patient_id', label: 'Patient ID', type: 'text' }, { id: '__study_id', label: 'Source report', type: 'text' }],
    rows: d.rows.map((r, i) => ({ ...r, __patient_id: state.participants[i].id, __study_id: state.participants[i].study_id || '' })),
  });
}
export const advancedSourceById = (id, state = get()) => advancedSources(state).find(d => d.id === id) || null;
const present = v => v != null && String(v).trim() !== '';
const labels = (d, id) => [...new Set(d.rows.map(r => String(r[id] ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
export const advancedLevels = labels;
const ntype = c => ['number', 'integer'].includes(c?.type);
export const advancedColumns = (d, role) => d.columns.filter(c => role === 'number' ? ntype(c) : c.type !== 'date');
export function advancedUsedColumns(method, inputs) {
  const m = advancedMethod(method);
  return [...new Set(['outcome', ...(m?.cluster ? ['cluster'] : []), ...(m?.time ? ['time'] : []), ...(m?.start ? ['start'] : []),
    ...(m?.group ? ['group'] : []), ...(m?.strata ? ['strata'] : [])].map(k => inputs[k]).concat(m?.predictors ? inputs.predictors || [] : []).filter(Boolean))];
}
export function advancedSnapshot(d, method, inputs, options = {}) {
  const ids = advancedUsedColumns(method, inputs);
  return JSON.stringify({ version: 1, method, inputs, options, rowKey: d.rowKey || null,
    columns: ids.map(id => d.columns.find(c => c.id === id) || null),
    rows: d.rows.map((r, i) => [d.rowIds?.[i] ?? (d.rowKey ? String(r[d.rowKey] ?? i + 1) : String(i + 1)), ...ids.map(id => r[id] ?? null)]) });
}
export function advancedInputStatus(entry, state = get()) {
  if (!entry) return 'none';
  if (!entry.inputSnapshot || !entry.frozenData) return 'untracked';
  const d = advancedSourceById(entry.datasetId, state);
  return d && advancedSnapshot(d, entry.kind, entry.inputs, entry.options) === entry.inputSnapshot ? 'current' : 'stale';
}

/** Complete cases are declared and retained; structural interval/order errors stop the model. */
export function prepareAdvanced(d, method, inputs, options = {}) {
  const m = advancedMethod(method);
  if (!m) throw new Error('Choose a supported analysis');
  const required = ['outcome', ...(m.cluster ? ['cluster'] : []), ...(m.time ? ['time'] : []), ...(m.start ? ['start'] : [])];
  for (const key of required) if (!inputs[key]) throw new Error('Choose ' + key);
  const predictors = [...new Set(inputs.predictors || [])];
  if (m.predictors && method !== 'repeated' && !predictors.length) throw new Error('Choose at least one predictor');
  const ids = advancedUsedColumns(method, inputs), columns = ids.map(id => {
    const c = d.columns.find(x => x.id === id);
    if (!c) throw new Error('The selected column is unavailable: ' + id);
    return c;
  });
  if (predictors.includes(inputs.outcome) || predictors.includes(inputs.cluster) || predictors.includes(inputs.start)) throw new Error('The outcome and participant ID cannot also be predictors');
  const distinct = required.map(k => inputs[k]);
  if (new Set(distinct).size !== distinct.length) throw new Error('Choose distinct columns for outcome, participant ID and time');
  if (inputs.strata && (predictors.includes(inputs.strata) || distinct.includes(inputs.strata))) throw new Error('The strata column must be separate from the model variables');
  if (inputs.group && distinct.includes(inputs.group)) throw new Error('The group column must be separate from the event and participant columns');
  for (const key of ['time', 'start']) if (inputs[key] && !(key === 'time' && m.timeCategorical) && !ntype(d.columns.find(c => c.id === inputs[key]))) throw new Error('Time columns must be numeric');
  if (m.outcome === 'number' && !ntype(d.columns.find(c => c.id === inputs.outcome))) throw new Error('The outcome must be numeric');
  const included = [], excluded = [], rows = [];
  d.rows.forEach((r, index) => {
    const reasons = [], out = {}, rowId = String(d.rowIds?.[index] ?? (d.rowKey ? r[d.rowKey] ?? index + 1 : index + 1));
    for (const c of columns) {
      const raw = r[c.id], pairedLabel = m.timeCategorical && [inputs.cluster, inputs.time, inputs.group].includes(c.id), v = ntype(c) && !pairedLabel ? numeric(r, c.id) : present(raw) ? String(raw).trim() : null;
      if (v == null) reasons.push('Missing or invalid ' + (c.label || c.id));
      out[c.id] = v;
    }
    if (reasons.length) excluded.push({ index, rowId, reasons });
    else { rows.push(out); included.push({ index, rowId }); }
  });
  const population = { policy: 'Complete cases for declared analysis columns.', sourceRows: d.rows.length, used: rows.length, dropped: excluded.length, included, excluded };
  const repeatedDesign = isRepeatedFactor(method) ? prepareRepeatedDesign(d, method, inputs, options, rows, population) : null;
  if (rows.length < 5 && !repeatedDesign) throw new Error('At least five complete observations are needed');
  for (const id of predictors) {
    const c = columns.find(c => c.id === id), observed = [...new Set(rows.map(r => String(r[id])))];
    if (!ntype(c) && options.refs?.[id] && !observed.includes(options.refs[id])) throw new Error('The selected reference level has no complete observations');
  }
  if (inputs.time && !m.timeCategorical && rows.some(r => r[inputs.time] < 0)) throw new Error('Follow-up times cannot be negative');
  if (m.cluster && new Set(rows.map(r => String(r[inputs.cluster]))).size < 2) throw new Error('At least two participants or clusters are needed');
  if (method === 'repeated') {
    const groups = new Map();
    for (const r of rows) { const id = String(r[inputs.cluster]); const a = groups.get(id) || []; a.push(r[inputs.time]); groups.set(id, a); }
    if (![...groups.values()].some(x => x.length > 1)) throw new Error('Repeated measures need more than one observation per participant');
    if (options.correlation === 'ar1' && [...groups.values()].some(x => x.some(t => !Number.isInteger(t)) || new Set(x).size !== x.length)) throw new Error('AR(1) needs distinct integer time indices within each participant');
    if (!['independent', 'ar1', undefined].includes(options.correlation)) throw new Error('Unsupported correlation structure');
  }
  if (method === 'ordinal') {
    const order = options.order || [];
    if (order.length < 3 || new Set(order).size !== order.length || rows.some(r => !order.includes(String(r[inputs.outcome])))) throw new Error('Specify every observed ordinal level once, from lowest to highest');
    if (order.some(l => !rows.some(r => String(r[inputs.outcome]) === l))) throw new Error('Every specified ordinal level must have observations');
  }
  if (method === 'competing') {
    if (!present(options.censorLevel)) throw new Error('Choose the censored event level');
    if (new Set(rows.map(r => String(r[inputs.cluster]))).size !== rows.length) throw new Error('Cumulative incidence needs one row per participant; use an interval model for repeated rows');
    const levels = [...new Set(rows.map(r => String(r[inputs.outcome])))];
    if (!levels.includes(String(options.censorLevel)) || levels.length < 2) throw new Error('Cumulative incidence needs observed censored and event states');
    if (!(options.landmarks || []).length || options.landmarks.some(t => !Number.isFinite(Number(t)) || Number(t) < 0)) throw new Error('Choose nonnegative times to report in the source time unit');
  }
  if (method === 'recurrent') {
    const event = String(options.eventLevel ?? '1'), observed = [...new Set(rows.map(r => String(r[inputs.outcome])))];
    if (observed.length !== 2 || !observed.includes(event)) throw new Error('Choose the event level of a two-valued event-status column');
    const groups = new Map();
    for (const r of rows) {
      if (!(r[inputs.start] >= 0 && r[inputs.time] > r[inputs.start])) throw new Error('Each counting-process interval needs 0 ≤ start < stop');
      const id = String(r[inputs.cluster]), a = groups.get(id) || []; a.push([r[inputs.start], r[inputs.time]]); groups.set(id, a);
    }
    for (const a of groups.values()) {
      a.sort((x, y) => x[0] - y[0]);
      if (a.some((x, i) => i && x[0] < a[i - 1][1])) throw new Error('Intervals must not overlap within a participant');
    }
  }
  const frozenData = structuredClone({ id: d.id, name: d.name, ...(d.rowKey ? { rowKey: d.rowKey } : {}),
    ...(d.rowIds ? { rowIds: d.rowIds } : {}), columns,
    rows: d.rows.map(r => Object.fromEntries([...new Set([...ids, ...(d.rowKey ? [d.rowKey] : [])])].map(id => [id, r[id] ?? '']))) });
  return { method, inputs: structuredClone(inputs), options: structuredClone(options), rows, columns, frozenData,
    ...(repeatedDesign ? { repeatedDesign } : {}), inputSnapshot: advancedSnapshot(d, method, inputs, options),
    population: repeatedDesign ? { ...population, policy: 'Strict complete balanced participant × time grid; no participant or observation is silently discarded.', subjects: repeatedDesign.subjects, groupParticipants: repeatedDesign.groupParticipants } : population };
}

const vec = xs => 'c(' + xs.map((x, index) => (index && index % 40 === 0 ? '\n' : '') + (typeof x === 'number' ? String(x) : rs(x))).join(',') + ')';
function frame(p) {
  const mapping = new Map(p.columns.map((c, i) => [c.id, 'v' + i]));
  const cols = p.columns.map(c => mapping.get(c.id) + ' = ' + (ntype(c) ? vec(p.rows.map(r => r[c.id])) : 'factor(' + vec(p.rows.map(r => r[c.id])) + ')'));
  return { src: 'd <- data.frame(' + cols.join(',') + ')\n', name: id => mapping.get(id) };
}
const common = [
  '.warnings <- character(0)',
  '.w <- function(x) withCallingHandlers(x, warning=function(w) { .warnings <<- c(.warnings, conditionMessage(w)); invokeRestart("muffleWarning") })',
  '.finite <- function(x) all(is.finite(x))',
  '.rank <- function(f) { X <- model.matrix(f, d); if (qr(X)$rank < ncol(X)) stop("The fixed-effects model is rank deficient"); if (nrow(X) <= ncol(X)) stop("Too few observations for the model") }',
  '.coef <- function(b, V) { se <- sqrt(diag(V)); if (!.finite(b) || !.finite(V) || !.finite(se) || any(se <= 0)) stop("The fitted coefficients or covariance are not estimable"); if (any(eigen((V+t(V))/2, symmetric=TRUE, only.values=TRUE)$values <= max(abs(V))*1e-12)) stop("The coefficient covariance is singular"); z <- b / se; data.frame(term=names(b), estimate=as.numeric(b), se=as.numeric(se), lo=as.numeric(b-1.96*se), hi=as.numeric(b+1.96*se), statistic=as.numeric(z), p=2*pnorm(abs(z), lower.tail=FALSE)) }',
];
export function advancedScript(p) {
  const m = advancedMethod(p.method), f = frame(p), v = f.name, i = p.inputs, o = p.options;
  const predictors = [...new Set(i.predictors || [])].filter(id => p.method !== 'repeated' || id !== i.time).map(v);
  const factors = [i.cluster, i.group, i.strata].filter(Boolean).map(id => 'd$' + v(id) + ' <- factor(d$' + v(id) + ')');
  for (const id of i.predictors || []) if (!ntype(p.columns.find(c => c.id === id)) && o.refs?.[id]) factors.push('d$' + v(id) + ' <- relevel(d$' + v(id) + ', ref=' + rs(o.refs[id]) + ')');
  let body, description;
  if (isRepeatedFactor(p.method)) {
    ({ body, description } = repeatedFactorScript(p, v));
  } else if (p.method === 'ordinal') {
    const formula = v(i.outcome) + ' ~ ' + predictors.join(' + ');
    body = [
      'd$' + v(i.outcome) + ' <- ordered(as.character(d$' + v(i.outcome) + '), levels=' + vec(o.order) + ')',
      'form <- as.formula(' + rs(formula) + '); .rank(form)',
      'fit <- .w(MASS::polr(form, data=d, method="logistic", Hess=TRUE))',
      'if (fit$convergence != 0 || any(eigen(fit$Hessian, symmetric=TRUE, only.values=TRUE)$values <= 1e-8)) stop("The ordinal model did not converge or has a singular Hessian")',
      'V <- vcov(fit); cf <- .coef(coef(fit), V[names(coef(fit)), names(coef(fit)), drop=FALSE])',
      'thresholds <- data.frame(term=names(fit$zeta), estimate=as.numeric(fit$zeta))',
      'res <- list(coefficients=cf, thresholds=thresholds, logLik=as.numeric(logLik(fit)))',
    ];
    description = 'MASS polr, proportional odds logistic model; asymptotic Wald intervals and tests. The proportional-odds assumption is not tested automatically.';
  } else if (p.method === 'repeated') {
    const formula = v(i.outcome) + ' ~ ' + [v(i.time), ...predictors].join(' + ');
    body = [
      'form <- as.formula(' + rs(formula) + '); .rank(form)',
      'fit <- .w(nlme::lme(form, random=as.formula(' + rs('~ 1 | ' + v(i.cluster)) + '), data=d, method="REML"' +
        (o.correlation === 'ar1' ? ', correlation=nlme::corAR1(form=as.formula(' + rs('~ ' + v(i.time) + ' | ' + v(i.cluster)) + '))' : '') + '))',
      'tt <- summary(fit)$tTable; cf <- .coef(nlme::fixef(fit), vcov(fit)); cf$statistic <- as.numeric(tt[,"t-value"]); cf$p <- as.numeric(tt[,"p-value"]); cf$df <- as.numeric(tt[,"DF"])',
      'cf$lo <- cf$estimate - qt(.975, cf$df)*cf$se; cf$hi <- cf$estimate + qt(.975, cf$df)*cf$se',
      'rv <- as.numeric(nlme::VarCorr(fit)[,"Variance"]); if (any(!is.finite(rv)) || any(rv <= 1e-10)) stop("The repeated-measures model has a singular variance component")',
      'res <- list(coefficients=cf, variance=rv, correlation=if (is.null(fit$modelStruct$corStruct)) NULL else as.numeric(coef(fit$modelStruct$corStruct, unconstrained=FALSE)), logLik=as.numeric(logLik(fit)))',
    ];
    description = 'nlme random-intercept linear mixed model, REML, ' + (o.correlation === 'ar1' ? 'AR(1) residual correlation' : 'independent residuals') + '; nlme denominator degrees of freedom and t intervals.';
  } else if (p.method === 'competing') {
    const levels = [String(o.censorLevel), ...labels({ rows: p.rows }, i.outcome).filter(x => x !== String(o.censorLevel))];
    const formula = 'survival::Surv(' + v(i.time) + ', ' + v(i.outcome) + ') ~ ' + (i.group ? v(i.group) : '1');
    body = [
      'd$' + v(i.outcome) + ' <- factor(as.character(d$' + v(i.outcome) + '), levels=' + vec(levels) + ')',
      'fit <- .w(survival::survfit(as.formula(' + rs(formula) + '), data=d, id=d$' + v(i.cluster) + ', conf.int=.95))',
      'sm <- summary(fit, times=' + vec(o.landmarks.map(Number)) + ', extend=FALSE)',
      'if (!length(sm$time)) stop("No requested time is within the observed follow-up")',
      'curve <- if (is.null(sm$strata)) rep("All", length(sm$time)) else as.character(sm$strata)',
      'tab <- do.call(rbind, lapply(seq_along(fit$states)[-1], function(j) data.frame(group=curve, time=sm$time, cause=fit$states[j], estimate=sm$pstate[,j], se=sm$std.err[,j], lo=sm$lower[,j], hi=sm$upper[,j])))',
      'if (is.null(tab) || any(!is.finite(tab$estimate))) stop("Cumulative incidence could not be estimated")',
      'res <- list(incidence=tab)',
    ];
    description = 'Aalen–Johansen cumulative incidence from survival survfit; first event-state level is censored. Unadjusted curves; requested times beyond follow-up are omitted.';
  } else {
    const rhs = [...predictors, ...(i.strata ? ['strata(' + v(i.strata) + ')'] : []), 'cluster(' + v(i.cluster) + ')'].join(' + ');
    const formula = 'Surv(' + v(i.start) + ', ' + v(i.time) + ', ev) ~ ' + rhs;
    body = [
      'd$ev <- as.integer(as.character(d$' + v(i.outcome) + ') == ' + rs(String(o.eventLevel ?? '1')) + ')',
      '.rank(as.formula(' + rs('ev ~ ' + predictors.join(' + ')) + '))',
      'fit <- .w(survival::coxph(as.formula(' + rs(formula) + '), data=d, ties="efron", x=TRUE))',
      'cf <- .coef(coef(fit), vcov(fit)); ph <- .w(survival::cox.zph(fit))$table; epv <- sum(d$ev) / length(coef(fit))',
      'res <- list(coefficients=cf, events=sum(d$ev), epv=epv, phGlobalP=unname(ph[nrow(ph),"p"]))',
    ];
    description = 'Andersen–Gill counting-process Cox model; Efron ties and patient-cluster robust variance. Intervals must be disjoint; event status applies at each stop time.';
  }
  const script = m.packages.map(pkg => 'suppressPackageStartupMessages(library(' + pkg + '))').concat('suppressPackageStartupMessages(library(jsonlite))',
    common, f.src, factors, body,
    'if (any(grepl("converg|singular|infinite|not positive|iteration limit|0 or 1", .warnings, ignore.case=TRUE))) stop(paste(.warnings, collapse="; "))',
    'res$warnings <- unique(.warnings); res$method <- ' + rs(description),
    'list(json=as.character(jsonlite::toJSON(res, auto_unbox=TRUE, digits=NA, null="null", na="null")))').join('\n');
  return { script, packages: [...m.packages, 'jsonlite'], description };
}
const array = x => x == null ? [] : Array.isArray(x) ? x : [x];
export function advancedResult(raw, p) {
  const names = new Map(p.columns.map((c, index) => ['v' + index, c.label || c.id]));
  const termName = term => String(term).replace(/^v\d+/, t => names.get(t) || t);
  const coefficients = array(raw.coefficients).map(c => ({ ...c, term: termName(c.term) }));
  const tables = [];
  if (coefficients.length) {
    const ratio = p.method === 'ordinal' || p.method === 'recurrent';
    const estimate = value => {
      if(value == null || value === '' || !Number.isFinite(Number(value)))return null;
      const converted=ratio?Math.exp(Number(value)):Number(value);
      return Number.isFinite(converted)?converted:null;
    };
    tables.push({ header: ['Term', ratio ? (p.method === 'ordinal' ? 'Odds ratio (higher outcome)' : 'Hazard ratio') : 'Estimate', ratio ? 'Log-scale SE' : 'SE', ...(p.method === 'repeated' ? ['df'] : []), '95% lower', '95% upper', 'p'],
      rows: coefficients.map(c => [c.term, estimate(c.estimate), c.se, ...(p.method === 'repeated' ? [c.df] : []), estimate(c.lo), estimate(c.hi), c.p]) });
  }
  if (raw.thresholds) tables.push({ title: 'Ordinal thresholds', header: ['Threshold', 'Estimate'], rows: array(raw.thresholds).map(c => [c.term, c.estimate]) });
  if (raw.incidence) tables.push({ header: ['Group', 'Time', 'Cause', 'Cumulative incidence', '95% lower', '95% upper'], rows: array(raw.incidence).map(c => [termName(c.group), c.time, c.cause, c.estimate, c.lo, c.hi]) });
  if (raw.omnibus) tables.push({ title: 'Omnibus tests', header: ['Group', 'Effect', p.method === 'rm-anova' ? 'F' : 'Friedman χ²', 'df', ...(p.method === 'rm-anova' ? ['Residual df'] : []), 'p'],
    rows: array(raw.omnibus).map(c => [c.group, c.effect.replace(/arm/g, 'Group').replace(/visit/g, 'Time'), c.statistic, c.df, ...(p.method === 'rm-anova' ? [c.residualDf] : []), c.p]) });
  if (raw.descriptive) tables.push({ title: 'Observed summaries', header: ['Group', 'Time', 'Participants', 'Mean', 'SD', 'Median', 'Q1', 'Q3'], rows: array(raw.descriptive).map(c => [c.group, c.time, c.n, c.mean, c.sd, c.median, c.q1, c.q3]) });
  if (raw.posthoc) tables.push({ title: 'Paired post-hoc comparisons (Bonferroni)', header: ['Group', 'First time', 'Second time', 'Pairs', p.method === 'rm-anova' ? 'Mean paired difference' : 'Median paired difference (descriptive)', p.method === 'rm-anova' ? 't' : 'Wilcoxon V', ...(p.method === 'rm-anova' ? ['df', 'Simultaneous 95% lower', 'Simultaneous 95% upper'] : []), 'Raw p', 'Adjusted p', 'Family comparisons'],
    rows: array(raw.posthoc).map(c => [c.group, c.first, c.second, c.n, c.difference, c.statistic, ...(p.method === 'rm-anova' ? [c.df, c.lower, c.upper] : []), c.p, c.adjustedP, c.familyComparisons]) });
  const warnings = array(raw.warnings);
  if (p.method === 'rm-anova' && p.repeatedDesign.timeOrder.length > 2) warnings.push('Within-subject F tests assume sphericity. Mauchly testing and Greenhouse–Geisser or Huynh–Feldt corrections are not computed.');
  if (p.method === 'friedman' && p.repeatedDesign.groupParticipants.some(g => g.participants < 10)) warnings.push('Friedman uses the asymptotic chi-square approximation; groups with fewer than ten participants need cautious interpretation.');
  if (raw.epv != null && Number.isFinite(Number(raw.epv)) && raw.epv < 10) warnings.push('Fewer than ten events per coefficient; treat the model as exploratory.');
  if (raw.phGlobalP != null && raw.phGlobalP < .05) warnings.push('The proportional-hazards test rejected the model assumption; a constant hazard ratio is not established.');
  return { title: advancedMethod(p.method).label, method: raw.method, coefficients, tables, warnings, n: { used: p.population.used, dropped: p.population.dropped }, diagnostics: raw };
}
export async function runAdvanced(d, kind, inputs, options = {}, { exec, onProgress, signal } = {}) {
  if(signal?.aborted)throw new DOMException('Analysis stopped','AbortError');
  const p = prepareAdvanced(d, kind, inputs, options), built = advancedScript(p);
  const answer = exec ? await exec(built.script, built.packages, {signal}) : await runR(built.packages, built.script, onProgress,{signal,label:advancedMethod(kind).label});
  if(signal?.aborted)throw new DOMException('Analysis stopped','AbortError');
  const raw = answer.json ? JSON.parse(answer.json) : answer;
  const result = advancedResult(raw, p);
  if (!result.tables.length) throw new Error('The analysis produced no estimable results');
  const at = new Date().toISOString();
  const rScript = answer.rScript && typeof answer.rScript === 'object' ? answer.rScript : {
    code: typeof answer.rScript === 'string' ? answer.rScript : built.script,
    r: '', packages: Object.fromEntries(built.packages.map(pkg => [pkg, ''])), at,
  };
  return { id: 'aa' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), datasetId: d.id, kind, inputs: p.inputs, options: p.options,
    at, inputSnapshot: p.inputSnapshot, frozenData: p.frozenData, population: p.population,
    rScript, packages: built.packages, result, method: result.method };
}
export function keepAdvanced(entry) { update(s => { s.advancedAnalyses = [...(s.advancedAnalyses || []), entry]; return s; }); }
export function removeAdvanced(id) { update(s => { s.advancedAnalyses = (s.advancedAnalyses || []).filter(x => x.id !== id); return s; }); }
export function advancedCsv(entry) {
  const rows = [['Analysis', entry.result.title], ['Method', entry.method], ['Used', entry.population.used], ['Excluded', entry.population.dropped]];
  for (const t of entry.result.tables) rows.push([], ...(t.title ? [[t.title]] : []), t.header, ...t.rows);
  rows.push([], ['Excluded source row', 'Reason'], ...entry.population.excluded.map(x => [x.rowId, x.reasons.join('; ')]));
  return rows;
}
