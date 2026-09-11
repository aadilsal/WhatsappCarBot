// Public API surface for the web dashboard. Every function takes `token`
// first and resolves it via requireSession (auth.ts) — nothing here ever
// trusts a client-supplied userId/vehicleId ownership claim without
// checking it against the session.
//
// Deletion is deliberately absent from this file: events/documents are the
// exact record a buyer wants to see when the vehicle is sold, so there is no
// deleteEvent. Vehicles get setVehicleActive (soft archive) instead of a
// hard delete, so history is never lost either way.

import { v } from "convex/values";
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireSession } from "./auth";
import { logEventCore } from "./events";
import { finalizeSetupCore, type SetupDraft } from "./setupWizard";
import { DEFAULT_RULES, type Calibration } from "./rules";
import { evaluateRule } from "./reminders";

// Static reference data (no auth needed) — sourced from the one canonical
// list in rules.ts so the dashboard's category pickers can never drift from
// what the evaluator/WhatsApp side actually understands.
export const listCategories = query({
  args: {},
  handler: async () => DEFAULT_RULES.map((r) => ({ category: r.category, label: r.label, mode: r.mode })),
});

const fuelTypeValidator = v.union(
  v.literal("petrol"),
  v.literal("diesel"),
  v.literal("hybrid"),
  v.literal("electric"),
  v.literal("cng"),
);

async function requireOwnedVehicle(ctx: QueryCtx | MutationCtx, userId: Id<"users">, vehicleId: Id<"vehicles">) {
  const vehicle = await ctx.db.get(vehicleId);
  if (!vehicle || vehicle.userId !== userId) throw new Error("Vehicle not found");
  return vehicle;
}

// ---------- vehicles ----------

export const listVehicles = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { userId } = await requireSession(ctx, token);
    return await ctx.db
      .query("vehicles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const getVehicle = query({
  args: { token: v.string(), vehicleId: v.id("vehicles") },
  handler: async (ctx, { token, vehicleId }) => {
    const { userId } = await requireSession(ctx, token);
    const vehicle = await requireOwnedVehicle(ctx, userId, vehicleId);
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicleId))
      .collect();
    const now = Date.now();
    const dueSoon = rules
      .filter((r) => r.active)
      .map((r) => ({ rule: r, due: evaluateRule(r, vehicle, now) }))
      .filter((x) => x.due !== null);
    return { vehicle, dueSoon };
  },
});

const editableVehicleFields = v.object({
  nickname: v.optional(v.string()),
  make: v.optional(v.string()),
  model: v.optional(v.string()),
  year: v.optional(v.number()),
  plate: v.optional(v.string()),
  vin: v.optional(v.string()),
  engine: v.optional(v.string()),
  fuelType: v.optional(fuelTypeValidator),
  purchaseDate: v.optional(v.number()),
  purchasePrice: v.optional(v.number()),
});

export const updateVehicle = mutation({
  args: { token: v.string(), vehicleId: v.id("vehicles"), patch: editableVehicleFields },
  handler: async (ctx, { token, vehicleId, patch }) => {
    const { userId } = await requireSession(ctx, token);
    await requireOwnedVehicle(ctx, userId, vehicleId);
    await ctx.db.patch(vehicleId, patch);
  },
});

// Soft archive only — never a hard delete, so history survives.
export const setVehicleActive = mutation({
  args: { token: v.string(), vehicleId: v.id("vehicles"), active: v.boolean() },
  handler: async (ctx, { token, vehicleId, active }) => {
    const { userId } = await requireSession(ctx, token);
    await requireOwnedVehicle(ctx, userId, vehicleId);
    await ctx.db.patch(vehicleId, { active });
  },
});

// Structured equivalent of the WhatsApp setup wizard — the form already
// gives typed fields, so this skips extractSetupFields entirely and goes
// straight to finalizeSetupCore (setupWizard.ts), same as the wizard's last
// step does.
export const addVehicle = mutation({
  args: {
    token: v.string(),
    nickname: v.string(),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    year: v.optional(v.number()),
    plate: v.optional(v.string()),
    fuelType: v.optional(fuelTypeValidator),
    currentOdo: v.optional(v.number()),
    vin: v.optional(v.string()),
    engine: v.optional(v.string()),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    calibration: v.optional(
      v.array(v.object({ category: v.string(), odo: v.optional(v.number()), at: v.optional(v.number()) })),
    ),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireSession(ctx, args.token);

    const calibration: Calibration = {};
    for (const item of args.calibration ?? []) {
      calibration[item.category] = { odo: item.odo, at: item.at };
    }

    const draft: SetupDraft = {
      nickname: args.nickname,
      make: args.make,
      model: args.model,
      year: args.year,
      plate: args.plate,
      fuelType: args.fuelType,
      currentOdo: args.currentOdo,
      vin: args.vin,
      engine: args.engine,
      purchaseDate: args.purchaseDate,
      purchasePrice: args.purchasePrice,
      calibration,
      skippedSteps: [],
    };

    return await finalizeSetupCore(ctx, { userId, draft });
  },
});

// ---------- events ----------

export const listEvents = query({
  args: {
    token: v.string(),
    vehicleId: v.id("vehicles"),
    kind: v.optional(v.string()),
    category: v.optional(v.string()),
    fromDate: v.optional(v.number()),
    toDate: v.optional(v.number()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireSession(ctx, args.token);
    await requireOwnedVehicle(ctx, userId, args.vehicleId);

    let events = await ctx.db
      .query("events")
      .withIndex("by_vehicle_created", (q) => q.eq("vehicleId", args.vehicleId))
      .order("desc")
      .collect();

    events = events.filter((e) => !e.undone);
    if (args.kind) events = events.filter((e) => e.kind === args.kind);
    if (args.category) events = events.filter((e) => e.category === args.category);
    if (args.fromDate !== undefined) events = events.filter((e) => e.createdAt >= args.fromDate!);
    if (args.toDate !== undefined) events = events.filter((e) => e.createdAt <= args.toDate!);
    if (args.search) {
      const needle = args.search.toLowerCase();
      events = events.filter(
        (e) =>
          (e.notes ?? "").toLowerCase().includes(needle) ||
          e.raw.toLowerCase().includes(needle) ||
          (e.category ?? "").toLowerCase().includes(needle),
      );
    }

    const total = events.length;
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 25;
    return { events: events.slice(offset, offset + limit), total };
  },
});

export const getEvent = query({
  args: { token: v.string(), eventId: v.id("events") },
  handler: async (ctx, { token, eventId }) => {
    const { userId } = await requireSession(ctx, token);
    const event = await ctx.db.get(eventId);
    if (!event || event.userId !== userId) return null;
    return event;
  },
});

export const createEvent = mutation({
  args: {
    token: v.string(),
    vehicleId: v.id("vehicles"),
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
  },
  handler: async (ctx, args) => {
    const { userId } = await requireSession(ctx, args.token);
    await requireOwnedVehicle(ctx, userId, args.vehicleId);
    return await logEventCore(ctx, { ...args, userId, raw: "(added via dashboard)" });
  },
});

// Deliberately conservative — see file header and agents.md. `kind`,
// `category`, and `createdAt` can never be patched here: changing them
// retroactively could orphan a rule anchor with no clean way back. `odo`
// and `expiresAt` are correctable, but only propagate to live vehicle/rule
// state when this event is still the one that set it (exact-timestamp
// match against vehicle.currentOdoAt / rule.anchorSetAt, both stamped from
// the same `now` this event's createdAt came from in logEventCore) —
// otherwise they only correct the historical record.
export const updateEvent = mutation({
  args: {
    token: v.string(),
    eventId: v.id("events"),
    patch: v.object({
      amount: v.optional(v.number()),
      liters: v.optional(v.number()),
      fullTank: v.optional(v.boolean()),
      notes: v.optional(v.string()),
      odo: v.optional(v.number()),
      expiresAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { token, eventId, patch }) => {
    const { userId } = await requireSession(ctx, token);
    const event = await ctx.db.get(eventId);
    if (!event || event.userId !== userId) throw new Error("Event not found");
    if (event.undone) throw new Error("Can't edit an undone entry.");

    const vehicle = await ctx.db.get(event.vehicleId);
    if (!vehicle) throw new Error("Vehicle not found");

    const safePatch: Record<string, unknown> = {};
    if (patch.amount !== undefined) safePatch.amount = patch.amount;
    if (patch.liters !== undefined) safePatch.liters = patch.liters;
    if (patch.fullTank !== undefined) safePatch.fullTank = patch.fullTank;
    if (patch.notes !== undefined) safePatch.notes = patch.notes;

    if (patch.odo !== undefined) {
      safePatch.odo = patch.odo;

      const isLiveVehicleOdo = event.odo !== undefined && vehicle.currentOdoAt === event.createdAt;
      if (isLiveVehicleOdo) {
        await ctx.db.patch(event.vehicleId, { currentOdo: patch.odo });
      }

      if (event.category && (event.kind === "service" || event.kind === "document")) {
        const rule = await ctx.db
          .query("rules")
          .withIndex("by_vehicle_category", (q) => q.eq("vehicleId", event.vehicleId).eq("category", event.category!))
          .unique();
        if (rule && rule.mode === "interval" && rule.anchorSetAt === event.createdAt && rule.anchorOdo !== undefined) {
          await ctx.db.patch(rule._id, { anchorOdo: patch.odo });
        }
      }
    }

    if (patch.expiresAt !== undefined) {
      safePatch.expiresAt = patch.expiresAt;

      if (event.kind === "document" && event.category) {
        const rule = await ctx.db
          .query("rules")
          .withIndex("by_vehicle_category", (q) => q.eq("vehicleId", event.vehicleId).eq("category", event.category!))
          .unique();
        if (rule && rule.mode === "expiry" && rule.anchorSetAt === event.createdAt) {
          await ctx.db.patch(rule._id, { dueAt: patch.expiresAt, updatedAt: Date.now() });
        }
      }
    }

    await ctx.db.patch(eventId, safePatch);
  },
});

// ---------- rules ----------

export const listRules = query({
  args: { token: v.string(), vehicleId: v.id("vehicles") },
  handler: async (ctx, { token, vehicleId }) => {
    const { userId } = await requireSession(ctx, token);
    const vehicle = await requireOwnedVehicle(ctx, userId, vehicleId);
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicleId))
      .collect();
    const now = Date.now();
    return rules.map((rule) => ({ rule, due: evaluateRule(rule, vehicle, now) }));
  },
});

// Interval/active only — never touches anchorOdo/anchorAt/anchorSetAt, so
// this can't be mistaken by updateEvent for "the event that set the anchor".
export const updateRule = mutation({
  args: {
    token: v.string(),
    ruleId: v.id("rules"),
    intervalKm: v.optional(v.number()),
    intervalMonths: v.optional(v.number()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { token, ruleId, intervalKm, intervalMonths, active }) => {
    const { userId } = await requireSession(ctx, token);
    const rule = await ctx.db.get(ruleId);
    if (!rule) throw new Error("Rule not found");
    await requireOwnedVehicle(ctx, userId, rule.vehicleId);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (intervalKm !== undefined) patch.intervalKm = intervalKm;
    if (intervalMonths !== undefined) patch.intervalMonths = intervalMonths;
    if (active !== undefined) patch.active = active;
    await ctx.db.patch(ruleId, patch);
  },
});
