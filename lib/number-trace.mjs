// What a reported number is and what went in (docs/Sham_Needs_Review_2026-11.md, need 4). A number of a registered manuscript, as the
// structured check holds it (lib/number-check.mjs), traced to the output of the recorded analysis run that printed it: which output, what
// that output prints, whether the text agrees with it (the same number, the run's number rounded to the text's decimals, or another
// number), and the rows that output read (its `reads`: a study, an outcome slot and an arm each, lib/run-reads.mjs). The numbers beside it
// choose the output: those of its sentence, or of its table row, that the same output prints. Pure: the check and the run in, words out;
// the Manuscript reader draws one number in the side panel (views/manuscript-reader.mjs), `traceCounts` counts a whole file.

export const VERDICTS = Object.freeze({ match: 'Matches the run', rounding: 'Differs by rounding', differs: 'Differs from the run' });

const words = t => String(t).toLowerCase().match(/[a-z]{4,}/g) || [];
const dec = s => (String(s).split('.')[1] || '').length;
const NOUN = /^\s*(?:\(|%)?\s*(?:trials?|studies|outcomes?|participants?|patients?|arms?|comparisons?)\b/i;

/**
 * The text's number against the numbers an output prints: 'match' (the same number, "0.340" and "0.34" alike), 'rounding' (a number with
 * more decimals that rounds to it: 18.28 printed as 18.3), or '' with neither. `{ verdict, value }`, `value` the run's number.
 */
export function numberVerdict(x, nums = []) {
  const v = Number(x);
  if (!Number.isFinite(v)) return { verdict: '', value: '' };
  for (const y of nums) if (Number(y) === v) return { verdict: 'match', value: y };
  const d = dec(x), half = 0.5 * 10 ** -d + 1e-9;
  for (const y of nums) if (dec(y) > d && Math.abs(Number(y) - v) <= half) return { verdict: 'rounding', value: y };
  return { verdict: '', value: '' };
}

const byRun = new WeakMap();
const outputsOf = run => { let m = byRun.get(run); if (!m) byRun.set(run, (m = new Map(run.outputs.map(o => [o.id, o])))); return m; };
const held = new WeakMap();
const holding = (run, x) => {
  let m = held.get(run);
  if (!m) { m = new Map(); for (const o of run.outputs) for (const n of new Set(o.nums || [])) { if (!m.has(n)) m.set(n, []); m.get(n).push(o.id); } held.set(run, m); }
  return m.get(x) || [];
};
// the rows of the check by the sentence they stand in, or by a table's row (an estimate and its interval may be cells of their own)
const groupsOf = new WeakMap();
const keyOf = p => (p ? (p.cell ? `${p.file}:${p.block}:r${p.cell.row}` : `${p.file}:${p.block}:s${p.sentence}`) : '');
function neighbours(check, ck) {
  let g = groupsOf.get(check);
  if (!g) {
    g = new Map();
    for (const r of check?.rows || []) { const k = keyOf(r.place); if (!k) continue; if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    groupsOf.set(check, g);
  }
  return (g.get(keyOf(ck.place)) || []).filter(r => r !== ck && r.number !== ck.number);
}

/**
 * The trace of check row `ck`: `{ output, verdict, value, support, why }`, `output` the run's output ({ id, title, level, text, reads }) or
 * null. `support` counts the numbers beside it that the output also prints. Of the outputs the check named for it (else those its
 * neighbours name) the one most of its neighbours agree with; then 'match' or 'rounding'. 'differs' is the check's own cross-check of the
 * run (lib/cross-checks.mjs, kind 'run': a number its source does not hold, beside two numbers of one output that prints a number near
 * it), so the panel and the check say the same. An integer is traced beside a decimal of the same output ("0.34 … in 59 trials") or as a
 * count of trials, studies or outcomes: a page or a table's number is not a result.
 */
export function traceNumber(ck, { check = null, run = null } = {}) {
  const none = { output: null, verdict: '', value: '', support: 0, why: '' };
  if (!ck?.place || !run?.outputs?.length) return none;
  const byId = outputsOf(run), near = neighbours(check, ck);
  const pack = o => ({ id: o.id, title: o.title || o.id, level: o.level || '', text: o.text || '', reads: Array.isArray(o.reads) ? o.reads : null });
  const cross = (check?.cross || []).find(x => x.kind === 'run' && x.rows?.[0] === ck.n);
  if (cross) {
    // the output both of its neighbours name
    const named = cross.rows.slice(1).map(n => new Set(check.rows[n]?.source?.outputs || []));
    const id = [...(named[0] || [])].find(i => named.every(set => set.has(i)) && byId.has(i));
    const value = /which prints (\S+?)\.?$/.exec(cross.text || '')?.[1] || '';
    return { output: id ? pack(byId.get(id)) : null, verdict: 'differs', value, support: named.length, why: cross.text || '' };
  }
  const own = (ck.source?.outputs || []).filter(id => byId.has(id));
  // the outputs the check named, those its neighbours name, and any other that prints it (the check keeps the best by numbers alone)
  const ids = [...new Set([...own, ...near.flatMap(r => r.source?.outputs || []), ...holding(run, ck.number)])].filter(id => byId.has(id));
  // a tie between outputs is broken by the words of their titles the sentence uses ("serious adverse events"); nothing to choose by, none
  const ctx = String(ck.context || ''), said = new Set(words(ctx));
  let best = null, tied = false;
  const exact = holding(run, ck.number).length > 0;
  for (const id of ids) {
    const o = byId.get(id), v = numberVerdict(ck.number, o.nums || []);
    // rounding is read only for a decimal no output prints as it stands, with two decimals of that output right beside it (its estimate, its interval)
    if (!v.verdict || (v.verdict === 'rounding' && (!dec(ck.number) || exact))) continue;
    const set = new Set(o.nums || []), held = near.filter(r => set.has(r.number));
    const support = new Set(held.map(r => r.number)).size, decimals = new Set(held.filter(r => dec(r.number) > 0).map(r => r.number)).size, decimal = decimals > 0;
    // what stands before it within 60 characters (its estimate) and just after it (its interval: "0.09 (95% CI 0.07") decide first; then an output the check named (it read the
    // number's own clause), one the close neighbours' clauses named (an interval follows its estimate), the rest of the sentence, the title
    const closeRows = held.filter(r => { const g = r.place.at - ck.place.at; return (g < 0 && g >= -60) || (g > 0 && g <= ck.number.length + 20); });
    const close = new Set(closeRows.map(r => r.number)).size, closeDecimals = new Set(closeRows.filter(r => dec(r.number) > 0).map(r => r.number)).size;
    const agree = closeRows.filter(r => (r.source?.outputs || []).includes(id)).length;
    const title = words(`${o.title || ''} ${o.level || ''}`).filter(w => said.has(w)).length, score = close * 10000 + (own.includes(id) ? 1000 : 0) + agree * 300 + support * 100 + title * 2;
    if (!best || score > best.score) { best = { o, v, support, decimals: closeDecimals, decimal, score }; tied = false; } else if (score === best.score) tied = true;
  }
  // with no number beside it to agree, two words of a title must name it
  if (best?.v.verdict === 'rounding' && best.decimals < 2) return none;
  if (!best || (tied && !best.score) || (!best.support && best.score < 4 && !(own.length === 1 && own[0] === best.o.id))) return none;
  const { o, v, support, decimal } = best, after = ctx.slice(ctx.indexOf(ck.number) + ck.number.length);
  if (!dec(ck.number) && !decimal && !(own.length && NOUN.test(after))) return none;
  return { output: pack(o), ...v, support, why: '' };
}

/**
 * The rows an output read, for a list: [{ pid, slot, arm, unit }] in the run's order. A unit is "<study index>~<outcome slot>@<arm>", or
 * "<study index>" for a study's own row (lib/run-reads.mjs).
 */
export function inputRows(output, run) {
  const trials = run?.trials || [], out = [];
  for (const u of output?.reads || []) {
    const m = /^(\d+)(?:~([^@]+))?(?:@(.+))?$/.exec(String(u));
    const pid = m ? trials[+m[1]] : null;
    if (pid) out.push({ pid, slot: m[2] || '', arm: m[3] || '', unit: u });
  }
  return out;
}

/** "o2" is "outcome 2", "arm3" "arm 3". */
export const slotText = s => String(s || '').replace(/^o(\d+)$/, 'outcome $1');
export const armText = s => String(s || '').replace(/^arm(\d+)$/, 'arm $1');

/** "123 rows from 59 trials". */
export function inputsText(rows) {
  const n = rows.length, t = new Set(rows.map(r => r.pid)).size;
  if (!n) return '';
  return n === t ? `${n.toLocaleString('en')} ${n === 1 ? 'trial' : 'trials'}` : `${n.toLocaleString('en')} rows from ${t.toLocaleString('en')} ${t === 1 ? 'trial' : 'trials'}`;
}

/**
 * The numbers of one file of the check (`file` its index, every file when null), counted: { numbers, run, match, rounding, differs,
 * output, record, untraced }. A number is traced to the run (match or rounding), differs from it, is a Lykos output's cell, rests on
 * named values of the record, or is untraced (a design value, a cited figure, a count the run does not print).
 */
export function traceCounts(check, run, { file = null } = {}) {
  const c = { numbers: 0, run: 0, match: 0, rounding: 0, differs: 0, output: 0, record: 0, untraced: 0 };
  for (const r of check?.rows || []) {
    if (file != null && r.file !== file) continue;
    c.numbers++;
    const t = traceNumber(r, { check, run });
    if (t.verdict === 'differs') c.differs++;
    else if (t.verdict) { c.run++; c[t.verdict]++; }
    else if (r.source?.kind === 'output') c.output++;
    else if (r.source?.valueIds?.length) c.record++;
    else c.untraced++;
  }
  return c;
}

// "0.34 (0.16 to 0.52", "9.0% (95% CI 6.3 to 11.7": an estimate with its interval, read where the estimate stands in its row's context
const TRIPLE = /^%?\s*\((?:95% CI |CI |IQR )?(-?\d+\.\d+)%? to (-?\d+\.\d+)/;
/**
 * The owner's triple check (07b-check-triples.mjs) on the check's rows: every "estimate (lo to hi)" of decimals, and whether one output
 * of the run prints all three. { triples, inRun, notInRun: [{ n, text }] }, `file` one file's index or every file.
 */
export function tripleCheck(check, run, { file = null } = {}) {
  const out = { triples: 0, inRun: 0, notInRun: [] };
  for (const r of check?.rows || []) {
    if ((file != null && r.file !== file) || !dec(r.number)) continue;
    const c = String(r.context || ''), at = c.indexOf(r.number), m = at >= 0 ? TRIPLE.exec(c.slice(at + r.number.length).trimStart()) : null;
    if (!m) continue;
    out.triples++;
    const all = [r.number, m[1], m[2]], hit = (run?.outputs || []).some(o => { const set = new Set(o.nums || []); return all.every(x => set.has(x)); });
    if (hit) out.inRun++; else out.notInRun.push({ n: r.n, text: `${r.number} (${m[1]} to ${m[2]})` });
  }
  return out;
}
