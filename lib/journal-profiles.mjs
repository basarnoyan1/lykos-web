// Journal profiles: the limits and requirements a manuscript is checked
// against before submission (lib/submission-checks.mjs).
//
// A named journal's limits are stored here only when its instructions for
// authors were read, with the page and the date (JOURNAL_PROFILES). They
// change without notice, so any other named journal's profile is built by the author: typed in
// (`customProfile`) or read from instructions pasted from the journal's site
// (`profileFromText`), with the sentence each value came from kept beside it.
// The generic profiles below are defined by reporting conventions, not by any
// journal: they carry the abstract headings and statements the convention
// asks for, and no word, reference or figure limits, because a convention
// does not set them. `source.checked` is null on every built-in profile: the
// URL names where the convention is published, not a page read on a date.
//
// Pure data and text: nothing here imports the store or a view. The table loads with the first view or check that reads a profile, not with the
// shell: the store keeps only the stored choice (lib/journal-profile-state.mjs, whose PROFILE_IDS must list this table's ids).

import { lib_manuscript$blankBlock as blankBlock } from "../boot.mjs";
import { lib_journal_profile_state$normalizeJournalProfile as normalizeJournalProfile } from "../boot.mjs";

export const REFERENCE_STYLES = ['vancouver', 'ama', 'apa', 'harvard', 'nlm'];

/** Statements a journal may require, by key, with the headings they go under. */
export const REQUIREMENTS = [
  { id: 'coi', label: 'Conflicts of interest' },
  { id: 'funding', label: 'Funding' },
  { id: 'dataAvailability', label: 'Data availability' },
  { id: 'ethics', label: 'Ethics approval' },
  { id: 'consent', label: 'Patient consent' },
  { id: 'registration', label: 'Registration' },
  { id: 'credit', label: 'Author contributions' },
  { id: 'orcid', label: 'ORCID iDs' },
];
const REQUIREMENT_IDS = new Set(REQUIREMENTS.map(r => r.id));

// ---- structured abstracts --------------------------------------------------
//
// Each set lists the headings an abstract is written under and, where the
// convention itemises more than it heads, what each heading covers. The
// headings are the ones the convention names; `aliases` are the other names
// journals commonly print for the same part, used when checking an abstract.

export const STRUCTURED_ABSTRACTS = {
  imrad: {
    id: 'imrad', label: 'IMRaD',
    headings: ['Background', 'Methods', 'Results', 'Conclusions'],
    aliases: { Background: ['Introduction', 'Objective', 'Objectives', 'Aim', 'Aims', 'Purpose', 'Context'], Methods: ['Materials and methods', 'Patients and methods', 'Design'], Results: ['Findings'], Conclusions: ['Conclusion', 'Interpretation'] },
    source: { name: 'Common four-heading form', url: null },
  },
  haynes: {
    id: 'haynes', label: 'Eight-heading (Haynes et al. 1990)',
    // The classic 1990 form ("More informative abstracts revisited", Ann Intern
    // Med 1990). Journals that still use it have often adapted it since.
    classic: true,
    headings: ['Objective', 'Design', 'Setting', 'Participants', 'Interventions', 'Measurements', 'Results', 'Conclusion'],
    aliases: { Objective: ['Objectives'], Participants: ['Patients', 'Subjects'], Interventions: ['Intervention'], Measurements: ['Main outcome measures', 'Main outcomes and measures', 'Outcome measures'], Conclusion: ['Conclusions'] },
    source: { name: 'Haynes RB, Mulrow CD, Huth EJ, Altman DG, Gardner MJ. More informative abstracts revisited. Ann Intern Med. 1990', url: null },
  },
  consort: {
    id: 'consort', label: 'CONSORT for Abstracts',
    // CONSORT for Abstracts itemises rather than prescribes headings; these are
    // its groups, with the items each covers.
    headings: ['Trial design', 'Methods', 'Results', 'Conclusions', 'Trial registration', 'Funding'],
    covers: {
      Methods: ['Participants', 'Interventions', 'Objective', 'Outcome', 'Randomisation', 'Blinding'],
      Results: ['Numbers randomised', 'Recruitment', 'Numbers analysed', 'Outcome', 'Harms'],
    },
    aliases: { 'Trial design': ['Design', 'Background'], Conclusions: ['Conclusion', 'Interpretation'], 'Trial registration': ['Registration'] },
    source: { name: 'CONSORT for Abstracts (Hopewell et al. 2008); CONSORT 2025 revised the main checklist, so check the items against the current version', url: 'https://www.equator-network.org/' },
  },
  prisma: {
    id: 'prisma', label: 'PRISMA 2020 for Abstracts',
    headings: ['Background', 'Methods', 'Results', 'Discussion', 'Funding', 'Registration'],
    covers: {
      Background: ['Objectives'],
      Methods: ['Eligibility criteria', 'Information sources', 'Risk of bias', 'Synthesis of results'],
      Results: ['Included studies', 'Synthesis of results'],
      Discussion: ['Limitations of evidence', 'Interpretation'],
    },
    aliases: { Background: ['Objective', 'Objectives', 'Introduction'], Discussion: ['Conclusions', 'Conclusion', 'Interpretation'], Registration: ['Protocol registration', 'Systematic review registration', 'PROSPERO registration'] },
    source: { name: 'PRISMA 2020 for Abstracts (Page et al. 2021)', url: 'https://www.prisma-statement.org/' },
  },
  care: {
    id: 'care', label: 'CARE',
    // CARE item 3: what is unique, the main symptoms and findings, the main
    // diagnoses, interventions and outcomes, and the take-away lesson. The
    // headings match the case report starter in lib/manuscript.mjs.
    headings: ['Introduction', 'Case presentation', 'Conclusions'],
    covers: {
      Introduction: ['What is unique about the case'],
      'Case presentation': ['Main symptoms and clinical findings', 'Main diagnoses, interventions and outcomes'],
      Conclusions: ['The main take-away lesson'],
    },
    aliases: { Introduction: ['Background'], 'Case presentation': ['Case report', 'Case description', 'Case summary'], Conclusions: ['Conclusion'] },
    source: { name: 'CARE guidelines (Gagnier et al. 2013)', url: 'https://www.care-statement.org/' },
  },
};

/** Every name an abstract heading goes by in the sets above, lower-cased, keyed by the heading. */
export function headingNames(heading) {
  const out = new Set([String(heading).toLowerCase()]);
  for (const set of Object.values(STRUCTURED_ABSTRACTS))
    for (const [h, as] of Object.entries(set.aliases || {}))
      if (h.toLowerCase() === String(heading).toLowerCase()) for (const a of as) out.add(a.toLowerCase());
  return [...out];
}

/**
 * The blocks to insert for a profile's structured abstract: an Abstract
 * heading, then a subheading and an empty paragraph per abstract heading.
 * An unstructured abstract is the heading and one paragraph.
 */
export function abstractTemplate(profile, { withHeading = true } = {}) {
  const heads = profile?.abstractStructured && profile.abstractHeadings?.length ? profile.abstractHeadings : [];
  return [
    ...(withHeading ? [blankBlock('h2', 'Abstract')] : []),
    ...(heads.length ? heads.flatMap(h => [blankBlock('h3', h), blankBlock('p', '')]) : [blankBlock('p', '')]),
  ];
}

// ---- profiles --------------------------------------------------------------

const DEFAULT_NOTE = 'Set word, abstract, reference and figure limits from the journal’s instructions for authors.';

/** Profiles defined by reporting conventions, not by a journal. No limits are set. */
export const GENERIC_PROFILES = [
  { id: 'imrad-original', name: 'Original article (IMRaD)', abstractStructured: true, abstractHeadings: [...STRUCTURED_ABSTRACTS.imrad.headings],
    referenceStyle: 'vancouver', requires: ['coi', 'funding', 'ethics', 'dataAvailability', 'credit'],
    notes: `A structured Background, Methods, Results, Conclusions abstract. The statements are those ICMJE recommends disclosing; the reference style is a default. ${DEFAULT_NOTE}`,
    source: { url: 'https://www.icmje.org/recommendations/', checked: null } },
  { id: 'consort-abstract', name: 'Randomised trial (CONSORT abstract)', abstractStructured: true, abstractHeadings: [...STRUCTURED_ABSTRACTS.consort.headings],
    referenceStyle: 'vancouver', requires: ['registration', 'funding', 'coi', 'ethics', 'dataAvailability', 'credit'],
    notes: `Abstract grouped as CONSORT for Abstracts itemises it; CONSORT asks for trial registration and funding. ${DEFAULT_NOTE}`,
    source: { url: STRUCTURED_ABSTRACTS.consort.source.url, checked: null } },
  { id: 'prisma-abstract', name: 'Systematic review (PRISMA 2020 abstract)', abstractStructured: true, abstractHeadings: [...STRUCTURED_ABSTRACTS.prisma.headings],
    referenceStyle: 'vancouver', requires: ['registration', 'funding', 'coi', 'dataAvailability', 'credit'],
    notes: `Abstract as PRISMA 2020 for Abstracts groups it; PRISMA 2020 asks for registration, support, competing interests and data availability. ${DEFAULT_NOTE}`,
    source: { url: STRUCTURED_ABSTRACTS.prisma.source.url, checked: null } },
  { id: 'case-report', name: 'Case report (CARE abstract)', abstractStructured: true, abstractHeadings: [...STRUCTURED_ABSTRACTS.care.headings],
    referenceStyle: 'vancouver', requires: ['consent', 'coi', 'funding', 'credit'],
    notes: `Abstract in the three parts of CARE item 3; CARE asks for the patient’s informed consent. ${DEFAULT_NOTE}`,
    source: { url: STRUCTURED_ABSTRACTS.care.source.url, checked: null } },
  { id: 'letter', name: 'Letter', abstractStructured: false, abstractHeadings: null,
    referenceStyle: 'vancouver', requires: ['coi'],
    notes: `Many journals publish letters without an abstract. ${DEFAULT_NOTE}`,
    source: { url: null, checked: null } },
];

/**
 * Profiles for a named journal, with the limits its instructions for authors
 * state. An entry is added only from instructions that were read, with
 * `source: { url, checked }` naming the page and the date (and
 * validateProfile holds it to that). A preset (lib/journal-presets.mjs) may
 * name one by `profile`.
 */
export const JOURNAL_PROFILES = [
  // Neurology (AAN), Research Article, which includes systematic reviews and meta-analyses. Read 2026-10-30.
  { id: 'neurology-research-article', name: 'Neurology research article', publisher: 'American Academy of Neurology',
    wordLimit: 4500, abstractLimit: 350, referenceLimit: 50, figureTableLimit: 7, titleLimitChars: 140,
    abstractStructured: true, abstractHeadings: ['Background and Objectives', 'Methods', 'Results', 'Discussion'],
    referenceStyle: 'ama', requires: ['coi', 'funding', 'ethics', 'consent', 'dataAvailability'],
    notes: 'Words exclude the abstract, tables, figure legends, appendices and references. A Trial Registration Information heading closes the abstract of a clinical trial. Figures and tables count together. No figure file format or resolution is stated.',
    source: { url: 'https://www.neurology.org/neurology-journals-author-center', checked: '2026-10-30' } },
  // Read from each journal's instructions for authors on 2026-11-07 (plan W4; the journals the group has published in, from PubMed),
  // the main research article type. A value the page did not state is absent.
  {id: "turk-neurosurg-original-investigation", name: "Turkish Neurosurgery original investigation", publisher: "Turkish Neurosurgical Society", wordLimit: 4500, abstractLimit: 300, abstractStructured: true, abstractHeadings: ["Aim", "Material and Methods", "Results", "Conclusion"], referenceStyle: "vancouver", requires: ["coi", "ethics", "consent", "credit", "orcid"], notes: "Main text excludes references, tables and figure legends; no limit on figures, tables or references. References cited in text alphabetically within parentheses, DOI mandatory, all authors listed. Figures JPG/PNG/JPEG/WEBP, color 300 dpi, black-and-white 600 dpi; running head 3-5 words. Keywords from MeSH, number not stated.", source: {url: "https://turkishneurosurgery.org.tr/InstructionstoAuthors", checked: "2026-11-07"}},
  {id: "ijss-original-research", name: "International Journal of Spine Surgery original research", publisher: "International Society for the Advancement of Spine Surgery", wordLimit: 4000, abstractLimit: 350, referenceLimit: 40, abstractStructured: true, abstractHeadings: ["Background", "Methods", "Results", "Conclusions", "Clinical Relevance", "Level of Evidence"], referenceStyle: "ama", requires: ["coi", "funding", "ethics", "consent"], notes: "Abstract limit 350 words unless otherwise noted. Figures TIFF or EPS as separate files, 300 dpi; total submission 20 MB. No figure or table limit stated for Original Research.", source: {url: "https://www.ijssurgery.com/page/author-instructions", checked: "2026-11-07"}},
  {id: "ulus-travma-acil-cerrahi-derg-research-article", name: "Turkish Journal of Trauma and Emergency Surgery research article", publisher: "Turkish Association of Trauma and Emergency Surgery", abstractLimit: 400, abstractStructured: true, abstractHeadings: ["Background", "Methods", "Results", "Conclusions"], referenceStyle: "vancouver", requires: ["coi", "ethics", "consent"], notes: "Page states no word, reference, figure or keyword limits. Lists all authors if six or fewer, otherwise first six plus et al. Copyright transfer form and ICMJE COI form required.", source: {url: "https://tjtes.org/Information_to_authors", checked: "2026-11-07"}},
  {id: "neurosurg-rev-original-article", name: "Neurosurgical Review original article", publisher: "Springer Nature", abstractLimit: 250, keywords: {min: 4, max: 6}, abstractStructured: false, abstractHeadings: null, referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "dataAvailability", "credit"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. Abstract 150 to 250 words; no word limit stated for research articles (4,000 words applies to Systematic Reviews). Numbered brackets, list alphabetized by first author then numbered; EQUATOR checklist and flow diagrams required. Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies.", source: {url: "https://link.springer.com/journal/10143/submission-guidelines", checked: "2026-11-07"}},
  {id: "jno-research-article", name: "Journal of Neuro-Oncology research article", publisher: "Springer Nature", wordLimit: 3000, abstractLimit: 250, referenceLimit: 50, figureTableLimit: 5, keywords: {min: 4, max: 6}, abstractStructured: true, abstractHeadings: ["Purpose", "Methods", "Results", "Conclusion"], referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "dataAvailability", "orcid", "registration"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. ORCID required for the corresponding author; author contributions encouraged, not required. Trial registration number and date go on the last line of the abstract (prospective phase II to IV). Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies.", source: {url: "https://link.springer.com/journal/11060/submission-guidelines", checked: "2026-11-07"}},
  {id: "acta-neurochir-original-research-article", name: "Acta Neurochirurgica original research article", publisher: "Springer Nature", abstractLimit: 250, keywords: {min: 4, max: 6}, abstractStructured: true, abstractHeadings: ["Background", "Method", "Results", "Conclusions"], referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "dataAvailability", "registration"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. The page conflicts: one section allows an abstract of up to 300 words (Background, Method, Results, Conclusions), the title page section asks for 150 to 250 words (Purpose, Methods, Results, Conclusion). No word limit stated; reference list alphabetical in the text. Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies.", source: {url: "https://link.springer.com/journal/701/submission-guidelines", checked: "2026-11-07"}},
  {id: "eur-spine-j-original-article", name: "European Spine Journal original article", publisher: "Springer Nature", wordLimit: 2500, abstractLimit: 250, referenceLimit: 25, keywords: {min: 4, max: 6}, abstractStructured: true, abstractHeadings: ["Purpose", "Methods", "Results", "Conclusion"], referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "dataAvailability", "registration"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. Abstract 150 to 250 words, may be extended to up to 450 words if the topic requires it. Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies.", source: {url: "https://link.springer.com/journal/586/submission-guidelines", checked: "2026-11-07"}},
  {id: "j-neurol-original-communication", name: "Journal of Neurology original communication", publisher: "Springer Nature", wordLimit: 9000, abstractLimit: 250, keywords: {min: 4, max: 6}, abstractStructured: false, abstractHeadings: null, referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "registration"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. Words exclude abstract, keywords, figures, tables, captions and references. Abstract 150 to 250 words. Data availability statement not stated as required. Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies.", source: {url: "https://link.springer.com/journal/415/submission-guidelines", checked: "2026-11-07"}},
  {id: "childs-nerv-syst-original-research-article", name: "Child's Nervous System original research article", publisher: "Springer Nature", wordLimit: 3000, abstractLimit: 250, referenceLimit: 50, abstractStructured: true, abstractHeadings: ["Purpose", "Methods", "Results", "Conclusion"], referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "dataAvailability", "registration"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. Figures and tables: 6 to 8 combined; at most 8 authors unless multicenter. Keywords conflict on the page (up to 4 versus 4 to 6), so left null. Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies.", source: {url: "https://link.springer.com/journal/381/submission-guidelines", checked: "2026-11-07"}},
  {id: "clin-exp-metastasis-research-article", name: "Clinical & Experimental Metastasis research article", publisher: "Springer Nature", abstractLimit: 250, keywords: {min: 4, max: 6}, abstractStructured: false, abstractHeadings: null, referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "dataAvailability", "registration"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. The page states no restriction on text length or number of figures; abstract 150 to 250 words. Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies.", source: {url: "https://link.springer.com/journal/10585/submission-guidelines", checked: "2026-11-07"}},
  {id: "pituitary-research-article", name: "Pituitary research article", publisher: "Springer Nature", wordLimit: 4000, abstractLimit: 250, referenceLimit: 60, figureTableLimit: 5, keywords: {min: 4, max: 6}, abstractStructured: true, abstractHeadings: ["Purpose", "Methods", "Results", "Conclusion"], referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "dataAvailability", "registration"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. Abstract 150 to 250 words; maximum 5 figures and tables combined. Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies.", source: {url: "https://link.springer.com/journal/11102/submission-guidelines", checked: "2026-11-07"}},
  {id: "neuroradiology-research", name: "Neuroradiology research", publisher: "Springer Nature", abstractLimit: 250, keywords: {min: 4, max: 6}, abstractStructured: true, abstractHeadings: ["Purpose", "Methods", "Results", "Conclusion"], referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "dataAvailability", "registration"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. Double-blind review: remove author identities from manuscript, figures and supplements. No word, reference or figure limit stated. Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies.", source: {url: "https://link.springer.com/journal/234/submission-guidelines", checked: "2026-11-07"}},
  {id: "spine-deformity-original-article", name: "Spine Deformity original article", publisher: "Springer Nature", wordLimit: 2700, abstractLimit: 250, keywords: {min: 4, max: 6}, abstractStructured: true, abstractHeadings: ["Purpose", "Methods", "Results", "Conclusion"], referenceStyle: "ama", requires: ["coi", "funding", "ethics", "consent", "registration"], notes: "Manuscript style follows the AMA Manual of Style (10th ed.); numbered in square brackets. Words exclude abstract and references. Data availability is listed among Declarations without required wording. Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies.", source: {url: "https://link.springer.com/journal/43390/submission-guidelines", checked: "2026-11-07"}},
  {id: "indian-j-orthop-original-article", name: "Indian Journal of Orthopaedics original article", publisher: "Springer Nature", wordLimit: 4000, abstractLimit: 250, referenceLimit: 30, figureTableLimit: 6, abstractStructured: true, abstractHeadings: ["Background", "Methods", "Results", "Conclusion"], referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "registration"], notes: "The 4,000-word limit includes references; numbered NLM style, bracket or superscript form not stated. Keywords conflict on the page (10 versus 4 to 6), so left null. Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies.", source: {url: "https://link.springer.com/journal/43465/submission-guidelines", checked: "2026-11-07"}},
  {id: "nat-commun-article", name: "Nature Communications article", publisher: "Springer Nature", wordLimit: 5000, abstractLimit: 200, referenceLimit: 70, figureTableLimit: 10, abstractStructured: false, abstractHeadings: null, referenceStyle: "vancouver", requires: ["coi", "credit"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. Ideally 5,000 words excluding abstract, methods, references and figure legends; references about 70 as a guide. Up to 10 display items; articles under 2,000 words no more than 4. Title up to 15 words, legends up to 350 words.", source: {url: "https://www.nature.com/ncomms/submit/article", checked: "2026-11-07"}},
  {id: "sci-rep-article", name: "Scientific Reports article", publisher: "Springer Nature", wordLimit: 4500, abstractLimit: 200, referenceLimit: 60, figureTableLimit: 8, keywords: {min: null, max: 6}, abstractStructured: false, abstractHeadings: null, referenceStyle: "vancouver", requires: ["coi", "funding", "dataAvailability", "credit", "ethics", "consent"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. Words exclude abstract, methods, references and legends; references 60 though not strictly enforced. Abstract unstructured with no references; Nature reference style, numbered in square brackets.", source: {url: "https://www.nature.com/srep/author-instructions/submission-guidelines", checked: "2026-11-07"}},
  {id: "neuro-onc-basic-translational-and-clinical-investigations", name: "Neuro-Oncology basic/translational and clinical investigations", publisher: "Oxford University Press", wordLimit: 5000, abstractLimit: 250, referenceLimit: 50, figureTableLimit: 6, titleLimitChars: 160, runningTitleChars: 50, keywords: {min: null, max: 5}, abstractStructured: true, abstractHeadings: ["Background", "Methods", "Results", "Conclusions"], referenceStyle: "ama", requires: ["ethics", "consent", "funding", "coi", "credit", "dataAvailability"], notes: "Text body from Introduction through Discussion excludes references, legends and tables. Also requires Key Points (2-3 bullets), Importance of the Study (150 words) and Lay Summary (100 words) 600 dpi applies to bitmaps; vector preferred; alt text required for figures. The page says more than 50 references allowed only if absolutely necessary.", source: {url: "https://academic.oup.com/neuro-oncology/pages/General_Instructions", checked: "2026-11-07"}},
  {id: "plos-one-research-article", name: "PLOS ONE research article", publisher: "PLOS", abstractLimit: 300, titleLimitChars: 250, abstractStructured: false, abstractHeadings: null, referenceStyle: "vancouver", requires: ["coi", "funding", "dataAvailability", "ethics", "consent", "registration", "credit", "orcid"], notes: "No word limit, figure limit or supporting information limit. Short title up to 100 characters; clinical trial registry number goes in the abstract. Figure formats, resolution and widths are on a separate Figures page, not read. Funding and competing interests are entered in the submission system; CRediT roles per author, ORCID for the corresponding author.", source: {url: "https://journals.plos.org/plosone/s/submission-guidelines", checked: "2026-11-07"}},
  {id: "brain-original-article", name: "Brain original article", publisher: "Oxford University Press", wordLimit: 6000, abstractLimit: 400, figureTableLimit: 8, titleLimitChars: 100, runningTitleChars: 40, keywords: {min: null, max: 6}, abstractStructured: true, abstractHeadings: ["Background", "Methods", "Results", "Conclusion"], referenceStyle: "ama", requires: ["dataAvailability", "funding", "coi", "consent", "ethics", "orcid"], notes: "Main text excludes abstract, title page, tables, legends and references; no reference limit. Abstract sections start on new lines with no subtitles; 8 display items maximum. 600 dpi for black-and-white line art; alt text required for figures. Reporting guideline checklist and signed Declaration of Authorship required.", source: {url: "https://academic.oup.com/brain/pages/General_Instructions", checked: "2026-11-07"}},
  {id: "oncogene-article", name: "Oncogene article", publisher: "Springer Nature", wordLimit: 4500, abstractLimit: 200, referenceLimit: 80, figureTableLimit: 8, titleLimitChars: 150, abstractStructured: false, abstractHeadings: null, referenceStyle: "vancouver", requires: ["coi", "funding", "dataAvailability", "credit"], notes: "Word limit covers the main body only (excludes abstract, tables/figures, references); a composite figure of more than three parts counts as two figures. Unstructured abstract; a Plain Language Summary of about 120 words is required at revision, for original articles only. Page charge of GBP 158 / USD 243 per page, not applied if the open access fee is paid. References are numbered in order of citation, written (ref. X) beside a number; all authors are listed up to six, otherwise the first six and et al.", source: {url: "https://www.nature.com/onc/authors-and-referees/gta", checked: "2026-11-07"}},
  {id: "noro-psikiyatr-ars-original-article", name: "Archives of Neuropsychiatry original article", publisher: "Turkish Neuropsychiatric Association", wordLimit: 4000, abstractLimit: 300, referenceLimit: 30, runningTitleChars: 50, keywords: {min: 3, max: 6}, abstractStructured: true, abstractHeadings: ["Introduction", "Methods", "Results", "Conclusion"], referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "registration", "credit"], notes: "Tables are limited to 6 and figures to 10 for original articles. The abstract limit is stated as 250-300 words; 3 to 5 highlights of at most 85 characters are required. Figures go in separate files of at least 100 x 100 mm, with subunits not labeled a, b, c. An article processing charge of USD 750 applies to accepted manuscripts from 1 August 2026.", source: {url: "https://www.noropsikiyatriarsivi.com/en_yazarlaraBilgi", checked: "2026-11-07"}},
  {id: "surg-neurol-int-original-article", name: "Surgical Neurology International original article", publisher: "Scientific Scholar", abstractLimit: 250, keywords: {min: null, max: 6}, abstractStructured: true, abstractHeadings: ["Background", "Methods", "Results", "Conclusion"], referenceStyle: "vancouver", requires: ["coi", "ethics"], notes: "The HTML page states no word, reference, table or figure limits; a full PDF version is linked. Original and review articles may list up to 10 authors, other types up to 6. References are listed alphabetically; in-text numerals are superscript with a square bracket after punctuation. Accepted original and review articles pay a publication fee of USD 465.", source: {url: "https://surgicalneurologyint.com/pages/instructions-for-authors", checked: "2026-11-07"}},
  {id: "diagn-interv-radiol-original-article", name: "Diagnostic and Interventional Radiology original article", publisher: "Turkish Society of Radiology", wordLimit: 4500, abstractLimit: 400, referenceLimit: 50, abstractStructured: true, abstractHeadings: ["Purpose", "Methods", "Results", "Conclusion", "Clinical significance"], referenceStyle: "ama", requires: ["coi", "funding", "ethics", "consent"], notes: "Tables are limited to 4 and figures to 7 (or 15 figure parts); Figure 1 is the study flowchart. 3 to 5 main points go between the abstract and the introduction. Clinical trials also need a registry number and a data sharing statement. Accepted original articles pay an article processing charge of USD 1000.", source: {url: "https://www.dirjournal.org/instructions-to-authors", checked: "2026-11-07"}},
  {id: "asian-spine-j-original-article", name: "Asian Spine Journal original article", publisher: "Korean Society of Spine Surgery / M2PI", wordLimit: 3000, abstractLimit: 300, referenceLimit: 30, figureTableLimit: 8, keywords: {min: null, max: 5}, abstractStructured: true, abstractHeadings: ["Study design", "Purpose", "Overview of literature", "Methods", "Results", "Conclusions"], referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "credit"], notes: "Words include the structured abstract, text and figure legends; title page, references and tables are excluded. Figures: JPG, GIF or PPT at submission, TIFF or EPS once accepted; 600 dpi for color and grayscale, 1,200 dpi for line art. 3 to 5 key points are required; trials need registration; raw data go to a public repository after acceptance. There is no article processing charge.", source: {url: "https://www.asianspinejournal.org/authors/authors.php", checked: "2026-11-07"}},
  {id: "curr-drug-targets-research-article", name: "Current Drug Targets research article", publisher: "Bentham Science", wordLimit: 6000, abstractLimit: 250, titleLimitChars: 120, keywords: {min: 6, max: 8}, abstractStructured: true, abstractHeadings: ["Introduction/Objective", "Methods", "Results", "Discussion", "Conclusion"], referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "credit"], notes: "Stated as 4000-6000 words with 75 or more references (a minimum), excluding figures, tables and schemes. ACS or Vancouver reference style is accepted; research articles have a quota of 20% of published articles per issue. Line art needs 900-1200 dpi, halftones 300 dpi and combination images 500-900 dpi; GIF is not processed. A graphical abstract is required, and clinical trials must be registered.", source: {url: "https://www.benthamscience.com/journal/13/ifa", checked: "2026-11-07"}},
  {id: "curr-neuropharmacol-research-article", name: "Current Neuropharmacology research article", publisher: "Bentham Science", wordLimit: 6000, abstractLimit: 250, titleLimitChars: 120, keywords: {min: 6, max: 8}, abstractStructured: true, abstractHeadings: ["Introduction/Objective", "Methods", "Results", "Discussion", "Conclusion"], referenceStyle: "vancouver", requires: ["coi", "ethics", "consent", "credit"], notes: "Stated as 4000-6000 words with 75 or more references (a minimum), excluding figures, tables and schemes. ACS or Vancouver reference style is accepted. Line art needs 900-1200 dpi, halftones 300 dpi and combination images 500-900 dpi. A graphical abstract is required, and clinical trials must be registered.", source: {url: "https://www.benthamscience.com/journal/26/ifa", checked: "2026-11-07"}},
  {id: "j-integr-neurosci-original-research", name: "Journal of Integrative Neuroscience original research", publisher: "IMR Press", wordLimit: 6000, abstractLimit: 350, figureTableLimit: 12, keywords: {min: 3, max: 10}, abstractStructured: true, abstractHeadings: ["Background", "Methods", "Results", "Conclusions"], referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "credit", "dataAvailability"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. The 6000-word limit is a recommendation and excludes references; tables and figures together are limited to 12. Clinical Trial Registration is added as a fifth abstract heading when applicable. Line art needs 800 dpi, combination images 600 dpi and halftones 300 dpi. References are numbered in square brackets with six authors then et al.; a data availability section is strongly encouraged.", source: {url: "https://www.imrpress.com/journal/jin/page/instructions", checked: "2026-11-07"}},
  {id: "j-korean-neurosurg-soc-clinical-article", name: "Journal of Korean Neurosurgical Society clinical article", publisher: "Korean Neurosurgical Society / M2PI", wordLimit: 3500, abstractLimit: 400, runningTitleChars: 40, keywords: {min: null, max: 6}, abstractStructured: true, abstractHeadings: ["Objective", "Methods", "Results", "Conclusion"], referenceStyle: "vancouver", requires: ["coi", "ethics", "consent"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. The 3500-word limit covers clinical and laboratory original work; exclusions are not stated. The abstract is 400 words for original work and review articles, 250 for other types. References are cited as superscripts and listed alphabetically by first author. Separate Conflict of Interest and Informed consent sections are required; trials need registration and a data sharing statement.", source: {url: "https://www.jkns.or.kr/authors/authors.php", checked: "2026-11-07"}},
  {id: "oncotarget-research-paper", name: "Oncotarget research paper", publisher: "Impact Journals", abstractLimit: 200, keywords: {min: 5, max: 5}, abstractStructured: false, abstractHeadings: null, referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "credit"], notes: "References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles. The page states no word or reference limit; the abstract may not exceed 200 words. Do not provide a running title or a word count; sections run Introduction, Results, Discussion, then Methods. Clinical trials need registration details in the abstract, a checklist, flow diagram and protocol. The instructions sit at the top of the Editorial Policies page; the full instructions are also inside the submission system.", source: {url: "https://www.oncotarget.com/editorial-policies/", checked: "2026-11-07"}},
  {id: "neurospine-original-article", name: "Neurospine original article", publisher: "Korean Spine Society / M2PI", wordLimit: 4500, abstractLimit: 250, referenceLimit: 40, figureTableLimit: 8, runningTitleChars: 65, keywords: {min: 2, max: 6}, abstractStructured: true, abstractHeadings: ["Objective", "Methods", "Results", "Conclusion"], referenceStyle: "vancouver", requires: ["coi", "funding", "ethics", "consent", "dataAvailability"], notes: "Words exclude references, tables and figures; tables and figures together are limited to 8. Line art needs 1,200 dpi or more, and each figure panel is a separate file. Clinical trials must be registered, with the number at the end of the abstract. An article processing charge of USD 700 applies to papers submitted from 1 March 2026.", source: {url: "https://www.e-neurospine.org/authors/authors.php", checked: "2026-11-07"}},
];

export const profileById = id => GENERIC_PROFILES.find(p => p.id === id) || JOURNAL_PROFILES.find(p => p.id === id) || null;

/** The profile the checks run against (state.journalProfile, lib/journal-profile-state.mjs), or null when none is chosen or the custom one is invalid. */
export function activeProfile(jp) {
  const n = normalizeJournalProfile(jp);
  if (!n?.id) return null;
  if (n.id !== 'custom') return profileById(n.id);
  return validateProfile(n.custom).length ? null : n.custom;
}

const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const LIMITS = ['wordLimit', 'abstractLimit', 'referenceLimit', 'figureTableLimit', 'titleLimitChars', 'runningTitleChars'];
const isCount = v => Number.isInteger(v) && v > 0;
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** What is wrong with a profile, as sentences; empty when it is valid. */
export function validateProfile(p) {
  const out = [];
  if (!p || typeof p !== 'object') return ['A profile is an object'];
  if (!String(p.id || '').trim()) out.push('A profile needs an id');
  if (!String(p.name || '').trim()) out.push('A profile needs a name');
  for (const k of LIMITS) if (p[k] != null && !isCount(p[k])) out.push(`${k} must be a whole number above zero`);
  if (!REFERENCE_STYLES.includes(p.referenceStyle)) out.push(`referenceStyle must be one of ${REFERENCE_STYLES.join(', ')}`);
  if (typeof p.abstractStructured !== 'boolean') out.push('abstractStructured must be true or false');
  if (p.abstractHeadings != null) {
    if (!Array.isArray(p.abstractHeadings) || p.abstractHeadings.some(h => typeof h !== 'string' || !h.trim())) out.push('abstractHeadings must be a list of headings');
    else if (new Set(p.abstractHeadings.map(h => h.trim().toLowerCase())).size !== p.abstractHeadings.length) out.push('abstractHeadings repeats a heading');
  }
  if (p.abstractStructured && !p.abstractHeadings?.length) out.push('A structured abstract needs its headings');
  if (p.keywords != null) {
    const { min, max } = p.keywords;
    if (min != null && !(Number.isInteger(min) && min >= 0)) out.push('keywords.min must be a whole number');
    if (max != null && !isCount(max)) out.push('keywords.max must be a whole number above zero');
    if (min != null && max != null && min > max) out.push('keywords.min is above keywords.max');
  }
  if (!Array.isArray(p.requires)) out.push('requires must be a list');
  else for (const r of p.requires) if (!REQUIREMENT_IDS.has(r)) out.push(`Unknown requirement '${r}'`);
  if (p.source != null) {
    if (p.source.url != null && !/^https?:\/\/\S+$/.test(p.source.url)) out.push('source.url must be a web address');
    if (p.source.checked != null && !isDate(p.source.checked)) out.push('source.checked must be a date as YYYY-MM-DD');
  }
  return out;
}

/**
 * A profile from the author's own fields, with defaults for what they leave
 * out. Throws with every problem listed (`err.problems`) when it is invalid.
 */
export function customProfile(fields = {}) {
  const f = { ...fields };
  const headings = Array.isArray(f.abstractHeadings) ? f.abstractHeadings.map(h => String(h).trim()).filter(Boolean)
    : typeof f.abstractHeadings === 'string' ? splitHeadings(f.abstractHeadings) : null;
  const p = {
    id: f.id || (f.name ? `custom-${slug(f.name)}` : ''),
    name: String(f.name || '').trim(),
    ...(f.publisher ? { publisher: String(f.publisher).trim() } : {}),
    ...Object.fromEntries(LIMITS.filter(k => f[k] != null && f[k] !== '').map(k => [k, typeof f[k] === 'string' ? Number(f[k].replace(/[,\s]/g, '')) : f[k]])),
    abstractHeadings: headings?.length ? headings : null,
    abstractStructured: f.abstractStructured ?? Boolean(headings?.length),
    referenceStyle: String(f.referenceStyle || 'vancouver').toLowerCase(),
    ...(f.keywords ? { keywords: { min: f.keywords.min ?? null, max: f.keywords.max ?? null } } : {}),
    requires: [...new Set(f.requires || [])],
    notes: String(f.notes || ''),
    source: { url: f.source?.url || null, checked: f.source?.checked || null },
  };
  const problems = validateProfile(p);
  if (problems.length) { const e = new Error(`Invalid journal profile: ${problems.join('; ')}`); e.problems = problems; throw e; }
  return p;
}

// ---- reading instructions for authors --------------------------------------

const SMALL = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUM = String.raw`(\d{1,3}(?:[,   ]\d{3})+|\d+|(?:${Object.keys(SMALL).join('|')})(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)`;
function toNumber(s) {
  const t = String(s).toLowerCase().trim();
  if (/^\d/.test(t)) return Number(t.replace(/[,   ]/g, ''));
  const [a, b] = t.split(/[- ]/);
  return (SMALL[a] || 0) + (SMALL[b] || 0) || null;
}
// "not exceed", "no more than", "a maximum of", "up to", "limited to", "at most", "should be under"
const CAP = String.raw`(?:(?:should|must|may|shall|will|cannot|can)\s+not\s+exceed|not\s+(?:to\s+)?exceed(?:ing)?|do(?:es)?\s+not\s+exceed|no\s+(?:more|longer)\s+than|not\s+more\s+than|(?:a\s+|the\s+)?max(?:imum|\.)?(?:\s+(?:length|of))*|up\s+to|limited\s+to|(?:is\s+)?limit(?:ed)?\s+(?:of|to)|at\s+most|fewer\s+than|less\s+than|under|within)`;

/** Split pasted text into sentences, keeping "e.g." and decimal points whole. */
export function sentencesOf(text) {
  return String(text || '').replace(/\r/g, '').split(/\n\s*\n|\n(?=\s*[-•*\d]+[.)]?\s)|(?<!\b(?:e\.g|i\.e|approx|incl|max|min|no|vs|Fig|etc)\.)(?<=[.!?])\s+(?=[A-Z(“"])/)
    .map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function splitHeadings(list) {
  return String(list).replace(/[“”"']/g, '').replace(/\.$/, '')
    .split(/\s*(?:,|;|\band\b|•)\s*/i).map(s => s.replace(/^(?:and|or)\s+/i, '').replace(/^[:\s(]+|[)\s]+$/g, '').trim()).filter(s => s && s.length <= 40)
    .map(s => s[0].toUpperCase() + s.slice(1));
}

const EXCLUDING = /\b(?:exclud\w*|not\s+includ\w*|without|except|apart\s+from|besides)\b/i;

/** Which counted thing a number-with-unit belongs to, from the words around it. */
function subjectOf(before, after, unit) {
  const clause = before.split(/[;:]|,\s|\.\s|\b(?:and|while|whereas|with)\s+(?=an?\s|the\s)/i).pop();
  const near = clause.slice(-80);
  const mentions = (re) => { const m = near.match(re); if (!m) return false; const pre = near.slice(0, m.index).split(/\s+/).slice(-3).join(' '); return !EXCLUDING.test(pre); };
  if (unit === 'char') {
    if (/\b(running|short)\s+(title|head)|\brunning\s+head/i.test(near) || /^\s*(?:\(?including spaces\)?\s*)?(?:for\s+the\s+)?(?:running|short)\s+(?:title|head)/i.test(after)) return 'runningTitleChars';
    if (/\btitle\b/i.test(near) || /^\s*(?:\(?including spaces\)?\s*)?(?:for\s+the\s+)?title/i.test(after)) return 'titleLimitChars';
    return null;
  }
  if (/^\s*(?:\)|\s)?(?:structured\s+|unstructured\s+)?(abstract|summary)\b/i.test(after)) return 'abstractLimit';
  if (mentions(/\b(abstract|summary)\b/i)) return 'abstractLimit';
  // "Abstract: unstructured, maximum 200 words" names its subject as a label
  if (/^\s*(?:the\s+)?(abstract|summary)\s*[:\u2013\u2014-]/i.test(before) && !/\b(manuscript|main\s+text|text|article|paper|body)\b/i.test(near)) return 'abstractLimit';
  // "The abstract must be structured ..., and no more than 250 words": the
  // clause names nothing counted, so the sentence's subject is what is limited
  if (/^\s*(?:the\s+|an?\s+|your\s+)?(?:structured\s+|unstructured\s+)?(abstract|summary)\b/i.test(before)
    && !/\b(abstract|summary|title|manuscript|main\s+text|text|article|paper|body|word\s+count)\b/i.test(clause)) return 'abstractLimit';
  if (mentions(/\b(title)\b/i) && !/\b(manuscript|text|article|paper)\b/i.test(near)) return null;
  return 'wordLimit';
}

/**
 * Limits and requirements read from pasted instructions for authors.
 * Returns `{ profile, evidence, conflicts }`: a partial profile, the sentence
 * each value came from (`[{ field, value, sentence }]`), and the fields for
 * which the text gave more than one value (instructions often list several
 * article types). The first value found is used; the author confirms.
 */
export function profileFromText(text) {
  const evidence = [];
  const add = (field, value, sentence) => { if (value != null && !evidence.some(e => e.field === field && JSON.stringify(e.value) === JSON.stringify(value) && e.sentence === sentence)) evidence.push({ field, value, sentence }); };
  for (const s of sentencesOf(text)) {
    // words and characters: find each "N words" and decide what it limits
    for (const m of s.matchAll(new RegExp(String.raw`${NUM}(?:\s*|-)(words?|characters?|chars?)\b`, 'gi'))) {
      const n = toNumber(m[1]); if (!n) continue;
      const before = s.slice(0, m.index), after = s.slice(m.index + m[0].length);
      const unit = /^char/i.test(m[2]) ? 'char' : 'word';
      // a number must be stated as a limit ("up to", "no more than", "N-word limit", "maximum")
      const capped = new RegExp(`${CAP}\\s*(?:of\\s+|about\\s+|\\(\\s*)?$`, 'i').test(before)
        || /^\s*(?:or\s+(?:less|fewer)|\(?\s*max(?:imum)?\b|limit)/i.test(after)
        || /^-?\s*words?\s+(?:limit|maximum)/i.test(m[0].slice(m[1].length) + after)
        || /^-words?$/i.test(m[0].slice(m[1].length)) && /^\s*(?:structured\s+|unstructured\s+)?(?:abstract|summary)\b/i.test(after)
        || /\b(?:limit|maximum|length)\b[^.]{0,25}$/i.test(before);
      if (!capped || /\b(at\s+least|minimum\s+of|min\.)\s*$/i.test(before)) continue;
      const field = subjectOf(before, after, unit);
      if (field) add(field, n, s);
    }
    // references
    for (const m of s.matchAll(new RegExp(String.raw`${NUM}\s+(?:references|citations|refs\b)`, 'gi'))) {
      const n = toNumber(m[1]); const before = s.slice(0, m.index);
      if (n && (new RegExp(`${CAP}\\s*$`, 'i').test(before) || /^\s*(?:or\s+fewer|max)/i.test(s.slice(m.index + m[0].length)))) add('referenceLimit', n, s);
    }
    const refCap = s.match(new RegExp(String.raw`\b(?:references?|reference\s+list|citations)\b[^.]{0,40}?${CAP}\s*${NUM}(?!\s*(?:words?|characters?|figures?|tables?))`, 'i'));
    if (refCap) add('referenceLimit', toNumber(refCap[1]), s);
    // figures and tables, together
    const ft = s.match(new RegExp(String.raw`${CAP}\s*(?:a\s+(?:total|combined\s+total)\s+of\s+)?${NUM}\s+(?:(?:figures?|illustrations?)\s*(?:and\/or|and|\/|or|plus|\+)\s*tables?|tables?\s*(?:and\/or|and|\/|or|plus|\+)\s*(?:figures?|illustrations?)|display\s+items|figures?\s+(?:or|and)\s+tables?\s+combined)`, 'i'))
      || s.match(new RegExp(String.raw`\b(?:figures?\s*(?:and\/or|and|\/|or)\s*tables?|tables?\s*(?:and\/or|and|\/|or)\s*figures?|display\s+items)\b[^.]{0,30}?${CAP}\s*${NUM}`, 'i'));
    if (ft) add('figureTableLimit', toNumber(ft[1]), s);
    // keywords: "3 to 6 keywords", "between 3 and 6 key words", "up to 6 keywords"
    const kr = s.match(new RegExp(String.raw`(?:between\s+)?${NUM}\s*(?:to|-|–|and)\s*${NUM}\s+key\s?words?`, 'i'));
    if (kr) add('keywords', { min: toNumber(kr[1]), max: toNumber(kr[2]) }, s);
    else {
      const kmax = s.match(new RegExp(String.raw`${CAP}\s*${NUM}\s+key\s?words?`, 'i')) || s.match(new RegExp(String.raw`key\s?words?[^.]{0,30}?${CAP}\s*${NUM}`, 'i'));
      if (kmax) add('keywords', { min: null, max: toNumber(kmax[1]) }, s);
      const kmin = s.match(new RegExp(String.raw`(?:at\s+least|a\s+minimum\s+of)\s*${NUM}\s+key\s?words?`, 'i'));
      if (kmin) add('keywords', { min: toNumber(kmin[1]), max: null }, s);
    }
    // abstract form
    if (/\bunstructured\s+abstract|\babstract\b[^.]{0,20}\bunstructured\b|\babstract\b[^.]{0,40}\bshould\s+not\s+be\s+structured|\bnon-structured\s+abstract/i.test(s)) add('abstractStructured', false, s);
    else if (/\bstructured\s+(?:abstract|summary)|\babstract\b[^.]{0,40}\bstructured\b/i.test(s)) add('abstractStructured', true, s);
    const hl = s.match(/\b(?:sub)?headings?\s*(?:of|:|as\s+follows:?|such\s+as|including)?\s*[:(]?\s*((?:[“"']?[A-Z][A-Za-z/ -]{1,38}[”"']?\s*(?:,|;|\band\b|•)\s*){2,}[“"']?[A-Z][A-Za-z/ -]{1,38}[”"']?)/)
      || (/\bstructured\s+(?:abstract|summary)/i.test(s) && s.match(/\bstructured\s+(?:abstract|summary)[^(]{0,30}\(\s*([^)]+)\)/i));
    if (hl) { const heads = splitHeadings(hl[1]); if (heads.length >= 2) add('abstractHeadings', heads, s); }
    // reference style, named
    const style = s.match(/\b(Vancouver|AMA|American Medical Association|APA|American Psychological Association|Harvard|NLM|National Library of Medicine)\b[^.]{0,40}\b(?:style|format|system|manual)|\b(?:style|format)\b[^.]{0,30}\b(Vancouver|AMA|APA|Harvard|NLM)\b/i);
    if (style && /\breferenc|\bcitation|\bbibliograph/i.test(s)) {
      const name = (style[1] || style[2]).toLowerCase();
      add('referenceStyle', name.startsWith('american medical') ? 'ama' : name.startsWith('american psych') ? 'apa' : name.startsWith('national library') ? 'nlm' : name, s);
    }
    // statements the instructions mention
    const req = [
      ['coi', /\b(conflicts?\s+of\s+interests?|competing\s+interests?|declarations?\s+of\s+interests?|ICMJE\s+disclosure)/i],
      ['funding', /\b(funding|financial\s+support|sources?\s+of\s+support)\b/i],
      ['dataAvailability', /\b(data\s+availability|data\s+sharing|availability\s+of\s+data)\b/i],
      ['ethics', /\b(ethics\s+(?:committee|approval|statement)|ethical\s+approval|institutional\s+review\s+board|\bIRB\b|research\s+ethics)/i],
      ['consent', /\b(informed\s+consent|patient\s+consent|consent\s+(?:for|to)\s+publication)\b/i],
      ['registration', /\b(trial\s+registration|registered\s+in\s+a\s+(?:public\s+)?(?:trial\s+)?registry|prospectively\s+registered|registration\s+number|PROSPERO)\b/i],
      ['credit', /\b(CRediT|author(?:s'|s)?\s+contributions?|contributorship)\b/i],
      ['orcid', /\bORCID\b/i],
    ];
    for (const [id, re] of req) if (re.test(s)) add(`requires:${id}`, true, s);
  }
  const conflicts = [];
  const profile = {};
  for (const e of evidence) {
    if (e.field.startsWith('requires:')) { (profile.requires ||= []).includes(e.field.slice(9)) || profile.requires.push(e.field.slice(9)); continue; }
    if (!(e.field in profile)) profile[e.field] = e.value;
    else if (JSON.stringify(profile[e.field]) !== JSON.stringify(e.value) && !conflicts.includes(e.field)) conflicts.push(e.field);
  }
  if (profile.abstractHeadings && profile.abstractStructured == null) profile.abstractStructured = true;
  return { profile, evidence, conflicts };
}
