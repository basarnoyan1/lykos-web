import { durableAction } from '../lib/aid-proposals.mjs';
// Model actions for the file view (lib/aid.mjs).
//
// The file shown is read as it is on disk: a text, Markdown or table file as
// text, and a PDF only when it is a library record's, through the same page
// reader every full-text action uses. The summary is saved beside the file,
// under a name that is not taken, only when a person accepts it.
import { register, jsonOf, quoteIn, pdfPages } from '../lib/aid.mjs';
import { complete } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { baseName, parentOf, join, extOf, freeName } from '../lib/fsys.mjs';
import { kindOf, paperAt } from '../views/explorer.mjs';

const TEXT_CHARS = 40000;

/** How the shown file can be read: 'text', 'pdf', or '' when it cannot. */
export function readable(rel, paper) {
  const k = kindOf(rel);
  if (k === 'pdf') return paper ? 'pdf' : '';
  if (k === 'text' || k === 'table') return 'text';
  if (k === 'manuscript' && ['md', 'markdown'].includes(extOf(rel))) return 'text';
  return '';
}
const relOf = ctx => ctx?.focus?.kind === 'file' ? String(ctx.focus.detail || '') : '';

/**
 * Keeps the points whose quote the file contains, each with the page it was
 * found on when the file was read by page, and the summary only when at least
 * one point survived, so what is saved rests on something checkable.
 */
export function keepFileSummary(reply, pages) {
  const points = [];
  for (const x of Array.isArray(reply?.points) ? reply.points : []) {
    if (!x?.text) continue;
    const at = pages.find(pg => quoteIn(x.quote, pg.text));
    if (at) points.push({ text: String(x.text).trim().slice(0, 300), quote: String(x.quote).trim().slice(0, 400), page: at.page });
    if (points.length === 5) break;
  }
  return { points, summary: points.length ? String(reply?.summary || '').trim().slice(0, 2000) : '' };
}

/** The Markdown written beside the file. */
export function summaryMarkdown(name, summary, points, { model = '', paged = false } = {}) {
  return [`# ${name}`, '', summary, '',
    ...points.map(p => `- ${p.text}\n  > ${p.quote}${paged ? ` (p. ${p.page})` : ''}`), '',
    `Summarised by ${model || 'a model'} on ${new Date().toISOString().slice(0, 10)}; each point quotes the file.`, ''].join('\n');
}

const proposeFile = durableAction('file-summary', async (data, { guard = () => {}, guardBoundary = guard, checkpoint, signal } = {}) => {
  const { markdown, source, sourceStat, root } = data;
    const check = () => { guard(); if (signal?.aborted) throw new DOMException('Application stopped', 'AbortError'); };
    check();
    const folder = activeFolder();
    if (!folder || (folder.root || folder.name) !== root) throw new Error('Open the original project folder to save this summary.');
    const current = await folder.stat(source); check();
    if (!current?.exists || current.dir || current.size !== sourceStat.size || current.mtime !== sourceStat.mtime)
      return { refused: 'The source file changed. Summarise it again.' };
  const existing = await folder.stat(data.target); check();
  if (existing.exists && !existing.dir) {
    const text = new TextDecoder().decode(await folder.read(data.target)); check();
    if (text === markdown) return `Saved ${baseName(data.target)}`;
  }
  const rel = await freeName(folder, data.target); check();
  // Keep the actual destination with the proposal if an asynchronous save
  // fails after writing. A retry recognizes the completed identical file.
  data.target = rel;
  await checkpoint?.(); check();
  const saved = folder.commitText
    ? await folder.commitText(rel, markdown, null)
    : await folder.writeBytes(rel, new TextEncoder().encode(markdown));
  guardBoundary();
  if (saved?.stale) return { refused: 'A file appeared at that name. Accept again to choose a free name.' };
    return `Saved ${baseName(rel)}`;
});

register('files', [
  {
    id: 'summarise-file',
    label: 'Summarise this file',
    icon: 'file',
    task: 'assist',
    when: (s, ctx) => { const rel = relOf(ctx); return !!rel && !!activeFolder() && !!readable(rel, paperAt(rel)); },
    async run({ cfg, signal, brief, context, progress }) {
      const folder = activeFolder();
      const rel = relOf(context), name = baseName(rel);
      const sourceStat = await folder.stat(rel);
      const paper = paperAt(rel);
      const how = readable(rel, paper);
      let pages;
      if (how === 'pdf') {
        progress('Reading the PDF');
        pages = (await pdfPages(paper.id, { signal })).pages;
      } else {
        const text = new TextDecoder().decode(await folder.read(rel)).slice(0, TEXT_CHARS);
        pages = [{ page: 1, text }];
      }
      let budget = TEXT_CHARS;
      const material = pages.map(pg => { const t = pg.text.slice(0, Math.max(0, budget)); budget -= t.length; return how === 'pdf' ? `[page ${pg.page}]\n${t}` : t; })
        .filter(t => t.trim()).join('\n\n');
      if (!material.trim()) return { title: `Summary of ${name}`, note: 'The file has no readable text', items: [] };
      const out = await complete(cfg, P.messagesOf(P.filesSummarise, { brief, rel, material }), { prompt: P.filesSummarise, signal, temperature: 0, json: true });
      const { points, summary } = keepFileSummary(jsonOf(out), pages);
      // The name is found now, so the proposal and the result can name it;
      // it is looked for again on write, so a file made since is never replaced.
      const target = await freeName(folder, join(parentOf(rel), `${name}.summary.md`));
      const where = pg => paper ? { paperId: paper.id, locator: { page: pg }, label: `${paper.label} · p. ${pg}` } : undefined;
      return {
        title: `Summary of ${name}`,
        prompt: promptRef(P.filesSummarise),
        note: points.length ? '' : 'Nothing in the reply could be found in the file',
        items: [
          ...points.map(p => ({ label: p.text, quote: p.quote, ...(how === 'pdf' ? { where: where(p.page) } : {}) })),
          ...(summary ? [{
            label: summary,
            detail: baseName(target),
            acceptLabel: 'Save beside the file',
            ...proposeFile({ target, source: rel, sourceStat, root: folder.root || folder.name,
              markdown: summaryMarkdown(name, summary, points, { model: cfg.model, paged: how === 'pdf' }) }),
          }] : []),
        ],
      };
    },
  },
]);
