// Reviewer comments from a decision letter, and the point-by-point response
// letter built from them (plan §2, "Reviewer response": link comments to
// changes; distinguish proposed work from completed work).
//
// splitComments reads the layouts decision letters actually use — ScholarOne's
// "Reviewer: 1 / Comments to the Author", Editorial Manager's "Reviewer #1:",
// plain "Reviewer 1" and "Editor" headings, numbered ("1.", "1)", "(1)",
// "Comment 1:", "Point 1:") or bulleted points, "Major/Minor comments"
// subheadings — and keeps each comment's words exactly as the reviewer wrote
// them; only the leading number or bullet is taken off, into `n`.
//
// Pure: nothing here imports the store or a view.
import { newId } from './manuscript.mjs';

const block = (type, text, runs) => ({ id: newId(), type, text, ...(runs ? { runs } : {}) });

// "Reviewer #1", "Reviewer: 1", "Referee 2", "**Reviewer 1**", "Reviewer A", then
// either nothing (a heading) or a colon and the first words of the comments.
const REVIEWER = /^[\s*_#>]*(Reviewer|Referee)\s*(?:#|No\.?|:)?\s*(\d{1,2}|[A-Z])(?![\w])(.*)$/i;
const EDITOR = /^[\s*_#>]*(?:(?:comments?\s+(?:from|of)\s+(?:the\s+)?)?((?:associate|academic|handling|deputy|section|guest|senior|managing)\s+)?editor(?:[- ]in[- ]chief)?(?:'s|s')?(?:\s+(?:comments?|remarks|decision|summary))?(?:\s+to\s+(?:the\s+)?authors?)?)[\s*_]*:?[\s*_]*$/i;
// Lines that label a part of the letter and carry no comment.
const LABEL = /^[\s*_#>]*(?:\(?comments?\s+(?:to|for)\s+the\s+authors?\)?|\(?remarks\s+to\s+the\s+authors?\)?|reviewer\(s\)'?\s*comments?.*|reviewers'?\s+comments?.*|recommendation\s*:.*|comments?\s*:?)[\s*_]*:?[\s*_]*$/i;
const SUBHEAD = /^[\s*_#>]*((?:major|minor|specific|general|other|additional|technical|editorial)\s+(?:comments?|issues?|points?|concerns?|revisions?|remarks))[\s*_]*:?[\s*_]*$/i;
const SIGNOFF = /^\s*(?:sincerely|yours sincerely|yours faithfully|kind regards|best regards|with best regards|warm regards|regards|best wishes|with kind regards)\s*,?\s*$/i;
const NUMBERED = /^\s*(?:comment|point|query|remark|issue)\s*#?\s*(\d{1,3})\s*[:.)\-–]\s*|^\s*\(?(\d{1,3})[.)]\s+(?=\S)|^\s*\((\d{1,3})\)\s*(?=\S)/i;
const BULLET = /^\s*[-*•–●▪]\s+(?=\S)/;

const trimLines = lines => {
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b).join('\n');
};

/** Reviewer sections of a letter: [{ reviewer, lines }] in order. Text before the first heading is letter boilerplate. */
function sectionsOf(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let cur = null, anyHeading = false;
  for (const line of lines) {
    const e = EDITOR.exec(line);
    // "Editor-in-Chief" under a signature is not a heading: a heading has a colon or names comments
    if (e && (/:[\s*_]*$/.test(line) || /comment|remark|decision|summary/i.test(line) || /^[\s*_#>]*editor[\s*_]*$/i.test(line))) { anyHeading = true; cur = { reviewer: e[1] ? `${e[1].trim()[0].toUpperCase()}${e[1].trim().slice(1).toLowerCase()} Editor` : 'Editor', lines: [] }; out.push(cur); continue; }
    const r = REVIEWER.exec(line);
    if (r) {
      const rest = r[3].replace(/[*_]+/g, ' ').replace(/\((?:[^)]*)\)/g, ' ').trim();
      const bare = /^[:.\-–]?$/.test(rest);
      const lead = /^[:\-–]/.test(rest);
      if (bare || lead) {
        anyHeading = true;
        const id = /^\d+$/.test(r[2]) ? String(Number(r[2])) : r[2].toUpperCase();
        const name = `Reviewer ${id}`;
        // A second heading for the same reviewer (ScholarOne repeats them) continues the section.
        cur = out.find(s => s.reviewer === name) || { reviewer: name, lines: [] };
        if (!out.includes(cur)) out.push(cur);
        const first = lead ? rest.replace(/^[:\-–]\s*/, '').replace(LABEL, '').trim() : '';
        if (first) cur.lines.push(first);
        continue;
      }
    }
    if (SIGNOFF.test(line)) { cur = null; continue; }
    if (cur) cur.lines.push(line);
  }
  if (!anyHeading) return [{ reviewer: 'Reviewer 1', lines }];
  return out;
}

/** One reviewer's lines as points: numbered items, else bullets, else paragraphs. */
function pointsOf(lines) {
  const body = lines.filter(l => !LABEL.test(l));
  const numbered = body.some(l => NUMBERED.test(l));
  const bulleted = !numbered && body.some(l => BULLET.test(l));
  const out = [];
  let cur = null, section = '';
  const flush = () => { if (cur) { const t = trimLines(cur.lines); if (t) out.push({ section: cur.section, text: t }); } cur = null; };
  for (const line of body) {
    const sub = SUBHEAD.exec(line);
    if (sub) { flush(); section = sub[1].trim(); continue; }
    if (numbered || bulleted) {
      const m = numbered ? NUMBERED.exec(line) : BULLET.exec(line);
      if (m) { flush(); cur = { section, lines: [line.slice(m[0].length)] }; continue; }
      if (!cur) cur = { section, lines: [] };   // words before the first item: a general comment
      cur.lines.push(line);
      continue;
    }
    // prose: one point per paragraph
    if (!line.trim()) { flush(); continue; }
    if (!cur) cur = { section, lines: [] };
    cur.lines.push(line);
  }
  flush();
  return out;
}

/**
 * Comments of a decision letter as [{ reviewer, n, text, section? }], `n`
 * counting from 1 within each reviewer (so "Minor 1" after "Major 3" is 4;
 * the subheading is kept in `section`). A letter with no reviewer or editor
 * heading is read as one reviewer's comments.
 */
export function splitComments(text) {
  const out = [];
  for (const s of sectionsOf(text)) {
    pointsOf(s.lines).forEach((p, i) => out.push({ reviewer: s.reviewer, n: i + 1, text: p.text, ...(p.section ? { section: p.section } : {}) }));
  }
  return out;
}

const has = s => !!String(s ?? '').trim();

/**
 * The response letter as blocks: an opening paragraph; then, per reviewer in
 * order of first appearance, an h2 and, per point, an h3 "Comment n", the
 * comment as quote blocks (one per paragraph, words unchanged), a "Response:"
 * paragraph and a "Change:" paragraph ending with its location. Empty
 * responses, changes and locations are [bracketed] placeholders. A point with
 * `status: 'proposed'` says "Proposed change:", so work not yet done is not
 * reported as done.
 */
export function responseLetter(points, { title = '', journal = '', manuscriptId = '' } = {}) {
  const ms = [has(title) ? `“${String(title).trim()}”` : 'our manuscript', has(manuscriptId) ? `(${String(manuscriptId).trim()})` : ''].filter(Boolean).join(' ');
  const out = [block('p', `We thank the editor and the reviewers for their comments on ${has(title) ? 'our manuscript ' : ''}${ms}${has(journal) ? ` submitted to ${String(journal).trim()}` : ''}. Each comment is quoted below, followed by our response and the change made in the revised manuscript, with its location.`)];
  const order = [];
  for (const p of points || []) if (!order.includes(p.reviewer || 'Reviewer')) order.push(p.reviewer || 'Reviewer');
  for (const who of order) {
    out.push(block('h2', who));
    for (const p of (points || []).filter(x => (x.reviewer || 'Reviewer') === who)) {
      out.push(block('h3', `Comment ${p.n ?? ''}`.trim()));
      const paras = String(p.text || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
      (paras.length ? paras : ['[Reviewer comment]']).forEach(t => out.push(block('quote', t)));
      const response = has(p.response) ? String(p.response).trim() : '[Response to this comment.]';
      out.push(block('p', `Response: ${response}`, [{ t: 'Response:', b: true }, { t: ` ${response}` }]));
      const label = p.status === 'proposed' ? 'Proposed change:' : 'Change:';
      const change = has(p.change) ? String(p.change).trim() : '[Describe the change, or state that no change was made and why.]';
      const where = has(p.location) ? String(p.location).trim() : '[page and line, or section]';
      const tail = ` ${change} (${where})`;
      out.push(block('p', `${label}${tail}`, [{ t: label, b: true }, { t: tail }]));
    }
  }
  return out;
}
