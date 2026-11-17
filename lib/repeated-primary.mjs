// Restricted balanced repeated observations. R computes every inferential quantity.
import { rs } from './survival.mjs';

export const isRepeatedFactor = kind => ['rm-anova', 'friedman'].includes(kind);
const vec = values => 'c(' + values.map(rs).join(',') + ')';
const levels = (rows, id) => [...new Set(rows.map(r => String(r[id] ?? '').trim()).filter(Boolean))];

export function prepareRepeatedDesign(d, kind, inputs, options, rows, population) {
  const allowedInputs = ['outcome', 'cluster', 'time', 'group'];
  for (const key of Object.keys(inputs)) if (!allowedInputs.includes(key) && !(key === 'predictors' && !inputs[key]?.length)) throw new Error('Unsupported repeated-measures input: ' + key);
  const allowedOptions = ['timeOrder', 'groupOrder', 'posthoc', ...(kind === 'rm-anova' ? ['sphericityAssumed'] : [])];
  for (const key of Object.keys(options)) if (!allowedOptions.includes(key)) throw new Error('Unsupported repeated-measures option: ' + key);
  const order = options.timeOrder, issues = [];
  if (!Array.isArray(order) || order.length < 2 || order.some(x => typeof x !== 'string' || !x.trim() || x !== x.trim()) || new Set(order).size !== order.length) throw new Error('Order every observed time level once, with at least two levels');
  const observedTimes = levels(d.rows, inputs.time);
  if (observedTimes.some(x => !order.includes(x))) issues.push({ reason: 'Order every observed time level once' });
  if (order.some(x => !observedTimes.includes(x))) issues.push({ reason: 'Every ordered time level needs observations' });
  const groups = inputs.group ? options.groupOrder : ['All'];
  if (inputs.group && (!Array.isArray(groups) || groups.length < 2 || groups.some(x => typeof x !== 'string' || !x.trim() || x !== x.trim()) || new Set(groups).size !== groups.length)) throw new Error('Order every observed between-subject group once, with at least two groups');
  if (inputs.group) { const observedGroups = levels(d.rows, inputs.group); if (observedGroups.some(x => !groups.includes(x)) || groups.some(x => !observedGroups.includes(x))) issues.push({ reason: 'Order every observed between-subject group once' }); }
  if (options.posthoc != null && !['none', 'bonferroni'].includes(options.posthoc)) throw new Error('Choose no post-hoc tests or paired Bonferroni tests');
  if (kind === 'rm-anova' && order.length > 2 && options.sphericityAssumed !== true) throw new Error('Acknowledge sphericity for uncorrected repeated-measures ANOVA; no correction is computed');
  const subjects = new Map();
  for (const [index, r] of d.rows.entries()) {
    const id = String(r[inputs.cluster] ?? '').trim();
    if (!id) { issues.push({ index, reason: 'Missing participant ID' }); continue; }
    const subject = subjects.get(id) || { id, indices: [], times: [], groups: [] };
    subject.indices.push(index); subject.times.push(String(r[inputs.time] ?? '').trim());
    subject.groups.push(inputs.group ? String(r[inputs.group] ?? '').trim() : 'All'); subjects.set(id, subject);
  }
  for (const subject of subjects.values()) {
    const reasons = [];
    const counts = new Map(); subject.times.forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
    if ([...counts.values()].some(n => n > 1)) reasons.push('Duplicate participant × time records');
    const missing = order.filter(t => !counts.has(t)); if (missing.length) reasons.push('Missing paired times: ' + missing.join(', '));
    if (subject.times.some(t => !order.includes(t))) reasons.push('Unknown or missing time level');
    if (new Set(subject.groups).size !== 1 || !groups.includes(subject.groups[0])) reasons.push('Group must be present and constant within each participant');
    for (const index of subject.indices) for (const reason of reasons) issues.push({ index, reason });
  }
  for (const e of population.excluded) for (const reason of e.reasons) issues.push({ index: e.index, reason });
  const counts = groups.map(group => [...subjects.values()].filter(s => s.groups.every(g => g === group)).length);
  if (counts.some(n => n < (kind === 'friedman' ? 3 : 2))) issues.push({ reason: kind === 'friedman' ? 'At least three complete participants per group are needed' : 'At least two complete participants per group are needed' });
  if (kind === 'rm-anova' && inputs.group && new Set(counts).size !== 1) issues.push({ reason: 'Balanced ANOVA requires equal participant counts in every between-subject group' });
  if (issues.length) {
    const err = new Error('Balanced paired design refused: ' + [...new Set(issues.map(x => x.reason))].join('; '));
    err.population = { ...population, policy: 'Strict complete balanced participant × time grid; an invalid grid prevents the entire analysis.', used: 0, dropped: d.rows.length, included: [],
      excluded: d.rows.map((r, index) => ({ index, rowId: String(d.rowIds?.[index] ?? (d.rowKey ? r[d.rowKey] ?? index + 1 : index + 1)), reasons: [...new Set(issues.filter(x => x.index === index || x.index == null).map(x => x.reason))].concat(issues.some(x => x.index === index || x.index == null) ? [] : ['Analysis refused because other participant records violate the paired design']) })),
      designIssues: issues.map(x => ({ ...x, ...(x.index == null ? {} : { rowId: String(d.rowIds?.[x.index] ?? (d.rowKey ? d.rows[x.index][d.rowKey] ?? x.index + 1 : x.index + 1)) }) })) };
    throw err;
  }
  return { timeOrder: order.slice(), groupOrder: groups.slice(), subjects: subjects.size, groupParticipants: groups.map((group, index) => ({ group, participants: counts[index] })),
    posthoc: options.posthoc || 'bonferroni', familyComparisons: (order.length * (order.length - 1) / 2) * groups.length };
}

export function repeatedFactorScript(p, name) {
  const i = p.inputs, design = p.repeatedDesign, anova = p.method === 'rm-anova';
  const body = [
    'd$subject <- factor(as.character(d$' + name(i.cluster) + '))',
    'd$visit <- factor(as.character(d$' + name(i.time) + '), levels=' + vec(design.timeOrder) + ')',
    'd$value <- d$' + name(i.outcome),
    'd$arm <- factor(' + (i.group ? 'as.character(d$' + name(i.group) + ')' : 'rep("All",nrow(d))') + ', levels=' + vec(design.groupOrder) + ')',
    'd <- d[order(d$arm,d$subject,d$visit),]; visits <- levels(d$visit); arms <- levels(d$arm)',
    '.matrix <- function(dd) { ids <- unique(as.character(dd$subject)); do.call(rbind,lapply(ids,function(id) { z <- dd[as.character(dd$subject)==id,]; z$value[match(visits,as.character(z$visit))] })) }',
    'descriptive <- do.call(rbind,lapply(arms,function(g) do.call(rbind,lapply(visits,function(t) { x <- d$value[d$arm==g & d$visit==t]; data.frame(group=g,time=t,n=length(x),mean=mean(x),sd=sd(x),median=median(x),q1=unname(quantile(x,.25)),q3=unname(quantile(x,.75))) }))))',
  ];
  if (anova) body.push(
    'if (length(unique(d$value))<2) stop("The repeated-measures ANOVA outcome variance is unestimable")',
    'fit <- .w(stats::aov(' + (i.group ? 'value ~ arm*visit + Error(subject/visit)' : 'value ~ visit + Error(subject/visit)') + ',data=d))',
    'sm <- summary(fit); omnibus <- do.call(rbind,lapply(names(sm),function(stratum) { tab <- sm[[stratum]][[1]]; if (!"F value" %in% colnames(tab)) return(NULL); keep <- which(trimws(rownames(tab))!="Residuals"); ri <- which(trimws(rownames(tab))=="Residuals"); if (length(ri)!=1 || !is.finite(tab[ri,"Mean Sq"]) || tab[ri,"Mean Sq"] <= max(var(d$value),.Machine$double.xmin)*.Machine$double.eps*128) stop("The repeated-measures ANOVA residual variance is unestimable"); residualDf <- tab[ri,"Df"]; do.call(rbind,lapply(keep,function(j) data.frame(group="All",effect=trimws(rownames(tab)[j]),statistic=tab[j,"F value"],df=tab[j,"Df"],residualDf=residualDf,p=tab[j,"Pr(>F)"]))) }))',
    'if (is.null(omnibus) || any(!is.finite(omnibus$statistic)) || any(!is.finite(omnibus$p)) || any(omnibus$residualDf<=0)) stop("The repeated-measures ANOVA has an unestimable effect or residual variance")',
  );
  else body.push(
    'omnibus <- do.call(rbind,lapply(arms,function(g) { ft <- .w(stats::friedman.test(.matrix(d[d$arm==g,]))); data.frame(group=g,effect="visit",statistic=unname(ft$statistic),df=unname(ft$parameter),residualDf=NA_real_,p=ft$p.value) }))',
    'if (any(!is.finite(omnibus$statistic)) || any(!is.finite(omnibus$p))) stop("The Friedman statistic cannot be estimated from these paired ranks")',
  );
  if (design.posthoc === 'bonferroni') body.push(
    'pairs <- combn(seq_along(visits),2); familyN <- ncol(pairs)*length(arms)',
    'posthoc <- do.call(rbind,lapply(arms,function(g) { M <- .matrix(d[d$arm==g,]); do.call(rbind,lapply(seq_len(ncol(pairs)),function(j) { a <- pairs[1,j]; b <- pairs[2,j]; x <- M[,a]; y <- M[,b]; ' +
      (anova ? 'tt <- .w(stats::t.test(x,y,paired=TRUE,conf.level=1-.05/familyN)); data.frame(group=g,first=visits[a],second=visits[b],n=length(x),difference=unname(tt$estimate),statistic=unname(tt$statistic),df=unname(tt$parameter),p=tt$p.value,lower=tt$conf.int[1],upper=tt$conf.int[2])' : 'tt <- .w(stats::wilcox.test(x,y,paired=TRUE,exact=FALSE,correct=TRUE)); data.frame(group=g,first=visits[a],second=visits[b],n=length(x),difference=median(x-y),statistic=unname(tt$statistic),df=NA_real_,p=tt$p.value,lower=NA_real_,upper=NA_real_)') + ' })) }))',
    'if (any(!is.finite(posthoc$p)) || any(!is.finite(posthoc$statistic))) stop("A paired post-hoc test cannot be estimated; revise the declared tests rather than saving partial inference")',
    'posthoc$adjustedP <- p.adjust(posthoc$p,method="bonferroni"); posthoc$familyComparisons <- familyN',
  );
  else body.push('posthoc <- NULL');
  body.push('res <- list(omnibus=omnibus,descriptive=descriptive,posthoc=posthoc,subjects=' + design.subjects + ',timeOrder=visits,groupOrder=arms)');
  const description = anova ? 'Balanced categorical-time repeated-measures ANOVA (stats aov; participant × time error strata' + (i.group ? '; between-subject group and group × time interaction' : '') + '). Uncorrected within-subject F tests assume sphericity. ' : 'Friedman rank-sum test on aligned complete participant × time matrices, separately within each group; no between-group comparison. ';
  return { body, description: description + (design.posthoc === 'bonferroni' ? anova ? 'Paired t post-hoc tests; Bonferroni p values and simultaneous 95% intervals across all time pairs and groups for this outcome. These are direct paired differences, not estimated marginal means.' : 'Paired Wilcoxon signed-rank post-hoc tests, asymptotic with continuity correction; Bonferroni p values across all time pairs and groups for this outcome. Median paired differences are descriptive.' : 'No post-hoc comparisons requested.') };
}
