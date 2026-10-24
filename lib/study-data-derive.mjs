// Study data (the built-in study fields: design, population, intervention, comparator, follow-up, outcome) derived from an evidence table's
// columns by templates the project keeps (.lykos/build.json "studyData"), so the Study data follow every change to the table and no project
// keeps a script for it (24 Oct 2026; the Spine review's study_data_from_app.py, which wrote the project file itself). Pure: the state in,
// the values that change out; lykos-after-build writes them under the project lock.
//
// A field's template is a text with {column} places, or { one, two } for single-arm and two-arm studies, or { text, availability?, source?,
// cite? } for a fixed text, or { fill, cite } for a template whose evidence is cited in the order `cite` gives. A place is {column} (the study's value, else its first arm's), {column@1} (the first arm's, else the study's),
// {column@2} (the second arm's only); a filter after | shapes it: label (the text after the first line), n (its "n=24"), months ("24 months",
// "(whole cohort)" kept last). A part in [[ ]] is left out when any place in it is empty. Every value a template reads is cited as evidence,
// with its cell in the evidence file.
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const text = v => (v == null ? '' : String(v.reported_value ?? ''));
const FILTERS = {
  label: t => (t.includes('\n') ? t.split('\n').slice(1).join('\n').trim() : t),
  n: t => /n=\d+/.exec(t)?.[0] || '',
  months: t => (t ? `${t.replace(' (whole cohort)', '')} months${t.includes('whole cohort') ? ' (whole cohort)' : ''}` : ''),
};

/** The value of `column` for a study: `arm` undefined the study's, else its first arm's; 1 the first arm's, else the study's; 2+ that arm's only. */
function valueOf(V, prefix, pid, column, arm) {
  const own = k => V[`${pid}:${prefix}${column}@arm${k}`], study = V[`${pid}:${prefix}${column}`];
  if (arm == null) return study || own(1) || null;
  if (arm === 1) return own(1) || study || null;
  return own(arm) || null;
}

/** A template filled for one study: `{ text, cited }` (the values read, in order, once each). */
export function fill(template, read) {
  const cited = [];
  const one = (s, holes) => String(s).replace(/\{([\w.]+)(?:@(\d+))?(?:\|(\w+))?\}/g, (m, col, arm, f) => {
    const v = read(col, arm ? Number(arm) : null);
    if (v && !cited.includes(v)) cited.push(v);
    let t = text(v);
    if (f && FILTERS[f]) t = FILTERS[f](t);
    if (!t) holes.push(m);
    return t;
  });
  const out = String(template).replace(/\[\[([\s\S]*?)\]\]/g, (m, part) => { const holes = [], t = one(part, holes); return holes.length ? '' : t; });
  const filled = one(out, []).trim();
  // cited in the order the template reads them, whichever part was filled first
  const inOrder = [...String(template).matchAll(/\{([\w.]+)(?:@(\d+))?(?:\|\w+)?\}/g)].map(m => read(m[1], m[2] ? Number(m[2]) : null)).filter(v => v && cited.includes(v));
  return { text: filled, cited: [...new Set(inOrder)] };
}

/**
 * The Study data values that differ from what the project holds: `{ values: { key: record }, changed }`. `cfg` = { template, twoArmsBy, fields,
 * file? } (the evidence file a value's locator points into; else the project's evidence file); a study is a paper with a value in the
 * template's id column (else any value in the template).
 */
export function deriveStudyData(state, cfg, { now = new Date().toISOString() } = {}) {
  const V = state?.values || {}, tpl = String(cfg?.template || ''), prefix = `${tpl}.`, out = {};
  if (!tpl || !isObj(cfg.fields)) return { values: out, changed: 0 };
  const file = cfg.file || state?.folderInit?.files?.evidence || null;
  const ids = Object.values(V).filter(v => v?.field_id === `${prefix}id`).map(v => v.paper_id);
  const papers = [...new Set(ids.length ? ids : Object.values(V).filter(v => String(v?.field_id || '').startsWith(prefix)).map(v => v.paper_id))];
  const cite = vs => vs.filter(v => v?.evidence?.length).map(v => ({ kind: 'file', path: file, locator: v.evidence[0].locator, quote: v.reported_value }));
  for (const pid of papers) {
    const two = cfg.twoArmsBy ? `${pid}:${prefix}${cfg.twoArmsBy}@arm1` in V : false;
    const read = (col, arm) => valueOf(V, prefix, pid, col, arm);
    for (const [fid, spec] of Object.entries(cfg.fields)) {
      const s = isObj(spec) && ('one' in spec || 'two' in spec) ? spec[two ? 'two' : 'one'] : spec;
      if (s == null) continue;
      let t, cited, availability = 'present', source = 'Evidence table';
      // { fill, cite? }: a template whose evidence is cited in an order of its own (columns, @k for an arm), else in the order it reads them
      const readRef = r => { const [c, a] = String(r).split('@'); return read(c, a ? Number(a) : null); };
      if (isObj(s) && 'fill' in s) { ({ text: t } = fill(s.fill, read)); cited = s.cite ? s.cite.map(readRef).filter(Boolean) : fill(s.fill, read).cited; availability = s.availability || 'present'; source = s.source || source; }
      else if (isObj(s)) { t = String(s.text ?? ''); cited = (s.cite || []).map(readRef).filter(Boolean); availability = s.availability || 'present'; source = s.source || source; }
      else ({ text: t, cited } = fill(s, read));
      const k = `${pid}:${fid}`, old = V[k];
      if (old && old.reported_value === t && (old.availability || 'present') === availability) continue;
      out[k] = { paper_id: pid, study_id: pid, field_id: fid, reported_value: t, normalized_value: t, origin: 'imported', availability, verification: 'accepted',
        evidence: cite(cited), rationale: 'Study data derived from the evidence table', proposed_by: null, extractor: 'import:xlsx', source, source_locator: null, verified_at: now, at: now };
    }
  }
  return { values: out, changed: Object.keys(out).length };
}
