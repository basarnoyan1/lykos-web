// The tools a run may call. Reads are scoped to the project: its documents and
// its folder. propose_cell and propose_changes are the only tools that touch
// state, and they file proposals a person accepts, never a value or a file
// (plan §6, G4). Every quoted
// text must be found in the document or it is dropped — a value without a
// locator cannot be checked and so is not evidence (F4).
import { OP_NAMES, opDocs, opGroups } from './change-ops.mjs';
import { gateProposal } from './numeric-gate.mjs';
import { fence } from './prompts.mjs';
import { declare } from './ai.mjs';
import { toolSends } from './egress-declared.mjs';
export const AVAILABILITY = ['present', 'not_found', 'not_applicable', 'conflicting'];
export const CAPS = { readChars: 40000, findMatches: 20, dirEntries: 200, fileChars: 40000, grepHits: 60, argErrors: 3 };

const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });

export function toolDefs({ images = false, propose = true, project = false, changes = false, openFile = false, opDocs: withDocs = false } = {}) {
  const defs = [
    fn('list_documents', 'Papers in this project that have a linked file.', {}),
    fn('read_document', 'Text of a document by page range, with [[page N]] markers.', { doc_id: { type: 'string' }, from: { type: 'integer' }, to: { type: 'integer' } }, ['doc_id']),
  ];
  if (openFile) defs.push(fn('read_open_file', 'Read the file open in the viewer, including PDFs not in Library. Returns text and page/paragraph/cell locators. Use next_offset to continue, page to jump, or query to find a phrase. This reads the same file throughout this turn.', {
    offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 20000 },
    page: { type: 'integer', minimum: 1 }, query: { type: 'string' },
  }));
  if (images) defs.push(fn('view_page', 'One page of a document as an image, for figures and tables.', { doc_id: { type: 'string' }, page: { type: 'integer' } }, ['doc_id', 'page']));
  defs.push(
    fn('find_text', 'Find a phrase in one document or in all of them.', { query: { type: 'string' }, doc_id: { type: 'string' } }, ['query']),
    fn('search_project', 'Search the protocol, accepted evidence, notes, analyses and manuscript drafts (drafts are not source evidence).', { query: { type: 'string' } }, ['query']),
    fn('list_folder', 'List actual Files sidebar entries. Empty path lists roots; copy returned paths exactly to inspect each folder. Roots alone do not describe their contents. offset continues large listings.', { path: { type: 'string' }, offset: { type: 'integer' } }),
    fn('read_file', 'Text of a file in the project: pdf, docx, xlsx, csv, markdown, plain text or source code. Long files come in pages: pass offset (characters) to continue.', { path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } }, ['path']),
    fn('grep', 'Find lines containing a phrase across the project files (case-insensitive). Optional path limits it to a folder, pattern to file names such as "*.docx".', { query: { type: 'string' }, path: { type: 'string' }, pattern: { type: 'string' } }, ['query']),
  );
  if (changes) defs.push(fn('propose_changes', `Propose changes for the person to accept; nothing changes until they do. Each change is {op, ...fields}. Ops: ${OP_NAMES.join(', ')}. ${withDocs ? `Fields:\n${opGroups().flatMap(g => opDocs(g)).join('\n')}` : 'An op\'s fields come back when its group loads (discover_tools); an error names them.'}`, {
    summary: { type: 'string', description: 'What the changes do, in a few words.' },
    changes: { type: 'array', items: { type: 'object', properties: { op: { type: 'string', enum: OP_NAMES } }, required: ['op'], additionalProperties: true } },
  }, ['summary', 'changes']));
  if (project) defs.push(fn('read_project', 'Read a bounded page of one project section when the overview and matches lack the facts. Accepted and proposed extraction values are labelled apart.', {
    section: { type: 'string', enum: ['protocol', 'searches', 'library', 'screening', 'extraction', 'patient_data', 'appraisal', 'analysis', 'certainty', 'manuscript', 'reporting', 'tasks', 'notes', 'workflows'] },
    offset: { type: 'integer' }, limit: { type: 'integer' },
  }, ['section']));
  if (propose) defs.push(fn('propose_cell', 'Propose the value of one table cell with its evidence. Quotes must be verbatim from the document.', {
    column: { type: 'string' }, value: { type: 'string' },
    availability: { type: 'string', enum: AVAILABILITY },
    rationale: { type: 'string', description: 'One sentence.' },
    evidence: { type: 'array', items: { type: 'object', properties: {
      kind: { type: 'string', enum: ['text', 'image', 'file'] }, doc_id: { type: 'string' }, quote: { type: 'string' },
      page: { type: 'integer' }, caption: { type: 'string' }, path: { type: 'string' } } } },
    verify: { type: 'string', enum: ['confirmed', 'amended', 'unsupported'] },
  }, ['column', 'value', 'availability', 'evidence']));
  defs.push(fn('finish', 'End the run with a short summary.', { summary: { type: 'string' } }, ['summary']));
  return defs;
}

export async function validateProposal(args, { columns, locate, validateImage, validateFile, known = null }) {
  if (!args || typeof args !== 'object') return { ok: false, error: 'arguments must be an object' };
  const col = columns.find(c => c.id === args.column) || columns.find(c => c.label === args.column);
  if (!col) return { ok: false, error: `unknown column "${args.column}"; use one of: ${columns.map(c => c.id).join(', ')}` };
  if (!AVAILABILITY.includes(args.availability)) return { ok: false, error: `availability must be one of ${AVAILABILITY.join(', ')}` };
  const evidence = [], dropped = [];
  for (const e of Array.isArray(args.evidence) ? args.evidence.slice(0, 12) : []) {
    if (!e || typeof e !== 'object') continue;
    if (e.kind === 'image') {
      const valid = Number.isInteger(e.page) && e.page > 0 && (!validateImage || await validateImage(e));
      if (valid) evidence.push({ kind: 'image', doc_id: e.doc_id || null, page: e.page, region: null, caption: String(e.caption || '').slice(0, 120) });
      else dropped.push(`image page ${e.page}`);
      continue;
    }
    if (e.kind === 'file') {
      const quote = String(e.quote || '').trim().slice(0, 500);
      const hit = quote && e.path && validateFile ? await validateFile(String(e.path), quote) : null;
      if (hit) evidence.push({ kind: 'file', path: String(e.path), locator: hit.locator, quote });
      else dropped.push(quote || `file ${e.path || ''}`);
      continue;
    }
    const quote = String(e.quote || '').trim();
    if (!quote) continue;
    const hit = await locate(quote, e.doc_id);
    if (hit) evidence.push({ kind: 'text', doc_id: e.doc_id || null, document_version: hit.document_version, page: hit.page, quote, rects: hit.rects });
    else dropped.push(quote);
  }
  const value = String(args.value ?? '').trim();
  const proposal = { column_id: col.id, value, normalized_value: value, availability: args.availability, evidence,
    rationale: String(args.rationale || '').slice(0, 300), verify: ['confirmed', 'amended', 'unsupported'].includes(args.verify) ? args.verify : null,
    unsupported: args.availability === 'present' && evidence.length === 0 };
  // The numeric gate: a number the quote does not state, a count above its denominator, a percentage that does not
  // follow from its counts. A value the rationale says is derived may hold a number the quote does not.
  const gate = gateProposal(proposal, { columns, known });
  const derived = /\b(deriv|calculat|comput|convert|pooled|sum of|divided|estimated from)\w*/i.test(proposal.rationale);
  const blocks = gate.findings.filter(f => f.severity === 'block' && !(derived && f.kind === 'number-not-in-quote'));
  if (blocks.length) return { ok: false, soft: true, error: `not recorded: ${blocks.map(f => f.message).join('; ')}. Quote the sentence or table row that states the value, or say in the rationale that it is derived, and propose the column again.` };
  if (gate.findings.length) proposal.findings = gate.findings.map(({ kind, severity, message }) => ({ kind, severity, message }));
  return { ok: true, proposal, dropped };
}

const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}\n[truncated at ${n} characters]` : s; };
const rec = s => String(s ?? '').replace(/\s+/g, ' ').slice(0, 500);

export function makeExecutor(ctx) {
  const say = (content, record = content, argError = false) => ({ content, record: rec(record), argError });
  const docIds = new Set(ctx.docs.map(d => d.id));
  const fileCache = new Map();
  const readTextFile = path => {
    if (!fileCache.has(path)) fileCache.set(path, (ctx.readText ? ctx.readText(path) : ctx.readPath(path).then(bytes => ctx.fileText(path.split('/').pop(), bytes))).catch(err => { fileCache.delete(path); throw err; }));
    return fileCache.get(path);
  };
  const requireDoc = id => { if (!docIds.has(id)) throw new Error(`document is not in this project: "${id}"; use an id from list_documents`); return id; };
  const evidenceDoc = id => {
    requireDoc(id);
    if (ctx.paperId && id !== ctx.paperId) throw new Error('evidence must come from this paper');
    return id;
  };
  const run = async (name, argsJson) => {
    if (ctx.signal?.aborted) return say('error: run stopped');
    let args;
    try { args = argsJson ? JSON.parse(argsJson) : {}; } catch { return say('error: arguments were not valid JSON', undefined, true); }
    try {
      switch (name) {
        case 'read_open_file': {
          if (!ctx.openFile) return say('error: no file is open for this turn', undefined, true);
          const result = await ctx.openFile.read(args);
          return say(JSON.stringify(result), `Read ${result.name}: ${result.text.length} of ${result.total} characters${result.next_offset != null ? ', more available' : ''}`);
        }
        case 'list_documents':
          return say(JSON.stringify(ctx.docs.map(d => ({ id: d.id, label: d.label, title: d.title }))), `${ctx.docs.length} documents`);
        case 'read_document': {
          const idx = await ctx.index(requireDoc(String(args.doc_id)));
          const total = idx.pages.length;
          const from = Math.max(1, args.from | 0 || 1), to = Math.min(total, args.to | 0 || total);
          if (from > total) throw new Error(`page is outside the document (it has ${total} pages)`);
          // Whole pages up to the read limit, so the model knows exactly where
          // to continue instead of meeting a cut mid-page.
          const out = []; let size = 0, last = from - 1;
          for (let n = from; n <= to; n++) {
            const part = `[[page ${n}]]\n${idx.pages[n - 1].text}`;
            if (out.length && size + part.length > CAPS.readChars) break;
            out.push(part); size += part.length + 2; last = n;
          }
          const more = last < to ? `\n[read limit reached after page ${last} of ${total}; continue with from=${last + 1}]` : '';
          return say(fence('document', clip(out.join('\n\n'), CAPS.readChars), { id: args.doc_id }) + more, `${args.doc_id} pages ${from}-${last}${more ? ` of ${from}-${to}` : ''}`);
        }
        case 'view_page': {
          const id = requireDoc(String(args.doc_id));
          const idx = await ctx.index(id);
          if (!Number.isInteger(args.page) || args.page < 1 || args.page > idx.pages.length) throw new Error(`page is outside the document (it has ${idx.pages.length} pages)`);
          const url = await ctx.pageImage(id, args.page);
          return { content: [{ type: 'text', text: `page ${args.page} of ${args.doc_id}` }, { type: 'image_url', image_url: { url } }], record: `image of ${args.doc_id} p. ${args.page}` };
        }
        case 'find_text': {
          const ids = args.doc_id ? [requireDoc(String(args.doc_id))] : ctx.docs.map(d => d.id);
          const hits = [];
          for (const id of ids) {
            const idx = await ctx.index(id).catch(() => null); if (!idx) continue;
            for (const h of ctx.findIn(idx.pages, String(args.query), CAPS.findMatches - hits.length)) hits.push({ doc_id: id, ...h });
            if (hits.length >= CAPS.findMatches) break;
          }
          const capped = hits.length >= CAPS.findMatches;
          return say(JSON.stringify(capped ? { hits, note: `first ${CAPS.findMatches} matches only; pass doc_id or a longer phrase to narrow` } : hits), `${hits.length}${capped ? '+' : ''} matches for "${args.query}"`);
        }
        case 'search_project': {
          const query = String(args.query || '').slice(0, 300);
          if (!query.trim()) return say('error: query is required: a few distinctive words', undefined, true);
          const hits = ctx.searchProject(query);
          if (!hits.length) return say(JSON.stringify({ hits: [], note: 'no matches; try fewer or other words, or read_project for a whole section' }), '0 project matches');
          return say(clip(JSON.stringify(hits), CAPS.readChars), `${hits.length} project matches`);
        }
        case 'read_project': {
          if (!ctx.readProject) return say('error: project section access unavailable', undefined, true);
          const result = ctx.readProject(String(args.section || ''), { offset: args.offset, limit: args.limit });
          const items = [];
          for (const item of result.items) {
            let safe = JSON.parse(JSON.stringify(item, (_key, value) => typeof value === 'string' ? value.slice(0, 2500) : value));
            if (!items.length && JSON.stringify({ ...result, items: [safe] }).length > CAPS.readChars)
              safe = { excerpt: JSON.stringify(safe).slice(0, CAPS.readChars - 2000), truncated: true };
            if (JSON.stringify({ ...result, items: [...items, safe] }).length > CAPS.readChars) break;
            items.push(safe);
          }
          return say(JSON.stringify({ ...result, items, returned: items.length, more: result.offset + items.length < result.total }),
            `${args.section}: ${items.length} of ${result.total} items`);
        }
        case 'list_folder': {
          const all = await ctx.listDir(String(args.path || ''));
          const offset = Math.max(0,args.offset|0),list=all.slice(offset,offset+CAPS.dirEntries);
          return say(JSON.stringify({path:args.path||'',entries:list,total:all.length,offset,next_offset:offset+list.length<all.length?offset+list.length:null}), `${list.length} of ${all.length} entries in ${args.path || 'roots'}`);
        }
        case 'read_file': {
          const path = String(args.path || '');
          const ft = await readTextFile(path);
          const from = Math.max(0, args.offset | 0), n = Math.min(CAPS.fileChars, Math.max(1000, args.limit | 0 || CAPS.fileChars));
          const part = ft.text.slice(from, from + n), rest = ft.text.length - from - part.length;
          return say(`${fence('file', part, { path })}${rest > 0 ? `\n[${rest} more characters; continue with offset ${from + part.length}]` : ''}`,
            `read ${path}${from ? ` from ${from}` : ''} (${ft.text.length} chars)`);
        }
        case 'grep': {
          if (!ctx.grep) return say('error: search is unavailable', undefined, true);
          const r = await ctx.grep(String(args.query || '').slice(0, 200), { path: String(args.path || ''), pattern: String(args.pattern || ''), hits: CAPS.grepHits, signal: ctx.signal });
          const note = (r.capped ? `searched ${r.read} of ${r.files} files` : `searched ${r.read} files`) + (r.truncated ? '; the folder has more files than were listed (3,000 files or 10 levels), so this search is not complete' : '');
          return say(JSON.stringify({ hits: r.hits, note, incomplete:!!r.incomplete, errors:r.errors||[] }), `${r.hits.length} lines for "${args.query}"; ${note}${r.incomplete?'; some files or folders could not be read':''}`);
        }
        case 'propose_changes': {
          if (!ctx.proposeChanges) return say('error: changes cannot be proposed here', undefined, true);
          const r = await ctx.proposeChanges(args);
          if (!r.ok) return say(`error: ${r.error || r.problems.join('; ')}`, undefined, !r.problems?.length);
          const wrote = r.written?.length ? `wrote ${r.written.length} change(s) in the manuscript as tracked changes by Assistant (${r.written.map(w => `${w.label} ${w.block}`).join(', ')}): the person sees them in the page and accepts or rejects them there or in your answer; do not describe them again. ` : '';
          return say(`${wrote}${r.filed || !wrote ? `filed ${r.filed} change(s) for the person to accept${r.problems.length ? `; not filed: ${r.problems.join('; ')}` : ''}. ` : r.problems.length ? `Not filed: ${r.problems.join('; ')}. ` : ''}Nothing is applied until they accept.`, wrote && !r.filed ? `wrote ${r.written.length} tracked change(s)` : `proposed ${r.filed} change(s)`);
        }
        case 'propose_cell': {
          const r = await validateProposal(args, {
            columns: ctx.columns,
            locate: (q, docId) => ctx.locate(evidenceDoc(String(docId || ctx.paperId)), q),
            validateImage: async e => {
              const idx = await ctx.index(evidenceDoc(String(e.doc_id || ctx.paperId)));
              return e.page <= idx.pages.length;
            },
            validateFile: async (path, quote) => {
              try {
                const ft = await readTextFile(path);
                const at = ft.text.indexOf(quote);
                return at < 0 ? null : { locator: ft.locators.find(l => at >= l.start && at < l.end) || null };
              } catch { return null; }
            },
          });
          if (!r.ok) return say(`error: ${r.error}`, undefined, !r.soft);
          if (ctx.signal?.aborted) return say('error: run stopped');
          ctx.onProposal(r.proposal);
          const note = r.dropped.length ? ` Dropped ${r.dropped.length} unverified evidence item(s): ${r.dropped.map(q => `"${q.slice(0, 60)}"`).join('; ')}. Re-propose with a valid page or exact file wording.` : '';
          const flagged = r.proposal.findings?.length ? ` Check: ${r.proposal.findings.map(f => f.message).join('; ')}.` : '';
          return { ...say(`recorded proposal for ${r.proposal.column_id}${r.proposal.unsupported ? ' (unsupported: no evidence located)' : ''}.${note}${flagged}`), proposedColumn: r.proposal.column_id };
        }
        case 'finish':
          ctx.onFinish(String(args.summary || ''));
          return say('finished', `finish: ${args.summary || ''}`);
        default:
          return say(`error: unknown tool ${name}; call only the tools listed in this request`, undefined, true);
      }
    } catch (err) {
      const message = String(err?.message || err).slice(0, 200);
      return say(`error: ${message}`, undefined, /document is not in this project|evidence must come from this paper|page is outside the document|unknown project section/.test(message));
    }
  };
  // What a result carries (file text, project sections, values) is declared as it is made; lib/egress.mjs reads it at the send, wherever the text lands.
  return async function execute(name, argsJson) {
    const r = await run(name, argsJson);
    if (typeof r?.content === 'string') declare(r.content, ...toolSends(name, argsJson));
    return r;
  };
}
