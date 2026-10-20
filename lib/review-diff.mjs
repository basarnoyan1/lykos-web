// The tracked-change preview of a suggested edit (CASE 3): a word-level difference in context, as a string of html.
// Pure and DOM-free. Every piece of text is escaped here; the one exception is the rendered output (table, figure) a
// caller passes for an insert_table / insert_figure, which the app generated itself and which is placed in the block as it is.
// The markup uses the foundation's .ui-diff classes (ui-actions.css): a fill for what is added, a strike for what is removed,
// no hue, no side bar, no tinted card. data-diff is the one hook; this file writes no data-ui-* attribute (ui-actions-contract).
import { diffWords } from './assist.mjs';
import { esc } from './html.mjs';

/** words(before) * words(after) above this and the O(n*m) word comparison is replaced by a sentence comparison. */
export const DIFF_GUARD = 4e6;
/** Above this share of changed words a paragraph is shown as the whole old text and the whole new text. */
const WHOLE_SHARE = 0.6;

const nWords = text => (String(text ?? '').match(/\S+/g) || []).length;
const kindOf = t => (t.ins != null ? 'ins' : t.del != null ? 'del' : 'same');
const blank = text => !/\S/.test(text);

/** Sentences of a text, each keeping its own words; the comparison unit when the word comparison would be too large. */
const sentencesOf = text => String(text ?? '').split(/(?<=[.!?])\s+/).filter(Boolean);

/** The raw word (or sentence) comparison: [{same}|{ins}|{del}] in document order. */
function rawTokens(before, after, guard) {
  const a = String(before ?? ''), b = String(after ?? '');
  if (nWords(a) * nWords(b) <= guard) return diffWords(a, b);
  // Too large for the quadratic comparison: each distinct sentence becomes one token and the same routine compares them.
  const ids = new Map(), back = new Map();
  const id = sentence => { if (!ids.has(sentence)) { const key = `s${ids.size}`; ids.set(sentence, key); back.set(key, sentence); } return ids.get(sentence); };
  const raw = diffWords(sentencesOf(a).map(id).join(' '), sentencesOf(b).map(id).join(' '));
  return raw.map(t => { const k = kindOf(t), v = t[k]; return { [k]: back.get(v) ?? v }; });
}

/**
 * The comparison as runs, in document order: {same}, {del}, {ins}. Changed words that touch (or only a space apart) become one
 * deleted run and one inserted run, so a sentence does not flicker between fill and plain every other word. When most of the words
 * changed (more than 60%) the block is the whole old text struck and the whole new text added.
 * opts.guard replaces DIFF_GUARD (tests); opts.rule false skips the 60% rule (the row summary reads the real changes).
 */
export function diffTokens(before, after, { guard = DIFF_GUARD, rule = true } = {}) {
  const toks = rawTokens(before, after, guard).map(t => { const k = kindOf(t); return { k, v: t[k] }; }).filter(t => t.v !== '');
  const out = [];
  const same = text => { if (!text) return; const last = out[out.length - 1]; if (last && 'same' in last) last.same += text; else out.push({ same: text }); };
  for (let i = 0; i < toks.length;) {
    if (toks[i].k === 'same') { same(toks[i].v); i++; continue; }
    let del = '', ins = '', j = i, end = i;
    while (j < toks.length) {
      const t = toks[j];
      if (t.k === 'del') { del += t.v; end = ++j; }
      else if (t.k === 'ins') { ins += t.v; end = ++j; }
      else if (blank(t.v) && j + 1 < toks.length && toks[j + 1].k !== 'same') { del += t.v; ins += t.v; j++; }   // a space between two changes belongs to both
      else break;
    }
    i = end;
    const lead = /^\s/.test(del) || /^\s/.test(ins) ? ' ' : '', trail = /\s$/.test(del) || /\s$/.test(ins) ? ' ' : '';
    same(lead);
    if (del.trim()) out.push({ del: del.trim() });
    if (ins.trim()) out.push({ ins: ins.trim() });
    same(trail);
  }
  if (rule && String(before ?? '').trim() && String(after ?? '').trim()) {
    const dels = out.filter(t => 'del' in t).map(t => t.del).join(' '), inss = out.filter(t => 'ins' in t).map(t => t.ins).join(' ');
    const changed = Math.max(nWords(dels), nWords(inss)), total = Math.max(nWords(before), nWords(after));
    if (dels && inss && total && changed / total > WHOLE_SHARE) return [{ del: String(before) }, { ins: String(after) }];
  }
  return out;
}

/** "+3 words, −2 words" (U+2212 for the minus); '' when nothing changed. */
export function countLine(tokens) {
  const added = nWords(tokens.filter(t => 'ins' in t).map(t => t.ins).join(' ')), removed = nWords(tokens.filter(t => 'del' in t).map(t => t.del).join(' '));
  const unit = n => `${n} ${n === 1 ? 'word' : 'words'}`;
  return [added && `+${unit(added)}`, removed && `−${unit(removed)}`].filter(Boolean).join(', ');
}

const cue = text => `<span class="ui-diff-cue">${text}: </span>`;   // read by a screen reader, hidden by the CSS: old and new words never read as one sentence
function inline(tokens) {
  let html = '', lastWas = '';
  for (const t of tokens) {
    const k = kindOf(t), text = esc(t[k]);
    if (k === 'same') html += text;
    else if (k === 'del') html += `<del>${cue('deleted')}${text}</del>`;
    else html += `${lastWas === 'del' ? ' ' : ''}<ins>${cue('inserted')}${text}</ins>`;
    lastWas = k;
  }
  return html;
}

const KINDS = new Set(['edit_paragraph', 'edit_heading', 'insert_paragraph', 'insert_heading', 'insert_table', 'insert_figure']);
const context = text => (String(text ?? '').trim() ? `<p class="ui-diff-context">${esc(String(text).trim())}</p>` : '');

/**
 * { kind, before, after, prev, next } -> html. kind: edit_paragraph | edit_heading | insert_paragraph | insert_heading |
 * insert_table | insert_figure (after is then the output as html: the caller's rendered table or chart and its caption).
 * prev and next are the paragraphs around the change, shown muted and clamped to two lines by the CSS.
 */
export function diffView({ kind, before = '', after = '', prev = '', next = '' } = {}) {
  if (!KINDS.has(kind)) return '';
  const output = kind === 'insert_table' || kind === 'insert_figure';
  if (output) return after ? `<div class="ui-diff" data-diff="output">${context(prev)}<div class="ui-diff-block aid-preview">${after}</div></div>` : '';
  const insert = kind.startsWith('insert_'), heading = kind.endsWith('_heading');
  if (insert && !String(after ?? '').trim()) return '';
  const tokens = insert ? [{ ins: String(after).trim() }] : diffTokens(before, after);
  const count = countLine(insert ? tokens : diffTokens(before, after, { rule: false }));   // the words that really changed, also when the block is shown whole
  return `<div class="ui-diff" data-diff="${insert ? 'insert' : 'edit'}">${context(kind === 'edit_heading' ? '' : prev)}<p class="ui-diff-block${heading ? ' ui-diff-heading' : ''}">${inline(tokens)}</p>${context(next)}${count ? `<p class="ui-diff-count">${esc(count)}</p>` : ''}</div>`;
}
