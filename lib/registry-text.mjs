// A registry record as a text the checks read like a paper (31 Oct 2026). A trial's values may come from its ClinicalTrials.gov record
// (a registry-only trial, or gaps filled from posted results); before, that record was only a JSON dump made by a session's script, so the
// proof kernel could not read it and every such value rested on a decision. The text is made from the record's stored JSON (API v2, the
// study object: protocolSection, resultsSection) with headings the proof index reads as zones (Summary is the abstract, Methods, Results)
// and one line per measurement, the measure's title and the group's name beside its number, so a number stands next to what it measures.
// Nothing here fetches: tools/fulltext.mjs stores the JSON and the text in .lykos/fulltext/registry/.

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const lower = s => clean(s).toLowerCase().replace(/_/g, ' ');
const cap = s => { const x = lower(s); return x ? x[0].toUpperCase() + x.slice(1) : ''; };
const DISPERSION = { STANDARD_DEVIATION: 'SD', STANDARD_ERROR: 'SE', INTER_QUARTILE_RANGE: 'IQR', FULL_RANGE: 'range', '95_PERCENT_CI': '95% CI', GEOMETRIC_COEFFICIENT: 'geometric coefficient of variation' };
const PARAM = { MEAN: 'mean', MEDIAN: 'median', LEAST_SQUARES_MEAN: 'least squares mean', GEOMETRIC_MEAN: 'geometric mean', COUNT_OF_PARTICIPANTS: 'count of participants', NUMBER: 'number', COUNT_OF_UNITS: 'count', GEOMETRIC_LEAST_SQUARES_MEAN: 'geometric least squares mean' };

/** The NCT id of a stored study object, or ''. */
export const nctOf = study => String(study?.protocolSection?.identificationModule?.nctId || '').toUpperCase();

/** The studies in a ClinicalTrials.gov download: an array of study objects, { studies: [...] } (API v2), or one study. */
export function registryStudies(json) {
  if (Array.isArray(json)) return json.filter(x => nctOf(x));
  if (Array.isArray(json?.studies)) return json.studies.filter(x => nctOf(x));
  return nctOf(json) ? [json] : [];
}

/** One measurement with its spread: "59.3 (SD 10.6)", "12 (IQR 8 to 15)", "3/14". */
function measurement(m, { dispersion = '', param = '', denom = null } = {}) {
  const v = clean(m?.value);
  if (!v || v === 'NA') return m?.comment ? `not available (${clean(m.comment)})` : '';
  const d = DISPERSION[dispersion] || lower(dispersion);
  let out = v;
  if (m.spread != null && m.spread !== '' && m.spread !== 'NA') out += ` (${d || 'spread'} ${clean(m.spread)})`;
  else if (m.lowerLimit != null && m.upperLimit != null && m.lowerLimit !== 'NA') out += ` (${d || 'limits'} ${clean(m.lowerLimit)} to ${clean(m.upperLimit)})`;
  if (/count/i.test(param) && denom != null && /^\d+$/.test(v)) out += ` of ${denom} (${v}/${denom})`;
  if (m.comment) out += ` [${clean(m.comment)}]`;
  return out;
}

/** The text of one ClinicalTrials.gov study object (API v2). */
export function registryText(study) {
  const ps = study?.protocolSection || {}, rs = study?.resultsSection || null, L = [];
  const id = ps.identificationModule || {}, st = ps.statusModule || {}, sp = ps.sponsorCollaboratorsModule || {}, de = ps.designModule || {};
  const nct = nctOf(study);
  const push = (...xs) => { const x = clean(xs.filter(Boolean).join(' ')); if (x) L.push(x); };
  push(`ClinicalTrials.gov registry record ${nct}`);
  push(id.briefTitle);
  if (id.officialTitle) push(`Official title: ${id.officialTitle}.`);
  if (id.acronym) push(`Acronym: ${id.acronym}.`);
  for (const o of [id.orgStudyIdInfo, ...(id.secondaryIdInfos || [])].filter(Boolean)) push(`Other study identifier: ${o.id}${o.type ? ` (${lower(o.type)}${o.domain ? `, ${o.domain}` : ''})` : ''}.`);
  L.push('');
  L.push('Summary');
  push(ps.descriptionModule?.briefSummary);
  if (ps.descriptionModule?.detailedDescription) { L.push(''); push(`Detailed description: ${ps.descriptionModule.detailedDescription}`); }
  if (ps.conditionsModule?.conditions?.length) push(`Conditions: ${ps.conditionsModule.conditions.join(', ')}.`);
  L.push('');
  L.push('Methods');
  const di = de.designInfo || {}, mk = di.maskingInfo || {};
  push(`Study type: ${lower(de.studyType)}.`, de.phases?.length ? `Phase: ${de.phases.map(lower).join(', ')}.` : '', di.allocation ? `Allocation: ${lower(di.allocation)}.` : '',
    di.interventionModel ? `Intervention model: ${lower(di.interventionModel)}.` : '', di.interventionModelDescription ? `${di.interventionModelDescription}` : '',
    di.primaryPurpose ? `Primary purpose: ${lower(di.primaryPurpose)}.` : '', mk.masking ? `Masking: ${lower(mk.masking)}${mk.whoMasked?.length ? ` (${mk.whoMasked.map(lower).join(', ')})` : ''}.` : '', mk.maskingDescription || '');
  if (de.enrollmentInfo?.count != null) push(`Enrollment: ${de.enrollmentInfo.count} participants (${lower(de.enrollmentInfo.type || '')}).`);
  for (const a of ps.armsInterventionsModule?.armGroups || []) push(`Arm ${a.label}${a.type ? ` (${lower(a.type)})` : ''}: ${a.description || ''}${a.interventionNames?.length ? ` Interventions: ${a.interventionNames.join('; ')}.` : ''}`);
  for (const i of ps.armsInterventionsModule?.interventions || []) push(`Intervention ${i.name}${i.type ? ` (${lower(i.type)})` : ''}: ${i.description || ''}`);
  const om = ps.outcomesModule || {};
  for (const [k, word] of [['primaryOutcomes', 'Primary outcome'], ['secondaryOutcomes', 'Secondary outcome'], ['otherOutcomes', 'Other outcome']])
    for (const o of om[k] || []) push(`${word}: ${o.measure}${o.timeFrame ? ` (time frame: ${o.timeFrame})` : ''}.`, o.description || '');
  const el = ps.eligibilityModule || {};
  if (el.sex || el.minimumAge || el.maximumAge) push(`Eligibility: sex ${lower(el.sex || 'all')}${el.minimumAge ? `, minimum age ${el.minimumAge}` : ''}${el.maximumAge ? `, maximum age ${el.maximumAge}` : ''}${el.healthyVolunteers != null ? `, healthy volunteers ${el.healthyVolunteers ? 'accepted' : 'not accepted'}` : ''}.`);
  if (el.eligibilityCriteria) push(`Eligibility criteria: ${el.eligibilityCriteria}`);
  if (sp.leadSponsor?.name) push(`Sponsor: ${sp.leadSponsor.name}${sp.leadSponsor.class ? ` (${lower(sp.leadSponsor.class)})` : ''}.`, sp.collaborators?.length ? `Collaborators: ${sp.collaborators.map(c => c.name).join('; ')}.` : '');
  if (sp.responsibleParty?.investigatorFullName) push(`Responsible party: ${sp.responsibleParty.investigatorFullName}${sp.responsibleParty.investigatorAffiliation ? `, ${sp.responsibleParty.investigatorAffiliation}` : ''}.`);
  for (const o of ps.contactsLocationsModule?.overallOfficials || []) push(`Overall official: ${o.name}${o.affiliation ? `, ${o.affiliation}` : ''}${o.role ? ` (${lower(o.role)})` : ''}.`);
  const locs = (ps.contactsLocationsModule?.locations || []).map(l => [l.facility, l.city, l.state, l.country].filter(Boolean).join(', '));
  if (locs.length) push(`Locations (${locs.length}): ${locs.join('; ')}.`);
  const date = k => (st[k]?.date ? `${st[k].date}${st[k].type ? ` (${lower(st[k].type)})` : ''}` : '');
  push(`Status: ${lower(st.overallStatus)}${st.whyStopped ? ` (why stopped: ${st.whyStopped})` : ''}.`, date('startDateStruct') ? `Start: ${date('startDateStruct')}.` : '', date('primaryCompletionDateStruct') ? `Primary completion: ${date('primaryCompletionDateStruct')}.` : '',
    date('completionDateStruct') ? `Completion: ${date('completionDateStruct')}.` : '', st.studyFirstSubmitDate ? `First submitted: ${st.studyFirstSubmitDate}.` : '', date('studyFirstPostDateStruct') ? `First posted: ${date('studyFirstPostDateStruct')}.` : '',
    date('resultsFirstPostDateStruct') ? `Results first posted: ${date('resultsFirstPostDateStruct')}.` : '', date('lastUpdatePostDateStruct') ? `Last update posted: ${date('lastUpdatePostDateStruct')}.` : '');
  for (const r of ps.referencesModule?.references || []) push(`Reference${r.type ? ` (${lower(r.type)})` : ''}: ${r.citation || ''}${r.pmid ? ` PMID ${r.pmid}.` : ''}`);
  if (!rs) { L.push(''); L.push('No results posted.'); return `${L.join('\n')}\n`; }

  L.push('');
  L.push('Results');
  const titleOf = groups => new Map((groups || []).map(g => [g.id, clean(g.title)]));
  const pf = rs.participantFlowModule;
  if (pf) {
    push('Participant flow.', pf.recruitmentDetails || '', pf.preAssignmentDetails || '');
    const g = titleOf(pf.groups);
    for (const x of pf.groups || []) if (x.description) push(`Flow group ${x.title}: ${x.description}`);
    for (const p of pf.periods || []) {
      for (const m of p.milestones || []) for (const a of m.achievements || []) push(`${p.title}, ${lower(m.type)}: ${g.get(a.groupId) || a.groupId} ${a.numSubjects} participants${a.comment ? ` (${a.comment})` : ''}.`);
      for (const w of p.dropWithdraws || []) for (const r of w.reasons || []) if (Number(r.numSubjects) > 0) push(`${p.title}, not completed, ${lower(w.type)}: ${g.get(r.groupId) || r.groupId} ${r.numSubjects} participants.`);
    }
  }
  const bc = rs.baselineCharacteristicsModule;
  if (bc) {
    L.push('');
    push('Baseline characteristics.', bc.populationDescription || '');
    const g = titleOf(bc.groups), denom = new Map((bc.denoms?.[0]?.counts || []).map(c => [c.groupId, c.value]));
    for (const [gid, n] of denom) push(`Baseline, overall number of participants analysed: ${g.get(gid) || gid} ${n} participants (n = ${n}).`);
    for (const m of bc.measures || []) {
      const what = `${clean(m.title)}${m.unitOfMeasure ? ` (${PARAM[m.paramType] || lower(m.paramType)}${m.dispersionType ? `, ${DISPERSION[m.dispersionType] || lower(m.dispersionType)}` : ''}, ${clean(m.unitOfMeasure)})` : ''}`;
      for (const c of m.classes || []) for (const k of c.categories || []) for (const x of k.measurements || []) {
        const v = measurement(x, { dispersion: m.dispersionType, param: m.paramType, denom: denom.get(x.groupId) });
        if (v) push(`Baseline ${what}${c.title ? `, ${clean(c.title)}` : ''}${k.title ? `, ${clean(k.title)}` : ''}: ${g.get(x.groupId) || x.groupId} ${v}.`);
      }
    }
  }
  for (const o of rs.outcomeMeasuresModule?.outcomeMeasures || []) {
    L.push('');
    const g = titleOf(o.groups), denoms = new Map((o.denoms?.[0]?.counts || []).map(c => [c.groupId, c.value]));
    push(`${cap(o.type)} outcome measure: ${o.title}${o.timeFrame ? ` (time frame: ${o.timeFrame})` : ''}.`, o.description || '', o.populationDescription ? `Population: ${o.populationDescription}` : '',
      `Measure: ${PARAM[o.paramType] || lower(o.paramType)}${o.dispersionType ? `, ${DISPERSION[o.dispersionType] || lower(o.dispersionType)}` : ''}${o.unitOfMeasure ? `, ${clean(o.unitOfMeasure)}` : ''}.`);
    for (const [gid, n] of denoms) push(`${o.title}, number analysed: ${g.get(gid) || gid} ${n} participants (n = ${n}).`);
    for (const c of o.classes || []) for (const k of c.categories || []) for (const x of k.measurements || []) {
      const v = measurement(x, { dispersion: o.dispersionType, param: o.paramType, denom: denoms.get(x.groupId) });
      if (v) push(`${o.title}${c.title ? `, ${clean(c.title)}` : ''}${k.title ? `, ${clean(k.title)}` : ''}: ${g.get(x.groupId) || x.groupId} ${v}${o.unitOfMeasure && !/participants/i.test(o.unitOfMeasure) ? ` ${clean(o.unitOfMeasure)}` : ''}.`);
    }
    for (const a of o.analyses || []) push(`Statistical analysis of ${o.title} (${(a.groupIds || []).map(x => g.get(x) || x).join(' vs ')}): ${a.statisticalMethod || ''}${a.pValue ? `, p = ${a.pValue}` : ''}${a.paramType ? `; ${a.paramType} ${a.paramValue ?? ''}` : ''}${a.ciPctValue ? ` (${a.ciPctValue}% CI ${a.ciLowerLimit ?? ''} to ${a.ciUpperLimit ?? ''})` : ''}.`, a.statisticalComment || '', a.estimateComment || '');
  }
  const ae = rs.adverseEventsModule;
  if (ae) {
    L.push('');
    push('Adverse events.', ae.timeFrame ? `Time frame: ${ae.timeFrame}.` : '', ae.description || '', ae.frequencyThreshold ? `Frequency threshold for other adverse events: ${ae.frequencyThreshold}%.` : '');
    const g = titleOf(ae.eventGroups);
    for (const e of ae.eventGroups || []) {
      if (e.deathsNumAtRisk != null) push(`Deaths (all causes): ${e.title} ${e.deathsNumAffected}/${e.deathsNumAtRisk} participants.`);
      if (e.seriousNumAtRisk != null) push(`Serious adverse events, participants affected: ${e.title} ${e.seriousNumAffected}/${e.seriousNumAtRisk} participants.`);
      if (e.otherNumAtRisk != null) push(`Other (not including serious) adverse events, participants affected: ${e.title} ${e.otherNumAffected}/${e.otherNumAtRisk} participants.`);
    }
    for (const [k, word] of [['seriousEvents', 'Serious adverse event'], ['otherEvents', 'Other adverse event']])
      for (const ev of ae[k] || []) for (const x of ev.stats || []) if (x.numAtRisk != null) push(`${word}: ${ev.term}${ev.organSystem ? ` (${ev.organSystem})` : ''}: ${g.get(x.groupId) || x.groupId} ${x.numAffected}/${x.numAtRisk} participants${x.numEvents != null ? `, ${x.numEvents} events` : ''}.`);
  }
  const mi = rs.moreInfoModule;
  if (mi?.limitationsAndCaveats?.description) push(`Limitations and caveats: ${mi.limitationsAndCaveats.description}`);
  if (mi?.certainAgreement?.otherDetails) push(`Agreement: ${mi.certainAgreement.otherDetails}`);
  return `${L.join('\n')}\n`;
}
