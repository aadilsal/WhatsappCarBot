// Dashboard login. OTP is delivered over the existing WhatsApp send path
// (send.sendToUser) rather than a separate email/SMS provider — the bot
// already owns the user's phone number and messaging relationship.
//
// Login only succeeds for a waId that already has a `users` row (i.e. has
// used the bot at least once). An unregistered number gets the exact same
// response as a registered one — no enumeration signal either way.

import { v } from "convex/values";
import { action, mutation, query, internalMutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

// Used by every dashboard.ts function to turn a client-supplied token into a
// trusted userId — nothing downstream ever trusts a raw userId argument.
export async function requireSession(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<{ userId: Id<"users">; waId: string }> {
  const row = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!row || row.expiresAt < Date.now()) {
    throw new Error("Session expired or invalid — please log in again.");
  }
  return { userId: row.userId, waId: row.waId };
}

export const createOtp = internalMutation({
  args: { waId: v.string() },
  handler: async (ctx, { waId }): Promise<{ code: string } | null> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("otpCodes")
      .withIndex("by_waId", (q) => q.eq("waId", waId))
      .unique();

    if (existing && !existing.consumed && now - existing.createdAt < OTP_RESEND_COOLDOWN_MS) {
      return null; // already sent one very recently — don't spam a fresh code
    }

    const code = generateCode();
    const row = { waId, code, expiresAt: now + OTP_TTL_MS, attempts: 0, consumed: false, createdAt: now };
    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("otpCodes", row);
    }
    return { code };
  },
});

// Public action (needs to call the WhatsApp API, so it can't be a mutation).
// Always returns the same shape regardless of whether waId is registered.
export const requestOtp = action({
  args: { waId: v.string() },
  handler: async (ctx, { waId }): Promise<{ ok: true }> => {
    const user = await ctx.runQuery(internal.users.getByWaId, { waId });
    if (user) {
      const created = await ctx.runMutation(internal.auth.createOtp, { waId });
      if (created) {
        await ctx.runAction(internal.send.sendToUser, {
          userId: user._id,
          message: `Your Garage Bot dashboard code is ${created.code}. It expires in 5 minutes.`,
          templateFallback: { name: "garage_otp", params: [created.code] },
        });
      }
    }
    return { ok: true };
  },
});

export const verifyOtp = mutation({
  args: { waId: v.string(), code: v.string() },
  handler: async (ctx, { waId, code }): Promise<{ status: "ok"; token: string } | { status: "invalid" | "expired" }> => {
    const now = Date.now();
    const row = await ctx.db
      .query("otpCodes")
      .withIndex("by_waId", (q) => q.eq("waId", waId))
      .unique();

    if (!row || row.consumed || row.expiresAt < now || row.attempts >= OTP_MAX_ATTEMPTS) {
      return { status: "expired" };
    }
    if (row.code !== code) {
      await ctx.db.patch(row._id, { attempts: row.attempts + 1 });
      return { status: "invalid" };
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_waId", (q) => q.eq("waId", waId))
      .unique();
    if (!user) return { status: "invalid" };

    await ctx.db.patch(row._id, { consumed: true });
    const token = generateToken();
    await ctx.db.insert("sessions", {
      token,
      userId: user._id,
      waId,
      expiresAt: now + SESSION_TTL_MS,
      createdAt: now,
    });
    return { status: "ok", token };
  },
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const row = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

// Lets the dashboard validate a token it already has (e.g. on page load)
// without throwing.
export const me = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    try {
      return await requireSession(ctx, token);
    } catch {
      return null;
    }
  },
});
