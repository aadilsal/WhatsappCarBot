import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// See docs/architecture.md §2 for the full rationale behind each table and
// docs/architecture-essentials.md for the condensed invariants. Nothing here
// stores a computed due date — due dates are derived at evaluation time from
// an anchor + interval (rules table) or an absolute dueAt (expiry rules only).

export default defineSchema({
  users: defineTable({
    waId: v.string(), // WhatsApp phone number, the user's identity
    timezoneOffsetMinutes: v.number(), // e.g. 300 for Pakistan (UTC+5)
    lastInboundAt: v.number(), // governs the 24h free-form messaging window
    dailyCheckinEnabled: v.boolean(),
    weeklySummaryEnabled: v.boolean(),
    monthlySummaryEnabled: v.boolean(),
    createdAt: v.number(),
  }).index("by_waId", ["waId"]),

  vehicles: defineTable({
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

    // Live odometer state — the backbone every km-based rule depends on.
    currentOdo: v.optional(v.number()),
    currentOdoAt: v.optional(v.number()),
    avgKmPerDay: v.optional(v.number()), // smoothed, 30% blend weight per new reading

    active: v.boolean(), // soft-delete; also lets "one active vehicle" resolution skip disambiguation
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_nickname", ["userId", "nickname"])
    .index("by_user_plate", ["userId", "plate"]),

  // Single append-only log: every fuel fill, service, repair, wash, expense,
  // document, and bare odometer reading is one row here. Never scanned by the
  // hourly reminder cron — rule anchors are denormalized onto `rules` instead.
  events: defineTable({
    vehicleId: v.id("vehicles"),
    userId: v.id("users"), // denormalized for cross-vehicle history/summary queries
    kind: v.union(
      v.literal("fuel"),
      v.literal("service"),
      v.literal("expense"),
      v.literal("odo"),
      v.literal("document"),
      v.literal("note"),
    ),
    category: v.optional(v.string()), // "oil", "tyre_rotation", "insurance", "wash", ...
    odo: v.optional(v.number()),
    amount: v.optional(v.number()), // PKR
    liters: v.optional(v.number()),
    fullTank: v.optional(v.boolean()),
    expiresAt: v.optional(v.number()), // document/insurance/registration expiry set by this event
    notes: v.optional(v.string()),
    raw: v.string(), // original WhatsApp text — a bad parse can always be diagnosed

    // Undo snapshot: vehicle odometer state + every rule anchor exactly as
    // they were immediately before this event was written. `undo` restores
    // from this rather than reverse-computing the mutation.
    undoSnapshot: v.optional(
      v.object({
        vehicle: v.object({
          currentOdo: v.optional(v.number()),
          currentOdoAt: v.optional(v.number()),
          avgKmPerDay: v.optional(v.number()),
        }),
        rules: v.array(
          v.object({
            ruleId: v.id("rules"),
            anchorOdo: v.optional(v.number()),
            anchorAt: v.optional(v.number()),
            anchorEstimated: v.optional(v.boolean()),
            anchorSetAt: v.optional(v.number()),
          }),
        ),
      }),
    ),
    undone: v.optional(v.boolean()), // prevents double-undo of the same event

    createdAt: v.number(),
  })
    .index("by_vehicle_created", ["vehicleId", "createdAt"])
    .index("by_vehicle_kind", ["vehicleId", "kind"])
    .index("by_user_created", ["userId", "createdAt"]),

  // One row per maintenance item per vehicle. Anchors are denormalized here
  // and patched in the same mutation that writes a matching event — this is
  // what the hourly evaluator reads, never the event log.
  rules: defineTable({
    vehicleId: v.id("vehicles"),
    category: v.string(), // "oil", "tyre_rotation", "insurance", ...
    mode: v.union(v.literal("interval"), v.literal("expiry")),

    // interval mode
    intervalKm: v.optional(v.number()),
    intervalMonths: v.optional(v.number()),
    anchorOdo: v.optional(v.number()),
    anchorAt: v.optional(v.number()),
    anchorEstimated: v.optional(v.boolean()), // true when setup assumed "now" rather than being told a real date/reading
    // Stamped only when the anchor *value* itself is set by a logged event
    // (logEventCore), never by an interval/active-only edit (setInterval_,
    // dashboard updateRule). Lets the dashboard's event-edit flow tell "did
    // this exact event set the anchor currently in effect?" from `updatedAt`
    // alone being ambiguous (also bumped by non-anchor edits).
    anchorSetAt: v.optional(v.number()),

    // expiry mode
    dueAt: v.optional(v.number()),

    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_vehicle", ["vehicleId"])
    .index("by_vehicle_category", ["vehicleId", "category"]),

  // Dedupe key for the hourly cron: one row per (ruleId, cycleKey, tierKey)
  // actually delivered. cycleKey is derived from the anchor, so a new event
  // (which patches the anchor) resets the entire tier ladder for free.
  sentReminders: defineTable({
    ruleId: v.id("rules"),
    cycleKey: v.string(),
    tierKey: v.string(),
    sentAt: v.number(),
  }).index("by_rule_cycle_tier", ["ruleId", "cycleKey", "tierKey"]),

  // Multi-turn conversation state: an in-progress setup draft, a "which
  // vehicle?" disambiguation, an odometer prompt. expiresAt keeps a stale
  // state from hijacking an unrelated later message.
  pending: defineTable({
    waId: v.string(),
    type: v.union(
      v.literal("setup"),
      v.literal("vehicle_disambiguation"),
      v.literal("odo_prompt"),
    ),
    draft: v.any(), // shape depends on `type`; validated by the handler that reads it
    step: v.optional(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
  }).index("by_waId", ["waId"]),

  // Meta retries webhooks on any non-2xx/timeout. Every inbound message ID is
  // checked against this table and inserted before any side-effecting logic
  // runs, or one delivery hiccup logs your fuel twice.
  inboundMessages: defineTable({
    messageId: v.string(), // Meta's WhatsApp message ID
    receivedAt: v.number(),
  }).index("by_messageId", ["messageId"]),

  // Dashboard login codes, one active row per waId. `consumed` prevents
  // reuse; `attempts` caps guessing. A stale row is just ignored past
  // expiresAt, same pattern as `pending`.
  otpCodes: defineTable({
    waId: v.string(),
    code: v.string(), // 6 digits
    expiresAt: v.number(),
    attempts: v.number(),
    consumed: v.boolean(),
    createdAt: v.number(),
  }).index("by_waId", ["waId"]),

  // Dashboard session tokens, issued on successful OTP verification. Passed
  // explicitly as an argument on every dashboard.ts call and validated
  // server-side — never a bare userId trusted from the client.
  sessions: defineTable({
    token: v.string(),
    userId: v.id("users"),
    waId: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  }).index("by_token", ["token"]),
});
