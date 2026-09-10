// Odometer rate smoothing — architecture.md §4.
//
// avgKmPerDay = 0.3 * impliedRate + 0.7 * avgKmPerDay
// Readings that go backwards or imply >800 km/day are rejected: the event
// that carried the reading still gets logged (caller's responsibility), but
// vehicle odometer/rate state is left untouched.

import { daysBetween } from "./dates";

const BLEND_WEIGHT = 0.3;
const MAX_KM_PER_DAY = 800;
// Below this elapsed time a rate computation is meaningless (same-day
// re-readings) — accept the new odo but leave avgKmPerDay untouched.
const MIN_HOURS_FOR_RATE = 1;

export type OdoState = {
  currentOdo?: number;
  currentOdoAt?: number;
  avgKmPerDay?: number;
};

export type OdoUpdateResult =
  | { accepted: true; state: Required<Pick<OdoState, "currentOdo" | "currentOdoAt">> & { avgKmPerDay?: number } }
  | { accepted: false; reason: string };

export function computeOdoUpdate(
  prev: OdoState,
  newOdo: number,
  newOdoAt: number,
): OdoUpdateResult {
  if (prev.currentOdo === undefined || prev.currentOdoAt === undefined) {
    // First-ever reading for this vehicle: nothing to compare against.
    return { accepted: true, state: { currentOdo: newOdo, currentOdoAt: newOdoAt, avgKmPerDay: prev.avgKmPerDay } };
  }

  if (newOdo < prev.currentOdo) {
    return { accepted: false, reason: "backwards" };
  }

  const elapsedDays = daysBetween(prev.currentOdoAt, newOdoAt);
  if (elapsedDays * 24 < MIN_HOURS_FOR_RATE) {
    // Too little time elapsed to derive a rate; accept the reading itself.
    return { accepted: true, state: { currentOdo: newOdo, currentOdoAt: newOdoAt, avgKmPerDay: prev.avgKmPerDay } };
  }

  const impliedRate = (newOdo - prev.currentOdo) / elapsedDays;
  if (impliedRate > MAX_KM_PER_DAY) {
    return { accepted: false, reason: "implausible" };
  }

  const avgKmPerDay =
    prev.avgKmPerDay === undefined
      ? impliedRate
      : BLEND_WEIGHT * impliedRate + (1 - BLEND_WEIGHT) * prev.avgKmPerDay;

  return { accepted: true, state: { currentOdo: newOdo, currentOdoAt: newOdoAt, avgKmPerDay } };
}
