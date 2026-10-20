// The events of each study arm, by outcome, with the direction of effect: a synthesis without meta-analysis drawn from the evidence
// table (Tables and figures, plan amendment "A printed synthesis without meta-analysis is drawn", 2026-10-18). The Spine review's Figure 4.
//
//   studies      the studies of one collection of the table ("Table 4", the publication table of the studies of adult spinal deformity),
//                in the table's order;
//   arms         a study's arms (lib/arms.mjs); its name from the table's Device column (else the arm's own words), its patients from the
//                arm's "(n=32)", its follow-up as the table writes it;
//   outcomes     the project's count outcomes on that table (Screw loosening, Implant breakage, Revision, ASD, PJK: an item read from a text
//                column, lib/derived-counts.mjs), in the order the table's cells name them; with none, the items most of the studies count;
//   cells        each arm's events, read as a comparison reads them (lib/contrast-counts.mjs armEvents): "2/32 (6%)", "0/32", NR;
//   sides        a study of two arms sets its intervention against its comparator. The arm's side is the word before "stabilization",
//                "fusion" or "fixation" in its own words ("Dynesys dynamic stabilization" is dynamic), named with the noun the figure's
//                legend gives it ("fewer events with dynamic or hybrid stabilization than with rigid fusion": rigid fusion); the arm the
//                legend names first is the intervention, else Arm 1 (the table's convention). Studies of the same two sides are one
//                group ("Dynamic stabilization versus rigid fusion"); a one-arm study joins the side of the compared arm it shares a
//                short value with (its surgical intent, "Non-fusion"), "Dynamic stabilization, single arm";
//   direction    per outcome of a two-arm study: ▲ fewer events with the intervention, ▼ more, ◄► equal, – not counted in both arms;
//                the study's direction combines them as lib/swim-core.mjs does, and the comparative studies take its sign test;
//   ranges       per outcome, the one-arm cohorts' proportions from lowest to highest, never pooled.
//
// Nothing is copied: every cell is read from the table each time. Pure: the project in, the table out.
import { armsOf, cellKey } from './arms.mjs';
import { parseCountText, armSize, itemKey } from './count-text.mjs';
import { armEvents } from './contrast-counts.mjs';
import { combineDirections, signTest } from './swim-core.mjs';
import { evidenceModel } from './evidence-export.mjs';

export const MARK = Object.freeze({ benefit: '▲', harm: '▼', 'no clear': '◄►', none: '–' });
const textOf = v => (v == null ? '' : String(v.reported_value ?? v.normalized_value ?? ''));
const tidy = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const low = t => String(t || '').toLowerCase();
const cap = t => String(t || '').replace(/^./, c => c.toUpperCase());
const escRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOUN = '(stabili[sz]ation|fusion|fixation|instrumentation)';

// ---- which studies: the collection a caption names -------------------------------------------------------------------------------------
const STOP = new Set(['the', 'of', 'and', 'or', 'in', 'with', 'without', 'for', 'to', 'by', 'on', 'at', 'from', 'all', 'studies', 'study', 'table', 'figure',
  'synthesis', 'meta', 'analysis', 'patients', 'versus', 'vs', 'included', 'review']);
const wordsOf = t => new Set(low(t).split(/[^\p{L}]+/u).filter(w => w.length > 2 && !STOP.has(w)));
/**
 * The collection a caption names ("Synthesis without meta-analysis of the studies of adult spinal deformity": the collection whose name, or
 * whose publication table's caption, says "Studies of scoliosis, kyphosis or adult spinal deformity"), by the words they share; `tables` are
 * `[{ collection, caption }]`, the captions the paper prints for its publication tables. '' when none, or two, share the most.
 */
export function collectionFor(s, caption, tables = []) {
  const want = wordsOf(caption);
  if (!want.size) return '';
  const scored = (s.collections || []).map(c => {
    const own = wordsOf([c.name, ...tables.filter(t => t.collection === c.id).map(t => t.caption)].join(' '));
    return { id: c.id, n: [...want].filter(w => own.has(w)).length };
  }).sort((a, b) => b.n - a.n);
  const best = scored[0];
  return best && best.n >= Math.min(2, want.size) && best.n > (scored[1]?.n || 0) ? best.id : '';
}

// ---- the outcomes -------------------------------------------------------------------------------------------------------------------
/** The outcomes of the table: `[{ name, columns, items }]`, in the order the table's columns and then its cells name them. */
export function eventOutcomes(s, tpl, studies = []) {
  const colIndex = id => (tpl?.columns || []).findIndex(c => c.id === id);
  const texts = col => studies.flatMap(st => [null, ...(armsOf(tpl, st.paperId) || []).map(a => a.id)].map(a => textOf(s.values?.[cellKey(st.paperId, col, a)])).filter(Boolean));
  const seen = new Set();
  let list = (s.outcomes || []).filter(o => o?.derived?.kind === 'text-counts' && o.derived.template === tpl?.id && o.derived.column && (o.derived.items || []).length)
    .map(o => ({ name: String(o.name || o.derived.items[0]).trim(), columns: [o.derived.column], items: o.derived.items.map(itemKey) }))
    .filter(o => { const k = `${o.columns[0]}|${o.items.join('|')}`; return !seen.has(k) && seen.add(k); });
  if (!list.length) {
    // no outcome reads the table yet: the items its arm columns count in at least two arms, named as first written
    for (const col of tpl?.armColumns || []) {
      const by = new Map();
      for (const t of texts(col)) for (const i of parseCountText(t).items) if (i.status === 'count') {
        const e = by.get(i.key) || by.set(i.key, { name: cap(i.name), n: 0 }).get(i.key); e.n++;
      }
      for (const [key, e] of by) if (e.n >= 2) list.push({ name: e.name, columns: [col], items: [key] });
    }
  }
  const at = o => { for (const t of texts(o.columns[0])) { const i = parseCountText(t).items.findIndex(x => o.items.includes(x.key)); if (i >= 0) return i; } return 99; };
  return list.map(o => ({ ...o, order: [colIndex(o.columns[0]), at(o)] })).sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]).map(({ order, ...o }) => o);
}

// ---- the arms ---------------------------------------------------------------------------------------------------------------------------
const colWhere = (tpl, re) => (tpl?.columns || []).find(c => re.test(String(c.label || c.name || '')))?.id || '';
/** An arm's own words: the lines of its arm cell after "Arm 1 (n=32)" or "NA (n=68)". */
const armWords = text => String(text || '').split('\n').filter((l, i) => i > 0 || !/^(arm\s*\d+|na)\s*\(n\s*=/i.test(l.trim())).join(' ').trim();
/** The word an arm's words set against another arm's: "dynamic" of "Dynesys dynamic stabilization", "rigid" of "Conventional rigid stabilization". */
const sideWord = words => new RegExp(`([\\p{L}-]+)\\s+${NOUN}\\b`, 'iu').exec(words)?.[1]?.toLowerCase() || '';
/** A side named with the noun the legend gives its word ("rigid fusion"), else the arm's own noun ("rigid stabilization"). */
function sideName(word, words, legend) {
  const W = '[\\p{L}-]+';
  const m = new RegExp(`(?:^|[^\\p{L}])${escRe(word)}((?:\\s*,\\s*${W}|\\s+(?:or|and)\\s+${W})*)\\s+${NOUN}`, 'iu').exec(legend || '')
    || new RegExp(`(?:^|[^\\p{L}])${escRe(word)}\\s+${NOUN}`, 'iu').exec(words);
  return m ? `${word} ${low(m[m.length - 1])}` : word;
}

/**
 * The table: `{ template, collection, outcomes, groups, comparative, ranges, notes }` or null when the collection or its table is gone.
 * A group: `{ title, kind: 'comparative' | 'single', studies: [{ paperId, label, arms: [{ id, name, n, followUp, side, cells }], directions }] }`;
 * a cell `{ status, events, n, text, reason }`; directions per outcome 'benefit' | 'harm' | 'no clear' | 'none', with the study's own.
 */
export function swimEvents(s, { collection = '', template = '', legend = '' } = {}) {
  const coll = (s.collections || []).find(c => c.id === collection);
  const tpl = (s.templates || []).find(t => t.id === template) || (s.templates || []).find(t => (coll?.members || []).some(id => Object.keys(s.values || {}).some(k => k.startsWith(`${id}:${t.id}.`))));
  if (!coll || !tpl) return null;
  let model;
  try { model = evidenceModel(s, tpl.id); } catch { return null; }
  const members = new Set(coll.members || []), studies = model.studies.filter(st => members.has(st.paperId));
  const outcomes = eventOutcomes(s, tpl, studies);
  const nOutcome = (s.outcomes || []).find(o => o?.derived?.template === tpl.id && o.derived.nColumn);
  const nCol = nOutcome?.derived.nColumn || colWhere(tpl, /^arm\b/i) || (tpl.armColumns || [])[0] || '';
  const fuCol = colWhere(tpl, /follow[\s-]?up/i), deviceCol = colWhere(tpl, /^(device|intervention|implant|treatment)s?$/i);
  const cell = (pid, col, arm) => (col ? tidy(textOf(s.values?.[cellKey(pid, col, arm)] || s.values?.[cellKey(pid, col)])) : '');
  const armOf = (st, a, i) => {
    const armText = a ? textOf(s.values?.[cellKey(st.paperId, nCol, a.id)]) || a.label : textOf(s.values?.[cellKey(st.paperId, nCol)]);
    const words = armWords(armText), n = armSize(armText) ?? armSize(a?.label);
    const cells = outcomes.map(o => {
      const r = armEvents(s, { columns: o.columns }, st.paperId, a?.id || null, o.items, n);
      const text = r.status === 'count' ? (r.events ? `${r.events}/${r.n} (${Math.round((100 * r.events) / r.n)}%)` : `0/${r.n}`) : r.status === 'missing' ? 'NR' : 'Not read';
      return { status: r.status, events: r.events ?? null, n: r.n ?? null, text, reason: r.reason || '' };
    });
    return { id: a?.id || null, name: cell(st.paperId, deviceCol, a?.id) || words || (a ? `Arm ${i + 1}` : ''), n, followUp: cell(st.paperId, fuCol, a?.id), words, word: sideWord(words), cells };
  };
  const rows = studies.map(st => { const arms = armsOf(tpl, st.paperId); return { paperId: st.paperId, label: st.label, arms: arms ? arms.map((a, i) => armOf(st, a, i)) : [armOf(st, null, 0)] }; });

  // the comparative studies: the intervention is the arm the legend names first, else Arm 1
  const where = w => { const m = w ? new RegExp(`(^|[^\\p{L}])${escRe(w)}(?=$|[^\\p{L}])`, 'iu').exec(legend) : null; return m ? m.index : Infinity; };
  const groups = [], byTitle = new Map(), sideOfArm = [];
  for (const st of rows.filter(r => r.arms.length === 2)) {
    const [a, b] = st.arms, [t, c] = where(b.word) < where(a.word) ? [b, a] : [a, b];
    st.arms = [t, c];
    t.side = t.word ? sideName(t.word, t.words, legend) : ''; c.side = c.word ? sideName(c.word, c.words, legend) : '';
    st.directions = outcomes.map((_, k) => {
      const x = t.cells[k], y = c.cells[k];
      if (x.status !== 'count' || y.status !== 'count') return 'none';
      const px = x.events / x.n, py = y.events / y.n;
      return px < py ? 'benefit' : px > py ? 'harm' : 'no clear';
    });
    st.direction = combineDirections(st.directions.filter(d => d !== 'none')) || 'none';
    const title = t.side && c.side ? `${cap(t.side)} versus ${c.side}` : 'Two arms';
    if (!byTitle.has(title)) { const g = { title, kind: 'comparative', studies: [] }; byTitle.set(title, g); groups.push(g); }
    byTitle.get(title).studies.push(st);
    sideOfArm.push(...[t, c].filter(x => x.side).map(x => ({ side: x.side, pid: st.paperId, arm: x.id })));
  }
  // the one-arm studies, by the side of the compared arm whose short values they share; three or more arms are listed as they are
  const shared = st => {
    const votes = new Map();
    for (const col of tpl.armColumns || []) {
      const v = low(cell(st.paperId, col, null));
      if (!v || v.length > 30 || /^(nr|na)$/.test(v)) continue;
      for (const x of sideOfArm) if (low(cell(x.pid, col, x.arm)) === v && s.values?.[cellKey(x.pid, col, x.arm)]) votes.set(x.side, (votes.get(x.side) || 0) + 1);
    }
    return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  };
  for (const st of rows.filter(r => r.arms.length !== 2)) {
    const side = st.arms.length === 1 ? shared(st) : '';
    const title = st.arms.length === 1 ? (side ? `${cap(side)}, single arm` : 'Single arm') : 'Several arms';
    const key = `single:${title}`;
    if (!byTitle.has(key)) { const g = { title, kind: st.arms.length === 1 ? 'single' : 'several', studies: [] }; byTitle.set(key, g); groups.push(g); }
    byTitle.get(key).studies.push(st);
  }
  groups.sort((a, b) => (a.kind === 'comparative' ? 0 : 1) - (b.kind === 'comparative' ? 0 : 1));

  // the comparative studies' direction and sign test; the one-arm cohorts' ranges
  const compared = groups.filter(g => g.kind === 'comparative').flatMap(g => g.studies);
  const benefit = compared.filter(st => st.direction === 'benefit').length, harm = compared.filter(st => st.direction === 'harm').length;
  const sides = [...new Set(compared.map(st => st.arms[0].side).filter(Boolean))];
  const noun = sides.length && sides.every(x => x.split(' ').at(-1) === sides[0].split(' ').at(-1)) ? sides[0].split(' ').at(-1) : '';
  const sideWords = noun && sides.length > 1 ? `${sides.map(x => x.split(' ').slice(0, -1).join(' ')).join(' or ')} ${noun}` : sides.join(' or ') || 'the intervention';
  const test = signTest(benefit, harm);
  const comparative = compared.length ? { studies: compared.length, benefit, harm, p: test.p, sides: sideWords } : null;
  const single = groups.filter(g => g.kind === 'single').flatMap(g => g.studies);
  const ranges = outcomes.map((o, k) => {
    const pct = single.map(st => st.arms[0].cells[k]).filter(c => c.status === 'count').map(c => (100 * c.events) / c.n);
    if (!pct.length) return null;
    const lo = Math.round(Math.min(...pct)), hi = Math.round(Math.max(...pct));
    return { outcome: o.name, cohorts: pct.length, lo, hi };
  }).filter(Boolean);
  const notes = [];
  if (comparative) notes.push(`Comparative studies: fewer events with ${sideWords} in ${benefit} of ${compared.length} ${compared.length === 1 ? 'study' : 'studies'}${test.p == null ? '' : ` (sign test P = ${test.p.toFixed(2)})`}`);
  if (ranges.length) notes.push(`Single-arm cohorts, range: ${ranges.map((r, i) => `${i && r.outcome !== r.outcome.toUpperCase() ? r.outcome.replace(/^./, c => c.toLowerCase()) : r.outcome} ${r.lo === r.hi ? r.lo : `${r.lo}–${r.hi}`}% (${r.cohorts} ${r.cohorts === 1 ? 'cohort' : 'cohorts'})`).join('; ')}`);
  return { template: tpl, collection: coll, outcomes, groups, comparative, ranges, notes, studies: rows.length, fuLabel: tpl.columns.find(c => c.id === fuCol)?.label || 'Follow-up' };
}

/**
 * The table as rows of text: the head, then per group its title, each arm (the study named on its first arm) and, for a study of two arms,
 * its direction of effect. `{ head, body: [{ kind: 'group' | 'arm' | 'direction', cells }], notes }`; `flat` is head and body as plain rows.
 */
export function swimEventRows(t) {
  if (!t) return { head: [], body: [], notes: [], flat: [] };
  const head = ['Study', 'Arm', 'Patients', t.fuLabel, ...t.outcomes.map(o => o.name)], body = [];
  for (const g of t.groups) {
    body.push({ kind: 'group', cells: [g.title] });
    for (const st of g.studies) {
      st.arms.forEach((a, i) => body.push({ kind: 'arm', cells: [i ? '' : st.label, a.name, a.n == null ? '' : String(a.n), a.followUp, ...a.cells.map(c => c.text)] }));
      if (st.directions) body.push({ kind: 'direction', cells: ['', 'Direction of effect', '', '', ...st.directions.map(d => MARK[d])] });
    }
  }
  return { head, body, notes: t.notes, flat: [head, ...body.map(r => r.cells)] };
}

/**
 * The table the printed figure was made from, when the folder holds it (the Spine review's "Evidence table/tools/swim_table.json", written by
 * its figure's script: `{ headers, rows: [{ kind: 'section', text } | { kind: 'arm' | 'direction', cells }], n_favour, n_studies, p_sign,
 * ranges }`): its own names and results ("Rigid fusion", follow-up "17"), as swimEventRows draws them, or null when it is not such a table.
 * `app` (swimEventRows of the evidence table) lends the wording of the comparative footnote.
 */
export function rowsFromData(j, app = null) {
  if (!j || !Array.isArray(j.headers) || !Array.isArray(j.rows) || !/^study$/i.test(String(j.headers[0] || '').trim())) return null;
  const head = j.headers.map(h => String(h ?? ''));
  const body = j.rows.map(r => (r?.kind === 'section' ? { kind: 'group', cells: [String(r.text ?? '')] }
    : { kind: r?.kind === 'direction' ? 'direction' : 'arm', cells: (r?.cells || []).map(c => String(c ?? '')) }));
  const notes = [], p = Number(j.p_sign);
  if (j.n_studies != null && j.n_favour != null) {
    const said = `in ${j.n_favour} of ${j.n_studies} ${Number(j.n_studies) === 1 ? 'study' : 'studies'}${Number.isFinite(p) ? ` (sign test P = ${p.toFixed(2)})` : ''}`;
    const comp = (app?.notes || []).find(n => /^Comparative studies/.test(n));
    notes.push(comp ? comp.replace(/in \d+ of \d+ stud(?:y|ies)(?: \(sign test P = [^)]*\))?/, said) : `Comparative studies: fewer events ${said}`);
  }
  if (Array.isArray(j.ranges) && j.ranges.length) notes.push(`Single-arm cohorts, range: ${j.ranges.join('; ')}`);
  return { head, body, notes, flat: [head, ...body.map(r => r.cells)] };
}
