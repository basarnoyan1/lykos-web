// Tools for designing a primary study (review amendment of 2026-09-29):
// sample size for two proportions or two means, and a permuted-block
// randomisation list. Nothing here is saved to the project: a sample size is
// copied into the protocol with its inputs; an allocation list is exported as
// CSV with the seed that reproduces it, which is what an audit asks for.
import { qnorm, pnorm } from './dist.mjs';

/**
 * Participants per group to detect p1 against p2 (two-sided α, power 1 − β),
 * by the normal approximation with pooled variance under the null, as
 * Fleiss and most calculators use it; `ratio` is n2 / n1; `dropout` (0–1)
 * inflates for loss to follow-up.
 */
export function sampleSizeProportions({ p1, p2, alpha = 0.05, power = 0.8, ratio = 1, dropout = 0 }) {
  if (![p1, p2].every(p => p > 0 && p < 1) || p1 === p2 || !(alpha > 0 && alpha < 1) || !(power > 0 && power < 1) || !(ratio > 0)) return null;
  const za = qnorm(1 - alpha / 2), zb = qnorm(power), pbar = (p1 + ratio * p2) / (1 + ratio);
  const n1 = ((za * Math.sqrt((1 + 1 / ratio) * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2) / ratio)) ** 2) / (p1 - p2) ** 2;
  return inflate({ n1: Math.ceil(n1), n2: Math.ceil(n1 * ratio) }, dropout);
}

/** Participants per group to detect a difference in means `delta` with common standard deviation `sd`. */
export function sampleSizeMeans({ delta, sd, alpha = 0.05, power = 0.8, ratio = 1, dropout = 0 }) {
  if (!(Math.abs(delta) > 0) || !(sd > 0) || !(alpha > 0 && alpha < 1) || !(power > 0 && power < 1) || !(ratio > 0)) return null;
  const za = qnorm(1 - alpha / 2), zb = qnorm(power);
  const n1 = (1 + 1 / ratio) * ((za + zb) * sd / delta) ** 2;
  return inflate({ n1: Math.ceil(n1), n2: Math.ceil(n1 * ratio) }, dropout);
}

/** The power a two-group comparison of proportions has at these sizes (the inverse of sampleSizeProportions). */
export function powerProportions({ p1, p2, n1, n2, alpha = 0.05 }) {
  if (![p1, p2].every(p => p > 0 && p < 1) || !(n1 > 0 && n2 > 0)) return null;
  const za = qnorm(1 - alpha / 2), pbar = (n1 * p1 + n2 * p2) / (n1 + n2);
  const se0 = Math.sqrt(pbar * (1 - pbar) * (1 / n1 + 1 / n2)), se1 = Math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2);
  return pnorm((Math.abs(p1 - p2) - za * se0) / se1);
}

function inflate(n, dropout) {
  const f = dropout > 0 && dropout < 1 ? 1 / (1 - dropout) : 1;
  return { ...n, n1Enrol: Math.ceil(n.n1 * f), n2Enrol: Math.ceil(n.n2 * f), total: Math.ceil(n.n1 * f) + Math.ceil(n.n2 * f) };
}

// mulberry32: a small seeded generator, so a list is reproduced from its seed.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (xs, r) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * A permuted-block allocation list: `n` participants, `arms` (names), the
 * allocation `ratio` per arm (e.g. [1, 1] or [2, 1]), and `blockSizes` as
 * multiples of the ratio sum, chosen at random per block; `strata` names make
 * one list per stratum. The `seed` reproduces the list exactly.
 */
export function randomisationList({ n, arms = ['A', 'B'], ratio = null, blockSizes = null, seed = 1, strata = [''] }) {
  const k = arms.length;
  if (!(n > 0) || k < 2) return null;
  const weights = ratio && ratio.length === k ? ratio.map(x => Math.max(1, Math.round(x))) : arms.map(() => 1);
  const unit = weights.reduce((a, b) => a + b, 0);
  const sizes = (blockSizes && blockSizes.length ? blockSizes : [unit, 2 * unit]).map(b => Math.max(unit, Math.round(b / unit) * unit));
  const r = rng(Number(seed) || 1);
  const rows = [];
  for (const stratum of strata.length ? strata : ['']) {
    let id = 0, blockNo = 0;
    while (id < n) {
      const size = sizes[Math.floor(r() * sizes.length)], mult = size / unit;
      const block = shuffle(arms.flatMap((a, i) => Array(weights[i] * mult).fill(a)), r);
      blockNo++;
      for (const arm of block) { if (id >= n) break; id++; rows.push({ stratum, id, block: blockNo, blockSize: size, arm }); }
    }
  }
  return { rows, seed: Number(seed) || 1, arms, weights, blockSizes: sizes, counts: Object.fromEntries(arms.map(a => [a, rows.filter(x => x.arm === a).length])) };
}

/** The list as CSV rows, the seed and settings in a trailing comment row so the list can be reproduced. */
export function randomisationCsv(list) {
  const head = [['stratum', 'id', 'block', 'block_size', 'allocation']];
  return [...head, ...list.rows.map(x => [x.stratum, x.id, x.block, x.blockSize, x.arm]),
    ['# seed', list.seed, 'blocks', list.blockSizes.join('|'), `ratio ${list.arms.map((a, i) => `${a}:${list.weights[i]}`).join(' ')}`]];
}
