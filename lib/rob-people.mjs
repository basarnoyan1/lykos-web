// Risk of bias by two people and the model (2 Nov 2026): the model's answers are kept as a reader of their own (`model` beside `a` and `b`
// in a record, lib/rob-review.mjs), never as reviewer A, so two people can assess independently and be compared with each other and with
// the model. Until the people agree on a domain (or resolve it), its final judgement stays the model's, so the review's figures and
// analyses keep the judgements they had while the people work.
//   s.robReview = { second: true, model: true, people: { a: 'Ada Lin Rowe', b: 'Ben Cole' }, records: { … { a, b, model, modelFrom } } }
// Kept apart from lib/rob-review.mjs, which the shell loads at start. Pure.
import { lib_rob_review$STUDY as STUDY, lib_rob_review$mirror as mirror, lib_rob_review$answersBy as answersBy, lib_rob_review$domainIds as domainIds, lib_rob_review$recordOf as recordOf, lib_rob_review$kappa as kappa } from "../boot.mjs";
const has = o => o && Object.keys(o).length > 0;

/**
 * Two people and the model: every record's reviewer A answers (the model's, in a review a model appraised first) are moved to the model's
 * own slot, so A and B are the two people and start blank; `people` names them. The final judgements stay the model's until the people
 * agree or resolve a domain. Answers already in the model's slot are kept; nothing is moved twice. Off (`on` false) keeps every answer and
 * leaves the model's as a reader only (the mode is off; reviewer A and B stay as they are).
 */
export function setModelReader(st, on, toolIds, { people = null, by = '', at = new Date().toISOString() } = {}) {
  st.robReview = { records: {}, ...(st.robReview || {}) };
  if (people) st.robReview.people = { a: String(people.a || '').trim(), b: String(people.b || '').trim() };
  if (!on) { st.robReview.model = false; for (const [paperId, byTool] of Object.entries(st.robReview.records)) for (const toolId of Object.keys(byTool)) mirror(st, paperId, toolId, toolIds); return st; }
  st.robReview.second = true; st.robReview.model = true;
  for (const [paperId, byTool] of Object.entries(st.robReview.records)) for (const [toolId, levels] of Object.entries(byTool || {})) {
    for (const lvl of Object.keys(levels || {})) {
      const r = { ...levels[lvl] };
      if (has(r.a) && !has(r.model)) { r.model = r.a; r.modelFrom = { from: 'reviewer A', by: by || 'model', at }; r.a = {}; r.resolved = {}; r.consensus = null; }
      st.robReview.records[paperId] = { ...st.robReview.records[paperId], [toolId]: { ...st.robReview.records[paperId][toolId], [lvl]: r } };
    }
    mirror(st, paperId, toolId, toolIds);
  }
  return st;
}

/** Whether a reader ('a', 'b' or 'model') has judged every domain of a level. */
export const readerDone = (s, paperId, tool, who, level = STUDY) => { const x = answersBy(s, paperId, tool.id, level, who); return domainIds(tool).every(d => x[d]); };

/**
 * Agreement of each person with the model, per domain, across studies at a level: { [domain]: { a: kappa(a, model), b: kappa(b, model) } }
 * (kappa's shape: n, po, pe, kappa), from the studies where both answered.
 */
export function modelAgreement(s, paperIds, tool, level = STUDY) {
  const out = {};
  for (const d of domainIds(tool)) {
    const pa = [], pb = [];
    for (const id of paperIds) {
      const r = recordOf(s, id, tool.id, level), m = r?.model?.[d];
      if (!m) continue;
      if (r?.a?.[d]) pa.push([r.a[d], m]);
      if (r?.b?.[d]) pb.push([r.b[d], m]);
    }
    out[d] = { a: kappa(pa), b: kappa(pb) };
  }
  return out;
}

