/**
 * **One way to show a timeline's moment — decision 0674.**
 *
 * The server sends every moment as UTC ISO (`2026-10-07T15:37:19.973Z`).
 * This shows it in the viewer's own time zone as `2026-10-07 16:37:19`:
 * date first so it reads in order, to the second so moments a second
 * apart are told apart, and no `T`, `Z` or milliseconds. The Document
 * viewer and the receipt's Timeline both use it.
 */
export function stamp(at) {
  if (!at) return "";
  const s = String(at);
  const withT = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(withT) ? withT : `${withT}Z`);
  if (Number.isNaN(d.getTime())) return s;
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}
