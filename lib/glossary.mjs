// Plain definitions of the terms of evidence synthesis, for a reader new to them: a term in a sentence is marked and its definition is the
// tooltip the app draws for it (lib/tooltips.mjs reads `title`). One table, one sentence per term; nothing here is shown unless pointed at.
import { esc } from './html.mjs';

export const GLOSSARY = Object.freeze({
  'GRADE': 'A system for rating how certain the evidence for a result is: high, moderate, low or very low.',
  'RoB 2': 'The Cochrane tool for judging the risk of bias of a randomized trial, domain by domain.',
  'ROBINS-I': 'The tool for judging the risk of bias of a non-randomized study of an intervention.',
  'PRISMA': 'The reporting guideline for systematic reviews: a checklist and the flow diagram of the records found, screened and included.',
  'meta-analysis': 'Combining the results of several studies into one estimate, each weighted by its precision.',
  'risk of bias': 'How likely a study\'s design or conduct is to have pushed its result away from the truth.',
  'evidence table': 'The table of what each included study reports: design, patients, follow-up and results.',
  'full text': 'The whole article, not only its title and abstract.',
  'I²': 'The share of the variation between studies that is not due to chance; above 75% is considered high.',
  'SWiM': 'Synthesis without meta-analysis: the direction of each study\'s effect, summarized when results cannot be pooled.',
});

const terms = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');

/** `text` as HTML with each glossary term marked once (its first use), its definition the tooltip. Everything else is escaped. */
export function withTerms(text) {
  const seen = new Set();
  return String(text ?? '').split(pattern).map((part, i) => {
    if (i % 2 === 0) return esc(part);
    const key = terms.find(t => t.toLowerCase() === part.toLowerCase());
    if (!key || seen.has(key)) return esc(part);
    seen.add(key);
    return `<abbr class="term" title="${esc(GLOSSARY[key])}">${esc(part)}</abbr>`;
  }).join('');
}
