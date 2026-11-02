import { registrationValues } from './protocol-governance.mjs';
import { toComplete, toMarkdown } from './registration.mjs';
export const PROSPERO_URL = 'https://www.crd.york.ac.uk/PROSPERO/';
// These are preparation checks, not a reproduction of the live registry form.
export const PROSPERO_CHECKS = [
  ['eligibility', 'Check the current registry eligibility criteria for this review type and its actual stage.'],
  ['duplicates', 'Search PROSPERO for similar reviews and document how this review differs.'],
  ['protocol', 'Agree the protocol, eligibility criteria, outcomes and analysis methods with the team.'],
  ['stage', 'Record actual review progress and dates; distinguish completed work from planned work.'],
  ['team', 'Confirm team affiliations, contact details, funding and competing interests.'],
  ['approval', 'Have the team review the completed draft against the live registration form.'],
];
export function prosperoPreparation(state) {
  const values = registrationValues(state, 'prospero');
  const checked = state.registration?.prosperoChecks || {};
  return { values, missing: toComplete('prospero', values), checked,
    completed: PROSPERO_CHECKS.filter(([id]) => checked[id] === true).length };
}
export function prosperoPreparationNote(state) {
  const prep = prosperoPreparation(state);
  return `# PROSPERO preparation\n\nWorking draft — not submitted or registered.\n\nRegistry: ${PROSPERO_URL}\n\nThe local field list is a preparation aid, not a verified copy of the current form. Confirm current eligibility and required fields in your registry account. A narrative perspective manuscript alone does not establish that this is an eligible systematic review.\n\n## Before submission\n\n${PROSPERO_CHECKS.map(([id, label]) => `- [${prep.checked[id] === true ? 'x' : ' '}] ${label}`).join('\n')}\n\n## Similar reviews and rationale\n\n[Add registry links, overlap and the reason for this review.]\n\n## Questions for the team\n\n${prep.missing.map(f => `- ${f.label}: [to complete]`).join('\n') || 'All local required fields have values; review their accuracy and the live form.'}\n\n${toMarkdown('prospero', prep.values)}`;
}
