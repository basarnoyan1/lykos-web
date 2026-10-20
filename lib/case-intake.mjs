// Case-paper intake (PAPER-COVERAGE F1): PDFs dropped on Patients become records in the project's papers folder, named by the
// `NN - Author YYYY` rule, and a queue of what each one is waiting for. Nothing here reads a report: extraction is the batch job
// (lib/extract-batch.mjs, scope 'selected' over the queued papers), and a row joins the patients only when a person accepts it.
//
// `state.intake` is one item per dropped file: { id, paperId, name, hash, no, rel, at, how, unmatched, duplicate, excluded, read }.
//   how        what identified the file: 'matched-doi', 'matched-title', 'matched-text', 'new-from-doi', 'new-from-title', 'new-from-pdf', 'unidentified', 'duplicate-file', 'has-pdf'
//   unmatched  no registry or library record was found for it: a record made from the file stays until a person points the file at the right one
//   duplicate  the same bytes (or another file for a record that has one) are already in the project: nothing was copied
//   excluded   why a person (or a read that found no individual patient) left it out, '' otherwise
//   read       { at, rows } once the batch has read it; it is not read again unless a person asks
// The state of a row is derived from these and from the patients and proposed rows of its record, never stored.
import { get, update } from '../store.mjs';
import { parseStudyPdf } from './folder-map.mjs';
import { familyName, authorList } from './bib.mjs';
import { matchesPaperText } from './pdf-identity.mjs';
import { join, baseName, freeName } from './fsys.mjs';

const pad = n => String(n).padStart(2, '0');
const cleanName = s => String(s).replace(/[/\\:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim();
const stemOf = name => String(name).replace(/\.pdf$/i, '');
const itemId = hash => `ci${hash.slice(0, 12)}`;

export const intakeItems = (state = get()) => state.intake || [];

/** The name the folder rule gives a case paper: `NN - Author YYYY.pdf`; a record with no author or year is named after what it has. */
export function caseFileName(no, paper, fallback = '') {
  const first = authorList(paper?.authors)[0];
  const author = cleanName(familyName(first || '') || String(paper?.label || '').replace(/\s*\d{4}[a-z]?$/, '') || stemOf(fallback) || 'Unknown').slice(0, 60);
  const year = String(paper?.year || '').match(/\d{4}/)?.[0] || '';
  return `${pad(no)} - ${[author, year].filter(Boolean).join(' ')}.pdf`;
}

/** The next free number: above every number a record, a queued file or a file in the papers folder already has. */
export async function nextNumber(state, folder = null, dir = '') {
  let top = 0;
  for (const p of state.papers || []) top = Math.max(top, Number(p.folderNo) || 0, parseStudyPdf(baseName(p.pdfRel || ''))?.no || 0);
  for (const i of intakeItems(state)) top = Math.max(top, Number(i.no) || 0);
  if (folder) { try { for (const e of await folder.list(dir)) if (!e.dir) top = Math.max(top, parseStudyPdf(e.name)?.no || 0); } catch { /* no folder yet: the first file makes it */ } }
  return top + 1;
}

// ---- what a row says ----------------------------------------------------------------------------------------------------

/** One row per dropped file: { item, paper, label, state, rows, patients, detail }. state: unmatched | duplicate | excluded | proposed | accepted | read | queued. */
export function intakeRows(state = get()) {
  const papers = new Map((state.papers || []).map(p => [p.id, p]));
  return intakeItems(state).map(item => {
    const paper = papers.get(item.paperId) || null;
    const rows = (state.ipdProposals || []).filter(p => p.study_id === item.paperId).length;
    const patients = (state.participants || []).filter(p => p.study_id === item.paperId).length;
    const st = item.duplicate ? 'duplicate' : item.excluded ? 'excluded' : rows ? 'proposed' : patients ? 'accepted' : item.read ? 'read' : item.unmatched ? 'unmatched' : 'queued';
    return { item, paper, label: paper?.label || paper?.title || stemOf(item.name), state: st, rows, patients };
  });
}

/** { new, unmatched, proposed, accepted, excluded, duplicate, read, total } of the queue. `new` are the matched files waiting to be read. */
export function intakeCounts(state = get()) {
  const out = { new: 0, unmatched: 0, proposed: 0, accepted: 0, excluded: 0, duplicate: 0, read: 0, total: 0 };
  for (const r of intakeRows(state)) { out.total++; out[r.state === 'queued' ? 'new' : r.state]++; }
  return out;
}

/** The papers Extract new reads: matched, never read, not excluded, with a PDF. */
export const queuedPapers = (state = get()) => intakeRows(state).filter(r => r.state === 'queued' && r.paper?.pdf).map(r => r.paper.id);

/** Papers the queue says are done with or set aside, so no batch asks for them again (an excluded file, one already read). */
export function settledPapers(state = get()) {
  const out = new Set();
  for (const i of intakeItems(state)) if (!i.duplicate && (i.excluded || i.read)) out.add(i.paperId);
  return out;
}

/** The batch calls this when it has read a paper: no rows at all means the report gives no individual patient, which is a reason to leave it out. */
export function markRead(paperId, rows) {
  if (!intakeItems().some(i => i.paperId === paperId && !i.duplicate)) return;
  update(s => {
    for (const i of s.intake || []) if (i.paperId === paperId && !i.duplicate) { if (rows > 0) i.read = { at: new Date().toISOString(), rows }; else i.excluded = 'No individual patients in the report'; }
    return s;
  });
}

const patch = (id, fn) => update(s => { const i = (s.intake || []).find(x => x.id === id); if (i) fn(i); return s; });
export const excludeItem = (id, reason = 'Left out') => patch(id, i => { i.excluded = String(reason).trim() || 'Left out'; });
/** An unmatched file stays with the record made from it, which a person edits in Library. */
export const keepRecord = id => patch(id, i => { i.unmatched = false; i.how = 'new-from-pdf-kept'; });
export const includeItem = id => patch(id, i => { i.excluded = ''; i.read = null; });
export const readAgain = id => patch(id, i => { i.read = null; if (i.excluded === 'No individual patients in the report') i.excluded = ''; });
/** Takes a file off the list; the record and the PDF stay where they are. */
export const removeItem = id => update(s => { s.intake = (s.intake || []).filter(x => x.id !== id); return s; });

// ---- dropping files -----------------------------------------------------------------------------------------------------

/**
 * Adds PDFs to the project. For each file, in order: the same bytes already in the project (nothing is copied), a library record
 * with its DOI, one with its title, a registry lookup, a record made from the file; then a library record that has no PDF whose DOI or
 * title is printed on the file's first pages. A matched or registry record gets the file; a file nothing identifies gets a record
 * made from its name, marked unmatched until a person points it at the right one.
 *
 * deps: place(file, bytes) -> { how, paper, meta: { hash, text? } }  (views/library.mjs placeFile)
 *       folder, papersDir (the folder's papers directory), attach(paperId, rel, size, hash), putFile(id, blob) for a project with no folder,
 *       say(text)
 * Returns { added, matched, unmatched, duplicates, again, skipped, failed: [{ name, error }] }.
 */
export async function addCaseFiles(files, deps) {
  const { place, folder = null, papersDir = '', attach = null, putFile = null, say = () => {} } = deps;
  const out = { added: 0, matched: 0, unmatched: 0, duplicates: 0, again: 0, skipped: 0, failed: [] };
  const list = [...files];
  let n = 0;
  for (const file of list) {
    n++;
    if (!/\.pdf$/i.test(file.name || '')) { out.skipped++; continue; }
    say(`${n} of ${list.length}: ${file.name}`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let r = await place(file, bytes);
      const hash = r.meta.hash, now = get();
      const listed = intakeItems(now).filter(i => i.hash === hash);
      const base = { id: itemId(hash), name: file.name, hash, at: new Date().toISOString(), excluded: '', read: null };
      if (r.how === 'duplicate-file') {
        if (listed.some(i => i.duplicate)) { out.again++; continue; }   // already offered as a duplicate
        update(s => { (s.intake ||= []).push({ ...base, id: `${base.id}d`, paperId: r.paper.id, how: 'duplicate-file', duplicate: true, rel: r.paper.pdfRel || '' }); return s; });
        out.duplicates++; continue;
      }
      if (listed.some(i => !i.duplicate)) { out.again++; continue; }
      // a file nothing identified: its first pages may still print the DOI or title of a record that has no PDF yet
      if (!r.paper || r.how === 'new-from-pdf') {
        const hit = (now.papers || []).find(p => !p.pdf && matchesPaperText(p, r.meta.text || ''));
        if (hit) r = { ...r, how: 'matched-text', paper: hit };
      }
      let paper = r.paper, unmatched = false;
      if (!paper || r.how === 'new-from-pdf') {
        unmatched = true;
        if (!paper) { const id = `pdf-${hash.slice(0, 12)}`; paper = { id, key: id, title: stemOf(file.name), label: stemOf(file.name).slice(0, 40), authors: [], year: '', source: 'file', pdf: null, unidentified: true }; }
      }
      const known = (now.papers || []).find(p => p.id === paper.id || p.key === paper.key);
      if (known) paper = known;
      else update(s => { if (!s.papers.some(p => p.id === paper.id)) s.papers.push(paper); return s; });
      if (known?.pdf && known.pdfHash !== hash) {   // the record already has another file: it is not replaced here
        update(s => { (s.intake ||= []).push({ ...base, paperId: paper.id, how: 'has-pdf', duplicate: true, rel: known.pdfRel || '' }); return s; });
        out.duplicates++; continue;
      }
      const no = await nextNumber(get(), folder, papersDir), name = caseFileName(no, paper, file.name);
      let rel = '';
      if (folder) {
        rel = await freeName(folder, join(papersDir, name));
        await folder.writeBytes(rel, bytes);
        attach?.(paper.id, rel, bytes.length, hash);
      } else {
        await putFile?.(paper.id, file);
        update(s => { const p = s.papers.find(x => x.id === paper.id); if (p) Object.assign(p, { pdf: true, pdfName: name, pdfSize: bytes.length, pdfMode: 'copy', pdfHash: hash }); return s; });
      }
      update(s => {
        const p = s.papers.find(x => x.id === paper.id); if (p) p.folderNo = no;
        (s.intake ||= []).push({ ...base, paperId: paper.id, how: r.how, no, rel, unmatched, duplicate: false });
        return s;
      });
      out.added++; out[unmatched ? 'unmatched' : 'matched']++;
    } catch (err) { out.failed.push({ name: file.name, error: String(err?.message || err).slice(0, 120) }); }
  }
  return out;
}

/** The sentence for what a drop did. */
export function dropSummary(r) {
  const parts = [];
  if (r.added) parts.push(`${r.added} added`);
  if (r.duplicates) parts.push(`${r.duplicates} already in the project`);
  if (r.again) parts.push(`${r.again} already on the list`);
  if (r.skipped) parts.push(`${r.skipped} not a PDF`);
  if (r.failed.length) parts.push(`${r.failed.length} failed: ${r.failed[0].name}, ${r.failed[0].error}`);
  return parts.join(' · ') || 'Nothing to add';
}

// ---- pointing a file at its record ---------------------------------------------------------------------------------------

/**
 * Moves an unmatched file to the record a person chose: the record takes the PDF (and is renamed `NN - Author YYYY` in the folder),
 * and the record made from the file is dropped when nothing else refers to it. Refuses a record that already has a different PDF.
 * deps: folder, moveFile(fromId, toId) for a project with no folder (copies the stored bytes).
 */
export async function relinkItem(id, paperId, { folder = null, moveFile = null } = {}) {
  const state = get(), item = intakeItems(state).find(i => i.id === id), target = (state.papers || []).find(p => p.id === paperId);
  if (!item || !target) return { ok: false, reason: 'That record is no longer there' };
  const from = (state.papers || []).find(p => p.id === item.paperId);
  if (!from) return { ok: false, reason: 'The file has no record' };
  if (target.id === from.id) return { ok: true };
  if (target.pdf && target.pdfHash !== item.hash) return { ok: false, reason: `${target.label || 'That record'} already has a PDF` };
  const no = item.no || await nextNumber(state, folder, '');
  let rel = item.rel;
  if (folder && rel) {
    const next = await freeName(folder, join(rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', caseFileName(no, target, item.name)));
    if (next !== rel) { try { await folder.rename(rel, next); rel = next; } catch { /* the name stays; the link is what matters */ } }
  } else if (!folder && moveFile) await moveFile(from.id, target.id);
  const stubIsOurs = from.unidentified || from.source === 'file' || /^pdf-/.test(from.id);
  update(s => {
    const t = s.papers.find(p => p.id === target.id), f = s.papers.find(p => p.id === from.id);
    if (t && f) { Object.assign(t, { pdf: f.pdf || true, pdfName: baseName(rel || '') || caseFileName(no, t, item.name), pdfSize: f.pdfSize, pdfMode: f.pdfMode, pdfHash: item.hash, folderNo: no, ...(rel ? { pdfRel: rel } : {}) }); }
    const other = (s.intake || []).some(i => i.id !== id && i.paperId === from.id) || (s.participants || []).some(p => p.study_id === from.id) || (s.ipdProposals || []).some(p => p.study_id === from.id);
    if (f && stubIsOurs && !other) s.papers = s.papers.filter(p => p.id !== from.id);
    const i = (s.intake || []).find(x => x.id === id); if (i) Object.assign(i, { paperId: target.id, unmatched: false, rel, no, how: 'chosen' });
    return s;
  });
  return { ok: true };
}
