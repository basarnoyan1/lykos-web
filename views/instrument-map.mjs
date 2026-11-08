// The instrument map (plan G3a, data-model plan S3): included studies counted per indication × procedure × outcome instrument, with the
// scales that usually serve an indication and that no included study used marked unused. Drawn on the Scales page of Extraction
// (./extraction-scales.mjs), which keeps the two fields it reads (s.instrumentMap); it was a dialog of an outcome column's menu until 7 Nov 2026.
// The counts come from lib/outcome-rows.mjs instrumentMap; this file only draws them.
import { lib_ui_components$tableRegion as tableRegion } from "../boot.mjs";
import { lib_html$esc as esc, lib_html$emptyState as emptyState } from "../boot.mjs";
import { lib_dates$plural as plural } from "../boot.mjs";

/** The map as HTML: a table of indication × procedure rows and instrument columns, or the empty state. Pure. */
export function mapHtml(m) {
  if (!m.rows.length) {
    return emptyState({ title: 'No outcome coded as an instrument', size: 'inline',
      detail: 'Give an outcome column the Outcome instruments list in Field kind, then accept the proposals.' });
  }
  const head = `<tr><th scope="col">Indication</th><th scope="col">Procedure</th><th scope="col">Studies</th>${m.instruments
    .map(x => `<th scope="col"${x.used ? '' : ' class="meta"'}>${esc(x.label)}</th>`).join('')}</tr>`;
  const body = m.rows.map((r, i) => {
    const first = i === 0 || m.rows[i - 1].indication.code !== r.indication.code;
    const cells = m.instruments.map(x => {
      const n = r.cells[x.code] || 0;
      return `<td>${n ? n : r.unused.includes(x.code) ? '<span class="meta">unused</span>' : ''}</td>`;
    }).join('');
    return `<tr><th scope="row">${first ? esc(r.indication.label) : ''}</th><td>${esc(r.procedure.label)}</td><td>${r.studies}</td>${cells}</tr>`;
  }).join('');
  const notes = [m.uncoded ? `${plural(m.uncoded, 'study has', 'studies have')} outcomes not coded as an instrument and ${m.uncoded === 1 ? 'is' : 'are'} not placed.` : '']
    .filter(Boolean).map(t => `<p class="meta">${esc(t)}</p>`).join('');
  return `${tableRegion({ label: 'Instrument map', sticky: true, html: `<table><thead>${head}</thead><tbody>${body}</tbody></table>` })}${notes}`;
}
