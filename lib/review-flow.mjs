// One review's flow diagram in its own template (lib/reviews.mjs): PRISMA 2020
// or PRISMA-IPD, drawn from the project as that review sees it. Reporting, the
// export bundle and Tables and figures draw a review's figure through here, so
// each figure is tied to its review and its searches.
import { reviewOf, scoped } from './reviews.mjs';
import { prismaData } from './prisma-counts.mjs';
import { prismaFlow, prismaFlowPptx } from './prisma-flow.mjs';
import { prismaIpdData, prismaIpdFlow, ipdCountRows } from './prisma-ipd.mjs';
import { prismaCountRows } from './submission.mjs';

/** The review, the project as it sees it, and its figure's title: the one review of a project keeps the drawing's own. */
function flowOf(s, id) {
  const r = reviewOf(s, id), st = scoped(s, r.id);
  const title = r.main && !(s.reviews || []).some(x => x.id !== r.id) ? undefined : `${r.name}: ${r.template === 'prisma-ipd' ? 'PRISMA-IPD' : 'PRISMA 2020'} flow diagram`;
  return { r, st, titled: title ? { title } : {} };
}

/**
 * The review's diagram as SVG. `interactive` marks PRISMA 2020's boxes as targets (the screen copy only). `layout` and `page` ({ w } in inches of the
 * unit's own size, 96 px to the inch on screen) choose PRISMA 2020's landscape or portrait drawing (prismaFlow); PRISMA-IPD has one layout.
 */
export function reviewFlowSvg(s, id, { interactive = false, style = null, layout, page } = {}) {
  const { r, st, titled } = flowOf(s, id);
  if (r.template === 'prisma-ipd') return prismaIpdFlow(prismaIpdData(st), { style, ...titled });
  return prismaFlow(prismaData(st), { previous: false, other: false, ...(st.prismaArms || {}), interactive, style, layout, page, ...titled });
}

/**
 * The review's diagram as an editable PowerPoint file (the bytes of a .pptx), the same layout as its SVG (lib/prisma-flow.mjs
 * prismaFlowPptx). PRISMA 2020 only: null for a PRISMA-IPD review, whose diagram is not laid out as a scene.
 */
export async function reviewFlowPptx(s, id, { style = null } = {}) {
  const { r, st, titled } = flowOf(s, id);
  if (r.template === 'prisma-ipd') return null;
  return prismaFlowPptx(prismaData(st), { previous: false, other: false, ...(st.prismaArms || {}), style, ...titled });
}

/** The review's counts as rows [label, count, source] for a CSV beside its figure. */
export function reviewCountRows(s, id) {
  const r = reviewOf(s, id), st = scoped(s, r.id);
  return r.template === 'prisma-ipd' ? ipdCountRows(st).map(x => [x.label, x.count, x.source]) : prismaCountRows(st).map(x => [x.label, x.count, x.source]);
}
