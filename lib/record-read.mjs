// One record in full, for a reader that is not the app (the MCP server's
// read(target: "record:…"), plan §6.4a): its citation, abstract, screening
// decisions, appraisal, accepted values with their evidence anchors, notes and
// the file it is attached to, as one compact page. Pure over the project state.
import { allTools } from '../schema.mjs';

const clip = (v, n) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const norm = v => String(v ?? '').toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/\s+/g, ' ').trim();

/**
 * The record a reference names: its id, exact label, DOI or PMID, else the one
 * record whose label or title contains the text. `{ paper }` or `{ error }`
 * (nothing matched, or several did: they are named).
 */
export function findRecord(state, ref) {
  const q = norm(ref);
  if (!q) return { error: 'Name a record: its id, label, DOI or PMID, or part of its title.' };
  const papers = state.papers || [];
  const exact = papers.filter(p => [p.id, p.label, p.doi, p.pmid].some(x => x != null && norm(x) === q));
  if (exact.length === 1) return { paper: exact[0] };
  const near = exact.length ? exact : papers.filter(p => norm(p.label).includes(q) || norm(p.title).includes(q));
  if (near.length === 1) return { paper: near[0] };
  if (!near.length) return { error: `No record matches "${clip(ref, 60)}". find(query, scope: "state") looks records up.` };
  return { error: `${near.length} records match "${clip(ref, 60)}": ${near.slice(0, 8).map(p => `${p.label || p.title} (${p.id})`).join('; ')}${near.length > 8 ? '; …' : ''}. Use the id.` };
}

const authorsOf = a => (Array.isArray(a) ? a : String(a || '').split(/;\s*/)).filter(Boolean);

/** The record's page as an object; `recordText` prints it. */
export function recordPage(state, paper, { abstractChars = 2200, values = 40 } = {}) {
  const p = paper, id = p.id;
  const dec = (d) => d ? { decision: d.decision || '', ...(d.reason ? { reason: d.reason } : {}), ...(d.at ? { at: d.at } : {}), ...(d.by ? { by: d.by } : {}) } : null;
  const dual = {};
  for (const [stage, byId] of Object.entries(state.dual || {})) if (byId?.[id]) dual[stage] = Object.fromEntries(Object.entries(byId[id]).map(([who, d]) => [who, dec(d)]));
  const labels = new Map((state.templates || []).flatMap(t => (t.columns || []).map(c => [`${t.id}.${c.id}`, c.label || c.id])));
  const vals = Object.entries(state.values || {}).filter(([k]) => k.startsWith(`${id}:`)).map(([k, v]) => {
    const col = k.slice(id.length + 1), base = col.replace(/@arm\d+$/, ''), arm = /@arm(\d+)$/.exec(col)?.[1];
    return { column: labels.get(base) || base, ...(arm ? { arm: Number(arm) } : {}), value: clip(v.reported_value, 300), availability: v.availability || '',
      evidence: (v.evidence || []).slice(0, 3).map(e => ({ kind: e.kind, file: e.doc_id || '', page: e.page ?? null, ...(e.quote ? { quote: clip(e.quote, 240) } : {}) })) };
  });
  const appraisal = [];
  for (const t of allTools(state)) {
    const a = state.assessments?.[id]?.[t.id];
    if (a && Object.keys(a).length) appraisal.push({ instrument: t.name, judgements: Object.fromEntries(Object.entries(a).map(([d, j]) => [t.domains.find(x => x.id === d)?.short || d, j])) });
  }
  return {
    id, label: p.label || '', citation: { authors: authorsOf(p.authors), title: p.title || '', journal: p.journal || '', year: p.year || '', doi: p.doi || '', pmid: p.pmid || '' },
    sources: [...(Array.isArray(p.databases) && p.databases.length ? p.databases : [p.source].filter(Boolean))],
    abstract: clip(p.abstract, abstractChars),
    screening: { title_abstract: dec(state.screening?.[id]), full_text: dec(state.fulltext?.[id]), ...(Object.keys(dual).length ? { reviewers: dual } : {}) },
    appraisal,
    values: { total: vals.length, shown: vals.slice(0, values) },
    notes: (state.notes || []).filter(n => n.paper === id).slice(0, 20).map(n => ({ id: n.id, page: n.page ?? null, kind: n.kind || 'comment', text: clip(n.text, 300) })),
    files: { pdf_attached: Boolean(p.pdf), pdf_name: p.pdfName || '', anchors: [...new Set(vals.flatMap(v => v.evidence.filter(e => e.file || e.page != null).map(e => `${e.file || p.pdfName || 'record'} p.${e.page ?? '?'}`)))].slice(0, 30) },
  };
}

const line = (k, v) => (v ? `${k}: ${v}` : '');
/** The page as text: short lines, no table, the way a person would want to read one record. */
export function recordText(page) {
  const c = page.citation, s = page.screening;
  const d = x => x ? `${x.decision}${x.reason ? ` (${x.reason})` : ''}` : 'no decision';
  const out = [
    `Record ${page.label || page.id} | id ${page.id}`,
    line('Title', c.title), line('Authors', c.authors.join('; ')), line('Journal', [c.journal, c.year].filter(Boolean).join(' ')),
    line('DOI', c.doi), line('PMID', c.pmid), line('Found by', page.sources.join(', ')),
    '', `Abstract: ${page.abstract || 'none held'}`, '',
    `Screening: title and abstract ${d(s.title_abstract)}; full text ${d(s.full_text)}`,
    ...Object.entries(s.reviewers || {}).flatMap(([stage, by]) => Object.entries(by).map(([who, x]) => `  ${stage} ${who}: ${d(x)}`)),
    ...(page.appraisal.length ? ['Appraisal:', ...page.appraisal.map(a => `  ${a.instrument}: ${Object.entries(a.judgements).map(([k, v]) => `${k} ${v}`).join(', ')}`)] : ['Appraisal: none']),
    `Accepted values: ${page.values.total}${page.values.total > page.values.shown.length ? ` (${page.values.shown.length} shown)` : ''}`,
    ...page.values.shown.map(v => `  ${v.column}${v.arm ? ` [arm ${v.arm}]` : ''}: ${v.value}${v.availability ? ` (${v.availability})` : ''}${v.evidence.length ? ` <- ${v.evidence.map(e => `${e.file ? `${e.file} ` : ''}p.${e.page ?? '?'}${e.quote ? ` "${e.quote}"` : ''}`).join(' | ')}` : ''}`),
    ...(page.notes.length ? ['Notes:', ...page.notes.map(n => `  ${n.kind}${n.page != null ? ` p.${n.page}` : ''}: ${n.text}`)] : []),
    `Files: ${page.files.pdf_attached ? `PDF attached${page.files.pdf_name ? ` (${page.files.pdf_name})` : ''}` : 'no PDF attached'}${page.files.anchors.length ? `; anchors ${page.files.anchors.join(', ')}` : ''}`,
  ];
  return out.filter((l, i) => l !== '' || out[i - 1] !== '').join('\n');
}
