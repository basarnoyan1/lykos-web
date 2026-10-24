// The evidence features' project state, brought to the current shape when a
// project is opened (called from normalizeProject in store.mjs). Pure.
//   robReview        — risk of bias per outcome, two reviewers (lib/rob-review.mjs)
//   multiArm         — studies with several treated arms (lib/multi-arm.mjs)
//   doubleExtraction — two extractors' entries (lib/double-extraction.mjs)
//   extractionLog    — locks and amendments of accepted values (lib/fields.mjs)
import { allTools } from '../schema.mjs';
import { migrateAssessments } from './rob-review.mjs';

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

export function normalizeEvidence(next) {
  // the project's own instruments count as instruments: their answers are not RoB 2's flat keys
  migrateAssessments(next, allTools(next).map(t => t.id));
  next.multiArm = obj(next.multiArm) || {};
  for (const [id, m] of Object.entries(next.multiArm)) if (!obj(m) || !Array.isArray(m.arms)) delete next.multiArm[id];
  if (next.doubleExtraction != null) {
    const d = obj(next.doubleExtraction) || {};
    next.doubleExtraction = { ...d, on: Boolean(d.on), entries: obj(d.entries) || {} };
  }
  if (next.extractionLog != null && !Array.isArray(next.extractionLog)) next.extractionLog = [];
  return next;
}
