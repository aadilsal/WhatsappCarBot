// sendToUser() — the only path to an outbound WhatsApp message (agents.md).
// Picks free-form vs. template based on the 24h window (architecture.md §6).
// No caller branches on the window itself.

import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendFreeformText, sendTemplate } from "./whatsapp";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export const getUserForSend = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error(`sendToUser: unknown userId ${userId}`);
    return { waId: user.waId, lastInboundAt: user.lastInboundAt };
  },
});

// `templateFallback` is optional: pass it for proactive sends (reminders,
// summaries, check-ins) that might fire outside the 24h window. Omit it for
// replies to an inbound message, which are always inside the window.
export const sendToUser = internalAction({
  args: {
    userId: v.id("users"),
    message: v.string(),
    templateFallback: v.optional(
      v.object({
        name: v.string(),
        params: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, { userId, message, templateFallback }): Promise<void> => {
    const user: { waId: string; lastInboundAt: number } = await ctx.runQuery(
      internal.send.getUserForSend,
      { userId },
    );
    const withinWindow = Date.now() - user.lastInboundAt < WINDOW_MS;

    if (withinWindow || !templateFallback) {
      await sendFreeformText(user.waId, message);
      return;
    }

    // Outside the window: templates aren't approved yet (build order item 7
    // is explicitly "Next", not "Tonight"). This will fail at the Graph API
    // until they are — that's expected during same-session testing, since
    // testing always happens inside the window.
    await sendTemplate(user.waId, templateFallback.name, templateFallback.params);
  },
});
