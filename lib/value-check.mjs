// Checking extracted values against the paper (2026-10-24): for one study, every value of the review's extraction table (each arm's on its
// own) is set before a model or a reviewer with the full text, the column's guidance and the table's conventions; each comes back as
// agreeing, disagreeing (with the value the paper supports, in the table's own format) or not in the paper, with a verbatim quote. The
// project keeps the last check of each study in `valueChecks` ({ v: 1, studies: { [record]: { by, model, at, fields: { [key]: check } } } },
// key "field" or "field@arm1"), written by change files (tools/lykos-check-values.mjs); a disagreement is a finding to settle in Extraction,
// never a change of the value itself.
// A value settled once (a quote found in the text, or a reviewer's decision: lib/value-accuracy.mjs) is not asked again, and a later check cannot
// reopen it on its own word: only a disagreement whose quote is in the text is kept, beside it, as a challenge.
import { quoteFound, valueState, mergeCheck, ocrQuotePage, recordedIs } from './value-accuracy.mjs';
import { stopsRun } from './provider-error.mjs';
import { isIdLabel } from './id-column.mjs';

const FORMAT_FIELDS = new Set(['id', 'main_table']);   // numbering and grouping the review assigns, not facts of the paper

/** The values of a study to check: [{ key, field, arm, label, guidance, value }], in the table's column order. */
export function valuesToCheck(s, template, paperId, { skip = FORMAT_FIELDS } = {}) {
  const cols = template?.columns || [], out = [];
  // the study's own keys, found once (each column filtered every value of the project: 76 columns of 100,000 keys a study)
  const prefix = `${paperId}:`, mine = Object.keys(s.values || {}).filter(k => k.startsWith(prefix));
  for (const c of cols) {
    const short = c.id.slice(c.id.indexOf('.') + 1);
    if (skip.has(short) || isIdLabel(c.label)) continue;   // the review's own numbering ("#", "No."), not a fact of the paper
    // a column's cells: the study's, an arm's ("@arm2") and an outcome entry's ("~o1", "~o1@arm2", lib/outcome-store.mjs), keyed as the checks keep them
    const base = `${paperId}:${c.id}`, keys = mine.filter(k => k === base || k.startsWith(`${base}@`) || k.startsWith(`${base}~`));
    for (const k of keys) {
      const tail = k.slice(base.length), arm = tail.includes('@') ? tail.slice(tail.indexOf('@') + 1) : '';
      const q = s.values[k]?.qualifier;
      out.push({ key: `${short}${tail}`, field: c.id, arm, label: c.label, guidance: c.guidance || '', value: String(s.values[k]?.reported_value ?? ''), ...(q ? { qualifier: String(q) } : {}) });
    }
  }
  return out;
}

/** The messages that ask for one study's check. `arms` the table's arm labels for the study ([{ id, label }]). */
export function checkPrompt({ template, study, values, text, arms = [], max = 90000 }) {
  const conv = [].concat(template?.conventions || []).map(c => `- ${c}`).join('\n').slice(0, 4000);
  const armText = arms.length ? `Arms: ${arms.map(a => `${a.id} = ${a.label}`).join('; ')}.` : 'The study has one arm (no separate comparator).';
  const system = `You check a systematic review's data extraction against the study's full text. For each recorded value, decide:
- "agree": the paper supports the value as written (allow for the table's format conventions, rounding as reported and the review's own wording);
- "disagree": the paper supports a different value — give it in "correct", in the same format and wording style as the table;
- "not-in-paper": the paper does not report it (then the right value is NR or NA as the conventions say).
Quote the passage that decides it verbatim (copied exactly, with the page when the text shows it). Judge each value only against the paper, not against the other values. Be strict on numbers, denominators and arm attribution.
Your job is to confirm or dispute each listed value, not to find something wrong: when the paper supports the value, answer "agree". A "disagree" must quote the passage that contradicts the value; without such a quote, answer "agree" or "not-in-paper". Report only reported values: never compute one (a percentage, a conversion, a total) and call it the paper's.
Reply with one JSON object only: {"checks": {"<key>": {"verdict": "agree|disagree|not-in-paper", "correct": "<value, only for disagree>", "why": "<one sentence>", "quote": "<verbatim>", "page": <number or null>}}}`;
  const lines = values.map(v => `- ${v.key} (${v.label}${v.arm ? `, ${v.arm}` : ''}): ${JSON.stringify(v.value)}${v.guidance ? `\n    column guidance: ${v.guidance.slice(0, 300)}` : ''}`).join('\n');
  const user = `Table conventions:\n${conv}\n\nStudy: ${study}. ${armText}\n\nRecorded values:\n${lines}\n\nFull text:\n${String(text || '').slice(0, max)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

const VERDICTS = new Set(['agree', 'disagree', 'not-in-paper']);
/** A check from a reply (text or object): only the keys asked, known verdicts; problems listed. */
export function parseCheck(raw, values) {
  let o = raw;
  if (typeof raw === 'string') {
    const t = raw.replace(/```(?:json)?/gi, ''), m = t.match(/\{[\s\S]*\}/);
    try { o = JSON.parse(m ? m[0] : t); } catch { return { fields: {}, problems: ['not JSON'] }; }
  }
  // 31 Oct 2026: answers keyed as asked, or as a list of {key, …}, or with the key's case and spacing changed ("O1_change_mean @arm2")
  let src = o?.checks || o?.values || o || {};
  const keyOf = x => x && (x.key || x.id || x.value_id || x.valueId || x.field);
  if (Array.isArray(src)) src = Object.fromEntries(src.filter(keyOf).map(x => [String(keyOf(x)), x]));
  const fold = k => String(k).toLowerCase().replace(/\s+/g, ''), folded = new Map(Object.entries(src).map(([k, x]) => [fold(k), x]));
  const fields = {}, problems = [];
  for (const v of values) {
    const x = src[v.key] || folded.get(fold(v.key));
    if (!x) { problems.push(`${v.key}: missing`); continue; }
    const verdict = String(x.verdict || '').trim().toLowerCase();
    if (!VERDICTS.has(verdict)) { problems.push(`${v.key}: verdict "${x.verdict}"`); continue; }
    fields[v.key] = { verdict, recorded: v.value, ...(verdict === 'disagree' && x.correct != null ? { correct: String(x.correct).slice(0, 600) } : {}), why: String(x.why || '').slice(0, 600),
      ...(x.quote ? { quote: String(x.quote).slice(0, 1200) } : {}), ...(x.page != null && x.page !== '' ? { page: x.page } : {}) };
  }
  return { fields, problems };
}

/** Marks each quote found in the text or not (word for word; case, spacing and punctuation aside); answers how many were not. */
// A quote on a page read by text recognition (`ocrPages`, tools/fulltext.mjs ocrPagesOf) is marked `ocr` with that page, counted apart (ocr).
export function checkCheckQuotes(check, text, ocrPages = []) {
  let missing = 0, ocr = 0;
  for (const f of Object.values(check.fields || {})) if (f.quote) {
    f.found = quoteFound(f.quote, text); if (!f.found) missing++;
    const p = ocrQuotePage(f.quote, text, ocrPages, f.page);
    if (p != null) { f.ocr = true; f.page = p; ocr++; } else delete f.ocr;
  }
  check.ocr = ocr;
  return missing;
}

/** What a study's last check found: { agree, disagree, notInPaper, unchecked, findings: [{ key, recorded, correct, why, quote, found }] }. */
export function checkSummary(s, paperId, values) {
  const c = s.valueChecks?.studies?.[paperId], f = c?.fields || {}, out = { agree: 0, disagree: 0, notInPaper: 0, unchecked: 0, stale: 0, settled: 0, challenged: 0, findings: [], by: c?.by || '', at: c?.at || '' };
  for (const v of values) {
    const x = f[v.key];
    if (!x) { out.unchecked++; continue; }
    if (!recordedIs(x.recorded, v.value, v.qualifier)) { out.stale++; continue; }   // the value changed since it was checked
    if (x.challenge) { out.challenged++; out.findings.push({ key: v.key, ...x, ...x.challenge, recorded: x.recorded, challenged: true }); continue; }
    if (x.settled) { out.settled++; continue; }   // decided by a reviewer, with the reason recorded
    if (x.verdict === 'agree') out.agree++;
    else { if (x.verdict === 'disagree') out.disagree++; else out.notInPaper++; if (!(x.verdict === 'not-in-paper' && /^(NR|NA|not reported)\b/i.test(v.value))) out.findings.push({ key: v.key, ...x }); }
  }
  return out;
}

/**
 * Checks studies with a model, a few at once (the shell's lykos verify run and the workflow block "Check extracted values"): `call(cfg,
 * messages)` the model's text, `textOf(study)` its full text, `save(study, check)` writes one study's check; `on.start|done|fail` report.
 * `studies` [{ id, label }]; `template` the extraction table. Answers { done, failed }.
 */
export async function runChecks(s, studies, { template, cfg, call, textOf, save, nameOf = c => c.label || c.provider, parallel = 4, on = {}, stopped = () => false, again = false, batch = 60 } = {}) {
  let i = 0, done = 0, failed = 0, halted = '';
  const one = async x => {
    on.start?.(x, 'reading the full text');
    try {
      const text = await textOf(x), all = valuesToCheck(s, template, x.id), prev = s.valueChecks?.studies?.[x.id]?.fields || {};
      if (!String(text || '').trim()) throw new Error('no full text');
      if (!all.length) throw new Error('no values to check');
      // a settled value is asked again only with `again`, and stays settled whatever the answer (mergeCheck)
      const values = again ? all : all.filter(v => !['settled', 'challenged'].includes(valueState(prev[v.key], v.value, null, v.qualifier)));
      if (!values.length) { done++; on.done?.(x, 'every value settled'); return; }
      // asked in parts of at most `batch` values (31 Oct 2026: 288 values in one answer ran past the output limit), each part's answer parsed
      const c = { fields: {}, problems: [] }, parts = [];
      let emptyReply = '';
      for (let k = 0; k < values.length; k += batch) parts.push(values.slice(k, k + batch));
      for (const [n, part] of parts.entries()) {
        if (parts.length > 1) on.start?.(x, `part ${n + 1} of ${parts.length}`);
        const reply = await call(cfg, checkPrompt({ template, study: x.label, values: part, text, arms: template.arms?.[x.id] || [] }));
        const got = parseCheck(reply, part);
        Object.assign(c.fields, got.fields); c.problems.push(...got.problems);
        // an answer that gives none of its part's values is kept for reading (lykos verify keeps it under .lykos/cache); the study fails only
        // when no part gave any, otherwise what the other parts gave is recorded and the rest stays unchecked
        if (!Object.keys(got.fields).length) { emptyReply = reply; c.problems.unshift(`part ${n + 1}: no value in the answer`); }
      }
      if (emptyReply && !Object.keys(c.fields).length) throw Object.assign(new Error(`no value in the answer (${c.problems[1] || 'empty'})`), { reply: emptyReply });
      if (emptyReply) on.kept?.(x, emptyReply);
      const missing = checkCheckQuotes(c, text), at = new Date().toISOString();
      if (!Object.keys(c.fields).length) throw new Error(c.problems[0] || 'no checks in the answer');
      for (const f of Object.values(c.fields)) Object.assign(f, { by: nameOf(cfg), at });
      const m = mergeCheck(prev, c.fields, all, text);
      await save(x, { by: nameOf(cfg), model: cfg.model || '', at, template: template.id, fields: m.fields, ...(c.problems.length ? { problems: c.problems.slice(0, 20) } : {}) });
      done++;
      const n = k => Object.values(c.fields).filter(f => f.verdict === k).length;
      on.done?.(x, `${n('agree')} agree, ${n('disagree')} disagree, ${n('not-in-paper')} not in the paper${missing ? `; ${missing} quotes not in the text` : ''}${m.challenged ? `; ${m.challenged} settled values challenged with a quote` : ''}${m.dropped ? `; ${m.dropped} disputes without a quote in the text dropped` : ''}`);
    } catch (e) { failed++; if (stopsRun(e)) halted ||= String(e?.message || e); on.fail?.(x, String(e?.message || e).slice(0, 160), e); }
  };
  const worker = async () => { while (i < studies.length && !stopped() && !halted) await one(studies[i++]); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(8, parallel, studies.length)) }, worker));
  return { done, failed, ...(halted ? { halted, left: studies.length - i } : {}) };
}

/** The studies whose values are not all checked as they stand (every one with `again`). */
export const toCheck = (s, studies, template, { again = false } = {}) =>
  studies.filter(x => { const v = valuesToCheck(s, template, x.id); if (!v.length) return false; const c = checkSummary(s, x.id, v); return again || c.unchecked + c.stale > 0; });
