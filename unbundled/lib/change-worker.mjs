// The change syntheses' worker (lib/change-run.mjs): the model of lib/change-synthesis.mjs is fitted here, off the page's thread, from the
// rows and plan the page hands over. It answers the Syntheses list first, then the effects source the figures draw (leave one out and the
// serious adverse events are fitted only for that one), the syntheses source the tables read and the moderators' association rule (3 Nov
// 2026: a table over the syntheses source, or the display-item checks' rule, fitted the whole model again on the page's thread, 3.7 s on the
// sham review), in the same code as the page would run, so the numbers are the same.
// Messages: { id, rows, plan } → { id, part, value } for each of PARTS in order, or { id, error }.
import { changeSynthesis } from './change-synthesis.mjs';
import { effectRowsOf, synthesisRowsOf, associationOf } from './change-tables.mjs';
import { changeListOf } from './change-list-items.mjs';

self.onmessage = e => {
  const { id, rows, plan } = e.data || {};
  try {
    const m = changeSynthesis(null, plan, { rows });
    self.postMessage({ id, part: 'list', value: changeListOf(m) });
    self.postMessage({ id, part: 'effects', value: effectRowsOf(m) });
    self.postMessage({ id, part: 'table', value: synthesisRowsOf(m) });
    // a review without moderators has no rule: kept as a value all the same, so the page knows it was asked
    self.postMessage({ id, part: 'association', value: associationOf(m) || { none: true } });
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
