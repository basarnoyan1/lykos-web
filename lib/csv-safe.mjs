// Text that a spreadsheet would run as a formula: a cell of free text that starts with =, +, @ or a tab or carriage return, or with a minus that
// is not a number's sign, is written with a leading apostrophe. Numbers (-3, -0.5, +2) pass as they are. Used where a person's own words go into
// a CSV (the case's tables, the study labels of the data tables).
const NUMBER = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/;
export function csvSafe(v) {
  const t = String(v ?? '');
  return /^[\s]*[=+@\t\r-]/.test(t) && !NUMBER.test(t.trim()) ? `'${t}` : t;
}
