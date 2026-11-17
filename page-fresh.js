// The site's file cache (sw.js) answers a page from the build it holds until a page asks it to take a newer one. The app's page asks
// (lib/offline-cache.mjs); the tool pages (cite.html, query.html) load this, so a browser that had opened the app does not keep a tool
// page's old code after every publish. The page asks for the newest worker and moves onto it with one reload, as the app's page does:
// at any time while its <main> says it holds nothing (data-empty); and while it has only just loaded (TAKE_MS, and not while a field has
// the keyboard) when <main> says the page keeps its state across a reload (data-kept: the query visualizer writes its query at pagehide
// and restores it). An open manuscript (cite.html keeps none) is never lost to a reload; later in a visit the next load takes the build.
// Before 17 Nov 2026 only an empty page asked, and the visualizer, which restores its last query, never was one: Safari kept the build
// of 8 Nov through every later publish, and the pages it took from the network drew beside that build's stylesheet.
(function () {
  var sw = navigator.serviceWorker;
  if (!sw || !sw.controller) return;
  var TAKE_MS = 8000;
  var may = function () {
    var body = document.querySelector('main');
    if (!body || body.hasAttribute('data-empty')) return true;
    var field = document.activeElement;
    return body.hasAttribute('data-kept') && performance.now() < TAKE_MS && !(field && field.matches && field.matches('input, textarea, select, [contenteditable]'));
  };
  var asked = false;
  var take = function (worker) {
    if (asked || !may()) return;
    asked = true;
    sw.addEventListener('controllerchange', function () { location.reload(); }, { once: true });
    worker.postMessage('take');
  };
  sw.getRegistration().then(function (reg) {
    if (!reg) return;
    if (reg.waiting) { take(reg.waiting); return; }
    reg.addEventListener('updatefound', function () {
      var worker = reg.installing;
      if (worker) worker.addEventListener('statechange', function () { if (worker.state === 'installed') take(worker); });
    });
    reg.update().catch(function () {});
  });
})();
