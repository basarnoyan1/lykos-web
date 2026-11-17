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

// Brain and Spine's masthead as the journal prints it: the citation line, the Elsevier mark, the journal's banner with the ScienceDirect line and
// its homepage, the society mark (journals/logos, drawn in the owner's own copy; the hosted build leaves them out), and a heavy rule under.
const MASTHEADS = {
  'brain-spine': { home: 'www.journals.elsevier.com/brain-and-spine', logo: 'eans-eurospine', alt: 'EANS and EUROSPINE' },
  'j-clin-neurosci': { home: 'www.journals.elsevier.com/journal-of-clinical-neuroscience', logo: 'cover-j-clin-neurosci', alt: 'Journal of Clinical Neuroscience cover' },
};
const masthead = (kit, s, m = MASTHEADS[s.id]) => `<header class="nj-masthead"><p class="nj-mast-cite">${kit.esc(s.label)} · Unpublished manuscript${kit.version ? `, ${kit.esc(kit.version)}` : ''}</p>`
  + `<div class="nj-mast-row"><span class="nj-mast-elsevier" role="img" aria-label="Elsevier"></span><div class="nj-mast-banner"><span>Contents lists available at <b>ScienceDirect</b></span>`
  + `<strong>${kit.esc(s.label)}</strong><span>journal homepage: <b>${m.home}</b></span></div><span class="nj-mast-society" data-logo="${m.logo}" role="img" aria-label="${m.alt}"></span></div></header>`;

// The first page of each layout: the slots (authors, correspondence, abstract, affiliations) are filled by Lykos with the manuscript's own
// parts. A layout without an affiliations slot has them at the page's foot.
const LAYOUTS = {
  // the abstract in a shaded block across the page, under the title and byline (JNS, OUP)
  boxed: (kit, s) => `${typeLine(kit, s.articleType)}${title(kit)}<div class="nj-byline" data-slot="authors"></div><div class="nj-correspondence" data-slot="correspondence"></div>`
    + `${citation(kit, s.label)}<section class="nj-abstract-box"><p class="nj-abstract-head">${kit.esc(s.abstractHead || 'Abstract')}</p><div data-slot="abstract"></div></section>`,
  // the abstract between rules across the page (Springer, SAGE, Wiley, Wolters Kluwer, the open publishers)
  ruled: (kit, s) => `${typeLine(kit, s.articleType)}${title(kit)}<div class="nj-byline" data-slot="authors"></div><div class="nj-correspondence" data-slot="correspondence"></div>`
    + `${citation(kit, s.label)}<section class="nj-abstract-rule"><p class="nj-abstract-head">${kit.esc(s.abstractHead || 'Abstract')}</p><div data-slot="abstract"></div></section>`,
  // Elsevier: the affiliations under the byline, then a narrow "Article info" column (the keywords; the correspondence is a footnote at the page's foot) beside the abstract, between two rules
  info: (kit, s) => `${MASTHEADS[s.id] ? masthead(kit, s) : ''}${typeLine(kit, s.articleType)}${title(kit)}<div class="nj-byline" data-slot="authors"></div><div class="nj-affiliation-list" data-slot="affiliations"></div>`
    + `<div class="nj-info-grid"><aside class="nj-info"><p class="nj-abstract-head">Article info</p><div class="nj-keywords" data-slot="keywords"></div></aside>`
    + `<section><p class="nj-abstract-head">Abstract</p><div data-slot="abstract"></div></section></div>`,
  // OUP (Neuro-Oncology): a block in the accent holding the title and its citation line, the byline under it, the abstract in a shaded box
  banner: (kit, s) => `<header class="nj-banner">${citation(kit, s.label)}${title(kit)}</header><div class="nj-byline" data-slot="authors"></div><div class="nj-correspondence" data-slot="correspondence"></div>`
    + `<section class="nj-abstract-box"><p class="nj-abstract-head">${kit.esc(s.abstractHead || 'Abstract')}</p><div data-slot="abstract"></div></section>`,
  // Springer Nature (Journal of Neuro-Oncology): the citation line at the top, the article type on a grey bar, the title and byline, the abstract without rules
  plain: (kit, s) => `${citation(kit, s.label)}${typeLine(kit, s.articleType)}${title(kit)}<div class="nj-byline" data-slot="authors"></div><div class="nj-correspondence" data-slot="correspondence"></div>`
    + `<section class="nj-abstract-plain"><p class="nj-abstract-head">Abstract</p><div data-slot="abstract"></div></section><div class="nj-keywords" data-slot="keywords"></div>`,
  // Int J Spine Surg: everything centered under the citation line, the affiliations under the byline, the abstract in the sans
  centered: (kit, s) => `${citation(kit, s.label)}${title(kit)}<div class="nj-byline" data-slot="authors"></div><div class="nj-affiliation-list" data-slot="affiliations"></div>`
    + `<section class="nj-abstract-plain"><p class="nj-abstract-head">Abstract</p><div data-slot="abstract"></div></section><div class="nj-keywords" data-slot="keywords"></div>`,
  // Taylor & Francis: the journal's name in capitals and the publisher's mark over a rule, the article type with "Open Access", a navy title, the affiliations, then the abstract in a grey block beside a narrow keywords column (PMC12090375, batch b6)
  tandf: (kit, s) => `<header class="nj-tf-head"><span><b>${kit.esc(s.label)}</b><br>Unpublished manuscript${kit.version ? `, ${kit.esc(kit.version)}` : ''}</span><span class="nj-tf-mark" role="img" aria-label="Taylor & Francis"></span></header>`
    + `${typeLine(kit, s.articleType)}${title(kit)}<div class="nj-byline" data-slot="authors"></div><div class="nj-affiliation-list" data-slot="affiliations"></div>`
    + `<div class="nj-tf-grid"><section class="nj-abstract-tf"><p class="nj-abstract-head">Abstract</p><div data-slot="abstract"></div></section><aside class="nj-tf-side"><p class="nj-abstract-head">Keywords</p><div class="nj-keywords" data-slot="keywords"></div></aside></div>`,
  // Wolters Kluwer, Congress of Neurological Surgeons (Neurosurgery PMC10079356, Operative Neurosurgery PMC13652121): a coloured bar with the article type, an OPEN tag, a bold serif title, a bold sans byline, the abstract in a grey block, the keywords and the citation line
  cns: (kit, s) => `${typeLine(kit, s.articleType || 'Research')}<span class="nj-cns-open">OPEN</span>${title(kit)}<div class="nj-byline" data-slot="authors"></div><div class="nj-affiliation-list" data-slot="affiliations"></div>`
    + `<div class="nj-correspondence" data-slot="correspondence"></div><section class="nj-abstract-cns"><div data-slot="abstract"></div><div class="nj-keywords" data-slot="keywords"></div></section>`
    + `<p class="nj-cns-cite"><i>${kit.esc(s.label)}</i> · Unpublished manuscript${kit.version ? `, ${kit.esc(kit.version)}` : ''}</p>`,
  // SAGE (Global Spine Journal PMC13525103, Proc Inst Mech Eng H PMC13578653): the article type and a bold sans title on the left, the citation block and the publisher's mark on the right, a bold byline across, a run-in abstract, the keywords, then the affiliations
  sage: (kit, s) => `<div class="nj-sg-top"><div><p class="nj-sg-type">${kit.esc(s.articleType || 'Original research')}</p>${title(kit)}</div><aside class="nj-sg-cite"><i>${kit.esc(s.label)}</i><span>Unpublished manuscript${kit.version ? `, ${kit.esc(kit.version)}` : ''}</span><span class="nj-sg-mark" role="img" aria-label="Sage"></span></aside></div>`
    + `<div class="nj-byline" data-slot="authors"></div><section class="nj-abstract-sg"><p class="nj-abstract-head">Abstract</p><div data-slot="abstract"></div></section><div class="nj-keywords" data-slot="keywords"></div><div class="nj-affiliation-list" data-slot="affiliations"></div><div class="nj-correspondence" data-slot="correspondence"></div>`,
  // The Lancet journals (Lancet Neurol 2025;24:1005, publisher PDF): a bold sans title and an italic sans byline across the text block, the Summary (the abstract with its
  // own run-in heads) and, in the margin column beside it, where the journal prints its citation line, a line that says what the preview is, then the affiliations and the
  // correspondence; the body follows in two columns. The section label ("Articles") is in the page's head (PRINTS.lancet.header). The margin column is drawn into the
  // page's outer margin (journals.css), not in the text block.
  lancet: (kit, s) => `${title(kit)}<div class="nj-byline" data-slot="authors"></div>`
    + `<section class="nj-lc-summary"><p class="nj-abstract-head">${kit.esc(s.abstractHead || 'Summary')}</p><div data-slot="abstract"></div>`
    + `<aside class="nj-lc-margin"><p class="nj-citation nj-lc-cite">Preview of a manuscript that is not published${kit.version ? ` (${kit.esc(kit.version)})` : ''}</p>`
    + `<div class="nj-affiliation-list" data-slot="affiliations"></div><div class="nj-correspondence" data-slot="correspondence"></div></aside></section>`,
};

// How a family's journals print the text, which Lykos's preview reads from the style (lib/journal-text.mjs; display only, the manuscript is not changed):
// sections set in a panel, citation numbers after the mark that follows them, the decimal point at mid-line, the correspondence label, and how a table is set.
// The Lancet journals' Information for Authors and Lancet Neurol 2020;19:491 (Vitek).
// `table` is how the family sets a table (Lykos lib/journal-table.mjs; the look is in journals.css, "The Lancet journals' tables"), read on 10 Nov 2026 from
// the publisher PDFs of Lancet Neurol 2020;19:491 (tables 1 and 2, measured), 2017;16:610 (table 3, which runs over a page), 2019;18:653 (tables 1 and 2;
// table 1 turned), 2018;17:609 (table 3), Lancet Psychiatry 2020;7:851 (table 1) and Lancet 2020;395:1973 (table 2): the title under the legend at the foot
// of the panel; column widths that follow the content (values on one line, the row labels and the heads broken); a panel as wide as a text column with the
// margin column when the heads and row labels set there in two lines at most, else as wide as the text block with the margin column, and a table too wide
// for that turned; numbers aligned on the decimal point; a head with no spanning head over it in the top row; "(Table 3 continues on next page)" at the foot
// of a part and "(Continued from previous page)" under the heads of the next.
// Also read on 10 Nov 2026 from Lancet Neurol 2025;24:1005, 2024;23:973 and 2024;23:344 (publisher PDFs): facing pages with the margin column on the outside (`mirror`);
// the panel across the text block at the head of the page after the first (`panelAt`); a figure or table at the head of a page, the text under it (`floats`); the end
// matter from Contributors on set small (`backFrom`); a reference's journal in italic and its volume in bold (`referenceMarks`); the head of every page (a bar, the
// section label and a rule: `header`) and its foot (`footer`), which says what the preview is where the journal prints its address, volume and issue.
// A panel is never cut (`panelWhole`), and a section headed "Panel: ..." or "Panel 2: ..." is one (`panelLabel`), read on 11 Nov 2026 from the publisher PDFs of
// Lancet Neurol 2011;10:510 (panel 1 across the text block at the head of the page, in two columns) and 515 (panel 2 at the head of a column), 2011;10:318
// and 2010;9:1171 (at the head of a column), 2014;13:882 (at the foot of a column), 2017;16:611 and 2020;19:492 (Research in context across the head of
// the second page): each whole, in the tint, one column wide or across the text block, the text going on beside and under it. Lykos sets one whole where
// it stands when the column has the room, else at the head of the next column, and across the text block at the head of a page when it is longer than a
// column; only one longer than a page is cut.
// `figure` is how the family draws a figure (Lykos lib/journal-figure.mjs; a study-selection flow diagram by lib/journal-flow.mjs), measured on 10 Nov 2026
// from the drawing of the publisher PDFs: the trial profiles of Lancet Neurol 2020;19:493 (figure 2), 2017;16:613 (figure 3), 2014;13:876, 2011;10:310,
// 2011;10:511 and 2010;9:1165 (figures 1), and the study-selection figures of Lancet Neurol 2019;18:657, Lancet Psychiatry 2020;7:855 and Lancet
// 2020;395:1976 (figures 1). The same in all nine: the journal's sans (Shaker 2 Lancet; the style's own sans stands in) regular at 6.5 pt on 7.8 pt,
// black; boxes outlined at 0.5 pt, square, no tint, a one-line box 15.1 pt high with its text 4.9 pt from the left edge; each line with its count
// first and its text flush left, what a box lists under it with the counts in a column, a turned line under its own text; no phase label, header
// bar or band; a 0.5 pt line down from box to box (12 pt between two boxes) with a filled arrowhead 5 pt wide and 4.3 pt long, and what leaves the
// flow in a box 12 pt right of that line, between the two boxes, 4 to 5 pt clear of each. Boxes of a column share a width (125 and 155 pt in
// 2019;18:657). A count of five figures or more has a thin space (20 013; 3559 has none). The figure stands in a white panel outlined at 0.25 pt
// in the journal's red, "Figure 1:" in bold italic and its title in bold 7 pt under it (journals.css, .nj-figure-box).
// `figure.chart` is how the family draws a chart (Lykos lib/journal-charts.mjs), measured on 10 Nov 2026 from the drawing of publisher PDFs (PubMed Central's
// open-access set; type, colours and line weights read from each page's own operators). Forest plots: Lancet 2020;395:1978 (figure 2) and Lancet Psychiatry
// 2020;7:860 (figure 2), seen the same on Lancet Psychiatry 2021;8:807 and Lancet Neurol 2018;17:615: heads, group names and totals in bold, the rest regular,
// all 6.5 pt; a 0.5 pt rule under the heads; rows 9.3 pt apart (10.2 in the second) with an empty row before a group; a square in a 35% tint of the journal's
// slate (#b2bbc0) whose area follows the weight (side 4.65 x the root of the weight in per cent; 12.5 pt the largest), a black mark 4.2 pt across at its centre,
// a 0.5 pt interval with no caps and a filled arrowhead 4.3 by 5 pt where it is cut; a total as an open diamond 7.5 pt high in a 0.5 pt line; the line of no
// effect solid from the rule to the axis; a 0.5 pt axis under the plot with 3.4 pt ticks; estimates flush left under their head, weights on the decimal point.
// A bubble plot of a meta-regression: Lancet 2020;395:1980 (figure 3A): axes at the left and the foot only, 0.5 pt, ticks 3.2 pt outwards, no grid and no
// frame; circles open in a 0.74 pt line of the journal's red (#b30838; 3 to 23 pt across, the area by the weight), the fitted line solid and its interval
// as two dashed lines (4.4 on, 2.2 off); panel letters bold 8.5 pt. Lancet Respir Med 2022;10:684 (figure 4) draws the fitted line in the journal's slate
// (#4e6b75) over its interval as a band in a 14% tint of it (#e6eaec): `fit.band` is that, and a style that declares no band has the dashed lines.
// A funnel plot: Lancet Infect Dis 2007;7:478 (figure 6): points 3.9 pt across in a tint
// (#9dacd4) with a 0.5 pt line of the journal's blue (#00549e), a solid line at the pooled value. Risk of bias: Lancet Glob Health 2021;9:e427 (figure 4;
// circles 9 pt across with no outline in green, yellow and the journal's red, in a grid of 0.5 pt rules 15.1 pt by 22.4 pt) and Lancet Psychiatry 2023;10:785
// (figure 3; bars 11.3 pt high, 15.8 pt apart, in 35% tints with a 0.5 pt outline, key swatches 6.9 by 4.3 pt). Series colours and their order (blue for the
// control, red for the treatment, then green, cyan, purple): Lancet Neurol 2011;10:312 and 512, 2014;13:878, 2017;16:615 and 2020;19:498, Lancet 2021;397:1629.
// A CMYK ink is given as the RGB the journal's own RGB pages give it (red, blue, cyan, green, slate), the yellow and the three bar tints as poppler renders them.
// A forest plot longer than the page (`figure.continues`): the rows of the journal's longest printed forest plots stand 9.25 pt apart (Lancet 2020;395:1978,
// figure 2, 44 rows in a panel 468 pt deep; 9.6 pt in figure 4 and 10.7 pt in figures 5 and 6 of the same article, 10.2 pt in Lancet Psychiatry 2020;7:860
// and Lancet Neurol 2018;17:615), always 6.5 pt type with one empty row before a group, measured on 11 Nov 2026: a long plot is not set smaller, so `forest.row`
// is the closest its rows come. None of the printed plots at hand runs over a page; one that does is carried on in parts with the words the journal prints
// where a table runs over a page ("(Table 1 continues on next page)", "(Continued from previous page)": Lancet 2020;395:1976 and 1977, Lancet Neurol 2017;16:617),
// the figure's name in place of the table's, the heads and the axis on every part and the legend under the last.
// The columns of the page an Article ends on are set to one length (`balanceLast`), read on 11 Nov 2026 from the publisher PDFs: the reference list ends in two
// columns that stop on the same line or a line apart, well short of the page's foot, on Lancet Neurol 2020;19:501 (four references, six lines a column), 2017;16:619
// (54 lines each) and 2011;10:519 (19 and 18 lines). Lykos flows what the last page's columns hold into columns of the least height that holds it.
const PRINTS = {
  lancet: { panels: ['Research in context'], panelLabel: 'Panel', panelWhole: true, citeAfterPunctuation: true, decimalMark: '\u00b7', correspondenceLabel: 'Correspondence to:',
    mirror: true, panelAt: 'page-top', floats: 'page-top', backFrom: ['Contributors', 'Declaration of interests', 'Data sharing', 'Acknowledgments', 'Acknowledgements'],
    referenceMarks: { journal: 'italic', volume: 'bold' }, balanceLast: true,
    header: (kit, at, s) => `<span class="nj-lc-bar"></span><span class="nj-lc-section">${kit.esc(s.articleType || 'Articles')}</span><span class="nj-lc-rule"></span>`,
    footer: (kit, { n }) => `<span>Manuscript preview, not published${kit.version ? ` <b>${kit.esc(kit.version)}</b>` : ''}</span><span><b>${n}</b></span>`,
    table: { title: 'below', widths: 'content', measures: [{ id: 'column', lines: 2 }, { id: 'full' }], turn: true, numbers: 'decimal', raiseHeads: true,
      continues: { next: '({table} continues on next page)', previous: '(Continued from previous page)' } },
    figure: { face: 'sans', size: 6.5, lead: 7.8, ink: '#000000', line: 0.5, digit: 0.497, thousands: { from: 10000, mark: '\u2009' },
      continues: { next: '({figure} continues on next page)', previous: '(Continued from previous page)' },
      flow: { box: { main: 125, side: 155, padX: 4.9, padY: 3.65 }, gap: { row: 12, side: 4.5, branch: 12, column: 12, edge: 6 }, arrow: { head: [5, 4.3] } },
      chart: { widths: { column: 304.5, page: 529.8 }, inset: 5.9, letter: 8.5, series: ['#00549e', '#b30838', '#6cb33f', '#009fc2', '#850c70', '#ee3124', '#4e6b75'],
        axis: { tick: 3.2, label: 1.3, title: 3.4 },
        forest: { row: 9.3, square: { fill: '#b2bbc0', max: 12.5, mark: 4.2 }, diamond: 7.5, arrow: [4.3, 5] },
        scatter: { point: { color: '#b30838', line: 0.74, min: 1.4, max: 11.5 }, fit: { color: '#4e6b75', band: '#e6eaec', dash: [4.4, 2.2] }, ref: [1.4, 1.4] },
        funnel: { point: { color: '#00549e', fill: '#9dacd4', size: 3.9 } },
        rob: { good: '#6cb33f', unclear: '#fddd04', bad: '#b30838', mark: 9, row: 15.1, column: 22.4, key: [6.9, 4.3],
          bar: { height: 11.3, pitch: 15.8, good: '#c6e5a6', unclear: '#feed7e', bad: '#e3979a' } } } } },
};

const face = list => list.map(f => (/\s/.test(f) && !/^'/.test(f) ? `'${f}'` : f)).join(', ');
/** The style Lykos registers for one journal of data.mjs, its family's defaults under its own measured values. */
function styleOf(j) {
  const fam = FAMILIES[j.family] || FAMILIES.open, layout = LAYOUTS[j.layout || fam.layout] || LAYOUTS.ruled;
  const serif = [...j.serif, 'Times New Roman', 'serif'], sans = [...j.sans, 'Helvetica', 'Arial', 'sans-serif'];
  const s = { id: j.id, articleType: j.articleType ?? fam.articleType ?? '', abstractHead: j.abstractHead ?? fam.abstractHead, label: j.label };
  const px = n => `${Math.round(n * 100) / 100}px`, prints = PRINTS[j.family] || {};
  return {
    id: j.id, label: j.label, affiliationsAt: j.affiliationsAt || null, correspondenceAt: j.family === 'elsevier' ? 'foot' : null, affiliationsNote: j.affiliationsAt === 'end' ? 'All author affiliations are listed at the end of the article' : null, journals: [j.label, ...j.aliases], family: j.family, profile: j.profile || null, references: j.references || null,
    page: { width: j.page.width, height: j.page.height, margin: j.page.margin }, columns: j.columns, gap: j.gap,
    vars: { serif: face(serif), sans: face(sans), 'head-font': face(j.headSerif ? serif : sans), 'title-font': face(j.titleSerif ? serif : sans), body: px(j.body), lead: String(j.lead), title: px(j.title),
      h2: px(Math.max(j.body + 1, j.body * 1.15)), h3: px(j.body), ref: px(Math.max(9, j.body - 1.5)), table: px(Math.max(9, j.body - 2)), cap: px(Math.max(9.5, j.body - 1)),
      small: px(Math.max(8, j.body - 3.5)), accent: j.accent || '#231f20', gap: px(j.gap), 'body-font': face(j.bodySans ? sans : serif) },
    ...prints,
    stylesheet: 'journals.css',
    fonts: [...new Set([j.bodySans ? j.sans[0] : j.serif[0], j.sans[0]])].flatMap(f => [`400 14px '${f}'`, `700 14px '${f}'`, ...(j.serif.includes(f) ? [`italic 400 14px '${f}'`] : [])]),
    first: kit => layout(kit, s),
    ...(prints.header ? { header: (kit, at) => prints.header(kit, at, s) } : {}),
    footer: prints.footer ? (kit, at) => prints.footer(kit, at, s) : (kit, { n }) => `<span><i>${kit.esc(j.label)}</i> &nbsp;|&nbsp; Manuscript preview</span><span>${n}</span><span></span>`,
    measured: !!j.source?.checked, source: j.source,
  };
}

export const journalStyles = JOURNALS.map(styleOf);
