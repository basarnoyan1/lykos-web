// A field label as a reader says it (owner, 2026-10-23: "so many semicolon combined words ... looking weird"). A spreadsheet header joins
// several things with semicolons ("Age; sex", "Mechanical failure; revision"); on screen they read as a list: "Age and sex",
// "Mechanical failure and revision", "Cobb, SVA and PI–LL". Each part keeps its case as written: a name (Dynesys) cannot be told from a word.

/** "Age; sex" -> "Age and sex"; "A; b; c" -> "A, b and c"; a label without semicolons as written. */
export function readableLabel(label) {
  const text = String(label ?? '');
  if (!text.includes(';')) return text;
  const parts = text.split(/\s*;\s*/).map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  const rest = parts.slice(1);
  return `${parts[0]}${rest.length > 1 ? `, ${rest.slice(0, -1).join(', ')}` : ''} and ${rest.at(-1)}`;
}
