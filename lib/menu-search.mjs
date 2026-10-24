// A search field at the top of a long menu (Gumloop's model menu; owner via the Mobbin review, 2026-10-23), added to a menu lib/menu.mjs
// showMenu has drawn: typing keeps the rows marked `searchable` whose label or meta holds every word and hides the rest (headings,
// separators and other rows); the arrow keys skip what is hidden (menu.mjs), Down from the field enters the list, Enter on one match
// chooses it. Loaded with the menu that asks for it.
import { esc } from './html.mjs';
import { closeMenu } from './menu.mjs';
import { icon } from './icons.mjs';

export function addSearch(m, placeholder = 'Search') {
  if (!m) return null;
  const items = m.menuItems || [];
  m.insertAdjacentHTML('afterbegin', `<div class="menu-search"><label class="search-field">${icon('search', { size: 16 })}<input type="search" aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false"></label></div>`);
  m.insertAdjacentHTML('beforeend', '<p class="menu-empty meta" hidden>No matches</p>');
  const field = m.querySelector('.menu-search input'), rows = () => [...m.querySelectorAll('button[data-i]:not(:disabled)')].filter(b => !b.hidden);
  field.addEventListener('input', () => {
    const words = field.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    m.querySelectorAll('[data-i], .menu-heading, .menu-sep').forEach(el => {
      const it = el.dataset.i != null ? items[+el.dataset.i] : null;
      const keep = !words.length || (!!it?.searchable && words.every(w => `${it.label} ${it.meta || ''}`.toLowerCase().includes(w)));
      el.hidden = !keep; if (keep && it) shown++;
    });
    m.querySelector('.menu-empty').hidden = shown > 0;
  });
  field.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); rows()[0]?.focus({ preventScroll: true }); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows(); if (r.length === 1) r[0].click(); else r[0]?.focus({ preventScroll: true }); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu({ restoreFocus: true }); }
  });
  field.focus({ preventScroll: true });
  return field;
}
