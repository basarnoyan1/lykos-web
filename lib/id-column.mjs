// The study ID column of an extraction table, by its label: "ID", "#", "No", "No.", "Study ID", "Study no." (31 Oct 2026: the sham
// review's table numbers its studies in a column labelled "#", which renumber_studies, the evidence export and the import did not see).
export const isIdLabel = label => /^(id|#|no\.?|study (id|no\.?))$/i.test(String(label ?? '').trim());
