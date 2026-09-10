// Command dispatcher — architecture.md §7. Regex/keyword match first, run
// ahead of generic event-logging parse, since "due" or "undo" is not itself
// a loggable event (agents.md).
//
// Tonight's build order only requires `due` and `undo`; `vehicles`, `rules`,
// `set`, and `add vehicle` are cheap enough to include now. `summary`,
// `week`, and `history` are explicitly "Next" (architecture.md §8 item 8)
// and reply with a placeholder rather than silently falling through to
// event parsing.

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { categoryLabel } from "./rules";
import { evaluateRule, formatDueLine, formatRemainingPhrase } from "./reminders";

export type CommandMatch =
  | { type: "due"; vehicleText?: string }
  | { type: "undo" }
  | { type: "vehicles" }
  | { type: "rules"; vehicleText?: string }
  | { type: "set"; vehicleText: string; category: string; km: number }
  | { type: "add_vehicle" }
  | { type: "unimplemented"; name: string };

export function matchCommand(rawText: string): CommandMatch | null {
  const text = rawText.trim();

  if (/^due$/i.test(text)) return { type: "due" };
  let m = text.match(/^due\s+(.+)$/i);
  if (m) return { type: "due", vehicleText: m[1].trim() };

  if (/^undo$/i.test(text)) return { type: "undo" };
  if (/^vehicles$/i.test(text)) return { type: "vehicles" };
  if (/^rules$/i.test(text)) return { type: "rules" };
  m = text.match(/^rules\s+(.+)$/i);
  if (m) return { type: "rules", vehicleText: m[1].trim() };

  m = text.match(/^set\s+(\S+)\s+(\S+)\s+(\d+(?:\.\d+)?)\s*km$/i);
  if (m) return { type: "set", vehicleText: m[1], category: m[2].toLowerCase(), km: parseFloat(m[3]) };

  if (/^add\s+vehicle$/i.test(text)) return { type: "add_vehicle" };
  if (/^summary(\s+.+)?$/i.test(text)) return { type: "unimplemented", name: "summary" };
  if (/^week$/i.test(text)) return { type: "unimplemented", name: "week" };
  if (/^history\s+/i.test(text)) return { type: "unimplemented", name: "history" };

  return null;
}

function matchVehicles<T extends Doc<"vehicles">>(vehicles: T[], text?: string): T[] {
  if (!text) return vehicles;
  const needle = text.toLowerCase();
  const byNickname = vehicles.filter((v) => needle.includes(v.nickname.toLowerCase()));
  if (byNickname.length > 0) return byNickname;
  const byPlate = vehicles.filter((v) => v.plate && needle.includes(v.plate.toLowerCase()));
  if (byPlate.length > 0) return byPlate;
  const byModel = vehicles.filter((v) => v.model && needle.includes(v.model.toLowerCase()));
  if (byModel.length > 0) return byModel;
  return vehicles;
}

export const buildDueReport = internalQuery({
  args: { userId: v.id("users"), vehicleText: v.optional(v.string()) },
  handler: async (ctx, { userId, vehicleText }) => {
    const allVehicles = (
      await ctx.db.query("vehicles").withIndex("by_user", (q) => q.eq("userId", userId)).collect()
    ).filter((v) => v.active);
    if (allVehicles.length === 0) return "No vehicles set up yet.";

    const targets = matchVehicles(allVehicles, vehicleText);
    const lines: string[] = [];
    const now = Date.now();

    for (const vehicle of targets) {
      const rules = (
        await ctx.db.query("rules").withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id)).collect()
      ).filter((r) => r.active);
      for (const rule of rules) {
        const due = evaluateRule(rule, vehicle, now);
        if (due) lines.push(formatDueLine(vehicle.nickname, rule, due));
      }
    }

    if (lines.length === 0) return "Nothing due soon. 👍";
    return lines.join("\n");
  },
});

export const buildVehiclesList = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const vehicles = (
      await ctx.db.query("vehicles").withIndex("by_user", (q) => q.eq("userId", userId)).collect()
    ).filter((v) => v.active);
    if (vehicles.length === 0) return "No vehicles set up yet. Send anything to get started.";
    return vehicles
      .map((v) => `${v.nickname} — ${v.currentOdo !== undefined ? v.currentOdo.toLocaleString() + " km" : "no odometer yet"}`)
      .join("\n");
  },
});

export const buildRulesReport = internalQuery({
  args: { userId: v.id("users"), vehicleText: v.optional(v.string()) },
  handler: async (ctx, { userId, vehicleText }) => {
    const allVehicles = (
      await ctx.db.query("vehicles").withIndex("by_user", (q) => q.eq("userId", userId)).collect()
    ).filter((v) => v.active);
    if (allVehicles.length === 0) return "No vehicles set up yet.";

    const targets = matchVehicles(allVehicles, vehicleText);
    const now = Date.now();
    const sections: string[] = [];

    for (const vehicle of targets) {
      const rules = (
        await ctx.db.query("rules").withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id)).collect()
      ).filter((r) => r.active);
      const lines = rules.map((rule) => {
        const due = evaluateRule(rule, vehicle, now);
        const label = categoryLabel(rule.category);
        const interval =
          rule.mode === "expiry"
            ? "expiry"
            : [rule.intervalKm ? `${rule.intervalKm}km` : null, rule.intervalMonths ? `${rule.intervalMonths}mo` : null]
                .filter(Boolean)
                .join(" / ");
        const status = due ? formatRemainingPhrase(rule, due) : "not due soon";
        return `${label} (${interval}): ${status}`;
      });
      sections.push(`${vehicle.nickname}:\n${lines.join("\n")}`);
    }

    return sections.join("\n\n");
  },
});

export const applyIntervalOverride = internalMutation({
  args: { userId: v.id("users"), vehicleText: v.string(), category: v.string(), km: v.number() },
  handler: async (ctx, { userId, vehicleText, category, km }) => {
    const vehicles = (
      await ctx.db.query("vehicles").withIndex("by_user", (q) => q.eq("userId", userId)).collect()
    ).filter((v) => v.active);
    const targets = matchVehicles(vehicles, vehicleText);
    if (targets.length !== 1) {
      return { status: "not_found" as const };
    }
    const vehicle = targets[0];
    const rule = await ctx.db
      .query("rules")
      .withIndex("by_vehicle_category", (q) => q.eq("vehicleId", vehicle._id).eq("category", category))
      .unique();
    if (!rule) return { status: "not_found" as const };

    await ctx.db.patch(rule._id, { intervalKm: km, updatedAt: Date.now() });
    return { status: "ok" as const, vehicleName: vehicle.nickname, category };
  },
});
