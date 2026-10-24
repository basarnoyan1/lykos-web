// Cutting text down for a request without cutting the part that matters.
//
// A cut in the middle of a sentence, or a fixed slice from the start, sends the
// model the least informative words of a structured abstract (its background)
// and drops its methods and results. These helpers cut at sentence ends and, for
// abstracts, drop the background section first.

const SENTENCE_END = /[.!?…](?=["')\]]?\s|$)/g;

/** `text` cut to at most `max` characters at the last sentence end that fits (a hard cut when a sentence runs longer than half of it), with "[…]" marking the cut. */
export function clipSentences(text, max) {
  const t = String(text ?? '').replace(/[ \t]+/g, ' ').trim();
  if (t.length <= max) return t;
  const room = Math.max(1, max - 4);
  let cut = -1;
  for (const m of t.slice(0, room).matchAll(SENTENCE_END)) cut = m.index + 1;
  if (cut < room / 2) { const sp = t.lastIndexOf(' ', room); cut = sp > room / 2 ? sp : room; }
  return `${t.slice(0, cut).trimEnd()} […]`;
}

// Section headings of a structured abstract, as PubMed and most publishers write them.
const HEAD = /(?:^|\s)((?:BACKGROUND|INTRODUCTION|CONTEXT|OBJECTIVES?|AIMS?|PURPOSE|RATIONALE|METHODS?|MATERIALS? AND METHODS|DESIGN|SETTING|PARTICIPANTS|PATIENTS|INTERVENTIONS?|MAIN OUTCOME MEASURES?|RESULTS?|FINDINGS|CONCLUSIONS?|INTERPRETATION|LEVEL OF EVIDENCE)[A-Z /,&-]{0,30}):\s/g;
const LEAD = /^(BACKGROUND|INTRODUCTION|CONTEXT|RATIONALE)/;

/**
 * An abstract cut to at most `max` characters for a question about eligibility
 * or its facts: a structured abstract loses its background section first (the
 * least informative part for who was studied, how and what was found), then
 * whole sentences from the end. Under `max` it is returned unchanged.
 */
export function clipAbstract(text, max) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const heads = [...t.matchAll(HEAD)];
  if (heads.length >= 2 && LEAD.test(heads[0][1])) {
    const start = heads[1].index + (heads[1][0].startsWith(' ') ? 1 : 0);
    const rest = t.slice(start);
    if (rest.length >= max) return clipSentences(rest, max);
    // methods, results and conclusions whole; the background gives up the room they need
    return `${clipSentences(t.slice(0, start), max - rest.length - 1)} ${rest}`;
  }
  return clipSentences(t, max);
}

/**
 * A paper's text without its reference list. Extraction reads the paper's own
 * statements; the bibliography, often a tenth to a fifth of the pages, holds
 * none. Cut only when a "References" heading starts a tail that is at most
 * 35% of the text and reads as a reference list (numbered or author-led
 * lines); otherwise the text is returned as it was. `pages` markers of the form
 * "[[page N]]" are kept, and the note says where the cut is so the model can
 * read on with read_document if it needs to.
 */
export function stripReferences(text) {
  const t = String(text ?? '');
  const heads = [...t.matchAll(/\n[ \t]*(?:\[\[page \d+\]\]\s*)?(?:references|bibliography|literature cited|reference list)[ \t]*:?[ \t]*\n/gi)];
  // a reference entry starts with a number ("1.", "[1]") or an author ("Benzel EC:", "Smith J,")
  const START = /^\s*(?:\[\d{1,3}\]|\d{1,3}[.)]?)\s*\p{Lu}|^\s*\p{Lu}[\p{L}'-]+,?\s+(?:\p{Lu}\.?\s?){1,3}[:,.]/u;
  const ENTRY = /(?:^|\n)\s*(?:\[\d{1,3}\]|\d{1,3}[.)])\s+\p{Lu}[^\n]{15,}|(?:^|\n)\s*\p{Lu}[\p{L}'-]+,?\s+(?:\p{Lu}\.?\s?){1,3}[:,.][^\n]{15,}/gu;
  for (const h of heads.reverse()) {
    const tail = t.slice(h.index), body = tail.replace(/^\s*(?:\[\[page \d+\]\]\s*)?\S+[^\n]*\n/, '');
    if (tail.length > t.length * 0.35) continue;
    // What follows the heading must be a reference list from its first line to its last: a two-column PDF
    // can put body text after a "References" heading, and that text must stay.
    const lines = body.split('\n').map(l => l.trim()).filter(l => l && !/^\[\[page \d+\]\]$/.test(l));
    if (!START.test(lines[0] || '')) continue;
    if ((body.match(ENTRY) || []).length < 8) continue;
    const prose = lines.filter(l => l.split(/\s+/).length >= 12 && /[.!?]$/.test(l) && !/\d/.test(l)).length;
    if (prose > 3) continue;
    const page = [...t.slice(0, h.index).matchAll(/\[\[page (\d+)\]\]/g)].pop()?.[1];
    return `${t.slice(0, h.index).trimEnd()}\n\n[reference list omitted: ${tail.length} characters from page ${page || '?'}; read_document to see it]`;
  }
  return t;
}
