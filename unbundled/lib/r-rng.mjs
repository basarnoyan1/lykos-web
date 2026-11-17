// R's default random number generator in JavaScript, so a seeded resampling (a permutation test, a bootstrap) run in Lykos draws exactly what
// the same seed draws in R: set.seed(seed) with the Mersenne-Twister (R's initial scrambling, 69069 congruential fill of the 624 words),
// unif_rand(), and sample() with R ≥ 3.6's "Rejection" sampling (R_unif_index: rejection over the next power of two, 16 bits at a time).
// RNGkind() = Mersenne-Twister, Inversion, Rejection. app/test/r-rng.test.mjs checks the draws against WebR's R. Pure.
const N = 624, M = 397, UPPER = 0x80000000, LOWER = 0x7fffffff, MATRIX_A = 0x9908b0df;
const I2_32M1 = 2.328306437080797e-10;   // 1/(2^32 - 1), R's fixup

/** A generator seeded as set.seed(seed) seeds R's: { unif(), index(n), sample(n, size?, replace?), permute(array) }. */
export function rRng(seed) {
  let s = seed >>> 0;
  for (let j = 0; j < 50; j++) s = (Math.imul(69069, s) + 1) >>> 0;   // initial scrambling
  const mt = new Uint32Array(N);
  s = (Math.imul(69069, s) + 1) >>> 0;                                 // i_seed[0], the position word (set to 624 by FixupSeeds)
  for (let j = 0; j < N; j++) { s = (Math.imul(69069, s) + 1) >>> 0; mt[j] = s; }
  let mti = N;
  const genrand = () => {
    let y;
    if (mti >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) { y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER); mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0); }
      for (; kk < N - 1; kk++) { y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER); mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0); }
      y = (mt[N - 1] & UPPER) | (mt[0] & LOWER); mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      mti = 0;
    }
    y = mt[mti++];
    y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18;
    return (y >>> 0) * 2.3283064365386963e-10;
  };
  const unif = () => { const v = genrand(); return v <= 0 ? 0.5 * I2_32M1 : 1 - v <= 0 ? 1 - 0.5 * I2_32M1 : v; };
  const rbits = bits => {
    let v = 0n;
    for (let n = 0; n <= bits; n += 16) v = 65536n * v + BigInt(Math.floor(unif() * 65536));
    return Number(v & ((1n << BigInt(bits)) - 1n));
  };
  /** R_unif_index(n): an integer in 0 … n − 1. */
  const index = n => { if (n <= 0) return 0; const bits = Math.ceil(Math.log2(n)); let dv; do dv = rbits(bits); while (n <= dv); return dv; };
  /** sample(n, size, replace): 1-based, as R returns them. */
  const sample = (n, size = n, replace = false) => {
    if (replace || size < 2) return Array.from({ length: size }, () => index(n) + 1);
    const x = Array.from({ length: n }, (_, i) => i), y = [];
    for (let i = 0, m = n; i < size; i++) { const j = index(m); y.push(x[j] + 1); x[j] = x[--m]; }
    return y;
  };
  /** v[sample(length(v))]: R's permutation of a vector. */
  const permute = v => sample(v.length).map(i => v[i - 1]);
  return { unif, index, sample, permute };
}
/** R's sum(utf8ToInt(name)): the seed base 05-resampling.R gives each named test. */
export const utf8Sum = name => [...String(name)].reduce((s, c) => s + c.codePointAt(0), 0);   // utf8ToInt gives code points
