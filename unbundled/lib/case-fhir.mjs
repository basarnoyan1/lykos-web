// A case as an HL7 FHIR R4 Bundle (type collection), and a Bundle read into a case (plan §1.1, amended 2026-10-20).
//
// The patient is a Patient with a gender and nothing that identifies (the age is an extension, the resource is tagged ANONY); history is
// Condition, Procedure, FamilyMemberHistory, MedicationStatement, AllergyIntolerance or Observation (social history) by its category; imaging
// is an ImagingStudy (DICOM modality code, body site) with its findings in a DiagnosticReport; investigations and outcome measures are
// Observations (laboratory, survey) with a quantity where the value is a number and its unit; treatments are MedicationStatement or
// Procedure; consent is a Consent; the free timeline episodes are Basic resources. Times that are not calendar dates ("Day 3") cannot be a FHIR
// dateTime: they travel in the extension `urn:lykos:when`, which is read back before any date.
//
// Every resource written here carries the tag `urn:lykos:case-list` with the list it came from, so a bundle written by this app reads back
// into the same rows. A bundle from elsewhere is read by resource type: Condition, Procedure, MedicationStatement and the like into history or
// treatments, laboratory Observations into investigations, ImagingStudy and radiology DiagnosticReports into imaging. Nothing is fetched,
// and a resource of any other type is counted as skipped, not guessed at.
import { recordOf, quantityOf, MODALITIES, LISTS } from './case-record.mjs';
import { findLab, rangeFor, intervalText } from './lab-reference.mjs';

const LIST_TAG = 'urn:lykos:case-list', CAT_TAG = 'urn:lykos:history-category', WHEN = 'urn:lykos:when', AGE = 'urn:lykos:age', EVENT = 'urn:lykos:event';
const SYS = { dcm: 'http://dicom.nema.org/resources/ontology/DCM', obsCat: 'http://terminology.hl7.org/CodeSystem/observation-category',
  interp: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', cond: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
  confidentiality: 'http://terminology.hl7.org/CodeSystem/v3-ObservationValue', scope: 'http://terminology.hl7.org/CodeSystem/consentscope',
  loinc: 'http://loinc.org', dx: 'http://terminology.hl7.org/CodeSystem/v2-0074' };
const PATIENT = { reference: 'Patient/case' };
const text = v => String(v ?? '').trim();
const code = (system, c, display) => ({ coding: [{ system, code: c, ...(display ? { display } : {}) }] });

/** A time FHIR can hold as a dateTime (YYYY, YYYY-MM, YYYY-MM-DD, or a full dateTime), else ''. */
const isoOf = when => (/^\d{4}(-\d{2}(-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?)?)?$/.test(text(when)) ? text(when) : '');
const whenExt = when => (text(when) && !isoOf(when) ? [{ url: WHEN, valueString: text(when) }] : []);
const base = (type, list, id, extra = {}) => ({ resourceType: type, id: `${list}-${id}`, meta: { tag: [{ system: LIST_TAG, code: list }] }, ...extra });
const withWhen = (res, field, when) => ({ ...res, ...(isoOf(when) ? { [field]: isoOf(when) } : {}), ...(whenExt(when).length ? { extension: [...(res.extension || []), ...whenExt(when)] } : {}) });

/** A stable 2.25 OID (the UUID-derived arc) from a string: ImagingStudy.series.uid is required, and the study's real UID is not ours to invent. */
function oid(seed) {
  let a = 0xcbf29ce484222325n, b = 0x84222325cbf29ce4n;
  for (const ch of String(seed)) { a = ((a ^ BigInt(ch.codePointAt(0))) * 0x100000001b3n) & 0xffffffffffffffffn; b = ((b + a) * 0x100000001b3n) & 0xffffffffffffffffn; }
  return `urn:oid:2.25.${((a << 56n) ^ b) & ((1n << 124n) - 1n)}`;
}

const CONSENT_STATUS = { patient: 'active', proxy: 'active', waived: 'active', none: 'rejected' };

/** The case as a Bundle. `c` is s.caseReport; `phrase` and `consentLine` are optional text for the Patient and Consent. */
export function caseToFhir(c = {}, { at = new Date().toISOString() } = {}) {
  const rec = recordOf(c), entries = [];
  const add = r => entries.push({ fullUrl: `urn:lykos:${r.resourceType}/${r.id}`, resource: r });
  add({ resourceType: 'Patient', id: 'case', meta: { security: [code(SYS.confidentiality, 'ANONY', 'anonymized').coding[0]] },
    ...(c.sex ? { gender: c.sex } : { gender: 'unknown' }), ...(text(c.age) ? { extension: [{ url: AGE, valueString: text(c.age) }] } : {}) });
  for (const r of rec.medicalHistory) {
    if (!r.text) continue;
    const tag = res => ({ ...res, meta: { tag: [...res.meta.tag, { system: CAT_TAG, code: r.category }] } });
    const status = r.status ? code(SYS.cond, r.status) : undefined;
    if (r.category === 'surgical') add(tag(withWhen(base('Procedure', 'medicalHistory', r.id, { status: 'completed', code: { text: r.text }, subject: PATIENT }), 'performedDateTime', r.when)));
    else if (r.category === 'family') add(tag(withWhen(base('FamilyMemberHistory', 'medicalHistory', r.id, { status: 'completed', patient: PATIENT, relationship: { text: 'Family member' }, condition: [{ code: { text: r.text } }] }), 'date', r.when)));
    else if (r.category === 'medication') add(tag(withWhen(base('MedicationStatement', 'medicalHistory', r.id, { status: r.status === 'resolved' ? 'completed' : 'active', medicationCodeableConcept: { text: r.text }, subject: PATIENT }), 'effectiveDateTime', r.when)));
    else if (r.category === 'allergy') add(tag(withWhen(base('AllergyIntolerance', 'medicalHistory', r.id, { ...(status ? { clinicalStatus: status } : {}), code: { text: r.text }, patient: PATIENT }), 'onsetDateTime', r.when)));
    else if (r.category === 'social') add(tag(withWhen(base('Observation', 'medicalHistory', r.id, { status: 'final', category: [code(SYS.obsCat, 'social-history')], code: { text: 'Social history' }, valueString: r.text, subject: PATIENT }), 'effectiveDateTime', r.when)));
    else add(tag(withWhen(base('Condition', 'medicalHistory', r.id, { ...(status ? { clinicalStatus: status } : {}), code: { text: r.text }, subject: PATIENT }), 'onsetDateTime', r.when)));
  }
  for (const r of rec.imaging) {
    if (!r.findings && !r.region && !r.files.length) continue;
    const label = MODALITIES.find(([k]) => k === r.modality)?.[1] || r.modality;
    add(withWhen(base('ImagingStudy', 'imaging', r.id, { status: 'available', subject: PATIENT, modality: [{ system: SYS.dcm, code: r.modality, display: label }],
      ...(r.region ? { description: r.region } : {}), numberOfSeries: 1, numberOfInstances: Math.max(r.files.length, 1),
      series: [{ uid: oid(r.id), number: 1, modality: { system: SYS.dcm, code: r.modality }, ...(r.region ? { bodySite: { display: r.region } } : {}) }] }), 'started', r.when));
    if (r.findings) add(withWhen(base('DiagnosticReport', 'imaging', `${r.id}-report`, { status: 'final', category: [code(SYS.dx, 'RAD', 'Radiology')], code: { text: `${label} report` },
      subject: PATIENT, imagingStudy: [{ reference: `ImagingStudy/imaging-${r.id}` }], conclusion: r.findings }), 'effectiveDateTime', r.when));
  }
  for (const r of rec.investigations) {
    if (!r.test) continue;
    const q = quantityOf(r.value), lab = findLab(r.test), iv = lab && rangeFor(lab, c.sex);
    const ref = iv && { ...(iv[0] != null ? { low: { value: iv[0], unit: lab.unit } } : {}), ...(iv[1] != null ? { high: { value: iv[1], unit: lab.unit } } : {}), text: intervalText(lab, c.sex) };
    add(withWhen(base('Observation', 'investigations', r.id, { status: 'final', category: [code(SYS.obsCat, 'laboratory')],
      code: lab?.loinc ? { coding: [{ system: SYS.loinc, code: lab.loinc, display: lab.name }], text: r.test } : { text: r.test }, subject: PATIENT, ...(ref ? { referenceRange: [ref] } : {}),
      ...(q ? { valueQuantity: { value: q.value, ...(q.unit ? { unit: q.unit } : {}), ...(q.comparator ? { comparator: q.comparator } : {}) } } : r.value ? { valueString: r.value } : {}),
      ...(r.flag ? { interpretation: [code(SYS.interp, r.flag)] } : {}) }), 'effectiveDateTime', r.when));
  }
  for (const r of rec.treatments) {
    if (!r.name) continue;
    if (r.kind === 'drug') add(withWhen(base('MedicationStatement', 'treatments', r.id, { status: 'completed', medicationCodeableConcept: { text: r.name }, subject: PATIENT, ...(r.detail ? { dosage: [{ text: r.detail }] } : {}) }), 'effectiveDateTime', r.when));
    else add(withWhen(base('Procedure', 'treatments', r.id, { status: 'completed', code: { text: r.name }, subject: PATIENT, ...(r.detail ? { note: [{ text: r.detail }] } : {}),
      ...(r.kind === 'other' ? { category: { text: 'Other' } } : {}) }), 'performedDateTime', r.when));
  }
  for (const r of rec.measures) {
    if (!r.scale) continue;
    const q = quantityOf(r.score);
    add(withWhen(base('Observation', 'measures', r.id, { status: 'final', category: [code(SYS.obsCat, 'survey')], code: { text: r.scale }, subject: PATIENT,
      ...(q && !q.unit ? { valueQuantity: { value: q.value, ...(q.comparator ? { comparator: q.comparator } : {}) } } : r.score ? { valueString: r.score } : {}) }), 'effectiveDateTime', r.when));
  }
  for (const r of c.timeline || []) {
    if (!text(r.event)) continue;
    add(withWhen(base('Basic', 'timeline', r.id, { code: { text: text(r.category) || 'episode' }, subject: PATIENT, extension: [{ url: EVENT, valueString: text(r.event) }] }), 'created', r.when));
  }
  const status = CONSENT_STATUS[c.consent?.status];
  if (status) add(base('Consent', 'consent', 'case', { status, scope: code(SYS.scope, 'research'), category: [code(SYS.loinc, '59284-0', 'Consent Document')], patient: PATIENT,
    ...(isoOf(c.consent.date) ? { dateTime: isoOf(c.consent.date) } : {}), ...(c.consent.status === 'waived' ? { policyRule: { text: 'Waived by an ethics committee' } } : {}),
    ...(c.consent.status === 'proxy' ? { performer: [{ display: 'Parent, guardian or next of kin' }] } : {}) }));
  return { resourceType: 'Bundle', type: 'collection', timestamp: at, entry: entries };
}

// ---- reading ------------------------------------------------------------------------------------------------------------------------
const tagOf = (r, system) => r.meta?.tag?.find(t => t.system === system)?.code || '';
const ext = (r, url) => r.extension?.find(e => e.url === url)?.valueString || '';
const conceptText = cc => text(cc?.text || cc?.coding?.[0]?.display || cc?.coding?.[0]?.code);
const dayOf = v => (/^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? String(v).slice(0, 10) : text(v));
const whenOf = (r, ...fields) => ext(r, WHEN) || dayOf(fields.map(f => r[f]).find(Boolean) || '');
const quantityText = q => (q ? [q.comparator, q.value, q.unit].filter(x => x !== undefined && x !== '').join(' ').replace(/^([<>]=?) /, '$1') : '');
let n = 0;
const rid = list => `${list[0]}${Date.now().toString(36)}${(n++).toString(36)}`;

/** The rows a Bundle gives: { patch: { sex, age, <lists>, timeline, consent }, counts: { <list>: n }, skipped: [resourceType] }. */
export function fhirToCase(bundle) {
  if (bundle?.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) throw new Error('Not a FHIR Bundle');
  const patch = { medicalHistory: [], imaging: [], investigations: [], treatments: [], measures: [], timeline: [] }, skipped = [], studies = new Map(), reports = [];
  const row = (list, r, shape) => patch[list].push({ id: rid(list), ...shape });
  for (const { resource: r } of bundle.entry) {
    if (!r?.resourceType) continue;
    const list = tagOf(r, LIST_TAG), cat = tagOf(r, CAT_TAG);
    switch (r.resourceType) {
      case 'Patient':
        if (['female', 'male', 'other'].includes(r.gender)) patch.sex = r.gender;
        if (ext(r, AGE)) patch.age = ext(r, AGE);
        break;
      case 'Condition': row('medicalHistory', r, { when: whenOf(r, 'onsetDateTime', 'recordedDate'), category: 'medical', text: conceptText(r.code), status: ['active', 'resolved'].includes(r.clinicalStatus?.coding?.[0]?.code) ? r.clinicalStatus.coding[0].code : '' }); break;
      case 'FamilyMemberHistory': row('medicalHistory', r, { when: whenOf(r, 'date'), category: 'family', text: conceptText(r.condition?.[0]?.code), status: '' }); break;
      case 'AllergyIntolerance': row('medicalHistory', r, { when: whenOf(r, 'onsetDateTime', 'recordedDate'), category: 'allergy', text: conceptText(r.code), status: ['active', 'resolved'].includes(r.clinicalStatus?.coding?.[0]?.code) ? r.clinicalStatus.coding[0].code : '' }); break;
      case 'MedicationStatement':
      case 'MedicationRequest': {
        const name = conceptText(r.medicationCodeableConcept), detail = text(r.dosage?.[0]?.text || r.dosageInstruction?.[0]?.text), when = whenOf(r, 'effectiveDateTime', 'authoredOn');
        if (list === 'medicalHistory' || cat === 'medication') row('medicalHistory', r, { when, category: 'medication', text: name, status: r.status === 'completed' ? 'resolved' : r.status === 'active' ? 'active' : '' });
        else row('treatments', r, { when, kind: 'drug', name, detail });
        break;
      }
      case 'Procedure': {
        const name = conceptText(r.code), when = whenOf(r, 'performedDateTime');
        if (list === 'medicalHistory' || cat === 'surgical') row('medicalHistory', r, { when, category: 'surgical', text: name, status: '' });
        else row('treatments', r, { when, kind: r.category?.text === 'Other' ? 'other' : 'procedure', name, detail: text(r.note?.[0]?.text) });
        break;
      }
      case 'ImagingStudy': {
        const mod = r.modality?.[0]?.code || r.series?.[0]?.modality?.code || 'OT';
        const study = { id: rid('imaging'), when: whenOf(r, 'started'), modality: MODALITIES.some(([k]) => k === mod) ? mod : mod === 'CR' ? 'DX' : 'OT', region: text(r.series?.[0]?.bodySite?.display || r.description), findings: '', files: [] };
        patch.imaging.push(study); studies.set(`ImagingStudy/${r.id}`, study);
        break;
      }
      case 'DiagnosticReport':
        if (r.category?.some(c => c.coding?.some(x => x.code === 'RAD')) || list === 'imaging') reports.push(r);
        else skipped.push(r.resourceType);
        break;
      case 'Observation': {
        const catCode = r.category?.flatMap(c => c.coding || []).map(c => c.code) || [], when = whenOf(r, 'effectiveDateTime', 'issued');
        const value = r.valueQuantity ? quantityText(r.valueQuantity) : text(r.valueString || conceptText(r.valueCodeableConcept) || (r.valueInteger ?? ''));
        if (catCode.includes('social-history') || cat === 'social') row('medicalHistory', r, { when, category: 'social', text: text(r.valueString) || conceptText(r.code), status: '' });
        else if (catCode.includes('survey') || list === 'measures') row('measures', r, { when, scale: conceptText(r.code), score: value });
        else if (catCode.includes('imaging')) skipped.push('Observation (imaging)');
        else row('investigations', r, { when, test: conceptText(r.code), value, flag: ['N', 'H', 'L', 'A'].includes(r.interpretation?.[0]?.coding?.[0]?.code) ? r.interpretation[0].coding[0].code : '' });
        break;
      }
      case 'Basic': if (list === 'timeline') patch.timeline.push({ id: rid('timeline'), when: whenOf(r, 'created'), category: conceptText(r.code) === 'episode' ? '' : conceptText(r.code), event: ext(r, EVENT) }); else skipped.push('Basic'); break;
      case 'Consent': {
        const st = r.status === 'rejected' ? 'none' : r.policyRule?.text ? 'waived' : r.performer?.length ? 'proxy' : r.status === 'active' ? 'patient' : '';
        if (st) patch.consent = { status: st, date: dayOf(r.dateTime || '') };
        break;
      }
      default: skipped.push(r.resourceType);
    }
  }
  for (const rep of reports) {
    const study = studies.get(rep.imagingStudy?.[0]?.reference);
    if (study) study.findings = text(rep.conclusion);
    else patch.imaging.push({ id: rid('imaging'), when: whenOf(rep, 'effectiveDateTime'), modality: 'OT', region: '', findings: text(rep.conclusion), files: [] });
  }
  patch.medicalHistory = patch.medicalHistory.filter(r => r.text);
  patch.investigations = patch.investigations.filter(r => r.test);
  patch.treatments = patch.treatments.filter(r => r.name);
  patch.measures = patch.measures.filter(r => r.scale);
  patch.timeline = patch.timeline.filter(r => r.event);
  const counts = Object.fromEntries([...LISTS, 'timeline'].map(l => [l, patch[l].length]));
  return { patch, counts, skipped: [...new Set(skipped)] };
}
