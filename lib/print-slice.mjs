// An item's own part of its Package part's Word file, as the build printed it (plan §2, "Submission files, structured"): a table's caption,
// the table and the notes under it; a document's heading and what follows it. The item page's "As it prints" lays these blocks out with the
// Word reader (lib/docx-pages.mjs renderDocxPages `pick`), so a table or a generated document shows its print beside the app's own view.
// Pure: `blocks` are lib/docx.mjs parseDocx's.
const textOf = b => String(b?.text ?? (b?.runs || []).map(r => r.t || '').join('')).replace(/\s+/g, ' ').trim();
const isCaption = b => b?.type === 'p' && (/caption/i.test(b.styleId || '') || /^(Supplementary\s+)?(Table|Figure|Fig\.)\s+S?(\d+|\{\{seq:[^}]*\}\})\s*[.:|]/.test(textOf(b)));
const fold = t => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The blocks of `itemId` in a part's file: `items` the part's items in print order (`{ id, kind, title }`). A table or figure is found by its
 * caption (the k-th caption is the k-th captioned item); a document by a paragraph that reads its title. Null when the file does not hold it.
 */
export function itemSlice(blocks, items, itemId) {
  const list = blocks || [], at = items.findIndex(it => it.id === itemId), it = items[at];
  if (!it) return null;
  const captions = list.map((b, i) => (isCaption(b) ? i : -1)).filter(i => i >= 0);
  const docTitles = new Set(items.filter(x => x.kind === 'document').map(x => fold(x.title)).filter(Boolean));
  const endFrom = from => { let i = from; while (i < list.length && !isCaption(list[i]) && list[i].type !== 'figure' && !(i > from && docTitles.has(fold(textOf(list[i]))))) i++; return i; };
  let start = -1, end = -1;
  if (it.kind === 'document') {
    // a part that is this document alone: the whole file (the decision log's own Word file)
    if (items.length === 1) return trim(list);
    const want = fold(it.title);
    start = list.findIndex(b => b.type !== 'table' && fold(textOf(b)) === want);
    if (start < 0) return null;
    end = endFrom(start + 1);
  } else {
    const k = items.slice(0, at).filter(x => x.kind === 'table' || x.kind === 'figure').length;
    start = captions[k];
    if (start == null) return null;
    if (it.kind === 'figure') {
      // a figure's pictures stand before its caption, back to where the item before it ended
      let s = start;
      while (s > 0 && !isCaption(list[s - 1]) && list[s - 1].type !== 'table' && (list[s - 1].type === 'figure' || !textOf(list[s - 1]))) s--;
      return trim(list.slice(s, start + 1));
    }
    end = endFrom(start + 1);
  }
  return trim(list.slice(start, end));
}
// the slice starts its own first page: a page break it carried from the file is dropped there, and blank paragraphs at its end
function trim(bl) {
  const out = [...bl];
  while (out.length && out.at(-1).type === 'p' && !textOf(out.at(-1))) out.pop();
  while (out.length && out[0].type === 'p' && !textOf(out[0])) out.shift();
  if (out[0]?.props?.pageBreakBefore) out[0] = { ...out[0], props: { ...out[0].props, pageBreakBefore: false } };
  return out.length ? out : null;
}
