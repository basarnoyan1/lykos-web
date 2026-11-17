// Pointers to a table, figure, appendix or supplementary file, as a paper or a reviewer writes them (Assurance plan, "Provenance and
// missing files", steps 1 and 2): "Table 2", "Figure 3B", "Supplementary Table 2", "Table S2", "eTable 2", "S1 Table", "Appendix B",
// "Online Resource 1", "Additional file 1", "Supplemental Digital Content 2", "supplementary material", "Supporting Information",
// lists ("Tables S1 and S2", "Supplementary Tables 1-3"). One pattern for both readers: a reviewer's source cell (claims.mjs, proven by
// kernel.mjs against the sources' captions) and the article's own text (lib/expected-files.mjs, the files a study is expected to have).
// Case is written out where it matters: "Appendix" with a capital is a part of a paper, "appendix" the organ.
const SUPP = String.raw`(?:[Ee]lectronic\s+)?(?:[Ss]upplementa(?:l|ry)|SUPPLEMENTA(?:L|RY))|[Ss]uppl\.?`;
// a number of a table or figure: 2, 2A, S2, IV, A, A1 (a lone A or I before a lower-case word is an article or a pronoun)
// (a number run into a DOI is none: "online supplemental table 110.1136/jnnp-2025-335829", Wang 2025 in the Sham review)
const NUM = String.raw`(?:S?\d{1,3}[A-Za-z]?|[IVX]{1,4}|(?![AI]\s+[a-z])[A-Z]\d{0,2})\b(?!\.\d)`;
// a list goes on after "and", "&", a dash or "to"; after a comma only with an S number or where the list goes on or ends there:
// "Supplementary Table 2, 12 patients had" names Table 2 alone
const LIST = String.raw`${NUM}(?:\s*(?:and|&|[-–—]|to)\s*${NUM}|\s*,\s*(?:S\d{1,3}[A-Za-z]?\b|${NUM}(?=\s*(?:,|and\b|&|[-–—]|to\b|[).;:\]]|\n|$))))*`;
const SNUM = String.raw`S\d{1,3}[A-Za-z]?\b(?!\.\d)`;
const SLIST = String.raw`${SNUM}(?:\s*(?:,|and|&|[-–—]|to)\s*S?\d{1,3}[A-Za-z]?\b)*`;
const FIG = String.raw`[Ff]ig(?:ure)?s?\.?|FIG(?:URE)?S?\.?`;
const TAB = String.raw`[Tt]ables?|TABLES?`;
const FILEW = String.raw`[Rr]esources?|[Ff]iles?|[Dd]igital\s+[Cc]ontent|[Dd]atasets?|[Dd]ata|[Mm]aterials?|[Mm]ethods|[Ii]nformation|[Ss]upplements?|[Tt]exts?|[Vv]ideos?`;
const PATTERN = String.raw`(?<![\p{L}\d])(?:` + [
  // Supplement Table 2, Appendix Table 2: a table or figure of the supplement or appendix, with a number only (work queue row 15)
  String.raw`(?<p9>[Ss]upplement|SUPPLEMENT|Appendix|APPENDIX)\s+(?<w9>${TAB}|${FIG})(?![\p{L}])\s*(?<n9>${LIST})`,
  // Supplementary Table 2, Supplemental Digital Content 2, supplementary material
  String.raw`(?<p1>${SUPP})\s+(?<w1>${TAB}|${FIG}|Appendi(?:x|ces)|APPENDI(?:X|CES)|[Aa]ppendi(?:x|ces)|${FILEW})(?![\p{L}])(?:\s*(?<n1>${LIST}))?`,
  // Online Resource 1, Additional file 1, Extended Data Fig. 2: with a number only ("additional data are needed" names no file)
  String.raw`(?<p7>[Oo]nline|[Aa]dditional|[Ee]xtended\s+[Dd]ata)\s+(?<w7>${TAB}|${FIG}|Appendi(?:x|ces)|[Rr]esources?|[Ff]iles?|[Dd]ata|[Mm]aterials?|[Vv]ideos?)\s*(?<n7>${LIST})`,
  // Online Supplement, Online Appendix
  String.raw`(?<w8>[Oo]nline\s+(?:[Ss]upplement|[Aa]ppendix))(?![\p{L}])`,
  // eTable 2, eFigure 1, eAppendix
  String.raw`e(?<w2>Tables?|Fig(?:ure)?s?\.?|Appendi(?:x|ces)|Methods)(?![\p{L}])(?:\s*(?<n2>${LIST}))?`,
  // Table S2, Figs. S1 and S2
  String.raw`(?<w3>${TAB}|${FIG})\s*(?<n3>${SLIST})`,
  // S1 Table (PLOS)
  // (on one line, and not a spine level: "L5-S1 Data", "from L4 to S1\nTable 2")
  String.raw`(?<!(?:[LTC]\d{1,2}|[-–—/]|\bto)\s*)S(?<n4>\d{1,3})[ \t]+(?<w4>Table|Fig(?:ure)?|File|Appendix|Text|Dataset|Data|Video)(?![\p{L}])`,
  // Supporting Information
  String.raw`(?<w6>[Ss]upporting\s+[Ii]nformation)(?![\p{L}])`,
  // Appendix B, Appendices
  String.raw`(?<w5>Appendi(?:x|ces)|APPENDI(?:X|CES))(?![\p{L}])(?:\s*(?<n5>${LIST}))?`,
  // Table 2, Figure 3B (the paper's own)
  String.raw`(?<w0>Table|TABLE|Fig(?:ure)?\.?|FIGURE)\s*(?<n0>[0-9IVX]+[A-Za-z]?)\b`,
].join('|') + ')';
const re = () => new RegExp(PATTERN, 'gu');
// (a bare "supplement" or "appendix" in lower case is prose: "as in the supplement, Table 2 shows")
const IN_SUPP = /(?:\b(?:[Ss]upplementa(?:l|ry)(?:\s+(?:[Aa]ppendi(?:x|ces)|[Mm]aterials?|[Dd]ata|[Ii]nformation|[Ff]iles?))?|Supplement(?:\s+\d{1,3})?|e?Appendix(?:\s+[A-Z0-9]{1,3})?|[Oo]nline\s+(?:[Ss]upplement|[Aa]ppendix|[Rr]esource(?:\s+\d+)?)|[Aa]dditional\s+file\s+\d+|[Ss]upporting\s+[Ii]nformation))\s*[,:]?\s*$/;

const kindOf = (word, num) => {
  const w = word.toLowerCase();
  if (/^tab/.test(w)) return 'table';
  if (/^fig/.test(w)) return 'figure';
  if (/^appendi|^online\s+appendix/.test(w)) return 'appendix';
  if (/^(?:resource|file|digital|dataset|text|video)/.test(w)) return 'file';
  return num ? 'file' : 'material';   // "Supplementary Data 1" is a file; "supplementary material" names none
};
const KIND_WORD = { table: 'Table', figure: 'Figure', appendix: 'Appendix', file: 'File', material: 'Material' };

/** The numbers a list names: "S1 and S2" -> [S1, S2], "1-3" -> [1, 2, 3] (a range of up to 20). */
function numbersOf(list) {
  if (!list) return [''];
  const parts = list.split(/\s*(?:,|and|&|to|[-–—])\s*/), seps = list.match(/\s*(?:,|and|&|to|[-–—])\s*/g) || [];
  const out = [];
  parts.forEach((p, i) => {
    const prev = out[out.length - 1], isRange = i > 0 && /[-–—]|to/.test(seps[i - 1] || '');
    const a = Number(String(prev || '').replace(/^S/, '')), b = Number(p.replace(/^S/, ''));
    if (isRange && Number.isInteger(a) && Number.isInteger(b) && b > a && b - a <= 20) for (let k = a + 1; k < b; k++) out.push(`${/^S/.test(prev) ? 'S' : ''}${k}`);
    out.push(i > 0 && /^S/.test(parts[0]) && /^\d/.test(p) ? `S${p}` : p);
  });
  return out.filter(Boolean);
}

/**
 * Every pointer in `text`, in order: { index, end, what: table|figure|appendix|file|material, num (as written: S2, 2, B, ''),
 * key (what:number, the S dropped and a figure's panel letter too: "Table S2", "Supplementary Table 2" and "eTable 2" are one),
 * label (as written, spaces made single), supplement (outside the paper's own numbered tables and figures) }.
 */
export function pointersIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(re())) {
    const g = m.groups, word = g.w9 || g.w1 || g.w7 || g.w8 || g.w2 || g.w3 || g.w4 || g.w5 || g.w6 || g.w0, list = g.n9 || g.n1 || g.n7 || g.n2 || g.n3 || g.n4 || g.n5 || g.n0 || '';
    // the paper's own Table 2, unless a supplement or an appendix is named just before it: "(Supplementary appendix, Table 2)",
    // "Appendix B, Table 3", "Online Resource 1: Table 2", "Supplementary Appendix Table 2", "Supplement 1, Table 2" (work queue row 15)
    const supplement = !g.w0 || IN_SUPP.test(String(text).slice(Math.max(0, m.index - 60), m.index));
    const nums = g.w0 ? [list] : g.n4 ? [`S${g.n4}`] : numbersOf(list);
    const what = kindOf(word, list);
    const one = m[0].replace(/\s+/g, ' ').trim();
    // a list's word made singular: "Tables S1 and S2" -> "Table S1", "Table S2"
    const head = (list && !g.n4 ? one.slice(0, one.length - list.replace(/\s+/g, ' ').length).trim() : one).replace(/(Table|Figure|Fig|Appendi(?:x|ces)|File|Resource|Text|Video|Dataset)s?(\.?)$/i, (x, w, dot) => (/^appendices$/i.test(w) ? w.replace(/ices$/i, 'ix') : w.replace(/s$/i, '')) + dot);
    nums.forEach((num, k) => {
      const bare = num.replace(/^S(?=\d)/, ''), keyNum = what === 'figure' ? bare.replace(/(?<=\d)[A-Za-z]$/, '') : bare;
      const label = nums.length === 1 && (!list || g.n4) ? one : `${head} ${num}`;
      out.push({ index: m.index, end: m.index + m[0].length, what, num, key: `${what}:${keyNum.toUpperCase()}`, label: label.replace(/\s+/g, ' ').trim(), supplement, part: k });
    });
  }
  return out;
}

/** The word a pointer's kind is written with in a label ("Table", "Appendix"). */
export const kindWord = what => KIND_WORD[what] || 'File';
