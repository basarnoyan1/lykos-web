// The GRADE summary of findings table, in the form the handbook prescribes:
// the question above, one row per outcome — anticipated absolute effects,
// relative effect, participants and studies, certainty with its reasons as
// lettered footnotes — and the grade definitions beneath. Built only from
// what the certainty view holds; a blank cell stays blank.
import { certainty, downgrades, explanationText, DESIGNS, DOWNGRADE, UPGRADE, UPGRADE_RATINGS } from './grade.mjs';

export function summaryOfFindings(s) {
  const p = s.protocol || {}; const pico = p.pico || {};
  const outcomes = s.grade || [];
  const notes = []; const note = text => { let i = notes.indexOf(text); if (i < 0) { notes.push(text); i = notes.length - 1; } return String.fromCharCode(97 + i); };
  const rows = outcomes.map(o => {
    const c = certainty(o);
    // A written explanation for a domain is its footnote; without one the
    // footnote says only what was downgraded, as before.
    const marks = c.overridden ? (o.overrideReason ? [note(o.overrideReason)] : [])
      : downgrades(o).map(d => note(explanationText(o.explanations?.[d.id]).trim() || `Downgraded for ${d.reason}.`));
    return {
      outcome: o.name || '', comparator: o.comparatorRisk || '', intervention: o.absolute || '',
      relative: o.effect || '', participants: [o.participants, o.studies].some(Boolean) ? `${o.participants || '—'} (${o.studies || '—'} studies)` : '',
      certainty: c.final, marks: marks.join(','), comment: o.comment || '',
    };
  });
  return {
    title: p.title || s.paper?.title || 'Summary of findings',
    question: [['Patient or population', pico.population || ''], ['Setting', p.setting || ''], ['Intervention', pico.intervention || ''], ['Comparison', pico.comparator || '']],
    columns: ['Outcomes', 'Risk with comparator', 'Risk with intervention', 'Relative effect (95% CI)', '№ of participants (studies)', 'Certainty of the evidence (GRADE)', 'Comments'],
    rows, notes,
  };
}

const GRADE_TEXT = [
  'GRADE Working Group grades of evidence.',
  'High certainty: we are very confident that the true effect lies close to that of the estimate of the effect.',
  'Moderate certainty: we are moderately confident in the effect estimate; the true effect is likely to be close to the estimate, but there is a possibility that it is substantially different.',
  'Low certainty: our confidence in the effect estimate is limited; the true effect may be substantially different from the estimate.',
  'Very low certainty: we have very little confidence in the effect estimate; the true effect is likely to be substantially different from the estimate.',
];

const cell = (r, i) => [r.outcome, r.comparator, r.intervention, r.relative, r.participants, `${r.certainty}${r.marks ? ` ${r.marks}` : ''}`, r.comment][i];

export function toMarkdown(sof) {
  const out = [`# Summary of findings — ${sof.title}`, ''];
  for (const [k, v] of sof.question) if (v) out.push(`**${k}:** ${v}  `);
  out.push('', `| ${sof.columns.join(' | ')} |`, `| ${sof.columns.map(() => '---').join(' | ')} |`);
  for (const r of sof.rows) out.push(`| ${sof.columns.map((_, i) => String(cell(r, i)).replace(/\|/g, '\\|')).join(' | ')} |`);
  out.push('');
  sof.notes.forEach((n, i) => out.push(`${String.fromCharCode(97 + i)}. ${n}`));
  out.push('', ...GRADE_TEXT);
  return out.join('\n');
}

/** Blocks for the Word writer: paragraphs and one table block. */
export function toBlocks(sof) {
  let n = 0; const id = () => `g${++n}`;
  const b = [{ id: id(), type: 'title', text: `Summary of findings: ${sof.title}` }];
  for (const [k, v] of sof.question) if (v) b.push({ id: id(), type: 'p', text: `${k}: ${v}` });
  b.push({ id: id(), type: 'table', header: true, rows: [sof.columns, ...sof.rows.map(r => sof.columns.map((_, i) => String(cell(r, i))))] });
  sof.notes.forEach((t, i) => b.push({ id: id(), type: 'p', text: `${String.fromCharCode(97 + i)}. ${t}` }));
  GRADE_TEXT.forEach(t => b.push({ id: id(), type: 'p', text: t }));
  return b;
}

// ---- the GRADE table in a journal's layout (Batch 13 item 1; plan §4.15e) -------------------------------------------
// One row per outcome: Outcome | Studies (patients) | Study design | the five downgrading domains, each a bold judgement
// with its explanation under it | Upgrading factors | Certainty as ⊕ symbols with the level | Summary of findings.
// An explanation is the row's own (`explanations[domain]`, as the Certainty page edits them); a row imported before the
// field existed carries them in `comment`, one "Domain: text" line each, which is read as the fallback.
export const CERTAINTY_SYMBOLS = Object.freeze({ High: '⊕⊕⊕⊕', Moderate: '⊕⊕⊕○', Low: '⊕⊕○○', 'Very low': '⊕○○○' });
export const GRADE_COLUMNS = Object.freeze(['Outcome', 'Studies (patients)', 'Study design', 'Risk of bias', 'Inconsistency', 'Indirectness', 'Imprecision', 'Publication bias', 'Upgrading factors', 'Certainty', 'Summary of findings']);
const WORD = { none: 'Not serious', serious: 'Serious', veryserious: 'Very serious' };
const PUBLICATION_WORD = { none: 'Undetected', serious: 'Suspected', veryserious: 'Strongly suspected' };
const COMMENT_HEADS = { rob: ['Risk of bias', 'Rob'], inconsistency: ['Inconsistency'], indirectness: ['Indirectness'], imprecision: ['Imprecision'], publication: ['Publication bias', 'Other', 'Other considerations'], upgrading: ['Upgrading', 'Upgrade', 'Large effect'] };

/** A domain's explanation: the row's field, else the "Domain: text" line of its comment, else ''. */
export function explanationFor(o, id) {
  const own = explanationText(o?.explanations?.[id]).trim();
  if (own) return own;
  const heads = (COMMENT_HEADS[id] || []).map(h => h.toLowerCase());
  for (const line of String(o?.comment || '').split('\n')) {
    const m = /^([^:]{1,40}):\s*(.+)$/.exec(line.trim());
    if (m && heads.includes(m[1].trim().toLowerCase())) return m[2].trim();
  }
  return '';
}
const judgementWord = (o, d) => (d.id === 'publication' ? PUBLICATION_WORD : WORD)[o.ratings?.[d.id]] || (d.id === 'publication' ? PUBLICATION_WORD.none : WORD.none);
function upgradingWord(o, c) {
  if (c.start === 'High') return 'Not applicable';
  const applied = c.canUpgrade ? UPGRADE.filter(u => (UPGRADE_RATINGS.find(r => r.value === o.ratings?.[u.id])?.steps || 0) > 0)
    .map(u => `${u.label} (${UPGRADE_RATINGS.find(r => r.value === o.ratings[u.id]).label})`) : [];
  return applied.length ? applied.join('; ') : 'Not applied';
}
const countsText = o => ([o.studies, o.participants].some(Boolean) ? `${o.studies || '—'}${o.participants ? ` (${o.participants})` : ''}` : '');
const designText = o => o.designText || DESIGNS.find(d => d.id === o.design)?.label || DESIGNS[1].label;
const summaryText = o => o.summary || [o.events?.intervention && o.events?.comparator ? `${o.events.intervention} vs ${o.events.comparator}` : '', o.effect, o.absolute].filter(Boolean).join('; ') || String(o.comment || '').split('\n')[0] || '';

/** The table: `{ title, comparison, columns, rows: [{ outcome, studies, design, domains: [{ id, label, judgement, explanation }], upgrading, certainty: { level, symbols }, summary }] }`. */
export function gradeTable(s) {
  const p = s.protocol || {}, pico = p.pico || {};
  const rows = (s.grade || []).map(o => {
    const c = certainty(o);
    return { outcome: o.name || '', studies: countsText(o), design: designText(o),
      domains: DOWNGRADE.map(d => ({ id: d.id, label: d.label, judgement: judgementWord(o, d), explanation: explanationFor(o, d.id) })),
      upgrading: { judgement: upgradingWord(o, c), explanation: explanationFor(o, 'upgrading') },
      certainty: { level: c.final, symbols: CERTAINTY_SYMBOLS[c.final] || '', explanation: c.overridden ? o.overrideReason || '' : '' },
      summary: summaryText(o) };
  });
  const comparison = pico.intervention && pico.comparator ? `${pico.intervention} compared with ${pico.comparator}${pico.population ? ` in ${pico.population}` : ''}` : '';
  return { title: p.title || s.paper?.title || 'GRADE certainty of evidence', comparison, columns: [...GRADE_COLUMNS], rows };
}
const SYMBOL_KEY = 'Certainty: ⊕⊕⊕⊕ high, ⊕⊕⊕○ moderate, ⊕⊕○○ low, ⊕○○○ very low.';
/** Each cell as [bold line, lines under it], in column order. */
const gradeCells = r => [[r.outcome, ''], [r.studies, ''], [r.design, ''], ...r.domains.map(d => [d.judgement, d.explanation]),
  [r.upgrading.judgement, r.upgrading.explanation], [r.certainty.symbols, [r.certainty.level, r.certainty.explanation].filter(Boolean).join('\n')], [r.summary, '']];

export function gradeTableMarkdown(t) {
  const md = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  const out = [`# GRADE certainty of evidence — ${t.title}`, ''];
  if (t.comparison) out.push(`**Comparison:** ${t.comparison}`, '');
  out.push(`| ${t.columns.join(' | ')} |`, `| ${t.columns.map(() => '---').join(' | ')} |`);
  for (const r of t.rows) out.push(`| ${gradeCells(r).map(([head, under], i) => (i >= 3 && i <= 8 && head ? `**${md(head)}**` : md(head)) + (under ? `<br>${md(under)}` : '')).join(' | ')} |`);
  out.push('', SYMBOL_KEY, '', ...GRADE_TEXT);
  return out.join('\n');
}
/** Blocks for the Word writer: a landscape table with rules only, the judgement bold and its explanation under it. */
export function gradeTableBlocks(t) {
  let n = 0; const id = () => `gt${++n}`;
  const b = [{ id: id(), type: 'title', text: `GRADE certainty of evidence: ${t.title}` }];
  if (t.comparison) b.push({ id: id(), type: 'p', text: `Comparison: ${t.comparison}` });
  const rows = [t.columns, ...t.rows.map(r => gradeCells(r).map(([head, under], i) => ({ runs: [{ t: head, b: i >= 3 && i <= 8 }, ...(under ? [{ t: `\n${under}` }] : [])] })))];
  b.push({ id: id(), type: 'table', header: true, borders: 'horizontal', sz: 8, width: 756, rows });   // 10.5 in in pt: a landscape A4 page's text width
  b.push({ id: id(), type: 'p', text: SYMBOL_KEY });
  GRADE_TEXT.forEach(text => b.push({ id: id(), type: 'p', text }));
  return b;
}
