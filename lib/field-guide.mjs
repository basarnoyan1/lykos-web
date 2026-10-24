// What the header of an extraction column can tell: the field's definition, the values it accepts and an example. The definition and the
// example are the field's own (`guide` and `example` on the built-in fields in schema.mjs; `guidance`/`definition` and `examples` on a review's
// own field or an imported table); the accepted values are read from its type, unit and limits, so they are never written twice.
import { esc } from './html.mjs';

const TYPE_LABEL = { text: 'Text', number: 'Number', integer: 'Whole number', category: 'One of the levels' };
const list = a => a.join(', ');

/** The accepted values of a field, as short phrases: its kind, unit, range, allowed values and whether it is required. */
export function acceptedOf(c = {}) {
  const out = [];
  if (c.type === 'category' && c.options?.length) out.push(`One of ${list(c.options)}`);
  else if (c.allowed?.length) out.push(`One of ${list(c.allowed)}`);
  else if (TYPE_LABEL[c.type]) out.push(TYPE_LABEL[c.type]);
  if (c.unit) out.push(`unit ${c.unit}`);
  const lo = Number.isFinite(c.min), hi = Number.isFinite(c.max);
  if (lo && hi) out.push(`from ${c.min} to ${c.max}`); else if (lo) out.push(`at least ${c.min}`); else if (hi) out.push(`at most ${c.max}`);
  if (c.required) out.push('required');
  return out.join(', ');
}

/** The guide of a column: { label, guide, accepts, example }, or null when the field has nothing to say beyond its name. */
export function fieldGuide(c) {
  if (!c) return null;
  const guide = String(c.guide || c.guidance || [c.definition, c.instructions].filter(Boolean).join(' ') || '').trim();
  const example = String(c.example || c.examples || '').trim();
  if (!guide && !example) return null;
  return { label: String(c.label || ''), guide, accepts: acceptedOf(c), example };
}

/** The popover's body: the definition, then what is accepted and an example as a term list. */
export function guideHtml(g) {
  const row = (term, v) => (v ? `<dt>${term}</dt><dd>${esc(v)}</dd>` : '');
  return `<div class="ui-pop-title">${esc(g.label)}</div>${g.guide ? `<p class="ui-pop-text">${esc(g.guide)}</p>` : ''}
    <dl class="ui-pop-terms">${row('Accepts', g.accepts)}${row('Example', g.example)}</dl>`;
}
