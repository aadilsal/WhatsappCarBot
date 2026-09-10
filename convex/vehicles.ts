import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export const listActiveForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return vehicles.filter((v) => v.active);
  },
});

export type VehicleResolution =
  | { status: "none" }
  | { status: "resolved"; vehicle: Doc<"vehicles"> }
  | { status: "ambiguous"; candidates: Doc<"vehicles">[] };

// Vehicle resolution — architecture.md §4: one active vehicle, never ask.
// Multiple: match nickname, then plate, then model, in that order. No match
// among several -> ambiguous (caller starts a vehicle_disambiguation prompt).
export const resolveForUser = internalQuery({
  args: { userId: v.id("users"), text: v.optional(v.string()) },
  handler: async (ctx, { userId, text }): Promise<VehicleResolution> => {
    const vehicles = (
      await ctx.db
        .query("vehicles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).filter((v) => v.active);

    if (vehicles.length === 0) return { status: "none" };
    if (vehicles.length === 1) return { status: "resolved", vehicle: vehicles[0] };

    const needle = text?.toLowerCase().trim();
    if (needle) {
      const byNickname = vehicles.find((v) => needle.includes(v.nickname.toLowerCase()));
      if (byNickname) return { status: "resolved", vehicle: byNickname };

      const byPlate = vehicles.find((v) => v.plate && needle.includes(v.plate.toLowerCase()));
      if (byPlate) return { status: "resolved", vehicle: byPlate };

      const byModel = vehicles.find((v) => v.model && needle.includes(v.model.toLowerCase()));
      if (byModel) return { status: "resolved", vehicle: byModel };
    }

    return { status: "ambiguous", candidates: vehicles };
  },
});

export const getById = internalQuery({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, { vehicleId }) => await ctx.db.get(vehicleId),
});

// Vehicle insert + all default rule inserts happen in setupWizard.ts's
// completeSetup mutation as one atomic write (architecture.md §3) — this
// file only owns vehicle-shaped reads. See rules.ts for the default seed
// list.
export const insertVehicle = internalMutation({
  args: {
    userId: v.id("users"),
    nickname: v.string(),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    year: v.optional(v.number()),
    plate: v.optional(v.string()),
    vin: v.optional(v.string()),
    engine: v.optional(v.string()),
    fuelType: v.optional(
      v.union(
        v.literal("petrol"),
        v.literal("diesel"),
        v.literal("hybrid"),
        v.literal("electric"),
        v.literal("cng"),
      ),
    ),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    currentOdo: v.optional(v.number()),
    currentOdoAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"vehicles">> => {
    return await ctx.db.insert("vehicles", { ...args, active: true, createdAt: Date.now() });
  },
});
