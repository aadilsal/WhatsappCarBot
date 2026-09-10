import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// The default rule set — architecture.md §5 / architecture-essentials.md.
// Adding a maintenance item means adding a row here, never branching in the
// evaluator (agents.md).
export const DEFAULT_RULES: Array<{
  category: string;
  label: string;
  mode: "interval" | "expiry";
  intervalKm?: number;
  intervalMonths?: number;
}> = [
  { category: "oil", label: "Engine oil", mode: "interval", intervalKm: 5000, intervalMonths: 6 },
  { category: "tyre_rotation", label: "Tyre rotation", mode: "interval", intervalKm: 10000 },
  { category: "alignment", label: "Wheel alignment", mode: "interval", intervalKm: 10000 },
  { category: "air_filter", label: "Air filter", mode: "interval", intervalKm: 20000 },
  { category: "cabin_filter", label: "Cabin filter", mode: "interval", intervalKm: 15000 },
  { category: "brake_inspection", label: "Brake inspection", mode: "interval", intervalKm: 15000 },
  { category: "coolant", label: "Coolant", mode: "interval", intervalMonths: 24 },
  { category: "brake_fluid", label: "Brake fluid", mode: "interval", intervalMonths: 24 },
  { category: "transmission_oil", label: "Transmission oil", mode: "interval", intervalKm: 40000 },
  { category: "spark_plugs", label: "Spark plugs", mode: "interval", intervalKm: 40000 },
  { category: "timing_belt", label: "Timing belt", mode: "interval", intervalKm: 100000 },
  { category: "battery_inspection", label: "Battery inspection", mode: "interval", intervalMonths: 6 },
  { category: "battery_replacement", label: "Battery replacement", mode: "interval", intervalMonths: 30 },
  { category: "insurance", label: "Insurance", mode: "expiry" },
  { category: "registration", label: "Registration", mode: "expiry" },
  { category: "token_tax", label: "Token tax", mode: "expiry" },
];

export function categoryLabel(category: string): string {
  return DEFAULT_RULES.find((r) => r.category === category)?.label ?? category;
}

// Calibration input: a partial map of category -> known anchor, gathered
// during setup step 6-9 (or later corrections). Anything not present gets
// anchored to "now" and flagged anchorEstimated.
export type Calibration = Record<
  string,
  { odo?: number; at?: number } // interval-mode anchor, or expiry dueAt via `at`
>;

// Pure builder so it's testable without a Convex context, and so setupWizard
// can insert all 16 rows in the same mutation as the vehicle (agents.md:
// "every mutation that patches a rule anchor happens in the same mutation").
export function buildDefaultRuleRows(
  vehicleId: Id<"vehicles">,
  currentOdo: number | undefined,
  now: number,
  calibration: Calibration,
) {
  return DEFAULT_RULES.map((def) => {
    const known = calibration[def.category];

    if (def.mode === "expiry") {
      return {
        vehicleId,
        category: def.category,
        mode: "expiry" as const,
        dueAt: known?.at,
        anchorEstimated: known?.at === undefined,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
    }

    const anchorOdo = known?.odo ?? currentOdo;
    const anchorAt = known?.at ?? now;
    return {
      vehicleId,
      category: def.category,
      mode: "interval" as const,
      intervalKm: def.intervalKm,
      intervalMonths: def.intervalMonths,
      anchorOdo: def.intervalKm !== undefined ? anchorOdo : undefined,
      anchorAt: def.intervalMonths !== undefined ? anchorAt : undefined,
      anchorEstimated: known === undefined,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
  });
}

export const listForVehicle = internalQuery({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, { vehicleId }) => {
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicleId))
      .collect();
    return rules.filter((r) => r.active);
  },
});

export const getByCategory = internalQuery({
  args: { vehicleId: v.id("vehicles"), category: v.string() },
  handler: async (ctx, { vehicleId, category }) => {
    return await ctx.db
      .query("rules")
      .withIndex("by_vehicle_category", (q) => q.eq("vehicleId", vehicleId).eq("category", category))
      .unique();
  },
});

// `set <vehicle> <category> <N>km` — architecture.md §5. Patches the
// interval directly; anchor is untouched so next-due reflects the new
// interval immediately.
export const setInterval_ = internalMutation({
  args: { ruleId: v.id("rules"), intervalKm: v.optional(v.number()), intervalMonths: v.optional(v.number()) },
  handler: async (ctx, { ruleId, intervalKm, intervalMonths }) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (intervalKm !== undefined) patch.intervalKm = intervalKm;
    if (intervalMonths !== undefined) patch.intervalMonths = intervalMonths;
    await ctx.db.patch(ruleId, patch);
  },
});

export const listAllActive = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rules = await ctx.db.query("rules").collect();
    return rules.filter((r) => r.active);
  },
});
