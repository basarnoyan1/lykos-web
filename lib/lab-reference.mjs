// Standard laboratory reference values for the case record (plan §1.1, amended 2026-10-20).
//
// The values are the USMLE Laboratory Values table (USMLE Step 1 Sample Test Questions, October 2021, pages 7 to 9: "Reference Range" and "SI
// Reference Intervals"), the table the examination itself prints; a selection of its analytes, with the SI interval it prints beside each.
// Where it gives a range for each sex, both are here. Analytes that need a clinical setting to read (cycle-phase hormones, timed cortisol,
// 24-hour steroid excretion, blood volumes, iodine uptake) are left out. Each analyte carries its LOINC code, so a FHIR export can name the test.
//
// Reference intervals differ between laboratories, ages and populations: a flag from here says where a value sits against this table, not
// against the laboratory that ran it. The FDA publishes no table of adult reference intervals (its laboratory tables are toxicity grading
// scales for trial participants, a different thing), so none is used.
//
// `range` is [low, high] in the conventional unit, null for an open end; `open` names an end the table prints as a strict bound (<200, >7).
// `si` is the printed SI interval; `factor` takes a conventional value to the SI unit (the test checks the two agree within the table's rounding).

import { NUMBER, numberOf } from './case-record.mjs';

export const SOURCE = 'USMLE Laboratory Values, Step 1 Sample Test Questions (October 2021)';

const L = (id, name, group, unit, range, o = {}) => ({ id, name, group, unit, range, ...o });
const S = (siUnit, factor, si) => ({ siUnit, factor, si });

export const LABS = [
  // serum: electrolytes and chemistry
  L('na', 'Sodium', 'Chemistry', 'mEq/L', [136, 146], { aliases: ['Na', 'Na+'], loinc: '2951-2', ...S('mmol/L', 1, [136, 146]) }),
  L('k', 'Potassium', 'Chemistry', 'mEq/L', [3.5, 5.0], { aliases: ['K', 'K+'], loinc: '2823-3', ...S('mmol/L', 1, [3.5, 5.0]) }),
  L('cl', 'Chloride', 'Chemistry', 'mEq/L', [95, 105], { aliases: ['Cl'], loinc: '2075-0', ...S('mmol/L', 1, [95, 105]) }),
  L('hco3', 'Bicarbonate', 'Chemistry', 'mEq/L', [22, 28], { aliases: ['HCO3', 'CO2 total'], loinc: '1963-8', ...S('mmol/L', 1, [22, 28]) }),
  L('bun', 'Urea nitrogen', 'Chemistry', 'mg/dL', [7, 18], { aliases: ['BUN', 'Blood urea nitrogen'], loinc: '3094-0', ...S('mmol/L', 0.357, [2.5, 6.4]) }),
  // Turkish laboratories report urea, not urea nitrogen: the same interval times 2.14 (urea is 60 g/mol, its nitrogen 28), so it is derived, not printed by the table
  L('urea', 'Urea', 'Chemistry', 'mg/dL', [15, 39], { aliases: ['Blood urea'], derived: true, note: 'Derived from the table\'s urea nitrogen (7 to 18 mg/dL times 2.14); many laboratories print a wider interval', ...S('mmol/L', 0.1665, [2.5, 6.4]) }),
  L('creat', 'Creatinine', 'Chemistry', 'mg/dL', [0.6, 1.2], { aliases: ['Cr', 'Serum creatinine'], loinc: '2160-0', ...S('µmol/L', 88.4, [53, 106]) }),
  L('glu', 'Glucose, fasting', 'Chemistry', 'mg/dL', [70, 100], { aliases: ['Glucose', 'Fasting glucose', 'Blood sugar'], loinc: '2345-7', note: 'Random, non-fasting: below 140 mg/dL', ...S('mmol/L', 0.0555, [3.8, 5.6]) }),
  L('ca', 'Calcium', 'Chemistry', 'mg/dL', [8.4, 10.2], { aliases: ['Ca', 'Total calcium'], loinc: '17861-6', ...S('mmol/L', 0.25, [2.1, 2.6]) }),
  L('mg', 'Magnesium', 'Chemistry', 'mg/dL', [1.5, 2.0], { aliases: ['Mg'], loinc: '19123-9', siDiffers: true, note: 'The table prints 0.75 to 1.0 mmol/L, which is its mEq/L figure; 1 mg/dL is 0.4114 mmol/L', ...S('mmol/L', 0.4114, [0.75, 1.0]) }),
  L('phos', 'Phosphorus', 'Chemistry', 'mg/dL', [3.0, 4.5], { aliases: ['Phosphate', 'Inorganic phosphorus'], loinc: '2777-1', ...S('mmol/L', 0.3229, [1.0, 1.5]) }),
  L('ua', 'Uric acid', 'Chemistry', 'mg/dL', [3.0, 8.2], { aliases: ['Urate'], loinc: '3084-1', ...S('mmol/L', 0.0595, [0.18, 0.48]) }),
  L('osm', 'Osmolality, serum', 'Chemistry', 'mOsm/kg H2O', [275, 295], { aliases: ['Serum osmolality'], loinc: '2692-2', ...S('mOsm/kg H2O', 1, [275, 295]) }),
  // hepatic and other enzymes
  L('alt', 'Alanine aminotransferase', 'Liver and enzymes', 'U/L', [10, 40], { aliases: ['ALT', 'SGPT'], loinc: '1742-6', ...S('U/L', 1, [10, 40]) }),
  L('ast', 'Aspartate aminotransferase', 'Liver and enzymes', 'U/L', [12, 38], { aliases: ['AST', 'SGOT'], loinc: '1920-8', ...S('U/L', 1, [12, 38]) }),
  L('alp', 'Alkaline phosphatase', 'Liver and enzymes', 'U/L', [25, 100], { aliases: ['ALP', 'Alk phos'], loinc: '6768-6', ...S('U/L', 1, [25, 100]) }),
  L('tbili', 'Bilirubin, total', 'Liver and enzymes', 'mg/dL', [0.1, 1.0], { aliases: ['Total bilirubin'], loinc: '1975-2', ...S('µmol/L', 17.1, [2, 17]) }),
  L('dbili', 'Bilirubin, direct', 'Liver and enzymes', 'mg/dL', [0.0, 0.3], { aliases: ['Direct bilirubin'], loinc: '1968-7', ...S('µmol/L', 17.1, [0, 5]) }),
  L('tp', 'Protein, total', 'Liver and enzymes', 'g/dL', [6.0, 7.8], { aliases: ['Total protein'], loinc: '2885-2', ...S('g/L', 10, [60, 78]) }),
  L('alb', 'Albumin', 'Liver and enzymes', 'g/dL', [3.5, 5.5], { aliases: ['Serum albumin'], loinc: '1751-7', ...S('g/L', 10, [35, 55]) }),
  L('glob', 'Globulin', 'Liver and enzymes', 'g/dL', [2.3, 3.5], { loinc: '10834-0', ...S('g/L', 10, [23, 35]) }),
  L('amy', 'Amylase', 'Liver and enzymes', 'U/L', [25, 125], { loinc: '1798-8', ...S('U/L', 1, [25, 125]) }),
  L('lip', 'Lipase', 'Liver and enzymes', 'U/L', [13, 60], { loinc: '3040-3', ...S('U/L', 1, [13, 60]) }),
  L('ck', 'Creatine kinase', 'Liver and enzymes', 'U/L', null, { aliases: ['CK', 'CPK'], loinc: '2157-6', male: [25, 90], female: [10, 70], ...S('U/L', 1, null) }),
  L('ldh', 'Lactate dehydrogenase', 'Liver and enzymes', 'U/L', [45, 200], { aliases: ['LDH'], loinc: '2532-0', ...S('U/L', 1, [45, 200]) }),
  L('tni', 'Troponin I', 'Cardiac', 'ng/mL', [null, 0.04], { aliases: ['cTnI'], loinc: '10839-9', ...S('µg/L', 1, [null, 0.04]) }),
  // renal
  L('crcl', 'Creatinine clearance', 'Chemistry', 'mL/min', null, { loinc: '2164-2', male: [97, 137], female: [88, 128], ...S('mL/min', 1, null) }),
  // lipids
  L('chol', 'Cholesterol, total', 'Lipids', 'mg/dL', [null, 200], { open: 'high', aliases: ['Total cholesterol'], loinc: '2093-3', note: 'High: above 240 mg/dL', ...S('mmol/L', 0.0259, [null, 5.2]) }),
  L('hdl', 'Cholesterol, HDL', 'Lipids', 'mg/dL', [40, 60], { aliases: ['HDL'], loinc: '2085-9', ...S('mmol/L', 0.0259, [1.0, 1.6]) }),
  L('ldl', 'Cholesterol, LDL', 'Lipids', 'mg/dL', [null, 160], { open: 'high', aliases: ['LDL'], loinc: '13457-7', ...S('mmol/L', 0.0259, [null, 4.2]) }),
  L('tg', 'Triglycerides', 'Lipids', 'mg/dL', [null, 150], { open: 'high', aliases: ['TG'], loinc: '2571-8', note: 'Borderline: 151 to 199 mg/dL', ...S('mmol/L', 0.0113, [null, 1.70]) }),
  // iron
  L('ferritin', 'Ferritin', 'Iron', 'ng/mL', null, { loinc: '2276-4', male: [20, 250], female: [10, 120], ...S('µg/L', 1, null) }),
  L('iron', 'Iron', 'Iron', 'µg/dL', null, { aliases: ['Serum iron'], loinc: '2498-4', male: [65, 175], female: [50, 170], ...S('µmol/L', 0.179, null), siMale: [11.6, 31.3], siFemale: [9.0, 30.4] }),
  L('tibc', 'Total iron-binding capacity', 'Iron', 'µg/dL', [250, 400], { aliases: ['TIBC'], loinc: '2500-7', ...S('µmol/L', 0.179, [44.8, 71.6]) }),
  L('transferrin', 'Transferrin', 'Iron', 'mg/dL', [200, 360], { loinc: '3034-6', ...S('g/L', 0.01, [2.0, 3.6]) }),
  // endocrine and immunoglobulins
  L('tsh', 'Thyroid-stimulating hormone', 'Endocrine', 'µU/mL', [0.4, 4.0], { aliases: ['TSH'], loinc: '3016-3', ...S('mIU/L', 1, [0.4, 4.0]) }),
  L('ft4', 'Free T4', 'Endocrine', 'ng/dL', [0.9, 1.7], { aliases: ['Free thyroxine', 'FT4'], loinc: '3024-7', ...S('pmol/L', 12.87, [12.0, 21.9]) }),
  L('t4', 'Thyroxine (T4)', 'Endocrine', 'µg/dL', [5, 12], { aliases: ['T4', 'Total T4'], loinc: '3026-2', ...S('nmol/L', 12.87, [64, 155]) }),
  L('t3', 'Triiodothyronine (T3)', 'Endocrine', 'ng/dL', [100, 200], { aliases: ['T3', 'Total T3'], loinc: '3053-6', ...S('nmol/L', 0.0154, [1.5, 3.1]) }),
  L('pth', 'Parathyroid hormone, intact', 'Endocrine', 'pg/mL', [10, 60], { aliases: ['PTH', 'Intact PTH'], loinc: '2731-8', ...S('ng/L', 1, [10, 60]) }),
  L('prl', 'Prolactin', 'Endocrine', 'ng/mL', null, { loinc: '2842-3', male: [null, 17], female: [null, 25], ...S('µg/L', 1, null) }),
  L('iga', 'Immunoglobulin A', 'Immunoglobulins', 'mg/dL', [76, 390], { aliases: ['IgA'], loinc: '2458-8', ...S('g/L', 0.01, [0.76, 3.90]) }),
  L('igg', 'Immunoglobulin G', 'Immunoglobulins', 'mg/dL', [650, 1500], { aliases: ['IgG'], loinc: '2465-3', ...S('g/L', 0.01, [6.5, 15.0]) }),
  L('igm', 'Immunoglobulin M', 'Immunoglobulins', 'mg/dL', [50, 300], { aliases: ['IgM'], loinc: '2472-9', ...S('g/L', 0.01, [0.5, 3.0]) }),
  L('ige', 'Immunoglobulin E', 'Immunoglobulins', 'IU/mL', [0, 380], { aliases: ['IgE'], loinc: '19113-0', ...S('kIU/L', 1, [0, 380]) }),
  // arterial blood gas
  L('po2', 'Arterial PO2', 'Blood gas', 'mm Hg', [75, 105], { aliases: ['PaO2', 'pO2'], loinc: '2703-7', note: 'Room air', ...S('kPa', 0.1333, [10.0, 14.0]) }),
  L('pco2', 'Arterial PCO2', 'Blood gas', 'mm Hg', [33, 45], { aliases: ['PaCO2', 'pCO2'], loinc: '2019-8', note: 'Room air', ...S('kPa', 0.1333, [4.4, 5.9]) }),
  L('ph', 'Arterial pH', 'Blood gas', '', [7.35, 7.45], { aliases: ['pH'], loinc: '2744-1', note: 'Room air' }),
  // cerebrospinal fluid
  L('csfcells', 'CSF cell count', 'Cerebrospinal fluid', '/mm3', [0, 5], { aliases: ['CSF WBC'], ...S('× 10^6/L', 1, [0, 5]) }),
  L('csfglu', 'CSF glucose', 'Cerebrospinal fluid', 'mg/dL', [40, 70], { loinc: '2342-4', ...S('mmol/L', 0.0555, [2.2, 3.9]) }),
  L('csfprot', 'CSF protein', 'Cerebrospinal fluid', 'mg/dL', [null, 40], { open: 'high', loinc: '2880-3', ...S('g/L', 0.01, [null, 0.40]) }),
  L('csfpress', 'CSF opening pressure', 'Cerebrospinal fluid', 'mm H2O', [70, 180], { aliases: ['Opening pressure'], ...S('mm H2O', 1, [70, 180]) }),
  // hematology
  L('hgb', 'Hemoglobin', 'Hematology', 'g/dL', null, { aliases: ['Hb', 'Hgb'], loinc: '718-7', male: [13.5, 17.5], female: [12.0, 16.0], ...S('g/L', 10, null), siMale: [135, 175], siFemale: [120, 160] }),
  L('hct', 'Hematocrit', 'Hematology', '%', null, { aliases: ['Hct'], loinc: '4544-3', male: [41, 53], female: [36, 46], ...S('fraction', 0.01, null), siMale: [0.41, 0.53], siFemale: [0.36, 0.46] }),
  L('mcv', 'Mean corpuscular volume', 'Hematology', 'fL', [80, 100], { aliases: ['MCV'], loinc: '787-2', ...S('fL', 1, [80, 100]) }),
  L('mch', 'Mean corpuscular hemoglobin', 'Hematology', 'pg', [25, 35], { aliases: ['MCH'], loinc: '785-6' }),
  L('mchc', 'Mean corpuscular hemoglobin concentration', 'Hematology', '%', [31, 36], { aliases: ['MCHC'], loinc: '786-4' }),
  L('wbc', 'Leukocyte count', 'Hematology', '/mm3', [4500, 11000], { aliases: ['WBC', 'White blood cell count'], loinc: '6690-2', ...S('× 10^9/L', 0.001, [4.5, 11.0]) }),
  L('plt', 'Platelet count', 'Hematology', '/mm3', [150000, 400000], { aliases: ['Platelets', 'PLT'], loinc: '777-3', ...S('× 10^9/L', 0.001, [150, 400]) }),
  L('rbc', 'Erythrocyte count', 'Hematology', 'million/mm3', null, { aliases: ['RBC', 'Red blood cell count'], loinc: '789-8', male: [4.3, 5.9], female: [3.5, 5.5], ...S('× 10^12/L', 1, null) }),
  L('retic', 'Reticulocyte count', 'Hematology', '%', [0.5, 1.5], { aliases: ['Retic'], loinc: '4679-7' }),
  L('esr', 'Erythrocyte sedimentation rate', 'Hematology', 'mm/h', null, { aliases: ['ESR'], loinc: '30341-2', male: [0, 15], female: [0, 20], ...S('mm/h', 1, null), note: 'Westergren' }),
  L('cd4', 'CD4+ T-lymphocyte count', 'Hematology', '/mm3', [500, null], { aliases: ['CD4'], loinc: '24467-3', ...S('× 10^9/L', 0.001, [0.5, null]) }),
  L('hba1c', 'Hemoglobin A1c', 'Hematology', '%', [null, 6], { aliases: ['HbA1c', 'A1c', 'Glycated hemoglobin'], loinc: '4548-4', note: 'SI: at most 42 mmol/mol' }),
  // coagulation
  L('ptt', 'Partial thromboplastin time (activated)', 'Coagulation', 'seconds', [25, 40], { aliases: ['aPTT', 'PTT'], loinc: '3173-2', ...S('seconds', 1, [25, 40]) }),
  L('pt', 'Prothrombin time', 'Coagulation', 'seconds', [11, 15], { aliases: ['PT'], loinc: '5902-2', ...S('seconds', 1, [11, 15]) }),
  L('ddimer', 'D-dimer', 'Coagulation', 'ng/mL', [null, 250], { ...S('nmol/L', 0.0055, [null, 1.4]) }),
  // urine
  L('ucalcium', 'Urine calcium', 'Urine', 'mg/24 h', [100, 300], { loinc: '6874-2', ...S('mmol/24 h', 0.025, [2.5, 7.5]) }),
  L('uprotein', 'Urine protein', 'Urine', 'mg/24 h', [null, 150], { open: 'high', ...S('g/24 h', 0.001, [null, 0.15]) }),
  L('uosm', 'Urine osmolality', 'Urine', 'mOsm/kg H2O', [50, 1200], { ...S('mOsm/kg H2O', 1, [50, 1200]) }),
  L('bmi', 'Body mass index', 'Body', 'kg/m2', [19, 25], { aliases: ['BMI'] }),
];

// ---- Turkish names and the units Turkish reports use -------------------------------------------------------------------------------
// Turkish laboratories print most chemistry in the conventional units above (mg/dL, g/dL, U/L, mmol/L for electrolytes); blood counts as ×10³/µL
// (the same as /mm3 divided by 1000), troponin in ng/L, HbA1c in % with mmol/mol beside it. These are accepted when a value is typed and judged
// in the table's unit; `alt` is [unit names, value in the table's unit from a value in that unit].
const TR = { na: 'Sodyum', k: 'Potasyum', cl: 'Klor', hco3: 'Bikarbonat', bun: 'Kan üre azotu', urea: 'Üre', creat: 'Kreatinin', glu: 'Açlık kan şekeri', ca: 'Kalsiyum', mg: 'Magnezyum', phos: 'Fosfor',
  ua: 'Ürik asit', alt: 'ALT (SGPT)', ast: 'AST (SGOT)', alp: 'Alkalen fosfataz', tbili: 'Total bilirübin', dbili: 'Direkt bilirübin', tp: 'Total protein', alb: 'Albümin', glob: 'Globülin',
  amy: 'Amilaz', lip: 'Lipaz', ck: 'Kreatin kinaz', ldh: 'Laktat dehidrogenaz', tni: 'Troponin I', chol: 'Total kolesterol', hdl: 'HDL kolesterol', ldl: 'LDL kolesterol', tg: 'Trigliserid',
  ferritin: 'Ferritin', iron: 'Demir', tibc: 'Demir bağlama kapasitesi', transferrin: 'Transferrin', tsh: 'TSH', ft4: 'Serbest T4', t4: 'Total T4', t3: 'Total T3', pth: 'Parathormon', prl: 'Prolaktin',
  hgb: 'Hemoglobin', hct: 'Hematokrit', mcv: 'MCV', wbc: 'Lökosit', plt: 'Trombosit', rbc: 'Eritrosit', retic: 'Retikülosit', esr: 'Sedimantasyon', hba1c: 'HbA1c', ptt: 'aPTT', pt: 'Protrombin zamanı',
  ddimer: 'D-dimer', po2: 'Arteriyel pO2', pco2: 'Arteriyel pCO2', ph: 'Arteriyel pH', csfglu: 'BOS glukoz', csfprot: 'BOS protein', csfcells: 'BOS hücre sayısı', ucalcium: 'İdrar kalsiyumu', uprotein: 'İdrar proteini' };
const COUNT = ['x103/ul', '103/ul', 'k/ul', 'x109/l', '109/l', 'g/l', '10e3/ul', 'bin/ul'];
const ALT = {
  wbc: [[COUNT, v => v * 1000]], plt: [[COUNT, v => v * 1000]], rbc: [[['x106/ul', '106/ul', 'm/ul', 'x1012/l', '1012/l', '10e6/ul'], v => v]],
  tni: [[['ng/l', 'pg/ml'], v => v / 1000]], urea: [[['mmol/l'], v => v * 6.006]],
  hba1c: [[['mmol/mol'], v => v / 10.929 + 2.15]],
  cd4: [[COUNT, v => v * 1000]],
};
// the short form a clinician writes, shown in the grid, the charts and the panels where the table's name is long
const SHORT = { alt: 'ALT', ast: 'AST', alp: 'ALP', bun: 'BUN', ck: 'CK', ldh: 'LDH', tsh: 'TSH', t4: 'T4', t3: 'T3', ft4: 'Free T4', pth: 'PTH', hdl: 'HDL', ldl: 'LDL', tg: 'Triglycerides', tni: 'Troponin I',
  tbili: 'Total bilirubin', dbili: 'Direct bilirubin', tp: 'Total protein', tibc: 'TIBC', wbc: 'WBC', plt: 'Platelets', rbc: 'RBC', mcv: 'MCV', mch: 'MCH', mchc: 'MCHC', esr: 'ESR', hba1c: 'HbA1c',
  ptt: 'aPTT', pt: 'PT', cd4: 'CD4', iga: 'IgA', igg: 'IgG', igm: 'IgM', ige: 'IgE', amy: 'Amylase', ua: 'Uric acid', chol: 'Total cholesterol', hct: 'Hematocrit', csfcells: 'CSF cells', csfglu: 'CSF glucose', csfprot: 'CSF protein',
  hgb: 'Hemoglobin', crcl: 'Creatinine clearance', prl: 'Prolactin', po2: 'PaO2', pco2: 'PaCO2', ph: 'Arterial pH', csfpress: 'CSF pressure', ucalcium: 'Urine calcium', uprotein: 'Urine protein', uosm: 'Urine osmolality' };
for (const l of LABS) { l.short = SHORT[l.id] || l.name; if (l.short !== l.name) (l.aliases ||= []).push(l.short); }
for (const l of LABS) { l.tr = TR[l.id] || ''; if (l.tr) (l.aliases ||= []).push(l.tr); if (ALT[l.id]) l.alt = ALT[l.id]; }

// ---- panels ------------------------------------------------------------------------------------------------------------------------
export const PANELS = [
  ['Basic metabolic panel', ['na', 'k', 'cl', 'hco3', 'bun', 'creat', 'glu', 'ca']],
  ['Complete blood count', ['wbc', 'hgb', 'hct', 'plt', 'mcv']],
  ['Liver panel', ['alt', 'ast', 'alp', 'tbili', 'dbili', 'alb', 'tp']],
  ['Lipid panel', ['chol', 'hdl', 'ldl', 'tg']],
  ['Thyroid panel', ['tsh', 'ft4']],
  ['Coagulation', ['pt', 'ptt']],
  ['Iron studies', ['iron', 'tibc', 'ferritin', 'transferrin']],
  ['Cerebrospinal fluid', ['csfcells', 'csfglu', 'csfprot']],
];
export const labById = id => LABS.find(l => l.id === id) || null;

// ---- finding and judging ----------------------------------------------------------------------------------------------------------
const fold = s => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').replace(/İ/g, 'i').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();
const INDEX = new Map();
for (const l of LABS) for (const n of [l.name, ...(l.aliases || [])]) if (!INDEX.has(fold(n))) INDEX.set(fold(n), l);
/** The analyte a test name names (its name, an abbreviation, or the name without "fasting" and the like), or null. */
export function findLab(name) {
  const k = fold(name);
  return INDEX.get(k) || INDEX.get(k.replace(/\b(serum|plasma|blood|total|level|fasting)\b/g, '').replace(/\s+/g, ' ').trim()) || null;
}

/** The interval for a sex: [low, high] in the conventional unit, null when the table gives none (an unstated sex falls to the male and female both, as null). */
export function rangeFor(lab, sex = '') {
  if (lab.range) return lab.range;
  if (sex === 'male' || sex === 'female') return lab[sex] || null;
  return null;
}

/** A unit as one comparable string: case, spaces, µ or u, × or x, superscripts and ^ do not matter ("×10³/µL" is "x103/ul"). */
const normUnit = u => String(u ?? '').toLowerCase().replace(/[\s^]+/g, '').replace(/[μµ]/g, 'u').replace(/×/g, 'x').replace(/³/g, '3').replace(/⁶/g, '6').replace(/⁹/g, '9');

/**
 * Where a value stands against the table: { lab, value, unit, flag, interval, text } or null when the test is not in it, the value has no number,
 * or its unit is neither the conventional nor the SI one. A value with no unit is taken in the conventional unit. `flag` is N, L or H (A is left to a person).
 * The SI unit's value is brought back to the conventional one by the factor before it is judged.
 */
export function evaluate(test, value, sex = '') {
  const lab = findLab(test);
  if (!lab) return null;
  const m = new RegExp(`^\\s*([<>]=?|≤|≥)?\\s*(${NUMBER})\\s*(.*)$`).exec(String(value ?? ''));
  if (!m) return null;
  let n = numberOf(m[2]);
  const unit = m[3].trim(), conv = normUnit(lab.unit), si = normUnit(lab.siUnit);
  const u = normUnit(unit);
  if (u && u !== conv) {
    const alt = (lab.alt || []).find(([names]) => names.includes(u));
    if (alt) n = alt[1](n);
    else if (u === si && lab.factor) n /= lab.factor;
    else return null;
  }
  const iv = rangeFor(lab, sex);
  const text = intervalText(lab, sex);
  if (!iv) return { lab, value: n, unit: lab.unit, flag: '', interval: null, text };
  const [lo, hi] = iv, strict = lab.open === 'high';
  const flag = lo != null && n < lo ? 'L' : hi != null && (strict ? n >= hi : n > hi) ? 'H' : 'N';
  return { lab, value: n, unit: lab.unit, flag, interval: iv, text };
}

/** The interval on one line for a narrow column: "12–16 g/dL", "<200 mg/dL", "M 13.5–17.5, F 12–16 g/dL"; '' for a test the table does not know. */
export function shortRange(lab, sex = '') {
  if (!lab) return '';
  const f = iv => { const d = places(iv); return iv[0] != null && iv[1] != null ? `${num(iv[0], d)}–${num(iv[1], d)}` : iv[1] != null ? `${lab.open === 'high' ? '<' : '≤'}${num(iv[1], d)}` : `≥${num(iv[0], d)}`; };
  const u = lab.unit ? ` ${lab.unit}` : '';
  if (lab.range) return `${f(lab.range)}${u}`;
  if (sex === 'male' || sex === 'female') return lab[sex] ? `${f(lab[sex])}${u}` : '';
  return [lab.male && `M ${f(lab.male)}`, lab.female && `F ${f(lab.female)}`].filter(Boolean).join(', ') + u;
}
const num = (v, d = 0) => (v >= 1000 ? v.toLocaleString('en-US') : d ? v.toFixed(d) : String(v));
const places = iv => Math.max(...iv.filter(x => x != null).map(x => (String(x).split('.')[1] || '').length));
/** "13.5 to 17.5 g/dL (male)", "below 200 mg/dL"; a sex-specific analyte with no sex given lists both. */
export function intervalText(lab, sex = '') {
  const fmt = iv => { const d = places(iv); return iv[0] != null && iv[1] != null ? `${num(iv[0], d)} to ${num(iv[1], d)}` : iv[1] != null ? `${lab.open === 'high' ? 'below' : 'up to'} ${num(iv[1], d)}` : `at least ${num(iv[0], d)}`; };
  const u = lab.unit ? ` ${lab.unit}` : '';
  const counts = lab.alt?.[0]?.[0] === COUNT && lab.range ? ` (${fmt(lab.range.map(v => v == null ? v : v / 1000))} ×10³/µL)` : '';
  if (lab.range) return `${fmt(lab.range)}${u}${counts}`;
  const one = s => (lab[s] ? `${fmt(lab[s])}${u} (${s})` : '');
  return (sex === 'male' || sex === 'female' ? one(sex) : [one('male'), one('female')].filter(Boolean).join('; ')) || '';
}
