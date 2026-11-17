// The open project's file, asked of the shell before any module loads (desktop window only): lib/projects.mjs folderBackend.read takes
// these bytes once when the folder is the same, else reads as before. Every check stays where it was: the shell answers only for a chosen
// folder (main.rs lykosfile), and the hash of these bytes is what a save's compare_write expects on disk. A head in format 2 or 3
// (lib/project-format.mjs) names its section and chunk files: the first batches of them are asked for as soon as the head is here, and
// the shell checks each against its hash. A plain file: the CSP forbids inline script.
(function () {
  try {
    if (!(location.protocol === 'tauri:' || location.hostname === 'tauri.localhost')) return;
    // the app-wide settings and the ChatGPT sign-ins, asked of the shell now rather than once the modules have run (lib/app-settings.mjs and
    // lib/chatgpt.mjs take each answer once): the first screen waits for them, and the shell's first answers can take 100 ms or more
    try {
      var internals = globalThis.__TAURI_INTERNALS__, early = {};
      if (internals && typeof internals.invoke === 'function') ['read_app_settings', 'chatgpt_accounts'].forEach(function (cmd) { early[cmd] = internals.invoke(cmd); early[cmd].catch(function () {}); });
      globalThis.__lykosEarly = early;
    } catch (e) { /* asked again by the modules */ }
    var id = localStorage.getItem('lykos.current');
    var list = JSON.parse(localStorage.getItem('lykos.projects') || '[]');
    var p = null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) p = list[i];
    if (!p || p.kind !== 'path' || !p.path) return;
    var dir = String(p.path).replace(/\/+$/, '');
    var path = dir + '/.lykos/project.json';
    var url = function (abs) { return 'lykosfile://localhost' + encodeURI(abs).replace(/[?#]/g, encodeURIComponent); };
    var get = function (abs) { return fetch(url(abs)).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).catch(function () { return null; }); };
    var bytes = get(path);
    // the files of the sections a head names, asked of the shell as soon as the head is here (main.rs lykosfile POST, which reads,
    // gunzips and checks each): the first batches only, as lib/section-files.mjs sectionsReader asks for them (filesWanted, batchesOf,
    // BATCH, AHEAD, INFLIGHT), which takes them and asks for the rest as it parses: { files, batches, answers }, or null for a format-1 file.
    // Only a head is parsed here: a file whose text names no `$sections` is a format-1 project, left alone. (Not only near its ends: a
    // format-3 head's `$sections` is the last key, but it may be longer than 64 kB: 89 kB on the Sham review, 1 Nov 2026, whose open
    // then went without the prefetch.)
    var sections = bytes.then(function (b) {
      if (!b || b.byteLength > 16e6) return null;
      var text = new TextDecoder().decode(new Uint8Array(b));
      if (text.lastIndexOf('"$sections"') < 0) return null;
      var head = JSON.parse(text), named = head && head.$sections, files = [];
      if (!named || typeof named !== 'object') return null;
      // format 4: a log cut by record leaves the chunks before the last ones whose counts hold 200 entries, and one more
      var late = function (e) {
        var n = e.chunks.length, per = e.per;
        if (e.kind !== 'list' || !(per >= 1) || Math.floor(per) !== per) return 0;
        if (e.by === 'id') {
          var c = e.counts, tail = 0, sum = 0, i;
          if (!Array.isArray(c) || c.length !== n || c.some(function (x) { return !(x >= 1) || Math.floor(x) !== x; })) return 0;
          for (i = n - 1; i >= 0 && sum < 200; i--) { sum += c[i]; tail++; }
          return Math.max(0, n - Math.min(n, tail + 1));
        }
        return Math.max(0, n - Math.min(n, Math.ceil(200 / per) + 1));
      };
      Object.keys(named).forEach(function (k) {
        var e = named[k];
        // the records' abstracts are read after the first view (lib/projects.mjs `late`), with requests of their own
        // nor the sections read on demand (store.mjs ON_DEMAND, the same names: lib/projects.mjs leaves them on disk at the open, so the
        // reader's list is this one less them, and 73 MB of the Sham review never reach the window)
        if (k in head || !e || k === '$abstracts' || k === 'scenarioPapers' || k === 'scenarioMerged' || k === 'manuscriptText' || k === 'manuscriptCheck') return;
        if (typeof e.file === 'string') files.push([e.file, e.sha256, e.bytes]);
        // format 3: a chunked section's every chunk (lib/project-format.mjs chunkFile); of the screening log only the last ones, the
        // earlier read after the first view (lib/project-format.mjs lateLogChunks, LOG_TAIL 200: the same rule)
        else if (Array.isArray(e.chunks)) e.chunks.forEach(function (c, i) {
          if (k === 'screeningLog' && i < late(e)) return;
          var h = Array.isArray(c) && typeof c[0] === 'string' ? c[0] : '';
          files.push(['project/' + k.replace(/^\$/, '') + '.' + i + '-' + h.slice(0, 12) + '.json.gz', h, Array.isArray(c) ? c[1] : 0]);
        });
      });
      if (!files.length) return null;
      var BATCH = 4e6, AHEAD = 128e6, INFLIGHT = 6, size = function (x) { return Number(x[2]) > 0 ? Number(x[2]) : 0; };
      var batches = [], from = 0, n = 0;
      files.forEach(function (x, i) { if (i > from && n + size(x) > BATCH) { batches.push([from, i]); from = i; n = 0; } n += size(x); });
      batches.push([from, files.length]);
      var answers = [], ahead = 0;
      for (var j = 0; j < batches.length && j < INFLIGHT; j++) {
        var s = 0;
        for (var i = batches[j][0]; i < batches[j][1]; i++) s += size(files[i]);
        if (j && ahead + s > AHEAD) break;
        ahead += s;
        answers.push(fetch(url(path), { method: 'POST', body: JSON.stringify(files.slice(batches[j][0], batches[j][1]).map(function (x) { return [x[0], x[1]]; })) })
          .then(function (r) { return r.ok ? r.arrayBuffer() : null; }).catch(function () { return null; }));
      }
      return { files: files, batches: batches, answers: answers };
    }).catch(function () { return null; });
    globalThis.__lykosPrefetch = { path: path, bytes: bytes, sections: sections };
  } catch (e) { /* no storage: the normal read */ }
})();
