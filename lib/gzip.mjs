// gzip for backups and recovery copies: CompressionStream is in WebKit, Chromium and Node 22; nothing is vendored.
export async function gzipText(text) { return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob(); }
export async function gunzipBlob(blob) { return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
/** Whether bytes start with the gzip magic number (a `.json.gz` copy, whatever its name says). */
export const isGzip = bytes => bytes?.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
/** The text of a file that may be gzip or plain UTF-8; a gzip that does not inflate throws, so it is reported, never taken for empty. */
export async function textOf(bytes) {
  if (!isGzip(bytes)) return new TextDecoder().decode(bytes);
  try { return await gunzipBlob(new Blob([bytes])); } catch (err) { throw new Error(`the compressed copy could not be read (${err?.message || err})`); }
}
