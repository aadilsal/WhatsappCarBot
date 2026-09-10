// Rule evaluator + hourly cron — architecture.md §5. Reads only `rules` +
// `vehicles`, never `events` (agents.md): anchors are already denormalized,
// so the evaluator is pure math over two rows.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { MS_PER_DAY, addMonths } from "../lib/dates";
import { evaluateIntervalDue, evaluateExpiryDue, type RuleDueState } from "../lib/tiers";
import { categoryLabel } from "./rules";

export function evaluateRule(rule: Doc<"rules">, vehicle: Doc<"vehicles">, now: number): RuleDueState | null {
  if (rule.mode === "expiry") {
    if (rule.dueAt === undefined) return null;
    return evaluateExpiryDue((rule.dueAt - now) / MS_PER_DAY);
  }

  let kmRemaining: number | undefined;
  if (rule.intervalKm !== undefined && vehicle.currentOdo !== undefined && rule.anchorOdo !== undefined) {
    const daysSinceReading = Math.max(0, (now - (vehicle.currentOdoAt ?? now)) / MS_PER_DAY);
    const rate = vehicle.avgKmPerDay ?? 0;
    const projectedOdo = vehicle.currentOdo + rate * daysSinceReading;
    kmRemaining = rule.anchorOdo + rule.intervalKm - projectedOdo;
  }

  let daysRemaining: number | undefined;
  if (rule.intervalMonths !== undefined && rule.anchorAt !== undefined) {
    const dueAt = addMonths(rule.anchorAt, rule.intervalMonths);
    daysRemaining = (dueAt - now) / MS_PER_DAY;
  }

  return evaluateIntervalDue({
    kmRemaining,
    intervalKm: rule.intervalKm,
    daysRemaining,
    intervalMonths: rule.intervalMonths,
  });
}

export function ruleCycleKey(rule: Doc<"rules">): string {
  if (rule.mode === "expiry") return `exp:${rule.dueAt}`;
  return `int:${rule.anchorOdo ?? "-"}:${rule.anchorAt ?? "-"}`;
}

export function formatRemainingPhrase(rule: Doc<"rules">, due: RuleDueState): string {
  const soft = rule.anchorEstimated ? " (estimated)" : "";
  const unit = due.metric === "km" ? "km" : "days";
  const magnitude = Math.round(Math.abs(due.remaining));
  if (due.remaining <= 0) {
    return `overdue by ${magnitude} ${unit}${soft}`;
  }
  return `due in ~${magnitude} ${unit}${soft}`;
}

export function formatDueLine(vehicleName: string, rule: Doc<"rules">, due: RuleDueState): string {
  const label = categoryLabel(rule.category);
  return `${vehicleName}: ${label} ${formatRemainingPhrase(rule, due)}.`;
}

export const hasSent = internalQuery({
  args: { ruleId: v.id("rules"), cycleKey: v.string(), tierKey: v.string() },
  handler: async (ctx, { ruleId, cycleKey, tierKey }) => {
    const row = await ctx.db
      .query("sentReminders")
      .withIndex("by_rule_cycle_tier", (q) => q.eq("ruleId", ruleId).eq("cycleKey", cycleKey).eq("tierKey", tierKey))
      .unique();
    return row !== null;
  },
});

export const recordSent = internalMutation({
  args: { ruleId: v.id("rules"), cycleKey: v.string(), tierKey: v.string() },
  handler: async (ctx, { ruleId, cycleKey, tierKey }) => {
    await ctx.db.insert("sentReminders", { ruleId, cycleKey, tierKey, sentAt: Date.now() });
  },
});

export const evaluateAndSend = internalAction({
  args: {},
  handler: async (ctx) => {
    const rules = await ctx.runQuery(internal.rules.listAllActive, {});
    const now = Date.now();

    for (const rule of rules) {
      const vehicle = await ctx.runQuery(internal.vehicles.getById, { vehicleId: rule.vehicleId });
      if (!vehicle || !vehicle.active) continue;

      const due = evaluateRule(rule, vehicle, now);
      if (!due) continue;

      const cycleKey = ruleCycleKey(rule);
      const tierKey = `${due.metric}:${due.tierBucket}`;
      const alreadySent = await ctx.runQuery(internal.reminders.hasSent, { ruleId: rule._id, cycleKey, tierKey });
      if (alreadySent) continue;

      const message = formatDueLine(vehicle.nickname, rule, due);
      await ctx.runAction(internal.send.sendToUser, {
        userId: vehicle.userId,
        message,
        templateFallback: { name: "garage_reminder", params: [vehicle.nickname, categoryLabel(rule.category)] },
      });
      await ctx.runMutation(internal.reminders.recordSent, { ruleId: rule._id, cycleKey, tierKey });
    }
  },
});
