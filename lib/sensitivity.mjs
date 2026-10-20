// Sensitivity and small-study analyses of a pooled result (plan: pairwise
// meta-analysis). The R snippet runs after the pooled model `r <- rma(...)` on
// `d <- escalc(...)` exists, and defines `sens`, a list whose fields are
// appended to the analysis result. Everything that cannot be computed (too few
// studies, no publication years, a fit that fails) is NULL there and null here.
//
// Verified against an independent oracle in bench/sensitivity/.
import { figurePanel, showFigure } from './figure.mjs';
import { withFigure, hasFigure, figureMissing } from './figures.mjs';
import { esc } from './html.mjs';
import { backTransform } from './effect-measures.mjs';

const FIGURES = [
  ['cumul_svg', 'sens-cumul', 'Cumulative forest plot', 'cumulative-forest-plot'],
  ['tf_svg', 'sens-trimfill', 'Trim and fill funnel plot', 'trim-and-fill-funnel-plot'],
  ['contour_svg', 'sens-contour', 'Contour-enhanced funnel plot', 'contour-funnel-plot'],
  ['baujat_svg', 'sens-baujat', 'Baujat plot', 'baujat-plot'],
];

const rStr = s => JSON.stringify(String(s ?? ''));
const rYear = y => { const m = /\d{4}/.exec(String(y ?? '')); return m ? m[0] : 'NA'; };

/**
 * R that runs after `d` and `r` and assigns `sens`, a named list to append to
 * the result: `c(list(...), sens)`. `labels` and `years` follow the rows of `d`.
 */
export function sensitivityR({ measure, labels = [], years = [] }) {
  // Back on the scale the measure is reported on: exp for ratios, the logit or
  // Fisher's z inverse for proportions and correlations, none for differences.
  const back = backTransform(measure);
  const at = back ? `atransf=${back}, ` : '';
  const xlab = rStr(measure);
  return `
      sens_tf <- function(x) ${back ? `${back}(x)` : 'x'}
      sens_labs <- c(${labels.map(rStr).join(',')})
      sens_yr <- as.numeric(c(${labels.map((_, i) => rYear(years[i])).join(',')}))
      # a copy of the model that carries the study labels into every figure
      sens_r <- r
      if (length(sens_labs) == r$k) { sens_r$slab <- sens_labs; sens_r$slab.null <- FALSE }
      sens_ok <- r$k >= 3 && length(sens_labs) == r$k
      sens_draw <- function(path, w, h, draw) {
        svglite(path, width=w, height=h)
        ok <- tryCatch({ suppressWarnings(draw()); TRUE }, error=function(e) FALSE)
        dev.off()
        if (ok) paste(readLines(path), collapse="\\n") else NULL
      }
      # cumulative meta-analysis in order of publication; undated studies last
      sens_o <- order(sens_yr, na.last=TRUE)
      sens_cm <- if (sens_ok && any(!is.na(sens_yr))) tryCatch(suppressWarnings({
        rk <- integer(r$k); rk[sens_o] <- seq_len(r$k); cumul(sens_r, order=rk) }), error=function(e) NULL) else NULL
      sens_cm_svg <- if (is.null(sens_cm)) NULL else sens_draw("/tmp/sens-cumul.svg", 8.5, ${1.6} + r$k * 0.42,
        function() forest(sens_cm, header="Study", ${at}xlab=${xlab}))
      sens_tfm <- if (sens_ok) tryCatch(suppressWarnings(trimfill(sens_r)), error=function(e) NULL) else NULL
      sens_tf_svg <- if (is.null(sens_tfm)) NULL else sens_draw("/tmp/sens-trimfill.svg", 6, 4.6,
        function() funnel(sens_tfm, ${at}xlab=${xlab}))
      sens_contour_svg <- if (sens_ok) sens_draw("/tmp/sens-contour.svg", 6, 4.6,
        function() funnel(r, level=c(90, 95, 99), shade=c("white", "gray55", "gray75"), refline=0, legend=TRUE, ${at}xlab=${xlab})) else NULL
      sens_inf <- if (sens_ok) tryCatch(suppressWarnings(influence(sens_r)), error=function(e) NULL) else NULL
      sens_bj <- NULL
      sens_bj_svg <- if (sens_ok) sens_draw("/tmp/sens-baujat.svg", 6, 4.6,
        function() sens_bj <<- baujat(sens_r, symbol="slab")) else NULL
      if (is.null(sens_bj)) sens_bj_svg <- NULL
      sens <- list(
        cumul_labels = if (is.null(sens_cm)) NULL else as.character(sens_cm$slab),
        cumul_year = if (is.null(sens_cm)) NULL else sens_yr[sens_o],
        cumul_k = if (is.null(sens_cm)) NULL else as.numeric(sens_cm$k),
        cumul_est = if (is.null(sens_cm)) NULL else sens_tf(as.numeric(sens_cm$estimate)),
        cumul_lo = if (is.null(sens_cm)) NULL else sens_tf(as.numeric(sens_cm$ci.lb)),
        cumul_hi = if (is.null(sens_cm)) NULL else sens_tf(as.numeric(sens_cm$ci.ub)),
        cumul_i2 = if (is.null(sens_cm)) NULL else as.numeric(sens_cm$I2),
        cumul_svg = sens_cm_svg,
        tf_k0 = if (is.null(sens_tfm)) NULL else as.numeric(sens_tfm$k0),
        tf_side = if (is.null(sens_tfm)) NULL else as.character(sens_tfm$side),
        tf_est = if (is.null(sens_tfm)) NULL else sens_tf(as.numeric(sens_tfm$beta[1])),
        tf_lo = if (is.null(sens_tfm)) NULL else sens_tf(as.numeric(sens_tfm$ci.lb)),
        tf_hi = if (is.null(sens_tfm)) NULL else sens_tf(as.numeric(sens_tfm$ci.ub)),
        tf_svg = sens_tf_svg,
        contour_svg = sens_contour_svg,
        infl_labels = if (is.null(sens_inf)) NULL else sens_labs,
        infl_rstudent = if (is.null(sens_inf)) NULL else as.numeric(sens_inf$inf$rstudent),
        infl_cook = if (is.null(sens_inf)) NULL else as.numeric(sens_inf$inf$cook.d),
        infl_hat = if (is.null(sens_inf)) NULL else as.numeric(sens_inf$inf$hat),
        infl_dfbetas = if (is.null(sens_inf)) NULL else as.numeric(sens_inf$dfbs$intrcpt),
        infl_flag = if (is.null(sens_inf)) NULL else as.logical(sens_inf$is.infl),
        baujat_x = if (is.null(sens_bj)) NULL else as.numeric(sens_bj$x),
        baujat_y = if (is.null(sens_bj)) NULL else as.numeric(sens_bj$y),
        baujat_svg = sens_bj_svg)
  `;
}

// runR returns a length-1 R vector as a scalar and NULL as null.
const vec = v => (Array.isArray(v) ? v : v == null ? [] : [v]);
const num = v => (v == null || v === '' ? null : Number(v));
const fx = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(d));
const ci = (e, lo, hi) => `${fx(e)} [${fx(lo)}, ${fx(hi)}]`;

/** The numbers, as rows; null for each analysis that was not computed. */
export function sensitivitySummary(a = {}) {
  const cl = vec(a.cumul_labels);
  const cumulative = cl.length ? cl.map((label, i) => ({
    label, year: num(vec(a.cumul_year)[i]), k: num(vec(a.cumul_k)[i]),
    estimate: num(vec(a.cumul_est)[i]), lo: num(vec(a.cumul_lo)[i]), hi: num(vec(a.cumul_hi)[i]), i2: num(vec(a.cumul_i2)[i]),
  })) : null;
  const trimFill = a.tf_k0 == null ? null : {
    k0: num(a.tf_k0), side: a.tf_side ?? null, estimate: num(a.tf_est), lo: num(a.tf_lo), hi: num(a.tf_hi),
    observed: { estimate: num(a.estimate), lo: num(a.lo), hi: num(a.hi) },
  };
  const il = vec(a.infl_labels);
  const influence = il.length ? il.map((label, i) => ({
    label, rstudent: num(vec(a.infl_rstudent)[i]), cook: num(vec(a.infl_cook)[i]), hat: num(vec(a.infl_hat)[i]),
    dfbetas: num(vec(a.infl_dfbetas)[i]), influential: vec(a.infl_flag)[i] === true,
  })) : null;
  const bx = vec(a.baujat_x), labels = vec(a.labels);
  const baujat = bx.length ? bx.map((x, i) => ({ label: labels[i] ?? String(i + 1), x: num(x), y: num(vec(a.baujat_y)[i]) })) : null;
  return { cumulative, trimFill, influence, baujat };
}

/** Panels for the Analysis view; empty when nothing was computed. */
export function sensitivityPanels(a = {}) {
  const s = sensitivitySummary(a), m = esc(a.measure || '');
  const fig = key => { const f = FIGURES.find(x => x[0] === key); return hasFigure(a, key) ? figurePanel({ title: f[2], id: f[1] }) : ''; };
  const out = [];
  if (s.cumulative) out.push(`<div class="panel"><div class="panel-head"><h2>Cumulative meta-analysis</h2><span class="meta">By publication year</span></div>
    <div class="panel-body tight"><table><thead><tr><th class="grow">Study added</th><th>Year</th><th>k</th><th>Pooled ${m}</th><th>I²</th></tr></thead>
    <tbody>${s.cumulative.map(r => `<tr><td class="grow">${esc(r.label)}</td><td>${r.year ?? '—'}</td><td>${r.k ?? '—'}</td><td>${ci(r.estimate, r.lo, r.hi)}</td><td>${fx(r.i2, 1)}%</td></tr>`).join('')}</tbody></table></div></div>`, fig('cumul_svg'));
  if (s.trimFill) out.push(`<div class="panel"><div class="panel-head"><h2>Trim and fill</h2><span class="meta">L0 estimator · sensitivity analysis</span></div>
    <div class="panel-body"><table><tbody>
      <tr><th>Imputed studies</th><td>${s.trimFill.k0}${s.trimFill.side ? ` · ${esc(s.trimFill.side)} side` : ''}</td></tr>
      <tr><th>Observed pooled ${m}</th><td>${ci(s.trimFill.observed.estimate, s.trimFill.observed.lo, s.trimFill.observed.hi)}</td></tr>
      <tr><th>Adjusted pooled ${m}</th><td>${ci(s.trimFill.estimate, s.trimFill.lo, s.trimFill.hi)}</td></tr>
    </tbody></table></div></div>`, fig('tf_svg'));
  out.push(fig('contour_svg'));
  if (s.influence) out.push(`<div class="panel"><div class="panel-head"><h2>Influence diagnostics</h2></div>
    <div class="panel-body tight"><table><thead><tr><th class="grow">Study</th><th>Studentized residual</th><th>Cook's distance</th><th>Hat</th><th>DFBETAS</th><th>Influential</th></tr></thead>
    <tbody>${s.influence.map(r => `<tr><td class="grow">${esc(r.label)}</td><td>${fx(r.rstudent)}</td><td>${fx(r.cook)}</td><td>${fx(r.hat, 3)}</td><td>${fx(r.dfbetas)}</td><td>${r.influential ? 'yes' : ''}</td></tr>`).join('')}</tbody></table></div></div>`);
  out.push(fig('baujat_svg'));
  return out.join('');
}

/** Shows the figures that sensitivityPanels placed in `el`. */
export function wireSensitivity(el, a = {}) {
  for (const [key, id, , file] of FIGURES) if (el.querySelector('#' + id)) withFigure(a, key, svg => showFigure(el, id, svg, file), () => figureMissing(el, id));
}

/** One line per analysis, numbers only, for model actions. */
export function sensitivityFacts(a = {}) {
  const s = sensitivitySummary(a), m = a.measure || 'effect', lines = [];
  if (s.cumulative) lines.push(`Cumulative meta-analysis by publication year (${m}): ` +
    s.cumulative.map(r => `${r.label}${r.year != null ? ` (${r.year})` : ''}, k = ${r.k}: ${ci(r.estimate, r.lo, r.hi)}`).join('; '));
  if (s.trimFill) lines.push(`Trim and fill (L0): ${s.trimFill.k0} imputed on the ${s.trimFill.side} side; adjusted ${m} ${ci(s.trimFill.estimate, s.trimFill.lo, s.trimFill.hi)}` +
    ` vs observed ${ci(s.trimFill.observed.estimate, s.trimFill.observed.lo, s.trimFill.observed.hi)}`);
  if (s.influence) {
    const flagged = s.influence.filter(r => r.influential).map(r => r.label);
    lines.push(`Influence diagnostics: ` + s.influence.map(r => `${r.label} rstudent ${fx(r.rstudent)}, Cook's D ${fx(r.cook)}, hat ${fx(r.hat, 3)}, DFBETAS ${fx(r.dfbetas)}`).join('; ') +
      `; influential: ${flagged.length ? flagged.join(', ') : 'none'}`);
  }
  if (s.baujat) lines.push(`Baujat (contribution to Q, influence on estimate): ` + s.baujat.map(r => `${r.label} ${fx(r.x)}, ${fx(r.y)}`).join('; '));
  return lines;
}
