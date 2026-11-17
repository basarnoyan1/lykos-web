// A figure mark's details in the side panel (13 Nov 2026, the owner, on the live PRISMA flow: "you could open the details in the right panel
// you know"). In the Manuscript's App view a press on a mark of a live figure opens this section in the inspector and leaves the page where
// it is: the mark's name, its numbers as label and value rows, the records behind it (a page of 20, each opening the study), and one link to
// where the press went before. Hover keeps its tooltip (lib/chart-interact.mjs). The reader holds which mark is open
// (views/manuscript-reader.mjs); this module only says what the panel shows.
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar, lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow, lib_ui_actions$uiRowEnd as uiRowEnd } from "../boot.mjs";
import { lib_ui_components$uiLink as uiLink } from "../boot.mjs";
import { lib_paging$pageOf as pageOf, lib_paging$pager as pager, lib_paging$wirePager as wirePager } from "../boot.mjs";
import { boxDetail } from '../lib/prisma-records.mjs';
import { shownValue } from '../lib/chart-card.mjs';
import { traceNumber, inputRows, inputsText, slotText, armText, VERDICTS } from '../lib/number-trace.mjs';
import { placeText } from '../lib/number-check.mjs';
import { lib_dates$when as when } from "../boot.mjs";

export const MARK_PAGE = 20;
const ROWS_MAX = 12;

/** A flow box: its name, each count on its own row ("entered by hand" says so), the records its counts are made of, each once. `go` is where the press went without records. */
export function flowMarkDetails(s, boxId) {
  const d = boxDetail(s, boxId);
  if (!d) return null;
  const ids = [...new Set(d.parts.flatMap(p => (p.manual ? [] : p.records).map(r => r.id)))];
  const rows = d.parts.filter(p => p.count != null).map(p => ({ label: p.label, value: p.manual ? `${p.count}, entered by hand` : String(p.count) }));
  return { title: d.label, rows, ids, go: 'reporting' };
}

/** A row of a rendered output `m` (a forest's study, a pooled row, a subgroup): its label and the columns the figure has, and the studies it stands for. */
export function rowMarkDetails(m, row, label = '') {
  const r = m.result, values = r.rows[row] || [];
  const rows = r.columns.map((c, i) => [c.label, values[i]]).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))
    .slice(0, ROWS_MAX).map(([k, v]) => ({ label: k, value: Array.isArray(v) ? v.join('; ') : String(shownValue(v)) }));
  return { title: label || String(values[0] ?? ''), rows, ids: [...new Set(r.refs?.[row] || [])] };
}

/** A risk-of-bias summary segment ("D1 Randomization process, Low: 45 of 106"): the judgement and how many studies have it. */
export function robMarkDetails({ label, level, domain = '', ids: all = [], total = 0 }) {
  const ids = [...new Set(all)];
  const rows = [...(domain ? [{ label: 'Domain', value: domain }] : []), { label: 'Judgement', value: level }, { label: 'Studies', value: total ? `${ids.length} of ${total}` : String(ids.length) }];
  return { title: label, rows, ids };
}

/**
 * A number of the manuscript (need 4 of docs/Sham_Needs_Review_2026-11.md): where it stands, the run output it was traced to, what that
 * output prints, whether the text agrees with it, the run, and the rows the output read, each opening its study. `ck` the check's row,
 * `check` the structured check, `run` the recorded run (run.json), `labelOf(id)` a study's label, `valueAt(key)` a record value's text
 * (the outcome's instrument names its row). { title, rows, items, listTitle }.
 */
export function numberDetails(ck, { check = null, run = null, labelOf = id => id, valueAt = () => '' } = {}) {
  const t = traceNumber(ck, { check, run }), rows = [], where = placeText(ck.place);
  if (where) rows.push({ label: 'Place', value: where });
  if (t.output) {
    rows.push({ label: 'Analysis', value: `${t.output.title}${t.output.level ? `, ${t.output.level}` : ''}` });
    if (t.output.text) rows.push({ label: 'The run prints', value: t.output.text });
    rows.push({ label: 'Against the run', value: t.verdict === 'match' ? VERDICTS.match : `${VERDICTS[t.verdict]}${t.value ? `: the run prints ${t.value}` : ''}` });
    rows.push({ label: 'Run', value: [when(run.at), run.id].filter(Boolean).join(', ') });
  } else {
    rows.push({ label: 'Against the run', value: 'Not traced: no output of the run prints it beside these numbers' });
    if (ck.source?.text) rows.push({ label: 'Source named', value: ck.source.text });
  }
  // the rows the output read: a study, its outcome (the instrument when recorded) and its arm
  const tpl = String(run?.valueIds?.[0] || '').replace(/^[^:]*:/, '').replace(/\..*$/, '');
  const inputs = t.output ? inputRows(t.output, run) : [];
  if (inputs.length) rows.push({ label: 'Inputs', value: inputsText(inputs) });
  const items = inputs.map(r => {
    const inst = r.slot && tpl ? valueAt(`${r.pid}:${tpl}.out_instrument~${r.slot}@arm1`) || valueAt(`${r.pid}:${tpl}.out_instrument~${r.slot}@${r.arm}`) : '';
    return { id: r.pid, label: [labelOf(r.pid), inst || slotText(r.slot), armText(r.arm)].filter(Boolean).join(', ') };
  });
  return { title: ck.number, rows, items, listTitle: 'Rows that went in', verdict: t.verdict };
}

/**
 * The inspector section for `d` (`{ title, rows, ids, link }`, or `items` [{ id, label }] and `listTitle` in place of `ids`; `link` { label, run } the press's old destination) at `page`:
 * `{ title: '', html, wire }`. `labelOf(id)` names a record; `onOpen(id)` opens it; `onPage(n)` and `onClose()` are the reader's.
 */
export function markSection(d, { page = 1, labelOf = id => id, onOpen, onPage, onClose } = {}) {
  const head = uiBar({ kind: 'head', label: d.title, id: 'markp-head', cls: 'insp-head', lead: { title: d.title, level: 'h3' }, actions: [],
    overflow: [{ id: 'markp-close', label: 'Close details', attrs: { 'data-markp-close': '' } }] });
  // a value longer than its column (a number's analysis, what the run prints) is the row's own line, wrapped
  const facts = d.rows.length ? uiList({ label: `${d.title}, numbers`, cols: ['value'], rows: d.rows.map(r => (String(r.value).length > 24
    ? uiRow({ main: { html: `<span class="ms-wc-name">${esc(r.label)}</span>`, detail: [esc(r.value)], wrap: true }, cells: [{ col: 'value', kind: 'text', ch: 24, html: '' }], end: uiRowEnd({ reserve: true }) })
    : uiRow({ main: { html: `<span class="ms-wc-name">${esc(r.label)}</span>` }, cells: [{ col: 'value', kind: 'text', ch: 24, html: esc(r.value) }], end: uiRowEnd({ reserve: true }) }))) }) : '';
  // the records behind the mark, or labelled rows (a number's inputs: a study, an outcome and an arm each), a page at a time
  const list = d.items || (d.ids || []).map(id => ({ id, label: labelOf(id) })), name = d.listTitle || 'Records';
  const pg = pageOf(list, page, MARK_PAGE);
  const records = list.length ? `<section class="study-review"><h4>${esc(name)}</h4>${uiList({ label: `${d.title}, ${name.toLowerCase()}`, cols: [], rows: pg.items.map(it => uiRow({
    main: { html: uiLink({ label: it.label, attrs: { 'data-markp-study': it.id } }) }, end: uiRowEnd({ reserve: true }) })) })}${pager({ id: 'markp-pager', page: pg.page, pages: pg.pages, total: list.length, label: d.items ? 'rows' : 'records', size: MARK_PAGE })}</section>` : '';
  const link = d.link ? `<p class="markp-link">${uiLink({ label: d.link.label, attrs: { 'data-markp-link': '' } })}</p>` : '';
  const html = `<div class="study-details msd-markp">${head}${facts}${records}${link}</div>`;
  const wire = root => {
    root.querySelector('[data-markp-close]')?.addEventListener('click', () => onClose?.());
    root.querySelectorAll('[data-markp-study]').forEach(b => b.onclick = () => onOpen?.(b.dataset.markpStudy));
    root.querySelector('[data-markp-link]')?.addEventListener('click', () => d.link.run());
    wirePager(root, 'markp-pager', n => onPage?.(n));
  };
  return { title: '', html, wire };
}
