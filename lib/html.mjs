// Escaping and sanitising for untrusted content: records come from imported files and PubMed, values from PDFs (plan §7; test
// scenario 14: content inside a document cannot reach privileged surfaces).

/** For text and quoted-attribute contexts. */
import { icon, ICON_PATHS } from './icons.mjs';
import { uiBar, watchWidth } from './ui-actions.mjs';
import { renderChatMath } from './chat-math.mjs';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** The words of an HTML fragment, as a title holds them: tags dropped, the five escapes read back, spaces collapsed. */
export const plainText = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const EVENT_ATTR = /^on/i;
const URL_ATTR = new Set(['href', 'xlink:href', 'src', 'from', 'to', 'values']);
const BANNED = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'use', 'image', 'animate', 'set']);

/**
 * Strips anything active from an SVG before it is inserted into the document.
 *
 * The figures come from our own vendored R, but they embed study labels that
 * came from a PDF or an imported file, so the output is only as trustworthy as
 * its inputs. Parsing and walking the tree is used rather than a regex because
 * a regex over markup is not a security boundary.
 */
export function sanitizeSvg(svg, { drop = [] } = {}) {
  if (!svg) return '';
  const dropped = new Set(drop.map(n => String(n).toLowerCase()));
  const doc = new DOMParser().parseFromString(String(svg), 'image/svg+xml');
  if (doc.querySelector('parsererror')) return '';
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return '';

  const clean = el => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (EVENT_ATTR.test(name)) { el.removeAttribute(attr.name); continue; }
      // Only same-document fragment references survive; no remote or script URLs.
      if (URL_ATTR.has(name) && !value.startsWith('#')) el.removeAttribute(attr.name);
      if (/^\s*(javascript|data)\s*:/i.test(value)) el.removeAttribute(attr.name);
    }
  };
  // comments go, and `drop` is applied here, never to the output as text (a text edit can wake a tag hidden in a comment)
  const walk = node => {
    for (const child of [...node.childNodes]) if (child.nodeType === 8) child.remove();
    for (const child of [...node.children]) {
      const name = child.nodeName.toLowerCase();
      if (BANNED.has(name) || dropped.has(name)) { child.remove(); continue; }
      clean(child);
      walk(child);
    }
  };
  // The root's own attributes too: <svg onload="…"> runs when inserted.
  clean(root);
  walk(root);
  return new XMLSerializer().serializeToString(root);
}

/**
 * An empty view. Every one names the state and offers the way out of it: an
 * action that goes where the missing thing comes from. Text alone, centred in
 * a void, tells a reader the page is broken rather than empty.
 *
 * `actions` are `{ id, label, icon?, primary? }`; the caller wires the ids. They are a foot bar centred under the text:
 * the first `primary` is the one primary, a repeated icon or an icon that is not registered is left out (the label stays),
 * and the bar never wraps: labels leave, then the actions stack as equal columns.
 *
 * Two sizes, no third. `page` (the default): the mark, a 20 px title, an optional detail and one action, for a page or a pane that has
 * nothing else to show. `inline`: one 13 px line (title, then the detail after it when there is one) at the edge of the rows it
 * stands in for, inside a section, a list or a panel that has other things on it; it draws no mark, and an action goes under the line.
 */
export function emptyState({ icon: iconName = 'file', title, detail = '', help = false, actions = [], size = 'page' }) {
  const seen = new Set();
  let primary = false;
  const acts = actions.map(a => {
    const ico = a.icon && ICON_PATHS[a.icon] && !seen.has(a.icon) ? a.icon : undefined;
    if (ico) seen.add(ico);
    const role = a.primary && !primary ? 'primary' : 'secondary';
    if (role === 'primary') primary = true;
    return { id: a.id, label: a.label, icon: ico, role, keep: true };
  });
  if (size === 'inline') {
    return `<div class="empty-state" data-size="inline" role="status">
    <p class="empty-line"><span class="empty-title">${esc(title)}</span>${detail ? `<span class="empty-detail"${help ? ' data-ui-help' : ''}>${esc(detail)}</span>` : ''}</p>
    ${acts.length ? uiBar({ kind: 'foot', label: String(title || 'Actions'), cls: 'actions', actions: acts, budget: acts.length > 4 ? { n: acts.length, reason: 'the caller declares these actions' } : undefined }) : ''}
  </div>`;
  }
  return `<div class="empty-state">
    <div class="empty-mark">${icon(iconName, { size: 22 })}</div>
    <div class="empty-title">${esc(title)}</div>
    ${detail ? `<div class="empty-detail"${help ? ' data-ui-help' : ''}>${esc(detail)}</div>` : ''}
    ${acts.length ? uiBar({ kind: 'foot', label: String(title || 'Actions'), align: 'center', cls: 'actions', actions: acts, budget: acts.length > 4 ? { n: acts.length, reason: 'the caller declares these actions' } : undefined }) : ''}
  </div>`;
}

/**
 * A text box that grows with what is typed, down to a ceiling, instead of
 * scrolling inside itself at two lines. Call once after the element exists;
 * call `.grow()` again after setting its value from code, and `.release()` when
 * the view goes. The box also measures again whenever its width changes (a
 * wrapped line count measured at another width is stale, and a box inside a
 * closed <details> has no width until it opens): that hearing is the width
 * engine's (`watchWidth`, ui-actions.mjs), the page's one resize observer, so
 * a view never keeps an observer for its text boxes. A box that is not laid
 * out (no width) keeps its height: measuring it would read a column of one
 * character.
 */
export function autoGrow(ta, { max = 320 } = {}) {
  if (!ta) return { grow() {}, release() {} };
  const grow = () => {
    if (!ta.clientWidth) return;
    ta.style.height = 'auto';
    const h = Math.min(max, ta.scrollHeight);
    ta.style.height = `${h}px`;
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
  };
  ta.addEventListener('input', grow);
  const unwatch = watchWidth(ta, grow);
  grow();
  return { grow, release: () => { ta.removeEventListener('input', grow); unwatch(); } };
}

/** A model's proposal, shown for a person to accept or discard. */
export function proposalBox({ id, title = 'Proposal', meta = '', body = '', accept = 'Accept' }) {
  return `<div class="proposal" id="${esc(id)}">
    <div class="proposal-head"><span>${esc(title)}</span>${meta ? `<span class="meta">${esc(meta)}</span>` : ''}
      <span class="spacer"></span>
      <button class="primary" data-accept>${esc(accept)}</button><button data-discard>Discard</button></div>
    <div class="proposal-body">${body}</div></div>`;
}

/**
 * A reply rendered: paragraphs, bullet and numbered lists, bold, italics, code. The
 * text is escaped first; the markup is added afterwards, never the reverse.
 */
export function renderMarkdown(text) {
  // Isolate code and escaped markers before adding emphasis. Punctuation next
  // to a closing star (journal names followed by commas, for example) is valid.
  const inline = s => s.split(/(`[^`]+`|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[^$]+\$\$|\$(?!\s)[^$\n]+?\$|\\[*`\\$])/g).map(part => {
    if (part.startsWith('`') && part.endsWith('`')) return `<code>${esc(part.slice(1, -1))}</code>`;
    if (/^\\[*`\\$]$/.test(part)) return esc(part.slice(1));
    if (part.startsWith('\\(') || part.startsWith('\\[') || part.startsWith('$$')) return renderChatMath(part.slice(2, -2), !part.startsWith('\\('));
    // Avoid interpreting two currency prices as an equation.
    if (part.startsWith('$') && part.endsWith('$') && !/^\$\d[\d,.]*\s/.test(part)) return renderChatMath(part.slice(1, -1));
    return esc(part).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(?<![\w*])\*(?![\s*])([^*]*?[^\s*])\*(?![\w*])/g, '<i>$1</i>');
  }).join('');
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [], stack = []; let para = [], blank = false;
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const renderList = list => `<${list.tag}${list.tag === 'ol' && list.start !== 1 ? ` start="${list.start}"` : ''}>${list.items.map(item => `<li>${inline(item.lines.join(' '))}${item.children.map(renderList).join('')}</li>`).join('')}</${list.tag}>`;
  for (const raw of lines) {
    const line = raw.trim(), indent = Math.min(80, raw.match(/^\s*/)[0].replace(/\t/g, '    ').length);
    const marker = line.match(/^(?:([-*•])|(\d+)[.)])\s+(.*)$/), head = line.match(/^#{1,3}\s+(.*)$/);
    if (!line) { flushPara(); blank = true; continue; }
    if (head) { flushPara(); stack.length = 0; out.push(`<p class="md-heading"><b>${inline(head[1])}</b></p>`); blank = false; continue; }
    if (marker) {
      flushPara(); const tag = marker[1] ? 'ul' : 'ol';
      while (stack.length && stack.at(-1).indent > indent) stack.pop();
      if (stack.at(-1)?.indent === indent && stack.at(-1).list.tag !== tag) stack.pop();
      if (!stack.length || stack.at(-1).indent < indent) {
        const list = { tag, start: Number(marker[2]) || 1, items: [] };
        if (stack.length) stack.at(-1).list.items.at(-1).children.push(list); else out.push(list);
        stack.push({ indent, list });
      }
      stack.at(-1).list.items.push({ lines: [marker[3]], children: [] }); blank = false; continue;
    }
    if (stack.length && (!blank || indent > stack.at(-1).indent)) {
      stack.at(-1).list.items.at(-1).lines.push(line);
    } else { stack.length = 0; para.push(line); }
    blank = false;
  }
  flushPara();
  return out.map(block => typeof block === 'string' ? block : renderList(block)).join('');
}

// Structured-abstract headings, as they appear in PubMed and Europe PMC.
const ABSTRACT_LABELS = ['Background', 'Introduction', 'Objectives?', 'Aims?', 'Purpose', 'Study design',
  'Design', 'Setting', 'Participants', 'Patients', 'Interventions?', 'Methods?', 'Materials and methods',
  'Main outcome measures?', 'Outcomes?', 'Measurements', 'Results', 'Findings', 'Conclusions?',
  'Interpretation', 'Summary of background data', 'Level of evidence', 'Clinical relevance',
  'Trial registration', 'Registration', 'Funding', 'Importance', 'Evidence acquisition',
  'Evidence synthesis', 'Data sources', 'Study selection', 'Data extraction', 'Limitations'];
// Journals set multi-word headings either way ("Study design", "Study Design");
// both forms are listed, and the match stays case-sensitive so a heading word
// inside a sentence ("the results showed") is never taken for one.
const titleCase = l => l.replace(/(^|\s)([a-z])/g, (m, sp, c) => sp + c.toUpperCase());
const ALL_LABELS = [...new Set(ABSTRACT_LABELS.flatMap(l => [l, titleCase(l)]))];
const LABEL_RE = new RegExp(`(^|\\n|[.)\\]!?]\\s*)(${ALL_LABELS.join('|')})(?::\\s*|(?=[A-Z0-9]))`, 'g');

/**
 * An abstract as HTML: each structured section on its own line with its
 * heading set in the heavier weight. Handles the plain "Label: text" lines the
 * sources now produce, and abstracts stored by earlier builds with the heading
 * glued to the next word ("ObjectiveTo evaluate", "Methods48 patients"): a
 * known heading directly followed by a capital or a digit is a boundary.
 */
// Capitals ("BACKGROUND: …", as PubMed often stores them) count only with their colon, so an
// acronym is never taken for a heading; they are shown in sentence case.
const UPPER_RE = new RegExp(`(^|\\n|[.)\\]!?]\\s*)(${ABSTRACT_LABELS.map(l => l.toUpperCase().replace(/S\?$/, 'S?')).join('|')}):\\s*`, 'g');
const sentence = l => l[0] + l.slice(1).toLowerCase();

export function abstractHtml(text) {
  const t = String(text || '').replace(UPPER_RE, (m, pre, label) => `${pre}\n\u0000${sentence(label)}\u0001`)
    .replace(LABEL_RE, (m, pre, label) => `${pre}\n\u0000${label}\u0001`);
  return t.split('\n').map(x => x.trim()).filter(Boolean).map(line => {
    const m = /^\u0000([^\u0001]+)\u0001\s*([\s\S]*)$/.exec(line);
    return m ? `<p><b>${esc(m[1])}</b> ${esc(m[2])}</p>` : `<p>${esc(line)}</p>`;
  }).join('');
}
