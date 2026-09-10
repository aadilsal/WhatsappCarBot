// Multi-turn conversation state helpers. `pending` is real conversation
// state with an expiry, not a cache (agents.md) — a lapsed row is just gone,
// never silently reused past `expiresAt`.

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // a day is plenty for a paused wizard

export const getActivePending = internalQuery({
  args: { waId: v.string() },
  handler: async (ctx, { waId }) => {
    const row = await ctx.db
      .query("pending")
      .withIndex("by_waId", (q) => q.eq("waId", waId))
      .unique();
    if (!row) return null;
    if (row.expiresAt < Date.now()) return null;
    return row;
  },
});

export const setPending = internalMutation({
  args: {
    waId: v.string(),
    type: v.union(
      v.literal("setup"),
      v.literal("vehicle_disambiguation"),
      v.literal("odo_prompt"),
    ),
    draft: v.any(),
    step: v.optional(v.string()),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, { waId, type, draft, step, ttlMs }) => {
    const existing = await ctx.db
      .query("pending")
      .withIndex("by_waId", (q) => q.eq("waId", waId))
      .unique();

    const expiresAt = Date.now() + (ttlMs ?? DEFAULT_TTL_MS);
    if (existing) {
      await ctx.db.patch(existing._id, { type, draft, step, expiresAt });
    } else {
      await ctx.db.insert("pending", { waId, type, draft, step, expiresAt, createdAt: Date.now() });
    }
  },
});

export const clearPending = internalMutation({
  args: { waId: v.string() },
  handler: async (ctx, { waId }) => {
    const existing = await ctx.db
      .query("pending")
      .withIndex("by_waId", (q) => q.eq("waId", waId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});
