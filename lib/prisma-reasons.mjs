/** Keep the PRISMA export format while editing reasons as labelled rows. */
export function parseReasons(value = '') {
  return String(value).split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const comma = part.lastIndexOf(',');
    if (comma < 0) return { reason: part, count: '' };
    return { reason: part.slice(0, comma).trim(), count: part.slice(comma + 1).trim() };
  });
}
export function formatReasons(rows) {
  return rows.map(({ reason, count }) => ({ reason: String(reason).trim(), count: String(count).trim() }))
    .filter(row => row.reason || row.count)
    .map(row => row.count ? `${row.reason}, ${row.count}` : row.reason).join('; ');
}
