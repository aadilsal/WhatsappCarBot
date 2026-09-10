// Pure date-math helpers shared across convex/. No Convex imports here —
// keep this testable without a Convex runtime.

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysBetween(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / MS_PER_DAY;
}

// Calendar-accurate month addition (not a flat *30 days), so "6 months from
// anchorAt" lands on the same day-of-month rather than drifting.
export function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // Handle month-end overflow (e.g. Jan 31 + 1 month should clamp to Feb 28,
  // not roll into March).
  if (d.getUTCDate() !== day) {
    d.setUTCDate(0);
  }
  return d.getTime();
}
