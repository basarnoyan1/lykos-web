// How a project search hit reads in the command palette. A hit's text is written for
// the assistant (field names, stage keys, evidence quotes); the palette shows a person
// the study, the stage and the value in words, and names what kind of thing it is.

const STAGE = { title_abstract: 'Title and abstract', full_text: 'Full text' };
const KIND = {
  protocol: 'Protocol', criterion: 'Criterion', paper: 'Record', screening_decision: 'Screening decision',
  accepted_cell: 'Extracted value', note: 'Note', project_note: 'Project note', analysis: 'Analysis',
  analysis_status: 'Analysis', manuscript_draft: 'Manuscript',
};
const sentence = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const words = key => String(key || '').replace(/[_.]+/g, ' ').trim();

/** The label of an extraction column: its table label when the project has one, else its id in words. */
function columnLabel(state, columnId) {
  for (const t of state?.templates || []) { const c = (t.columns || []).find(x => x.id === columnId); if (c?.label) return c.label; }
  return sentence(words(String(columnId).split('.').pop()));
}

/** { label, meta } for one hit of lib/project-memory.mjs searchProject. */
export function paletteHit(hit, state = null) {
  const kind = KIND[hit.kind] || sentence(words(hit.kind));
  const text = String(hit.text || '');
  if (hit.kind === 'screening_decision') {
    const m = /^(.*?); (title_abstract|full_text): ([^;]*)(?:; reason (.*))?$/s.exec(text);
    if (m) return { label: `${m[1]} · ${STAGE[m[2]]}: ${m[3]}${m[4] ? ` · ${m[4]}` : ''}`, meta: kind };
  }
  if (hit.kind === 'accepted_cell') {
    const parts = text.split('; '), study = parts[0];
    const rest = parts.slice(1).filter(p => !p.startsWith('evidence '));
    const [field, ...value] = (rest[0] || '').split(': ');
    const shown = [`${columnLabel(state, hit.column_id ?? field)}: ${value.join(': ')}`.trim(), ...rest.slice(1).filter(p => p && p !== 'present')];
    return { label: `${study} · ${shown.join(' · ')}`, meta: kind };
  }
  if (hit.kind === 'note') { const at = text.indexOf('; '); return { label: at < 0 ? text : text.slice(at + 2), meta: kind }; }
  if (hit.kind === 'project_note') { const at = text.indexOf('; '); const title = text.slice(0, Math.max(0, at)); return { label: title || text.slice(at + 2), meta: kind }; }
  return { label: text.replaceAll('; ', ' · '), meta: kind };
}
