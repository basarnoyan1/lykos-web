// The stored study-governance records and what the shell reads of them on every load: the ethics record and its deadlines, the registration, the statistical
// analysis plan rows and the checklist choice, normalised; the Overview's ethics attention. store.mjs and lib/progress.mjs import these; the drafting
// (lib/governance.mjs), the registration forms (lib/registration.mjs) and the checklist catalogues (lib/checklists-extra.mjs) load with the pages that use
// them, and re-export what moved here.

const has = v => !!String(v ?? '').trim();
const trim = v => String(v ?? '').trim();
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : null;
const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d instanceof Date ? d.toISOString() : String(d ?? '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
export const DATE_KEYS = ['registeredAt', 'firstEnrolmentAt', 'primaryCompletionAt'];

/** An ISO day plus whole months, the day clamped to the month's end. */
export function addMonths(iso, months) {
  const d = day(iso); if (!d) return null;
  const [y, m, dd] = d.split('-').map(Number);
  const tm = m - 1 + months, ty = y + Math.floor(tm / 12), mm = ((tm % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, mm + 1, 0)).getUTCDate();
  return `${ty}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`;
}

// ---- ethics ---

/** An empty ethics record. Dates are ISO days. */
export function blankEthics() {
  return { committee: '', reference: '', approvedAt: '', expiresAt: '', amendments: [], annualReportDue: '', conditions: '' };
}
/** A stored record with every field present. */
export function normalizeEthics(r = {}) {
  const b = blankEthics(), x = r || {};
  return { ...b, ...x, amendments: (Array.isArray(x.amendments) ? x.amendments : []).map(a => ({ at: '', text: '', approvedAt: '', ...a })) };
}

/**
 * Upcoming and overdue items for the to-do list, soonest first:
 * `[{ kind: 'expiry'|'annual-report'|'amendment', due, text, overdue, hint? }]`.
 * Items further than `within` days away are left out. With no annual report
 * date recorded, the next anniversary of approval is offered as a hint to check.
 */
export function deadlines(record, today = new Date(), { within = 90 } = {}) {
  const r = normalizeEthics(record), now = day(today), out = [];
  const who = has(r.committee) ? ` (${trim(r.committee)})` : '';
  const push = (kind, due, text, extra = {}) => {
    if (!due) { out.push({ kind, due: null, text, overdue: false, ...extra }); return; }
    const d = daysBetween(now, due);
    if (d <= within) out.push({ kind, due, text, overdue: d < 0, ...extra });
  };
  if (day(r.expiresAt)) push('expiry', day(r.expiresAt), `Ethics approval expires${who}: renew or close the study`);
  if (day(r.annualReportDue)) push('annual-report', day(r.annualReportDue), `Annual progress report to the ethics committee${who}`);
  else if (day(r.approvedAt)) {
    let due = addMonths(r.approvedAt, 12);
    while (due && daysBetween(now, due) < 0 && (!day(r.expiresAt) || due < day(r.expiresAt))) due = addMonths(due, 12);
    if (due && (!day(r.expiresAt) || due <= day(r.expiresAt)))
      push('annual-report', due, `Annual progress report to the ethics committee${who}`, { hint: 'Anniversary of approval; check the committee’s own reporting rule.' });
  }
  r.amendments.forEach(a => { if (has(a.text) && !has(a.approvedAt)) push('amendment', null, `Amendment awaiting approval: ${trim(a.text)}${day(a.at) ? ` (submitted ${day(a.at)})` : ''}`); });
  return out.sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1);
}

// ---- registration, plan and checklist choice ---

/** The stored registration with every part present. Other keys (sponsor, countries…) are kept. */
export function normalizeRegistration(r) {
  const x = obj(r) || {};
  const values = Object.fromEntries(Object.entries(obj(x.values) || {}).filter(([, v]) => obj(v))
    .map(([form, v]) => [form, Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === 'string'))]));
  const dates = Object.fromEntries(DATE_KEYS.map(k => [k, String(obj(x.dates)?.[k] ?? x[k] ?? '')]));
  return { ...x, form: typeof x.form === 'string' ? x.form : '', values, dates };
}

/** The stored plan's rows, `[{ outcome, method }]`. */
export function sapRows(state) {
  return (Array.isArray(state?.sap?.analyses) ? state.sap.analyses : [])
    .filter(obj).map(a => ({ ...a, outcome: String(a.outcome ?? ''), method: String(a.method ?? '') }));
}

/** The stored choice with every part present; `abstract` and `protocol` say whether those checklists are reported too. */
export function normalizeChecklistChoice(c) {
  const x = obj(c) || {};
  const ids = v => [...new Set((Array.isArray(v) ? v : []).filter(id => typeof id === 'string'))];
  return { checklist: typeof x.checklist === 'string' ? x.checklist : '', extensions: ids(x.extensions), addons: ids(x.addons), abstract: !!x.abstract, protocol: !!x.protocol };
}

// ---- ethics attention ---

/**
 * Ethics deadlines within `within` days (and overdue ones) as Overview rows:
 * `[{ severity, view: 'protocol', go: 'protocol:ethics', text, due }]`. An
 * overdue item blocks; an amendment awaiting approval has no date and is a gap.
 */
export function ethicsAttention(state, today = new Date(), { within = 90 } = {}) {
  if (!obj(state?.ethics)) return [];
  return deadlines(state.ethics, today, { within }).map(d => ({
    severity: d.overdue ? 'block' : 'gap', view: 'protocol', go: 'protocol:ethics',
    text: d.due ? `${d.text} · ${d.overdue ? 'overdue since' : 'due'} ${d.due}` : d.text, due: d.due,
  }));
}

/** Brings the stored governance records forward in place; absent ones stay absent. */
export function normalizeGovernance(next) {
  if (next.registration != null) next.registration = normalizeRegistration(next.registration);
  if (next.ethics != null) next.ethics = normalizeEthics(obj(next.ethics) || {});
  if (next.sap != null) next.sap = { ...(obj(next.sap) || {}), analyses: sapRows(next) };
  if (next.spiritSchedule != null && !obj(next.spiritSchedule)) next.spiritSchedule = null;
  if (next.checklistChoice != null) next.checklistChoice = normalizeChecklistChoice(next.checklistChoice);
  return next;
}
