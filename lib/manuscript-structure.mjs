// The parts of a manuscript, as a journal reads it: the title, the authors
// and their affiliations, the abstract (structured or not) and keywords, the
// main text in its sections, the back matter (acknowledgements, funding,
// conflicts of interest, ethics, data availability), the references, figure
// legends, tables and appendices. A journal's word count is the main text;
// the rest is counted apart (plan §4.11a).
//
// Parts are found from what the document shows: paragraph styles and
// heading levels, a heading's numbering and position, the names journals give
// their sections (in the languages they are commonly written in), and short
// paragraphs set in capitals or bold. A role the author sets on a heading
// (`roleFixed`) overrides the guess for its whole section.

import { wordCount } from './manuscript.mjs';

export const ROLES = [
  ['title', 'Title'], ['authors', 'Authors'], ['affiliations', 'Affiliations'], ['abstract', 'Abstract'], ['keywords', 'Keywords'],
  ['main', 'Main text'], ['back', 'Back matter'], ['references', 'References'], ['legends', 'Figure legends'], ['tables', 'Tables'], ['appendix', 'Appendix'],
];

const strip = t => String(t || '').replace(/\[@[^\]]*\]|\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();
// "2.1 Methods", "II. RESULTS", "A) Background" name the same section as "Methods".
const bare = t => strip(t).replace(/^((\d+(\.\d+)*|[IVXLC]+|[A-Z])[.)]\s+|\d+(\.\d+)*\s+)/, '').replace(/[.:]\s*$/, '').trim();

const NAMES = {
  abstract: /^(abstract|summary|structured abstract|özet|resumen|résumé|resumo|zusammenfassung|riassunto|samenvatting|streszczenie)$/i,
  keywords: /^(key ?words?|index terms|anahtar (kelimeler|sözcükler)|palabras clave|mots[- ]cl[ée]s|palavras[- ]chave|schlüsselwörter|parole chiave|trefwoorden)$/i,
  references: /^(references?|reference list|bibliography|literature( cited)?|works cited|cited literature|kaynaklar|kaynakça|referencias|références|referências|literatur(verzeichnis)?|bibliografia|riferimenti( bibliografici)?)$/i,
  legends: /^(figure legends?|legends?( to figures?| for figures?)?|figure captions?|figures?|captions?|şekil (açıklamaları|altyazıları))$/i,
  tables: /^(tables?|tablolar)$/i,
  appendix: /^(appendix|appendices|supplementary (material|materials|information|data|appendix)|supplemental (material|materials|digital content)|online supplement|ek(ler)?)(\s+[A-Z0-9]+)?$/i,
  back: /^(acknowledge?ments?|funding( (statement|sources?|information))?|financial (support|disclosure)|sources? of funding|conflicts? of interests?( statement)?|competing interests?|declarations?( of interest)?|disclosures?|statements?|ethics( approval| statement| and consent.*)?|ethical (approval|considerations|statement)|human ethics.*|consent( to (participate|publish))?.*|informed consent|author(s'|s)? contributions?|contributors?|data (availability|sharing)( statement)?|availability of data.*|artificial intelligence.*|use of (ai|artificial intelligence).*|ai[- ]assisted.*|abbreviations|list of abbreviations|patient consent|trial registration|registration|teşekkür|finansman|çıkar çatışması|etik kurul.*|agradecimientos|financiación|conflicto de intereses|remerciements|danksagung|interessenkonflikt)$/i,
};
const MAIN_HINT = /^(introduction|background|methods?|materials? and methods|patients? and methods|study design|results?|findings|discussion|conclusions?|limitations?|case (presentation|report|description)|future directions)$/i;

const isEmpty = b => !strip(b.text);
const isAllCaps = t => /[A-Z]/.test(t) && t === t.toUpperCase() && /[A-Z]{3}/.test(t);
const allBold = b => (b.runs || []).filter(r => !r.cite && String(r.t || '').trim()).every(r => r.b);

/** Whether a block reads as a heading: its style or level, or a short line in capitals or bold. */
export function isHeading(b) {
  if (!b || b.type === 'table' || b.type === 'figure' || b.type === 'toc' || b.type === 'bib') return false;
  const t = strip(b.text);
  if (!t) return false;
  if (/^h[1-3]$/.test(b.type)) return true;
  if (!t || t.length > 90 || /[.;]$/.test(t) && !/^(\d+(\.\d+)*|[IVX]+)\.\s/.test(t)) return false;
  // "Background: Adult spinal …" is a run-in label, not a heading.
  if (/:\s*\S/.test(t) && t.length > 40) return false;
  return isAllCaps(t) || (allBold(b) && t.split(/\s+/).length <= 10) || Object.values(NAMES).some(re => re.test(bare(t))) && t.split(/\s+/).length <= 6;
}

/** A heading's level: 1 for Title-level and top headings, 2 below them. */
const levelOf = b => b.type === 'h3' ? 2 : /^\d+\.\d+/.test(strip(b.text)) ? 2 : (b.type === 'h1' || b.type === 'h2') ? 1 : isAllCaps(strip(b.text)) ? 1 : 2;

function nameRole(t) {
  const n = bare(t);
  for (const k of ['abstract', 'keywords', 'references', 'legends', 'tables', 'appendix', 'back']) if (NAMES[k].test(n)) return k;
  return null;
}

/**
 * The role of every block, in order: an array of role names, one per block.
 * `fixed` roles on headings are kept and carry over their section.
 */
export function classifyStructure(blocks) {
  const roles = new Array(blocks.length).fill(null);
  const first = blocks.findIndex(b => !isEmpty(b));
  if (first < 0) return roles;
  // The first heading that names a section, or the abstract: what comes before it is the front of the paper.
  let front = blocks.findIndex((b, i) => i > first && isHeading(b) && (nameRole(b.text) || MAIN_HINT.test(bare(b.text))));
  const abstractLabel = blocks.findIndex((b, i) => i > first && /^\s*(abstract|summary|background|objectives?|purpose|aims?|introduction)\s*[:.]/i.test(strip(b.text)) && !isHeading(b));
  // A paper with no named sections is its title and then its text.
  if (front < 0) front = abstractLabel >= 0 ? abstractLabel : first + 1;
  if (abstractLabel >= 0 && abstractLabel < front) front = abstractLabel;
  // Title: the first paragraph, unless the author says otherwise.
  roles[first] = 'title';
  for (let i = first + 1; i < front; i++) {
    if (isEmpty(blocks[i])) continue;
    const t = strip(blocks[i].text);
    roles[i] = /\b(department|university|univ\.|hospital|institute|school|faculty|cent(er|re)|clinic|laborator|college|correspond|e-?mail|@|orcid|address)\b/i.test(t) ? 'affiliations'
      : roles.slice(first + 1, i).includes('authors') ? (/,/.test(t) && t.length < 300 ? 'authors' : 'affiliations') : 'authors';
  }
  // Then each block takes the role of the section it is in.
  let current = abstractLabel === front ? 'abstract' : 'main', sawMain = false, fixedLevel = 0;
  for (let i = front; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.roleFixed) { current = b.roleFixed; roles[i] = current; fixedLevel = isHeading(b) ? levelOf(b) : 9; if (current === 'main') sawMain = true; continue; }
    // Within a section the author has set, its own subheadings do not change it.
    if (fixedLevel && isHeading(b)) { if (levelOf(b) > fixedLevel) { roles[i] = current; continue; } fixedLevel = 0; }
    if (b.type === 'table') { roles[i] = current === 'main' || current === 'abstract' ? 'tables' : current; continue; }
    // The generated reference list is the references wherever it stands.
    if (b.type === 'bib') { roles[i] = 'references'; continue; }
    const t = strip(b.text);
    if (/^\s*(key ?words?|index terms|anahtar kelimeler|palabras clave|mots[- ]cl[ée]s|palavras[- ]chave|schlüsselwörter)\s*[:.]/i.test(t)) { roles[i] = 'keywords'; if (current === 'abstract') current = 'abstract'; continue; }
    if (isHeading(b)) {
      const named = nameRole(t);
      if (named) current = named === 'keywords' ? 'keywords' : named;
      // A main-text heading after the abstract starts the main text; one after the back matter is back matter's own subheading.
      else if (current === 'abstract' || current === 'keywords' || MAIN_HINT.test(bare(t))) { if (!['back', 'references', 'legends', 'tables', 'appendix'].includes(current) || MAIN_HINT.test(bare(t)) && !sawMain) current = 'main'; }
      if (current === 'main') sawMain = true;
      roles[i] = current;
      continue;
    }
    // A figure legend is a figure legend wherever it stands after the main text.
    if (/^(figure|fig\.?|şekil)\s*\d+[a-z]?[.:]/i.test(t) && (current !== 'main' || b.styleId === 'Caption')) { roles[i] = current === 'references' || current === 'main' ? 'legends' : current; continue; }
    roles[i] = current === 'keywords' ? 'abstract' : current;
  }
  return roles;
}

// ---- display ------------------------------------------------------------------------------

/**
 * A heading as a sentence: "PATIENTS MOST LIKELY TO BENEFIT" or "Patients
 * Most Likely to Benefit" as "Patients most likely to benefit". Words the
 * body text itself writes in capitals (ASD) or with a capital mid-sentence
 * (Dynesys) keep them; the first word and a word after a colon are capitalised.
 */
export function sentenceCase(text, keep = new Set()) {
  const t = strip(text);
  if (!t) return t;
  const kept = new Map([...keep].map(w => [w.toLowerCase(), w]));
  return t.split(/(\s+|-)/).map((w, k, all) => {
    if (/^\s+$|^-$/.test(w)) return w;
    const core = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const prev = all.slice(0, k).join('').trimEnd();
    const start = !prev || /[:.?!]$/.test(prev);
    const known = kept.get(core.toLowerCase());
    if (known && (known !== known.toLowerCase())) return w.replace(core, known);
    // Mixed case inside a word (McKenzie, pH) is the author's.
    if (/\p{Ll}\p{Lu}/u.test(core)) return w;
    const lower = w.toLowerCase();
    return start ? lower.replace(/\p{L}/u, c => c.toUpperCase()) : lower;
  }).join('');
}

/** Words the body writes in capitals or capitalised mid-sentence: they keep their case in a heading. */
export function keptWords(blocks) {
  const keep = new Set(), lower = new Set();
  for (const b of blocks) {
    if (isHeading(b) || !b.text) continue;
    // A run-in label ("Clinical Relevance: …") is set as a heading is, not as the word is spelled.
    const body = strip(b.text).replace(/^[^:.]{2,40}[:.]\s/, '');
    for (const m of body.matchAll(/(?<=[\p{L}\p{N},;)] )(\p{Lu}[\p{L}\p{N}-]+)/gu)) keep.add(m[1]);
    for (const m of body.matchAll(/\b(\p{Lu}{2,}[\p{Lu}\p{N}]*s?)\b/gu)) keep.add(m[1]);
    for (const m of body.matchAll(/(?<![\p{L}\p{N}])(\p{Ll}[\p{L}\p{N}-]*)/gu)) lower.add(m[1]);
  }
  // A word the text also writes in lower case ("this Perspective" once, "perspective" elsewhere) is not a name.
  for (const w of keep) if (lower.has(w.toLowerCase())) keep.delete(w);
  return keep;
}

// ---- counts ----------------------------------------------------------------------------------

/**
 * The counts a journal asks for. Title in characters; abstract in words, with
 * its parts when it is structured ("Background: …"); main text in words, from
 * the first section after the abstract through the conclusions, section by
 * section; references, figure legends, tables, appendices and back matter
 * counted apart and not in the main text. `citedCount` is the number of works
 * cited, for a reference list the document regenerates.
 */
export function structureCounts(blocks, { roles = null, citedCount = 0 } = {}) {
  roles ||= classifyStructure(blocks);
  const keep = keptWords(blocks);
  const out = { title: null, abstract: { words: 0, parts: [] }, keywords: 0, main: { words: 0, sections: [] }, excluded: [] };
  const excluded = new Map();
  const ex = (role, label) => { if (!excluded.has(role)) excluded.set(role, { role, label, words: 0, items: 0 }); return excluded.get(role); };
  let section = null;
  blocks.forEach((b, i) => {
    const role = roles[i], t = strip(b.text), w = wordCount(b.text || '');
    if (role === 'title') { out.title = { text: t, characters: t.length, index: i }; return; }
    if (role === 'authors' || role === 'affiliations') return;
    if (role === 'abstract') {
      if (isHeading(b) && NAMES.abstract.test(bare(t))) { out.abstract.index = i; return; }
      out.abstract.index ??= i;
      out.abstract.words += w;
      const label = /^([\p{L} ()-]{3,40})\s*[:.]\s+\S/u.exec(t)?.[1];
      if (label && (allBold({ runs: (b.runs || []).slice(0, 1) }) || /^(background|objectives?|aims?|purpose|introduction|methods?|materials?|design|setting|participants|interventions?|results?|findings|conclusions?|clinical relevance|level of evidence|significance|interpretation|context)$/i.test(label.trim())))
        out.abstract.parts.push({ name: sentenceCase(label, keep), words: w, index: i });
      else if (out.abstract.parts.length) out.abstract.parts.at(-1).words += w;
      return;
    }
    if (role === 'keywords') { out.keywords += Math.max(0, w - 1); return; }
    if (role === 'main') {
      if (isHeading(b)) {
        if (levelOf(b) === 1 || !section) { section = { name: sentenceCase(t, keep), words: 0, index: i, subsections: [] }; out.main.sections.push(section); }
        else section.subsections.push({ name: sentenceCase(t, keep), words: 0, index: i });
        return;
      }
      out.main.words += w;
      if (section) { section.words += w; if (section.subsections.length) section.subsections.at(-1).words += w; }
      return;
    }
    const label = ROLES.find(r => r[0] === role)?.[1] || role;
    const e = ex(role, label);
    e.index ??= i;
    if (role === 'tables') { if (b.type === 'table') e.items++; e.words += w; return; }
    if (role === 'references') { if (!isHeading(b) && t) e.items++; return; }
    if (role === 'legends') { if (!isHeading(b) && t) { e.items++; e.words += w; } return; }
    if (!isHeading(b)) e.words += w;
  });
  // A reference list the document regenerates from its citations has no paragraphs of its own.
  const refs = excluded.get('references');
  if (refs && !refs.items) refs.items = citedCount;
  if (!refs && citedCount) excluded.set('references', { role: 'references', label: 'References', words: 0, items: citedCount });
  out.excluded = ['back', 'references', 'legends', 'tables', 'appendix'].map(r => excluded.get(r)).filter(Boolean);
  return out;
}
