// The checklist chooser: which reporting checklists a research type may use,
// which one a project has chosen, and one composed item list from a base
// checklist with its extensions and add-ons (lib/checklists-extra.mjs).
//
// A base checklist keeps its own item numbers, so states already saved under
// them stay valid when an extension or add-on is added. Extension and add-on
// items are stored in the same state map under prefixed ids ('cluster-4a',
// 'tidier-3'), which never collide with a base item number.
//
// Base checklists are passed in as objects: this module does not import
// lib/checklist.mjs, so that module can import this one.

import { EXTRA_CHECKLISTS } from './checklists-extra.mjs';
import { typeById } from './research-types.mjs';
import { researchType } from './workflow.mjs';

// What each research type may add to or swap for its own checklist. The
// default is always the type's own checklist (research-types.mjs).
const REVIEW = { extensions: ['prisma-s'], protocol: 'prisma-p', addons: ['gripp2-sf'] };
const TRIAL = {
  alternatives: ['consort'],
  extensions: ['consort-cluster', 'consort-noninferiority', 'consort-pilot', 'consort-harms', 'consort-pro', 'consort-ai'],
  abstract: 'consort-abstract', protocol: 'spirit-2013', addons: ['tidier', 'gripp2-sf'],
};
const BY_TYPE = {
  'systematic-review': { ...REVIEW, extensions: ['prisma-s', 'prisma-ipd'], abstract: 'prisma-abstract' },
  'meta-analysis': { ...REVIEW, extensions: ['prisma-s', 'prisma-ipd'], abstract: 'prisma-abstract' },
  'rapid-review': { ...REVIEW, abstract: 'prisma-abstract' },
  'scoping-review': REVIEW,
  'umbrella-review': REVIEW,
  'qualitative-review': { ...REVIEW, alternatives: ['emerge'] },
  'dta-review': REVIEW,
  'nma-review': { ...REVIEW, abstract: 'prisma-abstract' },
  rct: TRIAL,
  'cohort-study': { alternatives: ['trend'], extensions: ['record'], addons: ['tidier', 'gripp2-sf'] },
  'diagnostic-study': { addons: ['gripp2-sf'] },
  'prognostic-model': { alternatives: ['tripod'], addons: ['gripp2-sf'] },
  'survey-study': { addons: ['gripp2-sf'] },
  'qualitative-study': { alternatives: ['coreq'], addons: ['gripp2-sf'] },
  'qi-project': { addons: ['tidier', 'gripp2-sf'] },
  'economic-evaluation': { addons: ['gripp2-sf'] },
  'animal-study': {},
  'case-series': { extensions: ['prisma-ipd'], abstract: 'prisma-abstract', protocol: 'prisma-p' },
  'case-report': {},
  guideline: { addons: ['gripp2-sf'] },
  other: {},
};

/**
 * The checklists a research type may report against: its own as the default,
 * alternatives that replace it, extensions and add-ons that add to it, and the
 * abstract and protocol checklists that go with it.
 */
export function choicesFor(researchTypeId) {
  const type = typeById(researchTypeId) || typeById('other');
  const c = BY_TYPE[type.id] || {};
  return {
    default: type.checklist || 'prisma-2020',
    alternatives: [...(c.alternatives || [])],
    extensions: [...(c.extensions || [])],
    abstract: c.abstract || null,
    protocol: c.protocol || null,
    addons: [...(c.addons || [])],
  };
}

/**
 * Whether an extension applies to a checklist: it names that checklist as its
 * base, or the type offers it for its default and the default is in use (a
 * search extension beside PRISMA-ScR, say).
 */
function fits(extId, checklist, choices) {
  const ext = EXTRA_CHECKLISTS[extId];
  if (!ext || ext.kind !== 'extension' || !choices.extensions.includes(extId)) return false;
  return ext.extends === checklist || (checklist === choices.default && ext.extends === 'prisma-2020');
}

/**
 * The project's checklist selection, from state.checklistChoice, with
 * anything the type does not offer (or no longer offers) dropped. Without a
 * saved choice it is the type's default with nothing added.
 */
export function applied(state) {
  const choices = choicesFor(researchType(state || {}).id);
  const saved = state?.checklistChoice || {};
  // Preserve a legacy project's recorded items; a new project starts with
  // the current standard. Explicit selection always wins over this fallback.
  const legacy = choices.default === 'consort-2025' && Object.keys(state?.checklistConsort || {}).length ? 'consort'
    : choices.default === 'tripod-ai' && Object.keys(state?.checklistTripod || {}).length ? 'tripod' : choices.default;
  const checklist = saved.checklist === choices.default || choices.alternatives.includes(saved.checklist) ? saved.checklist : legacy;
  const extensions = [...new Set(saved.extensions || [])].filter(id => fits(id, checklist, choices));
  const addons = [...new Set(saved.addons || [])].filter(id => choices.addons.includes(id) && EXTRA_CHECKLISTS[id]?.kind === 'addon');
  return { checklist, extensions, addons };
}

const resolve = c => (typeof c === 'string' ? EXTRA_CHECKLISTS[c] : c) || null;
const prefixOf = c => c.prefix || c.id;

/**
 * One item list from a base checklist, its extensions and its add-ons. Base
 * items keep their numbers; each extension item follows the base item it
 * modifies (in the extension's own order), or, when its base is not this
 * checklist or the item is not found, joins its extension's own section after
 * the base items; add-on items follow in their own sections. Extension and
 * add-on items take ids prefixed with the extension's prefix.
 *
 * Each item is [id, name, description, meta]; meta names the source, and for
 * an added item its number in its own checklist, the base item it modifies and
 * the section it sits in. Callers that read only the first three fields are
 * unaffected.
 */
export function composeChecklist(base, extensions = [], addons = []) {
  base = resolve(base);
  if (!base) throw new Error('composeChecklist: no base checklist');
  const exts = extensions.map(resolve).filter(Boolean);
  const adds = addons.map(resolve).filter(Boolean);
  const baseIds = new Set(base.items.map(([n]) => n));
  const after = new Map();       // base item number -> extension items that follow it
  const sections = [];           // [name, items] for extensions that could not be placed, then add-ons
  const tag = (c, item, section) => {
    const [n, name, desc, modifies] = item;
    return [`${prefixOf(c)}-${n}`, name, desc, { source: c.id, sourceName: c.name, number: n, modifies: modifies ?? null, section }];
  };
  for (const ext of exts) {
    const loose = [];
    for (const item of ext.items) {
      const target = item[3];
      if (ext.extends === base.id && target != null && baseIds.has(target)) {
        if (!after.has(target)) after.set(target, []);
        after.get(target).push(tag(ext, item, null));
      } else loose.push(tag(ext, item, ext.name));
    }
    if (loose.length) sections.push(loose);
  }
  for (const add of adds) sections.push(add.items.map(item => tag(add, item, add.name)));
  const items = [];
  for (const item of base.items) {
    items.push(item);
    for (const x of after.get(item[0]) || []) items.push(x);
  }
  for (const s of sections) items.push(...s);
  return {
    ...base,
    items,
    composed: { base: base.id, extensions: exts.map(c => c.id), addons: adds.map(c => c.id) },
    // the base keeps its name; the label names everything composed into it
    label: [base.name, ...exts.map(c => c.name), ...adds.map(c => c.name)].join(' + '),
  };
}

/** The state key that holds a composed checklist's item states: its base's key. */
export const stateKey = composed => composed.key;
