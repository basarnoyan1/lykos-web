import { ResourceQueue, stoppedError } from './resource-queue.mjs';

/**
 * Releases the R runtime when the window has been hidden for `ms` (a minimized window, another desktop, a closed lid) and shows again at
 * once: coming back before `ms` cancels it. `release` refuses while a computation is queued, so a running analysis is never cut.
 * Returns a function that stops watching. `doc` is the document (anything with visibilityState and add/removeEventListener).
 */
export function releaseWhenHidden(doc, release, ms = 60_000, timers = { set: (f, t) => setTimeout(f, t), clear: (h) => clearTimeout(h) }) {
  let timer = null;
  const stop = () => { if (timer !== null) { timers.clear(timer); timer = null; } };
  const onChange = () => {
    if (doc.visibilityState !== 'hidden') return stop();
    if (timer !== null) return;
    timer = timers.set(() => { timer = null; if (doc.visibilityState === 'hidden') release(); }, ms);
    timer?.unref?.();
  };
  doc.addEventListener('visibilitychange', onChange);
  return () => { doc.removeEventListener('visibilitychange', onChange); stop(); };
}

// Runtime lifetime and queue are injectable for failure/cancellation tests.
export function createRSession({ start, install, idleMs = 600_000, status = () => {} }) {
  const queue = new ResourceQueue();
  let booting = null, runtime = null, idle = null, svgSeq = 0;
  const loading = new Map(), loaded = new Set(), known = new Map();
  let rVersion = null;
  const check = signal => { if (signal?.aborted) throw stoppedError(); };
  const release = async () => {
    if (queue.size) return false;
    clearTimeout(idle); idle = null;
    if (booting) await booting.catch(() => {});
    if (queue.size) return false;
    runtime?.close(); runtime = null; booting = null;
    loading.clear(); loaded.clear(); known.clear(); rVersion = null;
    status('R released'); return true;
  };
  const armIdle = () => { clearTimeout(idle); idle = setTimeout(() => release(), idleMs); idle.unref?.(); };
  const ready = async (pkgs, progress) => {
    clearTimeout(idle);
    if (!booting) { progress('Starting R'); booting = start().then(r => runtime = r).catch(error => { booting = null; throw error; }); }
    const r = await booting, need = pkgs.filter(p => !loading.has(p));
    if (need.length) {
      const work = install(r, need, progress).then(() => need.forEach(p => loaded.add(p))).catch(error => { need.forEach(p => loading.delete(p)); throw error; });
      need.forEach(p => loading.set(p, work));
    }
    await Promise.all(pkgs.map(p => loading.get(p))); return r;
  };
  const run = (pkgs, progress, signal, fn) => {
    progress(queue.size ? 'Queued' : 'Starting');
    return queue.run(async () => { check(signal); const r = await ready(pkgs, progress); check(signal); return fn(r, () => check(signal)); }, { signal, interrupt: () => runtime?.interrupt() })
      .finally(() => { status(`R ready · ${[...loaded].join(', ')}`); armIdle(); });
  };
  const versions = async (r, pkgs) => {
    const ask = pkgs.filter(p => !known.has(p));
    if (ask.length || !rVersion) {
      const answer = await r.evalRString(`paste(c(R.version.string, ${ask.map(p => `as.character(packageVersion(${JSON.stringify(p)}))`).join(', ')}), collapse = "\\n")`);
      const [rv, ...vs] = String(answer).split('\n'); rVersion = rv; ask.forEach((p, i) => known.set(p, vs[i] || ''));
    }
    return { r: rVersion || '', packages: Object.fromEntries(pkgs.map(p => [p, known.get(p) || ''])) };
  };
  return {
    installed: () => [...loaded], release, size: () => queue.size,
    configure: ({ idleMs: ms, maxPending } = {}) => { if (Number.isFinite(ms) && ms >= 1000) idleMs = ms; if (Number.isInteger(maxPending) && maxPending > 0) queue.maxPending = maxPending; if (runtime && !queue.size) armIdle(); },
    engine: (pkgs, progress = () => {}, signal) => run(pkgs, progress, signal, r => r),
    runR: (pkgs, code, progress = () => {}, signal) => run(pkgs, progress, signal, async (r, check) => {
      progress('Computing');
      const script = `suppressMessages({ ${pkgs.map(p => `library(${p})`).join('; ')} })\nlocal({ ${code} })`;
      const shelter = await new r.Shelter();
      try {
        const out = await shelter.evalR(script); check();
        const res = flatten(await out.toJs({ depth: 0 })); check();
        if (res && typeof res === 'object' && !Array.isArray(res) && pkgs.length) res.rScript = { code: script, ...await versions(r, pkgs), at: new Date().toISOString() };
        check(); return res;
      } finally { await shelter.purge(); }
    }),
    runSvg: (pkgs, code, progress = () => {}, signal) => run(pkgs, progress, signal, async (r, check) => {
      progress('Drawing'); const path = `/tmp/fig-${++svgSeq}.svg`, q = JSON.stringify(path);
      try {
        const res = await r.evalRString('local({ paste(as.character(tryCatch({suppressMessages({' + pkgs.map(p => `library(${p})`).join('; ') + '})\nsuppressWarnings({' + code.replaceAll('OUTFILE', q) + '})\nif (!file.exists(' + q + ')) stop("no figure was written")\npaste(readLines(' + q + '), collapse="\\n")}, error=function(e) paste("LYKOS-ERROR:", conditionMessage(e)))), collapse="\\n")[1] })');
        check(); if (res.startsWith('LYKOS-ERROR:')) throw new Error(res.slice(12).trim()); return res;
      } finally { await r.FS.unlink(path).catch(() => {}); }
    }),
  };
}
function flatten(js) {
  if (js?.type !== 'list') return js?.values ?? js;
  const o = {};
  js.names.forEach((name, i) => { const value = js.values[i]; o[name] = value?.type === 'null' ? null : value?.values ? (value.values.length === 1 ? value.values[0] : value.values) : value; });
  return o;
}
