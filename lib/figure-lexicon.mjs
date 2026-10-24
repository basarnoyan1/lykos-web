// The words and thresholds behind figure-need detection (plan §4.15c.5 and §4.15c.6),
// kept as data so that no rule carries a literal of its own: the readers in
// lib/figure-text.mjs and lib/figure-lineage.mjs compile these lists, and a
// later change of vocabulary or threshold is an edit here.
//
// Entries are regular-expression sources without flags (matched
// case-insensitively, on word boundaries) unless a comment says plain text.
// Nothing here reads a file, a clock or a locale.

// ---- thresholds ---------------------------------------------------------------------

/**
 * Every named parameter of the detection rules. The first block is plan §4.15c.5
 * (defaults from the first review measured, to be re-tuned on a second project,
 * none measured for cost); the second block is the other limits the rules
 * state in §4.3, §5.1 and §5.4.
 */
export const PARAMS = Object.freeze({
  // staleness: an input must be newer than the output by more than this (seconds)
  NEWER_S: 120,
  // baseline adoption: every resolved input's mtime at or below the output's (seconds)
  ADOPT_MARGIN_S: 0,
  // the `time` kind is off for a folder when this share of its files ...
  COPIED_SHARE: 0.6,
  // ... falls in one window of this many seconds
  COPIED_WINDOW_S: 10,
  // files of one cause that form one finding
  GROUP_MIN: 3,
  // studies a pooled result needs to qualify for a figure
  K_FIG: 3,
  // studies from which a funnel plot is informative
  K_FUNNEL: 10,
  // content tokens a request and a figure must share
  MATCH_TOKENS: 2,
  // tolerated share of the profile width
  WIDTH_TOL: 0.01,
  // seconds between two focus-triggered passes
  FOCUS_FLOOR: 60,
  // figure rows shown on the Overview
  OVERVIEW_CAP: 3,

  // M1: a figure mention this many characters from a "former" word is not a citation
  FORMER_WINDOW: 40,
  // §4.3 step 2: script size read, in bytes; local imports followed to this depth
  SCRIPT_MAX_BYTES: 400 * 1024,
  IMPORT_DEPTH: 3,
  // keys a subscript name table needs before it counts as a set of figure names
  NAME_TABLE_MIN: 3,
  // §5.1: bytes read per pass; no file above FILE_MAX_BYTES is read
  BYTE_BUDGET: 4 * 1024 * 1024,
  FILE_MAX_BYTES: 8 * 1024 * 1024,
});

// ---- requests (R1) ------------------------------------------------------------------

/** What a reviewer or editor can ask for. "figure" counts only with a qualifier ("Figs. 7-9" is a reference). */
export const FIGURE_NOUNS = [
  'for(?:r)?est plots?', 'funnel plots?', 'plots?', 'graphs?', 'charts?', 'diagrams?', 'flow ?charts?',
  'heat ?maps?', 'kaplan[- ]meier(?: curves?| plots?)?', 'survival curves?', 'visuali[sz]ations?',
  '(?:new|additional|extra|another) figures?',
];

/**
 * Words that turn a noun into an ask. Whole words: "add" does not match "added". A strong ask is a request by itself;
 * a weak ask ("please", "needs", "must", "should", "consider") is a request only when the sentence also names a drawing
 * verb, so "Please explain the funnel plot asymmetry" is not one.
 */
export const ASK_STRONG = [
  'add', 'include', 'provide', 'present', 'show', 'display', 'draw', 'ideally', 'would like',
  'suggest(?:s|ed)?', 'request(?:s|ed)?', 'prefer(?:s|red)?', 'recommend(?:s|ed)?',
  'lacks?', '(?:would be )?helpful to have', 'would be (?:nice|useful|helpful)', 'would benefit from',
];
export const ASK_WEAK = ['should', 'needs?', 'consider', 'please', 'must'];
export const ASK_WORDS = [...ASK_STRONG, ...ASK_WEAK];

/** What a weak ask must be joined to: a drawing verb before the noun, or a passive form after it ("a flow chart should be added"). */
export const DRAW_VERBS = ['add', 'include', 'provide', 'present(?:ed)?', 'show', 'display', 'draw', 'plot', 'create', 'insert', 'make', 'construct', 'generate', 'produce'];
export const DRAW_PASSIVE = ['added', 'included', 'provided', 'presented', 'shown', 'displayed', 'drawn', 'plotted', 'created', 'inserted', 'made', 'constructed', 'generated', 'produced'];

/** A sentence that cites an existing figure revises it; it asks for a new one only when it says so. */
export const NEW_FIGURE_WORDS = ['new', 'additional', 'another', 'extra', 'separate'];

/** A response that declines the request (R1, state "conflict"). */
export const DECLINE_WORDS = ['too few', 'not (?:feasible|possible|meaningful)', 'unable', 'could not', 'cannot'];

/** A sentence matching one of these reports work that is already done or is not a request. */
export const REQUEST_SKIP = ['\\bwe have (?:added|removed)\\b', '\\bwas removed\\b', '\\bnow shows\\b', '\\[\\s*authors?\\b[^\\]]*\\]'];

/** A figure mention within PARAMS.FORMER_WINDOW characters of one of these is not a citation. */
export const FORMER_WORDS = ['former', 'formerly', 'removed', 'dropped', 'old'];

/** Where the answer to a point begins, and where a new point begins (a paragraph that starts with one). */
export const RESPONSE_MARKERS = ["(?:authors?['’]?\\s+)?(?:response|reply)", 'answer'];
export const COMMENT_MARKERS = ['general\\s+comments?\\b', 'specific\\s+comments?\\b', 'editor,?\\s+comments?\\b', 'reviewer\\b', 'referee\\b', 'editor\\b', 'comments?\\b', 'points?\\b', 'concerns?\\b', 'major\\b', 'minor\\b', 'queries\\b|query\\b', 'r\\d'];

// ---- legends (M1, M2) ---------------------------------------------------------------

/** Words that make a bracket in a legend a placeholder: "[to be added]", "[add legend]". */
export const PLACEHOLDER_WORDS = ['state(?! of)', 'provide', 'add', 'to be', 'tbd', 'insert', 'describe'];

/** A legend that names a clinical image is supplied, not drawn (M1 generatable 'external'). */
export const CLINICAL_IMAGE_WORDS = ['radiographs?', 'micrographs?', 'retrieved', 'cases?', 'patients?', 'photographs?'];

// ---- guide declarations (T2 `declared`) ---------------------------------------------

/** Labelled, as plan §4.15c.6 asks: each entry is one way a guide says an output is behind. */
export const DECLARED_STALE = [
  { id: 'still', source: 'still (?:labelled|uses|v\\d+)' },
  { id: 'not-rebuilt', source: '(?:were|was|have been|has been|not)(?: not)? (?:rebuilt|regenerated|updated)' },
  { id: 'out-of-date', source: 'out of date' },
];

/** A noun in a declaration gives the file class the declaration binds to. `pages`: the page images of a PDF's stem family bind too. */
export const EXTENSION_CLASSES = [
  { id: 'pdf', noun: '\\bpdfs?\\b', ext: ['.pdf'], pages: true },
  { id: 'image', noun: '\\b(?:png|jpe?g|svg|images?|figures?|plots?)\\b', ext: ['.png', '.jpg', '.jpeg', '.svg'], pages: false },
  { id: 'word', noun: '\\b(?:docx|word documents?|manuscripts?)\\b', ext: ['.docx'], pages: false },
  { id: 'sheet', noun: '\\b(?:xlsx|workbooks?|spreadsheets?|csv)\\b', ext: ['.xlsx', '.xls', '.csv'], pages: false },
];

/** Function words dropped from a declaration's identifying tokens (plain text). */
export const FUNCTION_WORDS = ['the', 'and', 'are', 'were', 'was', 'not', 'for', 'with', 'after', 'before', 'since', 'until', 'from', 'still', 'that', 'this', 'these', 'those', 'have', 'has', 'been', 'all', 'any', 'but', 'its', 'our', 'out', 'date', 'rebuilt', 'regenerated', 'updated', 'labelled', 'uses', 'round', 'version', 'content', 'unchanged'];

/** Words that never identify a file in a declaration (plain text). */
export const DECLARATION_STOP_WORDS = ['evidence', 'table', 'tables', 'figure', 'figures', 'report', 'reports', 'files', 'current', 'folder'];

/** A clause that limits a declaration: "after Round 13". */
export const SCOPE_CLAUSE = '\\b(?:after|since|before|until|from)\\s+(?:round|revision|version|v)\\s*\\d+';

// ---- paths --------------------------------------------------------------------------

/** A path segment that marks scratch, an archive or a superseded copy (plan §4.15c.3 step 1). */
export const SCRATCH_PATH = /^(old versions|archive|claude outputs|node_modules|__pycache__|_.*)$/i;

/** Extensions of a figure file, and of files a script reads or writes as data. */
export const FIGURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'pdf', 'eps', 'tif', 'tiff', 'gif', 'webp'];
export const DATA_EXTENSIONS = ['json', 'csv', 'tsv', 'xlsx', 'xls', 'xlsm', 'ods', 'txt', 'md', 'docx', 'tex', 'bib', 'ris', 'yaml', 'yml', 'pkl', 'parquet', 'feather', 'npy', 'npz'];
/** What an input's content is, for fingerprinting (plan §4.15c.3 `kind`). */
export const INPUT_KINDS = { cells: ['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv'], text: ['txt', 'md', 'docx', 'tex', 'bib', 'ris', 'yaml', 'yml'] };

/** Words in a guide line that give the status of a figure (plain text). */
export const STATUS_WORDS = ['pending', 'missing', 'not yet', 'todo', 'to do', 'draft', 'superseded', 'placeholder', 'final'];

/** The word before a full stop that does not end a sentence (plain text, lower case, dots inside allowed, final dot not). */
export const ABBREVIATIONS = ['fig', 'figs', 'e.g', 'i.e', 'al', 'vs', 'cf', 'dr', 'prof', 'approx', 'ref', 'refs', 'eq', 'eqs', 'etc'];
