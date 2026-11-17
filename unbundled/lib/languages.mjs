// Registry language metadata, not guesses from translated titles or abstracts.
const aliases = {eng:'en',english:'en',fre:'fr',fra:'fr',french:'fr',ger:'de',deu:'de',german:'de',chi:'zh',zho:'zh',chinese:'zh',rus:'ru',russian:'ru',spa:'es',spanish:'es',por:'pt',portuguese:'pt',ita:'it',italian:'it',tur:'tr',turkish:'tr',jpn:'ja',japanese:'ja',kor:'ko',korean:'ko',dut:'nl',nld:'nl',dutch:'nl',pol:'pl',polish:'pl',cze:'cs',ces:'cs',czech:'cs',ukr:'uk',ukrainian:'uk',ara:'ar',arabic:'ar',gre:'el',ell:'el',greek:'el',per:'fa',fas:'fa',persian:'fa',swe:'sv',swedish:'sv',dan:'da',danish:'da',nor:'no',norwegian:'no',fin:'fi',finnish:'fi',hun:'hu',hungarian:'hu',rum:'ro',ron:'ro',romanian:'ro',heb:'he',hebrew:'he',srp:'sr',serbian:'sr',hrv:'hr',croatian:'hr'};
const names = new Intl.DisplayNames(['en'], {type:'language'});
export function languageCodes(value) {
  const tokens = (Array.isArray(value) ? value.flatMap(x => String(x).split(/[;,/]/)) : String(value || '').split(/[;,/]/));
  return [...new Set(tokens.map(x => x.trim().toLowerCase().replace(/_/g,'-')).map(x => aliases[x] || aliases[x.split('-')[0]] || x.split('-')[0]).filter(x => /^[a-z]{2,3}$/.test(x) && !['und','unk','mul','zxx'].includes(x)))];
}
export const normalizeLanguage = value => languageCodes(value).join('; ');
export function nonEnglishLanguage(value) {
  return languageCodes(value).filter(x => x !== 'en').map(x => { try { const name = names.of(x); return name === x ? '' : name; } catch { return ''; } }).filter(Boolean).join(', ');
}
export function storedLanguage(paper) {
  if (paper.language) return normalizeLanguage(paper.language);
  if (paper.raw && typeof paper.raw === 'object' && !Array.isArray(paper.raw)) return normalizeLanguage(paper.raw.language);
  const raw = Array.isArray(paper.raw) ? paper.raw.join('\n') : String(paper.raw || '');
  return normalizeLanguage(/^LA\s+-\s*(.+)$/im.exec(raw)?.[1] || /(?:language|langid)\s*=\s*[{"]([^}"]+)/i.exec(raw)?.[1]);
}
