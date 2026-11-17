// The query visualizer's examples (query.html), in the shape of the Sham review's searches (deep brain stimulation, a sham or placebo condition, a trial), one per database.
export const EXAMPLES = [
  { id: 'pubmed', name: 'PubMed', detail: 'Numbered strategy, 9 lines', text: [
    '#1 "Deep Brain Stimulation"[Mesh] OR "deep brain stimulat*"[tiab] OR "responsive neurostimulat*"[tiab]',
    '#2 "subthalamic stimulation"[tiab:~3] OR "pallidal stimulation"[tiab:~3] OR "thalamic stimulation"[tiab:~3]',
    '#3 "sham surg*"[tiab] OR "placebo surg*"[tiab] OR "sham operat*"[tiab]',
    '#4 intracranial[tiab] OR "burr hole*"[tiab] OR stereotactic*[tiab]',
    '#5 #1 OR #2 OR (#3 AND #4)',
    '#6 "Placebos"[Mesh] OR sham[tiab] OR placebo*[tiab] OR "double blind*"[tiab] OR crossover[tiab]',
    '#7 randomized controlled trial[pt] OR randomized[tiab] OR randomised[tiab] OR randomly[tiab] OR trial[tiab]',
    '#8 animals[mh] NOT humans[mh]',
    '#9 (#5 AND #6 AND #7) NOT #8'].join('\n') },
  { id: 'scopus', name: 'Scopus', detail: 'One query, 3 concepts and an exclusion', text: 'TITLE-ABS-KEY("deep brain stimulat*" OR "responsive neurostimulat*" OR (thalam* W/3 stimulat*)) AND TITLE-ABS-KEY(sham OR placebo* OR "double blind*") AND TITLE-ABS-KEY(random* OR trial OR crossover) AND NOT TITLE(rat OR rats OR mice)' },
  { id: 'wos', name: 'Web of Science', detail: 'One query, 3 concepts', text: 'TS=("deep brain stimulat*" OR "responsive neurostimulat*" OR (subthalamic NEAR/3 stimulat*)) AND TS=(sham OR placebo* OR "double blind*") AND TS=(random* OR trial OR crossover)' },
  { id: 'cochrane', name: 'Cochrane CENTRAL', detail: 'Numbered strategy, 6 lines', text: [
    '#1 [mh "Deep Brain Stimulation"]', '#2 (deep NEXT brain NEXT stimulat*):ti,ab,kw', '#3 ((subthalamic OR pallidal OR thalamic) NEAR/3 stimulat*):ti,ab,kw',
    '#4 #1 OR #2 OR #3', '#5 (sham OR placebo* OR "double blind*"):ti,ab,kw', '#6 #4 AND #5'].join('\n') },
  { id: 'epmc', name: 'Europe PMC', detail: 'One query, title and abstract fields', text: '(TITLE:("deep brain stimulation" OR "responsive neurostimulation") OR ABSTRACT:("deep brain stimulation" OR "responsive neurostimulation")) AND (sham OR placebo OR "double blind") AND SRC:MED' },
  { id: 'ctgov', name: 'ClinicalTrials.gov', detail: 'One query, intervention and study fields', text: 'AREA[InterventionSearch]("deep brain stimulation" OR "responsive neurostimulation") AND AREA[StudyType]INTERVENTIONAL AND AREA[DesignMasking](SINGLE OR DOUBLE OR TRIPLE OR QUADRUPLE)' },
];
