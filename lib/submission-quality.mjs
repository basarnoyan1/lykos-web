// The quality of each submission file as Submission › Files grades it (plan §2, "Submission files, structured: quality"), in one place for the
// page (views/submission-files.mjs), the command line (tools/lykos-quality.mjs) and the MCP server (tools/mcp/run.mjs, files action
// "quality"), so the three say the same score and the same failing checks:
//   itemFacts       what each table's and figure's sources hold, read from the project and its folder: a table's grid, a drawing's SVG, a
//                   picture's pixels, its print read back (lib/printed-data.mjs), the studies its rows and marks name
//   assessQuality   the checks of lib/file-quality.mjs over those facts, the manuscript and the project: each file's dimensions and the paper's
//   qualityLines    the plain lines a reader outside the window gets: each file's score, its dimensions and every check not met
// `folder` is the project folder (read, stat, list): the browser's handle, the desktop's path, or Node's (tools/lykos-history.mjs nodeFolder).
import { labels } from './package-state.mjs';
import { libraryIndex, textCites, reviewStudies, itemStudies, gridTexts, svgTexts, lineTexts, studyKeys, unsettled, isThePaper, callouts } from './package-cites.mjs';
import { lib_journal_context$journalContext as journalContext } from "../boot.mjs";
import { otherPaper } from './manuscript-fit.mjs';
import { builtAgainstPrinted } from './build-in-app.mjs';
import { itemCurrent } from './package-state.mjs';

const asGridOf = rows => ({ rows: rows.map((r, i) => ({ ...(i === 0 ? { header: true } : {}), cells: r.map(t => ({ text: String(t ?? '') })) })) });
const appKeysOf = it => (it?.source?.app ? [it.source.app] : Array.isArray(it?.source?.apps) ? it.source.apps : []);
/** A picture's pixels from its bytes: a PNG's width and dpi, a JPEG's width (a photograph is held to the resolution rule as a PNG is). */
async function pixels(bytes) {
  const { readPngMeta } = await import('./png-meta.mjs');
  const m = readPngMeta(bytes);
  if (m?.width && !m.error) return { width: m.width, dpi: m.dpi };
  const { imageSize } = await import('./package-sources.mjs'), z = imageSize(bytes);
  return z?.w ? { width: z.w, dpi: null } : null;
}

/**
 * Each item's facts by id: `{ grid, svg, png, printed, studies, unresolved, prints }`. `hooks` stand in for a fixture's sources (the browser
 * tests): `gridFor(it)`, `printedFor(it)`. `styleDoc` the project's figure style (.lykos/figure-style.json), which the build draws in.
 */
export async function itemFacts(s, folder, { gridFor = null, printedFor = null, styleDoc = null } = {}) {
  const pkg = s.package || { parts: [], items: {} }, out = new Map();
  const [sources, app, pd] = await Promise.all([import('./package-sources.mjs'), import('./app-items.mjs'), import('./printed-data.mjs')]);
  const idx = libraryIndex(s.papers || [], { prefer: new Set(textCites(s)), studies: reviewStudies(s) });
  const asGrid = d => (d?.rows ? asGridOf(d.rows) : null);
  for (const it of Object.values(pkg.items)) {
    let texts = null;
    const f = {}, keys = appKeysOf(it);
    if (gridFor && it.kind === 'table') { f.grid = asGrid(gridFor(it)); texts = f.grid ? gridTexts(f.grid) : null; }
    else if (keys.length) {
      // a figure of several drawings (`apps`: a forest and its sheet, a traffic light and its summary) is read as the drawings stacked
      const ds = keys.map(k => app.drawApp(s, k, { item: it, doc: styleDoc }));   // as the build prints it: in the project's figure style
      const svgs = ds.map(d => d.svg).filter(Boolean);
      if (svgs.length) { f.svg = svgs.length > 1 ? app.stackSvgs(svgs, { letters: true }) : svgs[0]; texts = svgTexts(f.svg); }
      // a risk-of-bias summary draws its studies as bars: they are the studies appraised with its instrument, kept to the item's own scope
      const rob = keys.find(k => /^rob-(summary|traffic):/.test(k));
      if (rob) { const set = app.robSets(s, { item: it }).find(x => x.tool.id === rob.split(':')[1]); if (set) texts = set.done.map(x => ({ t: x.label, label: true })); }
      else if (ds.length === 1 && ds[0].rows) { f.grid = asGridOf(ds[0].rows); texts = gridTexts(f.grid); }
    } else if (it.kind === 'table') {
      const got = (await sources.loadSources(folder, [{ ...it, marks: undefined }], { state: s })).get(it.id);
      if (got?.grid) { f.grid = got.grid; texts = gridTexts(got.grid); }
    }
    // the files it prints as: its own, else those the build draws it into (lib/printed-data.mjs printedFiles)
    if (folder && it.kind === 'figure') f.prints = await pd.printedFiles(folder, it).catch(() => []);
    // a picture file: its pixels, for the figure style's resolution (lib/file-quality.mjs, rule Y5); a held picture, or a photograph
    if (folder && it.kind === 'figure' && !f.svg) {
      const file = it.source?.held ? `.lykos/package/${it.source.held}` : (f.prints || [])[0] || it.source?.path;
      if (file && /\.(png|jpe?g)$/i.test(file)) { try { const p = await pixels(await folder.read(file)); if (p) f.png = p; } catch { /* not there */ } }
    }
    // a picture in the folder: what it prints, read back and set against the app's data (lib/printed-data.mjs); the printed file is the truth
    if (printedFor && printedFor(it)) f.printed = printedFor(it);
    else if (it.kind === 'figure' && folder && (f.prints?.length || pd.printedPath(it.source))) {
      try { f.printed = await pd.printedFacts(s, it, folder); } catch (err) { console.warn('[submission quality] printed', err?.message || err); }
    }
    // the studies it includes, from its own rows and marks: the printed file's where it names studies (the printed file is the truth), else
    // the app's drawing or the table's cells; each label matched to one record, else reported (lib/package-cites.mjs itemStudies)
    const printedStudies = f.printed?.lines?.length ? itemStudies(lineTexts(f.printed.lines), idx) : [];
    if (printedStudies.some(x => !x.token) && !keys.some(k => /^rob-/.test(k))) f.studies = printedStudies;
    else if (texts) f.studies = itemStudies(texts, idx);
    if (f.studies) { f.unresolved = unsettled(f.studies); f.keys = studyKeys(f.studies); }
    out.set(it.id, f);
  }
  return out;
}

/**
 * The scores: each row of `groups` (lib/submission-package.mjs submissionFiles) by its id, and the paper's. `facts` itemFacts; `resolution`
 * the figure style's `{ widthIn, dpi }` for a supplied picture; `sigOf(key)` signs the data now (lib/app-items.mjs appSig).
 */
export async function assessQuality(s, { facts = new Map(), groups = [], resolution = null, sigOf = null, styleDoc = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const [fq, of, gate, pc, rc, res, ck, app, fs, tw, outc, prog, sp] = await Promise.all([import('./file-quality.mjs'), import('./overview-facts.mjs'),
    import('./progress-gate.mjs'), import('./progress-checks.mjs'), import('./review-checks.mjs'), import('./results.mjs'), import('./checklist-core.mjs'),
    import('./app-items.mjs'), import('./figure-style.mjs'), import('./textwidth.mjs'), import('./outcomes.mjs'), import('./progress.mjs'), import('./synth-project.mjs')]);
  await gate.checks.ensure();
  sigOf ||= key => app.appSig(s, key);
  const standing = of.standingFacts(s, today), readiness = of.readinessFacts(s, standing);
  const blocks = s.manuscript?.blocks || [], pkg = s.package || { parts: [], items: {} }, L = labels(pkg);
  const cl = ck.checklistOf(s), st = ck.checklistStates(s);
  const checklist = cl?.items?.length ? { name: cl.name, done: cl.items.filter(([n]) => st[n]?.state === 'done').length, na: cl.items.filter(([n]) => st[n]?.state === 'na').length, total: cl.items.length } : null;
  const report = readiness.report;
  const issues = blocks.length ? pc.manuscriptFindings(s) : [];
  const included = prog.includedStudies(s).length, results = res.results(s);
  const factsText = rc.projectFacts({ results, prisma: s.prisma, included, participants: (s.participants || []).length });
  const unsupported = rc.runRules(rc.categoryById('facts'), { blocks, facts: factsText });
  let section = '', paragraphs = 0;
  for (const b of blocks) { if (/^h[1-3]$/.test(b.type)) section = String(b.text || ''); else if (b.type === 'p' && String(b.text || '').trim() && /abstract|results?|findings/i.test(section)) paragraphs++; }
  const stale = app.staleBlocks(s, blocks).map(b => b.app?.key || b.id);
  const analyses = [s.analysis, ...Object.values(s.analyses || {})].filter(Boolean);
  const certain = standing.certainty ? { rated: standing.certainty.rows.filter(r => r.rated !== false).length, of: standing.certainty.rows.length + standing.certainty.toRate.length } : null;
  const methods = fq.paperMethods({ certainty: certain, appraisal: standing.appraisal ? { complete: standing.appraisal.complete, of: standing.appraisal.of } : null, analyses, searches: s.searches || [] });
  // a manuscript that is not the review's: one line, in place of its checks (lib/manuscript-fit.mjs)
  const other = otherPaper(s), fit = other ? { ok: false, reason: other } : { ok: true };
  // all-caps words the Library's titles hold (device names such as KAPSS) are names, not abbreviations to define
  // and so are the device names the extraction table records (its device, implant, rod and screw columns: KAPSS, DTO)
  const nameCols = new Set((s.templates || []).flatMap(t => (t.columns || []).filter(c => /\b(device|implant|rod|screw|system)/i.test(c.label || '')).map(c => c.id)));
  const deviceWords = Object.entries(s.values || {}).filter(([k]) => nameCols.has(k.slice(k.indexOf(':') + 1).replace(/@.*$/, ''))).flatMap(([, v]) => String(v?.reported_value || '').match(/\b[A-Z][A-Z0-9]{2,7}\b/g) || []);
  const skip = new Set([...(s.papers || []).flatMap(p => String(p.title || '').match(/\b[A-Z][A-Z0-9]{2,7}\b/g) || []), ...deviceWords]);
  const consistent = fq.manuscriptConsistent({ issues, unsupported, paragraphs, stale, fit });
  // the text against its tables and figures (lib/submission-checks.mjs assetOrderCheck): one cited that is not there, one first cited after a later one
  const ao = fit.ok ? (await import('./submission-checks.mjs')).assetOrderCheck(blocks, []) : null, flat = t => String(t || '').replace(/\s+/g, '');
  const orderMsg = new Map((ao?.findings || []).filter(x => x.kind === 'order' && x.label).map(x => [flat(x.label), x.message]));
  const gone = (ao?.findings || []).filter(x => x.kind === 'missing');
  if (fit.ok) consistent.push(fq.fixCheck('cited-exist', 'Every cited table and figure exists', gone.length ? 'missing' : 'ok', { w: 2, detail: gone.map(x => x.message).slice(0, 3).join('; '), fix: 'Add the item, or correct the citation', go: 'manuscript' }));
  // the registration, written in the text or only recorded; the certainty of each outcome rated and stated
  const allText = blocks.map(b => String(b.text || '')).join(' '), recorded = String(s.paper?.registration || s.protocol?.registration || '').trim();
  const inText = (/\b(CRD\d{11}|osf\.io\/[\w]+|NCT\d{8}|INPLASY\d+|ISRCTN\d+)/i.exec(allText) || [])[0] || (recorded && allText.includes(recorded) ? recorded : '');
  const resultsText = blocks.filter((b, i) => { let h = ''; for (let j = i; j >= 0; j--) if (/^h[1-3]$/.test(blocks[j].type)) { h = String(blocks[j].text || ''); break; } return /results?|findings/i.test(h); }).map(b => String(b.text || '')).join(' ');
  const graded = standing.certainty ? { rated: standing.certainty.rows.filter(r => r.rated !== false).length, of: standing.certainty.rows.length + standing.certainty.toRate.length,
    stated: /\b(high|moderate|low|very low)[- ]certainty|certainty[ ](?:of[ ](?:the[ ])?evidence[ ])?(?:was|is)[ ](?:high|moderate|low|very low)/i.test(resultsText) } : null;
  const clarity = fq.manuscriptClarity(blocks, { fit, skip });
  // the tables and figures
  const tokens = fs.figureTokens(styleDoc, { medium: 'export' }), measure = (t, size) => tw.textWidth(t, size, tokens?.metrics);
  // another paper's "Table 2" is not the package's: the callout check is not assessed
  const thePaper = isThePaper(s), calls = thePaper ? callouts(pkg, blocks) : [], called = new Set(calls.map(c => c.id)), profile = journalContext(s).profile;
  // cited in order: within each kind and place, the order of first callouts follows the numbers
  const outOfOrder = new Set(), byKind = new Map();
  for (const c of calls) { const l = L.get(c.id) || '', key = l.replace(/\d+$/, ''); if (!byKind.has(key)) byKind.set(key, []); byKind.get(key).push({ id: c.id, n: Number((/\d+$/.exec(l) || [])[0]) }); }
  for (const list of byKind.values()) list.forEach((x, i) => { if (Number.isFinite(x.n) && x.n !== i + 1) outOfOrder.add(x.id); });
  let model = null; const synthModel = () => (model ||= sp.synthesisModel(s));
  const rowsAll = groups.flatMap(g => g.rows), main = rowsAll.filter(r => r.group === 'tables' || r.group === 'figures').length;
  const rows = new Map(), items = [];
  for (const r of rowsAll) {
    if (r.itemId) {
      const it = pkg.items[r.itemId], part = pkg.parts.find(p => p.items.includes(r.itemId)), last = (pkg.builds?.[part.id] || []).at(-1), f = facts.get(r.itemId) || {};
      const k = it.source?.app;
      // a pooled analysis behind a forest: Analysis's, or a synthesis's pool (lib/synth-project.mjs), in the analysis's shape for the Make grade
      const slot = /^forest:/.test(k || '') ? k.slice(7) : null, sm = /^synth:forest:([^:]+):(.+)$/.exec(k || '');
      let a = slot ? outc.analysisOf(s, slot) : null;
      if (sm) { const rec = synthModel().records.find(x => x.code === sm[2] && x.outcomeId === sm[1] && x.method.startsWith('Meta')); if (rec?.pool) a = { estimate: rec.pool.rr, lo: rec.pool.lo, hi: rec.pool.hi, i2: rec.pool.I2, k: rec.kEst ?? rec.pool.k, xi: (rec.rows || []).map(x => (x.e1 || 0) + (x.e2 || 0)), measure: 'RR' }; }
      // notes printed under all of the part's tables (an item's notes with a heading, such as "Table notes") define for every table of it
      const sharedNotes = part.items.map(i => pkg.items[i]).filter(x => x && x !== it && x.notesHeading).flatMap(x => x.notes || []).join(' ');
      // drawn from current data: each drawing of the app, and an evidence table's cells, against what the last build signed (null where it
      // signed nothing: a build made before builds signed what they read)
      const dataCurrent = itemCurrent(it, last, sigOf);
      const q = fq.itemQuality({ item: it, sharedNotes, label: L.get(r.itemId), kind: it.kind, supplementary: r.group === 'supplementary', state: r.state, reason: r.reason, cited: thePaper ? called.has(r.itemId) : null,
        order: thePaper ? !(outOfOrder.has(r.itemId) || orderMsg.has(flat(L.get(r.itemId)))) : null, orderDetail: orderMsg.get(flat(L.get(r.itemId))) || '', included, grid: f.grid, svg: f.svg, png: f.png, printed: f.printed, built: builtAgainstPrinted(it, f.printed, last && last.note === 'Built in the app from Submission › Files' ? last : null), resolution, widthIn: resolution?.widthIn || 6.89, unresolved: f.unresolved, studies: (f.studies || []).filter(x => !x.token).length, missingRefs: [it.title, it.legend, ...(it.notes || [])].flatMap(t => [...String(t || '').matchAll(/\{\{xref:([A-Za-z0-9._-]+)\}\}/g)].map(m => m[1])).filter(x => !pkg.items[x]), analysis: a, ratio: /^(RR|OR|HR)$/i.test(a?.measure || ''),
        forest: !!(slot || sm), drawnBy: appKeysOf(it), photo: it.kind === 'figure' && !appKeysOf(it).length && !f.svg && !f.printed?.lines?.length, skipWords: skip, dataCurrent, builtVersion: last?.version ?? null, limit: profile?.figureTableLimit ? { max: profile.figureTableLimit, count: main } : null, tokens, measure });
      rows.set(r.id, q); items.push({ id: r.id, label: L.get(r.itemId), q });
    } else if (r.id === 'main-text') {
      rows.set(r.id, fq.dimensions(other ? { complete: fq.unfitCheck(other) } : { complete: fq.manuscriptComplete({ report, checklist, fit, registration: { recorded, inText }, grade: graded }), consistent, methods, clarity }));
    } else rows.set(r.id, fq.documentQuality(r));
  }
  const paper = fq.paperQuality({ readiness, consistent, methods, clarity, items });
  const files = rowsAll.map(r => ({ id: r.id, itemId: r.itemId || '', label: r.label || (r.itemId ? L.get(r.itemId) : '') || r.name, name: r.name, file: r.file || '', group: r.group, state: r.state, reason: r.reason || '' }));
  return { rows, paper, files };
}

const WORD = { warn: 'To review', missing: 'Not met' };
/** The checks of a score not met, as one plain line each: "Not met: Counts agree (10 in the title, 7 studies)". */
export const openChecks = q => (q?.dims || []).flatMap(d => d.checks.filter(c => c.state === 'warn' || c.state === 'missing').map(c => ({ dim: d.id, ...c })));
export const checkLine = c => `${WORD[c.state]}: ${c.label}${c.detail ? ` (${String(c.detail).replace(/\s+/g, ' ').slice(0, 160)})` : ''}`;
/** A score's tooltip: its number and word, then each check not met, failing ones first. */
export function scoreTip(q) {
  const open = openChecks(q).sort((a, b) => (a.state === b.state ? 0 : a.state === 'missing' ? -1 : 1));
  return [`Quality ${q?.overall?.pct ?? '—'} of 100, ${q?.overall?.word || 'not assessed'}`, ...(open.length ? open.map(checkLine) : ['Every check met'])].join('\n');
}
/** The report as data: each file with its status, score, dimensions and checks not met; the paper's overall. */
export function qualityData({ rows, paper, files }) {
  const dims = q => (q?.dims || []).map(d => ({ id: d.id, label: d.label, pct: d.pct, open: d.checks.filter(c => c.state === 'warn' || c.state === 'missing').map(c => ({ label: c.label, state: c.state, detail: c.detail || '', fix: c.fix || '' })) }));
  return { paper: { pct: paper?.overall?.pct ?? null, word: paper?.overall?.word || '', dims: dims(paper) },
    files: files.map(r => { const q = rows.get(r.id); return { ...r, pct: q?.overall?.pct ?? null, word: q?.overall?.word || '', dims: dims(q) }; }) };
}
/** The report as plain lines: each file's score and status, each dimension's score, each check not met with what was found and what to do. */
export function qualityLines(data) {
  const out = [`Paper quality ${data.paper.pct ?? '—'} (${data.paper.word || 'not assessed'})`];
  const dimText = d => `${d.label || d.id} ${d.pct ?? '—'}`;
  out.push(`  ${data.paper.dims.map(dimText).join('; ')}`);
  for (const f of data.files) {
    out.push('', `${f.label || f.name}: ${f.pct ?? '—'}${f.word ? ` (${f.word})` : ''}, ${f.state}${f.reason ? ` (${f.reason})` : ''}`);
    out.push(`  ${f.dims.filter(d => d.pct != null).map(dimText).join('; ') || 'nothing assessed'}`);
    for (const d of f.dims) for (const c of d.open) out.push(`  ${WORD[c.state]}: ${c.label}${c.detail ? `: ${c.detail}` : ''}${c.fix ? `. ${c.fix}` : ''}`);
  }
  return out;
}
