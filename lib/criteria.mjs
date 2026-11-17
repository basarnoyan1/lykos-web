// Eligibility criteria from prose.
//
// A protocol arrives as a paragraph. A generative model turns it into rules
// (plan A3: stable id, one testable statement, the stage it applies at) and
// writes, for each, the one positive statement Jev will test and what
// counts as true or false. Jev cannot write, so this is the only place a
// text model is used for criteria. The result is a proposal; the protocol
// changes only when a person accepts it.
import { complete, configured } from './ai.mjs';
import { CRITERIA_STRUCTURE, fence } from './prompts.mjs';

const MAX_RULES = 24;
const KINDS = new Set(['include', 'exclude', 'group']);

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The model's JSON as rules: kinds and stages normalised, empties dropped. */
export function rulesOf(json) {
  const list = Array.isArray(json?.rules) ? json.rules : [];
  return list.filter(r => r && clip(r.text, 1)).slice(0, MAX_RULES).map(r => {
    const k = String(r.kind || '').toLowerCase();
    return { text: clip(r.text, 240), kind: KINDS.has(k) ? k : k === 'label' ? 'group' : 'include',
      stage: /full/i.test(String(r.stage || '')) ? 'Full text' : 'Title/abstract',
      question: clip(r.question, 240), yes: clip(r.yes, 300), no: clip(r.no, 300) };
  });
}

export async function structureCriteria(text, cfg, { signal } = {}) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Paste the criteria first');
  if (!configured(cfg)) throw new Error('No model configured for writing');
  const out = await complete(cfg, [
    { role: 'system', content: CRITERIA_STRUCTURE.text(MAX_RULES) },
    { role: 'user', content: fence('protocol', t.slice(0, 16000)) },
  ], { signal, temperature: 0, json: true, prompt: CRITERIA_STRUCTURE });
  const m = String(out).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No rules in the reply');
  const j = JSON.parse(m[0]);
  const pico = {}; for (const k of ['population', 'intervention', 'comparator', 'outcome', 'design']) if (clip(j.pico?.[k], 1)) pico[k] = clip(j.pico[k], 300);
  return { title: clip(j.title, 200), pico, rules: rulesOf(j) };
}

const norm = s => String(s || '').trim().toLowerCase();

/** Existing criteria plus the proposed ones that are new, numbered on. */
export function mergeRules(existing, proposed) {
  const have = new Set(existing.map(c => norm(c.text)));
  const out = existing.slice();
  for (const r of proposed) {
    if (have.has(norm(r.text))) continue;
    have.add(norm(r.text));
    out.push({ id: `C${out.length + 1}`, text: r.text, stage: r.stage, kind: r.kind, question: r.question || '', yes: r.yes || '', no: r.no || '' });
  }
  return out;
}

const CRITERIA_HEAD = /eligib|inclusion|exclusion|criteria/i, SELECTION_HEAD = /study selection/i;   // a heading that names the criteria wins over one on selection
const levelOf = b => (/^h([1-6])$/.exec(b?.type || '') ? Number(RegExp.$1) : b?.type === 'title' ? 0 : null);
/**
 * The eligibility text a manuscript or protocol already holds: the paragraphs under its first heading that names the criteria ("Inclusion
 * and Exclusion Criteria", "Eligibility"), up to the next heading at that level or above; '' when no such heading has text under it.
 */
export function criteriaSection(blocks = []) {
  const list = Array.isArray(blocks) ? blocks : [];
  const find = re => list.findIndex(b => levelOf(b) != null && re.test(String(b.text || '')));
  const i = find(CRITERIA_HEAD) >= 0 ? find(CRITERIA_HEAD) : find(SELECTION_HEAD);
  if (i < 0) return '';
  const lvl = levelOf(list[i]), out = [];
  for (const b of list.slice(i + 1)) {
    const l = levelOf(b);
    if (l != null && l <= lvl) break;
    const t = String(b.text || '').trim();
    if (t) out.push(t);
  }
  return out.join('\n\n').slice(0, 16000);
}
