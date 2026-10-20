import { wordCount } from './manuscript.mjs';

const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
const major = text => /^(abstract|introduction|background|methods|materials and methods|patients and methods|results|discussion|conclusions?|references|bibliography|acknowledg[e]?ments|appendix)$/i.test(clean(text).replace(/^\d+(?:\.\d+)*[.)]?\s+/, '').replace(/[:.]$/, ''));

// The editor's h2/h3 types are coarser than Word's outline levels. Keep the
// original paragraph/style level when present, including custom based-on styles.
function headingLevel(b, styles) {
  if (Number.isInteger(b.props?.outline) && b.props.outline >= 0 && b.props.outline < 9) return b.props.outline + 1;
  let id = b.styleId;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const style = styles?.byId?.[id];
    if (Number.isInteger(style?.para?.outline) && style.para.outline >= 0 && style.para.outline < 9) return style.para.outline + 1;
    const match = id.match(/^(?:Heading|Titre|Überschrift|berschrift|Título|Ttulo|Titolo|Encabezado)\s*([1-9])$/i);
    if (match) return Number(match[1]);
    id = style?.basedOn;
  }
  const numbered = clean(b.text).match(/^(\d+(?:\.\d+)+)[.)]?\s/);
  if (numbered) return numbered[1].split('.').length;
  return b.type === 'h3' ? 2 : 1;
}

/** Read-only outline: children, direct words and words including descendants. */
export function manuscriptOutline(document) {
  const blocks = document.blocks || [];
  const nodes = blocks.map((block, index) => ({ block, index })).filter(x => /^h[23]$/.test(x.block.type))
    .filter(x => clean(x.block.text))
    .filter(x => x.block.roleFixed !== 'title' && !/^(Title|Titre|Titel|Título|Titolo)$/i.test(x.block.styleId || ''))
    .map(x => ({ ...x, level: headingLevel(x.block, document.styles), children: [], ownWords: 0, words: 0 }));
  const abstract = nodes.findIndex(n => /^abstract$/i.test(clean(n.block.text)));
  if (abstract === 1 && nodes[0].index === blocks.findIndex(b => clean(b.text)) && clean(nodes[0].block.text).length > 120) nodes.shift();
  // Journal templates sometimes style Abstract one level above all main
  // sections. Introduction starts a new peer section, not an Abstract child.
  const abstractNode = nodes.find(n => /^abstract$/i.test(clean(n.block.text)));
  const introduction = nodes.findIndex(n => /^introduction$/i.test(clean(n.block.text)));
  if (abstractNode && introduction >= 0 && nodes[introduction].index > abstractNode.index && nodes[introduction].level > abstractNode.level) {
    const offset = nodes[introduction].level - abstractNode.level;
    for (const node of nodes.slice(introduction)) node.level = Math.max(abstractNode.level, node.level - offset);
  }
  // Imported journals can use different Word styles for peer main sections.
  // Once Introduction establishes the main level, keep Methods, Results and
  // Discussion as peers and shift each section's descendants with it.
  if (introduction >= 0) {
    const mainLevel = nodes[introduction].level;
    let shift = 0;
    for (const node of nodes.slice(introduction)) {
      if (major(node.block.text)) { shift = node.level - mainLevel; node.level = mainLevel; }
      else node.level = Math.max(mainLevel + 1, node.level - shift);
    }
  }
  // Some imports mark every section at the same level. Conventional main
  // sections provide a safe boundary; preserve mixed-level outlines as written.
  if (new Set(nodes.map(n => n.level)).size === 1 && nodes.filter(n => major(n.block.text)).length >= 2) {
    let parent = false;
    for (const node of nodes) {
      if (major(node.block.text)) { node.level = 1; parent = true; }
      else node.level = parent ? 2 : 1;
    }
  }
  const roots = [], stack = [];
  nodes.forEach((node, i) => {
    node.ownWords = blocks.slice(node.index + 1, nodes[i + 1]?.index ?? blocks.length).reduce((n, b) => n + wordCount(b.text || ''), 0);
    while (stack.length && stack.at(-1).level >= node.level) stack.pop();
    (stack.length ? stack.at(-1).children : roots).push(node);
    stack.push(node);
  });
  const total = node => (node.words = node.ownWords + node.children.reduce((n, child) => n + total(child), 0));
  roots.forEach(total);
  return { roots, nodes };
}
