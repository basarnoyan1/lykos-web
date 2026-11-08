// Journal styles for Lykos (Manuscript › View › Journal): a manuscript laid out as a journal prints its articles, to read it in that
// form before it is sent. Each publisher family has one first-page layout and its rules in journals.css; each journal adds what was
// measured from one of its published articles (journals/data.mjs, written by tools/build-journals.mjs from journals/sources: the trim
// and text block, the columns and their gap, the body size, the accent of its headings, the faces it uses), with the article's DOI and
// the date it was read. A journal no open-access article could be measured for has its family's layout, and says so (`measured: false`).
// No imports from Lykos: the app passes `kit` (lib/addons.mjs journalKitFor: esc, parts, journal, version, profile). No journal's logo,
// wordmark or other mark is drawn; the faces are open (SIL OFL) stand-ins for the journals' own (journals/fonts, with their licences).
import { JOURNALS, FAMILIES } from './data.mjs';

const typeLine = (kit, text) => text ? `<div class="nj-article-type">${kit.esc(text)}</div>` : '';
const title = kit => `<p class="nj-title" role="heading" aria-level="2">${kit.esc(kit.parts?.title || '')}</p>`;
const citation = (kit, label) => `<p class="nj-citation"><i>${kit.esc(label)}</i> · Unpublished manuscript${kit.version ? `, ${kit.esc(kit.version)}` : ''}</p>`;

// The first page of each layout: the slots (authors, correspondence, abstract, affiliations) are filled by Lykos with the manuscript's own
// parts. A layout without an affiliations slot has them at the page's foot.
const LAYOUTS = {
  // Neurology: the article type on a filled tag, the title across the page, the byline beside a narrow correspondence column, and the
  // abstract beside a narrow column for the supplement.
  aside: (kit, s) => `${typeLine(kit, s.articleType)}${title(kit)}<div class="nj-byline"><div class="nj-authors" data-slot="authors"></div><aside class="nj-correspondence" data-slot="correspondence"></aside></div>`
    + `${citation(kit, s.label)}<div class="nj-abstract-grid"><div data-slot="abstract"></div><aside class="nj-online"><div>Supplement</div><p>Supplementary material is listed in Lykos</p></aside></div>`,
  // the abstract in a shaded block across the page, under the title and byline (JNS, OUP)
  boxed: (kit, s) => `${typeLine(kit, s.articleType)}${title(kit)}<div class="nj-byline" data-slot="authors"></div><div class="nj-correspondence" data-slot="correspondence"></div>`
    + `${citation(kit, s.label)}<section class="nj-abstract-box"><p class="nj-abstract-head">${kit.esc(s.abstractHead || 'Abstract')}</p><div data-slot="abstract"></div></section>`,
  // the abstract between rules across the page (Springer, SAGE, Wiley, Wolters Kluwer, the open publishers)
  ruled: (kit, s) => `${typeLine(kit, s.articleType)}${title(kit)}<div class="nj-byline" data-slot="authors"></div><div class="nj-correspondence" data-slot="correspondence"></div>`
    + `${citation(kit, s.label)}<section class="nj-abstract-rule"><p class="nj-abstract-head">${kit.esc(s.abstractHead || 'Abstract')}</p><div data-slot="abstract"></div></section>`,
  // Elsevier: the affiliations under the byline, then a narrow "Article info" column beside the abstract, both under a rule
  info: (kit, s) => `${typeLine(kit, s.articleType)}${title(kit)}<div class="nj-byline" data-slot="authors"></div><div class="nj-affiliation-list" data-slot="affiliations"></div>`
    + `${citation(kit, s.label)}<div class="nj-info-grid"><aside class="nj-info"><p class="nj-abstract-head">Article info</p><div class="nj-correspondence" data-slot="correspondence"></div></aside>`
    + `<section><p class="nj-abstract-head">Abstract</p><div data-slot="abstract"></div></section></div>`,
  // MDPI: one column with a wide left margin that the title block hangs out into
  indent: (kit, s) => `${typeLine(kit, s.articleType)}${title(kit)}<div class="nj-byline" data-slot="authors"></div><div class="nj-correspondence" data-slot="correspondence"></div>`
    + `${citation(kit, s.label)}<section class="nj-abstract-indent"><p class="nj-abstract-head">${kit.esc(s.abstractHead || 'Abstract:')}</p><div data-slot="abstract"></div></section>`,
};

const face = list => list.map(f => (/\s/.test(f) && !/^'/.test(f) ? `'${f}'` : f)).join(', ');
/** The style Lykos registers for one journal of data.mjs, its family's defaults under its own measured values. */
function styleOf(j) {
  const fam = FAMILIES[j.family] || FAMILIES.open, layout = LAYOUTS[j.layout || fam.layout] || LAYOUTS.ruled;
  const serif = [...j.serif, 'Times New Roman', 'serif'], sans = [...j.sans, 'Helvetica', 'Arial', 'sans-serif'];
  const s = { articleType: j.articleType ?? fam.articleType ?? '', abstractHead: j.abstractHead ?? fam.abstractHead, label: j.label };
  const px = n => `${Math.round(n * 100) / 100}px`;
  return {
    id: j.id, label: j.label, journals: [j.label, ...j.aliases], family: j.family, profile: j.profile || null, references: j.references || null,
    page: { width: j.page.width, height: j.page.height, margin: j.page.margin }, columns: j.columns, gap: j.gap,
    vars: { serif: face(serif), sans: face(sans), 'head-font': face(j.headSerif ? serif : sans), 'title-font': face(j.titleSerif ? serif : sans), body: px(j.body), lead: String(j.lead), title: px(j.title),
      h2: px(Math.max(j.body + 1, j.body * 1.15)), h3: px(j.body), ref: px(Math.max(9, j.body - 1.5)), table: px(Math.max(9, j.body - 2)), cap: px(Math.max(9.5, j.body - 1)),
      small: px(Math.max(8, j.body - 3.5)), accent: j.accent || '#231f20', gap: px(j.gap), 'body-font': face(j.bodySans ? sans : serif) },
    stylesheet: 'journals.css',
    fonts: [...new Set([j.bodySans ? j.sans[0] : j.serif[0], j.sans[0]])].flatMap(f => [`400 14px '${f}'`, `700 14px '${f}'`, ...(j.serif.includes(f) ? [`italic 400 14px '${f}'`] : [])]),
    first: kit => layout(kit, s),
    footer: (kit, { n }) => `<span><i>${kit.esc(j.label)}</i> &nbsp;|&nbsp; Manuscript preview</span><span>${n}</span><span></span>`,
    measured: !!j.source?.checked, source: j.source,
  };
}

export const journalStyles = JOURNALS.map(styleOf);
