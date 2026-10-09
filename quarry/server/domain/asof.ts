// Point-in-time helpers. Every analytical query takes an `asOf` cutoff and
// only uses information whose *disclosure* (EDGAR acceptance) or market
// observation happened at or before it.

export function resolveAsOf(input: unknown, now: Date): string {
  if (typeof input !== 'string' || input.trim() === '') return now.toISOString();
  const s = input.trim();
  // Date-only cutoffs mean "end of that day, UTC".
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59.999Z` : s;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid asOf: ${input}`);
  return (d.getTime() > now.getTime() ? now : d).toISOString();
}

export const DAY_MS = 86_400_000;

export function daysBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY_MS;
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

/** Calendar quarter end on or before a date: "2025-08-14" → "2025-06-30". */
export function quarterEndOnOrBefore(dateIso: string): string {
  const d = new Date(dateIso);
  const y = d.getUTCFullYear();
  const ends = [[3, 31], [6, 30], [9, 30], [12, 31]];
  for (let i = ends.length - 1; i >= 0; i--) {
    const [em, ed] = ends[i];
    const end = `${y}-${String(em).padStart(2, '0')}-${ed}`;
    if (end <= dateIso.slice(0, 10)) return end;
  }
  return `${y - 1}-12-31`;
}

export function previousQuarterEnd(period: string): string {
  const prior = new Date(`${period}T00:00:00Z`);
  prior.setUTCDate(prior.getUTCDate() - 5);
  return quarterEndOnOrBefore(prior.toISOString());
}
