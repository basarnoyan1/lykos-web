// Graphical display of study heterogeneity (GOSH; Olkin, Dahabreh and Trikalinos 2012): the pooled model refitted to
// subsets of the studies, the pooled estimate plotted against I². With k studies there are 2^k − 1 subsets; up to
// 12 studies (4,095) all of them are fitted, beyond that a seeded random sample, so the same result always draws the
// same plot. Each subset is one fit in R (lib/pooled-model.mjs's model, the same estimator as the result), run in
// chunks as a background job the person can stop; the plot is a two-dimensional histogram of the fits. Subsets of
// one study are included, as in metafor's gosh(). Checked against metafor::gosh() (bench/diagnostics).

export const EXHAUSTIVE_K = 12;
export const SAMPLE_SIZE = 5000;
export const CHUNK = 200;

/** A small seeded generator (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The subsets to fit, as arrays of 0/1 of length k: all of them for k ≤ 12, else `size` distinct seeded random ones. */
export function subsetMasks(k, { size = SAMPLE_SIZE, seed = 1 } = {}) {
  if (k <= EXHAUSTIVE_K) {
    const out = [];
    for (let m = 1; m < 2 ** k; m++) out.push(Array.from({ length: k }, (_, i) => (m >> i) & 1));
    return { masks: out, exhaustive: true, seed: null };
  }
  const u = rng(seed), seen = new Set(), out = [];
  while (out.length < size) {
    const m = Array.from({ length: k }, () => (u() < 0.5 ? 1 : 0)), key = m.join('');
    if (!key.includes('1') || seen.has(key)) continue;
    seen.add(key); out.push(m);
  }
  return { masks: out, exhaustive: false, seed };
}

/** R that fits `masks` (rows of 0/1) and returns the pooled estimate, τ² and I² of each; NA for a fit that fails. */
export function goshChunkR({ yi, vi, method, masks }) {
  const k = yi.length;
  return `
      yi <- c(${yi.join(',')}); vi <- c(${vi.join(',')})
      M <- matrix(c(${masks.flat().join(',')}), ncol=${k}, byrow=TRUE)
      fits <- t(apply(M, 1, function(m) {
        idx <- which(m == 1)
        f <- if (length(idx) == 1) NULL else tryCatch(suppressWarnings(rma(yi[idx], vi[idx], method="${method}")), error=function(e) NULL)
        if (length(idx) == 1) c(yi[idx], 0, 0) else if (is.null(f)) c(NA_real_, NA_real_, NA_real_) else c(as.numeric(f$beta[1]), f$tau2, f$I2)
      }))
      list(est = fits[, 1], tau2 = fits[, 2], i2 = fits[, 3])`;
}

/**
 * The histogram and summaries of the fitted subsets. `fits` is `{ masks, est, i2 }` (equal lengths, fits that failed are
 * NA and left out); `full` the full-data estimate and I²; the plot's range covers the fits.
 */
export function summariseGosh({ masks, est, i2 }, full, { nx = 60, ny = 40 } = {}) {
  const ok = est.map((e, i) => (Number.isFinite(e) && Number.isFinite(i2[i]) ? i : -1)).filter(i => i >= 0);
  if (!ok.length) return null;
  const lo = Math.min(...ok.map(i => est[i])), hi = Math.max(...ok.map(i => est[i])), pad = (hi - lo) * 0.03 || 0.5, xrange = [lo - pad, hi + pad];
  const counts = Array.from({ length: ny }, () => new Array(nx).fill(0));
  for (const i of ok) {
    const ix = Math.min(nx - 1, Math.floor((est[i] - xrange[0]) / (xrange[1] - xrange[0]) * nx)), iy = Math.min(ny - 1, Math.floor(Math.max(0, Math.min(100, i2[i])) / 100 * ny));
    counts[iy][ix]++;
  }
  const k = masks[0].length, inn = new Array(k).fill(0), inc = new Array(k).fill(0), out = new Array(k).fill(0), outc = new Array(k).fill(0);
  for (const i of ok) masks[i].forEach((b, j) => { if (b) { inn[j] += est[i]; inc[j]++; } else { out[j] += est[i]; outc[j]++; } });
  return { n: ok.length, failed: est.length - ok.length, counts, xrange, yrange: [0, 100], full, meanIncluded: inn.map((s, j) => (inc[j] ? s / inc[j] : null)), meanExcluded: out.map((s, j) => (outc[j] ? s / outc[j] : null)),
    min: lo, max: hi, i2max: Math.max(...ok.map(i => i2[i])), i2min: Math.min(...ok.map(i => i2[i])) };
}
