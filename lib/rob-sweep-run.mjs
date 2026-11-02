// Running risk-of-bias sweeps (lib/rob-sweep.mjs) with models, the same way from a workflow block in the window (lib/flow-runner.mjs,
// block rob_sweep) and from a shell (tools/lykos-rob-sweep.mjs run): every included study, each reading, each model of the team, a few at
// once; a study's sweeps are saved together as soon as the last of them is back. The caller gives the model call, the full text and the save.
import { schema$allTools as allTools } from "../boot.mjs";
import { stopsRun } from './provider-error.mjs';
import { lib_rob_review$recordOf as recordOf } from "../boot.mjs";
import { includedIds, studyName } from './review-ledger.mjs';
import { STANCES, STANCE_IDS, sweepPrompt, parseSweep, checkQuotes, sweepsOf, sweepFingerprint } from './rob-sweep.mjs';

/** The included studies with their instrument and what the review appraises: [{ id, label, tool, toolId, target, pdf }]. */
export function sweepStudies(s) {
  const tools = new Map(allTools(s).map(t => [t.id, t]));
  // 31 Oct 2026: a study with no instrument of its own takes the review's (appraisalTool), and a report linked to its trial's main report
  // (op report_of) is appraised with that trial, not on its own
  const inc = includedIds(s), byId = new Map((s.papers || []).map(p => [p.id, p])), incSet = new Set(inc);
  return inc.filter(id => !incSet.has(byId.get(id)?.reportOf)).map(id => {
    const p = byId.get(id) || {}, toolId = s.appraisalByStudy?.[id] || Object.keys(s.assessments?.[id] || {})[0] || s.appraisalTool || '';
    const rec = recordOf(s, id, toolId);
    return { id, label: studyName(s, id), tool: tools.get(toolId) || null, toolId, target: rec?.doc?.target || null, pdf: rec?.doc?.pdf || p.pdfRel || p.pdfName || '' };
  });
}

/** The studies a list of names, ids or file names picks ("" or null: all). */
export function pickStudies(all, refs) {
  if (!refs) return all;
  const want = (Array.isArray(refs) ? refs : String(refs).split(',')).map(x => String(x).trim().toLowerCase()).filter(Boolean);
  return all.filter(x => want.some(w => x.id.toLowerCase() === w || x.label.toLowerCase().includes(w) || String(x.pdf).toLowerCase().includes(w)));
}

const slug = c => String(c.model || c.label || c.provider || 'model').toLowerCase().replace(/^~/, '').split('/').pop().replace(/[^a-z0-9.]+/g, '-').slice(0, 24);

/**
 * The work: one task per study, reading and model ({ study, stance, member, key, prev }). A sweep already recorded is left out, unless
 * `again` (make every one again) or `recheck` (keep it in, with `prev`: runSweeps makes it again only when what it was made from changed,
 * sweepFingerprint). A key is the stance alone for a team of one, unless that stance is recorded by another model: then the stance and
 * the model ("neutral:deepseek-flash"), so a second model's sweeps sit beside the first's and never replace them.
 */
export function sweepTasks(s, studies, { stances = STANCE_IDS, team = [], again = false, recheck = false } = {}) {
  const keyOf = (x, st, m) => {
    if (team.length > 1) return `${st}:${slug(m)}`;
    const plain = sweepsOf(s, x.id, x.toolId)[st];
    return plain && plain.model && m.model && plain.model !== m.model ? `${st}:${slug(m)}` : st;
  };
  return studies.filter(x => x.tool).flatMap(x => stances.filter(st => STANCES[st]).flatMap(st => team.map(m => {
    const key = keyOf(x, st, m);
    return { study: x, stance: st, member: m, key, prev: sweepsOf(s, x.id, x.toolId)[key] || null };
  }))).filter(t => again || recheck || !t.prev);
}

/**
 * Runs the tasks: `call(cfg, messages)` answers the model's text, `textOf(study)` the full text (a string, or a promise), `save(study, entries)`
 * writes a study's sweeps ([[path, sweep]], paths under robSweeps); `ocrPagesOf(study)` the pages its text recognition read (quotes from them are
 * marked ocr and counted apart); `on.start|done|fail(task, words)` report; `stopped()` ends early.
 * Answers { done, failed }.
 */
export async function runSweeps(tasks, { call, textOf, save, nameOf = c => c.label || c.provider, parallel = 4, on = {}, stopped = () => false, again = false, ocrPagesOf = () => [] } = {}) {
  const left = new Map(), got = new Map();
  for (const t of tasks) left.set(t.study.id, (left.get(t.study.id) || 0) + 1);
  let done = 0, failed = 0, unchanged = 0, halted = '';
  const finish = async t => {
    left.set(t.study.id, left.get(t.study.id) - 1);
    if (!left.get(t.study.id) && got.get(t.study.id)?.length) {
      try { await save(t.study, got.get(t.study.id)); on.saved?.(t.study); } catch (e) { on.note?.(`${t.study.label} not saved: ${e.message}`); }
    }
  };
  const one = async t => {
    on.start?.(t, 'reading the full text');
    try {
      const text = await textOf(t.study);
      if (!String(text || '').trim()) throw new Error('no full text');
      const fp = sweepFingerprint({ tool: t.study.tool, text, target: t.study.target, model: t.member.model || '' });
      // a recheck: the same instrument, target, text, prompt and model as the sweep recorded, so its answer would be the same
      if (!again && t.prev && (t.prev.fp === fp || !t.prev.fp)) { unchanged++; on.done?.(t, t.prev.fp ? 'unchanged since its sweep' : 'kept (recorded before inputs were fingerprinted)'); await finish(t); return; }
      const reply = await call(t.member, sweepPrompt({ tool: t.study.tool, study: t.study.label, text, stance: t.stance, target: t.study.target }));
      const sw = parseSweep(reply, t.study.tool), missing = checkQuotes(sw, text, ocrPagesOf(t.study));
      if (!Object.keys(sw.domains).length) throw new Error(sw.problems[0] || 'no domains in the answer');
      const value = { by: nameOf(t.member), model: t.member.model || '', at: new Date().toISOString(), stance: t.stance, fp, domains: sw.domains, quotesNotFound: missing, ...(sw.quotesOcr ? { quotesOcr: sw.quotesOcr } : {}), ...(sw.problems.length ? { problems: sw.problems.slice(0, 12) } : {}) };
      (got.get(t.study.id) || got.set(t.study.id, []).get(t.study.id)).push([['robSweeps', 'studies', t.study.id, t.study.toolId, t.key], value]);
      done++;
      on.done?.(t, `${Object.entries(sw.domains).map(([k, v]) => `${k} ${v.judgement || '?'}`).join(', ')}${missing ? `; ${missing} quotes not in the text` : ''}${sw.quotesOcr ? `; ${sw.quotesOcr} on pages read by text recognition` : ''}`);
    } catch (e) { failed++; if (stopsRun(e)) halted ||= String(e?.message || e); on.fail?.(t, String(e?.message || e).slice(0, 160)); }
    await finish(t);
  };
  // a study's readings one after another in one worker: their prompts share the instrument and the text, which a provider that caches a
  // prompt's beginning then reads from its cache for the second and third (studies run side by side, `parallel` at a time)
  const groups = [...tasks.reduce((m, t) => m.set(t.study.id, [...(m.get(t.study.id) || []), t]), new Map()).values()];
  let g = 0;
  const worker = async () => { while (g < groups.length && !stopped() && !halted) { const group = groups[g++]; for (const t of group) { if (stopped() || halted) break; await one(t); } } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(8, parallel, groups.length)) }, worker));
  return { done, failed, unchanged, ...(halted ? { halted, left: groups.length - g } : {}) };
}

// Where a study's full text comes from: the window reads the PDF (lib/doctext.mjs); a shell sets its own (tools/lykos-flow.mjs: the
// verification's text files), so the same workflow block runs in both.
let textSource = null;
export const setSweepText = fn => { textSource = fn; };
export const sweepText = () => textSource;

/** Writes sweeps into a project state (the window's save; the shell writes change files instead). */
export function putSweeps(st, entries) {
  st.robSweeps ||= { v: 1, studies: {} };
  st.robSweeps.studies ||= {};
  for (const [p, value] of entries) {
    let o = st;
    for (const k of p.slice(0, -1)) o = (o[k] ||= {});
    o[p.at(-1)] = value;
  }
  return st;
}
