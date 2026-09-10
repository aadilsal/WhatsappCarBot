// Reminder tier ladder — architecture.md §5.
//
// Km ladder: 1000 -> 250 -> overdue (bucketed every 500km).
// Day ladder: 30 -> 14 -> 7 -> 1 -> overdue (bucketed every 7 days).
// A rule only enters the ladder once remaining crosses the first threshold;
// `null` means "not due soon enough to say anything yet."

const KM_OVERDUE_BUCKET = 500;
const DAY_OVERDUE_BUCKET = 7;

export function kmTierBucket(kmRemaining: number): string | null {
  if (kmRemaining > 1000) return null;
  if (kmRemaining > 250) return "1000";
  if (kmRemaining > 0) return "250";
  const bucket = Math.floor(Math.abs(kmRemaining) / KM_OVERDUE_BUCKET);
  return `overdue:${bucket}`;
}

export function dayTierBucket(daysRemaining: number): string | null {
  if (daysRemaining > 30) return null;
  if (daysRemaining > 14) return "30";
  if (daysRemaining > 7) return "14";
  if (daysRemaining > 1) return "7";
  if (daysRemaining > 0) return "1";
  const bucket = Math.floor(Math.abs(daysRemaining) / DAY_OVERDUE_BUCKET);
  return `overdue:${bucket}`;
}

export type RuleDueState = {
  metric: "km" | "days";
  tierBucket: string; // e.g. "1000", "250", "overdue:2"
  remaining: number; // km or days, signed (negative = overdue)
};

// rule.mode === "interval" evaluation. Callers pass whichever of km/days
// applies; when both apply, whichever ratio-to-limit is smaller governs
// (architecture.md §5).
export function evaluateIntervalDue(args: {
  kmRemaining?: number;
  intervalKm?: number;
  daysRemaining?: number;
  intervalMonths?: number;
}): RuleDueState | null {
  const { kmRemaining, intervalKm, daysRemaining, intervalMonths } = args;

  const kmCandidate =
    kmRemaining !== undefined && intervalKm
      ? { metric: "km" as const, ratio: kmRemaining / intervalKm, remaining: kmRemaining, bucket: kmTierBucket(kmRemaining) }
      : null;
  const dayCandidate =
    daysRemaining !== undefined && intervalMonths
      ? {
          metric: "days" as const,
          ratio: daysRemaining / (intervalMonths * 30),
          remaining: daysRemaining,
          bucket: dayTierBucket(daysRemaining),
        }
      : null;

  let governing: typeof kmCandidate | typeof dayCandidate = null;
  if (kmCandidate && dayCandidate) {
    governing = kmCandidate.ratio <= dayCandidate.ratio ? kmCandidate : dayCandidate;
  } else {
    governing = kmCandidate ?? dayCandidate;
  }

  if (!governing || governing.bucket === null) return null;
  return { metric: governing.metric, tierBucket: governing.bucket, remaining: governing.remaining };
}

export function evaluateExpiryDue(daysRemaining: number): RuleDueState | null {
  const bucket = dayTierBucket(daysRemaining);
  if (bucket === null) return null;
  return { metric: "days", tierBucket: bucket, remaining: daysRemaining };
}
