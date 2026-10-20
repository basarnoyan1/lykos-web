// Which table Extraction opens first: the one that holds the project's values when the default table holds none.
// Its own module: only the Extraction page needs it, and the start-up graph has a size budget.
import { get } from '../store.mjs';
import { columnsOf, templateById } from './templates.mjs';
import { keyInColumns } from './arms.mjs';
import { filterPapers } from './paper-search.mjs';

/** How many values a table holds. */
export function valuesIn(id, s = get()) {
  const cols = new Set(columnsOf(id, s).map(c => c.id));
  let n = 0;
  for (const k of Object.keys(s.values || {})) if (keyInColumns(k, cols)) n++;
  return n;
}
/** The table to open first: the default table, unless it holds no values and another table holds some, then the one holding most. */
export function tableWithData(s = get()) {
  if (valuesIn('default', s)) return 'default';
  const best = (s.templates || []).map(t => [t.id, valuesIn(t.id, s)]).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] ? best[0] : 'default';
}

/**
 * The table Extraction shows, given the one it showed (`id`): that one while it exists, else the one holding most values (an evidence update
 * replaced it, it was removed elsewhere, none was chosen). On a project's first visit (`fresh`) the built-in table gives way to the table that
 * holds the data when it holds none itself.
 */
export function tableToShow(id, s = get(), { fresh = false } = {}) {
  if (!id || !templateById(id, s) || (fresh && id === 'default')) return tableWithData(s);
  return id;
}

/** The filter box: a study matches when every term is in its record (label, title, authors, year, DOI) or in what its cells hold. `hayOf(paper)` is that cell text. */
export function findStudies(papers, query, hayOf) {
  return filterPapers(papers, query, hayOf);
}
