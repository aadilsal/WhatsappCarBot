// Event logging — the highest-stakes file in the project (agents.md): every
// write here that touches odometer state or a rule anchor happens in this
// one transactional mutation, and always carries a full undo snapshot.

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { computeOdoUpdate } from "../lib/rateSmoothing";

export const logEvent = internalMutation({
  args: {
    vehicleId: v.id("vehicles"),
    userId: v.id("users"),
    kind: v.union(
      v.literal("fuel"),
      v.literal("service"),
      v.literal("expense"),
      v.literal("odo"),
      v.literal("document"),
      v.literal("note"),
    ),
    category: v.optional(v.string()),
    odo: v.optional(v.number()),
    amount: v.optional(v.number()),
    liters: v.optional(v.number()),
    fullTank: v.optional(v.boolean()),
    expiresAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    raw: v.string(),
  },
  handler: async (ctx, args) => {
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle) throw new Error(`logEvent: unknown vehicleId ${args.vehicleId}`);

    const now = Date.now();

    // A service/document event with a recognized category patches that
    // rule's anchor. Fetched *before* any writes so the undo snapshot is a
    // true pre-write copy.
    let touchedRule: Doc<"rules"> | null = null;
    if ((args.kind === "service" || args.kind === "document") && args.category) {
      touchedRule = await ctx.db
        .query("rules")
        .withIndex("by_vehicle_category", (q) =>
          q.eq("vehicleId", args.vehicleId).eq("category", args.category!),
        )
        .unique();
    }

    // --- undo snapshot: exact pre-write state ---
    const undoSnapshot = {
      vehicle: {
        currentOdo: vehicle.currentOdo,
        currentOdoAt: vehicle.currentOdoAt,
        avgKmPerDay: vehicle.avgKmPerDay,
      },
      rules: touchedRule
        ? [
            {
              ruleId: touchedRule._id,
              anchorOdo: touchedRule.anchorOdo,
              anchorAt: touchedRule.anchorAt,
              anchorEstimated: touchedRule.anchorEstimated,
            },
          ]
        : [],
    };

    const eventId = await ctx.db.insert("events", {
      vehicleId: args.vehicleId,
      userId: args.userId,
      kind: args.kind,
      category: args.category,
      odo: args.odo,
      amount: args.amount,
      liters: args.liters,
      fullTank: args.fullTank,
      expiresAt: args.expiresAt,
      notes: args.notes,
      raw: args.raw,
      undoSnapshot,
      undone: false,
      createdAt: now,
    });

    // --- odometer state (lib/rateSmoothing.ts owns the invariants) ---
    let odoRejectedReason: string | undefined;
    let odoForAnchor = touchedRule?.anchorOdo; // fallback if this event carries no reading
    if (args.odo !== undefined) {
      const result = computeOdoUpdate(vehicle, args.odo, now);
      if (result.accepted) {
        await ctx.db.patch(args.vehicleId, {
          currentOdo: result.state.currentOdo,
          currentOdoAt: result.state.currentOdoAt,
          avgKmPerDay: result.state.avgKmPerDay,
        });
        odoForAnchor = args.odo;
      } else {
        odoRejectedReason = result.reason;
      }
    }

    // --- rule anchor patch: same mutation, per agents.md ---
    if (touchedRule) {
      if (touchedRule.mode === "expiry") {
        if (args.expiresAt !== undefined) {
          await ctx.db.patch(touchedRule._id, {
            dueAt: args.expiresAt,
            anchorEstimated: false,
            updatedAt: now,
          });
        }
      } else {
        const patch: Record<string, unknown> = { anchorEstimated: false, updatedAt: now };
        if (touchedRule.intervalKm !== undefined && odoForAnchor !== undefined) {
          patch.anchorOdo = odoForAnchor;
        }
        if (touchedRule.intervalMonths !== undefined) {
          patch.anchorAt = now;
        }
        await ctx.db.patch(touchedRule._id, patch);
      }
    }

    return { eventId, odoRejectedReason, touchedCategory: touchedRule?.category };
  },
});

export const undoLast = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const recent = await ctx.db
      .query("events")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
    const last = recent.find((e) => !e.undone);
    if (!last) return { status: "none" as const };
    if (!last.undoSnapshot) return { status: "cannot_undo" as const };

    await ctx.db.patch(last.vehicleId, {
      currentOdo: last.undoSnapshot.vehicle.currentOdo,
      currentOdoAt: last.undoSnapshot.vehicle.currentOdoAt,
      avgKmPerDay: last.undoSnapshot.vehicle.avgKmPerDay,
    });

    for (const r of last.undoSnapshot.rules) {
      await ctx.db.patch(r.ruleId, {
        anchorOdo: r.anchorOdo,
        anchorAt: r.anchorAt,
        anchorEstimated: r.anchorEstimated,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.patch(last._id, { undone: true });
    return { status: "ok" as const, event: last };
  },
});

export const recentForUser = internalQuery({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit }) => {
    return await ctx.db
      .query("events")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit ?? 20);
  },
});
