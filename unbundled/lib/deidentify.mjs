// De-identification of a dataset (amendment of 2026-09-29): a scan for
// columns that likely hold identifiers, and a recipe that derives a new
// dataset with them removed, pseudonymised, shifted or generalised.
//
// The scan reads column names and values against the eighteen identifier
// categories of the HIPAA Safe Harbor method (45 CFR 164.514(b)(2)), plus the
// Turkish national identity number (TC Kimlik No, by its two check digits) and
// the NHS number (modulus 11). A hit is a prompt to look, not a verdict, and
// a clean scan does not make a dataset de-identified: free text, rare values
// and combinations of quasi-identifiers are not assessed.
//
// deidentify() never changes its input. It returns the derived dataset, the
// key (pseudonyms and date shifts, which re-identify: store it apart from the
// data) and a report of what was done. Date shifting keeps intervals within a
// participant and is not part of Safe Harbor, which instead keeps only years;
// both are offered.
import { parseDate, formatDate } from './data-rules.mjs';
import { findIdentifiers } from './case-report.mjs';

export const SAFE_HARBOR = [
  ['names', 'Names'],
  ['geographic', 'Geographic subdivisions smaller than a state'],
  ['dates', 'Dates (other than year) related to an individual'],
  ['phone', 'Telephone numbers'],
  ['fax', 'Fax numbers'],
  ['email', 'Email addresses'],
  ['ssn', 'Social security numbers'],
  ['mrn', 'Medical record numbers'],
  ['health-plan', 'Health plan beneficiary numbers'],
  ['account', 'Account numbers'],
  ['licence', 'Certificate or licence numbers'],
  ['vehicle', 'Vehicle identifiers and serial numbers'],
  ['device', 'Device identifiers and serial numbers'],
  ['url', 'Web addresses (URLs)'],
  ['ip', 'IP addresses'],
  ['biometric', 'Biometric identifiers'],
  ['photo', 'Full-face photographs and comparable images'],
  ['unique', 'Any other unique identifying number, characteristic or code'],
];
export const EXTRA_CATEGORIES = [
  ['age-over-89', 'Ages over 89'],
  ['tc-kimlik', 'TC Kimlik No (Turkish national identity number)'],
  ['nhs', 'NHS number'],
];
const LABELS = Object.fromEntries([...SAFE_HARBOR, ...EXTRA_CATEGORIES]);
export const categoryLabel = id => LABELS[id] || id;

// ---- national numbers ----------------------------------------------------------------

/**
 * A TC Kimlik No: eleven digits, the first not zero; the tenth is
 * (7 × (d1 + d3 + d5 + d7 + d9) − (d2 + d4 + d6 + d8)) mod 10 and the
 * eleventh is the sum of the first ten mod 10.
 */
export function isTcKimlik(value) {
  const t = String(value ?? '').replace(/\s/g, '');
  if (!/^[1-9]\d{10}$/.test(t)) return false;
  const d = [...t].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8], even = d[1] + d[3] + d[5] + d[7];
  const tenth = ((odd * 7 - even) % 10 + 10) % 10;
  const eleventh = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d[9] === tenth && d[10] === eleventh;
}

/**
 * An NHS number: ten digits (spaces or hyphens allowed); the first nine
 * weighted 10 down to 2, the check digit 11 − (sum mod 11), 11 read as 0,
 * and a result of 10 never valid.
 */
export function isNhsNumber(value) {
  const t = String(value ?? '').replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(t)) return false;
  const d = [...t].map(Number);
  const sum = d.slice(0, 9).reduce((a, x, i) => a + x * (10 - i), 0);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) return false;
  return check === d[9];
}

// ---- the scan ---------------------------------------------------------------------------

// By column name (id or label). Word boundaries are underscores, spaces or edges.
const W = s => new RegExp(`(?:^|[\\s_\\-./])(?:${s})(?:$|[\\s_\\-./])`, 'i');
const NAME_PATTERNS = [
  ['names', W('name|names|first ?name|last ?name|surname|forename|given ?name|family ?name|full ?name|initials|ad|soyad|ad soyad|isim|patient ?name')],
  ['geographic', W('address|street|addr|city|town|village|county|district|zip|zipcode|zip ?code|post ?code|postcode|postal|postal ?code|ilce|ilçe|mahalle|adres|latitude|longitude|lat|lon|lng|geo|gps|coordinates')],
  ['dates', W('dob|birth|birth ?date|date ?of ?birth|birthday|dogum|doğum|admission|admit|discharge|death|died|visit ?date|date|dt|surgery ?date|procedure ?date|dod|doa|dodis|tarih')],
  ['phone', W('phone|telephone|tel|mobile|cell ?phone|gsm|telefon')],
  ['fax', W('fax')],
  ['email', W('email|e ?mail|mail|eposta|e-posta')],
  ['ssn', W('ssn|social ?security|social ?security ?number')],
  ['mrn', W('mrn|medical ?record|record ?number|hospital ?number|hospital ?no|patient ?number|patient ?no|patient ?id|protokol|protokol ?no|dosya ?no|file ?number|case ?number')],
  ['health-plan', W('insurance|insurer|health ?plan|policy|member ?id|beneficiary|medicaid|medicare|sgk')],
  ['account', W('account|iban|bank|acct|card ?number')],
  ['licence', W('licen[cs]e|certificate|passport|driver|registration ?number')],
  ['vehicle', W('vehicle|plate|licen[cs]e ?plate|vin|plaka')],
  ['device', W('device|serial|imei|udi|pacemaker ?id|implant ?id|mac ?address')],
  ['url', W('url|website|homepage|web ?address')],
  ['ip', W('ip|ip ?address|ipv4|ipv6')],
  ['biometric', W('fingerprint|biometric|retina|iris|voice ?print|voiceprint|dna ?profile')],
  ['photo', W('photo|photograph|picture|image|face|selfie|fotograf|fotoğraf')],
  ['tc-kimlik', W('tc|tckn|tc ?kimlik|tc ?kimlik ?no|kimlik|kimlik ?no|national ?id|national ?identity')],
  ['nhs', W('nhs|nhs ?number|nhs ?no|chi ?number')],
  ['age-over-89', W('age|yas|yaş')],
];
const VALUE_TESTS = [
  ['email', v => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(v)],
  ['url', v => /^(?:https?:\/\/|www\.)\S+$/i.test(v)],
  ['ip', v => /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(v) || (/^[0-9a-f:]+$/i.test(v) && (v.match(/:/g) || []).length >= 2 && /[0-9a-f]{1,4}:[0-9a-f]{0,4}:/i.test(v))],
  ['ssn', v => /^(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}$/.test(v)],
  ['tc-kimlik', v => isTcKimlik(v)],
  ['nhs', v => /^\d{3}[\s-]?\d{3}[\s-]?\d{4}$/.test(v) && isNhsNumber(v)],
  ['dates', v => { const t = parseDate(v); return t != null && !/^\d{4}$/.test(v); }],
  ['phone', v => findIdentifiers(v).some(h => h.kind === 'Phone number') && !isTcKimlik(v) && !isNhsNumber(v)],
  ['mrn', v => findIdentifiers(v).some(h => h.kind === 'Record number')],
  ['names', v => findIdentifiers(v).some(h => h.kind === 'Name')],
];

const text = v => String(v ?? '').trim();
const isAgeName = c => NAME_PATTERNS.find(([k]) => k === 'age-over-89')[1].test(` ${c.id} `) || NAME_PATTERNS.find(([k]) => k === 'age-over-89')[1].test(` ${c.label || ''} `);

/**
 * Columns that likely hold identifiers:
 * [{ column, label, categories: [{ id, label, basis: 'name' | 'values', share?, examples? }] }]
 * `share` is the fraction of filled cells that match; value hits need at
 * least `minShare` (default 0.5) of the filled cells, or any for a checksum-
 * validated national number. Columns with no hit are left out.
 */
export function scanDataset(dataset, { minShare = 0.5, sample = 500 } = {}) {
  const out = [];
  for (const c of dataset?.columns || []) {
    const cats = new Map();
    const add = (id, info) => { if (!cats.has(id)) cats.set(id, { id, label: categoryLabel(id), ...info }); };
    const names = [c.id, c.label].filter(Boolean).map(n => ` ${String(n).replace(/([a-z])([A-Z])/g, '$1_$2')} `);
    for (const [id, re] of NAME_PATTERNS) {
      if (id === 'age-over-89') continue;
      if (names.some(n => re.test(n))) add(id, { basis: 'name' });
    }
    const vals = (dataset.rows || []).slice(0, sample).map(r => text(r[c.id])).filter(Boolean);
    if (vals.length) {
      for (const [id, test] of VALUE_TESTS) {
        const hits = vals.filter(v => test(v));
        const share = hits.length / vals.length;
        const checksum = id === 'tc-kimlik' || id === 'nhs';
        if (hits.length && (share >= minShare || (checksum && hits.length >= Math.min(3, vals.length)))) {
          if (cats.has(id)) Object.assign(cats.get(id), { basis: 'name+values', share });
          else add(id, { basis: 'values', share, examples: hits.slice(0, 2) });
        }
      }
      // A date column that holds only years is not a Safe Harbor date.
      if (cats.get('dates')?.basis === 'name' && vals.every(v => /^\d{4}$/.test(v))) cats.delete('dates');
      if (isAgeName(c) && !/or older/i.test(c.label || '')) {
        const over = vals.filter(v => Number(v) > 89).length;
        if (over) add('age-over-89', { basis: 'name+values', share: over / vals.length });
      }
      // Other unique codes: every filled value distinct, digits in them, not measurements.
      const distinct = new Set(vals).size;
      if (!cats.size && vals.length >= 10 && distinct === vals.length && vals.every(v => /\d/.test(v) && !/^[-+]?\d*[.,]\d+$/.test(v)) && c.type !== 'date')
        add('unique', { basis: 'values', share: 1 });
    }
    if (cats.size) out.push({ column: c.id, label: c.label || c.id, categories: [...cats.values()] });
  }
  return out;
}

// ---- seeded randomness ------------------------------------------------------------------
function hash32(s) {
  let h = 2166136261 >>> 0;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  // final avalanche (murmur3 fmix)
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/**
 * The shift in days for one participant: a whole number in [−days, +days],
 * never 0, the same for the same seed and participant.
 */
export function shiftFor(seed, participant, days) {
  const n = Math.max(1, Math.floor(days));
  const r = mulberry(hash32(`${seed}\u0000shift\u0000${participant}`))();
  const k = Math.floor(r * 2 * n);            // 0 … 2n−1
  return k < n ? k - n : k - n + 1;           // −n … −1, 1 … n
}

// Three-digit ZIP prefixes whose population was 20,000 or fewer at the 2000
// census: Safe Harbor replaces them with 000.
export const RESTRICTED_ZIP3 = ['036', '059', '063', '102', '203', '556', '692', '790', '821', '823', '830', '831', '878', '879', '884', '890', '893'];

// ---- the recipe ---------------------------------------------------------------------------

/**
 * A recipe the scan suggests: drop names, contacts and numbers; pseudonymise
 * the participant column; shift dates; cap ages; truncate ZIP codes.
 */
export function suggestRecipe(dataset, scan = scanDataset(dataset), { participantColumn = null } = {}) {
  const has = (col, id) => scan.find(s => s.column === col)?.categories.some(c => c.id === id);
  const participant = participantColumn || dataset.rowKey || scan.find(s => s.categories.some(c => ['mrn', 'unique', 'tc-kimlik', 'nhs'].includes(c.id)))?.column || null;
  const drop = scan.filter(s => s.column !== participant && s.categories.some(c => !['dates', 'age-over-89', 'geographic'].includes(c.id))).map(s => s.column);
  const dates = scan.filter(s => has(s.column, 'dates') && !drop.includes(s.column)).map(s => s.column);
  const zips = scan.filter(s => has(s.column, 'geographic') && /zip|post/i.test(`${s.column} ${s.label}`)).map(s => s.column);
  const otherGeo = scan.filter(s => has(s.column, 'geographic') && !zips.includes(s.column) && !drop.includes(s.column)).map(s => s.column);
  const ages = scan.filter(s => has(s.column, 'age-over-89')).map(s => s.column);
  return {
    drop: [...drop, ...otherGeo],
    ...(participant ? { pseudonymise: { column: participant, prefix: 'P' } } : {}),
    ...(dates.length ? { dateShift: { columns: dates, days: 180 } } : {}),
    ...(ages.length ? { ageCap: 89, ageColumns: ages } : {}),
    ...(zips.length ? { truncateZip: 3, zipColumns: zips } : {}),
  };
}

const find = (cols, ref) => cols.find(c => c.id === ref) || cols.find(c => String(c.label || '').toLowerCase() === String(ref).toLowerCase());

/**
 * A de-identified copy of a dataset.
 *   recipe: { drop: [col], pseudonymise: { column, prefix = 'P' },
 *     dateShift: { columns, days, by? }, generaliseDates: 'year' | 'month',
 *     generaliseColumns?: [col], ageCap: 89, ageColumns?: [col],
 *     truncateZip: 3, zipColumns?: [col] }
 * Date shifts are per participant (`dateShift.by`, else the pseudonymised
 * column, else the dataset's row key; else per row), drawn from `seed`.
 * generaliseDates applies to the date columns not shifted (or to
 * `generaliseColumns`). Ages above the cap become cap + 1 (90 for 89) and the
 * column label says so. Returns { dataset, key, report }.
 */
export function deidentify(dataset, recipe = {}, seed = 1) {
  const cols = dataset.columns || [];
  const report = { dropped: [], pseudonymised: null, shifted: null, generalised: null, capped: null, truncated: null, notes: [] };
  const key = { datasetId: dataset.id, seed: String(seed), pseudonyms: {}, shifts: {} };
  const missingCols = [];
  const resolve = list => (list || []).map(r => { const c = find(cols, r); if (!c) missingCols.push(r); return c?.id; }).filter(Boolean);

  const drop = new Set(resolve(recipe.drop));
  const rows = (dataset.rows || []).map(r => ({ ...r }));
  const original = dataset.rows || [];

  // participant identity (on the original values) for per-participant shifts
  const pseudo = recipe.pseudonymise ? find(cols, recipe.pseudonymise.column || recipe.pseudonymise) : null;
  if (recipe.pseudonymise && !pseudo) missingCols.push(recipe.pseudonymise.column || recipe.pseudonymise);
  const byRef = recipe.dateShift?.by ? find(cols, recipe.dateShift.by) : null;
  const personCol = byRef?.id || pseudo?.id || (dataset.rowKey && find(cols, dataset.rowKey)?.id) || null;
  const person = i => personCol ? text(original[i][personCol]) || `row ${i + 1}` : `row ${i + 1}`;

  // date shifting
  const shiftCols = recipe.dateShift ? resolve(recipe.dateShift.columns).filter(c => !drop.has(c)) : [];
  if (recipe.dateShift && shiftCols.length) {
    const days = Math.max(1, Math.floor(Number(recipe.dateShift.days) || 1));
    let n = 0, unread = 0;
    rows.forEach((r, i) => {
      const p = person(i), d = key.shifts[p] ??= shiftFor(seed, p, days);
      for (const c of shiftCols) {
        const v = text(r[c]); if (!v) continue;
        const t = parseDate(v);
        if (t == null) { unread++; r[c] = ''; continue; }
        r[c] = formatDate(t + d * 86_400_000, { time: /\d:\d/.test(v) }); n++;
      }
    });
    report.shifted = { columns: shiftCols, cells: n, participants: Object.keys(key.shifts).length, range: [-days, days], by: personCol || 'row' };
    if (unread) report.notes.push(`${unread} cell(s) in shifted date columns did not read as dates and were cleared`);
    if (!personCol) report.notes.push('No participant column: dates are shifted per row, so intervals across a participant\u2019s rows are not kept');
  }

  // generalising dates
  if (recipe.generaliseDates) {
    const level = recipe.generaliseDates === 'month' ? 'month' : 'year';
    const targets = recipe.generaliseColumns ? resolve(recipe.generaliseColumns) : cols.filter(c => c.type === 'date' && !shiftCols.includes(c.id)).map(c => c.id);
    const gcols = targets.filter(c => !drop.has(c));
    let n = 0;
    for (const r of rows) for (const c of gcols) {
      const v = text(r[c]); if (!v) continue;
      const t = parseDate(v);
      if (t == null) { if (!/^\d{4}(-\d{2})?$/.test(v)) { r[c] = ''; } continue; }
      const f = formatDate(t, { time: false });
      r[c] = level === 'year' ? f.slice(0, 4) : f.slice(0, 7); n++;
    }
    report.generalised = { columns: gcols, level, cells: n };
    if (level === 'month') report.notes.push('Months are kept: Safe Harbor keeps years only');
  }

  // age capping
  let ageLabel = null;
  if (recipe.ageCap != null) {
    const cap = Number(recipe.ageCap);
    const acols = (recipe.ageColumns ? resolve(recipe.ageColumns) : cols.filter(isAgeName).map(c => c.id)).filter(c => !drop.has(c));
    let n = 0;
    for (const r of rows) for (const c of acols) {
      const v = Number(text(r[c]).replace(',', '.'));
      if (text(r[c]) !== '' && Number.isFinite(v) && v > cap) { r[c] = String(cap + 1); n++; }
    }
    report.capped = { columns: acols, cap, value: cap + 1, cells: n };
    ageLabel = { cols: new Set(acols), suffix: ` (${cap + 1} = ${cap + 1} or older)` };
  }

  // ZIP truncation
  if (recipe.truncateZip) {
    const keep = Math.max(1, Math.floor(recipe.truncateZip));
    const zcols = (recipe.zipColumns ? resolve(recipe.zipColumns) : cols.filter(c => /zip|post ?code|postal/i.test(`${c.id} ${c.label || ''}`)).map(c => c.id)).filter(c => !drop.has(c));
    let n = 0, restricted = 0;
    for (const r of rows) for (const c of zcols) {
      const v = text(r[c]); if (!v) continue;
      const digits = v.replace(/\D/g, '');
      let t = digits.slice(0, keep);
      if (keep === 3 && /^\d{5}(-?\d{4})?$/.test(v) && RESTRICTED_ZIP3.includes(t)) { t = '000'; restricted++; }
      r[c] = t; n++;
    }
    report.truncated = { columns: zcols, digits: keep, cells: n, restricted };
  }

  // pseudonyms, assigned in a seeded order so they do not follow row order
  if (pseudo && !drop.has(pseudo.id)) {
    const prefix = recipe.pseudonymise.prefix ?? 'P';
    const distinct = [...new Set(original.map(r => text(r[pseudo.id])).filter(Boolean))];
    const r = mulberry(hash32(`${seed}\u0000pseudonym`));
    for (let i = distinct.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [distinct[i], distinct[j]] = [distinct[j], distinct[i]]; }
    const width = Math.max(3, String(distinct.length).length);
    distinct.forEach((v, i) => { key.pseudonyms[v] = `${prefix}${String(i + 1).padStart(width, '0')}`; });
    for (const row of rows) { const v = text(row[pseudo.id]); if (v) row[pseudo.id] = key.pseudonyms[v]; }
    report.pseudonymised = { column: pseudo.id, values: distinct.length, prefix };
    // a pseudonym spelled like an original identifier would read as that participant
    const clash = distinct.filter(v => Object.hasOwn(key.pseudonyms, key.pseudonyms[v])).length;
    if (clash) report.notes.push(`${clash} pseudonyms are spelled like original identifiers; choose another prefix`);
  }

  // drops last, so nothing above reads a dropped column's output
  for (const row of rows) for (const c of drop) delete row[c];
  report.dropped = [...drop];
  if (missingCols.length) report.notes.push(`Not in the dataset: ${[...new Set(missingCols)].join(', ')}`);

  const columns = cols.filter(c => !drop.has(c.id)).map(c => ({
    ...c,
    ...(ageLabel?.cols.has(c.id) ? { label: `${c.label || c.id}${ageLabel.suffix}` } : {}),
    ...(c.type === 'date' && report.generalised?.columns.includes(c.id) ? { type: 'text' } : {}),
    ...(c.id === pseudo?.id ? { identifier: false } : {}),
  }));
  const at = new Date().toISOString();
  const out = {
    id: `${dataset.id}-deid`,
    name: `${dataset.name || 'Dataset'} (de-identified)`.slice(0, 80),
    columns,
    rows: rows.map(r => Object.fromEntries(columns.map(c => [c.id, r[c.id] ?? '']))),
    ...(dataset.rowKey && !drop.has(dataset.rowKey) ? { rowKey: dataset.rowKey } : {}),
    source: { derivedFrom: dataset.id, method: 'deidentify', recipe: JSON.parse(JSON.stringify(recipe)), at },
    at,
  };
  // what the scan still sees, the pseudonym column aside
  const handled = (col, cat) => col === pseudo?.id || (cat === 'dates' && (report.shifted?.columns.includes(col) || report.generalised?.columns.includes(col)))
    || (cat === 'geographic' && report.truncated?.columns.includes(col)) || (cat === 'age-over-89' && report.capped?.columns.includes(col));
  report.remaining = scanDataset(out).map(s => ({ ...s, categories: s.categories.filter(c => !handled(s.column, c.id)) })).filter(s => s.categories.length);
  if (report.shifted) report.notes.push('Shifted dates are still full dates: Safe Harbor would keep the year only; date shifting relies on the key staying separate');
  return { dataset: out, key, report };
}
