const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function matchesPaperText(paper, text) {
  const body = normalize(text), title = normalize(paper.title), doi = normalize(paper.doi);
  return Boolean((doi.length > 8 && body.includes(doi)) || (title.length > 20 && body.includes(title)));
}
export async function matchesRetrievedPdf(doc, paper) {
  let text = '';
  for (let n = 1; n <= Math.min(2, doc.numPages); n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    text += content.items.map(item => item.str || '').join(' ') + '\n';
  }
  return matchesPaperText(paper, text);
}
