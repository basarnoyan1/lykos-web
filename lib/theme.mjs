// Themes are CSS override blocks keyed on [data-theme]; this module only picks
// which one is active. The choice lives in localStorage rather than the project
// so it is applied synchronously at boot, before any paint.
const KEY = 'lykos.theme';

export const THEMES = [
  { id: 'paper', label: 'Paper', mode: 'light' },
  { id: 'graphite', label: 'Graphite', mode: 'dark' },
  { id: 'lagoon', label: 'Lagoon', mode: 'dark' },
  { id: 'iris', label: 'Iris', mode: 'dark' },
  { id: 'apricot', label: 'Apricot', mode: 'light' },
  { id: 'sage', label: 'Sage', mode: 'light' },
  { id: 'rose', label: 'Rose', mode: 'light' },
  { id: 'midnight', label: 'Midnight', mode: 'dark' },
  { id: 'ember', label: 'Ember', mode: 'dark' },
  { id: 'lavender', label: 'Lavender', mode: 'light' },
  { id: 'ocean', label: 'Ocean', mode: 'light' },
  { id: 'forest', label: 'Forest', mode: 'dark' },
  { id: 'plum', label: 'Plum', mode: 'dark' },
  { id: 'contrast', label: 'High contrast', mode: 'dark' },
];
const LEGACY = { 'lykos-light': 'paper', 'claude-light': 'paper', 'vscode-light': 'paper',
  'lykos-dark': 'graphite', 'claude-dark': 'graphite', 'vscode-dark': 'graphite', nord: 'graphite' };
const PAIR = { light: 'paper', dark: 'graphite' };
export const normalizePreference = value => LEGACY[value] || (['system', ...THEMES.map(t => t.id)].includes(value) ? value : 'system');
const dark = () => matchMedia('(prefers-color-scheme: dark)');

// 'system' follows the OS; anything else is a theme id.
export function preference() {
  const v = localStorage.getItem(KEY);
  return normalizePreference(v);
}

export function resolved() {
  const p = preference();
  return p === 'system' ? PAIR[dark().matches ? 'dark' : 'light'] : p;
}

export function apply() {
  const id = resolved();
  if (document.documentElement.dataset.theme !== id)
    document.documentElement.dataset.theme = id;
}

export function set(pref) {
  localStorage.setItem(KEY, normalizePreference(pref));
  apply();
}

// Re-resolve when the OS flips, but only while the preference is 'system'.
export function watch() {
  dark().addEventListener('change', () => { if (preference() === 'system') apply(); });
}
