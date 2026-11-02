// The rule a risk-of-bias overall judgement follows, one place for every reader (plan §6): the overall a study's domains give
// (derivedOverall), the overall a sweep reads (lib/rob-sweep.mjs), the guide's words for it (lib/rob-guide.mjs) and the output check
// (lib/output-agreement.mjs robRuleFindings, tools/lykos-check-outputs.mjs).
//
// A project sets it per instrument in .lykos/build.json "checks":
//   "robOverall": { "rob2": "worst-domain" }                                  the default, for every instrument
//   "robOverall": { "rob2": { "rule": "multiple-some-concerns", "n": 3 } }    RoB 2 only
// worst-domain: the overall is at least the most severe domain, and one step above it only with two or more domains at that step
// (ROBINS-I: Critical with two or more Serious; RoB 2: High with two or more Some concerns), the tool's own reason.
// multiple-some-concerns (the Cochrane Handbook's RoB 2 form, with "multiple" fixed at n, 2 when not given): High if any domain is High,
// or n or more domains have Some concerns; Low if every domain is Low; otherwise Some concerns. The overall is then exactly that.
// Pure: nothing here reads the folder; the caller passes the "checks" object (setProjectChecks keeps the open project's for a view).

export const ROB_OVERALL_RULES = ['worst-domain', 'multiple-some-concerns'];
const ROBINS = ['Low', 'Moderate', 'Serious', 'Critical'], ROB2 = ['Low', 'Some concerns', 'High'];
const WORST = Object.freeze({ id: 'worst-domain' });

/** The order of an instrument's judgements from least to most risk (unranked ones, such as Not assessed, are null). */
export function rankOf(tool, judgement) {
  const j = String(judgement || '');
  if (!j || (tool.unranked || []).includes(j) || /^(not assessed|no information|not applicable)$/i.test(j)) return null;
  if (/^low \(except/i.test(j)) return 0.5;
  const order = { Yes: 0, Low: 0, Unclear: 1, 'Some concerns': 1, Moderate: 1, No: 2, High: 2, Serious: 2, Critical: 3 };
  if (j in order) return order[j];
  const i = (tool.judgements || []).indexOf(j);
  return i < 0 ? null : i;
}

/** The ranked levels of an instrument, least risk first: ROBINS-I's, RoB 2's, else the instrument's own judgements (null when it has none). */
export function levelsOf(tool) {
  const id = String(tool?.id || '');
  if (/robins/i.test(id)) return ROBINS;
  if (id === 'rob2') return ROB2;
  const own = (tool?.judgements || []).filter(j => !(tool.unranked || []).includes(j));
  return own.length ? own : null;
}

/** What is wrong with a project's "robOverall" setting, as sentences; empty when it is valid or absent. */
export function robOverallProblems(checks) {
  const conf = checks?.robOverall, out = [];
  if (conf == null) return out;
  if (typeof conf !== 'object' || Array.isArray(conf)) return ['checks.robOverall must be an object of instrument ids'];
  for (const [tool, v] of Object.entries(conf)) {
    const rule = typeof v === 'string' ? v : v?.rule;
    if (!ROB_OVERALL_RULES.includes(rule)) { out.push(`checks.robOverall.${tool}: rule must be one of ${ROB_OVERALL_RULES.join(', ')}`); continue; }
    if (rule === 'multiple-some-concerns') {
      if (tool !== 'rob2') out.push(`checks.robOverall.${tool}: multiple-some-concerns is a RoB 2 rule`);
      if (v?.n != null && !(Number.isInteger(v.n) && v.n >= 2)) out.push(`checks.robOverall.${tool}.n must be a whole number of 2 or more`);
    }
  }
  return out;
}

/** The rule an instrument's overall follows in a project: { id: 'worst-domain' } or { id: 'multiple-some-concerns', n }. An invalid setting is the default. */
export function robOverallRule(checks, toolId) {
  const v = checks?.robOverall?.[toolId];
  const rule = typeof v === 'string' ? v : v?.rule;
  if (rule !== 'multiple-some-concerns' || toolId !== 'rob2') return WORST;
  const n = v?.n == null ? 2 : v.n;
  return Number.isInteger(n) && n >= 2 ? { id: rule, n } : WORST;
}

/** The rule in words, for the guide and a finding. */
export function ruleText(rule) {
  return rule?.id === 'multiple-some-concerns'
    ? `High if any domain is High or ${rule.n} or more have some concerns; Low if every domain is Low; otherwise Some concerns`
    : 'At least the most severe domain';
}

/**
 * The overall a rule gives for these domain judgements (a list, or a map by domain id; judgements outside the instrument's levels, such as
 * Not assessed, are left out). { value, exact, drivers }: `value` null when nothing is ranked or, for an exact rule, while a domain that
 * could change it is unjudged; `exact` true when the rule fixes the overall (multiple-some-concerns), false when it is a floor the
 * reviewer may go one step above with the tool's reason (worst-domain); `drivers` the domain ids (or list positions) that decide it.
 */
export function derivedOverall(tool, judgements, rule = WORST) {
  const levels = levelsOf(tool) || [], out = { value: null, exact: rule?.id === 'multiple-some-concerns', drivers: [] };
  const entries = Array.isArray(judgements) ? judgements.map((v, i) => [String(i), v])
    : (tool?.domains?.length ? tool.domains.map(d => [d.id, judgements?.[d.id]]) : Object.entries(judgements || {}));
  const ranked = entries.filter(([, v]) => levels.includes(v));
  if (!entries.some(([, v]) => rankOf(tool, v) != null)) return out;
  const at = lv => ranked.filter(([, v]) => v === lv).map(([k]) => k);
  if (!out.exact) {
    // any judgement the instrument ranks (rankOf: a ROBINS-I V2 "Low (except …)" sits between Low and Moderate)
    const all = entries.filter(([, v]) => rankOf(tool, v) != null), worst = Math.max(...all.map(([, v]) => rankOf(tool, v)));
    const value = all.find(([, v]) => rankOf(tool, v) === worst)[1];
    return { ...out, value, drivers: all.filter(([, v]) => rankOf(tool, v) === worst).map(([k]) => k) };
  }
  const missing = entries.length - ranked.length;
  if (at('High').length) return { ...out, value: 'High', drivers: at('High') };
  if (at('Some concerns').length >= rule.n) return { ...out, value: 'High', drivers: at('Some concerns') };
  if (missing) return out;   // an unjudged domain could still make it High (or keep it from Low)
  if (ranked.every(([, v]) => v === 'Low')) return { ...out, value: 'Low', drivers: ranked.map(([k]) => k) };
  return { ...out, value: 'Some concerns', drivers: at('Some concerns') };
}

/** Whether a recorded overall follows the rule from its domains: '' when it does (or there is nothing to judge it by), else the finding's text. */
export function overallFinding(tool, judgements, overall, rule = WORST) {
  const levels = levelsOf(tool);
  if (!levels || !levels.includes(overall)) return '';
  // only the instrument's own levels count here; anything else is as unjudged
  const keep = j => (levels.includes(j) ? j : '');
  const own = Array.isArray(judgements) ? judgements.map(keep) : Object.fromEntries(Object.entries(judgements || {}).map(([k, v]) => [k, keep(v)]));
  const list = Object.values(own);
  const d = derivedOverall(tool, own, rule);
  if (d.value == null || !levels.includes(d.value)) return '';
  if (d.exact) return overall === d.value ? '' : `overall ${overall}, the project's rule gives ${d.value} (${ruleText(rule)})`;
  const o = levels.indexOf(overall), worst = levels.indexOf(d.value);
  const second = levels[levels.length - 2], many = list.filter(j => j === second).length >= 2;
  if (o < worst) return `overall ${overall} is below its most severe domain (${d.value})`;
  if (o > worst && !(o === levels.length - 1 && worst === levels.length - 2 && many)) return `overall ${overall} is above its most severe domain (${d.value}) without the tool's reason`;
  return '';
}

/**
 * The overall an instrument's own algorithm gives with no reviewer's step up: the most severe domain (RoB 2: Low when every domain is Low,
 * High when any is High, else Some concerns). A review whose rule is another (multiple-some-concerns) reports it beside its own overall, as a
 * sensitivity (the Sham response review's S24): `severestColumn` is that column for a figure or grid, null when the rule already is this one.
 */
export const severestOf = (tool, answers) => {
  const own = Object.fromEntries((tool?.domains || []).map(d => [d.id, answers?.[d.id]]));
  return derivedOverall(tool, own, WORST).value || '';
};
export const SEVEREST = 'overall-severest';
export function severestColumn(tool, rule) {
  if (!tool?.overall || rule?.id !== 'multiple-some-concerns') return null;
  const rob2 = tool.id === 'rob2';
  return { id: SEVEREST, short: rob2 ? 'Algorithm' : 'Most severe', label: rob2 ? 'Overall, RoB 2 algorithm' : 'Overall, most severe domain', overall: true };
}

// ---- the open project's setting, for a view that renders synchronously ----
let projectChecks = null, projectKey = 'null';
/** Keeps the open project's build.json "checks"; answers true when the rules changed (the caller then renders again). */
export function setProjectChecks(checks) {
  const key = JSON.stringify(checks?.robOverall ?? null);
  if (key === projectKey) return false;
  projectChecks = checks || null; projectKey = key;
  return true;
}
/** The rule an instrument's overall follows in the open project (setProjectChecks), the default until it is known. */
export const projectRule = toolId => robOverallRule(projectChecks, toolId);
