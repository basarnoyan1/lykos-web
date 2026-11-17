// Journals the app knows by name: at most the reference style its instructions name (`style`, lib/cite.mjs STYLES) and the
// profile that follows when it becomes the target (`profile`, lib/journal-profiles.mjs). `style: null` means not known, never a
// guess; `verified` is the date the style was read from the journal (`source`), null when not re-read ("unverified" in the
// interface). No limit is stored here: limits belong to a journal profile, added only from instructions that were read.
// Pure data and matching: nothing here imports the store or a view.

const FROM_MEMORY = 'From memory of the journal’s instructions; not read from them. Check the instructions for authors';
const EARLIER = 'Set in an earlier version of the app; not re-read from the journal’s instructions';

export const JOURNAL_PRESETS = [
  // Styles carried over from earlier versions, not yet re-read.
  { id: 'jama',         label: 'JAMA / JAMA Neurology', aliases: ['JAMA', 'JAMA Neurology', 'JAMA Neurol'], style: 'ama', verified: null, source: EARLIER },
  { id: 'neurosurgery', label: 'Neurosurgery', aliases: [], style: 'ama', verified: null, source: EARLIER },
  { id: 'jns',          label: 'Journal of Neurosurgery', aliases: ['J Neurosurg'], style: 'ama', verified: null, source: EARLIER },
  { id: 'nejm',         label: 'NEJM', aliases: ['New England Journal of Medicine', 'N Engl J Med'], style: 'nlm', verified: null, source: EARLIER },
  { id: 'lancet',       label: 'The Lancet', aliases: ['Lancet'], style: 'vancouver', verified: null, source: EARLIER },
  { id: 'bmj',          label: 'BMJ', aliases: ['British Medical Journal'], style: 'vancouver', verified: null, source: EARLIER },
  { id: 'plos',         label: 'PLOS', aliases: [], style: 'vancouver', verified: null, source: EARLIER },
  { id: 'apa-journal',  label: 'APA journals', aliases: [], style: 'apa', verified: null, source: EARLIER },
  // Journals the owner and neurosurgical, spine, neuro-oncology and general
  // research work with. Their instructions could not be read from this build
  // environment: the styles below are set from memory and are unverified (the
  // interface says so); a person who reads the instructions records the date and
  // page. A journal whose own style is not one of the app's has style: null.
  ...[
    ['brain-spine', 'Brain and Spine', ['Brain Spine'], 'vancouver'],
    ['spine', 'Spine', [], 'ama'],
    ['spine-j', 'The Spine Journal', ['Spine J'], 'vancouver'],
    ['jns-spine', 'Journal of Neurosurgery: Spine', ['J Neurosurg Spine', 'Journal of Neurosurgery Spine'], 'ama'],
    ['global-spine-j', 'Global Spine Journal', ['Global Spine J'], 'ama'],
    ['world-neurosurg', 'World Neurosurgery', ['World Neurosurg'], 'vancouver'],
    ['neurosurg-focus', 'Neurosurgical Focus', ['Neurosurg Focus'], 'ama'],
    ['clin-neurol-neurosurg', 'Clinical Neurology and Neurosurgery', ['Clin Neurol Neurosurg'], 'vancouver'],
    ['jama-netw-open', 'JAMA Network Open', ['JAMA Netw Open'], 'ama'],
    ['syst-rev', 'Systematic Reviews', ['Syst Rev'], 'vancouver'],
    ['cochrane-dsr', 'Cochrane Database of Systematic Reviews', ['Cochrane Database Syst Rev', 'Cochrane Reviews'], null],   // its own style: not one of the app's
    ['j-clin-epidemiol', 'Journal of Clinical Epidemiology', ['J Clin Epidemiol'], 'vancouver'],
    ['annals-im', 'Annals of Internal Medicine', ['Ann Intern Med'], 'ama'],
    ['frontiers', 'Frontiers journals', ['Frontiers in Neurology', 'Frontiers in Oncology', 'Frontiers in Surgery', 'Frontiers in Neuroscience'], 'apa'],
    // Added 2026-10-19: the JNS, Neurosurgery and Neuro-Oncology families as their parent journal, from memory.
    ['jns-case-lessons', 'Journal of Neurosurgery: Case Lessons', ['J Neurosurg Case Lessons', 'JNS Case Lessons', 'JNS: Case Lessons'], 'ama'],
    ['oper-neurosurg', 'Operative Neurosurgery', ['Oper Neurosurg', 'Oper Neurosurg (Hagerstown)'], 'ama'],
    ['neurosurg-focus-video', 'Neurosurgical Focus: Video', ['Neurosurg Focus Video'], 'ama'],
    ['neuro-onc-adv', 'Neuro-Oncology Advances', ['Neurooncol Adv', 'Neuro-Oncol Adv'], 'vancouver'],
    ['neuro-onc-pract', 'Neuro-Oncology Practice', ['Neurooncol Pract', 'Neuro-Oncol Pract'], 'vancouver'],
  ].map(([id, label, aliases, style]) => ({ id, label, aliases, style, verified: null, source: style ? FROM_MEMORY : 'Not read: format not known, set the style by hand' })),
  // Read from the journal's instructions for authors. `figures` and `notes` are what read("journal") shows a session (tools/mcp/inspect.mjs).
  { id: 'ijss', label: 'International Journal of Spine Surgery', aliases: ['Int J Spine Surg', 'IJSS'], style: 'ama', verified: '2026-10-26', profile: 'ijss-original-research',
    source: 'https://www.ijssurgery.com/node/6569 (instructions for authors)',
    figures: { formats: ['TIFF', 'EPS'], minDpi: 300, notAccepted: ['PDF', 'Excel', 'PowerPoint'], files: 'Each figure as a separate file' },
    notes: ['References in AMA style, numbered in the order cited, cited as superscript numbers'] },
  // Read from each journal's instructions for authors on 2026-11-07 (plan W4): the reference style, the profile that follows (its
  // limits and statements, lib/journal-profiles.mjs), the artwork the page states.
  {id: "neurosurg-rev", label: "Neurosurgical Review", aliases: ["Neurosurg Rev"], style: null, verified: null, source: "https://link.springer.com/journal/10143/submission-guidelines (instructions for authors, Original Article, read 2026-11-07; the journal’s own reference style, not one of the app’s)", profile: "neurosurg-rev-original-article", figures: {formats: ["EPS", "TIFF"], minDpi: 300}, notes: ["References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles.", "Abstract 150 to 250 words; no word limit stated for research articles (4,000 words applies to Systematic Reviews).", "Numbered brackets, list alphabetized by first author then numbered; EQUATOR checklist and flow diagrams required.", "Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies."]},
  {id: "jno", label: "Journal of Neuro-Oncology", aliases: ["J Neurooncol", "J Neuro-Oncol"], style: null, verified: null, source: "https://link.springer.com/journal/11060/submission-guidelines (instructions for authors, Research article, read 2026-11-07; the journal’s own reference style, not one of the app’s)", profile: "jno-research-article", figures: {formats: ["EPS", "TIFF"], minDpi: 300}, notes: ["References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles.", "ORCID required for the corresponding author; author contributions encouraged, not required.", "Trial registration number and date go on the last line of the abstract (prospective phase II to IV).", "Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies."]},
  {id: "acta-neurochir", label: "Acta Neurochirurgica", aliases: ["Acta Neurochir", "Acta Neurochir (Wien)"], style: null, verified: null, source: "https://link.springer.com/journal/701/submission-guidelines (instructions for authors, Original Research Article, read 2026-11-07; the journal’s own reference style, not one of the app’s)", profile: "acta-neurochir-original-research-article", figures: {formats: ["EPS", "TIFF"], minDpi: 300}, notes: ["References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles.", "The page conflicts: one section allows an abstract of up to 300 words (Background, Method, Results, Conclusions), the title page section asks for 150 to 250 words (Purpose, Methods, Results, Conclusion).", "No word limit stated; reference list alphabetical in the text.", "Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies."]},
  {id: "eur-spine-j", label: "European Spine Journal", aliases: ["Eur Spine J"], style: null, verified: null, source: "https://link.springer.com/journal/586/submission-guidelines (instructions for authors, Original Article, read 2026-11-07; the journal’s own reference style, not one of the app’s)", profile: "eur-spine-j-original-article", figures: {formats: ["EPS", "TIFF"], minDpi: 300}, notes: ["References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles.", "Abstract 150 to 250 words, may be extended to up to 450 words if the topic requires it.", "Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies."]},
  {id: "childs-nerv-syst", label: "Child's Nervous System", aliases: ["Childs Nerv Syst"], style: null, verified: null, source: "https://link.springer.com/journal/381/submission-guidelines (instructions for authors, Original research article, read 2026-11-07; the journal’s own reference style, not one of the app’s)", profile: "childs-nerv-syst-original-research-article", figures: {formats: ["EPS", "TIFF"], minDpi: 300}, notes: ["References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles.", "Figures and tables: 6 to 8 combined; at most 8 authors unless multicenter.", "Keywords conflict on the page (up to 4 versus 4 to 6), so left null.", "Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies."]},
  {id: "pituitary", label: "Pituitary", aliases: [], style: null, verified: null, source: "https://link.springer.com/journal/11102/submission-guidelines (instructions for authors, Research article, read 2026-11-07; the journal’s own reference style, not one of the app’s)", profile: "pituitary-research-article", figures: {formats: ["EPS", "TIFF"], minDpi: 300}, notes: ["References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles.", "Abstract 150 to 250 words; maximum 5 figures and tables combined.", "Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies."]},
  {id: "neuroradiology", label: "Neuroradiology", aliases: [], style: null, verified: null, source: "https://link.springer.com/journal/234/submission-guidelines (instructions for authors, Research, read 2026-11-07; the journal’s own reference style, not one of the app’s)", profile: "neuroradiology-research", figures: {formats: ["EPS", "TIFF"], minDpi: 300}, notes: ["References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles.", "Double-blind review: remove author identities from manuscript, figures and supplements.", "No word, reference or figure limit stated.", "Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies."]},
  {id: "spine-deformity", label: "Spine Deformity", aliases: ["Spine Deform"], style: "ama", verified: "2026-11-07", source: "https://link.springer.com/journal/43390/submission-guidelines (instructions for authors, Original Article)", profile: "spine-deformity-original-article", figures: {formats: ["EPS", "TIFF"], minDpi: 300}, notes: ["Manuscript style follows the AMA Manual of Style (10th ed.); numbered in square brackets.", "Words exclude abstract and references. Data availability is listed among Declarations without required wording.", "Artwork minimums: line art 1200 dpi, halftone 300 dpi, combination 600 dpi. The page gives 84/174 mm (max height 234) for large-format journals and 119 mm (max 195) for small-format ones, without saying which applies."]},
  {id: "neuro-onc", label: "Neuro-Oncology", aliases: ["Neuro Oncol", "Neuro-Oncol"], style: "ama", verified: "2026-11-07", source: "https://academic.oup.com/neuro-oncology/pages/General_Instructions (instructions for authors, Basic/Translational and Clinical Investigations)", profile: "neuro-onc-basic-translational-and-clinical-investigations", figures: {formats: ["TIFF", "EPS"], minDpi: 600}, notes: ["Text body from Introduction through Discussion excludes references, legends and tables.", "Also requires Key Points (2-3 bullets), Importance of the Study (150 words) and Lay Summary (100 words)", "600 dpi applies to bitmaps; vector preferred; alt text required for figures.", "The page says more than 50 references allowed only if absolutely necessary."]},
  {id: "asian-spine-j", label: "Asian Spine Journal", aliases: ["Asian Spine J"], style: "vancouver", verified: "2026-11-07", source: "https://www.asianspinejournal.org/authors/authors.php (instructions for authors, Original Article)", profile: "asian-spine-j-original-article", figures: {formats: ["JPG", "GIF", "PPT", "TIFF", "EPS"], minDpi: 600}, notes: ["Words include the structured abstract, text and figure legends; title page, references and tables are excluded.", "Figures: JPG, GIF or PPT at submission, TIFF or EPS once accepted; 600 dpi for color and grayscale, 1,200 dpi for line art.", "3 to 5 key points are required; trials need registration; raw data go to a public repository after acceptance.", "There is no article processing charge."]},
  {id: "j-korean-neurosurg-soc", label: "Journal of Korean Neurosurgical Society", aliases: ["J Korean Neurosurg Soc"], style: null, verified: null, source: "https://www.jkns.or.kr/authors/authors.php (instructions for authors, Clinical Article)", profile: "j-korean-neurosurg-soc-clinical-article", figures: {minDpi: 300}, notes: ["References in the journal’s own numbered style; Vancouver is the nearest of the app’s styles.", "The 3500-word limit covers clinical and laboratory original work; exclusions are not stated.", "The abstract is 400 words for original work and review articles, 250 for other types.", "References are cited as superscripts and listed alphabetically by first author."]},
  {id: "neurospine", label: "Neurospine", aliases: [], style: "vancouver", verified: "2026-11-07", source: "https://www.e-neurospine.org/authors/authors.php (instructions for authors, Original Article)", profile: "neurospine-original-article", figures: {formats: ["JPG", "TIFF"], minDpi: 300}, notes: ["Words exclude references, tables and figures; tables and figures together are limited to 8.", "Line art needs 1,200 dpi or more, and each figure panel is a separate file.", "Clinical trials must be registered, with the number at the end of the abstract.", "An article processing charge of USD 700 applies to papers submitted from 1 March 2026."]},
  // Read from the journal's Information for Authors (August 2026) and the Lancet group's formatting guidelines for systematic reviews and
  // meta-analyses (July 2025) on 2026-11-10; the reference style is the Lancet's own, lib/cite.mjs STYLES 'lancet'.
  { id: 'lancet-neurol', label: 'The Lancet Neurology', aliases: ['Lancet Neurol', 'Lancet Neurology', 'The Lancet. Neurology'], style: 'lancet', verified: '2026-11-10', profile: 'lancet-neurol-article',
    source: 'https://www.thelancet.com/for-authors/forms?section=meta-analysis (the formatting guidelines for meta-analyses, July 2025, as linked from The Lancet Neurology Information for Authors, August 2026; both read as PDFs, Articles, Formatting guidelines and References)',
    // the figure page box is the journal's printed page, measured on 10 Nov 2026 from Lancet Neurol 2025;24:1005 (publisher PDF, doi 10.1016/S1474-4422(25)00402-8): a figure is at
    // most as wide as the text block with the margin column (530 pt) and as deep as the text (57 lines of 11 pt)
    figures: { formats: ['TIF', 'JPG'], minDpi: 300, page: { w: 7.36, h: 8.6 }, files: 'Photographs at least 300 dpi and 107 mm wide; illustrations as editable vector files; flow diagrams as editable Word or PowerPoint files' },
    notes: ['References in Vancouver numbering, superscript after any punctuation mark; journal names as in Index Medicus; no issue number', 'Decimal points mid-line (23·4); numbers one to ten in words unless a unit of measurement', 'Tables in Word; Research in context panel required, with no references in it or in the Summary'] },
];

/** A journal name as compared: case, accents, punctuation and a leading "The" do not matter. */
export const journalKey = name => String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');

/**
 * The preset a picker choice (`{ id, label }`) or a typed name names, by id,
 * label or alias; null when none does. Whole names only: "Journal of
 * Neurosurgery: Spine" is not "Journal of Neurosurgery".
 */
export function findPreset(choice, presets = JOURNAL_PRESETS) {
  const c = typeof choice === 'string' ? { label: choice } : (choice || {});
  const keys = new Set([c.label, c.id].filter(Boolean).map(journalKey).filter(Boolean));
  if (!keys.size) return null;
  return presets.find(p => [p.id, p.label, ...(p.aliases || [])].some(n => keys.has(journalKey(n)))) || null;
}

/** The presets whose id, label or alias contains the query (for a picker that lists them first). */
export function searchPresets(query, presets = JOURNAL_PRESETS) {
  const tokens = journalKey(query).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  return presets.filter(p => { const hay = [p.id, p.label, ...(p.aliases || [])].map(journalKey).join(' | '); return tokens.every(t => hay.includes(t)); });
}

/**
 * The catalogue's entries with the presets' aliases attached (so a search for
 * an alias finds the entry), and the presets the catalogue lacks appended.
 */
export function withPresets(entries, presets = JOURNAL_PRESETS) {
  const listed = new Set(), byKey = new Map();
  for (const p of presets) for (const n of [p.id, p.label, ...(p.aliases || [])]) { const k = journalKey(n); if (k && !byKey.has(k)) byKey.set(k, p); }
  const out = entries.map(e => {
    const p = byKey.get(journalKey(e.label)) || byKey.get(journalKey(e.id));
    if (p) listed.add(p.id);
    return p ? { ...e, aliases: [...new Set([...(e.aliases || []), p.label, ...(p.aliases || [])])] } : e;
  });
  for (const p of presets) if (!listed.has(p.id)) out.push({ id: p.id, label: p.label, format: null, fields: [], aliases: p.aliases || [] });
  return out;
}
