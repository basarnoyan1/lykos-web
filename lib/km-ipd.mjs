// Reconstructed patients in the patient table (plan §4.8a).
//
// The rows a Guyot reconstruction returns are not observations. They enter the
// patient table as ordinary rows the survival analysis reads, but each carries
// `reconstructed` (the record it came from), the Origin column says so in
// words, and the record keeps the method, the calibration, the digitised
// points and the numbers at risk, so the table can be checked and redone.
// Reconstructed rows are not individual participant data: the PRISMA-IPD
// counts leave them out (lib/prisma-ipd.mjs).

export const METHOD = 'Guyot 2012';
export const ORIGIN = 'Reconstructed';

/** Months per unit of the time axis: the survival analysis reads months. */
export const TIME_UNITS = { months: 1, days: 12 / 365.25, weeks: 12 / 52.1775, years: 12 };
export const UNIT_NAMES = Object.keys(TIME_UNITS);

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const three = v => Math.round(v * 1000) / 1000;

const DEFAULTS = [
  { id: 'label', name: 'Patient', type: 'text' },
  { id: 'strategy', name: 'Strategy', type: 'category', levels: [], role: 'group' },
  { id: 'time', name: 'Follow-up (months)', type: 'number', role: 'time' },
  { id: 'event', name: 'Progression', type: 'boolean', role: 'event' },
];

/**
 * Add the arms of one reconstruction to the patient table.
 * arms: [{ name, rows: [{time, event}], ... }], each with what produced it
 * (colour, digitised points, numbers at risk, total events, warnings).
 * source: { paper, page, hash, region } where the figure is. Returns the
 * record. `state` is the project (call inside update()).
 */
export function applyReconstruction(state, { studyId = null, arms, unit = 'months', source = {}, calibration = null, image = null, now = new Date().toISOString() }) {
  const factor = TIME_UNITS[unit];
  if (!factor) throw new Error(`Unknown time unit "${unit}"`);
  if (!arms?.length || arms.some(a => !a.rows?.length)) throw new Error('Nothing to add');
  if (new Set(arms.map(a => a.name.trim())).size !== arms.length) throw new Error('The arms need different names');

  // columns: keep what the project has; the analysis needs a group, a time and an event
  const cols = [...(state.ipdColumns?.length ? state.ipdColumns : DEFAULTS.map(c => ({ ...c, levels: c.levels && [...c.levels] })))];
  for (const need of DEFAULTS) {
    if (!cols.some(c => c.role === need.role) && need.role && !cols.some(c => c.id === need.id))
      cols.push({ ...need, levels: need.levels && [...need.levels] });
  }
  const role = r => cols.find(c => c.role === r);
  const group = role('group'), time = role('time'), event = role('event'), label = cols.find(c => c.id === 'label');
  if (!group || !time || !event) throw new Error('The patient table has no group, time or event column');
  let origin = cols.find(c => c.id === 'origin');
  if (!origin) { origin = { id: 'origin', name: 'Origin', type: 'category', levels: [ORIGIN] }; cols.push(origin); }
  else if (origin.levels && !origin.levels.includes(ORIGIN)) origin.levels = [...origin.levels, ORIGIN];
  if (group.type === 'category') {
    const levels = new Set(group.levels || []);
    for (const a of arms) levels.add(a.name.trim());
    group.levels = [...levels];
  }
  state.ipdColumns = cols;

  const id = `rec-${stamp()}`;
  const people = [];
  arms.forEach((arm, ai) => {
    arm.rows.forEach((r, i) => {
      const p = {
        id: `ipd-${id}-${ai}-${i}`, study_id: studyId,
        [group.id]: arm.name.trim(),
        [time.id]: String(three(r.time * factor)),
        [event.id]: r.event ? '1' : '0',
        [origin.id]: ORIGIN, reconstructed: id, updatedAt: now,
      };
      if (label) p[label.id] = `${arm.name.trim()} ${String(i + 1).padStart(3, '0')}`;
      people.push(p);
    });
  });
  state.participants = [...(state.participants || []), ...people];
  state.project = { ...(state.project || {}), patientData: true };

  const record = {
    id, at: now, method: METHOD, study_id: studyId, unit, toMonths: factor,
    source, calibration, image,
    arms: arms.map(a => ({
      name: a.name.trim(), colour: a.colour || null, n: a.rows.length,
      events: a.rows.filter(r => r.event).length, censored: a.rows.filter(r => !r.event).length,
      totalEvents: a.totalEvents ?? null, risk: a.risk || [], points: a.points || [], warnings: a.warnings || [],
    })),
  };
  state.reconstructions = [...(state.reconstructions || []), record];
  return record;
}

/** Take a reconstruction out again: its patients and its record. */
export function removeReconstruction(state, id) {
  const before = (state.participants || []).length;
  state.participants = (state.participants || []).filter(p => p.reconstructed !== id);
  state.reconstructions = (state.reconstructions || []).filter(r => r.id !== id);
  return before - state.participants.length;
}
