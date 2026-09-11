import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const getByWaId = internalQuery({
  args: { waId: v.string() },
  handler: async (ctx, { waId }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_waId", (q) => q.eq("waId", waId))
      .unique();
  },
});

export const listAll = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("users").collect(),
});
