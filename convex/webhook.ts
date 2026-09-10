import { httpAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// Only text and button/list replies are handled tonight — media messages
// (image/audio/document/location) are explicitly "Later" scope
// (architecture.md §8 item 11). Dedupe still records them; they're just not
// dispatched to the message processor.
function extractText(message: any): string | null {
  if (message.type === "text" && message.text?.body) return message.text.body;
  if (message.type === "interactive") {
    const btn = message.interactive?.button_reply;
    if (btn) return btn.title ?? btn.id ?? null;
    const list = message.interactive?.list_reply;
    if (list) return list.title ?? list.id ?? null;
  }
  if (message.type === "button" && message.button?.text) return message.button.text;
  return null;
}

// Pakistan (UTC+5) is the default until Phase 3's setup wizard captures a
// real timezone offset per user.
const DEFAULT_TIMEZONE_OFFSET_MINUTES = 300;

// GET /webhook — Meta's one-time subscription handshake. Echoes hub.challenge
// back only if hub.verify_token matches our shared secret.
export const verify = httpAction(async (_ctx, request) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
});

// POST /webhook — inbound messages and status updates. Meta retries on any
// non-2xx or timeout, so signature verification and dedupe happen before any
// other side effect.
export const receive = httpAction(async (ctx, request) => {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-hub-signature-256");

  const valid = await verifySignature(
    rawBody,
    signatureHeader,
    process.env.WHATSAPP_APP_SECRET,
  );
  if (!valid) {
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const entries = payload.entry ?? [];

  for (const entry of entries) {
    const changes = entry.changes ?? [];
    for (const change of changes) {
      // Status-update payloads (delivered/read) carry no `messages` array —
      // only inbound user messages advance lastInboundAt.
      const messages = change.value?.messages ?? [];
      for (const message of messages) {
        const isNew: boolean = await ctx.runMutation(internal.webhook.recordInbound, {
          messageId: message.id,
          waId: message.from,
          receivedAt: Date.now(),
        });
        if (!isNew) continue; // Meta retry — already processed

        const text = extractText(message);
        if (text === null) continue; // unsupported message type (media, etc.)

        // Hand off to the (Claude-calling, potentially slow) processor so
        // this handler can return 200 quickly.
        await ctx.scheduler.runAfter(0, internal.message.process, {
          waId: message.from,
          text,
        });
      }
    }
  }

  return new Response("OK", { status: 200 });
});

async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined,
): Promise<boolean> {
  if (!signatureHeader || !appSecret) return false;

  const [scheme, hex] = signatureHeader.split("=");
  if (scheme !== "sha256" || !hex) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(rawBody),
  );
  const computedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(computedHex, hex);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Dedupe + user upsert in one mutation: a Meta retry that lands after the
// first insert is a no-op, never a double-stamped lastInboundAt.
export const recordInbound = internalMutation({
  args: {
    messageId: v.string(),
    waId: v.string(),
    receivedAt: v.number(),
  },
  handler: async (ctx, { messageId, waId, receivedAt }): Promise<boolean> => {
    const alreadyProcessed = await ctx.db
      .query("inboundMessages")
      .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
      .unique();
    if (alreadyProcessed) return false;

    await ctx.db.insert("inboundMessages", { messageId, receivedAt });

    const user = await ctx.db
      .query("users")
      .withIndex("by_waId", (q) => q.eq("waId", waId))
      .unique();

    if (user) {
      await ctx.db.patch(user._id, { lastInboundAt: receivedAt });
    } else {
      await ctx.db.insert("users", {
        waId,
        timezoneOffsetMinutes: DEFAULT_TIMEZONE_OFFSET_MINUTES,
        lastInboundAt: receivedAt,
        dailyCheckinEnabled: true,
        weeklySummaryEnabled: true,
        monthlySummaryEnabled: true,
        createdAt: receivedAt,
      });
    }

    return true;
  },
});
