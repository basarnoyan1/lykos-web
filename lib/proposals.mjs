// Proposals: what a model (or an import) says a cell should hold, kept apart
// from accepted values. A proposal reaches the table, the exports and the
// analysis only through accept() here (plan G4, §6).
import { get, update } from '../store.mjs';
import { setAnchoredValue, cellNumber, isLocked } from './fields.mjs';
import { columnsOf } from './templates.mjs';
import { splitCellId } from './arms.mjs';
import { recordOutcome } from './ai-outcomes.mjs';

export const key = (paperId, columnId) => `${paperId}:${columnId}`;
export const isUnsupported = p => !!p && p.availability === 'present' && !(p.evidence || []).length;

export function propose(paperId, p) {
  const rec = { ...p, paper_id: paperId, at: new Date().toISOString() };
  update(s => { s.proposals = s.proposals || {}; s.proposals[key(paperId, p.column_id)] = rec; return s; });
  return rec;
}
export const proposalFor = (paperId, columnId) => get().proposals?.[key(paperId, columnId)];

const templateOf = columnId => columnId.includes('.') ? columnId.split('.')[0] : 'default';
// The number a proposed value states: the whole value when it is a number
// ("1,234", "0,72", "−3.2"), else the only number in its text, read by the
// same rules as a typed cell (fields.cellNumber). Reading "1,234" as 1.234
// rounded a count of 1,234 to 1; a Unicode minus lost its sign.
export function numberIn(v, type = 'number') {
  const whole = cellNumber(v, type);
  if (String(v ?? '').trim() !== '' && Number.isFinite(whole)) return whole;
  const text = String(v ?? '').replace(/\u2212/g, '-');
  if (/[<>≤≥±~≈]|\b(?:less|more|at least|at most|approximately|range|between)\b/i.test(text)) return NaN;
  const numbers = [...text.matchAll(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:[.,]\d+)?/g)];
  return numbers.length === 1 ? cellNumber(numbers[0][0], type) : NaN;
}

export function accept(paperId, columnId, { editedValue = null } = {}) {
  const p = proposalFor(paperId, columnId); if (!p) return;
  if (isLocked(get(), key(paperId, columnId))) return;   // a locked value changes only by amendment (plan G4)
  const col = columnsOf(templateOf(columnId)).find(c => c.id === splitCellId(columnId).columnId);   // an arm's cell is its column's
  const value = editedValue != null ? String(editedValue).trim() : p.value;
  const num = col && (col.type === 'number' || col.type === 'integer') ? numberIn(value, col.type) : NaN;
  if (col && ['number','integer'].includes(col.type) && p.availability === 'present' && !Number.isFinite(num))
    throw new Error('This value is not an unambiguous scalar. Review the range or multiple estimates and enter the intended value explicitly.');
  const normalized = Number.isFinite(num) ? (col.type === 'integer' ? Math.round(num) : num) : value;
  const origin = editedValue != null ? 'inferred' : (p.origin === 'imported' ? 'reported' : 'inferred');
  const extractor = `${p.origin === 'imported' ? 'import:xlsx' : `model:${p.model || 'unknown'}`}${editedValue != null ? ' (edited)' : ''}`;
  setAnchoredValue(paperId, columnId, { reported_value: value, normalized_value: normalized, origin, extractor,
    evidence: p.evidence || [], rationale: p.rationale || '', availability: p.availability,
    proposed_by: p.model || p.run_id ? { model: p.model || null, run_id: p.run_id || null } : null });
  update(s => { delete s.proposals[key(paperId, columnId)]; return s; });
  // A proposal a model made (not an import) counts as accepted, or as edited when the person changed it.
  if (p.origin !== 'imported' && (p.model || p.origin === 'model' || p.origin === 'chat'))
    recordOutcome({ kind: `cell.${p.mode || 'fill'}`, outcome: editedValue != null && String(editedValue).trim() !== String(p.value).trim() ? 'edited' : 'accepted', model: p.model || '', prompt: p.prompt || '', paper: paperId });
}

export function reject(paperId, columnId, reason = '') {
  const p = proposalFor(paperId, columnId); if (!p) return;
  update(s => {
    delete s.proposals[key(paperId, columnId)];
    s.rejections = [...(s.rejections || []), { key: key(paperId, columnId), proposal: p, reason: String(reason).slice(0, 300), at: new Date().toISOString() }].slice(-500);
    return s;
  });
  if (p.origin !== 'imported' && (p.model || p.origin === 'model' || p.origin === 'chat'))
    recordOutcome({ kind: `cell.${p.mode || 'fill'}`, outcome: 'discarded', model: p.model || '', prompt: p.prompt || '', paper: paperId });
}

export function notReported(paperId, columnId) {
  if (isLocked(get(), key(paperId, columnId))) return;
  setAnchoredValue(paperId, columnId, { reported_value: 'NR', normalized_value: null, origin: 'reported', extractor: 'manual', evidence: [], availability: 'not_found' });
  update(s => { if (s.proposals) delete s.proposals[key(paperId, columnId)]; return s; });
}

export function pending(templateId) {
  const out = [];
  for (const [k, p] of Object.entries(get().proposals || {})) {
    if (!k.includes(':')) continue;   // a screening stage's proposals ('ta', 'ft'), not a cell
    const [paperId, columnId] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    if (templateOf(columnId) === templateId) out.push({ paperId, columnId, proposal: p });
  }
  return out;
}

/**
 * The studies with a proposal waiting in a table, and those with an imported
 * one (Verify), counting a study arm's own cells ("column@arm2"): checking the
 * plain column keys missed a proposal made for one arm.
 */
export function pendingStudies(templateId) {
  const list = pending(templateId);
  return { all: new Set(list.map(x => x.paperId)), imported: new Set(list.filter(x => x.proposal?.origin === 'imported').map(x => x.paperId)), list };
}

/** The next cell with a proposal, in table order, wrapping around. */
export function nextPending(templateId, after, order) {
  const set = new Set(pending(templateId).map(x => key(x.paperId, x.columnId)));
  if (!set.size) return null;
  const start = after ? order.findIndex(c => c.paperId === after.paperId && c.columnId === after.columnId) : -1;
  for (let i = 1; i <= order.length; i++) {
    const c = order[(start + i) % order.length];
    if (set.has(key(c.paperId, c.columnId))) return c;
  }
  return null;
}
