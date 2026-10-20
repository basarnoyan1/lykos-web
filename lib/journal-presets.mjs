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
  { id: 'neuro-onc',    label: 'Neuro-Oncology', aliases: ['Neuro Oncol', 'Neuro-Oncol'], style: 'vancouver', verified: null, source: EARLIER },
  { id: 'plos',         label: 'PLOS', aliases: [], style: 'vancouver', verified: null, source: EARLIER },
  { id: 'apa-journal',  label: 'APA journals', aliases: [], style: 'apa', verified: null, source: EARLIER },
  // Journals the owner and neurosurgical, spine, neuro-oncology and general
  // research work with. Their instructions could not be read from this build
  // environment: the styles below are set from memory and are unverified (the
  // interface says so); a person who reads the instructions records the date and
  // page. A journal whose own style is not one of the app's has style: null.
  ...[
    ['jno', 'Journal of Neuro-Oncology', ['J Neurooncol', 'J Neuro-Oncol'], 'vancouver'],
    ['brain-spine', 'Brain and Spine', ['Brain Spine'], 'vancouver'],
    ['spine', 'Spine', [], 'ama'],
    ['eur-spine-j', 'European Spine Journal', ['Eur Spine J'], 'vancouver'],
    ['spine-j', 'The Spine Journal', ['Spine J'], 'vancouver'],
    ['jns-spine', 'Journal of Neurosurgery: Spine', ['J Neurosurg Spine', 'Journal of Neurosurgery Spine'], 'ama'],
    ['global-spine-j', 'Global Spine Journal', ['Global Spine J'], 'ama'],
    ['neurospine', 'Neurospine', [], 'vancouver'],
    ['spine-deformity', 'Spine Deformity', ['Spine Deform'], 'vancouver'],
    ['world-neurosurg', 'World Neurosurgery', ['World Neurosurg'], 'vancouver'],
    ['acta-neurochir', 'Acta Neurochirurgica', ['Acta Neurochir'], 'vancouver'],
    ['neurosurg-rev', 'Neurosurgical Review', ['Neurosurg Rev'], 'vancouver'],
    ['neurosurg-focus', 'Neurosurgical Focus', ['Neurosurg Focus'], 'ama'],
    ['clin-neurol-neurosurg', 'Clinical Neurology and Neurosurgery', ['Clin Neurol Neurosurg'], 'vancouver'],
    ['jama-netw-open', 'JAMA Network Open', ['JAMA Netw Open'], 'ama'],
    ['plos-one', 'PLOS ONE', ['PLoS One'], 'vancouver'],
    ['syst-rev', 'Systematic Reviews', ['Syst Rev'], 'vancouver'],
    ['bmc-msk', 'BMC Musculoskeletal Disorders', ['BMC Musculoskelet Disord'], 'vancouver'],
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
