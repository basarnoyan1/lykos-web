// What the proof checker knows about clinical research and, in depth, about spine and neurosurgical research: the measures and their
// valid ranges, events, statistics, timepoints, denominators, and the cues that change what a passage means (negation, hedging, a result
// attributed to another study, a section that is not the study's own). Everything here is data; the checker's rules read it. A change
// to this file changes LEXICON_VERSION, and every cached proof is checked again.

export const LEXICON_VERSION = 'lex-2026-10-31.1';

// kind: score | angle | distance | time | age | proportion | count | event | grade | mass | volume | duration | index
// range: the values the measure can take ([min, max]); scales: alternative ranges a paper may use (VAS 0–10 or 0–100)
// definition: the measure means different things in different papers (radiographic or symptomatic, how many degrees, …)
// ambiguous: the abbreviation names other things too (ASD: adjacent-segment disease or adult spinal deformity)
export const MEASURES = [
  // patient-reported and clinical scores
  { id: 'odi', label: 'ODI', kind: 'score', re: /\bODI\b|Oswestry/, range: [0, 100], scales: [[0, 50]] },
  { id: 'vas', label: 'VAS', kind: 'score', re: /\bVAS\b|visual analog(?:ue)? scale/i, range: [0, 100], scales: [[0, 10], [0, 100]] },
  { id: 'nrs', label: 'NRS', kind: 'score', re: /\bNRS\b|numeri[c](?:al)? (?:pain )?rating scale/i, range: [0, 10] },
  { id: 'joa', label: 'JOA', kind: 'score', re: /\bJOA\b(?! ?BPEQ)|Japanese Orthop(?:a)?edic Association/, range: [-6, 29] },
  { id: 'mjoa', label: 'mJOA', kind: 'score', re: /\bmJOA\b|modified JOA|modified Japanese/, range: [0, 18] },
  { id: 'ndi', label: 'NDI', kind: 'score', re: /\bNDI\b|Neck Disability Index/i, range: [0, 100], scales: [[0, 50]] },
  { id: 'srs22', label: 'SRS-22', kind: 'score', re: /\bSRS[- ]?22r?\b|SRS[- ]?30\b/i, range: [1, 5] },
  { id: 'sf36', label: 'SF-36', kind: 'score', re: /\bSF[- ]?(?:36|12)\b|\bPCS\b|\bMCS\b|physical component summary|mental component summary/i, range: [0, 100] },
  { id: 'eq5d', label: 'EQ-5D', kind: 'index', re: /\bEQ[- ]?5D(?:[- ]?[35]L)?\b/i, range: [-0.6, 1], scales: [[-0.6, 1], [0, 100]] },
  { id: 'rmdq', label: 'RMDQ', kind: 'score', re: /\bRMDQ\b|Roland[- ]Morris/i, range: [0, 24] },
  { id: 'kps', label: 'KPS', kind: 'score', re: /\bKPS\b|Karnofsky/i, range: [0, 100], step: 10 },
  { id: 'mrs', label: 'mRS', kind: 'grade', re: /\bmRS\b|modified Rankin/i, range: [0, 6], integer: true },
  { id: 'gos', label: 'GOS', kind: 'grade', re: /\bGOS\b(?!-?E)|Glasgow Outcome Scale(?![- ]Extended)/i, range: [1, 5], integer: true },
  { id: 'gose', label: 'GOS-E', kind: 'grade', re: /\bGOS-?E\b|Glasgow Outcome Scale[- ]Extended/i, range: [1, 8], integer: true },
  { id: 'gcs', label: 'GCS', kind: 'grade', re: /\bGCS\b|Glasgow Coma Scale/i, range: [3, 15], integer: true },
  { id: 'nihss', label: 'NIHSS', kind: 'score', re: /\bNIHSS\b/, range: [0, 42], integer: true },
  { id: 'nurick', label: 'Nurick', kind: 'grade', re: /\bNurick\b/i, range: [0, 5], integer: true },
  { id: 'engel', label: 'Engel', kind: 'grade', re: /\bEngel\b/i, range: [1, 4], roman: true },
  { id: 'ilae', label: 'ILAE', kind: 'grade', re: /\bILAE\b/, range: [1, 6], integer: true },
  { id: 'hunthess', label: 'Hunt–Hess', kind: 'grade', re: /Hunt[- –]?(?:and[- ])?Hess/i, range: [1, 5], integer: true },
  { id: 'wfns', label: 'WFNS', kind: 'grade', re: /\bWFNS\b/, range: [1, 5], integer: true },
  { id: 'fisher', label: 'Fisher', kind: 'grade', re: /\b(?:modified )?Fisher (?:grade|scale)/i, range: [0, 4], integer: true },
  { id: 'spetzler', label: 'Spetzler–Martin', kind: 'grade', re: /Spetzler[- –]?Martin/i, range: [1, 6], roman: true },
  { id: 'simpson', label: 'Simpson', kind: 'grade', re: /\bSimpson (?:grade|grading)/i, range: [1, 5], roman: true },
  { id: 'who', label: 'WHO grade', kind: 'grade', re: /\bWHO (?:CNS )?grade/i, range: [1, 4], roman: true },
  { id: 'asia', label: 'ASIA/Frankel', kind: 'grade', re: /\bASIA\b|\bAIS\b grade|Frankel/i, range: null },
  { id: 'clavien', label: 'Clavien–Dindo', kind: 'grade', re: /Clavien(?:[- –]?Dindo)?/i, range: [1, 5], roman: true },
  { id: 'odom', label: 'Odom', kind: 'grade', re: /\bOdom\b|\bMacnab\b/i, range: null },
  { id: 'ki67', label: 'Ki-67', kind: 'proportion', re: /\bKi-?67\b|\bMIB-?1\b/i, range: [0, 100] },
  { id: 'eor', label: 'extent of resection', kind: 'proportion', re: /extent of resection|\bEOR\b|gross[- ]total resection|\bGTR\b|subtotal resection|\bSTR\b/i, range: [0, 100], definition: true },
  // radiographic (spine)
  { id: 'cobb', label: 'Cobb', kind: 'angle', re: /\bCobb\b|^\s*scoliosis\s*(?:\(|$)|angle of (?:the )?scoliotic curv|scoliotic curvature/i, range: [0, 180] },
  { id: 'sva', label: 'SVA', kind: 'distance', re: /\bSVA\b|sagittal vertical axis|C7[- ]?(?:plumb|SVA|PL\b)|global sagittal balance/i, range: [-200, 400], units: ['mm', 'cm'] },
  { id: 'pill', label: 'PI–LL', kind: 'angle', re: /\bPI\s*[-–−]\s*LL\b|pelvic incidence[- ](?:minus|–|-)[- ]lumbar lordosis|PI[- ]LL mismatch/i, range: [-90, 90] },
  { id: 'pi', label: 'PI', kind: 'angle', re: /\bPI\b(?!\s*[-–−]\s*LL)|pelvic incidenc[e](?![- ](?:minus|–|-)[- ]lumbar)/, range: [10, 110] },
  { id: 'll', label: 'LL', kind: 'angle', re: /(?<![-–−]\s*)\bLL\b|lumbar lordosis/i, range: [-40, 110] },
  { id: 'pt', label: 'PT', kind: 'angle', re: /\bPT\b|pelvic tilt/, range: [-30, 70] },
  { id: 'ss', label: 'SS', kind: 'angle', re: /\bSS\b|sacral slope/, range: [-10, 90] },
  { id: 'tk', label: 'TK', kind: 'angle', re: /\bTK\b|thoracic kyphosis/i, range: [-30, 130] },
  { id: 'tpa', label: 'TPA', kind: 'angle', re: /\bT1PA\b|\bTPA\b|T1 pelvic angle/i, range: [-20, 80] },
  { id: 'segl', label: 'segmental lordosis', kind: 'angle', re: /segmental (?:lordosis|angle|lordotic angle)/i, range: [-40, 60] },
  { id: 'cva', label: 'coronal balance', kind: 'distance', re: /coronal (?:balance|vertical axis|imbalance)|\bCVA\b|C7[- ]?CSVL/i, range: [-150, 150] },
  { id: 'dh', label: 'disc height', kind: 'distance', re: /dis[ck] height|intervertebral (?:space|height|disc height)|\bDHI?\b|\bIVS\b/i, range: [0, 25] },
  { id: 'rom', label: 'ROM', kind: 'angle', re: /range of (?:motion|movement)|\bROM\b/, range: [0, 90] },
  { id: 'pelvicfix', label: 'pelvic fixation', kind: 'technique', re: /\biliac (?:fixation|screws?)|\b(?:sacro|spino)pelvic fixation|\bS2AI\b|\bS2[- ]alar[- ]iliac/i },
  { id: 'fusion', label: 'fusion', kind: 'proportion', re: /fusion rate|solid fusion|fusion was (?:achieved|obtained|observed)|union rate|bony fusion/i, range: [0, 100], definition: true },
  // perioperative
  { id: 'ebl', label: 'blood loss', kind: 'volume', re: /blood loss|\bEBL\b/i, range: [0, 30000], units: ['mL', 'ml', 'cc', 'L'] },
  { id: 'optime', label: 'operative time', kind: 'duration', re: /operati(?:ve|on|ng) (?:time|duration)|surgical (?:time|duration)|duration of (?:the )?(?:surgery|operation|procedure)/i, range: [0, 1500], units: ['min', 'h'] },
  { id: 'los', label: 'length of stay', kind: 'duration', re: /length of (?:hospital )?stay|hospital stay|\bLOS\b|hospitali[sz]ation (?:time|duration|length)/i, range: [0, 365], units: ['days', 'd'] },
  { id: 'levels', label: 'levels', kind: 'count', re: /\blevels?\b|\bsegments?\b|\bsegmental\b|\bvertebrae\b/i, range: [1, 20] },
  // population
  { id: 'age', label: 'age', kind: 'age', re: /\bage[sd]?\b|years old|year-old|\baged\b/i, range: [0, 110], units: ['y', 'years', 'yr'] },
  { id: 'female', label: 'female', kind: 'proportion', re: /\bfemales?\b|\bwom[ae]n\b|\bF\/M\b|female[- ]to[- ]male|\bF:M\b|(?<=%\s?)F\b/i, range: [0, 100] },
  { id: 'male', label: 'male', kind: 'proportion', re: /\bmales?\b|\bm[ae]n\b|\bM\/F\b|male[- ]to[- ]female|\bM:F\b/i, range: [0, 100] },
  { id: 'sex', label: 'sex', kind: 'proportion', re: /\bsex\b|\bgender\b/i, range: [0, 100] },
  { id: 'patients', label: 'patients', kind: 'count', re: /\bpatients?\b|\bcases?\b|\bsubjects?\b|\bparticipants?\b|\bindividuals?\b|\(\s*n\s*=(?=\s*\d)/i, range: [1, 1e6] },
  { id: 'followup', label: 'follow-up', kind: 'time', re: /follow[- ]?up|followed (?:up )?for|\bFU\b/i, range: [0, 600], units: ['mo', 'months', 'y', 'years', 'wk', 'weeks', 'days'] },
  { id: 'bmi', label: 'BMI', kind: 'index', re: /\bBMI\b|body mass index/i, range: [10, 80] },
  { id: 'tscore', label: 'T-score', kind: 'index', re: /\bT[- ]?scores?\b|\bT (?:was|is) (?:lower|less|below|under|higher|greater|above) than\b|bone mineral density|\bBMD\b|\bDXA\b|\bDEXA\b/i, range: [-7, 5] },
  { id: 'smoking', label: 'smoking', kind: 'proportion', re: /\bsmok(?:er|ers|ing|ed)\b|tobacco/i, range: [0, 100] },
  // events (counted n/N)
  { id: 'loosening', label: 'screw loosening', kind: 'event', re: /\bloosening|\bloosened|\bradiolucen(?:t|cy)|\bhalo (?:sign|zone|formation)/i },
  { id: 'breakage', label: 'implant breakage', kind: 'event', re: /breakage|material failure|broken (?:rod|screw|implant)|fractured (?:rods?|screws?)|(?:screws?|rods?) (?:were|was) broken|(?:rod|screw|implant|hardware|instrument(?:ation)?) (?:fracture|breakage|failure)|fracture of (?:the )?(?:rod|screw)|implant failure|hardware failure|instrumentation failure|mechanical failure/i, definition: true },
  { id: 'pseudarthrosis', label: 'pseudarthrosis', kind: 'event', re: /pseud(?:o)?arthrosis|non-?union|nonfusion|failed fusion/i, definition: true },
  { id: 'revision', label: 'revision', kind: 'event', re: /\brevision|\brevised\b|\bfurther surger|\bnew surgery|\bcorrective surger|\bre-?operat|\breintervention|\bre-intervention|\bsecondary (?:surgery|operation)|\breturned to (?:the )?(?:operating|theatre)/i, definition: true },
  { id: 'asd', label: 'adjacent-segment disease', kind: 'event', re: /adjacent[- ]segment (?:disease|deasese|desease|diseasee|degeneration|pathology|failure|problems?)|degenerat\w* (?:changes? )?(?:at|of|in) (?:the )?adjacent (?:segments?|levels?)|adjacent[- ]level (?:disease|degeneration)|\bASDis\b|\bASDeg\b|\bASP\b|\bASD\b/i, definition: true, ambiguous: { re: /\bASD\b/, other: 'adult spinal deformity', otherRe: /adult spinal deformit/i } },
  { id: 'pjk', label: 'PJK', kind: 'event', re: /proximal junctional (?:kyphosis|failure|angle)|\bPJK\b|\bPJF\b|\bPJA\b|\bproximal kyphosis/i, definition: true },
  { id: 'djk', label: 'DJK', kind: 'event', re: /distal junctional (?:kyphosis|failure)|\bDJK\b/i, definition: true },
  { id: 'infection', label: 'infection', kind: 'event', re: /\binfection|\binfected|\bSSI\b|\bwound (?:complication|dehiscence)|\babscess|\bosteomyelitis/i },
  { id: 'durotomy', label: 'durotomy', kind: 'event', re: /durotomy|dural (?:tear|laceration)|\bCSF leak|cerebrospinal fluid (?:leak|fistula)/i },
  { id: 'hematoma', label: 'hematoma', kind: 'event', re: /h(?:a)?ematoma/i },
  { id: 'neuro', label: 'neurological deficit', kind: 'event', re: /neurologic(?:al)? (?:deficit|complication|worsening|injury|deterioration)|motor (?:deficit|weakness)|new (?:radiculopathy|deficit)|foot drop|paresis/i },
  { id: 'vte', label: 'thromboembolism', kind: 'event', re: /deep vein thrombosis|\bDVT\b|pulmonary embol|thromboembol/i },
  { id: 'death', label: 'death', kind: 'event', re: /\bdeaths?\b|\bdied\b|mortality|deceased/i },
  { id: 'recurrence', label: 'recurrence', kind: 'event', re: /recurren(?:ce|t)|recurred|regrowth|tumou?r progression|local control/i, definition: true },
  { id: 'seizure', label: 'seizure', kind: 'event', re: /seizures?|epilep/i },
  { id: 'hydrocephalus', label: 'hydrocephalus', kind: 'event', re: /hydrocephalus|shunt (?:failure|malfunction|revision)/i },
  { id: 'vasospasm', label: 'vasospasm', kind: 'event', re: /vasospasm|delayed cerebral isch(?:a)?emia|\bDCI\b/i },
  { id: 'rebleed', label: 'rebleeding', kind: 'event', re: /re-?bleed|re-?hemorrhage|re-?rupture/i },
  { id: 'complication', label: 'complications', kind: 'event', re: /complications?|adverse events?/i, definition: true },
];

export const MEASURE = Object.fromEntries(MEASURES.map(m => [m.id, m]));

export const STAT = {
  mean: /\bmeans?\b|\baverage[ds]?\b/i,
  median: /\bmedians?\b/i,
  sd: /±|\bSD\b|standard deviation/,
  iqr: /\bIQR\b|interquartile/i,
  range: /\brange[ds]?\b/i,
  ci: /\b9[059]\s*%\s*CI\b|confidence interval/i,
  p: /\bp\s*[<=>≤≥]\s*0?\.\d/i,
};

export const TIME = {
  pre: /\bpre-?operative(?:ly)?\b|\bbefore (?:the )?(?:surgery|operation)\b|\bbaseline\b|\bpre-?op\b|\binitial\b/i,
  post: /\bpost-?operative(?:ly)?\b|\bafter (?:the )?(?:surgery|operation)\b|\bpost-?op\b|\bimmediate(?:ly)?\b/i,
  final: /\b(?:final|last|latest|most recent) (?:follow[- ]?up|visit|evaluation|control|examination)\b|\bat (?:the )?end of (?:the )?follow[- ]?up\b/i,
  // a stated time of measurement: "at 12 months", "at the 2-year follow-up", "12-month postoperative", "2 years postoperatively"
  timed: /\bat (?:the )?(\d+(?:\.\d+)?|one|two|three|four|five|six|twelve|eighteen|twenty-four)(?:st|nd|rd|th)? ?[- ]?(months?|years?|weeks?|mo|yrs?)\b|\b(\d+|one|two|three|six|twelve)[- ](months?|years?|weeks?)(?:[- ](?:postoperative(?:ly)?|follow[- ]?up|visit|control|after (?:the )?surgery))\b|\b(\d+|one|two|three|six|twelve)(?:st|nd|rd|th)? (?:postoperative )?(months?|years?) (?:postoperative(?:ly)?|after (?:the )?surgery|follow[- ]?up)\b/i,
};

// a count over these is not over patients
export const DENOMINATOR_UNITS = /\b(levels?|segments?|screws?|rods?|discs?|disks?|procedures?|operations?|surgeries|implants?|vertebrae|sides?|cages?|constructs?)\b/i;

export const NEGATION = /\b(?:no|not|none|nor|neither|without|never|nil|absence of|absent|free of|did not|didn't|does not|was not|were not|wasn't|weren't|had no|has no|have no|no evidence of|ruled out|failed to|lack(?:ed|ing)? of|nobody|zero)\b|n't\b/i;
export const HEDGE = /\b(?:approximately|approx\.?|about|around|nearly|almost|roughly|up to|at least|at most|more than|less than|over|under|estimated|some|several|majority|minority)\b|[~≈≲≳<>≤≥]/i;
// a result that belongs to another study: a citation, "et al.", "previous studies", "the literature"
export const ATTRIBUTION = /\bet al\b\.?|\b(?:previous|prior|earlier|other|similar|recent) (?:stud(?:y|ies)|reports?|series|authors|investigators|trials?|literature)\b|\bha(?:ve|s) (?:been )?(?:reported|described|shown|demonstrated|found)\b|\bin the literature\b|\baccording to\b|\breported by\b|\bmeta-analys[ie]s\b|\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]|\((?:[A-Z][A-Za-z'’-]+(?: et al\.?| and [A-Z][A-Za-z'’-]+)?,? (?:19|20)\d\d[a-z]?(?:; ?)?)+\)/;
// the study's own result (outweighs a citation in the same sentence)
export const OWN = /\b(?:in (?:our|this|the present|the current) (?:study|series|cohort|group)|we (?:found|observed|noted|recorded|saw|had)|our (?:patients|results|series|cohort|data))\b/i;
export const DEFINITION = /\b(?:defined as|was defined|were defined|definition of|considered (?:as|to be|present)|diagnosed (?:as|when|if)|criteria for)\b/i;

// section headings (a line that is only a heading, maybe numbered "3. Results", "2.1 Patients")
export const ZONES = [
  ['abstract', /^(?:abstract|summary|structured abstract)$/i],
  ['introduction', /^(?:introduction|background|purpose|objectives?)$/i],
  ['methods', /^(?:(?:materials?|patients?|subjects?) and methods?|methods?|methodology|study design|patients|study population|surgical (?:technique|procedure)|statistical analysis|data collection|radiographic (?:evaluation|assessment|measurements?)|clinical (?:evaluation|assessment)|outcome measures?)$/i],
  ['results', /^(?:results?|findings|outcomes?|clinical results|radiographic results|complications|case reports?|illustrative cases?)$/i],
  ['discussion', /^(?:discussion|comment|limitations?|strengths and limitations|study limitations)$/i],
  ['conclusion', /^(?:conclusions?|concluding remarks|summary and conclusions?)$/i],
  ['references', /^(?:references|bibliography|literature cited|works cited|reference list)$/i],
  ['backmatter', /^(?:acknowledg(?:e)?ments?|funding(?: sources?| statement)?|conflicts? of interests?|competing interests?|disclosures?|declarations?|ethics(?: approval| statement)?|author contributions?|data availability(?: statement)?|informed consent(?: statement)?|institutional review board statement|abbreviations)$/i],
  // not the study's own text
  ['commentary', /^(?:comments?|commentary|editorial(?: comments?)?|invited commentary|editor'?s'? (?:note|comments?)|reviewer'?s'? comments?|in reply|reply(?: from the authors)?|authors'? reply|response(?: to (?:the )?(?:letter|comments?))?|letters? to the editor|discussant'?s'? comments?|perspectives?)$/i],
];
// commentary signed by a person and institution under a "Comments" section (Neurosurgery, JNS): the signature lines
export const SIGNATURE = /^[A-Z][a-z]+(?: [A-Z]\.)* [A-Z][A-Za-z'’-]+(?:, (?:MD|PhD|MSc|FRCSC|FAANS|FACS))*\s*$/;

export const DOI = /\b10\.\d{4,9}\/[^\s"<>,;)\]]+/gi;
