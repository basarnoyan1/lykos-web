// The size of a project as JSON: the UTF-8 bytes of JSON.stringify(state), the figure Settings > General shows. Stringifying a 30,000-record
// project in one go held the page for a second on every opening of General (WebKit, 2 Nov 2026), so the text is made a slice at a time
// after paint, entry by entry of each top-level section, and only its length is kept: once per version of the project.
// The pieces join to exactly JSON.stringify(state): the state and its sections are opened, and below them a plain object or list of more
// than WIDE entries (Sham's valueChecks.studies, 7 MB in one entry), down to DEPTH levels; everything else is stringified whole.

const SLICE_MS = 8, WIDE = 64, DEPTH = 4;
let known = { version: -1, bytes: null }, running = null;

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.toJSON !== 'function' && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const container = v => Array.isArray(v) || plain(v);
// an entry of the state (a section) is always opened; below that, only a wide one
const opens = (v, depth, level) => depth > 1 && container(v) && (level === 0 || (Array.isArray(v) ? v.length : Object.keys(v).length) > WIDE);

/** The pieces of JSON.stringify(v): `v` and its entries opened, then the wide ones, `depth` levels down in all. */
export function* jsonPieces(v, depth = DEPTH, level = 0) {
  if (depth > 0 && Array.isArray(v)) {
    yield '[';
    for (let i = 0; i < v.length; i++) {
      if (i) yield ',';
      const x = v[i];
      if (opens(x, depth, level)) yield* jsonPieces(x, depth - 1, level + 1);
      else yield JSON.stringify(x) ?? 'null';   // undefined, a function or a symbol in a list is null
    }
    yield ']';
  } else if (depth > 0 && plain(v)) {
    yield '{';
    let n = 0;
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (opens(x, depth, level)) { yield `${n++ ? ',' : ''}${JSON.stringify(k)}:`; yield* jsonPieces(x, depth - 1, level + 1); continue; }
      const t = JSON.stringify(x);
      if (t !== undefined) yield `${n++ ? ',' : ''}${JSON.stringify(k)}:${t}`;   // an undefined value leaves its key out
    }
    yield '}';
  } else yield JSON.stringify(v);
}

/** The bytes already worked out for this version of the project, or null. */
export const knownStateSize = version => (known.version === version ? known.bytes : null);

/** Resolves to the UTF-8 bytes of JSON.stringify(state), made in slices of about SLICE_MS; null when a newer version asked meanwhile. */
export function stateSize(state, version) {
  if (known.version === version) return Promise.resolve(known.bytes);
  if (running?.version === version) return running.promise;
  const job = { version };
  job.promise = (async () => {
    const it = jsonPieces(state);
    let bytes = 0;
    for (;;) {
      const until = performance.now() + SLICE_MS, batch = [];
      let r;
      while (!(r = it.next()).done) { batch.push(r.value); if (performance.now() > until) break; }
      bytes += new Blob(batch).size;
      if (r.done) break;
      await new Promise(resolve => setTimeout(resolve, 0));
      if (running !== job) return null;
    }
    known = { version, bytes };
    return bytes;
  })().finally(() => { if (running === job) running = null; });
  running = job;
  return job.promise;
}

/**
 * Which of `hashes` the project's own text names (lib/figures.mjs namedIn over JSON.stringify(state)), read a slice at a time: the figure
 * clean-up stringified a 30,000-record project whole, a second's hold each time Settings > General opened (WebKit, 2 Nov 2026). A hash is
 * never cut, the pieces ending between entries. A change made meanwhile (the version moved) reads it again; after three, in one go.
 */
export async function namedInState(stateOf, versionOf, hashes, namedIn) {
  for (let pass = 0; pass < 3; pass++) {
    const at = versionOf(), refs = new Set(), it = jsonPieces(stateOf());
    let done = false;
    while (!done) {
      const until = performance.now() + SLICE_MS, batch = [];
      for (;;) { const r = it.next(); if (r.done) { done = true; break; } batch.push(r.value); if (performance.now() > until) break; }
      namedIn(batch.join(''), hashes, refs);
      if (refs.size >= hashes.length) return refs;
      if (!done) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (versionOf() === at) return refs;
  }
  return namedIn(JSON.stringify(stateOf()), hashes);
}
