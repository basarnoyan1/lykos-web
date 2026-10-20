// Checks before a manuscript goes to a journal: its counts against the
// journal's limits (lib/journal-profiles.mjs), its figures and tables cited in
// order, its spelling and number style used consistently, the sections its
// study design and the journal ask for, and a copy with the authors blinded.
//
// Like lib/manuscript-checks.mjs, every finding is something a reader could
// verify by hand, and nothing is corrected in place: `blindedCopy` returns a
// new block list and leaves the document alone.

import { citations, resultTokens, sections, wordCount, numbering } from './manuscript.mjs';
import { classifyStructure, structureCounts, isHeading } from './manuscript-structure.mjs';
import { textOfRuns } from './manuscript-format.mjs';
import { familyName, initials } from './bib.mjs';
import { headingNames, REQUIREMENTS } from './journal-profiles.mjs';

const strip = t => String(t || '').replace(/\[@[^\]]*\]|\{\{[^}]*\}\}/g, ' ').replace(/[ \t]+/g, ' ').trim();
// "2.1 Methods:" names the section "Methods".
const bare = t => strip(t).replace(/^((\d+(\.\d+)*|[IVXLC]+|[A-Z])[.)]\s+|\d+(\.\d+)*\s+)/, '').replace(/[.:]\s*$/, '').trim();
const uniq = a => [...new Set(a)];
// A heading by its level, or, in an imported document, by how its runs are set
// (lib/manuscript-structure.mjs). A paragraph typed here has no runs, and a
// short one is not a heading for that.
const headingLike = b => /^h[1-3]$/.test(b?.type) || Boolean(b?.runs?.length) && isHeading(b);

// ---- structure, with a structured abstract kept whole ------------------------------

/**
 * Block roles as lib/manuscript-structure.mjs reads them, with one correction:
 * everything between an "Abstract" heading and the next heading at its level
 * is the abstract. A structured abstract written with subheadings ("Methods",
 * "Results") would otherwise start the main text at its own second heading.
 */
export function submissionRoles(blocks) {
  const roles = classifyStructure(blocks);
  const level = b => b.type === 'h1' ? 1 : b.type === 'h2' ? 2 : b.type === 'h3' ? 3 : 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!level(b) || !/^(abstract|summary|structured abstract)$/i.test(bare(b.text))) continue;
    roles[i] = 'abstract';
    for (let j = i + 1; j < blocks.length; j++) {
      const lj = level(blocks[j]);
      if (lj && lj <= level(b)) break;
      if (roles[j] === 'keywords') continue;
      roles[j] = /^\s*(key ?words?|index terms)\s*[:.]/i.test(strip(blocks[j].text)) ? 'keywords' : 'abstract';
    }
  }
  // A Keywords heading's paragraphs are the keywords, not more abstract.
  for (let i = 0; i < blocks.length; i++) {
    if (!(level(blocks[i]) || headingLike(blocks[i])) || !/^(key ?words?|index terms)$/i.test(bare(blocks[i].text))) continue;
    roles[i] = 'keywords';
    for (let j = i + 1; j < blocks.length && !level(blocks[j]) && !headingLike(blocks[j]); j++) roles[j] = 'keywords';
  }
  return roles;
}

/** The keywords as a list, from a "Keywords:" line or a Keywords section. */
export function keywordList(blocks, roles = submissionRoles(blocks)) {
  const out = [];
  blocks.forEach((b, i) => {
    if (roles[i] !== 'keywords' || !strip(b.text)) return;
    const t = strip(b.text);
    if (/^h[1-3]$/.test(b.type) || headingLike(b) && /^(key ?words?|index terms)$/i.test(bare(t))) return;
    out.push(...t.replace(/^\s*(key ?words?|index terms)\s*[:.]\s*/i, '').replace(/\.$/, '').split(/\s*[;,·•|]\s*/).map(s => s.trim()).filter(Boolean));
  });
  return out;
}

// ---- counts against a profile --------------------------------------------------------

const isSupp = kind => String(kind || '').startsWith('supp');

/**
 * The counts a journal limits, beside the profile's limits. Rows are:
 * 'Words in main text', 'Abstract words', 'References', 'Figures and tables',
 * 'Title characters', 'Keywords'. A profile without a limit gives `limit: null`
 * and is never over.
 *
 * Main text is counted as lib/manuscript-structure.mjs counts it: the words of
 * the paragraphs from the first section after the abstract through the
 * conclusions, with citation and result tokens not counted as words and
 * headings not counted; the title, authors, abstract, keywords, back matter
 * (acknowledgements, funding, statements), references, figure legends, tables
 * and appendices are outside it. Abstract words are the abstract's paragraphs,
 * run-in labels ("Methods:") included, its subheadings not. References are the
 * reference list's entries, or the number of distinct works cited when the list
 * is generated from the live body, table cells, used notes and running content.
 * Pass the manuscript's notes and section with its blocks. Figures and tables are the main (not
 * supplementary) figure and table assets plus images and tables placed in the
 * document itself.
 */
export function countsAgainstProfile(blocks, profile = {}, { assets = [], notes = {}, section = null } = {}) {
  const roles = submissionRoles(blocks);
  const s = structureCounts(blocks, { roles, citedCount: numbering(blocks, { notes, section }).size });
  const abstractWords = blocks.reduce((n, b, i) => n + (roles[i] === 'abstract' && !/^h[1-3]$/.test(b.type) && !(headingLike(b) && /^(abstract|summary)$/i.test(bare(b.text))) ? wordCount(b.text || '') : 0), 0);
  const refs = s.excluded.find(e => e.role === 'references')?.items || 0;
  const display = assets.filter(a => !isSupp(a.kind) && (a.kind === 'figure' || a.kind === 'table')).length
    + blocks.filter(b => b.type === 'figure' || b.type === 'table').length;
  const kw = keywordList(blocks, roles).length;
  const row = (what, value, limit) => ({ what, value, limit: limit ?? null, over: limit != null && value > limit });
  const rows = [
    row('Words in main text', s.main.words, profile.wordLimit),
    row('Abstract words', abstractWords, profile.abstractLimit),
    row('References', refs, profile.referenceLimit),
    row('Figures and tables', display, profile.figureTableLimit),
    row('Title characters', s.title?.characters || 0, profile.titleLimitChars),
  ];
  const k = profile.keywords;
  rows.push({ what: 'Keywords', value: kw, limit: k ? { min: k.min ?? null, max: k.max ?? null } : null,
    over: Boolean(k && k.max != null && kw > k.max), under: Boolean(k && k.min != null && kw < k.min) });
  return rows;
}

// ---- figures and tables ------------------------------------------------------------

// As views/manuscript.mjs numbers them: by kind, in the order of the list.
const ASSET_KINDS = { figure: 'Figure ', table: 'Table ', 'supp-figure': 'Figure S', 'supp-table': 'Table S' };
export function assetLabel(a, assets) {
  const n = assets.filter(x => x.kind === a.kind).findIndex(x => x.id === a.id) + 1;
  return `${ASSET_KINDS[a.kind] || 'Item '}${n}`;
}

// "Figure 2", "Fig. 2A", "Figures 2 and 3", "Tables 1–3", "Table S1"
const LITERAL = /\b(Fig(?:ure)?s?\.?|Tables?)\s+(S?\d+[A-Za-z]?(?:\s*(?:,|and|&|–|-|to)\s*S?\d+[A-Za-z]?)*)/g;
const LEGEND = /^\s*(fig(?:ure)?\.?|table)\s*S?\d+[a-z]?\s*[.:|]/i;

/** Each written-out mention of a figure or table, as `{ kind, n }` (ranges expanded; `supp-` kinds for an S number). */
export function literalMentions(text) {
  const out = [];
  for (const m of String(text).matchAll(LITERAL)) {
    const kindBase = /^fig/i.test(m[1]) ? 'figure' : 'table';
    const parts = m[2].split(/\s*(,|and|&|to|–|-)\s*/);
    let prev = null;
    for (let i = 0; i < parts.length; i += 2) {
      const p = parts[i].match(/^(S?)(\d+)/); if (!p) continue;
      const n = Number(p[2]), kind = (p[1] ? 'supp-' : '') + kindBase;
      const sep = parts[i - 1];
      if (prev && prev.kind === kind && /^(to|–|-)$/.test(sep || '')) for (let k = prev.n + 1; k < n; k++) out.push({ kind, n: k });
      out.push({ kind, n }); prev = { kind, n };
    }
  }
  return out;
}

/**
 * Figures and tables against their mentions. Mentions are the document's
 * {{fig:id}} and {{tab:id}} tokens and, for text that was typed or imported,
 * "Figure 2" / "Table S1" written out. Figure legends and table captions are
 * not mentions. Returns `{ ok, findings, mentions }`; a finding is
 * `{ kind: 'missing'|'uncited'|'order'|'duplicate'|'gap', message, label?, assetId?, blockId? }`.
 */
export function assetOrderCheck(blocks, assets = []) {
  const roles = submissionRoles(blocks);
  const findings = [], mentions = [];
  const byId = new Map(assets.map(a => [a.id, a]));
  blocks.forEach((b, i) => {
    if (['legends', 'references', 'tables'].includes(roles[i]) || b.type === 'table' || b.type === 'figure' || b.styleId === 'Caption') return;
    const text = String(b.text || '');
    for (const t of resultTokens(text)) {
      const m = t.key.match(/^(fig|tab):(.+)$/); if (!m) continue;
      const a = byId.get(m[2]);
      if (!a) { findings.push({ kind: 'missing', message: `A ${m[1] === 'fig' ? 'figure' : 'table'} is cited that is no longer in the list`, assetId: m[2], blockId: b.id }); continue; }
      mentions.push({ kind: a.kind, n: assets.filter(x => x.kind === a.kind).indexOf(a) + 1, assetId: a.id, label: assetLabel(a, assets), blockId: b.id, at: t.start });
    }
    if (LEGEND.test(strip(text))) return;
    for (const m of literalMentions(text.replace(/\{\{[^}]*\}\}/g, ' '))) {
      const same = assets.filter(x => x.kind === m.kind);
      const a = same[m.n - 1];
      mentions.push({ kind: m.kind, n: m.n, assetId: a?.id || null, label: `${ASSET_KINDS[m.kind]}${m.n}`, blockId: b.id, literal: true });
    }
  });
  // How many of each kind exist: the assets when there are any of that kind,
  // otherwise the legends and in-document figures and tables, otherwise unknown.
  const legendN = { figure: new Set(), table: new Set(), 'supp-figure': new Set(), 'supp-table': new Set() };
  blocks.forEach((b, i) => {
    const m = strip(b.text).match(/^\s*(fig(?:ure)?\.?|table)\s*(S?)(\d+)[a-z]?\s*[.:|]/i);
    if (m && (roles[i] === 'legends' || roles[i] === 'tables' || b.styleId === 'Caption' || roles[i] === 'main')) legendN[(m[2] ? 'supp-' : '') + (/^fig/i.test(m[1]) ? 'figure' : 'table')].add(Number(m[3]));
  });
  const inDoc = { figure: blocks.filter(b => b.type === 'figure').length, table: blocks.filter(b => b.type === 'table').length };
  const existing = kind => {
    const n = assets.filter(a => a.kind === kind).length;
    if (n) return n;
    if (legendN[kind].size) return Math.max(...legendN[kind]);
    return inDoc[kind] || null;
  };
  for (const kind of Object.keys(ASSET_KINDS)) {
    const ms = mentions.filter(m => m.kind === kind);
    const count = existing(kind);
    const label = n => `${ASSET_KINDS[kind]}${n}`;
    // cited but not there
    if (count != null) for (const n of uniq(ms.filter(m => m.n > count).map(m => m.n)))
      findings.push({ kind: 'missing', message: `${label(n)} is cited but there ${count === 1 ? 'is' : 'are'} only ${count}`, label: label(n), blockId: ms.find(m => m.n === n).blockId });
    // first mentions in numeric order
    const first = [];
    for (const m of ms) if (!first.some(f => f.n === m.n)) first.push(m);
    let high = 0;
    for (const f of first) {
      if (f.n < high) findings.push({ kind: 'order', message: `${label(f.n)} is first cited after ${label(high)}`, label: label(f.n), assetId: f.assetId || undefined, blockId: f.blockId });
      high = Math.max(high, f.n);
    }
    // there but never cited, or a number skipped
    const cited = new Set(ms.map(m => m.n));
    if (count != null) {
      for (let n = 1; n <= count; n++) if (!cited.has(n)) {
        const a = assets.filter(x => x.kind === kind)[n - 1];
        findings.push({ kind: 'uncited', message: `${label(n)} is not cited in the text`, label: label(n), assetId: a?.id });
      }
    } else if (cited.size) {
      for (let n = 1; n < Math.max(...cited); n++) if (!cited.has(n)) findings.push({ kind: 'gap', message: `${label(n)} is never cited, but ${label(Math.max(...cited))} is`, label: label(n) });
    }
  }
  // the same file or caption added twice
  const seen = new Map();
  for (const a of assets) {
    const keys = [a.name && a.size != null ? `file:${a.name}:${a.size}` : null, a.caption?.trim() ? `cap:${a.kind.replace('supp-', '')}:${a.caption.trim().toLowerCase()}` : null].filter(Boolean);
    for (const k of keys) {
      if (seen.has(k)) { const o = seen.get(k); findings.push({ kind: 'duplicate', message: `${assetLabel(a, assets)} repeats ${assetLabel(o, assets)} (${k.startsWith('file') ? 'same file' : 'same caption'})`, label: assetLabel(a, assets), assetId: a.id }); break; }
      seen.set(k, a);
    }
  }
  return { ok: !findings.length, findings, mentions: mentions.map(({ at, ...m }) => m) };
}

// ---- consistency -----------------------------------------------------------------------

const ISE = '(?:e|ed|es|ing|ation|ations|er|ers|able)';
const ise = stem => [`${stem}is${ISE}`, `${stem}iz${ISE}`, 'ize'];
const pair = (uk, us) => [uk, us, 'spelling'];
// British and American forms of words common in medical writing. -ise/-ize is
// its own group: Oxford spelling is British and uses -ize, so with British set
// only a mixture of the two is reported.
export const SPELLING_PAIRS = [
  ise('random'), ise('organ'), ise('optim'), ise('character'), ise('standard'), ise('minim'), ise('maxim'),
  ise('util'), ise('recogn'), ise('hospital'), ise('immun'), ise('categor'), ise('summar'), ise('general'),
  ise('normal'), ise('stabil'), ise('visual'), ise('catheter'), ise('emphas'), ise('priorit'),
  pair('anaemi\\w*', 'anemi\\w*'), pair('oedema\\w*', 'edema\\w*'), pair('haemorrhag\\w*', 'hemorrhag\\w*'),
  pair('paediatric\\w*', 'pediatric\\w*'), pair('oesophag\\w*', 'esophag\\w*'), pair('tumours?|tumoural', 'tumors?|tumoral'),
  pair('behaviour\\w*', 'behavior\\w*'), pair('analys(?:e|ed|ing|er|ers)', 'analyz(?:e|ed|es|ing|er|ers)'),
  pair('centres?|centred', 'centers?|centered'), pair('colour\\w*', 'color\\w*'), pair('favour\\w*', 'favor\\w*'),
  pair('labour\\w*', 'labor\\w*'), pair('haemoglobin\\w*', 'hemoglobin\\w*'), pair('leukaemi\\w*', 'leukemi\\w*'),
  pair('ischaemi\\w*', 'ischemi\\w*'), pair('oestrogen\\w*', 'estrogen\\w*'), pair('oestradiol', 'estradiol'),
  pair('foetus(?:es)?|foetal', 'fetus(?:es)?|fetal'), pair('diarrhoea\\w*', 'diarrhea\\w*'), pair('gynaecolog\\w*', 'gynecolog\\w*'),
  pair('orthopaedic\\w*', 'orthopedic\\w*'), pair('anaesthe\\w*', 'anesthe\\w*'), pair('haematolog\\w*', 'hematolog\\w*'),
  pair('haematom\\w*', 'hematom\\w*'), pair('haemodynamic\\w*', 'hemodynamic\\w*'), pair('haemodialys\\w*', 'hemodialys\\w*'),
  pair('caesarean', 'cesarean'), pair('coeliac', 'celiac'), pair('dyspnoea', 'dyspnea'), pair('apnoea', 'apnea'),
  pair('faecal|faeces', 'fecal|feces'), pair('septicaemi\\w*', 'septicemi\\w*'), pair('\\w*glycaemi\\w*', '\\w*glycemi\\w*'),
  pair('aetiolog\\w*', 'etiolog\\w*'), pair('manoeuvres?', 'maneuvers?'), pair('(?:milli|deci|micro)?litres?', '(?:milli|deci|micro)?liters?'),
  pair('(?:milli|centi|kilo|micro)metres?', '(?:milli|centi|kilo|micro)meters?'), pair('fibres?', 'fibers?'),
  pair('modell(?:ed|ing)', 'model(?:ed|ing)'), pair('labell(?:ed|ing)', 'label(?:ed|ing)'), pair('signalling', 'signaling'),
  pair('enrolment\\w*', 'enrollment\\w*'), pair('ageing', 'aging'), pair('catalogues?', 'catalogs?'), pair('artefacts?', 'artifacts?'),
  pair('leucocyt\\w*', 'leukocyt\\w*'), pair('gonorrhoea', 'gonorrhea'), pair('haemolys\\w*|haemolytic', 'hemolys\\w*|hemolytic'),
  pair('haemophilia', 'hemophilia'), pair('haemosta\\w*', 'hemosta\\w*'), pair('haemoptysis', 'hemoptysis'),
  pair('sulph\\w+', 'sulf\\w+'), pair('aluminium', 'aluminum'), pair('defence', 'defense'), pair('paralys(?:e|ed|ing)', 'paralyz(?:e|ed|ing)'),
  pair('counsell(?:ing|or|ors)', 'counsel(?:ing|or|ors)'), pair('titres?', 'titers?'), pair('moulds?', 'molds?'),
];
const SPELL_RE = SPELLING_PAIRS.map(([uk, us, group]) => ({ uk: new RegExp(`\\b(?:${uk})\\b`, 'gi'), us: new RegExp(`\\b(?:${us})\\b`, 'gi'), group }));

const PROSE = new Set(['p', 'quote', 'h1', 'h2', 'h3']);
const ABBR = /\b(?:fig|figs|no|nos|ref|refs|vs|al|e\.g|i\.e|approx|ca|cf|eq|vol|pp|p|st|dr|mr|mrs|ms|prof)\.$/i;

/**
 * Spelling and number style used inconsistently across the document's prose
 * (headings and paragraphs; not tables, legends or references). With `variety`
 * set ('us' or 'uk'), spellings of the other variety are reported even when
 * used consistently. Each finding is `{ kind, message, examples, blockIds }`.
 */
export function consistencyCheck(blocks, { variety = null } = {}) {
  const roles = submissionRoles(blocks);
  const prose = blocks.map((b, i) => ({ b, role: roles[i], text: strip(b.text) }))
    .filter(x => PROSE.has(x.b.type) && !['references', 'legends', 'tables'].includes(x.role) && x.text);
  const out = [];
  const collect = (re, only = null) => {
    const hits = [];
    for (const x of prose) {
      if (only && !only.has(x.b.type)) continue;
      re.lastIndex = 0;
      for (const m of x.text.matchAll(re)) hits.push({ text: m[0], blockId: x.b.id, m });
    }
    return hits;
  };
  const finding = (kind, message, hits) => out.push({ kind, message, examples: uniq(hits.map(h => h.text.trim())).slice(0, 6), blockIds: uniq(hits.map(h => h.blockId)) });
  // the less used form is the one to look at; with a tie, both
  const minority = (a, b) => a.length < b.length ? [a] : b.length < a.length ? [b] : [a, b];

  // spelling
  for (const group of ['spelling', 'ize']) {
    const uk = [], us = [];
    for (const p of SPELL_RE.filter(r => r.group === group)) { uk.push(...collect(p.uk)); us.push(...collect(p.us)); }
    const name = group === 'ize' ? ['-ise', '-ize'] : ['British', 'American'];
    if (variety === 'us' && uk.length) finding('spelling', `${name[0]} spelling in an American English manuscript`, uk);
    else if (variety === 'uk' && group === 'spelling' && us.length) finding('spelling', 'American spelling in a British English manuscript', us);
    else if (uk.length && us.length) {
      const flagged = minority(uk, us).flat();
      finding('spelling', `${name[0]} and ${name[1]} spellings are mixed (${uk.length} ${name[0]}, ${us.length} ${name[1]})`, flagged);
    }
  }

  // P and p for P values
  const pv = collect(/(?<![\w.])([Pp])(?:\s*(?:[<>=≤≥])\s*0?\.\d+|[- ]values?\b)/g);
  const bigP = pv.filter(h => h.m[1] === 'P'), smallP = pv.filter(h => h.m[1] === 'p');
  if (bigP.length && smallP.length) finding('p-value', `P values are written with both "P" and "p" (${bigP.length} and ${smallP.length})`, minority(bigP, smallP).flat());

  // hyphen and en dash in numeric ranges; an ISO date is not a range
  const hy = collect(/(?<![\w.\-\/–])\d+(?:\.\d+)?-\d+(?:\.\d+)?(?![\w\-\/])/g).filter(h => !/^\d{4}-\d{2}(-\d{2})?$/.test(h.text));
  const en = collect(/(?<![\w.\-\/])\d+(?:\.\d+)? ?– ?\d+(?:\.\d+)?/g);
  if (hy.length && en.length) finding('range-dash', `Number ranges use both a hyphen and an en dash (${hy.length} and ${en.length})`, minority(hy, en).flat());

  // a space before %
  const sp = collect(/\d %/g), nosp = collect(/\d%/g);
  if (sp.length && nosp.length) finding('percent-space', `Percentages are written both with and without a space before % (${sp.length} and ${nosp.length})`, minority(sp, nosp).flat());

  // vs, vs. and versus
  const forms = { 'vs.': collect(/\bvs\.(?=\s|$)/g), vs: collect(/\bvs\b(?!\.)/g), versus: collect(/\bversus\b/gi) };
  const used = Object.entries(forms).filter(([, h]) => h.length);
  if (used.length > 1) {
    const most = Math.max(...used.map(([, h]) => h.length));
    finding('versus', `"${used.map(([k]) => k).join('", "')}" are all used (${used.map(([k, h]) => `${h.length} ${k}`).join(', ')})`, used.filter(([, h]) => h.length < most || used.every(([, g]) => g.length === most)).flatMap(([, h]) => h));
  }

  // a decimal comma: a comma between digits where a number with decimals is expected
  const dc = collect(/(?<![\d.,\w[])(?:0,\d+|[1-9]\d{0,2},\d{1,2})(?![\d,])/g).filter(h => {
    const x = prose.find(p => p.b.id === h.blockId).text, before = x.slice(0, h.m.index), after = x.slice(h.m.index + h.text.length);
    if (/^0,/.test(h.text)) return true;
    if (/\b(?:fig(?:ure)?s?\.?|tables?|refs?\.?|references?|studies|items?|groups?|days?|weeks?|months?|visits?|stages?|grades?|types?|phases?|levels?)\s*$/i.test(before)) return false;
    return /^\s?(?:%|mg|g\b|kg|ml|mL|l\b|mmol|µ|cm|mm|years?|points?|\)|\s(?:to|and)\s\d|\s?[–-]\s?\d)/.test(after) || /(?:[=<>≤≥]|\b(?:OR|HR|RR|CI|SD|mean|median))\s*$/.test(before);
  });
  if (dc.length) finding('decimal-comma', 'A comma may be used as a decimal mark', dc);

  // a digit under ten opening a sentence
  const lead = collect(/(?:^|(?<=[.!?]["”)]?\s+))\d(?![\d.,:\/%])(?=\s+\S)/g, new Set(['p', 'quote'])).filter(h => {
    const x = prose.find(p => p.b.id === h.blockId).text.slice(0, h.m.index).trimEnd();
    return !x || !ABBR.test(x);
  });
  if (lead.length) finding('sentence-number', 'A sentence starts with a number written as a digit', lead.map(h => {
    const x = prose.find(p => p.b.id === h.blockId).text;
    return { ...h, text: x.slice(h.m.index, h.m.index + 30).replace(/\s+\S*$/, '') };
  }));
  return out;
}

// ---- sections ------------------------------------------------------------------------

const MAIN_IMRAD = [
  { id: 'introduction', label: 'Introduction', match: /^(introduction|background)$/i },
  { id: 'methods', label: 'Methods', match: /^((materials?|patients?|participants?|subjects?)\s+and\s+)?methods?|methodology$/i },
  { id: 'results', label: 'Results', match: /^(results?|findings)\b/i },
  { id: 'discussion', label: 'Discussion', match: /^discussion\b/i },
];
const MAIN_CASE = [
  { id: 'introduction', label: 'Introduction', match: /^(introduction|background)$/i },
  { id: 'case', label: 'Case presentation', match: /^case\s+(presentation|report|description|summary|history)s?$/i },
  { id: 'discussion', label: 'Discussion', match: /^discussion\b/i },
];
const MAIN_GUIDELINE = [
  { id: 'introduction', label: 'Introduction', match: /^(introduction|background|scope)$/i },
  { id: 'methods', label: 'Methods', match: /^methods?|methodology$/i },
  { id: 'recommendations', label: 'Recommendations', match: /recommendations?/i },
];
const sub = (id, label, match, why) => ({ id, label, match, why });
const SEARCH = sub('search', 'Search strategy', /\b(search(es|ing)?( strategy| methods?)?|information sources|literature search)\b/i);
const ELIGIBILITY = sub('eligibility', 'Eligibility criteria', /\b(eligibility|inclusion|exclusion|selection criteria)\b/i);
const SELECTION = sub('selection', 'Study selection', /\b(study selection|selection\b(?: of (studies|sources( of evidence)?)| process)?|screening)\b/i);
const EXTRACTION = sub('extraction', 'Data extraction', /\b(data (extraction|collection|charting|items)|extraction)\b/i);
const ROB = sub('rob', 'Risk of bias', /\b(risk of bias|quality assessment|critical appraisal|methodological quality|study quality|appraisal)\b/i);
const SYNTHESIS = sub('synthesis', 'Synthesis methods', /\b(synthesis|meta-analys[ie]s|statistical (analysis|methods)|data analysis)\b/i);
const REVIEW_REG = sub('registration', 'Protocol and registration', /\b(protocol|registration|prospero)\b/i);
const STATS = sub('statistics', 'Statistical analysis', /\b(statistic(s|al)( analysis| methods)?|data analysis|analysis)\b/i);
const PARTICIPANTS = sub('participants', 'Participants', /\b(participants?|patients?|study population|population|subjects?|sample)\b/i);

// Subsections a study design's reporting guideline asks the methods to cover.
// A guideline asks for items, not headings: a missing heading is a prompt to
// check that the item is reported, not proof that it is missing.
const BY_TYPE = {
  review: { guideline: 'PRISMA 2020', subs: [ELIGIBILITY, SEARCH, SELECTION, EXTRACTION, ROB, SYNTHESIS, REVIEW_REG] },
  'scoping-review': { guideline: 'PRISMA-ScR', subs: [ELIGIBILITY, SEARCH, SELECTION, EXTRACTION, REVIEW_REG] },
  'umbrella-review': { guideline: 'PRIOR', subs: [ELIGIBILITY, SEARCH, SELECTION, EXTRACTION, ROB, sub('overlap', 'Overlap of reviews', /\boverlap\b/i), SYNTHESIS, REVIEW_REG] },
  'qualitative-review': { guideline: 'ENTREQ', subs: [ELIGIBILITY, SEARCH, SELECTION, ROB, SYNTHESIS] },
  rct: { guideline: 'CONSORT', subs: [sub('design', 'Trial design', /\b(trial|study) design\b/i), PARTICIPANTS, sub('interventions', 'Interventions', /\binterventions?\b/i), sub('outcomes', 'Outcomes', /\boutcomes?\b/i), sub('sample', 'Sample size', /\b(sample size|power)\b/i), sub('randomisation', 'Randomisation', /\b(randomi[sz]ation|allocation|sequence generation)\b/i), sub('blinding', 'Blinding', /\b(blinding|masking)\b/i), STATS, sub('registration', 'Trial registration', /\b(trial )?registration\b|\bregistry\b/i)] },
  'cohort-study': { guideline: 'STROBE', subs: [sub('design', 'Study design', /\b(study design|design)\b/i), sub('setting', 'Setting', /\bsetting\b/i), PARTICIPANTS, sub('variables', 'Variables', /\b(variables|exposures?|outcomes?)\b/i), sub('bias', 'Bias', /\bbias\b/i), sub('size', 'Study size', /\b(study size|sample size)\b/i), STATS] },
  'diagnostic-study': { guideline: 'STARD', subs: [PARTICIPANTS, sub('tests', 'Test methods', /\b(index test|reference standard|test methods?)\b/i), STATS, sub('registration', 'Registration', /\bregistration\b/i)] },
  'prognostic-model': { guideline: 'TRIPOD', subs: [sub('source', 'Source of data', /\b(source of data|data sources?)\b/i), PARTICIPANTS, sub('outcome', 'Outcome', /\boutcomes?\b/i), sub('predictors', 'Predictors', /\bpredictors?\b/i), sub('sample', 'Sample size', /\bsample size\b/i), sub('missing', 'Missing data', /\bmissing data\b/i), STATS] },
  'survey-study': { guideline: 'CROSS', subs: [sub('sample', 'Sample', /\b(sample|sampling|participants?|population)\b/i), sub('instrument', 'Questionnaire', /\b(questionnaire|instrument|survey (design|development))\b/i), sub('collection', 'Data collection', /\b(data collection|administration)\b/i), STATS] },
  'qualitative-study': { guideline: 'SRQR', subs: [sub('context', 'Setting', /\b(setting|context)\b/i), sub('sampling', 'Sampling', /\b(sampling|participants?)\b/i), sub('collection', 'Data collection', /\bdata collection\b/i), sub('analysis', 'Data analysis', /\b(data )?analysis\b/i), sub('reflexivity', 'Reflexivity', /\breflexivity\b/i)] },
  'qi-project': { guideline: 'SQUIRE', subs: [sub('context', 'Context', /\bcontext\b/i), sub('intervention', 'Intervention', /\binterventions?\b/i), sub('measures', 'Measures', /\bmeasures?\b/i), sub('analysis', 'Analysis', /\banalysis\b/i)] },
  'economic-evaluation': { guideline: 'CHEERS', subs: [sub('perspective', 'Perspective', /\bperspective\b/i), sub('horizon', 'Time horizon', /\btime horizon\b/i), sub('discount', 'Discount rate', /\bdiscount/i), sub('costs', 'Costs', /\bcosts?\b/i), sub('uncertainty', 'Uncertainty', /\b(uncertainty|sensitivity analys[ie]s)\b/i)] },
  'animal-study': { guideline: 'ARRIVE 2.0', subs: [sub('design', 'Study design', /\b(study|experimental) design\b/i), sub('animals', 'Animals', /\b(animals?|experimental animals|housing)\b/i), sub('sample', 'Sample size', /\bsample size\b/i), sub('randomisation', 'Randomisation', /\brandomi[sz]ation\b/i), sub('blinding', 'Blinding', /\b(blinding|masking)\b/i), sub('outcomes', 'Outcome measures', /\boutcome measures?\b/i), STATS] },
  'case-series': { guideline: 'reporting conventions for case series', subs: [PARTICIPANTS, STATS] },
  'case-report': { guideline: 'CARE', subs: [sub('patient', 'Patient information', /\bpatient information\b/i), sub('findings', 'Clinical findings', /\bclinical findings\b/i), sub('timeline', 'Timeline', /\btimeline\b/i), sub('diagnostic', 'Diagnostic assessment', /\bdiagnos(tic|is)\b/i), sub('therapeutic', 'Therapeutic intervention', /\b(therapeutic|treatment|interventions?)\b/i), sub('follow', 'Follow-up and outcomes', /\bfollow-?up\b|\boutcomes?\b/i)] },
  guideline: { guideline: 'RIGHT', subs: [sub('panel', 'Guideline panel', /\b(panel|group|development group|working group)\b/i), sub('evidence', 'Evidence review', /\b(evidence|systematic review|search)\b/i), sub('grading', 'Grading of recommendations', /\b(grad(e|ing)|certainty|strength)\b/i), sub('coi', 'Management of interests', /\b(conflicts?|interests?)\b/i)] },
};
const REVIEW_TYPES = new Set(['systematic-review', 'meta-analysis', 'rapid-review', 'dta-review', 'nma-review']);

/** The disclosure statements, with the headings journals print them under. */
export const DISCLOSURES = [
  { id: 'funding', label: 'Funding', match: /\b(funding|financial (support|disclosure)|sources? of (funding|support)|grant support)\b/i },
  { id: 'coi', label: 'Conflicts of interest', match: /\b(conflicts? of interests?|competing interests?|declarations? of interests?|disclosures?|duality of interest)\b/i },
  { id: 'dataAvailability', label: 'Data availability', match: /\b(data (availability|sharing|access)|availability of data)\b/i },
  { id: 'ethics', label: 'Ethics approval', match: /\b(ethic(s|al)( approval| statement| considerations| committee)?|institutional review board|irb approval)\b/i },
  { id: 'consent', label: 'Patient consent', match: /\b(informed consent|patient consent|consent (to|for) (participate|publication|publish))\b/i },
  { id: 'credit', label: 'Author contributions', match: /\b(author(s'|s|'s)? contributions?|contributors(hip)?|credit( author statement)?)\b/i },
  { id: 'registration', label: 'Registration', match: /\b((trial|protocol|study) registration|registration|prospero)\b/i },
];

const RUN_IN = /^\s*([A-Z][^:.\n]{2,60}?)\s*[:.]\s+\S/;

/** Headings and run-in labels ("Funding: none.") in order, with their level and section body. */
function headingsOf(blocks) {
  const out = [];
  // a paragraph set as a heading (an imported document) is a heading when it is in capitals and a subheading when it is not: STATEMENTS
  // over Funding Statement and Human Ethics, so a section of run-in subsections is not read as empty
  const caps = b => { const t = bare(b.text); return /[A-Z]/.test(t) && t === t.toUpperCase(); };
  const level = b => b.type === 'h1' ? 1 : b.type === 'h2' ? 2 : b.type === 'h3' ? 3 : headingLike(b) ? (caps(b) ? 2 : 3) : 0;
  blocks.forEach((b, i) => {
    const lv = level(b);
    if (lv) { out.push({ i, b, level: lv, name: bare(b.text), runIn: false }); return; }
    const m = RUN_IN.exec(strip(b.text));
    if (m && (b.type === 'p' || b.type === 'quote')) out.push({ i, b, level: 9, name: m[1].trim(), runIn: true });
  });
  return out;
}

/** Whether a section (a heading and what it runs to) has any text of its own or a subsection's. */
function sectionEmpty(blocks, hs, k) {
  const h = hs[k];
  if (h.runIn) return !strip(h.b.text).replace(RUN_IN, '').trim() && strip(h.b.text).replace(/^\s*[^:.]+[:.]\s*/, '').trim() === '';
  const end = hs.slice(k + 1).find(x => !x.runIn && x.level <= h.level)?.i ?? blocks.length;
  for (let j = h.i + 1; j < end; j++) {
    const b = blocks[j];
    if (b.type === 'table' || b.type === 'figure' || b.type === 'bib') return false;
    if (/^h[1-3]$/.test(b.type) || headingLike(b)) continue;
    if (strip(b.text)) return false;
  }
  return true;
}

/**
 * The sections a manuscript of this research type needs, its heading
 * hierarchy, and its disclosure statements. Headings are matched by their
 * text, case-insensitively, with the names journals commonly use; a run-in
 * label ("Funding: None.") counts as a heading.
 *
 * Returns { needed: [{ id, label, level: 'section'|'subsection', found, blockId, why }],
 *           hierarchy: [{ kind: 'skip'|'empty'|'title', message, blockId }],
 *           disclosures: [{ id, label, found, empty, blockId }] }
 */
export function sectionCheck(blocks, researchTypeId = 'other') {
  const roles = submissionRoles(blocks);
  const hs = headingsOf(blocks).filter(h => roles[h.i] !== 'title');   // the paper's title is not a section, at whatever level it is set
  const find = re => hs.find(h => re.test(h.name));
  const main = researchTypeId === 'case-report' ? MAIN_CASE : researchTypeId === 'guideline' ? MAIN_GUIDELINE : MAIN_IMRAD;
  const spec = BY_TYPE[REVIEW_TYPES.has(researchTypeId) ? 'review' : researchTypeId];
  const needed = [
    ...main.map(n => { const h = hs.find(x => !x.runIn && n.match.test(x.name)); return { id: n.id, label: n.label, level: 'section', found: Boolean(h), blockId: h?.b.id || null, why: researchTypeId === 'case-report' ? 'CARE' : 'IMRaD' }; }),
    ...(spec?.subs || []).map(n => { const h = find(n.match); return { id: n.id, label: n.label, level: 'subsection', found: Boolean(h), blockId: h?.b.id || null, why: spec.guideline }; }),
  ];
  const hierarchy = [];
  let seenH2 = false;
  const titles = blocks.filter(b => b.type === 'h1' && strip(b.text));
  if (titles.length > 1) hierarchy.push({ kind: 'title', message: `${titles.length} blocks are set as the title`, blockId: titles[1].id });
  hs.forEach((h, k) => {
    if (h.runIn) return;
    if (h.b.type === 'h2') seenH2 = true;
    if (h.b.type === 'h3' && !seenH2) hierarchy.push({ kind: 'skip', message: `"${h.name}" is a subheading before any heading`, blockId: h.b.id });
    if (h.b.type === 'h1' || h.level > 3) return;
    if (roles[h.i] === 'references' || /^(references?|bibliography)$/i.test(h.name)) return;   // a generated list has no paragraphs
    if (sectionEmpty(blocks, hs, k)) hierarchy.push({ kind: 'empty', message: `${h.name || 'Untitled'} is empty`, blockId: h.b.id });
  });
  const disclosures = DISCLOSURES.map(d => {
    const k = hs.findIndex(h => d.match.test(h.name));
    return { id: d.id, label: d.label, found: k >= 0, empty: k >= 0 ? sectionEmpty(blocks, hs, k) : false, blockId: k >= 0 ? hs[k].b.id : null };
  });
  return { needed, hierarchy, disclosures };
}

// ---- a blinded copy --------------------------------------------------------------------

const BLIND = '[blinded]';
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Letters on either side mean the match is inside a longer word.
const phraseRe = p => new RegExp(`(?<![\\p{L}\\p{N}])${esc(p).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const ORCID = /(?:https?:\/\/)?(?:orcid\.org\/)?\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/g;
const INSTITUTIONAL = /\b(university|universit[äéà]|hospital|institute|institut|school|faculty|college|cent(er|re)|clinic|klinik|foundation|laborator(y|ies)|department|division|unit|trust|service|ministry|council|academy)\b/i;
// Words in an affiliation that name nothing in particular.
const GENERIC = new Set(['department', 'division', 'unit', 'faculty', 'school', 'college', 'university', 'hospital', 'institute', 'center', 'centre', 'clinic', 'medicine', 'medical', 'health', 'sciences', 'science', 'research', 'surgery', 'general', 'national', 'state', 'city', 'public', 'foundation', 'trust', 'service', 'services', 'laboratory', 'clinical', 'children', 'women', 'the', 'and', 'for', 'of']);
const SELF = [
  [/\b(?:our|my)\s+(?:own\s+)?(?:previous|prior|earlier|recent|former|published)\s+(?:study|studies|work|works|report|reports|paper|papers|trial|trials|series|analysis|analyses|experience|publication|publications|cohort)\b/gi, 'refers to the authors’ own earlier work'],
  [/\b(?:we|our group|our team)\s+(?:have\s+)?(?:previously|recently|earlier)\s+(?:reported|shown|described|published|demonstrated|found)\b/gi, 'refers to the authors’ own earlier work'],
  [/\b(?:in|at|from)\s+our\s+(?:own\s+)?(?:institution|hospital|centre|center|department|unit|clinic|university|practice|institute|service|trust)\b/gi, 'names the authors’ institution'],
];
const BACK_NAMES = /^(acknowledge?ments?|author(s'|s|'s)? contributions?|contributors?)$/i;

function nameVariants(a) {
  const full = typeof a === 'string' ? a : a?.name || [a?.given, a?.family].filter(Boolean).join(' ');
  const name = String(full || '').trim();
  if (!name) return { family: '', variants: [] };
  const fam = familyName(name);
  const ini = initials(name, { comma: true }).split(',')[1]?.trim() || '';
  const given = name.includes(',') ? name.split(',')[1].trim() : name.replace(new RegExp(`\\s*${esc(fam)}\\s*$`), '').trim();
  const variants = [name, `${given} ${fam}`, `${fam}, ${given}`, `${fam} ${ini}`, `${fam}, ${ini}`,
    ini ? `${ini.split('').join('. ')}. ${fam}` : '', ini ? `${ini.split('').join('.')}. ${fam}` : '', ini ? `${ini} ${fam}` : '', ini ? `${ini[0]}. ${fam}` : '']
    .map(v => v.trim()).filter(v => v && v !== fam && v.length > fam.length);
  return { family: fam, variants: uniq(variants) };
}
const authorKey = name => {
  const ini = initials(name, { comma: true }).split(',')[1] || '';
  return `${familyName(name).toLowerCase()} ${ini.trim().slice(0, 1).toLowerCase()}`;
};

/**
 * A copy of the document for blinded (anonymised) review. Author names,
 * affiliations and the institutions in them, e-mail addresses, ORCID iDs and
 * the `extra` phrases are replaced by "[blinded]"; the authors of tracked
 * changes are blinded too. What it finds but cannot safely replace is flagged:
 * an author's family name standing alone (it may be a cited author), words
 * from an affiliation (a city, a hospital's name), phrases such as "our
 * previous study" or "in our institution" (with the shared author when
 * `library` shows a cited work is the authors' own), comment anchors, and the
 * acknowledgements and contributions sections, which name people.
 *
 * Returns { blocks, flags: [{ blockId, text, reason }] }.
 */
export function blindedCopy(blocks, { authors = [], affiliations = [], extra = [], library = [] } = {}) {
  const people = (authors || []).map(nameVariants).filter(p => p.family);
  const replaceList = uniq([
    ...people.flatMap(p => p.variants),
    ...(affiliations || []).map(a => String(a).trim()).filter(Boolean),
    // the institutional parts of an affiliation: "Example University", "Department of Neurosurgery"
    ...(affiliations || []).flatMap(a => String(a).split(/\s*[,;]\s*/)).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 2 && INSTITUTIONAL.test(s)),
    ...(extra || []).map(e => String(e).trim()).filter(Boolean),
  ]).sort((x, y) => y.length - x.length).map(phraseRe);
  const scrub = t => {
    let s = String(t ?? '');
    for (const re of replaceList) s = s.replace(re, BLIND);
    return s.replace(EMAIL, m => /^\[?@/.test(m) ? m : BLIND).replace(ORCID, BLIND);
  };
  // citation tokens are the document's own keys, not text: they are left as they are
  const scrubText = t => String(t ?? '').split(/(\[@[^\]]*\]|\{\{[^}]*\}\})/).map((part, k) => k % 2 ? part : scrub(part)).join('');
  const scrubRun = r => {
    const out = r.cite ? { ...r } : { ...r, t: scrubText(r.t) };
    for (const k of ['ins', 'del', 'fmtChange']) if (out[k]?.author) out[k] = { ...out[k], author: BLIND, ...(out[k].initials ? { initials: '' } : {}) };
    return out;
  };
  const scrubBox = box => box.runs?.length ? (() => { const runs = box.runs.map(scrubRun); return { ...box, runs, text: textOfRuns(runs) }; })() : { ...box, text: scrubText(box.text) };
  const out = blocks.map(b => {
    let nb = scrubBox(b);
    if (b.grid?.rows) nb = { ...nb, grid: { ...b.grid, rows: b.grid.rows.map(r => ({ ...r, cells: r.cells.map(c => c && typeof c === 'object' ? scrubBox(c) : c) })) } };
    return nb;
  });

  const flags = [];
  const flag = (blockId, text, reason) => { if (!flags.some(f => f.blockId === blockId && f.text.toLowerCase() === text.toLowerCase() && f.reason === reason)) flags.push({ blockId, text, reason }); };
  const ownKeys = new Set((authors || []).map(a => typeof a === 'string' ? a : a?.name || [a?.given, a?.family].filter(Boolean).join(' ')).filter(Boolean).map(authorKey));
  const byKey = new Map((library || []).map(r => [r.key, r]));
  const recordAuthors = r => Array.isArray(r?.authors) ? r.authors.map(a => typeof a === 'string' ? a : a?.name || [a?.given, a?.family].filter(Boolean).join(' ')) : typeof r?.authors === 'string' ? r.authors.split(/\s*;\s*/) : [];
  const places = uniq((affiliations || []).flatMap(a => String(a).match(/\p{Lu}[\p{L}'-]{3,}/gu) || []).filter(w => !GENERIC.has(w.toLowerCase())));
  const roles = submissionRoles(out);
  out.forEach((b, i) => {
    const text = strip(b.text);
    const cellsText = b.grid?.rows ? b.grid.rows.flatMap(r => r.cells.map(c => strip(c?.text))).join(' ') : '';
    const all = `${text} ${cellsText}`;
    // what the replacement could not reach: a name split across formatting runs
    for (const re of replaceList) { re.lastIndex = 0; const m = re.exec(all); if (m) flag(b.id, m[0], 'split across formatting; not replaced'); }
    for (const p of people) {
      const re = phraseRe(p.family);
      for (const m of all.matchAll(re)) flag(b.id, m[0], 'an author’s family name');
    }
    for (const w of places) for (const m of all.matchAll(phraseRe(w))) flag(b.id, m[0], 'a word from an affiliation');
    for (const [re, reason] of SELF) {
      re.lastIndex = 0;
      for (const m of String(b.text || '').matchAll(re)) {
        const near = citations(String(b.text).slice(m.index, m.index + m[0].length + 80));
        const own = near.map(c => byKey.get(c.key)).find(r => recordAuthors(r).some(a => ownKeys.has(authorKey(a))));
        flag(b.id, m[0] + (own ? ` [@${own.key}]` : ''), own ? 'cites the authors’ own work in the first person' : reason);
      }
    }
    for (const t of resultTokens(b.text || '')) if (t.key.startsWith('cm:')) flag(b.id, t.key, 'a comment is anchored here');
    if (/^h[1-3]$/.test(b.type) && BACK_NAMES.test(bare(b.text)) || roles[i] === 'back' && headingLike(b) && BACK_NAMES.test(bare(b.text)))
      flag(b.id, bare(b.text), 'names people; check it before sending a blinded copy');
  });
  return { blocks: out, flags };
}

// ---- readiness -------------------------------------------------------------------------

/** Abstract part names as written: subheadings and run-in labels within the abstract. */
function abstractParts(blocks, roles) {
  const out = [];
  blocks.forEach((b, i) => {
    if (roles[i] !== 'abstract') return;
    const t = strip(b.text);
    if (/^h[1-3]$/.test(b.type) || headingLike(b)) { if (!/^(abstract|summary)$/i.test(bare(t))) out.push({ name: bare(t), blockId: b.id }); return; }
    const m = /^([\p{L} ()/-]{3,40})\s*[:.]\s+\S/u.exec(t);
    if (m) out.push({ name: m[1].trim(), blockId: b.id });
  });
  return out;
}

const REQ_LABEL = Object.fromEntries(REQUIREMENTS.map(r => [r.id, r.label]));
const ORCID_IN_TEXT = /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/;

/**
 * Everything above, and the manuscript's own checks (`checks`, the issues
 * lib/manuscript-checks.mjs returns), in sections a submitting author works
 * through. `declarations` holds statements kept outside the manuscript text,
 * by requirement id (e.g. { coi: 'None declared', orcid: true }); a declared
 * statement counts as present. `retraction` is the "Retraction check" item of
 * lib/integrity.mjs retractionReadiness, or null. `ready` is true when nothing is 'missing'.
 */
export function readinessReport({ blocks = [], assets = [], notes: docNotes = {}, section = null, profile = null, researchType = 'other', declarations = {}, checks = [], variety = null, retraction = null } = {}) {
  const roles = submissionRoles(blocks);
  const item = (label, state, detail = '') => ({ label, state, detail });
  const out = [];

  if (profile) {
    const rows = countsAgainstProfile(blocks, profile, { assets, notes: docNotes, section });
    out.push({ title: 'Limits', items: rows.map(r => {
      if (r.what === 'Keywords') {
        const lim = r.limit;
        if (!lim) return item(r.what, 'ok', `${r.value}; no limit set`);
        const range = lim.min != null && lim.max != null ? `${lim.min}–${lim.max}` : lim.max != null ? `up to ${lim.max}` : `at least ${lim.min}`;
        return item(r.what, r.over || r.under ? (r.value ? 'warn' : 'missing') : 'ok', `${r.value} of ${range}`);
      }
      if (r.limit == null) return item(r.what, 'ok', `${r.value}; no limit set`);
      return item(r.what, r.over ? 'warn' : 'ok', `${r.value} of ${r.limit}${r.over ? ` (${r.value - r.limit} over)` : ''}`);
    }) });

    const parts = abstractParts(blocks, roles);
    const hasAbstract = roles.includes('abstract');
    const abs = [];
    if (!hasAbstract) abs.push(item('Abstract', profile.abstractHeadings?.length || profile.abstractLimit ? 'missing' : 'ok', profile.abstractHeadings?.length || profile.abstractLimit ? 'No abstract found' : 'Not required by this profile'));
    else if (profile.abstractStructured && profile.abstractHeadings?.length) {
      const names = parts.map(p => p.name.toLowerCase());
      for (const h of profile.abstractHeadings) {
        const found = headingNames(h).some(n => names.includes(n));
        abs.push(item(h, found ? 'ok' : 'missing', found ? '' : 'No abstract part with this heading'));
      }
      const expected = new Set(profile.abstractHeadings.flatMap(headingNames));
      const extras = parts.filter(p => !expected.has(p.name.toLowerCase()));
      if (extras.length) abs.push(item('Other headings', 'warn', extras.map(p => p.name).join(', ')));
    } else if (!profile.abstractStructured && parts.length >= 2) abs.push(item('Abstract form', 'warn', 'The profile expects an unstructured abstract'));
    else abs.push(item('Abstract', 'ok'));
    out.push({ title: 'Abstract', items: abs });
  }

  const sc = sectionCheck(blocks, researchType);
  out.push({ title: 'Sections', items: [
    ...sc.needed.map(n => item(n.label, n.found ? 'ok' : n.level === 'section' ? 'missing' : 'warn', n.found ? '' : n.level === 'section' ? 'No section with this heading' : `No heading for this ${n.why} item; check it is reported`)),
    ...sc.hierarchy.map(h => item(h.kind === 'empty' ? 'Empty section' : h.kind === 'skip' ? 'Heading levels' : 'Title', 'warn', h.message)),
  ] });

  const required = new Set([...(profile?.requires || []), 'funding', 'coi']);
  if (/^(rct|diagnostic-study)$/.test(researchType) || REVIEW_TYPES.has(researchType)) required.add('registration');
  if (researchType === 'case-report') required.add('consent');
  const statements = [];
  for (const d of sc.disclosures) {
    const declared = declarations?.[d.id];
    const state = d.found && !d.empty || declared ? 'ok' : required.has(d.id) ? 'missing' : null;
    if (!state && !d.found) continue;
    statements.push(item(d.label, state || (d.empty ? 'warn' : 'ok'), d.found ? d.empty ? 'The section is empty' : '' : declared ? 'Declared outside the text' : 'Not found'));
  }
  if (required.has('orcid')) {
    const has = declarations?.orcid || blocks.some(b => ORCID_IN_TEXT.test(b.text || ''));
    statements.push(item(REQ_LABEL.orcid, has ? 'ok' : 'missing', has ? '' : 'The journal asks for ORCID iDs'));
  }
  out.push({ title: 'Statements', items: statements });

  const ao = assetOrderCheck(blocks, assets);
  out.push({ title: 'Figures and tables', items: ao.findings.length ? ao.findings.map(f => item(f.label || 'Figure or table', f.kind === 'missing' ? 'missing' : 'warn', f.message)) : [item('Citation order', 'ok')] });

  const cc = consistencyCheck(blocks, { variety });
  out.push({ title: 'Consistency', items: cc.length ? cc.map(f => item(f.message, 'warn', f.examples.join(', '))) : [item('Spelling and number style', 'ok')] });

  const errors = checks.filter(c => c.severity === 'error'), warns = checks.filter(c => c.severity === 'warn'), notes = checks.filter(c => c.severity === 'note');
  out.push({ title: 'Manuscript checks', items: [
    ...errors.map(c => item(c.message, 'missing', c.kind)),
    ...warns.map(c => item(c.message, 'warn', c.kind)),
    ...(notes.length ? [item(`${notes.length} note${notes.length > 1 ? 's' : ''}`, 'warn', uniq(notes.map(c => c.kind)).join(', '))] : []),
    ...(!checks.length ? [item('No issues', 'ok')] : []),
  ] });

  // The retraction check of the records the manuscript rests on (lib/integrity.mjs retractionReadiness), when there are any.
  if (retraction) out.push({ title: 'Retractions and corrections', items: [retraction] });

  return { ready: !out.some(s => s.items.some(i => i.state === 'missing')), sections: out };
}
