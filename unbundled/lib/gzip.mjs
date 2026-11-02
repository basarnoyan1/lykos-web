// gzip for backups and recovery copies: CompressionStream is in WebKit, Chromium and Node 22; nothing is vendored.
/**
 * `text`: a string, or the UTF-8 bytes of one (a file as read), compressed as they are. Fed to the stream 4 MB at a time: WebKit (the
 * desktop web view) fails a Blob stream of about 100 MB or more ("The I/O read operation failed", 31 Oct 2026), the size of a whole
 * 28,000-record project. A string is cut between UTF-16 code units, never inside a surrogate pair.
 */
export async function gzipText(text) {
  const cs = new CompressionStream('gzip'), w = cs.writable.getWriter(), out = new Response(cs.readable).blob(), STEP = 1 << 22;
  try {
    if (typeof text === 'string') {
      const enc = new TextEncoder();
      for (let i = 0; i < text.length;) {
        let end = Math.min(text.length, i + STEP);
        if (end < text.length && (text.charCodeAt(end - 1) & 0xFC00) === 0xD800) end--;
        await w.write(enc.encode(text.slice(i, end))); i = end;
      }
    } else {
      const b = text instanceof Uint8Array ? text : ArrayBuffer.isView(text) ? new Uint8Array(text.buffer, text.byteOffset, text.byteLength) : new Uint8Array(text);
      for (let i = 0; i < b.length; i += STEP) await w.write(b.subarray(i, i + STEP));
    }
    await w.close();
  } catch (err) { out.catch(() => {}); w.abort(err).catch(() => {}); throw err; }
  return out;
}
export async function gunzipBlob(blob) { return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
/** Whether bytes start with the gzip magic number (a `.json.gz` copy, whatever its name says). */
export const isGzip = bytes => bytes?.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
/** The text of a file that may be gzip or plain UTF-8; a gzip that does not inflate throws, so it is reported, never taken for empty. */
export async function textOf(bytes) {
  if (!isGzip(bytes)) return new TextDecoder().decode(bytes);
  try { return await gunzipBlob(new Blob([bytes])); } catch (err) { throw new Error(`the compressed copy could not be read (${err?.message || err})`); }
}
