// The manuscript's front matter, read from the project (plan W9a, "Front matter"): the title, the authors in the project's order
// with their numbered affiliations, the corresponding author, each author's contributions (CRediT roles on the author) and the
// declarations as statements. Every document that prints them takes them from here or from the functions it is built on
// (lib/declarations.mjs titlePage and statements), never from text typed into a build script: the Word export (withFrontMatter),
// the submission package, `lykos-export <folder> front-matter` and the MCP's read("front-matter").
//
// A placeholder author prints as its [bracketed] text in its place; a declaration with nothing entered is the [bracketed]
// placeholder statements() gives. Both are listed in `gaps`, so nothing is invented to fill them.
//
// Pure: nothing here imports the store or a view.
import { lib_declarations$normalizeAuthors as normalizeAuthors, lib_declarations$normalizeDeclarations as normalizeDeclarations, lib_declarations$statements as statements, lib_declarations$statementBlocks as statementBlocks, lib_declarations$printable as printable, lib_declarations$isPlaceholder as isPlaceholder, lib_declarations$affiliationsOf as affiliationsOf, lib_declarations$rolesOf as rolesOf, lib_declarations$creditRole as creditRole, lib_declarations$CREDIT_ROLES as CREDIT_ROLES, lib_declarations$STATEMENT_HEADINGS as STATEMENT_HEADINGS, lib_declarations$DECLARATIONS_GEN as DECLARATIONS_GEN } from "../boot.mjs";

import { syncTitlePage, TITLE_GEN } from './author-list.mjs';

const has = s => !!String(s ?? '').trim();
const GAP = /\[[^\]]+\]|<<[^>]*>>/;
export const TITLE_GAP = '[Title]';

/** An author's CRediT roles as printed, in the taxonomy's order: "Formal analysis (lead)". */
function contributionNames(author, decl) {
  const given = (rolesOf(author, decl) || []).map(r => ({ role: creditRole(r?.role), degree: r?.degree || '' })).filter(r => r.role);
  return CREDIT_ROLES.map(role => given.find(g => g.role === role)).filter(Boolean).map(g => (g.degree ? `${g.role.name} (${g.degree})` : g.role.name));
}

/**
 * The front matter as data: `{ title, authors, affiliations, corresponding, declarations, gaps }`.
 * `authors`: `{ name, placeholder, degrees, orcid, email, affiliations: [numbers into affiliations], contributions: [role names],
 * corresponding, senior }` in the project's order. `declarations`: statements() by key (contributions, conflicts, funding, ethics,
 * consent, dataAvailability, aiUse, acknowledgements, registration). `folderName`: a title that is only the folder's name is a gap.
 */
export function frontMatter(s = {}, { folderName = '' } = {}) {
  const { paper } = normalizeAuthors(s.paper || {}, s.declarations || null);
  const decl = normalizeDeclarations(s.declarations || {}, paper);
  const listed = printable(paper?.authors || []);
  const people = listed.filter(a => !isPlaceholder(a));
  const gaps = [];

  const rawTitle = String(paper?.title || '').trim();
  const titleIsFolder = !!rawTitle && rawTitle === String(folderName || '').trim();
  const title = rawTitle && !titleIsFolder ? rawTitle : TITLE_GAP;
  if (title === TITLE_GAP) gaps.push(rawTitle ? `Title: the paper's title is the folder name, "${rawTitle}"` : 'Title: none entered');

  const numbers = new Map();
  for (const a of people) for (const x of affiliationsOf(a)) if (!numbers.has(x)) numbers.set(x, numbers.size + 1);
  const authors = listed.map(a => {
    const name = String(a.name || '').trim();
    if (isPlaceholder(a)) { gaps.push(`Authors: ${name} is a placeholder`); return { name, placeholder: true, affiliations: [], contributions: [] }; }
    const contributions = contributionNames(a, decl);
    if (!affiliationsOf(a).length) gaps.push(`Affiliation of ${name}`);
    if (!contributions.length) gaps.push(`Contributions of ${name} (CRediT roles)`);
    return { name, placeholder: false, degrees: String(a.degrees || '').trim(), orcid: String(a.orcid || '').trim(), email: String(a.email || '').trim(),
      affiliations: affiliationsOf(a).map(x => numbers.get(x)), contributions, corresponding: !!a.corresponding, senior: !!a.senior };
  });

  const c = people.find(a => a.corresponding) || people.find(a => has(paper?.correspondingAuthor) && String(a.name).trim() === String(paper.correspondingAuthor).trim());
  const corresponding = c ? { name: String(c.name).trim(), email: String(c.email || '').trim(), address: String(c.address || affiliationsOf(c)[0] || '').trim(), orcid: String(c.orcid || '').trim() } : null;
  if (!corresponding) gaps.push('Corresponding author: none marked');
  else if (!corresponding.email) gaps.push(`Email of the corresponding author, ${corresponding.name}`);

  const declarations = statements(decl, paper?.authors || [], { researchType: s.project?.researchType || null });
  for (const [k, heading] of STATEMENT_HEADINGS) if (GAP.test(declarations[k] || '')) gaps.push(`${heading}: to complete`);
  return { title, authors, affiliations: [...numbers.keys()], corresponding, declarations, gaps };
}

/** The front matter as plain text, one fact a line: what read("front-matter") and the command line print. */
export function frontMatterText(fm) {
  const sup = a => (a.affiliations.length ? ` (${a.affiliations.join(', ')})` : '');
  const out = [`Title: ${fm.title}`, '', 'Authors, in order:'];
  fm.authors.forEach((a, i) => {
    if (a.placeholder) { out.push(`  ${i + 1}. ${a.name}`); return; }
    const marks = [a.corresponding ? 'corresponding' : '', a.senior ? 'senior' : ''].filter(Boolean).join(', ');
    out.push(`  ${i + 1}. ${a.name}${a.degrees ? `, ${a.degrees}` : ''}${sup(a)}${marks ? `; ${marks}` : ''}${a.orcid ? `; ORCID ${a.orcid}` : ''}`);
    out.push(`     Contributions: ${a.contributions.length ? a.contributions.join(', ') : `[CRediT roles for ${a.name}]`}`);
  });
  out.push('', 'Affiliations:', ...(fm.affiliations.length ? fm.affiliations.map((x, i) => `  ${i + 1}. ${x}`) : ['  [Affiliations]']));
  const c = fm.corresponding;
  out.push('', `Corresponding author: ${c ? `${c.name}, ${c.address || '[postal address]'}, ${c.email || '[email]'}` : '[Corresponding author]'}`);
  out.push('', 'Declarations:');
  for (const [k, heading] of STATEMENT_HEADINGS) if (fm.declarations[k]) out.push(`  ${heading}: ${fm.declarations[k]}`);
  out.push('', fm.gaps.length ? 'To complete:' : 'Nothing to complete.', ...fm.gaps.map(g => `  - ${g}`));
  return out.join('\n');
}

/**
 * The manuscript's blocks with what Lykos generated from the project brought up to date, as the Word export and the bundle write
 * them: the title page made from the author list (`gen: 'title-page'`, and the title above it), and the declarations inserted as
 * statements (`gen: 'declarations'`). Text typed by hand is left as it is. Returns the same array when nothing was generated.
 */
export function withFrontMatter(blocks = [], s = {}) {
  let out = blocks;
  const { paper } = normalizeAuthors(s.paper || {}, s.declarations || null);
  if (out.some(b => b.gen === TITLE_GEN)) {
    out = syncTitlePage(out, paper) || out;
    const first = out.findIndex(b => b.gen === TITLE_GEN), title = String(paper?.title || '').trim();
    const head = first > 0 ? out[first - 1] : null;
    if (head && title && (head.type === 'h1' || head.styleId === 'Title') && head.text !== title) {
      out = out.slice(); out[first - 1] = { ...head, text: title, ...(head.runs ? { runs: [{ ...head.runs[0], t: title }] } : {}) };
    }
  }
  const at = out.flatMap((b, i) => (b.gen === DECLARATIONS_GEN ? [i] : []));
  if (at.length) {
    const old = at.map(i => out[i]);
    const made = statementBlocks(normalizeDeclarations(s.declarations || {}, paper), paper?.authors || [], { researchType: s.project?.researchType || null });
    made.forEach((b, i) => { if (old[i] && old[i].type === b.type) b.id = old[i].id; });
    const drop = new Set(at);
    out = [...out.slice(0, at[0]).filter((_, i) => !drop.has(i)), ...made, ...out.slice(at[0]).filter((_, j) => !drop.has(j + at[0]))];
  }
  return out;
}
