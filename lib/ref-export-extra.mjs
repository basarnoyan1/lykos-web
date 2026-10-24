// Records out with what the review decided about them, a formatted reference
// list, and journal-title abbreviations.
//
// RIS and CSV are lib/bib-export.mjs's own output with the review's work
// added: each screening stage's decision, reason, reviewer and time; the
// record's labels and collections; its notes. A field the project lacks is
// omitted, never filled.
//
// The abbreviation table below is a curated list written for this app. It is
// NOT the NLM Catalog: the exact titles are ones whose MEDLINE abbreviation
// is well established, and every other title is shortened word by word with
// ISO 4-style forms. A record's own abbreviation (journalAbbr, from PubMed,
// Crossref or the export) always wins over either.
import { toRis, toCsv } from './bib-export.mjs';
import { authorList, initials } from './bib.mjs';
import { formatReference } from './cite.mjs';
import { normaliseType } from './ref-import-extra.mjs';

// ---- the review's work on a record ------------------------------------------------
const STAGES = [['screening', 'Title/abstract', 'TA'], ['fulltext', 'Full text', 'FT']];
const oneLine = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const idOf = p => p.id || p.key;

/** Labels, collections, notes and per-stage decisions for one record, from project state. */
export function reviewWork(p, state = {}) {
  const id = idOf(p);
  const stages = STAGES.map(([k, name, code]) => {
    const d = state?.[k]?.[id];
    return d && d.decision ? { stage: k, name, code, decision: String(d.decision), reason: oneLine(d.reason), by: oneLine(d.by), at: oneLine(d.at), note: oneLine(d.note) } : null;
  }).filter(Boolean);
  const lab = state?.screeningLabels;
  const on = lab?.of?.[id] || {};
  const labels = (lab?.list || []).filter(l => l.id in on).map(l => l.name);
  const collections = (state?.collections || []).filter(c => (c.members || []).includes(id)).map(c => c.name).filter(Boolean);
  const own = [p.note, p.notes, state?.notes?.[id]].flatMap(n => typeof n === 'string' ? [n] : Array.isArray(n) ? n.map(x => typeof x === 'string' ? x : x?.text) : n && typeof n === 'object' && typeof n.text === 'string' ? [n.text] : []);
  const notes = own.map(oneLine).filter(Boolean);
  return { stages, labels, collections, notes };
}

const decisionLine = s => `${s.name} screening: ${s.decision}${s.reason ? ` (${s.reason})` : ''}${s.by ? `, by ${s.by}` : ''}${s.at ? `, ${s.at}` : ''}${s.note ? `. Note: ${s.note}` : ''}`;
const RIS_TY = { book: 'BOOK', chapter: 'CHAP', conference: 'CPAPER', thesis: 'THES', report: 'RPRT', dataset: 'DATA', 'trial-registration': 'ELEC' };

/**
 * RIS with the review's work: decisions and notes in N1, labels in LB, and in
 * KW the record's keywords, its collections ("Collection: …") and one tag per
 * stage ("Lykos TA: include") so a reference manager can filter by them.
 */
export function toRisWithDecisions(papers, state = {}) {
  return papers.map(p => {
    const w = reviewWork(p, state);
    let ris = toRis([p]).trimEnd();
    const ty = RIS_TY[normaliseType(p)];
    if (ty) ris = ris.replace(/^TY {2}- JOUR$/m, `TY  - ${ty}`);
    const extra = [
      ...(p.keywords || []).map(k => `KW  - ${oneLine(k)}`),
      ...w.collections.map(c => `KW  - Collection: ${c}`),
      ...w.stages.map(s => `KW  - Lykos ${s.code}: ${s.decision}`),
      ...(w.labels.length ? [`LB  - ${w.labels.join('; ')}`] : []),
      ...w.stages.map(s => `N1  - ${decisionLine(s)}`),
      ...w.notes.map(n => `N1  - ${n}`),
    ];
    return ris.replace(/\nER {2}- ?$/, `${extra.length ? `\n${extra.join('\n')}` : ''}\nER  - `);
  }).join('\n\n') + '\n';
}

const csvCell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** CSV as lib/bib-export.mjs writes it, with the record type, each stage's decision, labels, collections and notes after. */
export function toCsvWithDecisions(papers, state = {}) {
  const head = toCsv([]).trimEnd();
  const extraHead = ['type', 'keywords', 'ta_decision', 'ta_reason', 'ta_by', 'ta_at', 'ft_decision', 'ft_reason', 'ft_by', 'ft_at', 'labels', 'collections', 'notes'];
  const rows = papers.map(p => {
    const base = toCsv([p]).slice(head.length + 1).replace(/\n$/, '');
    const w = reviewWork(p, state);
    const st = code => w.stages.find(s => s.code === code) || {};
    const ta = st('TA'), ft = st('FT');
    const extra = [normaliseType(p), (p.keywords || []).join('; '), ta.decision, ta.reason, ta.by, ta.at, ft.decision, ft.reason, ft.by, ft.at,
      w.labels.join('; '), w.collections.join('; '), [...w.stages.filter(s => s.note).map(s => `${s.name}: ${s.note}`), ...w.notes].join(' | ')];
    return `${base},${extra.map(csvCell).join(',')}`;
  });
  return [`${head},${extraHead.join(',')}`, ...rows].join('\n') + '\n';
}

// ---- journal abbreviations -----------------------------------------------------
// Exact titles (lower case, "the" and punctuation dropped) -> MEDLINE abbreviation.
const EXACT = {
  'new england journal of medicine': 'N Engl J Med', 'lancet': 'Lancet', 'jama': 'JAMA', 'journal of the american medical association': 'JAMA',
  'jama the journal of the american medical association': 'JAMA', 'bmj': 'BMJ', 'british medical journal': 'BMJ', 'bmj clinical research ed': 'BMJ',
  'annals of internal medicine': 'Ann Intern Med', 'spine': 'Spine (Phila Pa 1976)', 'spine phila pa 1976': 'Spine (Phila Pa 1976)',
  'spine philadelphia pa 1976': 'Spine (Phila Pa 1976)', 'european spine journal': 'Eur Spine J', 'journal of neurosurgery spine': 'J Neurosurg Spine',
  'journal of neurosurgery': 'J Neurosurg', 'neurosurgery': 'Neurosurgery', 'spine journal': 'Spine J', 'world neurosurgery': 'World Neurosurg',
  'global spine journal': 'Global Spine J', 'journal of bone and joint surgery american volume': 'J Bone Joint Surg Am',
  'journal of bone and joint surgery british volume': 'J Bone Joint Surg Br', 'bone and joint journal': 'Bone Joint J', 'bone joint journal': 'Bone Joint J',
  'nature': 'Nature', 'science': 'Science', 'cell': 'Cell', 'nature medicine': 'Nat Med', 'plos one': 'PLoS One', 'plos medicine': 'PLoS Med',
  'bmj open': 'BMJ Open', 'cochrane database of systematic reviews': 'Cochrane Database Syst Rev', 'lancet oncology': 'Lancet Oncol',
  'lancet neurology': 'Lancet Neurol', 'lancet infectious diseases': 'Lancet Infect Dis', 'lancet respiratory medicine': 'Lancet Respir Med',
  'lancet diabetes and endocrinology': 'Lancet Diabetes Endocrinol', 'lancet psychiatry': 'Lancet Psychiatry', 'lancet global health': 'Lancet Glob Health',
  'lancet public health': 'Lancet Public Health', 'lancet gastroenterology and hepatology': 'Lancet Gastroenterol Hepatol', 'lancet haematology': 'Lancet Haematol',
  'lancet hiv': 'Lancet HIV', 'eclinicalmedicine': 'EClinicalMedicine', 'jama internal medicine': 'JAMA Intern Med', 'jama neurology': 'JAMA Neurol',
  'jama oncology': 'JAMA Oncol', 'jama pediatrics': 'JAMA Pediatr', 'jama surgery': 'JAMA Surg', 'jama psychiatry': 'JAMA Psychiatry',
  'jama cardiology': 'JAMA Cardiol', 'jama network open': 'JAMA Netw Open', 'jama ophthalmology': 'JAMA Ophthalmol', 'jama dermatology': 'JAMA Dermatol',
  'jama otolaryngology head and neck surgery': 'JAMA Otolaryngol Head Neck Surg', 'circulation': 'Circulation',
  'journal of the american college of cardiology': 'J Am Coll Cardiol', 'european heart journal': 'Eur Heart J', 'journal of clinical oncology': 'J Clin Oncol',
  'annals of oncology': 'Ann Oncol', 'ca a cancer journal for clinicians': 'CA Cancer J Clin', 'cancer': 'Cancer', 'clinical cancer research': 'Clin Cancer Res',
  'journal of the national cancer institute': 'J Natl Cancer Inst', 'neuro-oncology': 'Neuro Oncol', 'neuro oncology': 'Neuro Oncol',
  'journal of neuro-oncology': 'J Neurooncol', 'journal of neuro oncology': 'J Neurooncol', 'annals of surgery': 'Ann Surg', 'british journal of surgery': 'Br J Surg',
  'surgery': 'Surgery', 'pediatrics': 'Pediatrics', 'journal of pediatrics': 'J Pediatr', 'obstetrics and gynecology': 'Obstet Gynecol',
  'american journal of obstetrics and gynecology': 'Am J Obstet Gynecol', 'gastroenterology': 'Gastroenterology', 'gut': 'Gut', 'hepatology': 'Hepatology',
  'journal of hepatology': 'J Hepatol', 'american journal of gastroenterology': 'Am J Gastroenterol', 'diabetes care': 'Diabetes Care', 'diabetologia': 'Diabetologia',
  'diabetes': 'Diabetes', 'stroke': 'Stroke', 'neurology': 'Neurology', 'brain': 'Brain', 'annals of neurology': 'Ann Neurol',
  'journal of neurology neurosurgery and psychiatry': 'J Neurol Neurosurg Psychiatry', 'american journal of psychiatry': 'Am J Psychiatry',
  'british journal of psychiatry': 'Br J Psychiatry', 'american journal of respiratory and critical care medicine': 'Am J Respir Crit Care Med',
  'chest': 'Chest', 'thorax': 'Thorax', 'european respiratory journal': 'Eur Respir J', 'critical care medicine': 'Crit Care Med',
  'intensive care medicine': 'Intensive Care Med', 'critical care': 'Crit Care', 'anesthesiology': 'Anesthesiology', 'british journal of anaesthesia': 'Br J Anaesth',
  'anesthesia and analgesia': 'Anesth Analg', 'anaesthesia': 'Anaesthesia', 'radiology': 'Radiology', 'american journal of roentgenology': 'AJR Am J Roentgenol',
  'ajr american journal of roentgenology': 'AJR Am J Roentgenol', 'american journal of neuroradiology': 'AJNR Am J Neuroradiol',
  'ajnr american journal of neuroradiology': 'AJNR Am J Neuroradiol', 'kidney international': 'Kidney Int', 'journal of the american society of nephrology': 'J Am Soc Nephrol',
  'arthritis and rheumatology': 'Arthritis Rheumatol', 'annals of the rheumatic diseases': 'Ann Rheum Dis', 'clinical infectious diseases': 'Clin Infect Dis',
  'journal of infectious diseases': 'J Infect Dis', 'blood': 'Blood', 'american journal of epidemiology': 'Am J Epidemiol',
  'international journal of epidemiology': 'Int J Epidemiol', 'journal of clinical epidemiology': 'J Clin Epidemiol', 'epidemiology': 'Epidemiology',
  'statistics in medicine': 'Stat Med', 'research synthesis methods': 'Res Synth Methods', 'systematic reviews': 'Syst Rev',
  'bmc medical research methodology': 'BMC Med Res Methodol', 'trials': 'Trials', 'bmc medicine': 'BMC Med',
  'proceedings of the national academy of sciences of the united states of america': 'Proc Natl Acad Sci U S A', 'journal of clinical investigation': 'J Clin Invest',
  'scientific reports': 'Sci Rep', 'nature communications': 'Nat Commun', 'american journal of public health': 'Am J Public Health',
  'journal of orthopaedic research': 'J Orthop Res', 'clinical orthopaedics and related research': 'Clin Orthop Relat Res', 'journal of arthroplasty': 'J Arthroplasty',
  'american journal of sports medicine': 'Am J Sports Med', 'arthroscopy': 'Arthroscopy', 'knee surgery sports traumatology arthroscopy': 'Knee Surg Sports Traumatol Arthrosc',
  'acta neurochirurgica': 'Acta Neurochir (Wien)', 'neurosurgical focus': 'Neurosurg Focus', 'neurosurgical review': 'Neurosurg Rev', "child's nervous system": 'Childs Nerv Syst',
  'childs nervous system': 'Childs Nerv Syst', 'clinical spine surgery': 'Clin Spine Surg', 'journal of spinal disorders and techniques': 'J Spinal Disord Tech',
  'spinal cord': 'Spinal Cord', 'journal of clinical neuroscience': 'J Clin Neurosci', 'british journal of neurosurgery': 'Br J Neurosurg', 'neurospine': 'Neurospine',
  'asian spine journal': 'Asian Spine J', 'spine deformity': 'Spine Deform', 'pain': 'Pain', 'journal of pain': 'J Pain',
  'journal of the american geriatrics society': 'J Am Geriatr Soc', 'mayo clinic proceedings': 'Mayo Clin Proc', 'cmaj': 'CMAJ',
  'canadian medical association journal': 'CMAJ', 'medical journal of australia': 'Med J Aust', 'annals of emergency medicine': 'Ann Emerg Med',
  'journal of trauma and acute care surgery': 'J Trauma Acute Care Surg', 'injury': 'Injury', 'ophthalmology': 'Ophthalmology',
  'journal of allergy and clinical immunology': 'J Allergy Clin Immunol', 'journal of urology': 'J Urol', 'european urology': 'Eur Urol',
  'human reproduction': 'Hum Reprod', 'fertility and sterility': 'Fertil Steril', 'journal of medical internet research': 'J Med Internet Res', 'elife': 'Elife',
  'medicine baltimore': 'Medicine (Baltimore)', 'cureus': 'Cureus', 'clinical neurology and neurosurgery': 'Clin Neurol Neurosurg', 'neuroradiology': 'Neuroradiology',
  'journal of neurotrauma': 'J Neurotrauma', 'archives of physical medicine and rehabilitation': 'Arch Phys Med Rehabil', 'physical therapy': 'Phys Ther',
  'journal of orthopaedic and sports physical therapy': 'J Orthop Sports Phys Ther', 'hypertension': 'Hypertension',
  'journal of the american heart association': 'J Am Heart Assoc', 'european journal of heart failure': 'Eur J Heart Fail', 'international journal of surgery': 'Int J Surg',
  'journal of the american college of surgeons': 'J Am Coll Surg', 'american journal of medicine': 'Am J Med', 'journal of general internal medicine': 'J Gen Intern Med',
  'archives of disease in childhood': 'Arch Dis Child', 'journal of clinical endocrinology and metabolism': 'J Clin Endocrinol Metab',
};

// ISO 4-style word forms for common words in medical titles. Keys are lower
// case; a word not listed is kept whole, as ISO 4 keeps words it does not list.
const WORDS = {
  academy: 'Acad', acta: 'Acta', addiction: 'Addict', administration: 'Adm', adolescent: 'Adolesc', adolescence: 'Adolesc', advances: 'Adv', advanced: 'Adv',
  african: 'Afr', aging: 'Aging', agricultural: 'Agric', allergy: 'Allergy', alternative: 'Altern', american: 'Am', analysis: 'Anal', analytical: 'Anal',
  anatomy: 'Anat', anaesthesia: 'Anaesth', anesthesia: 'Anesth', anaesthesiology: 'Anaesthesiol', anesthesiology: 'Anesthesiol', analgesia: 'Analg', annals: 'Ann', annual: 'Annu',
  antimicrobial: 'Antimicrob', applied: 'Appl', archives: 'Arch', arthritis: 'Arthritis', asian: 'Asian', association: 'Assoc', australian: 'Aust',
  australasian: 'Australas', bacteriology: 'Bacteriol', behavior: 'Behav', behaviour: 'Behav', behavioral: 'Behav', behavioural: 'Behav', biochemical: 'Biochem',
  biochemistry: 'Biochem', bioinformatics: 'Bioinformatics', biological: 'Biol', biology: 'Biol', biomaterials: 'Biomater', biomechanics: 'Biomech', biomedical: 'Biomed',
  biomedicine: 'Biomed', biophysical: 'Biophys', biotechnology: 'Biotechnol', bone: 'Bone', brazilian: 'Braz', british: 'Br', bulletin: 'Bull', canadian: 'Can',
  cancer: 'Cancer', cardiac: 'Card', cardiology: 'Cardiol', cardiothoracic: 'Cardiothorac', cardiovascular: 'Cardiovasc', care: 'Care', case: 'Case',
  cell: 'Cell', cellular: 'Cell', central: 'Cent', cerebral: 'Cereb', cerebrovascular: 'Cerebrovasc', chemical: 'Chem', chemistry: 'Chem', chemotherapy: 'Chemother',
  chest: 'Chest', child: 'Child', childhood: 'Child', children: 'Child', chinese: 'Chin', chronic: 'Chronic', circulation: 'Circ', clinical: 'Clin', clinics: 'Clin',
  cognitive: 'Cogn', college: 'Coll', communication: 'Commun', communications: 'Commun', community: 'Community', comparative: 'Comp', complementary: 'Complement',
  computational: 'Comput', computer: 'Comput', computing: 'Comput', contemporary: 'Contemp', controlled: 'Control', critical: 'Crit', current: 'Curr',
  dental: 'Dent', dentistry: 'Dent', dermatology: 'Dermatol', dermatological: 'Dermatol', design: 'Des', development: 'Dev', developmental: 'Dev', diabetes: 'Diabetes',
  diagnosis: 'Diagn', diagnostic: 'Diagn', digestive: 'Dig', disease: 'Dis', diseases: 'Dis', disorders: 'Disord', drug: 'Drug', drugs: 'Drugs',
  ecology: 'Ecol', economics: 'Econ', education: 'Educ', educational: 'Educ', electronic: 'Electron', emergency: 'Emerg', endocrine: 'Endocr',
  endocrinology: 'Endocrinol', endoscopy: 'Endosc', engineering: 'Eng', environment: 'Environ', environmental: 'Environ', epidemiology: 'Epidemiol',
  european: 'Eur', evaluation: 'Eval', evidence: 'Evid', evolution: 'Evol', experimental: 'Exp', family: 'Fam', forensic: 'Forensic',
  foundation: 'Found', french: 'Fr', frontiers: 'Front', functional: 'Funct', gastroenterology: 'Gastroenterol', gastrointestinal: 'Gastrointest', general: 'Gen',
  genetics: 'Genet', genetic: 'Genet', genomics: 'Genomics', geriatric: 'Geriatr', geriatrics: 'Geriatr', gerontology: 'Gerontol', german: 'Ger', global: 'Glob',
  gynecology: 'Gynecol', gynaecology: 'Gynaecol', haematology: 'Haematol', hand: 'Hand', head: 'Head', health: 'Health', healthcare: 'Healthc', heart: 'Heart',
  hematology: 'Hematol', hepatology: 'Hepatol', histochemistry: 'Histochem', histology: 'Histol', history: 'Hist', hospital: 'Hosp', human: 'Hum', hygiene: 'Hyg',
  hypertension: 'Hypertens', imaging: 'Imaging', immunology: 'Immunol', indian: 'Indian', infection: 'Infect', infectious: 'Infect', inflammation: 'Inflamm',
  inflammatory: 'Inflamm', informatics: 'Inform', information: 'Inf', injury: 'Inj', institute: 'Inst', intensive: 'Intensive', interdisciplinary: 'Interdiscip',
  internal: 'Intern', international: 'Int', interventional: 'Interv', investigation: 'Invest', investigative: 'Invest', italian: 'Ital', japanese: 'Jpn',
  journal: 'J', journals: 'J', korean: 'Korean', laboratory: 'Lab', laryngology: 'Laryngol', letters: 'Lett', life: 'Life', literature: 'Lit',
  magnetic: 'Magn', management: 'Manag', materials: 'Mater', maternal: 'Matern', mathematical: 'Math', measurement: 'Meas', mechanics: 'Mech', medical: 'Med',
  medicinal: 'Med', medicine: 'Med', mental: 'Ment', metabolic: 'Metab', metabolism: 'Metab', methods: 'Methods', methodology: 'Methodol', microbiology: 'Microbiol',
  minimally: 'Minim', molecular: 'Mol', muscle: 'Muscle', musculoskeletal: 'Musculoskelet', national: 'Natl', natural: 'Nat', nature: 'Nat', neonatal: 'Neonatal',
  nephrology: 'Nephrol', nervous: 'Nerv', network: 'Netw', neural: 'Neural', neurochirurgica: 'Neurochir', neurologic: 'Neurol', neurological: 'Neurol', neurology: 'Neurol',
  neuropathology: 'Neuropathol', neuropsychology: 'Neuropsychol', neuroradiology: 'Neuroradiol', neuroscience: 'Neurosci', neurosciences: 'Neurosci',
  neurosurgery: 'Neurosurg', neurosurgical: 'Neurosurg', neurotrauma: 'Neurotrauma', new: 'New', north: 'North', nuclear: 'Nucl', nursing: 'Nurs', nutrition: 'Nutr',
  obstetrics: 'Obstet', occupational: 'Occup', oncology: 'Oncol', open: 'Open', operative: 'Oper', ophthalmology: 'Ophthalmol', optics: 'Opt', oral: 'Oral',
  orthopaedic: 'Orthop', orthopaedics: 'Orthop', orthopedic: 'Orthop', orthopedics: 'Orthop', otolaryngology: 'Otolaryngol', otology: 'Otol', outcomes: 'Outcomes',
  paediatric: 'Paediatr', paediatrics: 'Paediatr', pain: 'Pain', palliative: 'Palliat', pathology: 'Pathol', patient: 'Patient', pediatric: 'Pediatr',
  pediatrics: 'Pediatr', perinatal: 'Perinat', perinatology: 'Perinatol', pharmaceutical: 'Pharm', pharmacology: 'Pharmacol', pharmacy: 'Pharm', physical: 'Phys',
  physics: 'Phys', physiology: 'Physiol', physiotherapy: 'Physiother', plastic: 'Plast', policy: 'Policy', practice: 'Pract', prevention: 'Prev', preventive: 'Prev',
  primary: 'Prim', proceedings: 'Proc', progress: 'Prog', psychiatric: 'Psychiatr', psychiatry: 'Psychiatry', psychological: 'Psychol', psychology: 'Psychol',
  psychosomatic: 'Psychosom', public: 'Public', pulmonary: 'Pulm', quality: 'Qual', quarterly: 'Q', radiation: 'Radiat', radiological: 'Radiol', radiology: 'Radiol',
  radiotherapy: 'Radiother', reconstructive: 'Reconstr', regional: 'Reg', rehabilitation: 'Rehabil', related: 'Relat', renal: 'Ren', report: 'Rep', reports: 'Rep',
  reproduction: 'Reprod', reproductive: 'Reprod', research: 'Res', resonance: 'Reson', respiratory: 'Respir', review: 'Rev', reviews: 'Rev', rheumatic: 'Rheum',
  rheumatology: 'Rheumatol', risk: 'Risk', royal: 'R', safety: 'Saf', scandinavian: 'Scand', school: 'Sch', science: 'Sci', sciences: 'Sci', scientific: 'Sci',
  seminars: 'Semin', series: 'Ser', services: 'Serv', skeletal: 'Skelet', sleep: 'Sleep', social: 'Soc', society: 'Soc', south: 'S', spinal: 'Spinal', spine: 'Spine',
  sports: 'Sports', statistics: 'Stat', statistical: 'Stat', stem: 'Stem', stereotactic: 'Stereotact', studies: 'Stud', study: 'Stud', supplement: 'Suppl',
  surgeons: 'Surg', surgery: 'Surg', surgical: 'Surg', survey: 'Surv', system: 'Syst', systematic: 'Syst', systems: 'Syst', technical: 'Tech', techniques: 'Tech',
  technology: 'Technol', therapeutic: 'Ther', therapeutics: 'Ther', therapy: 'Ther', thoracic: 'Thorac', thrombosis: 'Thromb', topics: 'Top', toxicology: 'Toxicol',
  translational: 'Transl', transplantation: 'Transplant', trauma: 'Trauma', traumatology: 'Traumatol', treatment: 'Treat', tropical: 'Trop', tumor: 'Tumor',
  ultrasound: 'Ultrasound', university: 'Univ', urology: 'Urol', urological: 'Urol', vascular: 'Vasc', veterinary: 'Vet', virology: 'Virol', world: 'World',
  wound: 'Wound', zoology: 'Zool',
};
const DROP = new Set(['of', 'the', 'and', 'for', 'in', 'on', 'at', 'to', 'by', 'with', 'from', 'a', 'an', '&', 'und', 'der', 'die', 'das', 'de', 'des', 'la', 'le', 'les', 'et', 'y', 'e', 'del', 'di']);
const exactKey = t => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[’]/g, "'")
  .replace(/[.,:;()[\]/]+/g, ' ').replace(/\s+-\s+|\s+–\s+/g, ' ').replace(/^the\s+/, '').replace(/\s+/g, ' ').trim();

/**
 * A journal title shortened: the MEDLINE abbreviation when the title is in
 * the curated table, else ISO 4-style word forms (articles, prepositions and
 * conjunctions dropped; unlisted words kept). A one-word title is kept whole.
 */
export function abbreviate(journalTitle) {
  const title = String(journalTitle || '').replace(/\s+/g, ' ').trim();
  if (!title) return '';
  const k = exactKey(title);
  if (EXACT[k]) return EXACT[k];
  const words = title.replace(/[.,;()]/g, ' ').replace(/:/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0];
  const out = [];
  for (const w of words) {
    const lw = w.toLowerCase().replace(/[’]/g, "'");
    if (DROP.has(lw)) continue;
    if (/-/.test(w) && !WORDS[lw]) { out.push(w.split('-').map(part => WORDS[part.toLowerCase()] || part).join(' ')); continue; }
    out.push(WORDS[lw] || WORDS[lw.replace(/'s$/, 's')] || w);
  }
  return out.join(' ');
}

// ---- formatted reference lists ------------------------------------------------
const NUMBERED = new Set(['vancouver', 'ama']);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tidy = s => s.replace(/\s+/g, ' ').replace(/\.\.+/g, '.').replace(/\s+([,.;:])/g, '$1').replace(/\.\s*\./g, '.').trim();
const REGISTRY = [[/^NCT\d{8}$/i, 'ClinicalTrials.gov'], [/^ISRCTN\d+$/i, 'ISRCTN'], [/^ACTRN\d+$/i, 'ANZCTR'], [/^ChiCTR/i, 'ChiCTR'], [/^DRKS\d+$/i, 'DRKS'], [/^EUCTR/i, 'EU Clinical Trials Register']];
const registryId = p => {
  const m = /\b(NCT\d{8}|ISRCTN\d{8}|ACTRN\d{14}|ChiCTR[\w-]+|DRKS\d{8}|EUCTR[\d-]+)/i.exec([p.accession, p.key, p.url, p.title].filter(Boolean).join(' '));
  return m ? m[1].toUpperCase().replace(/^CHICTR/, 'ChiCTR') : '';
};
const PREPRINT_BY_DOI = [[/^10\.1101\//, ''], [/^10\.21203\/rs/i, 'Research Square'], [/^10\.2139\/ssrn/i, 'SSRN'], [/^10\.48550\/arxiv/i, 'arXiv'], [/^10\.20944\/preprints/i, 'Preprints.org'], [/^10\.31219\/osf/i, 'OSF Preprints']];
const serverOf = p => p.journal || p.publisher || (PREPRINT_BY_DOI.find(([re]) => re.test(p.doi || '')) || [null, ''])[1];
// An organisation as author ("University Hospital Oslo", "COVIDSurg
// Collaborative") is written as it is, never turned into initials.
const ORG = /\b(university|universit[aä]t|hospital|institute|institut|group|consortium|collaborat\w*|investigators|committee|society|association|organi[sz]ation|ministry|department|centre|center|foundation|council|agency|trust|inc|ltd|llc|gmbh|pharma\w*|clinic|network|alliance|board|office|trialists)\b/i;
const person = (n, opts) => !String(n).includes(',') && ORG.test(n) ? String(n).trim() : initials(n, opts);
// Vancouver lists six then "et al"; AMA lists all up to six, else three then "et al".
const vanAuthors = names => { const a = names.map(n => person(n)); return a.length > 6 ? `${a.slice(0, 6).join(', ')}, et al` : a.join(', '); };
const amaAuthors = names => { const a = names.map(n => person(n)); return a.length > 6 ? `${a.slice(0, 3).join(', ')}, et al` : a.join(', '); };
const apaAuthors = names => {
  const a = names.map(n => person(n, { comma: true, dots: true }));
  if (a.length <= 1) return a[0] || '';
  if (a.length <= 20) return `${a.slice(0, -1).join(', ')}, & ${a.at(-1)}`;
  return `${a.slice(0, 19).join(', ')}, … ${a.at(-1)}`;
};
const harvardAuthors = names => {
  const a = names.map(n => person(n, { comma: true, dots: true }));
  if (a.length <= 1) return a[0] || '';
  if (a.length > 3) return `${a[0]} et al.`;
  return `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`;
};
const edsOf = p => authorList(p.editors || []);
const I = t => `\u0001${t}\u0002`;   // italic span markers, rendered per output format
const place = p => [p.place, p.publisher].filter(Boolean).join(': ');

/** One non-article reference (book, chapter, preprint, registration) in a style, with italic spans marked. */
function formatOther(p, style, type) {
  const names = authorList(p.authors), y = p.year ? String(p.year) : '';
  const doiUrl = p.doi ? `https://doi.org/${p.doi}` : '';
  const vanDoi = p.doi ? `doi:${p.doi}` : '';
  const title = String(p.title || '').replace(/[.]+$/, '');
  const eds = edsOf(p);
  const van = style === 'vancouver', ama = style === 'ama', apa = style === 'apa';
  const au = van ? vanAuthors(names) : ama ? amaAuthors(names) : apa ? apaAuthors(names) : harvardAuthors(names);
  if (type === 'book') {
    if (van) return tidy(`${au ? `${au}. ` : ''}${title}. ${place(p) ? `${place(p)}; ` : ''}${y}.${vanDoi ? ` ${vanDoi}` : ''}`);
    if (ama) return tidy(`${au ? `${au}. ` : ''}${I(title)}. ${p.publisher ? `${p.publisher}; ` : ''}${y}.${vanDoi ? ` ${vanDoi}` : ''}`);
    if (apa) return tidy(`${au ? `${au} ` : ''}${y ? `(${y}). ` : ''}${I(title)}. ${p.publisher ? `${p.publisher}. ` : ''}${doiUrl}`);
    return tidy(`${au ? `${au} ` : ''}${y ? `(${y}) ` : ''}${I(title)}. ${place(p) ? `${place(p)}.` : ''}${vanDoi ? ` ${vanDoi}` : ''}`);
  }
  if (type === 'chapter') {
    const book = p.journal || p.bookTitle || '';
    const e = eds.map(n => initials(n));
    if (van) return tidy(`${au ? `${au}. ` : ''}${title}. In: ${e.length ? `${e.join(', ')}, editor${e.length > 1 ? 's' : ''}. ` : ''}${book}. ${place(p) ? `${place(p)}; ` : ''}${y}.${p.pages ? ` p. ${p.pages}.` : ''}${vanDoi ? ` ${vanDoi}` : ''}`);
    if (ama) return tidy(`${au ? `${au}. ` : ''}${title}. In: ${e.length ? `${e.join(', ')}, ed${e.length > 1 ? 's' : ''}. ` : ''}${I(book)}. ${p.publisher ? `${p.publisher}; ` : ''}${y}${p.pages ? `:${p.pages}` : ''}.${vanDoi ? ` ${vanDoi}` : ''}`);
    const ea = eds.map(n => { const [fam, given] = initials(n, { comma: true, dots: true }).split(', '); return `${given ? `${given} ` : ''}${fam}`; });
    if (apa) return tidy(`${au ? `${au} ` : ''}${y ? `(${y}). ` : ''}${title}. In ${ea.length ? `${ea.join(', ')} (${ea.length > 1 ? 'Eds.' : 'Ed.'}), ` : ''}${I(book)}${p.pages ? ` (pp. ${p.pages})` : ''}. ${p.publisher ? `${p.publisher}. ` : ''}${doiUrl}`);
    return tidy(`${au ? `${au} ` : ''}${y ? `(${y}) ` : ''}'${title}', in ${ea.length ? `${ea.join(', ')} (${ea.length > 1 ? 'eds.' : 'ed.'}) ` : ''}${I(book)}. ${place(p) ? `${place(p)}` : ''}${p.pages ? `, pp. ${p.pages}` : ''}.${vanDoi ? ` ${vanDoi}` : ''}`);
  }
  if (type === 'preprint') {
    const server = serverOf(p);
    if (van) return tidy(`${au ? `${au}. ` : ''}${title} [Preprint]. ${server ? `${server}. ` : ''}${y}.${vanDoi ? ` ${vanDoi}` : ''}`);
    // AMA ends on the DOI without a full stop
    if (ama) return tidy([au, title, server && I(server), y ? `Preprint posted online ${y}` : 'Preprint'].filter(Boolean).join('. ') + (vanDoi ? `. ${vanDoi}` : '.'));
    if (apa) return tidy(`${au ? `${au} ` : ''}${y ? `(${y}). ` : ''}${I(title)} [Preprint]. ${server ? `${server}. ` : ''}${doiUrl}`);
    return tidy(`${au ? `${au} ` : ''}${y ? `(${y}) ` : ''}'${title}'. [Preprint]. ${server ? `${I(server)}. ` : ''}${vanDoi}`);
  }
  // trial registration
  const id = registryId(p);
  const reg = (REGISTRY.find(([re]) => re.test(id)) || [null, p.journal || 'Trial register'])[1];
  const url = p.url || (/^NCT/.test(id) ? `https://clinicaltrials.gov/study/${id}` : '');
  if (van) return tidy(`${au ? `${au}. ` : ''}${title}. ${reg}${id ? ` identifier: ${id}` : ''}. ${y ? `${y}. ` : ''}${url ? `Available from: ${url}` : ''}`);
  if (ama) return tidy(`${title}. ${reg}${id ? ` identifier: ${id}` : ''}. ${y ? `Registered ${y}. ` : ''}${url}`);
  if (apa) return tidy(`${au ? `${au} ` : ''}${y ? `(${y}). ` : ''}${I(title)}${id ? ` (${reg} Identifier ${id})` : ''}. ${url}`);
  return tidy(`${au ? `${au} ` : ''}${y ? `(${y}) ` : ''}${I(title)}. ${reg}${id ? ` identifier ${id}` : ''}. ${url ? `Available at: ${url}` : ''}`);
}

/** A journal article in a style, by lib/cite.mjs, with the journal (and APA's volume) marked italic where the style italicises it. */
function formatArticle(p, style) {
  const q = { ...p };
  if (NUMBERED.has(style) && q.journal) q.journal = q.journalAbbr || abbreviate(q.journal);
  let s = formatReference(q, style).replace(/\*([^*]+)\*/g, (m, t) => I(t));
  if (q.journal && (style === 'apa' || style === 'harvard' || style === 'ama')) {
    const at = s.lastIndexOf(q.journal);
    if (at >= 0) s = s.slice(0, at) + I(q.journal) + s.slice(at + q.journal.length);
  }
  return s;
}

/** One reference in a style ('vancouver', 'ama', 'apa', 'harvard'), with italic spans marked. */
function formatOne(p, style) {
  const type = normaliseType(p);
  return ['book', 'chapter', 'preprint', 'trial-registration'].includes(type) ? formatOther(p, style, type) : formatArticle(p, style);
}

const render = (s, format) => format === 'html'
  ? esc(s).replace(/\u0001([^\u0002]*)\u0002/g, '<i>$1</i>').replace(/(https?:\/\/[^\s<]+[^\s<.,;])/g, '<a href="$1">$1</a>')
  : format === 'markdown'
    ? s.replace(/([*_`\\])/g, '\\$1').replace(/\u0001([^\u0002]*)\u0002/g, '*$1*')
    : s.replace(/[\u0001\u0002]/g, '');

/**
 * A reference list in a style: numbered in the order given (Vancouver, AMA),
 * or alphabetical by first author then year (APA, Harvard). Journal articles
 * are formatted by lib/cite.mjs formatReference, as the manuscript is;
 * books, chapters, preprints and trial registrations by the forms above.
 * Vancouver and AMA use the record's journal abbreviation, else abbreviate().
 * `format`: 'text' (one per line), 'html' (<ol> or <div> of <p>), 'markdown'.
 */
export function formattedBibliography(papers, style = 'vancouver', { format = 'text' } = {}) {
  const st = ['vancouver', 'ama', 'apa', 'harvard'].includes(style) ? style : 'vancouver';
  const list = [...(papers || [])];
  const numbered = NUMBERED.has(st);
  if (!numbered) {
    const sortKey = p => `${(authorList(p.authors)[0] ? person(authorList(p.authors)[0], { comma: true }) : String(p.title || '')).toLowerCase()}\u0000${p.year || ''}\u0000${String(p.title || '').toLowerCase()}`;
    list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }
  const refs = list.map(p => render(formatOne(p, st), format));
  if (format === 'html') {
    return numbered ? `<ol class="bibliography">${refs.map(r => `<li>${r}</li>`).join('')}</ol>`
      : `<div class="bibliography">${refs.map(r => `<p>${r}</p>`).join('')}</div>`;
  }
  if (format === 'markdown') return refs.map((r, i) => numbered ? `${i + 1}. ${r}` : r).join(numbered ? '\n' : '\n\n') + '\n';
  return refs.map((r, i) => numbered ? `${i + 1}. ${r}` : r).join('\n') + '\n';
}
