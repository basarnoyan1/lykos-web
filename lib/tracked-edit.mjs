// The assistant writes in the manuscript as a reviewer does in Word: its edit is a tracked change by "Assistant", the words it takes out
// struck through and the words it puts in marked, in the paragraph itself (owner, 2026-10-22: "the ai should be able to work like an
// agent that it can open the pages itself, write there real time"). Nothing is final until a person accepts it: Reject puts the paragraph
// back as it was, run for run, and the document's own Accept all and Reject all decide it as they decide any author's change.
//
// One write is one `change` ({ author, date, write }): `write` names it, so the answer that made it can accept or reject that write alone,
// leaving every other change in the paragraph as it is.
import { sourceOf, textOfRuns, sliceRuns, formatAt, CHAR_PROPS } from './manuscript-format.mjs';
import { newId } from './manuscript.mjs';

export const ASSISTANT = 'Assistant';
/** A new write: its author, its time (ISO, as a .docx w:date) and its name. */
export const assistantChange = () => ({ author: ASSISTANT, date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), write: `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` });

// Words, the spaces between them, a run of citations and a result marker are the units: a citation is never cut in two or retyped.
const UNIT = /(\s+|(?:\[@[^\]]+\])+|\{\{[^}]+\}\})/;
const units = text => String(text).split(UNIT).filter(Boolean);
const LCS_MAX = 4_000_000;

function diff(a, b) {
  const n = a.length, m = b.length;
  if (n * m > LCS_MAX) return [...a.map(t => ({ del: t })), ...b.map(t => ({ ins: t }))];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ same: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ del: a[i++] });
    else out.push({ ins: b[j++] });
  }
  while (i < n) out.push({ del: a[i++] });
  while (j < m) out.push({ ins: b[j++] });
  // a word changed reads as the old word struck, then the new one: deletions ahead of the insertions they sit among
  const merged = [];
  for (const op of out) {
    const k = Object.keys(op)[0], last = merged.at(-1);
    if (last && last.k === k) last.text += op[k]; else merged.push({ k, text: op[k] });
  }
  return merged;
}

const charOf = run => Object.fromEntries(CHAR_PROPS.filter(k => run?.[k] != null).map(k => [k, run[k]]));
const inserted = (text, like, change) => {
  const cites = [...text.matchAll(/\[@([^\]]+)\]/g)].map(m => m[1]);
  return cites.length && text.replace(/\[@[^\]]+\]/g, '') === '' ? { cite: cites, ins: { ...change } } : { ...charOf(like), t: text, ins: { ...change } };
};
const hasMarks = b => (b.runs || []).some(r => r.ins || r.del || r.fmtChange) || b.props?.markIns || b.props?.markDel;

/**
 * The paragraph `block` rewritten as `next` reads, as tracked runs by `change`: what stays keeps its runs (formatting, citations), what
 * goes is marked deleted, what comes is inserted with the formatting of the words around it. Null when the paragraph already holds
 * tracked changes (they are decided first) or the text is the same.
 */
export function trackedRewrite(block, next, change) {
  if (hasMarks(block)) return null;
  const runs = block.runs?.length ? block.runs : [{ t: block.text || '' }], src = { ...block, runs }, before = textOfRuns(runs);
  if (before === next) return null;
  const out = []; let at = 0;
  for (const { k, text } of diff(units(before), units(next))) {
    if (k === 'same') { out.push(...sliceRuns(src, at, at + text.length)); at += text.length; }
    else if (k === 'del') { out.push(...sliceRuns(src, at, at + text.length).map(({ ins, ...r }) => ({ ...r, del: { ...change } }))); at += text.length; }
    else out.push(inserted(text, formatAt(src, Math.max(0, at - 1)), change));
  }
  const kept = out.filter(r => r.cite || r.t || r.del);
  return { ...block, runs: kept.length ? kept : [{ t: '' }], text: textOfRuns(kept) };
}

/**
 * A paragraph put in after block `after` ('start': first), as a tracked insertion: its words are inserted, and the paragraph mark that
 * makes it a paragraph of its own is the one ending the paragraph before it (as Enter at that paragraph's end makes it in Word), so a
 * rejection anywhere takes the new paragraph out and leaves its neighbours as they were. Returns the blocks and the new block's id.
 */
export function trackedInsert(blocks, after, { type = 'p', text }, change) {
  const at = after === 'start' ? 0 : blocks.findIndex(b => b.id === after) + 1;
  if (after !== 'start' && at === 0) return null;
  const prev = blocks[at - 1], own = !prev || prev.props?.markIns || prev.props?.markDel || !['p', 'h1', 'h2', 'h3', 'title'].includes(prev.type);
  const b = { id: newId(), type, runs: [{ t: text, ins: { ...change } }], text, ...(own ? { props: { markIns: { ...change } } } : {}) };
  const marked = own ? blocks : blocks.map(x => x === prev ? { ...x, props: { ...(x.props || {}), markIns: { ...change } } } : x);
  return { blocks: [...marked.slice(0, at), b, ...marked.slice(at)], id: b.id };
}

const ofWrite = (m, write) => m && m.write === write;
/** Accept or reject one write (`change.write`) wherever it is, leaving every other change as it is. */
export function decideWrite(blocks, write, how) {
  const out = [];
  for (const b of blocks) {
    const runs = b.runs || [];
    const wholly = runs.length && runs.every(r => ofWrite(r.ins, write));
    if (wholly && how === 'reject') continue;   // a paragraph the write put in goes with it
    let props = b.props;
    if (ofWrite(props?.markIns, write) || ofWrite(props?.markDel, write)) {
      props = { ...props };
      if (ofWrite(props.markIns, write)) delete props.markIns;
      if (ofWrite(props.markDel, write)) delete props.markDel;
    }
    const next = runs.flatMap(r => {
      if (ofWrite(r.ins, write)) { if (how === 'reject') return []; const { ins, ...x } = r; return [x]; }
      if (ofWrite(r.del, write)) { if (how === 'accept') return []; const { del, ...x } = r; return [x]; }
      return [r];
    });
    if (props === b.props && next.length === runs.length && next.every((r, k) => r === runs[k])) { out.push(b); continue; }
    const kept = next.length ? next : [{ t: '' }], x = { ...b, runs: kept, text: textOfRuns(kept) };
    if (props && Object.keys(props).length) x.props = props; else delete x.props;
    out.push(x);
  }
  return out;
}

/** Whether a write is still in the document, undecided. */
export const writeOpen = (blocks, write) => (blocks || []).some(b => ofWrite(b.props?.markIns, write) || ofWrite(b.props?.markDel, write) || (b.runs || []).some(r => ofWrite(r.ins, write) || ofWrite(r.del, write)));

/** The paragraph's words with a write's deletions and insertions marked, for the answer that made it: [{ same|del|ins: text }]. */
export function writeParts(block, write) {
  return (block?.runs || []).map(r => {
    const text = r.cite ? r.cite.map(k => `[@${k}]`).join('') : r.t || '';
    return ofWrite(r.del, write) ? { del: text } : ofWrite(r.ins, write) ? { ins: text } : { same: r.del ? '' : sourceOf(r) };
  }).filter(p => Object.values(p)[0]);
}
