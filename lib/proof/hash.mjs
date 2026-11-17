// Content hashes for the proof graph (no Node modules, so the app can run it too). A node's identity is the hash of what it is made from,
// so a proof is recomputed only when something it rests on changed, and one root hash stands for a whole project's proofs (a Merkle root).

/** A 64-bit hash of a string as 16 hex digits (cyrb53 widened to two 32-bit lanes); stable across runs and platforms. */
export function hash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** JSON with object keys sorted, so equal data always gives equal text (and equal hashes). */
export function stable(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x === undefined ? null : x);
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  return `{${Object.keys(x).filter(k => x[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(x[k])}`).join(',')}}`;
}

export const hashOf = x => hash(stable(x));

/** The Merkle root of named child hashes: the hash of their sorted (name, hash) pairs. */
export const merkle = children => hash(Object.keys(children).sort().map(k => `${k}=${children[k]}`).join('\n'));
