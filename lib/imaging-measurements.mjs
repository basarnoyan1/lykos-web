// Measurements retain DICOM object identifiers, never ephemeral loader URLs.
const clean = value => JSON.parse(JSON.stringify(value, (key, v) => ['imageId', 'element', 'canvas', '__proto__'].includes(key) ? undefined : typeof v === 'number' && !Number.isFinite(v) ? null : v));
export function measurementSource(source) {
  const out = Object.fromEntries(['studyUid', 'seriesUid', 'sopUid', 'frame', 'rows', 'columns', 'rowSpacing', 'columnSpacing', 'position', 'orientation', 'modality', 'rescaleType'].filter(k => source?.[k] != null).map(k => [k, source[k]]));
  if (!out.studyUid || !out.seriesUid || !out.sopUid || !Number.isInteger(out.frame) || out.frame < 1) throw new Error('Study, series, SOP instance and frame are required for a reproducible measurement');
  return clean(out);
}
export function saveMeasurements(s, { source, participantId, label, measurements, by, at = new Date().toISOString() }) {
  if (!participantId || !(s.participants || []).some(p => p.id === participantId)) throw new Error('Choose a project participant');
  if (!String(label || '').trim() || !String(by || '').trim()) throw new Error('Record a measurement label and researcher');
  const src = measurementSource(source), values = clean(measurements || {});
  if (!Object.values(values).some(v => Array.isArray(v) && v.length)) throw new Error('Draw a measurement before saving');
  const key = JSON.stringify([participantId, src.studyUid, src.seriesUid, src.sopUid, src.frame, label.trim()]);
  const list = s.imagingMeasurements ||= [], old = list.find(x => x.key === key);
  const record = { id: old?.id || `im${Date.now().toString(36)}${list.length}`, key, participantId, label: label.trim(), source: src, measurements: values, by: by.trim(), at, revision: (old?.revision || 0) + 1 };
  if (old) Object.assign(old, record); else list.push(record);
  return record;
}
export function measurementsFor(s, source, participantId, label) {
  const src = measurementSource(source);
  return (s.imagingMeasurements || []).find(x => x.participantId === participantId && x.label === label && x.source.studyUid === src.studyUid && x.source.seriesUid === src.seriesUid && x.source.sopUid === src.sopUid && x.source.frame === src.frame) || null;
}
export function imagingDataset(s, id = 'dsImagingMeasurements') {
  const participants = new Map((s.participants || []).map(p => [p.id, p.label || p.id]));
  const columns = [['participant_id', 'Participant ID', 'text'], ['participant_label', 'Participant', 'text'], ['label', 'Measurement', 'text'], ['tool', 'Tool', 'category'], ['study_uid', 'Study UID', 'text'], ['series_uid', 'Series UID', 'text'], ['sop_uid', 'SOP instance UID', 'text'], ['frame', 'Frame', 'integer'], ['length', 'Length', 'number'], ['angle', 'Angle (degrees)', 'number'], ['area', 'Area', 'number'], ['mean', 'ROI mean', 'number'], ['sd', 'ROI SD', 'number'], ['unit', 'Measurement unit', 'text'], ['intensity_unit', 'Intensity unit', 'text'], ['reviewer', 'Researcher', 'text'], ['recorded', 'Recorded', 'text']].map(([id, label, type]) => ({ id, label, type, ...(/^(participant_|study_uid|series_uid|sop_uid)/.test(id) ? { role: 'identifier' } : {}) }));
  const rows = (s.imagingMeasurements || []).flatMap(r => Object.entries(r.measurements).flatMap(([tool, data]) => data.map(m => ({ participant_id: r.participantId, participant_label: participants.get(r.participantId) || r.participantId, label: r.label, tool, study_uid: r.source.studyUid, series_uid: r.source.seriesUid, sop_uid: r.source.sopUid, frame: r.source.frame, length: m.length ?? '', angle: m.angle ?? m.rAngle ?? '', area: m.cachedStats?.area ?? m.area ?? '', mean: m.cachedStats?.mean ?? '', sd: m.cachedStats?.stdDev ?? '', unit: tool === 'Angle' ? 'degrees' : tool === 'Length' ? (r.source.rowSpacing > 0 && r.source.columnSpacing > 0 ? 'mm' : 'pixels') : /Roi$/.test(tool) ? (r.source.rowSpacing > 0 && r.source.columnSpacing > 0 ? 'mm²' : 'pixels²') : '', intensity_unit: r.source.rescaleType || '', reviewer: r.by, recorded: r.at }))));
  return { id, name: 'Imaging measurements', columns, rows, source: { kind: 'dicom-measurements', generatedAt: new Date().toISOString() } };
}
