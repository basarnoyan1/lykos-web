// The target journal's standing, for submission readiness (lib/readiness-score.mjs tierOf): the impact factor a person enters, or else the
// journal's two-year mean citedness from OpenAlex, which is computed as the impact factor is (citations in a year to the two years before,
// per item) from open data. It follows the impact factor in the range most journals are in (measured 2026-10-19: International Journal of
// Spine Surgery 1.6, European Spine Journal 2.1, Spine 2.8) and falls short of it for the leading journals and for young ones, so it decides
// only a coarse tier, and an entered impact factor wins. Kept in the project as `journalStanding`: { journal, impactFactor?, citedness?,
// hIndex?, name?, openalexId?, issns?, homepage?, publisher?, oa?, doaj?, apc?, v, at, error? }. One OpenAlex request per journal (a filtered
// list: one credit), again after 60 days, or once more when kept before the publisher, open access and APC were read (v < 2).
import { targetJournal } from './journal-context.mjs';

const FRESH = 60 * 864e5, RETRY = 864e5, V = 2;
/** A journal's name as compared: case, a leading "The" and punctuation set aside. */
export const journalKeyOf = t => String(t || '').toLowerCase().replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

/** What is kept of the target journal's standing, or null (none yet, or it is of another journal). */
export function standingOf(s) {
  const st = s.journalStanding, j = targetJournal(s);
  return st && j && journalKeyOf(st.journal) === journalKeyOf(j) ? st : null;
}

/** Whether the target journal's citedness should be looked up now: none kept, or kept long enough ago (an entered impact factor is enough). */
export function standingNeeded(s, now = Date.now()) {
  if (!targetJournal(s)) return false;
  const st = standingOf(s);
  if (!st) return true;
  const age = now - (Date.parse(st.at || 0) || 0);
  if (!st.error && (st.v || 1) < V) return true;   // kept before the publisher, open access and APC were read
  if (st.impactFactor != null && st.impactFactor !== '') return false;
  return age > (st.error ? RETRY : FRESH);
}

/** The journal OpenAlex lists under this name: the one whose name is the same once compared, among those with at least 50 works; else null. */
export function pickSource(results, journal) {
  const key = journalKeyOf(journal);
  return (results || []).filter(r => (r.works_count || 0) >= 50 && journalKeyOf(r.display_name) === key).sort((a, b) => (b.works_count || 0) - (a.works_count || 0))[0] || null;
}

/** Looks the journal up in OpenAlex: { journal, citedness, hIndex, name, openalexId, at }, or { journal, at, error } when it is not found. */
export async function fetchStanding(journal, { signal } = {}) {
  const [src, ms] = await Promise.all([import('./sources.mjs'), import('./model-settings.mjs')]);
  const r = await src.openalexJson('/sources', { filter: `display_name.search:${String(journal).replace(/[,:|]/g, ' ')}`, select: 'id,display_name,summary_stats,works_count,issn_l,issn,homepage_url,host_organization_name,is_oa,is_in_doaj,apc_usd', per_page: 10 },
    { settings: ms.settings(), signal });
  const at = new Date().toISOString(), best = pickSource(r?.results, journal);
  if (!best) return { journal, at, error: 'Not found in OpenAlex' };
  return { journal, at, name: best.display_name, openalexId: best.id, citedness: Math.round((best.summary_stats?.['2yr_mean_citedness'] || 0) * 100) / 100, hIndex: best.summary_stats?.h_index ?? null,
    issns: [...new Set([best.issn_l, ...(best.issn || [])].filter(Boolean))],
    homepage: best.homepage_url || '', publisher: best.host_organization_name || '', oa: !!best.is_oa, doaj: !!best.is_in_doaj, apc: Number.isFinite(best.apc_usd) ? best.apc_usd : null, v: V };   // the journal's ISSNs, by which SCImago's ranks are matched (lib/sjr.mjs)
}
