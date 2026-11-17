// A flow diagram as an editable PowerPoint file (.pptx), written from the diagram's layout (lib/prisma-flow.mjs prismaFlowScene),
// not from its picture: one slide of the diagram's size; each phase band, title strip and box a rectangle that holds its own text,
// a paragraph for each drawn line, so the lines break where the SVG breaks them; each arrow a connector with an arrowhead, joined
// to the two boxes it runs between where it meets them at the middle of a side, so it follows a box that is moved. One typeface;
// the sizes, weights, colours and line weights are the figure's tokens. For journals that ask for the study selection diagram
// as an editable flow diagram in Word or PowerPoint (The Lancet Neurology, November 2026).
//
// A .pptx is a ZIP of XML parts (ECMA-376 Part 1, PresentationML): the content types, the package relationships, the presentation,
// one slide master with its theme, one blank layout, the slide and the document properties. They are written here by hand and
// packed by lib/zip.mjs: no dependency. The file holds no clock, so the same diagram gives the same bytes.
import { zip } from './zip.mjs';

export const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', PKG = 'http://schemas.openxmlformats.org/package/2006';
const DOC = 'application/vnd.openxmlformats-officedocument';
const FIXED_TIME = new Date(2020, 0, 1, 0, 0, 0);   // the entries' time, as the submission bundle's inner files (lib/submission.mjs)
/** Text for an XML part: the entities, and no character XML 1.0 forbids. */
const esc = s => String(s ?? '').replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** A token colour (#rrggbb or #rgb) as PresentationML writes it. */
const hex = c => { const h = String(c || '').replace('#', ''); return (h.length === 3 ? h.replace(/./g, '$&$&') : /^[0-9a-f]{6}$/i.test(h) ? h : '000000').toUpperCase(); };
const GENERIC = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)$/i;
/**
 * The file's one typeface, from the tokens' font stack: Arial when the stack names it (every PowerPoint has it and its widths are
 * Helvetica's, which the house stack names first and Windows lacks), else the stack's first family.
 */
export function pptxTypeface(stack) {
  const names = String(stack || '').split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(x => x && !GENERIC.test(x));
  return names.find(x => /^arial$/i.test(x)) || names[0] || 'Arial';
}
/** A scene's typeface: the face a journal's look names (lib/journal-figure.mjs flowLook: the style's own, which its pages are set in), else the one of the tokens' stack. */
const faceOf = sc => sc.look?.face || pptxTypeface(sc.ts.font);

// The connection sites of a rectangle as PresentationML numbers them: from the top, counter-clockwise.
const SITE = { top: 0, left: 1, bottom: 2, right: 3 };
const siteAt = (b, side) => (side === 'top' ? [b.x + b.width / 2, b.y] : side === 'bottom' ? [b.x + b.width / 2, b.y + b.height]
  : side === 'left' ? [b.x, b.y + b.height / 2] : [b.x + b.width, b.y + b.height / 2]);

/** The slide: the scene's bands, title strips, arrows and boxes as shapes, in its drawing order. */
function slideXml(sc) {
  const t = sc.ts, emu = t.unit === 'px' ? 9525 : 12700, pt = t.unit === 'px' ? 0.75 : 1, E = v => Math.round(v * emu);
  const face = esc(faceOf(sc)), ink = hex(t.color.ink), look = sc.look || null;
  const size = Math.round(t.size.label * pt * 100), lead = Math.round(sc.lh * pt * 100);   // hundredths of a point
  const font = `<a:solidFill><a:srgbClr val="${ink}"/></a:solidFill><a:latin typeface="${face}"/><a:ea typeface="${face}"/><a:cs typeface="${face}"/>`;
  // a paragraph for a drawn line, centred, on the diagram's own line pitch
  const spacing = `<a:lnSpc><a:spcPts val="${lead}"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft>`;
  // a line of a journal's look (it has its own place): flush left, hung so that a line turned or typed under it begins where its text
  // begins; its count stands before its text, behind as many figure spaces as it is shorter than the longest count of its list, so the
  // counts end together with no tab stop (PowerPoint measures a tab from the box and LibreOffice from the paragraph's indent)
  const placed = (l, inset) => `<a:pPr marL="${E(l.x - inset)}" indent="${l.n == null ? 0 : E(l.at - inset) - E(l.x - inset)}" algn="l">${spacing}</a:pPr>`;
  const para = (l, inset = 0) => `<a:p>${l.x == null ? `<a:pPr algn="ctr">${spacing}</a:pPr>` : placed(l, inset)}`
    + `<a:r><a:rPr sz="${size}" b="${l.bold && t.weight.head >= 600 ? 1 : 0}">${font}</a:rPr><a:t>${esc(l.x != null && l.n != null ? `${'\u2007'.repeat(l.pad || 0)}${l.n} ${l.t}` : l.t)}</a:t></a:r></a:p>`;
  // the text of a shape: centred in it (a band, a title strip) or `top` under its upper edge (a box, as the SVG sets its first line);
  // no side inset, so a line the SVG fitted between its paddings is never broken again, and text typed in later still wraps in the box
  const body = (lines, top = null, left = 0) => `<p:txBody><a:bodyPr wrap="square" lIns="${E(left)}" tIns="${top == null ? 0 : E(top)}" rIns="0" bIns="0" anchor="${top == null ? 'ctr' : 't'}"><a:noAutofit/></a:bodyPr><a:lstStyle/>`
    + `${lines.length ? lines.map(l => para(l, left)).join('') : `<a:p><a:pPr algn="ctr"/><a:endParaRPr sz="${size}">${font}</a:endParaRPr></a:p>`}</p:txBody>`;
  const xfrm = (x, y, w, h, attrs = '') => `<a:xfrm${attrs}><a:off x="${E(x)}" y="${E(y)}"/><a:ext cx="${E(w)}" cy="${E(h)}"/></a:xfrm>`;
  const fill = c => `<a:solidFill><a:srgbClr val="${hex(c)}"/></a:solidFill>`;
  const stroke = (w, end = '') => `<a:ln w="${E(w)}" cap="flat">${fill(t.color.ink)}<a:miter lim="800000"/>${end}</a:ln>`;
  // a rectangle, its corners rounded by a profile's radius (PRISMA 2020's bands and titles). `turned`: the whole shape a quarter turn
  // back, so its text reads bottom to top; it is placed by its frame before the turn, the sides swapped about the same middle. The shape
  // is turned, not its text (bodyPr vert): a turn is the plainer thing for a reader of the file to honour. PowerPoint 16 reads the band
  // turned and LibreOffice draws its label up the band; Quick Look's thumbnail draws it across the band either way (10 Nov 2026).
  const rect = (x, radius, turned = false) => { const w = x.w ?? x.width, h = x.h ?? x.height;
    return `${turned ? xfrm(x.x + w / 2 - h / 2, x.y + h / 2 - w / 2, h, w, ' rot="16200000"') : xfrm(x.x, x.y, w, h)}<a:prstGeom prst="${radius ? 'roundRect' : 'rect'}"><a:avLst>`
      + `${radius ? `<a:gd name="adj" fmla="val ${Math.min(50000, Math.round(radius / Math.min(w, h) * 100000))}"/>` : ''}</a:avLst></a:prstGeom>`; };
  const shape = (id, name, spPr, txBody) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${spPr}</p:spPr>${txBody}</p:sp>`;

  // every shape's id before any is written: an arrow names the boxes it joins, which are drawn after it
  let next = 2;   // 1 is the slide's own tree
  const items = [...sc.bands.map(x => ['band', x]), ...sc.titles.map(x => ['title', x]), ...sc.arrows.map(x => ['arrow', x]), ...sc.boxes.map(x => ['box', x])].map(([kind, x]) => ({ kind, x, id: next++ }));
  const boxes = new Map(items.filter(i => i.kind === 'box').map(i => [i.x.id, i]));
  // an end is joined to its box only where it stands at the middle of the box's side (within the line's own gap): PowerPoint and
  // LibreOffice lead a joined end to that point, so an arrow that meets a tall box off its middle stays a free line and keeps its place
  const reach = t.line.box + 1;
  const join = (tag, a, end, [px, py]) => {
    const it = boxes.get(end ? a.to : a.from), side = a.sides?.[end];
    if (!it || !(side in SITE)) return '';
    const [sx, sy] = siteAt(it.x, side);
    return Math.hypot(sx - px, sy - py) <= reach ? `<a:${tag} id="${it.id}" idx="${SITE[side]}"/>` : '';
  };
  // the arrowhead: PresentationML sizes it by the line (2, 3 or 5 times its weight, a line under 2 pt counted as 2 pt); the nearest to the figure's own
  const per = Math.max(2, t.line.arrow * pt), sized = v => (v < 2.5 ? 'sm' : v < 4 ? 'med' : 'lg'), head = sized(t.size.label * pt * 0.7 / per);
  // a journal's look gives the head's own width and length
  const headW = look ? sized(look.arrow.head[0] * pt / per) : head, headL = look ? sized(look.arrow.head[1] * pt / per) : head;
  const arrow = (id, a) => {
    const pts = a.points || [[a.x1, a.y1], [a.x2, a.y2]], [x1, y1] = pts[0], [x2, y2] = pts.at(-1);
    const left = Math.min(x1, x2), top = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    const flips = `${x2 < x1 ? ' flipH="1"' : ''}${y2 < y1 ? ' flipV="1"' : ''}`;
    let prst = 'straightConnector1', place = xfrm(left, top, w, h, flips);
    if (pts.length === 3 && w && h) {
      prst = 'bentConnector2';   // one corner: across, then down
      // an elbow that leaves its box downwards or upwards is the same connector turned a quarter (and mirrored when it then runs the
      // other way); a turned shape is placed by its frame before the turn, the sides swapped about the same middle
      if (pts[1][0] === x1) place = xfrm(left + w / 2 - h / 2, top + h / 2 - w / 2, h, w, ` rot="${y2 > y1 ? 5400000 : 16200000}"${(y2 > y1) === (x2 > x1) ? ' flipV="1"' : ''}`);
    }
    const name = `${boxes.get(a.from)?.x.aria || 'Arrow'}${boxes.get(a.to) ? ` to ${boxes.get(a.to).x.aria}` : ''}`;
    return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvCxnSpPr>${join('stCxn', a, 0, pts[0])}${join('endCxn', a, 1, pts.at(-1))}</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr>`
      + `<p:spPr>${place}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${stroke(t.line.arrow, `<a:tailEnd type="triangle" w="${headW}" len="${headL}"/>`)}</p:spPr></p:cxnSp>`;
  };
  const none = '<a:ln><a:noFill/></a:ln>', radius = t.line.radius || 0;
  const draw = ({ kind, x, id }) => (kind === 'arrow' ? arrow(id, x)
    // a phase band reads bottom to top, as the statement prints it
    : kind === 'band' ? shape(id, `${x.label} phase`, `${rect(x, radius, true)}${fill(t.color.band)}${none}`, body([{ t: x.label, bold: true }]))
    : kind === 'title' ? shape(id, x.lines.join(' '), `${rect(x, radius)}${fill(t.color.title || t.color.band)}${radius ? stroke(t.line.box) : none}`, body(x.lines.map(l => ({ t: l, bold: true }))))
    : shape(id, x.aria || x.id, `${rect(x, 0)}${fill(t.color.page)}${stroke(t.line.box)}`, body(x.lines, sc.padY, look ? look.box.padX : 0)));
  return `${HEAD}<p:sld ${NS}><p:cSld${sc.name || sc.title ? ` name="${esc(sc.title || sc.name)}"` : ''}><p:spTree>${TREE}${items.map(draw).join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

// The empty tree every slide, layout and master starts with.
const TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const rels = list => `${HEAD}<Relationships xmlns="${PKG}/relationships">${list.map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${type.includes('/') ? type : `${REL}/${type}`}" Target="${target}"/>`).join('')}</Relationships>`;

/** The theme a presentation must carry: the figure's ink, page and band as its colours (monochrome, as the house style), the one typeface, plain fills and lines. */
function themeXml(t, face) {
  const c = v => `<a:srgbClr val="${hex(v)}"/>`, ink = c(t.color.ink), band = c(t.color.band);
  const three = x => x.repeat(3), plain = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>', fonts = `<a:latin typeface="${face}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  return `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Flow diagram"><a:themeElements>`
    + `<a:clrScheme name="Flow diagram"><a:dk1>${ink}</a:dk1><a:lt1>${c(t.color.page)}</a:lt1><a:dk2>${ink}</a:dk2><a:lt2>${band}</a:lt2>${[1, 2, 3, 4, 5, 6].map(i => `<a:accent${i}>${i % 2 ? ink : band}</a:accent${i}>`).join('')}<a:hlink>${ink}</a:hlink><a:folHlink>${ink}</a:folHlink></a:clrScheme>`
    + `<a:fontScheme name="Flow diagram"><a:majorFont>${fonts}</a:majorFont><a:minorFont>${fonts}</a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="Flow diagram"><a:fillStyleLst>${three(plain)}</a:fillStyleLst><a:lnStyleLst>${three(`<a:ln w="6350">${plain}</a:ln>`)}</a:lnStyleLst>`
    + `<a:effectStyleLst>${three('<a:effectStyle><a:effectLst/></a:effectStyle>')}</a:effectStyleLst><a:bgFillStyleLst>${three(plain)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

/** The parts of the package, as { name, data } entries in the order they are packed. */
export function flowPptxParts(sc) {
  const t = sc.ts, emu = t.unit === 'px' ? 9525 : 12700, face = esc(faceOf(sc)), title = esc(sc.title || sc.name || 'Flow diagram');
  // a slide is between 1 and 56 inches a side
  const side = v => Math.min(51206400, Math.max(914400, Math.round(v * emu)));
  const override = (part, type) => `<Override PartName="/${part}" ContentType="${DOC}.${type}+xml"/>`;
  const map = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';
  return [
    { name: '[Content_Types].xml', data: `${HEAD}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
      + override('ppt/presentation.xml', 'presentationml.presentation.main') + override('ppt/slideMasters/slideMaster1.xml', 'presentationml.slideMaster') + override('ppt/slideLayouts/slideLayout1.xml', 'presentationml.slideLayout')
      + override('ppt/slides/slide1.xml', 'presentationml.slide') + override('ppt/theme/theme1.xml', 'theme') + override('docProps/app.xml', 'extended-properties')
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: rels([['officeDocument', 'ppt/presentation.xml'], [`${PKG}/relationships/metadata/core-properties`, 'docProps/core.xml'], ['extended-properties', 'docProps/app.xml']]) },
    { name: 'docProps/app.xml', data: `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Lykos</Application><Slides>1</Slides></Properties>` },
    { name: 'docProps/core.xml', data: `${HEAD}<cp:coreProperties xmlns:cp="${PKG}/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></cp:coreProperties>` },
    { name: 'ppt/presentation.xml', data: `${HEAD}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>`
      + `<p:sldSz cx="${side(sc.w)}" cy="${side(sc.h)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: rels([['slideMaster', 'slideMasters/slideMaster1.xml'], ['slide', 'slides/slide1.xml'], ['theme', 'theme/theme1.xml']]) },
    { name: 'ppt/theme/theme1.xml', data: themeXml(t, face) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex(t.color.page)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${TREE}</p:spTree></p:cSld>`
      + `<p:clrMap ${map}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>` },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([['slideLayout', '../slideLayouts/slideLayout1.xml'], ['theme', '../theme/theme1.xml']]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['slideMaster', '../slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/slides/slide1.xml', data: slideXml(sc) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: rels([['slideLayout', '../slideLayouts/slideLayout1.xml']]) },
  ];
}

/**
 * The scene as a .pptx: its bytes. `spell` rewrites every drawn text (the project's spelling, as the app's own SVG copy is respelled:
 * lib/spelling.mjs toAmerican), the layout unchanged.
 */
export async function flowPptx(scene, { spell = null } = {}) {
  const sc = !spell ? scene : { ...scene, bands: scene.bands.map(x => ({ ...x, label: spell(x.label) })), titles: scene.titles.map(x => ({ ...x, lines: x.lines.map(l => spell(l)) })),
    boxes: scene.boxes.map(x => ({ ...x, lines: x.lines.map(l => ({ ...l, t: spell(l.t) })) })) };
  return new Uint8Array(await (await zip(flowPptxParts(sc), { date: FIXED_TIME })).arrayBuffer());
}
