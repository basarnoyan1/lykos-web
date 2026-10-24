// One review's flow diagram in its own template (lib/reviews.mjs): PRISMA 2020
// or PRISMA-IPD, drawn from the project as that review sees it. Reporting, the
// export bundle and Tables and figures draw a review's figure through here, so
// each figure is tied to its review and its searches.
import { reviewOf, scoped } from './reviews.mjs';
import { prismaData } from './prisma-counts.mjs';
import { prismaFlow } from './prisma-flow.mjs';
import { prismaIpdData, prismaIpdFlow, ipdCountRows } from './prisma-ipd.mjs';
import { prismaCountRows } from './submission.mjs';

/** The review's diagram as SVG. `interactive` marks PRISMA 2020's boxes as targets (the screen copy only). */
export function reviewFlowSvg(s, id, { interactive = false, style = null } = {}) {
  const r = reviewOf(s, id), st = scoped(s, r.id);
  const title = r.main && !(s.reviews || []).some(x => x.id !== r.id) ? undefined : `${r.name}: ${r.template === 'prisma-ipd' ? 'PRISMA-IPD' : 'PRISMA 2020'} flow diagram`;
  if (r.template === 'prisma-ipd') return prismaIpdFlow(prismaIpdData(st), { style, ...(title ? { title } : {}) });
  return prismaFlow(prismaData(st), { previous: false, other: false, ...(st.prismaArms || {}), interactive, style, ...(title ? { title } : {}) });
}

/** The review's counts as rows [label, count, source] for a CSV beside its figure. */
export function reviewCountRows(s, id) {
  const r = reviewOf(s, id), st = scoped(s, r.id);
  return r.template === 'prisma-ipd' ? ipdCountRows(st).map(x => [x.label, x.count, x.source]) : prismaCountRows(st).map(x => [x.label, x.count, x.source]);
}
