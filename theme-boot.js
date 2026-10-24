// Runs before first paint so the window never flashes the wrong theme, and so
// the layout knows whether it owns the title bar. The CSP forbids inline
// script, so this is a file rather than a <script> body.
(function () {
  var root = document.documentElement;
  try {
    var v = localStorage.getItem('lykos.theme') || 'system';
    var legacy = { 'lykos-light': 'paper', 'claude-light': 'paper', 'vscode-light': 'paper',
      'lykos-dark': 'graphite', 'claude-dark': 'graphite', 'vscode-dark': 'graphite', nord: 'graphite' };
    v = legacy[v] || v;
    if (!['system', 'paper', 'graphite', 'lagoon', 'iris', 'apricot', 'sage', 'rose', 'midnight', 'ember', 'lavender', 'ocean', 'forest', 'plum', 'contrast'].includes(v)) v = 'system';
    if (v === 'system')
      v = matchMedia('(prefers-color-scheme: dark)').matches ? 'graphite' : 'paper';
    root.setAttribute('data-theme', v);
  } catch (e) { root.setAttribute('data-theme', 'paper'); }

  // In the packaged app the window has no title bar and the traffic lights sit
  // over the sidebar, so the sidebar reserves room for them. Served over http
  // this is an ordinary browser tab, which must not gain a phantom gap.
  //
  // Tauri serves from tauri://localhost on macOS but http://tauri.localhost on
  // Windows, so the protocol alone is not the test; __TAURI_INTERNALS__ is
  // injected before this file runs and covers both.
  try {
    var packaged = typeof window.__TAURI_INTERNALS__ !== 'undefined' ||
      /^tauri:$/.test(location.protocol) ||
      /(^|\.)tauri\.localhost$/.test(location.hostname);
    // The overlay only exists on macOS; elsewhere the window keeps its own bar.
    if (packaged && /Mac/i.test(navigator.platform || navigator.userAgent))
      root.setAttribute('data-shell', 'desktop');
  } catch (e) { /* an ordinary browser tab */ }
})();
