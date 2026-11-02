// The site's file cache (sw.js) answers a page from the build it holds until a page asks it to take a newer one. The app's page asks
// (lib/offline-cache.mjs); this one did not, so a browser that had opened the app kept the DOI to Mendeley page's old code after every
// publish. Here the page asks for the newest worker and moves onto it with one reload, but only while no document is open: an open
// manuscript is never lost to a reload, and the next visit takes the newer build instead.
(function () {
  var sw = navigator.serviceWorker;
  if (!sw || !sw.controller) return;
  var idle = function () { var body = document.getElementById('dc-body'); return !body || body.hasAttribute('data-empty'); };
  var take = function (worker) {
    if (!idle()) return;
    sw.addEventListener('controllerchange', function () { if (idle()) location.reload(); }, { once: true });
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
