// Submission readiness for the target journal, as a grade (owner, 2026-10-18: "add a scoring thing if the paper would be accepted in the
// current state to the target journal"; 2026-10-19: "make it mostly accurate and helpful", "it may depend on the impact factor range of the
// journal"). No study found validates a checklist score against editors' decisions, so this is not a chance of acceptance: it scores what the
// app can check, each point traceable to a page, and it caps the grade where a journal is likely to return the paper unread (a required
// statement, section or limit missing: desk rejection most often follows missing declarations and technical requirements) or where the
// journal's standing expects more than the paper shows (a selective journal expects a registered protocol, a complete PRISMA checklist and
// GRADE; a highly selective one also current analyses, complete risk of bias and a data availability statement).
//
// A part it cannot judge is not assessed rather than scored as nothing: the journal's requirements and the analyses the paper uses are read
// from the manuscript, so a manuscript that is not the review (a Perspective in a meta-analysis project) leaves both unassessed, and says so.
// The score is the share of the points it could assess; below three quarters of them it is not graded. Pure: the Overview gathers the inputs
// (lib/overview-facts.mjs readinessFacts) and draws the result.

/** The grade bands: the lowest score of each, its letter, and what it says. */
export const GRADES = Object.freeze([[90, 'A', 'Ready to submit'], [80, 'B', 'Nearly ready'], [70, 'C', 'Needs work'], [60, 'D', 'Not ready'], [0, 'F', 'Not ready']]);
/** The highest score with a required journal item missing, and with an expectation of the journal's tier unmet. */
export const MISSING_CAP = 69;
export const EXPECT_CAP = 79;
/** A graded score needs this many of the 100 points assessed. */
export const GRADED_FROM = 75;
/** The journal's tier by its impact factor (or, without one, OpenAlex's two-year mean citedness, which is computed the same way). */
export const TIERS = Object.freeze([[10, 'leading', 'Leading'], [5, 'highly', 'Highly selective'], [2, 'selective', 'Selective'], [0, 'standard', 'Standard']]);
const RANK = { standard: 0, selective: 1, highly: 2, leading: 3 };

const share = (part, whole) => (whole > 0 ? Math.max(0, Math.min(1, part / whole)) : null);
const plural = (n, one, many) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
const round1 = x => Math.round(x * 10) / 10;
const given = v => v != null && v !== '' && Number.isFinite(Number(v));

/** The letter and words of a score 0–100. */
export function gradeOf(score) {
  const [, letter, word] = GRADES.find(([min]) => score >= min) || GRADES.at(-1);
  return { letter, word };
}

/** The journal's tier from what is known of its standing ({ impactFactor } entered, or { citedness } from OpenAlex); null with neither. */
export function tierOf(standing) {
  const own = given(standing?.impactFactor), value = own ? Number(standing.impactFactor) : given(standing?.citedness) ? Number(standing.citedness) : null;
  if (value == null) return null;
  const [, id, label] = TIERS.find(([min]) => value >= min);
  return { id, label, value, from: own ? 'impact factor' : '2-year citedness' };
}

// A requirement's weight in the journal part: what a journal returns a paper for weighs most, a matter of style least.
const CORE_SECTION = /^(introduction|methods?|results?|discussion|conclusions?)$/i;
const SECTION_WEIGHT = { Limits: 3, Abstract: 2, Statements: 3, 'Figures and tables': 1, Consistency: 0.5, 'Manuscript checks': 1, 'Retractions and corrections': 3 };
/** The journal part's items: the report's checks a journal asks for, each once, weighted; the app's own hints (a number that could be linked, notes) left out. */
export function journalItems(report) {
  const out = [], seen = new Set();
  for (const sec of report?.sections || []) for (const it of sec.items) {
    if (sec.title === 'Manuscript checks' && (it.detail === 'unlinked' || /^\d+ notes?$/.test(it.label) || it.label === 'No issues')) continue;
    const key = `${sec.title}|${it.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const w = sec.title === 'Sections' ? (CORE_SECTION.test(it.label) ? 3 : 1) : SECTION_WEIGHT[sec.title] ?? 1;
    out.push({ section: sec.title, label: it.label, state: it.state, w });
  }
  return out;
}

/**
 * The score of a review. Each input is what its page already counts:
 * - `screening`: { identified, left }; `cells`: { filled, nr, total } (NR counts as answered); `appraisal`: { complete, of }
 * - `analyses`: { current, stale, notRun, unused } (of the analyses the paper uses: current, changed since run, set up but not run; and those
 *   it does not use); `certainty`: { rated, of } (outcomes with a GRADE rating, of those analysed or listed)
 * - `prisma`: { filled, total } (the counts of the branches the flow diagram draws); `checklist`: { done, na, total } (its reporting checklist)
 * - `report`: lib/submission-checks.mjs readinessReport's sections, or null with no manuscript; `profile`: whether the journal has a profile
 * - `models`: { written, unchecked } (values, GRADE footnotes and patient rows a model wrote; reading notes are not the paper's)
 * - `fit`: { ok, reason } (whether the manuscript is the review: false leaves the analyses and the journal's requirements unassessed)
 * - `standing`: { impactFactor?, citedness? }; `registered`: whether a protocol registration is recorded
 * Returns { score (null when not graded), pct, graded, assessed, letter, word, capped, caps: [{ at, why }], missing, tier, expectations, parts }.
 */
export function readinessScore({ screening = null, cells = null, appraisal = null, analyses = null, certainty = null, prisma = null, checklist = null,
  report = null, profile = false, models = null, fit = { ok: true }, standing = null, registered = false } = {}) {
  const part = (id, label, max, go, items) => {
    // a part is the weighted mean of its items that apply; with none, it is not assessed and says why
    const live = items.filter(i => i.share != null), weight = live.reduce((t, i) => t + i.w, 0);
    if (!weight) return { id, label, max, go, assessed: false, got: 0, detail: `Not assessed: ${(items.find(i => i.none)?.none || 'nothing to check yet').replace(/^./, c => c.toLowerCase())}` };
    const got = max * live.reduce((t, i) => t + i.w * i.share, 0) / weight;
    return { id, label, max, go, assessed: true, got: round1(got), detail: live.filter(i => i.share < 1).map(i => i.say).join(' · ') || 'Complete' };
  };
  const unassessed = (id, label, max, go, why) => ({ id, label, max, go, assessed: false, got: 0, detail: `Not assessed: ${why}` });
  const used = analyses ? analyses.current + analyses.stale + analyses.notRun : 0;
  const parts = [
    part('evidence', 'Evidence base', 20, 'extraction', [
      { w: 4, share: screening?.identified ? share(screening.identified - (screening.left || 0), screening.identified) : null, say: `${plural(screening?.left || 0, 'record', 'records')} to screen`, none: 'No records yet' },
      { w: 8, share: cells?.total ? share(cells.filled + cells.nr, cells.total) : null, say: `${plural(cells ? cells.total - cells.filled - cells.nr : 0, 'empty cell', 'empty cells')}` },
      { w: 8, share: appraisal?.of ? share(appraisal.complete, appraisal.of) : null, say: `${plural(appraisal ? appraisal.of - appraisal.complete : 0, 'study', 'studies')} not appraised` }]),
    fit && !fit.ok ? unassessed('analysis', 'Analyses and certainty', 25, 'analysis', fit.reason)
      : part('analysis', 'Analyses and certainty', 25, 'analysis', [
        // an analysis the paper does not use is no evidence for it: analyses that exist with none used score nothing, and say so
        { w: 12, share: used ? share(analyses.current, used) : analyses?.unused ? 0 : null, none: 'No analyses yet',
          say: used ? [analyses.stale ? `${plural(analyses.stale, 'analysis', 'analyses')} changed since run` : '', analyses.notRun ? `${plural(analyses.notRun, 'outcome', 'outcomes')} not run` : ''].filter(Boolean).join(' · ')
            : `${plural(analyses?.unused || 0, 'unused analysis', 'unused analyses')}` },
        { w: 13, share: certainty?.of ? share(certainty.rated, certainty.of) : null, say: `${plural(certainty ? certainty.of - certainty.rated : 0, 'unrated outcome', 'unrated outcomes')}`, none: 'No outcome to rate' }]),
    part('reporting', 'Reporting', 20, 'reporting', [
      { w: 8, share: prisma?.total ? share(prisma.filled, prisma.total) : null, say: `${plural(prisma ? prisma.total - prisma.filled : 0, 'blank PRISMA count', 'blank PRISMA counts')}`, none: 'No flow diagram' },
      { w: 12, share: checklist?.total ? share(checklist.done + checklist.na, checklist.total) : null, say: `${plural(checklist ? checklist.total - checklist.done - checklist.na : 0, 'checklist item', 'checklist items')} not reviewed` }]),
    !report ? unassessed('journal', 'Journal requirements', 25, 'manuscript', 'no manuscript yet')
      : fit && !fit.ok ? unassessed('journal', 'Journal requirements', 25, 'manuscript', fit.reason)
      : journalPart(report, profile),
    part('checked', 'Checked by a person', 10, 'extraction', [
      { w: 1, share: models ? (models.written ? share(models.written - models.unchecked, models.written) : 1) : null, say: `${plural(models?.unchecked || 0, 'unchecked model value', 'unchecked model values')}` }]),
  ];
  if (parts[4].assessed && models && !models.written) parts[4].detail = 'Nothing in the review data was written by a model';

  const live = parts.filter(p => p.assessed), assessed = live.reduce((t, p) => t + p.max, 0), got = live.reduce((t, p) => t + p.got, 0);
  const pct = assessed ? Math.round(100 * got / assessed) : 0;

  // what the journal's tier expects, and the caps
  const tier = tierOf(standing), at = RANK[tier?.id] ?? 0, journalOk = parts[3].assessed;
  const statement = name => report?.sections.find(x => x.title === 'Statements')?.items.find(i => i.label === name);
  const expectations = [
    ...(at >= 1 ? [
      { label: 'a registered protocol', met: !!registered || statement('Registration')?.state === 'ok' },
      { label: 'a complete PRISMA checklist', met: !!checklist?.total && share(checklist.done + checklist.na, checklist.total) >= 0.9 },
      { label: 'GRADE for every analysed outcome', met: !!certainty?.of && certainty.rated === certainty.of }] : []),
    ...(at >= 2 ? [
      ...(parts[1].assessed ? [{ label: 'every analysis current', met: !!used && analyses.stale === 0 && analyses.notRun === 0 }] : []),
      { label: 'risk of bias for every study', met: !!appraisal?.of && appraisal.complete === appraisal.of },
      ...(journalOk ? [{ label: 'a data availability statement', met: statement('Data availability')?.state === 'ok' }] : [])] : []),
  ];
  const missing = journalOk ? journalItems(report).filter(i => i.state === 'missing').length : 0, unmet = expectations.filter(e => !e.met);
  const caps = [...(missing ? [[MISSING_CAP, `${plural(missing, 'required item', 'required items')} missing`]] : []),
    ...(unmet.length ? [[EXPECT_CAP, `${tier.label.toLowerCase()} journals expect ${unmet.map(e => e.label).join(', ')}`]] : [])];
  const graded = assessed >= GRADED_FROM;
  const cap = caps.length ? Math.min(...caps.map(c => c[0])) : 100;
  const score = graded ? Math.min(pct, cap) : null;
  return { score, pct, graded, assessed, got: round1(got), ...(graded ? gradeOf(score) : { letter: null, word: 'Not graded' }),
    capped: graded && pct > cap, caps: graded ? caps.filter(c => pct > c[0]).map(([at, why]) => ({ at, why })) : [], missing, tier, expectations, parts };
}

/** The journal's requirements: the Submission page's checks a journal asks for, weighted, a check met counting in full, one to review half. */
function journalPart(report, profile) {
  const base = { id: 'journal', label: 'Journal requirements', max: 25, go: 'manuscript', assessed: true };
  const items = journalItems(report);
  if (!items.length) return { ...base, assessed: false, got: 0, detail: 'Not assessed: nothing to check yet' };
  const w = items.reduce((t, i) => t + i.w, 0), got = 25 * items.reduce((t, i) => t + i.w * (i.state === 'ok' ? 1 : i.state === 'warn' ? 0.5 : 0), 0) / w;
  const missing = items.filter(i => i.state === 'missing'), warn = items.filter(i => i.state === 'warn');
  const said = [missing.length ? `Missing: ${missing.map(i => i.label).join(', ')}` : '', warn.length ? `${warn.length} to review` : '', profile ? '' : 'generic checks: no profile for this journal'].filter(Boolean).join(' · ');
  return { ...base, got: round1(got), detail: said || 'Complete' };
}
