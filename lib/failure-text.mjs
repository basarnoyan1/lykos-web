// A thrown error as a sentence a researcher can act on: what failed, its cause in plain words and one step to take (plan W13, finding 4;
// 7 Nov 2026). Before, 79 failures appended the raw message ("Could not import: Failed to fetch", "…: Unexpected token < in JSON").
// lib/provider-error.mjs does this for model providers; this is for the rest: a file read, an import, a lookup, an export.
//
// The kinds: offline, permission, not-found, format, busy, sign-in. They are read from what the runtime threw (a fetch's TypeError, an
// HTTP status on `status`, an os error from the desktop shell, a DOMException's name, a parser's SyntaxError) and never from a sentence
// Lykos wrote itself: an error of no known kind keeps its own words, cut at a word, so a message that already names its step stays whole.
// Pure: tested in test/failure-text.test.mjs.

const redact = s => String(s || '').replace(/\s+/g, ' ').replace(/\b(?:sk|key|pk)-[\w-]{8,}/gi, '…').replace(/([?&](?:api_?key|key|token)=)[^&\s]+/gi, '$1…').trim();
const httpStatus = err => {
  const n = Number(err?.status || err?.cause?.status || 0);
  if (n >= 100) return n;
  const m = /^(\d{3})\b|\b(?:HTTP|answered|status)\s+(\d{3})\b/i.exec(String(err?.message || ''));
  return m ? Number(m[1] || m[2]) : 0;
};

// the low-level shapes of each kind: what Node, WebKit, the File System Access API and the desktop shell (Rust os errors) say
const PERMISSION = /\b(?:EACCES|EPERM)\b|permission denied|operation not permitted|os error (?:1|13)\)|forbidden path|not allowed on the configured scope|^(?:NotAllowedError|SecurityError)\b/i;
const NOT_FOUND = /\bENOENT\b|no such file or directory|os error 2\)|^NotFoundError\b|could not be found at the time/i;
const OFFLINE = /^(?:TypeError: )?(?:Failed to fetch|Load failed|NetworkError)|\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH)\b|error sending request|dns error|failed to lookup address|network connection was lost|internet connection appears to be offline|could not connect to the server/i;
const FORMAT = /^SyntaxError\b|unexpected token|unexpected end of (?:json|input|data)|JSON Parse error|is not valid JSON|unrecognized token|^not an? (?:zip archive|Word document|OpenDocument file|PowerPoint file|PDF)\b|central directory damaged|local header missing|entry data missing|archive entry is outside|parsererror|invalid (?:xml|json|zip|pdf structure)|^InvalidPDFException\b/i;
const BUSY = /\bETIMEDOUT\b|timed? ?out|too many requests|rate limit|temporarily unavailable|service unavailable|overloaded/i;
const SIGN_IN = /unauthori[sz]ed|invalid api key|api key is (?:invalid|not valid)|not signed in|authentication failed|authentication required/i;

/** What a thrown error is: 'offline' | 'permission' | 'not-found' | 'format' | 'busy' | 'sign-in' | '' (no known kind). */
export function failureKind(err) {
  if (!err) return '';
  const status = httpStatus(err);
  if (status === 401 || status === 403 || status === 407) return 'sign-in';
  if (status === 404 || status === 410) return 'not-found';
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) return 'busy';
  const text = [err.name && err.message ? `${err.name}: ${err.message}` : '', err.message, err.cause?.message, err.code, err.cause?.code,
    typeof err === 'string' ? err : ''].filter(Boolean).join('\n');
  const lines = text.split('\n'), any = re => lines.some(l => re.test(l));
  if (any(PERMISSION)) return 'permission';
  if (any(NOT_FOUND)) return 'not-found';
  if (any(OFFLINE)) return 'offline';
  if (err.name === 'SyntaxError' || any(FORMAT)) return 'format';
  if (status >= 500 || any(BUSY)) return 'busy';
  if (any(SIGN_IN)) return 'sign-in';
  return '';
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
// `x` = { service: 'Crossref' (who answers), file: true (a file on this computer), write: true (writing it), steps: { kind: step } }: a page
// that knows a better step for a kind gives it ("Export it again from the database as RIS, BibTeX or CSV."). A cause follows a colon, so
// it starts in lower case unless it starts with a name; the step is its own sentence.
const who = x => x.service || 'the service';
const TEXT = {
  offline: x => [offline() ? 'this computer is offline.' : `${who(x)} could not be reached.`, 'Check the internet connection, then try again.'],
  'sign-in': x => [`${who(x)} refused the sign-in.`, 'Check the key or account in Settings, then try again.'],
  busy: x => [`${who(x)} is busy or did not answer in time.`, 'Wait a minute, then try again.'],
  'not-found': x => (x.file ? ['the file is no longer where it was.', 'It may have been moved or renamed: choose it again.']
    : [`${who(x)} has no record of it.`, 'Check the identifier, then try again.']),
  permission: x => (x.write ? ['Lykos may not write to that folder.', 'Choose another folder, or allow Lykos in System Settings, Privacy & Security.']
    : ['Lykos may not open this file.', 'Allow Lykos in System Settings, Privacy & Security, or move the file into the project folder.']),
  format: x => (x.file ? ['the file is not in the expected format, or it is damaged.', 'Save or export it again from the program that made it, then try again.']
    : [`${who(x)} answered with something Lykos could not read.`, 'Wait a minute, then try again.']),
};

/** A message cut at a word to `max` characters, with an ellipsis. */
const cut = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);

/**
 * The failure in plain words: { kind, cause, next, detail }. `detail` is what the runtime said (redacted), for a tooltip; an error that
 * already says its cause and step (lib/provider-error.mjs failure()) keeps them.
 */
export function failureOf(err, x = {}) {
  const detail = redact(err?.message || (typeof err === 'string' ? err : '') || '');
  if (err?.cause && typeof err.cause === 'string' && err.next) return { kind: err.kind || 'provider', cause: err.cause, next: err.next, detail };
  const kind = failureKind(err);
  if (!kind) return { kind: '', cause: '', next: '', detail };
  const [cause, next] = TEXT[kind](x);
  return { kind, cause, next: x.steps?.[kind] || next, detail };
}

/**
 * "Could not import refs.ris: the file is not in the expected format, or it is damaged. Save or export it again …": `what` failed, then
 * the cause and one step; an error of no known kind keeps its own words after the colon, cut at `max` characters.
 */
export function failureText(what, err, x = {}, { max = 120 } = {}) {
  const f = failureOf(err, x), head = String(what || 'Could not finish').replace(/[.:\s]+$/, '');
  if (f.cause) return `${head}: ${f.cause} ${f.next}`.trim();
  return f.detail ? `${head}: ${cut(f.detail, max)}` : `${head}.`;
}
