// Screening's Decisions and Log exports (from views/screening.mjs, 2026-10-25), loaded on use; lib/project-exports.mjs makes them for a shell.
import { lib_screen$decisions as decisions, lib_screen$isDual as isDual } from "../boot.mjs";
import { lib_screen_labels$labelNames as labelNames } from "../boot.mjs";

/** The records by id, whose labels show (the reviewer's under blind dual screening), and the decisions the reviewer sees. */
export function logModel(s, by) {
  const byId = new Map((s.papers || []).map(p => [p.id, p]));
  return { byId, scope: isDual(s) ? by : '', log: decisions(s, { by }).filter(d => byId.has(d.id)) };
}
const csvQ = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
/** Every current decision with its labels (plan E1), note and time on record (E8). */
export function decisionsCsv(s, by = '') {
  const { byId, scope, log } = logModel(s, by);
  const head = ['Label', 'Title', 'Year', 'DOI', 'PMID', 'Stage', 'Decision', 'Reason', 'Note', 'Labels', 'By', 'When', 'Seconds on record', 'Resolved', 'Resolution took', 'Resolution reason'];
  return [head.map(csvQ).join(','), ...log.map(d => { const p = byId.get(d.id);
    return [p.label, p.title, p.year, p.doi, p.pmid, d.stage === 'ft' ? 'Full text' : 'Title/abstract', d.decision, d.reason, d.note, labelNames(s, d.id, scope).join('; '), d.by, d.at,
      d.ms ? (d.ms / 1000).toFixed(1) : '', d.resolved ? 'yes' : '', d.picked || '', d.why || ''].map(csvQ).join(','); })].join('\n');
}
/**
 * The screening log as it was written, one row per entry: decisions, undos,
 * agreements, resolutions and reopenings, labels, assignments. Under blind
 * dual screening only the reviewer's own entries and shared ones.
 */
export function logCsv(s, by = '') {
  const { byId, scope } = logModel(s, by);
  const head = ['When', 'Action', 'Stage', 'Label', 'Title', 'Decision', 'Prior', 'Reason', 'Note', 'By', 'Seconds on record', 'Detail'];
  // a protocol scenario's entries (lib/scenarios.mjs, `scenario`) are its own, not the main protocol's log
  const rows = (s.screeningLog || []).filter(e => !e.scenario).filter(e => !scope || !e.by || e.by === scope || e.action === 'resolve' || e.action === 'reopen' || String(e.by).includes('+'));
  return [head.map(csvQ).join(','), ...rows.map(e => { const p = byId.get(e.id) || {};
    return [e.at, e.action, e.stage === 'ft' ? 'Full text' : e.stage === 'ta' ? 'Title/abstract' : '', p.label || '', p.title || '', e.decision, e.prior, e.reason, e.note, e.by, e.ms ? (e.ms / 1000).toFixed(1) : '',
      [e.label && `label ${e.label}`, e.picked && `took ${e.picked}`, e.settled && `settled ${e.settled}`, e.why, e.batch && `batch ${e.batch}`, e.reviewers && `reviewers ${e.reviewers}`, e.from && `${e.from} → ${e.to}`, e.count != null && `${e.count} records`, e.via].filter(Boolean).join('; ')].map(csvQ).join(','); })].join('\n');
}
