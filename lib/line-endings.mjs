// A text file as an editor holds it, and back as the file had it.
//
// A <textarea> normalises its value: CRLF and a lone CR become LF. A .nbib, .ris or .csv exported by another tool commonly has CRLF, so comparing
// the textarea with the decoded file said "edited" the moment the file opened, and saving without the conversion back would rewrite every line
// ending of someone else's file. `analyse` reads the style the file had (the dominant one when mixed) and a byte order mark; `forEditor` is the text
// as the textarea will hold it; `forFile` puts the style and the mark back.
const CRLF = /\r\n/g, CR = /\r(?!\n)/g, LF = /(?<!\r)\n/g;

/** The dominant line ending of `text` ('\r\n', '\n' or '\r'; '\n' when there is none) and whether it begins with a byte order mark. */
export function analyse(text = '') {
  const s = String(text);
  const bom = s.charCodeAt(0) === 0xFEFF;
  const crlf = (s.match(CRLF) || []).length, cr = (s.match(CR) || []).length, lf = (s.match(LF) || []).length;
  const eol = crlf >= lf && crlf >= cr && crlf > 0 ? '\r\n' : cr > lf && cr > 0 ? '\r' : '\n';
  return { eol, bom, mixed: [crlf, cr, lf].filter(n => n > 0).length > 1 };
}
/** The text as a textarea holds it: no byte order mark, every line ending LF. */
export const forEditor = text => String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
/** The editor's text as the file had it: its line ending and its byte order mark. */
export const forFile = (text, { eol = '\n', bom = false } = {}) => `${bom ? '\uFEFF' : ''}${eol === '\n' ? String(text) : String(text).replace(/\n/g, eol)}`;
/** Whether the first bytes are a UTF-8 byte order mark (a TextDecoder drops it, so the bytes are asked). */
export const hasBom = bytes => !!bytes && bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
