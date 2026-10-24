// The report of a batch extraction, and the list of its rules and exceptions for another reader.
//
// A batch ends with a record in `state.runs` (kind 'batch', written by lib/extract-batch.mjs): what was asked for and the counts,
// the rules that fired, and what was left to review. This module turns a record into what a screen shows and into the text a
// person, or another model, reads to check the sheet: the rules that were applied, then each exception with the value, the
// sentence of each rule it broke and the quote it rests on. Nothing here changes the project.
import { get } from '../store.mjs';
import { reportLine, rulesListing, exportMasterList, masterListSheets } from './extract-batch.mjs';
import { patientRuleList } from './patient-rules.mjs';
import { writeOutputs } from './project-folder.mjs';
import { plural } from './dates.mjs';

/** The batches of the project, newest first; `mode` ('cells' | 'patients') and `templateId` narrow them. */
export function batchRuns(state = get(), { mode = null, templateId = null } = {}) {
  return (state.runs || []).filter(r => r.kind === 'batch' && (!mode || r.mode === mode) && (mode !== 'cells' || !templateId || r.template_id === templateId));
}

const whenOf = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' '); };
const unitOf = rec => rec.mode === 'patients' ? 'patient rows' : 'cells';

/** One line for a record in a list of earlier runs. */
export function recordLine(rec) {
  const r = rec.report;
  if (!r) return rec.status === 'running' ? 'Running' : rec.status === 'error' ? `Failed${rec.error ? `: ${rec.error}` : ''}` : rec.status === 'interrupted' ? 'Interrupted' : '';
  return reportLine({ ...r, mode: rec.mode });
}

/**
 * The record as a report page: the counts as label/value pairs (tokens only when every call reported them), the rules that fired
 * with how often, and the exceptions, each marked open while its cell or row still waits for a person. `open` is how many.
 */
export function reportOf(rec, state = get()) {
  const r = rec.report || {};
  const rows = [['Studies read', r.papers ?? 0], [rec.mode === 'patients' ? 'Patient rows' : 'Cells', r.cells ?? 0], ['Clean', r.clean ?? 0]];
  if (r.escalated) rows.push(['Sent to the stronger model', r.escalated], ['Fixed there', r.fixed ?? 0]);
  rows.push(['Left to review', r.remaining ?? 0]);
  if (r.unproposed) rows.push(['Left empty', r.unproposed]);
  if (r.errors?.length) rows.push(['Studies that failed', r.errors.length]);
  if (r.carried) rows.push(['Proposals from an earlier run, checked', r.carried]);
  rows.push(['Stronger model', r.escalation || 'off']);
  if (r.tokens) rows.push(['Tokens', `${r.tokens.prompt.toLocaleString('en-US')} in, ${r.tokens.completion.toLocaleString('en-US')} out`]);
  if (r.stopped) rows.push(['Ended', 'Stopped before every study was read']);
  const exceptions = (r.exceptions || []).map(e => ({ ...e, open: isOpen(rec, e, state) }));
  return { id: rec.id, title: `${rec.mode === 'patients' ? 'Patient rows' : 'Table cells'}, ${whenOf(rec.startedAt)}`, mode: rec.mode, templateId: rec.template_id, model: rec.model, rows,
    rules: r.rules || [], exceptions, open: exceptions.filter(e => e.open).length, handled: (r.exceptionsTotal ?? exceptions.length) - exceptions.filter(e => e.open).length,
    truncated: (r.exceptionsTotal ?? 0) > exceptions.length, errors: r.errors || [] };
}

/** Does the exception still wait: a proposed patient row still there, a cell proposal still flagged, a required cell still empty. */
function isOpen(rec, e, state) {
  if (rec.mode === 'patients') return !!(state.ipdProposals || []).find(p => p.id === e.itemId);
  const key = `${e.paperId}:${e.itemId}`, p = state.proposals?.[key];
  if (p) return p.qa?.status === 'exception' || !p.qa;
  const v = state.values?.[key];
  return !(v && (v.availability === 'not_found' || String(v.reported_value ?? '').trim() !== ''));
}

// ---- the list for another reader ---------------------------------------------------------------

const quoteText = list => (list || []).filter(e => e?.quote).map(e => `${e.page ? `p. ${e.page}: ` : ''}"${String(e.quote).replace(/\s+/g, ' ').trim().slice(0, 300)}"`).join(' | ');
const wrap = (text, indent = '   ') => String(text).replace(/\s+/g, ' ').trim().replace(new RegExp(`(.{1,92})(\\s+|$)`, 'g'), (_, line) => `${indent}${line}\n`).replace(/\n$/, '');

/** The rules as lines: where they apply, what they say, whether the project checks them. */
function rulesLines(state, rec) {
  const lines = [];
  if (rec.mode === 'patients') {
    patientRuleList(state).forEach((r, i) => lines.push(`${i + 1}. ${r.label}${r.on ? '' : ' (switched off)'}\n${wrap(r.message ? `${r.message}. ${r.statement}` : r.statement)}\n   Applies to: ${r.columns}`));
    lines.push(`${lines.length + 1}. Numeric gate\n${wrap('A number must appear in its quote; a count cannot exceed its denominator.')}\n   Applies to: every numeric cell`);
    lines.push(`${lines.length + 1}. Evidence\n${wrap('Every filled cell needs a quote located in the report.')}\n   Applies to: every cell`);
  } else {
    const list = rulesListing(state, rec.template_id || 'default');
    list.forEach(([where, kind, statement, detail], i) => lines.push(`${i + 1}. ${where}: ${kind}\n${wrap(statement || kind)}${detail ? `\n   ${detail}` : ''}`));
    lines.push(`${lines.length + 1}. Evidence\n${wrap('Every proposed value needs a quote located in the paper.')}\n   Applies to: every cell`);
  }
  return lines;
}

/** What one exception is about, with its live value and quote while it still waits. */
function exceptionLines(state, rec, e, n) {
  const head = [];
  if (rec.mode === 'patients') {
    const p = (state.ipdProposals || []).find(x => x.id === e.itemId), c = p?.cells || {};
    head.push(`${n}. ${e.paper}${c.case_no ? `, case ${c.case_no}` : e.label ? `, ${e.label}` : ''}`);
    if (p) {
      const cell = (name, key) => c[key] ? `${name}: ${c[key]}${quoteText(p.evidence?.[key]) ? `  [${quoteText(p.evidence[key])}]` : ''}` : '';
      for (const line of [cell('Extent of resection', 'eor'), cell('Follow-up (months)', 'time'), cell('Event', 'event'), cell('Outcome', 'outcome'), cell('Adjuvant treatment', 'adjuvant'), cell('Imaging', 'imaging'), cell('Months to death', 'death')]) if (line) head.push(`   ${line}`);
    }
  } else {
    const p = state.proposals?.[`${e.paperId}:${e.itemId}`];
    head.push(`${n}. ${e.paper}, ${e.label || e.itemId}`);
    head.push(`   Value: ${e.value || (p ? String(p.value ?? '') : '') || '(none proposed)'}`);
    if (p && quoteText(p.evidence)) head.push(`   Quote: ${quoteText(p.evidence)}`);
  }
  head.push(`   Rules broken: ${e.reasons.map(x => x.message).join('; ') || 'none recorded'}`);
  head.push(`   Looked at by the stronger model: ${e.escalated ? 'yes, and still flagged' : 'no'}`);
  return head.join('\n');
}

/**
 * The rules applied and the exceptions found, as plain text for a person or another model to review the sheet against. The text depends
 * only on the project and the record, so an unchanged list is not written again.
 */
export function exceptionsText(state, rec) {
  const rep = reportOf(rec, state), open = rep.exceptions.filter(e => e.open);
  const out = [];
  out.push('LYKOS EXTRACTION: RULES AND EXCEPTIONS');
  out.push(`${state.project?.name ? `Project: ${state.project.name}\n` : ''}Batch: ${rep.title}${rec.model ? `\nModel: ${rec.model}` : ''}${rec.strong ? `\nStronger model: ${rec.strong}` : ''}`);
  out.push(`This lists the rules the extracted ${unitOf(rec)} were checked against and the ${plural(open.length, 'item')} that broke one and still wait for a person. Check each against the quote it cites; none is accepted yet.`);
  out.push(`SUMMARY\n${rep.rows.map(([k, v]) => `${k}: ${v}`).join('\n')}`);
  if (rep.rules.length) out.push(`RULES THAT FIRED MOST\n${rep.rules.map(r => `${r.label}: ${r.flagged} flagged, ${r.left} left`).join('\n')}`);
  const rules = rulesLines(state, rec);
  out.push(`RULES APPLIED (${rules.length})\n\n${rules.join('\n\n')}`);
  out.push(`EXCEPTIONS (${open.length})${rep.handled > 0 ? `\n${plural(rep.handled, 'earlier exception')} accepted, rejected or fixed since, not listed.` : ''}${rep.truncated ? `\nThe record keeps the first ${rep.exceptions.length}.` : ''}\n\n${open.map((e, i) => exceptionLines(state, rec, e, i + 1)).join('\n\n') || 'None.'}`);
  return `${out.join('\n\n')}\n`;
}

const stemOf = rec => rec.mode === 'patients' ? 'Patient exceptions for review' : 'Extraction exceptions for review';

/** Writes the list into the project folder by the folder's version rule (an unchanged list is not written again). */
export function exportExceptions(folder, state, rec, { typeId = 'other', writeOut = writeOutputs } = {}) {
  return writeOut(folder, [{ key: 'data', stem: stemOf(rec), ext: 'txt', data: exceptionsText(state, rec), label: stemOf(rec), kind: 'extraction' }], { typeId });
}
export const exceptionsFileName = rec => `${stemOf(rec)}.txt`;

export { exportMasterList, masterListSheets };
