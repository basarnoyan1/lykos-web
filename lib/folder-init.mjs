// A project folder read into a Lykos project: the records, screening,
// criteria, included studies with their PDFs, the evidence table, the table
// groups, the PRISMA counts, the manuscript and the open items, each taken
// from the file that holds it (plan §4.15a).
//
// Pure: nothing here reads or writes a disk. The caller passes the folder's
// entries (as lib/project-folder.mjs scans them, with workbook headers) and
// readers for the files it asks for — `table`, `text`, `json`, `docx` and
// `pdf` (size and hash) — plus any earlier project states. The same module
// serves tools/lykos-init-folder.mjs in node and the app's Folder map.
//
// What already exists wins over what is inferred: a record keeps the id it
// has in the earliest source that knows it, so its values, decisions and
// PDF stay linked; a value already in the project is never replaced; a
// setting is never touched. Everything the folder could not supply is said
// in the report, not guessed.
import { folderIndex, headerRow, parseStudyPdf, parseAuthorYearPdf, matchStudyPdf, criteriaRows, parseVersion } from './folder-map.mjs';
import { mergeRecords } from './dedup-core.mjs';
import { parseRecords, familyName } from './bib.mjs';
import { templateFromWorkbook, slug } from './template-import.mjs';
import { rulesFromGuide, withSeededRules } from './cell-rules.mjs';   // cell rules from the folder guide
import { normalizeProject, PROJECT_FORMAT } from '../store.mjs';
import { splitJoinedArms, parseKey } from './arms.mjs';
import { looksLikeIpdList } from './ipd-import.mjs';
import { applyPatientList, applyReferenceFiles, applySupplement, applyIpdCounts } from './folder-init-ipd.mjs';
import { evidenceAdoption, fileEntry, withFile, addAdoption, emptyAdopted } from './drift.mjs';

// ---- small helpers -------------------------------------------------------------
const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase();
const normTitle = t => fold(t).replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '');
export const cleanDoi = d => String(d ?? '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').replace(/[.,;)\]]+$/, '');
const cleanPmid = p => String(p ?? '').trim().replace(/^pmid:\s*/i, '').replace(/\.0$/, '');
const cap = s => { const t = String(s || '').trim(); return t ? t[0].toUpperCase() + t.slice(1) : t; };
const colLetter = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const clone = v => v == null ? v : structuredClone(v);
const baseOf = p => String(p).slice(String(p).lastIndexOf('/') + 1);
const DATABASES = [['PubMed', /pubmed|medline/i], ['Web of Science', /web.?of.?science|\bwos\b/i], ['Scopus', /scopus/i],
  ['Embase', /embase/i], ['Cochrane Library', /cochrane|central/i], ['CINAHL', /cinahl/i], ['PsycINFO', /psycinfo/i]];
const databaseOf = name => DATABASES.find(([, re]) => re.test(name))?.[0] || '';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** A column index by the first pattern that matches a header cell; -1 when none does. */
function column(header, ...res) {
  const h = header.map(c => fold(c).trim());
  for (const re of res) { const i = h.findIndex(c => re.test(c)); if (i >= 0) return i; }
  return -1;
}
const cellAt = (row, i) => i >= 0 ? String(row?.[i] ?? '').trim() : '';

// ---- the screening workbook ------------------------------------------------------
/**
 * The sheets of a screening workbook, by what their headers hold: the record
 * list (record number, title, DOI), the title/abstract decisions, the
 * full-text decisions and the criteria. Any of them may be missing.
 */
export function screeningWorkbook(sheets = []) {
  const out = { library: null, decisions: null, fulltext: null, criteria: [], criteriaSheet: '' };
  let best = 0;
  for (const s of sheets) {
    const { index, cells } = headerRow(s.rows || []);
    if (index < 0) continue;
    const no = column(cells, /^#$/, /^record ?(#|no\.?|number)$/, /^(id|no\.?)$/);
    const title = column(cells, /^(paper )?title$/);
    if (no < 0 || title < 0) continue;
    const col = {
      no, title,
      author: column(cells, /^first author$/, /^authors?$/),
      year: column(cells, /^year$/),
      journal: column(cells, /^journal$/, /^source title$/),
      doi: column(cells, /^doi$/),
      pmid: column(cells, /^pmid$/),
      status: column(cells, /^current library$/, /^library status$/),
      retained: column(cells, /^retained record/),
    };
    const rows = s.rows.slice(index + 1).filter(r => /^\d+$/.test(cellAt(r, no)));
    const score = [col.author, col.year, col.journal, col.doi, col.pmid, col.status].filter(i => i >= 0).length;
    if (score > best && rows.length) { best = score; out.library = { sheet: s.name, col, rows: rows.map(r => ({
      no: Number(cellAt(r, no)), title: cellAt(r, title), author: cellAt(r, col.author), year: cellAt(r, col.year).slice(0, 4),
      journal: cellAt(r, col.journal), doi: cleanDoi(cellAt(r, col.doi)), pmid: cleanPmid(cellAt(r, col.pmid)),
      status: cellAt(r, col.status), retained: Number(cellAt(r, col.retained)) || null })) }; }
  }
  for (const s of sheets) {
    const { index, cells } = headerRow(s.rows || []);
    if (index < 0) continue;
    const no = column(cells, /^record ?(#|no\.?|number)$/, /^#$/);
    if (no < 0) continue;
    const ft = column(cells, /^full[\s-]?text decision$/);
    const rows = s.rows.slice(index + 1).filter(r => /^\d+$/.test(cellAt(r, no)));
    if (ft >= 0 && !out.fulltext) {
      const reason = column(cells, /eligibility evidence/, /^reason/, /reason/);
      const date = column(cells, /assessment date/, /^date/);
      const language = column(cells, /language/);
      out.fulltext = { sheet: s.name, rows: new Map(rows.map(r => [Number(cellAt(r, no)), {
        decision: decisionWord(cellAt(r, ft), 'ft'), raw: cellAt(r, ft), reason: cellAt(r, reason), date: cellAt(r, date), language: cellAt(r, language) }])) };
      continue;
    }
    const dec = column(cells, /^final decision$/, /^current (recommendation|decision)$/);
    if (dec >= 0 && !out.decisions) {
      const reason = column(cells, /^reason ?\/ ?evidence$/, /^reason/, /reason/);
      out.decisions = { sheet: s.name, rows: new Map(rows.map(r => [Number(cellAt(r, no)), {
        decision: decisionWord(cellAt(r, dec), 'ta'), raw: cellAt(r, dec), ...splitEvidence(cellAt(r, reason)) }])) };
    }
  }
  const crit = sheets.filter(s => /criteria/i.test(s.name) && !/previous|old|former/i.test(s.name));
  for (const s of crit) { const list = criteriaRows(s.rows || []).filter(c => /^[A-Z]+\d+$/.test(c.id)); if (list.length) { out.criteria = list; out.criteriaSheet = s.name; break; } }
  return out;
}

/** A decision cell in a screening sheet's words; at title/abstract, sending a record on to full text is an inclusion. */
export function decisionWord(text, stage = 'ta') {
  const t = fold(text).trim();
  if (!t) return null;
  if (/^(exclude|excluded|no|reject|irrelevant|ineligible|not eligible)\b/.test(t)) return 'exclude';
  if (/^(include|included|yes|eligible|accept)\b/.test(t)) return 'include';
  if (stage === 'ta' && /full[\s-]?text|advance/.test(t)) return 'include';
  if (/^(uncertain|maybe|unclear|unsure|check|pending|\?)/.test(t) || /full[\s-]?text/.test(t)) return 'uncertain';
  return null;
}

/** "Reason. Evidence: where it was read" into its two parts. */
function splitEvidence(text) {
  const t = String(text || '').trim();
  const i = t.search(/\s*Evidence:\s*/);
  return i < 0 ? { reason: t, evidence: '' } : { reason: t.slice(0, i).trim(), evidence: t.slice(i).replace(/^\s*Evidence:\s*/, '').trim() };
}

// ---- records ---------------------------------------------------------------------
const recordNoOf = p => Number(p?.screeningReview?.workbook?.['#'] ?? p?.recordNo) || null;

function indexPapers(papers = []) {
  const by = { no: new Map(), doi: new Map(), pmid: new Map(), title: new Map() };
  const add = (m, k, p) => { if (k && !m.has(k)) m.set(k, p); };
  for (const p of papers) {
    add(by.no, recordNoOf(p), p);
    add(by.doi, cleanDoi(p.doi), p);
    add(by.pmid, cleanPmid(p.pmid), p);
    add(by.title, normTitle(p.title).slice(0, 120), p);
  }
  return by;
}

const META = ['title', 'authors', 'journal', 'journalAbbr', 'year', 'doi', 'pmid', 'url', 'abstract', 'volume', 'issue', 'pages', 'language', 'languageSource'];
/** Fields a record lacks, filled from another copy of it; identity, PDF and screening fields are never copied. */
function fillFrom(p, other) {
  for (const k of META) {
    const empty = p[k] == null || p[k] === '' || (Array.isArray(p[k]) && !p[k].length);
    const has = other[k] != null && other[k] !== '' && !(Array.isArray(other[k]) && !other[k].length);
    if (empty && has) p[k] = clone(other[k]);
  }
}

/**
 * The review's records: one per row of the screening sheet's record list,
 * each matched to the earlier project states (by record number, DOI, PMID,
 * then title) and taking the id of the first state that has it. Records
 * only in an earlier state are added when `library` is 'union'.
 * Returns the papers, the id of each record number, and the ids that an
 * earlier state used for a record under another id (aliases).
 */
export function assembleRecords({ rows = [], priors = [], library = 'union', now = new Date().toISOString() } = {}) {
  // A prior's merged duplicates are candidates too, after its live records: a
  // sheet row that one project merged away still finds its record there.
  const idx = priors.map(pr => ({ ...pr, by: indexPapers([...(pr.papers || []), ...(pr.merged || []).map(m => m.dup).filter(d => d?.id)]) }));
  const claimed = new Set();   // `${prior}:${id}` of prior papers already taken by a row
  const hitsFor = new Map();   // row.no → [{ prior, paper }]
  const take = (i, row, p) => { if (!p || claimed.has(`${i}:${p.id}`)) return false; claimed.add(`${i}:${p.id}`); (hitsFor.get(row.no) || hitsFor.set(row.no, []).get(row.no)).push({ prior: i, paper: p }); return true; };
  // Strong keys first, for every row; titles only for what is still unmatched,
  // so two rows with one title (a letter with and without its DOI) do not both take one record.
  for (const row of rows) idx.forEach((pr, i) => {
    take(i, row, pr.by.no.get(row.no) && (!row.doi || !cleanDoi(pr.by.no.get(row.no).doi) || cleanDoi(pr.by.no.get(row.no).doi) === row.doi) ? pr.by.no.get(row.no) : null)
      || take(i, row, row.doi && pr.by.doi.get(row.doi)) || take(i, row, row.pmid && pr.by.pmid.get(row.pmid));
  });
  for (const row of rows) idx.forEach((pr, i) => {
    if ((hitsFor.get(row.no) || []).some(h => h.prior === i)) return;
    const p = pr.by.title.get(normTitle(row.title).slice(0, 120));
    if (p && (!row.year || !p.year || String(p.year).slice(0, 4) === row.year)) take(i, row, p);
  });

  const papers = [], byNo = new Map(), aliases = new Map(), made = [];
  const taken = new Set();
  for (const row of rows) {
    const hits = hitsFor.get(row.no) || [];
    let p;
    if (hits.length) {
      p = clone(hits[0].paper);
      for (const h of hits.slice(1)) { fillFrom(p, h.paper); if (h.paper.id !== p.id) aliases.set(h.paper.id, p.id); }
    } else {
      const id = row.doi ? `doi-${row.doi}` : row.pmid ? `pmid-${row.pmid}` : `sheet-${row.no}`;
      const author = row.author ? [row.author] : [];
      p = { id, key: id, title: row.title, authors: author, journal: row.journal, year: row.year, doi: row.doi, pmid: row.pmid, source: 'sheet', pdf: null,
        label: `${author[0] ? familyName(author[0]) || author[0] : row.title.split(/\s+/)[0]} ${row.year}`.trim() };
      made.push(row.no);
    }
    if (!p.doi && row.doi) p.doi = row.doi;
    if (!p.pmid && row.pmid) p.pmid = row.pmid;
    if (taken.has(p.id)) { p = { ...p, id: `${p.id}~${row.no}`, key: `${p.key || p.id}~${row.no}` }; }
    taken.add(p.id);
    p.recordNo = row.no;
    papers.push(p); byNo.set(row.no, p.id);
  }
  const left = [];
  if (library === 'union') {
    const have = indexPapers(papers);
    idx.forEach((pr, i) => { for (const p of pr.papers || []) {
      if (claimed.has(`${i}:${p.id}`) || taken.has(p.id) || aliases.has(p.id)) continue;
      const same = (cleanDoi(p.doi) && have.doi.get(cleanDoi(p.doi))) || (normTitle(p.title) && have.title.get(normTitle(p.title).slice(0, 120)));
      if (same) { if (same.id !== p.id) aliases.set(p.id, same.id); fillFrom(same, p); continue; }
      const q = clone(p); papers.push(q); taken.add(q.id);
      have.doi.set(cleanDoi(q.doi), q); have.title.set(normTitle(q.title).slice(0, 120), q);
    } });
  } else {
    const have = indexPapers(papers);
    idx.forEach((pr, i) => { for (const p of pr.papers || []) {
      if (claimed.has(`${i}:${p.id}`) || taken.has(p.id)) continue;
      const same = (cleanDoi(p.doi) && have.doi.get(cleanDoi(p.doi))) || have.title.get(normTitle(p.title).slice(0, 120));
      if (same && same.id !== p.id) aliases.set(p.id, same.id);
      left.push({ from: pr.label, id: p.id, label: p.label || p.title, duplicateOf: same?.id || null });
    } });
  }
  return { papers, byNo, aliases, made, left, at: now };
}

/**
 * Duplicates removed before screening: rows the sheet marks as merged into a
 * retained record, merges an earlier project already made, and pairs given
 * by number. Uses the library's own merge, so each can be undone in the app.
 */
export function applyMerges(state, { rows = [], byNo, priorMerged = [], pairs = {}, aliasOf = id => id, at }) {
  const out = { sheet: 0, carried: 0, pairs: 0, failed: [] };
  const has = id => state.papers.some(p => p.id === id);
  const merge = (keepId, dupId, why) => {
    if (!keepId || !dupId || keepId === dupId || !has(keepId) || !has(dupId)) return false;
    try {
      const keep = state.papers.find(p => p.id === keepId);
      const earlier = keep.mergedFrom; if (earlier?.length) delete keep.mergedFrom;   // a record can absorb more than one duplicate
      mergeRecords(state, keepId, dupId);
      if (earlier?.length) keep.mergedFrom = [...earlier, ...(keep.mergedFrom || [])];
      state.merged.at(-1).at = at; state.merged.at(-1).why = why;
      return true;
    } catch (err) { out.failed.push(`${dupId}: ${err.message}`); return false; }
  };
  for (const row of rows) if (/merged|duplicate/i.test(row.status) && row.retained && merge(byNo.get(row.retained), byNo.get(row.no), 'Marked as a merged duplicate in the screening sheet')) out.sheet++;
  for (const [dup, keep] of Object.entries(pairs)) if (merge(byNo.get(Number(keep)), byNo.get(Number(dup)), 'Duplicate record removed before screening (PRISMA count)')) out.pairs++;
  // Merges an earlier project made of records the sheet never listed stay merged.
  for (const m of priorMerged) {
    const keepId = aliasOf(m.keepId);
    if (!has(keepId) || state.merged.some(x => x.dup?.id === m.dup?.id) || has(m.dup?.id)) continue;
    state.merged.push(clone(m)); out.carried++;
    const keep = state.papers.find(p => p.id === keepId);
    if (!(keep.mergedFrom || []).some(x => x.id === m.dup.id)) keep.mergedFrom = [...(keep.mergedFrom || []), { id: m.dup.id, at: m.at, copied: {} }];
  }
  return out;
}

// ---- screening -------------------------------------------------------------------
/**
 * Title/abstract and full-text decisions for each record number. The
 * sheet's own columns decide; `outcomes` — the per-record result behind a
 * PRISMA figure, when the folder has one — takes precedence, so the review
 * counts what the published flow diagram counts: a record assessed at
 * report level (a citation-searching record, or a language exclusion the
 * figure moves to full text) is advanced at title/abstract and decided at
 * full text with the figure's reason.
 */
export function screeningDecisions(wb, { outcomes = null } = {}) {
  const out = new Map();
  const nos = new Set([...(wb.library?.rows || []).map(r => r.no), ...(wb.decisions?.rows.keys() || []), ...(wb.fulltext?.rows.keys() || [])]);
  for (const no of nos) {
    const d = wb.decisions?.rows.get(no), f = wb.fulltext?.rows.get(no), o = outcomes?.records?.[no];
    const r = { no, ta: null, ft: null, arm: o?.arm || '', companion: o?.companion || null };
    // A record on the full-text sheet was advanced at title/abstract, whatever
    // final recommendation the decisions sheet now shows for it.
    if (f) r.ta = { decision: 'include', reason: '', evidence: '', ...(d?.decision && d.decision !== 'include' ? { final: { decision: d.decision, reason: d.reason } } : {}) };
    else if (d?.decision) r.ta = { decision: d.decision, reason: d.decision === 'exclude' ? d.reason : '', evidence: d.evidence || '' };
    if (f?.decision) r.ft = { decision: f.decision, reason: f.decision === 'exclude' ? firstSentence(f.reason) : '', evidence: f.reason, date: f.date };
    else if (f) r.ft = null;
    if (o) {
      if (o.stage === 'ta') { r.ta = { decision: 'exclude', reason: r.ta?.reason || d?.reason || 'Excluded at title and abstract', evidence: r.ta?.evidence || '' }; r.ft = null; }
      else {
        const moved = !r.ta || r.ta.decision !== 'include';
        r.ta = moved ? { decision: 'include', reason: '', evidence: '', note: o.ta_language
          ? 'Language exclusion counted at report level, as in the PRISMA flow diagram'
          : o.arm === 'other' ? 'Citation-searching record assessed at report level, as in the PRISMA flow diagram' : 'Assessed at report level, as in the PRISMA flow diagram',
          sheet: d?.decision ? { decision: d.decision, reason: d.reason } : null } : r.ta;
        r.ft = { decision: o.decision, reason: o.decision === 'exclude' ? o.reason : '', evidence: f?.reason || d?.reason || '', date: f?.date || '',
          note: o.late_include ? 'Included after the screening sheet was last updated' : o.companion ? `Companion report: ${o.companion}` : '' };
      }
    }
    out.set(no, r);
  }
  return out;
}
const firstSentence = t => { const s = String(t || '').trim(); const m = /^(.+?[.;])\s/.exec(s); return (m ? m[1] : s).replace(/[.;]$/, '').slice(0, 200); };

// ---- evidence table --------------------------------------------------------------
/**
 * The studies of an evidence table: a row whose first cell is a number starts
 * a study; the rows under it with an empty first cell are its further arms
 * (two-arm studies are two rows with the shared cells merged). Returns the
 * header, the studies and the notes below the table.
 */
export function evidenceStudies(rows = []) {
  const { index, cells } = headerRow(rows);
  const studies = [], notes = [];
  if (index < 0) return { header: [], studies, notes, headerRow: -1 };
  let cur = null, inNotes = false;
  for (let i = index + 1; i < rows.length; i++) {
    const r = rows[i] || [], first = String(r[0] ?? '').trim();
    const filled = r.filter(c => String(c ?? '').trim()).length;
    if (inNotes) { if (first && filled === 1) notes.push(first); continue; }
    if (/^(table )?notes?$/i.test(first)) { inNotes = true; cur = null; continue; }
    if (/^\d+$/.test(first)) { cur = { id: first, rows: [i] }; studies.push(cur); continue; }
    if (!first && filled && cur) { cur.rows.push(i); continue; }
    if (!filled) cur = null;
  }
  return { header: cells, studies, notes, headerRow: index };
}

/** One cell of a study across its arm rows: shared when only the first arm row has it. */
export function armValue(rows, rowIdx, col) {
  const vals = rowIdx.map(i => String(rows[i]?.[col] ?? '').trim());
  const [first, ...rest] = vals;
  if (!rest.some(Boolean)) return { text: first, arms: null };
  const armed = vals.map((v, k) => !v ? '' : /^arm \d/i.test(v) ? v : `Arm ${k + 1}: ${v}`).filter(Boolean);
  return { text: armed.join('\n'), arms: vals };
}

/** A with-sources cell's "— Title:" line as written (the paper's title and link), or ''. */
export const titleLine = text => (String(text || '').split('\n').find(l => /^\s*[—–-]\s*Title\s*:/i.test(l)) || '').replace(/^\s*[—–-]\s*Title\s*:\s*/i, '').trim();

/** A with-sources cell: the value, then "— Source:", "— Title:" and other annotation lines. */
export function sourceCell(text) {
  const lines = String(text || '').split('\n');
  const value = [], sources = [];
  let title = '', doi = '', current = null;
  for (const l of lines) {
    const m = /^\s*[—–-]\s*(Source|Title|Removed from table|Previous text[^:]*|Note)\s*:\s*(.*)$/i.exec(l);
    if (m) { current = m[1].toLowerCase(); if (current === 'source') sources.push(m[2].trim()); else if (current === 'title') { title = m[2].trim(); doi = cleanDoi(/(?:doi\.org\/|doi:\s*)(10\.[^\s)]+)/i.exec(m[2])?.[1] || ''); } continue; }
    if (!current) value.push(l);
    else if (current === 'source' && l.trim()) sources[sources.length - 1] += ` ${l.trim()}`;
  }
  if (title) title = title.replace(/\s*\((https?:\/\/[^)]*|doi:[^)]*)\)\s*$/i, '').trim();
  return { value: value.join('\n').trim(), sources, title, doi };
}

// A range "A7:B8" as zero-based rows and columns.
const rangeOf = ref => { const [a, b = a] = String(ref).split(':'); const p = x => { const m = /^([A-Z]+)(\d+)$/.exec(x); let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return [Number(m[2]) - 1, c - 1]; };
  const [r1, c1] = p(a), [r2, c2] = p(b); return { r1, c1, r2, c2 }; };

/**
 * The publication table as the arm split reads it (lib/arms.mjs
 * splitJoinedArms): the rows of each study's paper, and a column's text per
 * arm row — none when the cell is merged across the rows (study-level). A
 * sheet read without its merges (a CSV) counts a cell as shared when only
 * its first row has text.
 */
export function sheetArms({ sheet, header, studies, paperOf, columnOf }) {
  const merges = Array.isArray(sheet.merges) ? sheet.merges.map(rangeOf) : null;
  const rowsBy = new Map();
  for (const st of studies) { const p = paperOf(st.id); if (p && !rowsBy.has(p)) rowsBy.set(p, st.rows); }
  return {
    rowsOf: paperId => rowsBy.get(paperId) || null,
    perArm(paperId, columnId) {
      const rows = rowsBy.get(paperId), col = columnOf(columnId);
      if (!rows || rows.length < 2 || col < 0) return null;
      const texts = rows.map(r => String(sheet.rows[r]?.[col] ?? '').trim());
      if (merges) return merges.some(m => m.c1 <= col && m.c2 >= col && m.r1 <= rows[0] && m.r2 >= rows.at(-1)) ? null : texts;
      return texts.slice(1).some(Boolean) ? texts : null;
    },
    header,
  };
}

/**
 * The arm split for a project whose evidence table values were joined per
 * study before arms existed: the template's studies with several rows get
 * their arms, and each joined value becomes one value per arm. With the
 * publication workbook, merged cells decide what is study-level; without
 * it, the rows kept on each value do. Returns the new state's templates and
 * values and what was split; `state` is not changed.
 */
export function migrateEvidenceArms(state, { templateId = null, workbook = null, sources = null, sourcesPath = '' } = {}) {
  const out = { templates: [...(state.templates || [])], reports: [] };
  let vals = { ...(state.values || {}) };
  out.templates.forEach((t, i) => {
    if (templateId && t.id !== templateId) return;
    if (t.orientation !== 'studies-rows') return;
    let sheet = null;
    const table = workbook?.sheets?.find(s => s.name === t.source?.sheet) || null;
    if (table) {
      const ev = evidenceStudies(table.rows);
      const idCol = t.columns.find(c => /^id$/i.test(c.label));
      const paperByNo = new Map();
      for (const [k, v] of Object.entries(vals)) { const { paperId, columnId, arm } = parseKey(k); if (!arm && idCol && columnId === idCol.id) paperByNo.set(String(v.reported_value ?? '').trim(), paperId); }
      const labelCol = new Map(t.columns.map(c => [c.id, ev.header.findIndex(h => String(h).trim() === c.label)]));
      sheet = sheetArms({ sheet: table, header: ev.header, studies: ev.studies, paperOf: no => paperByNo.get(String(no)) || null, columnOf: id => labelCol.get(id) ?? -1 });
    }
    const r = splitJoinedArms({ template: t, values: vals, sheet });
    if (table && !r.template.sheetWidths) {
      const widths = Object.fromEntries(t.columns.map(c => [c.id, table.widths?.[sheet.header.findIndex(h => String(h).trim() === c.label)]]).filter(([, w]) => w));
      if (Object.keys(widths).length) r.template.sheetWidths = widths;
    }
    out.templates[i] = r.template; vals = r.values;
    // The with-sources twin's "— Title:" lines, kept on each study cell that lacks one.
    const src = sources?.sheets?.find(x => /with sources/i.test(x.name));
    let titles = 0;
    const studyCol = t.columns.find(c => /^study$/i.test(c.label)), idCol = t.columns.find(c => /^id$/i.test(c.label));
    if (src && studyCol && idCol) {
      const sev = evidenceStudies(src.rows);
      const scol = sev.header.findIndex(h => String(h).trim() === studyCol.label);
      const byNo = new Map(sev.studies.map(st => [st.id, st.rows[0]]));
      for (const [k, v] of Object.entries(vals)) {
        const { paperId, columnId, arm } = parseKey(k);
        if (arm || columnId !== studyCol.id || (v.evidence || []).some(e => e.title)) continue;
        const row = byNo.get(String(vals[`${paperId}:${idCol.id}`]?.reported_value ?? '').trim());
        const tl = row != null && scol >= 0 ? titleLine(src.rows[row]?.[scol]) : '';
        if (!tl) continue;
        vals[k] = { ...v, evidence: [...(v.evidence || []), { kind: 'file', path: sourcesPath, locator: { sheet: src.name, cell: `${colLetter(scol)}${row + 1}` }, quote: tl, title: true }] };
        titles++;
      }
    }
    out.reports.push({ template: t.id, ...r.report, titles });
  });
  return { ...out, values: vals };
}

/**
 * The extraction template and accepted values for an evidence table. `paperOf`
 * maps a table ID to a record id. Every cell becomes an accepted, imported
 * value that cites its cell; the with-sources workbook, when there is one,
 * adds the verbatim quotes as evidence and the column definitions as the
 * template's guidance.
 */
export function evidenceImport({ path, workbook, sheet, sourcesPath = '', sources = null, paperOf, groups = null, groupsPath = '', version = 0, at, existingValues = {}, file = {} }) {
  const table = workbook.sheets.find(s => s.name === sheet) || workbook.sheets[0];
  const defs = [...(sources?.sheets || []), ...workbook.sheets].find(s => /column definitions?|codebook|definitions/i.test(s.name));
  const tid = `t_${slug(parseVersion(baseOf(path)).stem).slice(0, 40)}`;
  const name = `Evidence table${version ? ` v${version}` : ''}`;
  const { template } = templateFromWorkbook({ sheets: [table, ...(defs ? [defs] : [])] }, { id: tid, name, file: baseOf(path) });
  const ev = evidenceStudies(table.rows);
  // A definition belongs to the column of the same name before any column whose name it shares words with ("Study design", not "Study").
  const bare = t => fold(t).replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  for (const r of (defs?.rows || []).slice(1)) {
    const c = template.columns.find(x => bare(x.label) === bare(r[0])) || template.columns.find(x => bare(x.label).startsWith(`${bare(r[0])} `));
    if (c && String(r[1] || '').trim()) c.guidance = String(r[1]).trim();
  }
  for (const c of template.columns) if (c.guidance && !(defs?.rows || []).some(r => String(r[1] || '').trim() === c.guidance && (bare(c.label) === bare(r[0]) || bare(c.label).startsWith(`${bare(r[0])} `)))) c.guidance = '';
  template.source = { file: path, sheet: table.name, importedAt: at };
  template.conventions = [...(template.conventions || []), ...ev.notes];
  // Columns the table groups add: the main table, and the shares shown in some tables.
  const extra = [];
  if (groups?.table) extra.push({ id: `${tid}.main_table`, label: 'Main table', type: 'integer', guidance: 'Table 1–4 by the intervention arm (tools table groups)', examples: '', why: '' });
  for (const [k, v] of Object.entries(groups || {})) if (k !== 'table' && !k.startsWith('_') && v && typeof v === 'object')
    extra.push({ id: `${tid}.${slug(k)}`, label: cap(`${k.replace(/_/g, ' ')}${!/share/i.test(k) && new RegExp(`${k}\\s+share`, 'i').test(String(groups._comment || '')) ? ' share' : ''}`),
      type: 'text', guidance: `From ${groupsPath ? baseOf(groupsPath) : 'the table groups file'} ("${k}")`, examples: '', why: '', groupKey: k });
  template.columns.push(...extra);
  const src = sources?.sheets.find(s => /with sources/i.test(s.name));
  const srcStudies = src ? new Map(evidenceStudies(src.rows).studies.map(s => [s.id, s])) : new Map();
  const colOf = new Map(template.columns.map((c, i) => [c.id, ev.header.findIndex(h => String(h).trim() === c.label)]));
  const values = {}, report = { studies: 0, cells: 0, quotes: 0, unmatched: [], kept: 0, titles: new Map() };
  // A cell already in the project, as one value or as its arms, is kept.
  const paperOfStudy = new Map();
  const held = new Set(Object.keys(existingValues).map(k => { const x = parseKey(k); return `${x.paperId}:${x.columnId}`; }));
  for (const st of ev.studies) {
    const paperId = paperOf(st.id, srcStudies.get(st.id) ? sourceCell(src.rows[srcStudies.get(st.id).rows[0]][1]) : null);
    if (!paperId) { report.unmatched.push(st.id); continue; }
    paperOfStudy.set(st.id, paperId);
    report.studies++;
    const srcSt = srcStudies.get(st.id);
    if (srcSt) { const t = sourceCell(src.rows[srcSt.rows[0]][1]); report.titles.set(st.id, t); }
    for (const c of template.columns) {
      let text = '', arms = null, cellRef = '', quotes = [];
      const col = colOf.get(c.id);
      if (col >= 0) {
        ({ text, arms } = armValue(table.rows, st.rows, col));
        cellRef = st.rows.map(i => `${colLetter(col)}${i + 1}`).join(':');
        if (srcSt) {
          const scol = src.rows[ev.headerRow]?.findIndex(h => String(h).trim() === c.label) ?? -1;
          if (scol >= 0) quotes = srcSt.rows.flatMap((i, k) => sourceCell(src.rows[i]?.[scol]).sources.map(q => ({ q, cell: `${colLetter(scol)}${i + 1}`, arm: srcSt.rows.length > 1 ? k + 1 : null })));
          // The study cell's "— Title:" line is kept as written, for the with-sources table written back.
          const tl = scol >= 0 && /^study$/i.test(c.label) ? titleLine(src.rows[srcSt.rows[0]]?.[scol]) : '';
          if (tl) quotes.unshift({ q: tl, cell: `${colLetter(scol)}${srcSt.rows[0] + 1}`, arm: null, title: true });
        }
      } else if (c.id.endsWith('.main_table')) text = groups.table[String(Number(st.id))] != null ? String(groups.table[String(Number(st.id))]) : '';
      else if (c.groupKey) text = String(groups[c.groupKey]?.[String(Number(st.id))] ?? '');
      if (!text) continue;
      const key = `${paperId}:${c.id}`;
      if (held.has(key)) { report.kept++; continue; }
      const where = col >= 0 ? `sheet ${table.name}, row${st.rows.length > 1 ? 's' : ''} ${st.rows.map(i => i + 1).join('–')}` : baseOf(groupsPath || 'table groups');
      const evidence = col >= 0 ? [{ kind: 'file', path, locator: { sheet: table.name, cell: cellRef.split(':')[0] }, quote: text }]
        : groupsPath ? [{ kind: 'file', path: groupsPath, locator: {}, quote: text }] : [];
      for (const q of quotes) evidence.push({ kind: 'file', path: sourcesPath, locator: { sheet: src.name, cell: q.cell }, quote: q.q, ...(q.arm ? { arm: q.arm } : {}), ...(q.title ? { title: true } : {}) });
      report.quotes += quotes.filter(q => !q.title).length;
      const num = c.type === 'integer' && /^\d+$/.test(text) ? Number(text) : text;
      values[key] = { paper_id: paperId, study_id: paperId, field_id: c.id, reported_value: text, normalized_value: num,
        origin: 'imported', availability: /^NR$/i.test(text) ? 'not_found' : 'present', verification: 'accepted',
        evidence, rationale: '', proposed_by: null, extractor: 'import:xlsx',
        source: `${name}, ${where}`, ...(arms ? { arms } : {}),
        source_locator: null, verified_at: at, at };
      report.cells++;
    }
  }
  // Two-arm studies: an arm's cell becomes that arm's value; a merged cell stays the study's.
  const sheetModel = sheetArms({ sheet: table, header: ev.header, studies: ev.studies, paperOf: no => paperOfStudy.get(no) || null, columnOf: id => colOf.get(id) ?? -1 });
  // The sheet's own column widths, so a table written back keeps them.
  const widths = Object.fromEntries(template.columns.map(c => [c.id, table.widths?.[colOf.get(c.id)]]).filter(([, w]) => w));
  if (Object.keys(widths).length) template.sheetWidths = widths;
  const split = splitJoinedArms({ template, values, sheet: sheetModel });
  report.cells += split.report.cells - split.report.split;
  report.arms = split.report;
  // What the table said for each cell taken from it, to compare with the file later (plan §4.15d); `file` is the file's hash, size and time when the caller has them.
  const studyNo = new Map([...paperOfStudy].map(([no, id]) => [id, no]));
  const columnLabel = new Map(split.template.columns.map(c => [c.id, c.label]));
  const adoption = evidenceAdoption({ path, workbook: { sheets: [table] }, values: split.values, file, at, role: 'evidence', labelOf: key => {
    const x = parseKey(key);
    return `Study ${studyNo.get(x.paperId) ?? '?'} · ${columnLabel.get(x.columnId) || x.columnId}${x.arm ? ` (${x.arm.replace(/^arm/, 'arm ')})` : ''}`;
  } });
  return { template: split.template, values: split.values, report, studies: ev.studies, notes: ev.notes, header: ev.header, sheet: sheetModel, adoption };
}

// ---- table groups, PRISMA, guide, searches ------------------------------------------
/** Collections from a table-groups file: one per table number, and one per extra group the comment names as a table. */
export function collectionsFromGroups(groups, paperOf) {
  if (!groups?.table) return [];
  const byTable = new Map();
  for (const [id, t] of Object.entries(groups.table)) { const p = paperOf(id); if (p) (byTable.get(Number(t)) || byTable.set(Number(t), []).get(Number(t))).push(p); }
  const list = [...byTable].sort((a, b) => a[0] - b[0]).map(([t, members]) => ({ id: `c-table-${t}`, name: `Table ${t}`, parent: null, members }));
  const comment = String(groups._comment || '');
  for (const [k, v] of Object.entries(groups)) {
    if (k === 'table' || k.startsWith('_') || !v || typeof v !== 'object') continue;
    const m = new RegExp(`\\b${k}\\s*:\\s*Table\\s+(\\d+)`, 'i').exec(comment);
    if (!m) continue;
    list.push({ id: `c-table-${m[1]}`, name: `Table ${m[1]}`, parent: null, members: Object.keys(v).map(paperOf).filter(Boolean) });
  }
  return list;
}

/** PRISMA 2020 counts as the app keeps them, from a counts file (databases and other methods). */
export function prismaFromCounts(c) {
  if (!c || typeof c !== 'object' || c.database_results == null) return null;
  const reasons = o => Object.entries(o || {}).map(([k, v]) => `${String(k).replace(/;/g, ',')}, ${v}`).join('; ');
  const D = c.databases || {}, O = c.other || null;
  const prisma = {
    database_results: c.database_results,
    ...(c.per_database ? { database_specific_results: Object.entries(c.per_database).map(([k, v]) => `${k}, ${v}`).join('; ') } : {}),
    ...(c.duplicates != null ? { duplicates: c.duplicates } : {}),
    records_screened: D.screened, records_excluded: D.records_excluded,
    dbr_sought_reports: D.sought, dbr_notretrieved_reports: D.not_retrieved, dbr_assessed: D.assessed, dbr_excluded: reasons(D.excluded),
    new_studies: c.new_studies,
  };
  if (O && c.other_results != null) {
    const label = String(c.other_label || '').toLowerCase();
    prisma[/website/.test(label) ? 'website_results' : /organi[sz]ation/.test(label) ? 'organisation_results' : 'citations_results'] = c.other_results;
    Object.assign(prisma, { other_sought_reports: O.sought, other_notretrieved_reports: O.not_retrieved, other_assessed: O.assessed, other_excluded: reasons(O.excluded) });
  }
  for (const k of Object.keys(prisma)) if (prisma[k] == null || prisma[k] === '') delete prisma[k];
  return { prisma, arms: { other: Boolean(O && c.other_results) } };
}

/** The open items of a folder guide (AGENTS.md): each bullet of the "Open items" section as a short to-do. */
export function todosFromGuide(md) {
  const lines = String(md || '').split('\n');
  const start = lines.findIndex(l => /^#{2,3}\s*(\d+\.\s*)?open (items|questions|issues)/i.test(l));
  if (start < 0) return [];
  const out = [];
  let parent = null;
  const tidy = s => cap(String(s).replace(/\*\*/g, '').replace(/`/g, '').replace(/\s*\([^()]*(\([^()]*\)[^()]*)*\)/g, '').replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim());
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,3}\s/.test(l)) break;
    const m = /^(\s*)[-*]\s+(.*)$/.exec(l);
    if (!m) continue;
    const text = m[2].trim(), sub = m[1].length > 0;
    if (!sub) {
      const bare = tidy(text);
      parent = bare.endsWith(':') ? bare.slice(0, -1) : null;
      if (!parent) out.push(labelled(tidy(text)));
    } else if (parent) out.push(`${parent}: ${tidy(text).replace(/[;.]$/, '')}`);
    else out.push(labelled(tidy(text)));
  }
  return out.map(t => t.length > 180 ? `${t.slice(0, 177).replace(/\s+\S*$/, '')}…` : t);
}
const labelled = t => t.replace(/^([^:]{2,40}):\s*(\S)/, (m, a, b) => `${a}: ${b.toUpperCase()}`);

/** A sheet's date cell as an ISO day: "2026-09-20", or an Excel serial number. */
export function dayOf(v) {
  const t = String(v ?? '').trim();
  if (/^\d{4}-\d\d-\d\d/.test(t)) return t.slice(0, 10);
  if (/^\d{5}(\.\d+)?$/.test(t) && Number(t) > 30000 && Number(t) < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(Number(t) * 86400000)).toISOString().slice(0, 10);
  return '';
}

/** A date written out in a log ("19 September 2026"), as an ISO day, or ''. */
export function dateIn(text) {
  const m = new RegExp(`(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+(\\d{4})`, 'i').exec(String(text || ''));
  if (m) return `${m[3]}-${String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const iso = /\b(20\d\d-\d\d-\d\d)\b/.exec(String(text || ''));
  return iso ? iso[1] : '';
}

// ---- the whole folder ----------------------------------------------------------------
const byRoleName = (files, role, re) => files.filter(f => (!role || f.role === role) && (!re || re.test(f.path)));

/**
 * Builds the project for a folder. `entries` are the scanned files (with
 * `sheets` headers for workbooks); `read` holds the readers; `current` is
 * the project the folder already has; `priors` are earlier states of the
 * same review ({ label, state }), highest priority first. Options:
 * `name`, `researchType`, `library` ('union' or 'screened': only the
 * screening sheet's records), `outcomes` (per-record PRISMA result),
 * `by` (reviewer initials for imported decisions), `now`.
 */
export async function initFolder({ entries = [], read, current = null, priors = [], options = {} }) {
  const now = options.now || new Date().toISOString();
  // A master list of patients with the review's own decisions makes it a systematic review with patient data, not a pooled effect analysis.
  const hasPatientList = entries.some(e => (e.sheets || []).some(sh => looksLikeIpdList(sh.header || [])));
  const typeId = options.researchType || current?.project?.researchType || (hasPatientList ? 'systematic-review' : 'meta-analysis');
  const index = folderIndex(entries, { typeId });
  const files = index.files.filter(f => !f.archived);
  const report = { files: [], used: {}, counts: {}, warnings: [], notes: [], left: [] };
  const use = (what, path) => { if (path) { report.used[what] = path; } return path; };
  const base = normalizeProject(clone(current) || {});
  const priorStates = priors.map(p => ({ label: p.label, state: normalizeProject(clone(p.state)) }));
  const cur = { label: 'current folder project', state: base };
  const sources = [...priorStates, cur];

  // Files the init reads.
  const evidencePath = use('evidence', index.current.evidence);
  const sourcesPath = use('evidence sources', evidencePath ? byRoleName(files, 'evidence-table', /with[\s_-]?sources/i).find(f => f.path.startsWith(evidencePath.slice(0, evidencePath.lastIndexOf('/') + 1)) && parseVersion(f.name).version === parseVersion(baseOf(evidencePath)).version)?.path || '' : '');
  const screeningPath = use('screening', index.current.screening);
  const criteriaPath = use('criteria', index.current.criteria);
  const manuscriptPath = use('manuscript', index.current.manuscript);
  const guidePath = use('guide', files.find(f => f.role === 'guide' && !f.path.includes('/'))?.path || '');
  const groupsPath = use('table groups', files.find(f => f.role === 'table-groups')?.path || files.find(f => /table[_\s-]?groups\.json$/i.test(f.path))?.path || '');
  const countsPath = use('PRISMA counts', files.find(f => f.role === 'prisma-counts')?.path || files.find(f => /prisma[_\s-]?counts\.json$/i.test(f.path))?.path || '');

  // A patient-level review: the master list, the supplement's tables, the reference lists and a filled PRISMA-IPD diagram.
  const patientFile = files.find(f => f.path === index.current.patients && f.role === 'ipd-list');
  const patientsPath = use('patient list', patientFile?.path || '');
  const supplementPath = use('supplement', index.current.supplement || '');
  const flowPath = use('PRISMA-IPD diagram', index.current.flow || '');
  const refFiles = files.filter(f => f.role === 'reference-export' && !f.older);
  const [patientWb, supplement, flowText, refTexts] = await Promise.all([
    patientsPath ? read.table(patientsPath) : null,
    supplementPath && read.docx ? read.docx(supplementPath).catch(err => { report.warnings.push(`${supplementPath}: ${err.message}`); return null; }) : null,
    flowPath && read.docxText ? read.docxText(flowPath).catch(() => '') : '',
    Promise.all(refFiles.map(async f => ({ path: f.path, text: await read.text(f.path).catch(() => '') }))),
  ]);
  const [screenWb, evidenceWb, sourcesWb, groups, counts, guide, manuscript] = await Promise.all([
    screeningPath ? read.table(screeningPath) : null, evidencePath ? read.table(evidencePath) : null, sourcesPath ? read.table(sourcesPath) : null,
    groupsPath ? read.json(groupsPath).catch(() => null) : null, countsPath ? read.json(countsPath).catch(() => null) : null,
    guidePath ? read.text(guidePath).catch(() => '') : '', manuscriptPath && read.docx ? read.docx(manuscriptPath).catch(err => ({ error: err.message })) : null,
  ]);

  // ---- records
  const wb = screeningWorkbook(screenWb?.sheets || []);
  if (!wb.library && !patientWb) report.warnings.push('No record list found in the screening workbook; the earlier project states supply the records');
  const rows = wb.library?.rows || [];
  const rec = assembleRecords({ rows, priors: sources.map(s => ({ label: s.label, papers: s.state.papers, merged: s.state.merged })), library: options.library || 'union', now });
  const aliasOf = id => rec.aliases.get(id) || id;
  report.left = rec.left;
  const state = { ...base, papers: rec.papers, merged: [] };
  // What each adopted file was when it was read: its hash (when the reader can give one), size and time (plan §4.15d).
  const fileOf = async p => ({ hash: read.hash ? await Promise.resolve().then(() => read.hash(p)).catch(() => null) : null, size: entries.find(e => e.path === p)?.size, mtime: entries.find(e => e.path === p)?.mtime });
  const adoptions = [];
  const pairs = options.outcomes?.unmerged_duplicates || {};
  const mergeReport = applyMerges(state, { rows, byNo: rec.byNo, priorMerged: priorStates.flatMap(s => s.state.merged || []), pairs, aliasOf, at: now });
  const idOf = no => { const id = rec.byNo.get(no); return state.papers.some(p => p.id === id) ? id : null; };

  // Databases each record was found in, from the exports whose counts the PRISMA file names.
  const exportsUsed = [];
  const perDb = counts?.per_database || {};
  const exportFiles = files.filter(f => f.role === 'search-export');
  const dbRecords = new Map();   // database → records
  for (const f of exportFiles) {
    const db = databaseOf(f.name); if (!db) continue;
    const text = await read.text(f.path).catch(() => ''); if (!text) continue;
    const parsed = parseRecords(text, f.name).records;
    const want = perDb[db];
    if (want != null && parsed.length !== Number(want)) continue;
    if (dbRecords.has(db)) continue;   // the same export saved twice (an .nbib and its .txt)
    dbRecords.set(db, parsed); exportsUsed.push({ path: f.path, db, records: parsed.length });
  }
  const unusedExports = exportFiles.filter(f => !exportsUsed.some(e => e.path === f.path)).map(f => f.path);
  const lookup = indexPapers(state.papers);
  let sourced = 0;
  for (const [db, list] of dbRecords) for (const r of list) {
    const p = (cleanDoi(r.doi) && lookup.doi.get(cleanDoi(r.doi))) || (r.pmid && lookup.pmid.get(cleanPmid(r.pmid))) || lookup.title.get(normTitle(r.title).slice(0, 120));
    if (!p) continue;
    p.databases = [...new Set([...(p.databases || []), db])];
    if (!p.abstract && r.abstract) p.abstract = r.abstract;
  }
  const dbOrder = Object.keys(perDb).length ? Object.keys(perDb) : [...dbRecords.keys()];
  for (const p of state.papers) {
    const o = options.outcomes?.records?.[p.recordNo];
    const dbs = (p.databases || []).sort((a, b) => dbOrder.indexOf(a) - dbOrder.indexOf(b));
    const was = p.source;
    if (dbs.length) { p.source = dbs[0]; p.databases = dbs; }
    else if (o?.arm === 'other') p.source = counts?.other_label || 'Other methods';
    else continue;
    if (was && was !== p.source && !p.importedFrom) p.importedFrom = was;
    sourced++;
  }

  // ---- screening
  const by = options.by || 'BN';
  const decisions = screeningDecisions(wb, { outcomes: options.outcomes });
  const priorScreen = priorStates.find(s => Object.keys(s.state.screening || {}).length)?.state;
  const fileAt = screeningPath ? new Date(entries.find(e => e.path === screeningPath)?.mtime || Date.parse(now)).toISOString() : now;
  state.screening = {}; state.fulltext = {};
  state.screeningLog = [...(priorStates.find(s => s.state.screeningLog?.length)?.state.screeningLog || []), ...(base.screeningLog || [])];
  const via = 'folder';
  let ta = 0, ft = 0;
  for (const [no, d] of decisions) {
    const id = idOf(no); if (!id) continue;
    const pa = priorScreen?.screening?.[id]?.at;
    if (d.ta) {
      state.screening[id] = { decision: d.ta.decision, reason: d.ta.reason || '', at: pa || fileAt, by, via,
        ...(d.ta.evidence ? { evidence: d.ta.evidence } : {}), ...(d.ta.note ? { note: d.ta.note } : {}), ...(d.ta.sheet ? { sheet: d.ta.sheet } : {}) };
      if (d.ta.decision === 'exclude' && d.ta.reason) state.screening[id].reason = firstSentence(d.ta.reason);
      if (d.ta.decision === 'exclude' && d.ta.reason && state.screening[id].reason !== d.ta.reason) state.screening[id].evidence = [d.ta.reason, d.ta.evidence].filter(Boolean).join(' Evidence: ');
      ta++;
    }
    if (d.ft && state.screening[id]?.decision === 'include') {
      const day = dayOf(d.ft.date);
      const at = day ? `${day}T12:00:00.000Z` : fileAt;
      state.fulltext[id] = { decision: d.ft.decision, reason: d.ft.reason || '', at, by, via,
        ...(d.ft.evidence ? { evidence: d.ft.evidence } : {}), ...(d.ft.note ? { note: d.ft.note } : {}) };
      ft++;
    }
  }
  for (const [stage, key] of [['ta', 'screening'], ['ft', 'fulltext']]) for (const [id, d] of Object.entries(state[key]))
    state.screeningLog.push({ action: 'decide', stage, id, decision: d.decision, reason: d.reason, by, via, at: d.at, source: screeningPath });
  // ---- a master list: the patients, and the review's decision on every report it names
  let patientList = null;
  if (patientWb) patientList = applyPatientList(state, patientWb, patientFile, { now, by: options.by || 'list', report, adopt: adoptions });
  if (adoptions.length) adoptions[0] = withFile(adoptions[0], await fileOf(patientFile.path));
  if (patientList) { ft += patientList.decisions; state.project = { ...(state.project || {}), patientData: true }; }
  // A companion report of an included study points at it.
  const included = new Set(Object.entries(state.fulltext).filter(([, d]) => d.decision === 'include').map(([id]) => id));

  // ---- study PDFs, by the ID rule, and the evidence table's rows
  const studyFiles = index.studies;
  const evidenceSheet = evidenceWb ? (evidenceWb.sheets.find(s => s.name === (files.find(f => f.path === evidencePath)?.sheet)) || evidenceWb.sheets[0]) : null;
  const ev = evidenceSheet ? evidenceStudies(evidenceSheet.rows) : { studies: [] };
  const srcSheet = sourcesWb?.sheets.find(s => /with sources/i.test(s.name));
  const srcStudies = srcSheet ? new Map(evidenceStudies(srcSheet.rows).studies.map(s => [s.id, sourceCell(srcSheet.rows[s.rows[0]][1])])) : new Map();
  const lookup2 = indexPapers(state.papers);
  const studyPaper = new Map();   // table ID (number) → paper id
  const pdfOf = new Map(studyFiles.map(f => [f.study.no, f]));
  const includedPapers = state.papers.filter(p => included.has(p.id));
  const ids = [...new Set([...ev.studies.map(s => Number(s.id)), ...studyFiles.map(f => f.study.no)])].sort((a, b) => a - b);
  for (const no of ids) {
    const t = srcStudies.get(String(no));
    let p = t?.doi ? lookup2.doi.get(t.doi) : null;
    if (!p && t?.title) p = lookup2.title.get(normTitle(t.title).slice(0, 120));
    if (!p && pdfOf.get(no)) { const hit = matchStudyPdf(pdfOf.get(no).study, includedPapers); p = hit.paper; }
    if (p) studyPaper.set(no, p.id);
    else report.warnings.push(`Study ${no}${pdfOf.get(no) ? ` (${pdfOf.get(no).name})` : ''}: no record found`);
  }
  const labels = new Map();
  for (const f of studyFiles) {
    const id = studyPaper.get(f.study.no); if (!id) continue;
    const l = `${f.study.author} ${f.study.year}${f.study.suffix || ''}`;
    labels.set(l, [...(labels.get(l) || []), f.study.no]);
  }
  let linked = 0;
  const pdfMeta = async path => read.pdf ? read.pdf(path).catch(() => null) : null;
  for (const f of studyFiles) {
    const id = studyPaper.get(f.study.no); if (!id) continue;
    const p = state.papers.find(x => x.id === id);
    const l = `${f.study.author} ${f.study.year}${f.study.suffix || ''}`;
    const same = labels.get(l);
    const meta = await pdfMeta(f.path);
    Object.assign(p, { pdf: true, pdfName: f.name, pdfSize: meta?.size ?? f.size, pdfMode: 'folder', pdfRel: f.path, ...(meta?.hash ? { pdfHash: meta.hash } : {}),
      folderNo: f.study.no, label: same.length > 1 ? `${l}${String.fromCharCode(97 + same.indexOf(f.study.no))}` : l });
    linked++;
    if (!included.has(id)) report.warnings.push(`Study ${f.study.no} (${f.name}) is in papers/ but its record is not included at full text`);
  }
  const bare = [...included].filter(id => ![...studyPaper.values()].includes(id));
  // A folder that does not number its PDFs by the ID rule has no study to match; one line says so instead of a line per record.
  if (!studyFiles.length && !ev.studies.length) { if (bare.length) report.notes.push(`${bare.length} included records have no numbered study PDF in the folder (the "NN - Author Year.pdf" rule), so none is linked; attach them from the Folder view`); }
  else for (const id of bare) report.warnings.push(`Included record ${state.papers.find(p => p.id === id)?.label || id} has no study PDF or table row`);
  // Excluded PDFs: attached to their records, which stay excluded.
  let excludedLinked = 0;
  for (const f of files.filter(x => x.role === 'excluded-pdf')) {
    const ay = parseStudyPdf(f.name) || parseAuthorYearPdf(f.name);
    const hit = ay ? matchStudyPdf(ay, state.papers.filter(p => !included.has(p.id))) : { paper: null };
    if (!hit.paper) { report.warnings.push(`${f.path}: no record found`); continue; }
    const meta = await pdfMeta(f.path);
    Object.assign(hit.paper, { pdf: true, pdfName: f.name, pdfSize: meta?.size ?? f.size, pdfMode: 'folder', pdfRel: f.path, ...(meta?.hash ? { pdfHash: meta.hash } : {}) });
    excludedLinked++;
    const dup = /duplicate of ([^)]+)/i.exec(f.name)?.[1];
    if (dup) { const keep = matchStudyPdf(parseAuthorYearPdf(`${dup.trim()}.pdf`) || {}, includedPapers).paper; if (keep) hit.paper.companionOf = keep.id; }
  }

  // ---- values: carried from earlier states, then the evidence table
  state.values = { ...(base.values || {}) };
  let carried = 0, clashes = 0;
  for (const s of sources) for (const [k, v] of Object.entries(s.state.values || {})) {
    const pid = aliasOf(v.paper_id || k.slice(0, k.indexOf(':')));
    if (!state.papers.some(p => p.id === pid)) continue;
    const key = `${pid}:${v.field_id || k.slice(k.indexOf(':') + 1)}`;
    if (state.values[key]) { if (s !== cur && JSON.stringify(state.values[key].reported_value) !== JSON.stringify(v.reported_value)) clashes++; continue; }
    state.values[key] = { ...clone(v), paper_id: pid, ...(v.study_id ? { study_id: pid } : {}) }; carried++;
  }
  let evidence = null;
  if (evidenceWb && evidenceSheet) {
    evidence = evidenceImport({ path: evidencePath, workbook: evidenceWb, sheet: evidenceSheet.name, sourcesPath, sources: sourcesWb, groups, groupsPath,
      paperOf: no => studyPaper.get(Number(no)) || null, version: parseVersion(baseOf(evidencePath)).version, at: now, existingValues: state.values, file: await fileOf(evidencePath) });
    // Values carried from earlier states that were joined per study are split by the sheet too.
    const carriedSplit = splitJoinedArms({ template: evidence.template, values: { ...state.values, ...evidence.values }, sheet: evidence.sheet });
    state.values = carriedSplit.values;
    // cell rules: the guide's "Cell rules" table seeds the template's rules; a person's own rules are kept
    const prior = (base.templates || []).find(t => t.id === evidence.template.id);
    const seededRules = guide ? rulesFromGuide(guide, carriedSplit.template) : null;
    const withRules = prior?.rules ? { ...carriedSplit.template, rules: prior.rules } : withSeededRules(carriedSplit.template, seededRules);
    state.templates = [...(base.templates || []).filter(t => t.id !== evidence.template.id), withRules];
    if (seededRules && withRules.rules === seededRules.rules) report.cellRules = seededRules.report;
    evidence.report.armsCarried = carriedSplit.report;
    for (const no of evidence.report.unmatched) report.warnings.push(`Evidence table study ${no}: no record`);
  }

  // ---- collections, PRISMA, searches
  const tableCollections = collectionsFromGroups(groups, no => studyPaper.get(Number(no)) || null);
  state.collections = [...(base.collections || []).filter(c => !tableCollections.some(t => t.name === c.name && !c.parent)), ...tableCollections];
  const pr = prismaFromCounts(counts);
  if (pr) { state.prisma = { ...(base.prisma || {}), ...pr.prisma }; state.prismaArms = { ...(base.prismaArms || {}), ...pr.arms }; }
  const queries = files.filter(f => f.role === 'search-query');
  const logs = files.filter(f => f.role === 'search-log');
  let searchDate = '';
  for (const f of logs) { searchDate = dateIn(await read.text(f.path).catch(() => '')); if (searchDate) break; }
  const searches = [];
  for (const db of dbOrder) {
    const texts = [];
    for (const f of queries.filter(q => databaseOf(q.name) === db)) { const t = (await read.text(f.path).catch(() => '')).trim(); if (t && !texts.some(x => x.text === t)) texts.push({ text: t, path: f.path }); }
    const exp = exportsUsed.find(e => e.db === db);
    if (!texts.length && !exp) continue;
    const q = texts.find(x => /exact|documented/i.test(x.path)) || texts[0];
    searches.push({ source: db, kind: 'database', query: q?.text || '', at: searchDate ? `${searchDate}T12:00:00.000Z` : now, status: 'complete',
      retrieved: perDb[db] ?? exp?.records ?? null, imported: true, file: exp?.path || q?.path || '', ...(q ? { queryFile: q.path } : {}) });
  }
  if (searches.length) {
    const keep = (base.searches || []).filter(s => !searches.some(x => x.source === s.source && x.imported));
    state.searches = [...keep, ...searches];
    state.searchStrategy = { ...(base.searchStrategy || {}), ...(searchDate ? { lastSearched: searchDate } : {}),
      ...(counts?.other_results ? { otherSources: `${counts.other_label || 'Other methods'} (${counts.other_results} records)` } : {}) };
  }

  // ---- protocol and criteria
  const priorProtocol = sources.map(s => s.state.protocol).find(p => p?.criteria?.length) || base.protocol || null;
  let protocol = clone(priorProtocol) || { title: '', pico: {}, criteria: [] };
  const critChanges = [];
  if (wb.criteria.length) {
    const have = new Map((protocol.criteria || []).map(c => [c.id, c]));
    for (const c of wb.criteria) {
      const old = have.get(c.id);
      if (!old) { protocol.criteria.push(c); critChanges.push(`${c.id} added`); continue; }
      const changed = ['text', 'question', 'yes', 'no', 'stage', 'kind'].filter(k => c[k] && c[k] !== old[k]);
      if (changed.length) { Object.assign(old, Object.fromEntries(changed.map(k => [k, c[k]]))); critChanges.push(`${c.id} ${changed.join(', ')}`); }
    }
    if (critChanges.length) protocol.amendments = [...(protocol.amendments || []), { at: now, note: `Criteria brought in line with the "${wb.criteriaSheet}" sheet of ${baseOf(screeningPath)}: ${critChanges.join('; ')}`, source: screeningPath }];
  }
  state.protocol = protocol;

  // ---- project, paper, manuscript, to-dos
  const msTitle = manuscript?.blocks?.find(b => b.text?.trim())?.text?.trim() || '';
  const guideName = /^-\s*Name:\s*(.+)$/im.exec(guide || '')?.[1]?.trim() || '';   // the folder guide names the project
  state.project = { ...(base.project || {}), name: options.name || base.project?.name || priorStates.find(s => s.state.projectName)?.state.projectName || protocol.title || guideName || '',
    mode: 'systematic', researchType: typeId, patientData: Boolean(base.project?.patientData || patientList) };
  delete state.project.setupPending;
  state.paper = { ...(base.paper || {}), title: msTitle || base.paper?.title || '', authors: base.paper?.authors?.length ? base.paper.authors : [] };
  let msReport = null;
  if (manuscript?.blocks?.length) {
    const keyTo = new Map();
    const lib = indexPapers(state.papers);
    const aliasMaps = sources.map(s => s.state.paperAliases || {});
    let added = 0;
    for (const r of manuscript.records || []) {
      let id = state.papers.find(p => p.id === r.key || p.key === r.key)?.id;
      if (!id) for (const m of aliasMaps) if (m[r.key]) { id = aliasOf(m[r.key]); break; }
      if (!id && state.merged.some(m => m.dup?.id === r.key || m.dup?.key === r.key)) id = state.merged.find(m => m.dup?.id === r.key || m.dup?.key === r.key).keepId;
      if (!id) id = ((cleanDoi(r.doi) && lib.doi.get(cleanDoi(r.doi))) || lib.title.get(normTitle(r.title).slice(0, 120)))?.id;
      if (!id) { state.papers.push({ ...r, id: r.key }); id = r.key; added++; }
      keyTo.set(r.key, id);
    }
    const blocks = clone(manuscript.blocks);
    const swap = s => String(s).replace(/\[@([^\]\s]+)/g, (m, k) => `[@${keyTo.get(k) || k}`);
    for (const b of blocks) { b.text = swap(b.text || ''); for (const run of b.runs || []) if (run.cite) run.cite = run.cite.map(k => keyTo.get(k) || k); }
    state.manuscript = { ...(base.manuscript || {}), blocks, snapshot: {}, section: manuscript.section || null, styles: manuscript.styles || null, name: baseOf(manuscriptPath) };
    msReport = { blocks: blocks.length, references: (manuscript.records || []).length, citations: manuscript.citations || 0, addedRecords: added,
      remapped: [...keyTo].filter(([a, b]) => a !== b).length };
  } else if (manuscript?.error) report.warnings.push(`Manuscript not imported: ${manuscript.error}`);
  // ---- what a patient-level review keeps beside its manuscript
  const refs = applyReferenceFiles(state, refTexts, { now, report });
  // the same works saved as .ris and .bib are one list; the second finds every record held
  const supp = supplement ? applySupplement(state, supplement, { path: supplementPath }, { now, report }) : null;
  const ipdCounts = flowText ? applyIpdCounts(state, flowText, flowPath, { report }) : null;
  const open = todosFromGuide(guide);
  const todos = [...(base.todos || [])];
  let todoAdded = 0;
  open.forEach((text, i) => { if (!todos.some(t => t.text === text)) { todos.push({ id: `t-guide-${i + 1}`, text, due: '', done: false, at: now, source: guidePath }); todoAdded++; } });
  state.todos = todos;

  // ---- carried history and settings
  const history = priorStates.find(s => s.state.jevRuns?.length || s.state.proposals?.ta)?.state;
  if (history && options.history !== false) {
    const ta0 = {};
    for (const [id, p] of Object.entries(history.proposals?.ta || {})) { const nid = aliasOf(id); if (state.papers.some(x => x.id === nid)) ta0[nid] = p; }
    state.proposals = { ...(base.proposals || {}), ta: { ...ta0, ...(base.proposals?.ta || {}) } };
    state.jevRuns = [...(base.jevRuns || []), ...(history.jevRuns || []).filter(r => !(base.jevRuns || []).some(x => x.id === r.id)).map(r => { const c = clone(r); delete c.before; return c; })];
  }
  const aliases = { ...Object.assign({}, ...sources.map(s => s.state.paperAliases || {})), ...Object.fromEntries(rec.aliases) };
  for (const k of Object.keys(aliases)) aliases[k] = aliasOf(aliases[k]);
  state.paperAliases = aliases;
  const settings = { ...(base.settings || {}) };
  const priorSettings = priorStates.map(s => s.state.settings || {});
  for (const k of ['reviewerName', 'reviewerInitials']) if (!settings[k]) settings[k] = priorSettings.find(x => x[k])?.[k] || settings[k] || '';
  state.settings = settings;
  state.folderMap = { ...(base.folderMap || {}), applied: { ...(base.folderMap?.applied || {}),
    ...Object.fromEntries(Object.values(report.used).filter(Boolean).map(p => [p, { at: now, result: 'Read by folder setup' }])),
    ...Object.fromEntries(studyFiles.filter(f => studyPaper.get(f.study.no)).map(f => [f.path, { at: now, result: `Attached to study ${f.study.no}` }])),
    // the exports that became the search log, and their query files
    ...Object.fromEntries((state.searches || []).flatMap(r => [r.file && [r.file, { at: now, result: `Search log · ${r.source} · ${r.retrieved ?? ''} records`.trim() }], r.queryFile && [r.queryFile, { at: now, result: `Query of the ${r.source} search` }]]).filter(Boolean)) },
    // exports left out on purpose stay out of "new" work, with the reason
    ignored: { ...(base.folderMap?.ignored || {}), ...Object.fromEntries(unusedExports.map(p => [p, 'Superseded export; not screened'])) } };
  state.folderInit = { at: now, version: 1, sources: priors.map(p => p.label), files: report.used };
  state.format = PROJECT_FORMAT;
  delete state.saveToken;

  // The record of what was adopted: the cells of the evidence table and the master list, and the files that carry the rest.
  let adopted = emptyAdopted(current?.researchLedger?.projectId || '');
  const adoptable = [[screeningPath, screenWb, 'screening'], [manuscriptPath, manuscript && !manuscript.error ? manuscript : null, 'manuscript'], [sourcesPath, sourcesWb, 'other']];
  for (const [p, loaded, role] of adoptable) if (p && loaded) adopted = addAdoption(adopted, fileEntry({ path: p, role, at: now, file: await fileOf(p) }));
  if (evidence) adopted = addAdoption(adopted, evidence.adoption);
  for (const a of adoptions) adopted = addAdoption(adopted, a);

  const out = normalizeProject(state);
  // ---- report
  const incl = Object.values(out.fulltext).filter(d => d.decision === 'include').length;
  report.counts = {
    records: out.papers.length, recordsFromSheet: rows.length, recordsCreated: rec.made.length, recordsLeftOut: rec.left.length,
    recordsLeftOutUnique: rec.left.filter(l => !l.duplicateOf).length,
    merged: out.merged.length, mergedFromSheet: mergeReport.sheet, mergedPairs: mergeReport.pairs, mergedCarried: mergeReport.carried,
    withDatabase: sourced, exportsUsed, exportsNotUsed: unusedExports,
    screenedTA: Object.keys(out.screening).length, taInclude: Object.values(out.screening).filter(d => d.decision === 'include').length,
    taExclude: Object.values(out.screening).filter(d => d.decision === 'exclude').length, taUncertain: Object.values(out.screening).filter(d => d.decision === 'uncertain').length,
    assessedFT: Object.keys(out.fulltext).length, ftExclude: Object.values(out.fulltext).filter(d => d.decision === 'exclude').length, included: incl,
    studyPdfs: studyFiles.length, linkedPdfs: linked, excludedPdfsLinked: excludedLinked,
    evidenceStudies: evidence?.report.studies || 0, evidenceCells: evidence?.report.cells || 0, evidenceQuotes: evidence?.report.quotes || 0, evidenceKept: evidence?.report.kept || 0,
    templateColumns: evidence?.template.columns.length || 0, valuesCarried: carried, valueClashes: clashes, values: Object.keys(out.values).length,
    criteria: out.protocol?.criteria?.length || 0, criteriaChanges: critChanges,
    collections: tableCollections.map(c => `${c.name} (${c.members.length})`),
    prisma: out.prisma, searches: searches.map(s => `${s.source} ${s.retrieved ?? '?'}`),
    manuscript: msReport, todos: open.length, todosAdded: todoAdded, aliases: rec.aliases.size,
    patients: patientList, patientRows: out.participants?.length || 0, references: refs, supplement: supp, ipdCounts,
  };
  if (mergeReport.failed.length) report.warnings.push(...mergeReport.failed.map(x => `Merge not made: ${x}`));
  if (!options.outcomes && counts) report.notes.push('No per-record PRISMA outcomes given: decisions follow the screening sheet, and the PRISMA counts are entered from the counts file');
  report.files = index.files.map(f => ({ path: f.path, role: f.role, target: f.target || '', label: f.label, archived: f.archived, older: Boolean(f.older), used: Object.values(report.used).includes(f.path) || studyFiles.some(s => s.path === f.path && studyPaper.get(s.study.no)) }));
  return { state: out, report, adopted };
}
