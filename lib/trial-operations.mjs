// Local trial records and the contract for a future protected trial service.
// Names in a local audit record are attribution, never authenticated roles.
const text = v => String(v ?? '').trim();
const date = v => /^\d{4}-\d{2}-\d{2}$/.test(text(v)) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v ? text(v) : null;
const clone = v => structuredClone(v);
const stamp = (by, at) => { if (!text(by)) throw new Error('Record the responsible researcher'); return { by: text(by), at: at || new Date().toISOString() }; };
export function trialState(s) {
  const t = s?.trialOperations || {};
  const rows = k => Array.isArray(t[k]) ? t[k].filter(x => x && typeof x === 'object' && !Array.isArray(x)) : [];
  return { sites: rows('sites'), participants: rows('participants'), schedule: rows('schedule').filter(v => [v.days, v.before, v.after].every(x => Number.isFinite(Number(x)) && Number(x) >= 0)), visits: rows('visits'), queries: rows('queries'), adjudications: rows('adjudications'), log: rows('log'), connection: t.connection && typeof t.connection === 'object' ? t.connection : null };
}
function change(s, action, id, record, by, at) {
  const t = clone(trialState(s)), audit = stamp(by, at);
  const list = t[action], old = list.find(x => x.id === id) || null;
  const row = { ...record, id, ...audit };
  const i = list.findIndex(x => x.id === id); if (i < 0) list.push(row); else list[i] = row;
  t.log.push({ seq: t.log.length + 1, collection: action, id, before: old, after: clone(row), ...audit });
  s.trialOperations = t; return row;
}
export function saveSite(s, row, by, at) {
  const id = text(row.id); if (!id || !text(row.name)) throw new Error('A site code and name are required');
  if (!date(row.approved)) throw new Error('Record the site approval date');
  return change(s, 'sites', id, { name: text(row.name), approved: row.approved, active: row.active !== false }, by, at);
}
export function saveTrialParticipant(s, row, by, at) {
  const id = text(row.id); if (!id) throw new Error('A participant code is required');
  if (!trialState(s).sites.some(x => x.id === row.siteId)) throw new Error('Choose a recorded site');
  if (!['pending', 'eligible', 'ineligible'].includes(row.eligibility)) throw new Error('Record eligibility');
  if (!date(row.screened)) throw new Error('Record the screening date');
  if (row.eligibility === 'ineligible' && !text(row.reason)) throw new Error('Record the reason for ineligibility');
  if (row.consented && (!date(row.consented) || !text(row.consentVersion))) throw new Error('Consent requires a date and document version');
  if (row.consented && row.consented < row.screened) throw new Error('Consent cannot precede screening');
  if (row.withdrawn && (!date(row.withdrawn) || !text(row.withdrawalReason))) throw new Error('Withdrawal requires a date and reason');
  if (row.withdrawn && row.consented && row.withdrawn < row.consented) throw new Error('Withdrawal cannot precede consent');
  return change(s, 'participants', id, { siteId: row.siteId, screened: row.screened, eligibility: row.eligibility, reason: text(row.reason), consented: row.consented || '', consentVersion: text(row.consentVersion), withdrawn: row.withdrawn || '', withdrawalReason: text(row.withdrawalReason), protocolDeviation: text(row.protocolDeviation) }, by, at);
}
export function enrolmentIssues(s, id, when = new Date().toISOString()) {
  const t = trialState(s), p = t.participants.find(x => x.id === id), on = text(when).slice(0, 10), problems = [];
  if (!date(on)) return ['Invalid allocation date'];
  if (!p) return ['Record screening, site, eligibility and consent in Trial operations'];
  const site = t.sites.find(x => x.id === p.siteId);
  if (!site?.active || !date(site.approved) || site.approved > on) problems.push('The site is not approved and active on the allocation date');
  if (p.eligibility !== 'eligible') problems.push('Eligibility is not confirmed');
  if (!date(p.screened) || p.screened > on) problems.push('Screening is not recorded before allocation');
  if (!date(p.consented) || p.consented > on || !p.consentVersion) problems.push('Valid versioned consent is not recorded before allocation');
  if (p.withdrawn && p.withdrawn <= on) problems.push('Consent has been withdrawn');
  return problems;
}
export function saveVisitDefinition(s, row, by, at) {
  const id = text(row.id), days = Number(row.days), before = Number(row.before), after = Number(row.after);
  if (!id || !text(row.name) || ![days, before, after].every(Number.isFinite) || before < 0 || after < 0 || days < 0) throw new Error('Specify the visit and non-negative day offsets');
  return change(s, 'schedule', id, { name: text(row.name), days, before, after, assessments: text(row.assessments) }, by, at);
}
export function saveVisit(s, row, by, at) {
  const t = trialState(s); if (!t.participants.some(p => p.id === row.participantId) || !t.schedule.some(v => v.id === row.visitId)) throw new Error('Choose a participant and scheduled visit');
  if (!['completed', 'missed', 'pending'].includes(row.status)) throw new Error('Choose a visit status');
  if (row.status === 'completed' && !date(row.completed)) throw new Error('Record the completion date');
  if (row.status === 'missed' && !text(row.reason)) throw new Error('A missed visit needs a reason');
  return change(s, 'visits', `${row.participantId}:${row.visitId}`, { participantId: row.participantId, visitId: row.visitId, status: row.status, completed: row.completed || '', reason: text(row.reason), assessments: text(row.assessments) }, by, at);
}
const allocated = s => (s.allocations || []).flatMap(a => (a.entries || []).filter(e => e.participantId).map(e => ({ ...e, allocationId: a.id })));
export function visitStatus(s, today = new Date().toISOString().slice(0, 10)) {
  const t = trialState(s), ms = v => Date.parse(`${v}T00:00:00Z`), plus = (d, n) => new Date(ms(d) + n * 86400000).toISOString().slice(0, 10), out = [];
  for (const p of t.participants) {
    const assignment = allocated(s).find(e => e.participantId === p.id), anchor = assignment?.at?.slice(0, 10);
    if (!date(anchor)) continue;
    for (const v of t.schedule) {
      const row = t.visits.find(x => x.id === `${p.id}:${v.id}`), due = plus(anchor, v.days), start = plus(due, -v.before), end = plus(due, v.after);
    const status = row?.status === 'completed' ? (!date(row.completed) ? 'invalid completion date' : row.completed < start || row.completed > end ? 'outside window' : 'completed') : row?.status === 'missed' ? 'missed' : p.withdrawn && p.withdrawn <= today ? 'withdrawn' : today > end ? 'overdue' : today >= start ? 'due' : 'scheduled';
      out.push({ participantId: p.id, visitId: v.id, name: v.name, due, start, end, status, completed: row?.completed || '', assessments: v.assessments, reason: row?.reason || '' });
    }
  }
  return out;
}
export function saveQuery(s, row, by, at) {
  if (!text(row.id) || !text(row.participantId) || !text(row.question)) throw new Error('A query requires its code, participant and question');
  if (!['open', 'answered', 'closed'].includes(row.status)) throw new Error('Choose a query status');
  if (!trialState(s).participants.some(p => p.id === row.participantId)) throw new Error('Choose a recorded participant');
  const prior = trialState(s).queries.find(x => x.id === row.id);
  if (row.status !== 'open' && !text(row.answer)) throw new Error('Answer the query before resolving it');
  if (row.status === 'closed' && (!prior || !['answered', 'closed'].includes(prior.status))) throw new Error('Review an answered query before closing it');
  return change(s, 'queries', text(row.id), { participantId: text(row.participantId), question: text(row.question), status: row.status, answer: text(row.answer), datasetId: text(row.datasetId), rowId: text(row.rowId), columnId: text(row.columnId) }, by, at);
}
export function maskedAdjudicationPacket(s, participantId) {
  const t = trialState(s), p = t.participants.find(x => x.id === participantId);
  if (!p) throw new Error('Choose a recorded participant');
  // Deliberate allowlist: never copy assignment, arm, intervention or free text.
  return { participantId: p.id, siteId: p.siteId, visits: t.visits.filter(x => x.participantId === p.id).map(x => ({ visitId: x.visitId, completed: x.completed, status: x.status })) };
}
export function saveAdjudication(s, row, by, at) {
  maskedAdjudicationPacket(s, row.participantId);
  if (!text(row.outcome) || !text(row.decision) || !text(row.evidence)) throw new Error('Record the outcome, decision and source reference');
  return change(s, 'adjudications', `${row.participantId}:${text(row.outcome)}:${text(by)}`, { participantId: row.participantId, outcome: text(row.outcome), decision: text(row.decision), evidence: text(row.evidence) }, by, at);
}
export function trialPopulation(s, kind = 'itt') {
  if (!['itt', 'per-protocol', 'as-treated'].includes(kind)) throw new Error('Unknown analysis population');
  const t = trialState(s), out = [], seen = new Set();
  for (const e of allocated(s)) {
    if (seen.has(e.participantId)) throw new Error(`Duplicate allocation for ${e.participantId}`); seen.add(e.participantId);
    const p = t.participants.find(x => x.id === e.participantId), excluded = kind === 'per-protocol' && Boolean(p?.protocolDeviation);
    // Withdrawal/loss to follow-up never silently remove a person from ITT.
    out.push({ participantId: e.participantId, included: !excluded, reason: excluded ? p.protocolDeviation : '', allocationId: e.allocationId, assignment: e.arm || e.code || '', population: kind });
  }
  if (kind === 'as-treated') throw new Error('Record actual treatment in a dataset and define its mapping; allocation is not actual treatment');
  return out;
}
export const SERVICE_REQUIREMENTS = ['authenticatedRoles', 'concealedAllocation', 'appendOnlyAudit', 'maskedAdjudication', 'sitePermissions'];
export function serviceEndpoint(value) {
  const u = new URL(text(value)); if (u.username || u.password || u.search || u.hash) throw new Error('Use a service URL without credentials, query or fragment');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw new Error('Use HTTPS for a remote trial service');
  return u.href.replace(/\/$/, '');
}
export function serviceCapabilities(record) {
  const missing = SERVICE_REQUIREMENTS.filter(k => record?.capabilities?.[k] !== true);
  return { ok: record?.protocol === 'lykos-trial-v1' && !missing.length, missing, protocol: record?.protocol || '' };
}
export function trialReadiness(s) {
  const t = trialState(s);
  return { local: true, connected: false, configured: Boolean(t.connection?.endpoint), issues: ['A protected trial service has not been connected', ...t.queries.filter(x => x.status !== 'closed').map(x => `Unresolved query ${x.id}`)] };
}
export function trialExport(s) { return { format: 'lykos-trial-operations-v1', ...clone(trialState(s)), visitsDue: visitStatus(s), population: trialPopulation(s), readiness: trialReadiness(s) }; }
