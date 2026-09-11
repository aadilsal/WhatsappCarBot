// First-time setup wizard — architecture.md §3. Any step accepts a paste
// that fills multiple fields; the step pointer always advances to the first
// still-missing thing rather than following a fixed script. There is no
// separate "quick setup" path (agents.md).

import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { buildDefaultRuleRows, categoryLabel, type Calibration } from "./rules";
import type { SetupExtraction } from "./parsing/setup";

export type SetupDraft = {
  nickname?: string;
  make?: string;
  model?: string;
  year?: number;
  plate?: string;
  fuelType?: "petrol" | "diesel" | "hybrid" | "electric" | "cng";
  currentOdo?: number;
  calibration: Calibration;
  vin?: string;
  engine?: string;
  purchaseDate?: number;
  purchasePrice?: number;
  skippedSteps: string[];
};

export function initialDraft(): SetupDraft {
  return { calibration: {}, skippedSteps: [] };
}

function hasNonOilCalibration(d: SetupDraft): boolean {
  return Object.keys(d.calibration).some((k) => k !== "oil");
}

type StepDef = {
  key: string;
  required: boolean;
  prompt: string;
  satisfied: (d: SetupDraft) => boolean;
};

export const STEPS: StepDef[] = [
  { key: "nickname", required: true, prompt: "What should I call this vehicle? (a nickname is fine)", satisfied: (d) => !!d.nickname },
  { key: "makemodel", required: true, prompt: "Make, model, and year?", satisfied: (d) => !!d.make && !!d.model },
  { key: "plate", required: true, prompt: "Registration / plate number?", satisfied: (d) => !!d.plate },
  { key: "fuelType", required: true, prompt: "Fuel type — petrol, diesel, hybrid, electric, or cng?", satisfied: (d) => !!d.fuelType },
  { key: "odometer", required: true, prompt: "Current odometer reading (km)?", satisfied: (d) => d.currentOdo !== undefined },
  {
    key: "oil",
    required: false,
    prompt: "When (or at what odometer) was the last oil change? Reply 'skip' if you're not sure.",
    satisfied: (d) => !!d.calibration.oil || d.skippedSteps.includes("oil"),
  },
  {
    key: "other_services",
    required: false,
    prompt: "Any other recent services — tyres, brakes, coolant, battery, etc? One message is fine. Reply 'skip' otherwise.",
    satisfied: (d) => hasNonOilCalibration(d) || d.skippedSteps.includes("other_services"),
  },
  {
    key: "insurance",
    required: false,
    prompt: "When does insurance expire? Reply 'skip' if you'd rather add it later.",
    satisfied: (d) => !!d.calibration.insurance?.at || d.skippedSteps.includes("insurance"),
  },
  {
    key: "registration",
    required: false,
    prompt: "When do registration and token tax expire? Reply 'skip' otherwise.",
    satisfied: (d) =>
      !!d.calibration.registration?.at || !!d.calibration.token_tax?.at || d.skippedSteps.includes("registration"),
  },
  {
    key: "extras",
    required: false,
    prompt: "Anything else — VIN, engine, purchase date/price? Reply 'skip' to finish setup.",
    satisfied: (d) => !!d.vin || !!d.engine || !!d.purchaseDate || !!d.purchasePrice || d.skippedSteps.includes("extras"),
  },
];

export function firstUnsatisfiedStep(draft: SetupDraft): StepDef | null {
  return STEPS.find((s) => !s.satisfied(draft)) ?? null;
}

export function mergeExtraction(draft: SetupDraft, extraction: SetupExtraction): SetupDraft {
  const next: SetupDraft = {
    ...draft,
    calibration: { ...draft.calibration },
  };

  if (extraction.nickname) next.nickname = extraction.nickname;
  if (extraction.make) next.make = extraction.make;
  if (extraction.model) next.model = extraction.model;
  if (extraction.year !== undefined) next.year = extraction.year;
  if (extraction.plate) next.plate = extraction.plate;
  if (extraction.fuelType) next.fuelType = extraction.fuelType;
  if (extraction.currentOdo !== undefined) next.currentOdo = extraction.currentOdo;
  if (extraction.vin) next.vin = extraction.vin;
  if (extraction.engine) next.engine = extraction.engine;
  if (extraction.purchaseDate !== undefined) next.purchaseDate = extraction.purchaseDate;
  if (extraction.purchasePrice !== undefined) next.purchasePrice = extraction.purchasePrice;

  if (extraction.oilAnchorOdo !== undefined || extraction.oilAnchorAt !== undefined) {
    next.calibration.oil = {
      odo: extraction.oilAnchorOdo ?? next.calibration.oil?.odo,
      at: extraction.oilAnchorAt ?? next.calibration.oil?.at,
    };
  }
  for (const item of extraction.otherServiceAnchors ?? []) {
    next.calibration[item.category] = {
      odo: item.odo ?? next.calibration[item.category]?.odo,
      at: item.at ?? next.calibration[item.category]?.at,
    };
  }
  if (extraction.insuranceExpiry !== undefined) {
    next.calibration.insurance = { at: extraction.insuranceExpiry };
  }
  if (extraction.registrationExpiry !== undefined) {
    next.calibration.registration = { at: extraction.registrationExpiry };
  }
  if (extraction.tokenTaxExpiry !== undefined) {
    next.calibration.token_tax = { at: extraction.tokenTaxExpiry };
  }

  return next;
}

export function markSkipped(draft: SetupDraft, stepKey: string): SetupDraft {
  if (draft.skippedSteps.includes(stepKey)) return draft;
  return { ...draft, skippedSteps: [...draft.skippedSteps, stepKey] };
}

export function buildEchoLine(extraction: SetupExtraction): string | null {
  const parts: string[] = [];
  if (extraction.nickname) parts.push(`nickname: ${extraction.nickname}`);
  if (extraction.make || extraction.model) parts.push(`${[extraction.make, extraction.model, extraction.year].filter(Boolean).join(" ")}`);
  if (extraction.plate) parts.push(`plate: ${extraction.plate}`);
  if (extraction.fuelType) parts.push(`fuel: ${extraction.fuelType}`);
  if (extraction.currentOdo !== undefined) parts.push(`odometer: ${extraction.currentOdo.toLocaleString()} km`);
  const calibratedCount =
    (extraction.oilAnchorOdo !== undefined || extraction.oilAnchorAt !== undefined ? 1 : 0) +
    (extraction.otherServiceAnchors?.length ?? 0) +
    (extraction.insuranceExpiry !== undefined ? 1 : 0) +
    (extraction.registrationExpiry !== undefined ? 1 : 0) +
    (extraction.tokenTaxExpiry !== undefined ? 1 : 0);
  if (calibratedCount > 0) parts.push(`${calibratedCount} service date${calibratedCount > 1 ? "s" : ""} logged`);
  if (parts.length === 0) return null;
  return `Got it — ${parts.join(", ")}.`;
}

// Vehicle insert + all 16 rule inserts, one atomic mutation (architecture.md §3).
// Shared by the WhatsApp wizard (internalMutation below) and the dashboard's
// public addVehicle mutation (dashboard.ts).
export async function finalizeSetupCore(
  ctx: MutationCtx,
  { userId, draft }: { userId: Id<"users">; draft: SetupDraft },
) {
    const now = Date.now();

    const vehicleId = await ctx.db.insert("vehicles", {
      userId,
      nickname: draft.nickname!,
      make: draft.make,
      model: draft.model,
      year: draft.year,
      plate: draft.plate,
      vin: draft.vin,
      engine: draft.engine,
      fuelType: draft.fuelType,
      purchaseDate: draft.purchaseDate,
      purchasePrice: draft.purchasePrice,
      currentOdo: draft.currentOdo,
      currentOdoAt: draft.currentOdo !== undefined ? now : undefined,
      active: true,
      createdAt: now,
    });

    const ruleRows = buildDefaultRuleRows(vehicleId, draft.currentOdo, now, draft.calibration);
    for (const row of ruleRows) {
      await ctx.db.insert("rules", row);
    }

    const calibratedCount = ruleRows.filter((r) => !r.anchorEstimated).length;
    const estimatedCount = ruleRows.length - calibratedCount;

    return {
      vehicleId,
      nickname: draft.nickname!,
      make: draft.make,
      model: draft.model,
      plate: draft.plate,
      currentOdo: draft.currentOdo,
      calibratedCount,
      estimatedCount,
    };
}

export const finalizeSetup = internalMutation({
  args: { userId: v.id("users"), draft: v.any() },
  handler: async (ctx, { userId, draft }: { userId: Id<"users">; draft: SetupDraft }) =>
    finalizeSetupCore(ctx, { userId, draft }),
});

export { categoryLabel };
