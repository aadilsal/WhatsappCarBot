"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, Input } from "@/components/ui";
import { VehicleNav } from "@/components/vehicle-nav";

function dueBadge(due: { metric: string; remaining: number } | null) {
  if (!due) return <Badge tone="neutral">—</Badge>;
  const unit = due.metric === "km" ? "km" : "days";
  const magnitude = Math.round(Math.abs(due.remaining));
  if (due.remaining <= 0) return <Badge tone="danger">overdue {magnitude}{unit}</Badge>;
  if (due.remaining < (due.metric === "km" ? 500 : 7)) return <Badge tone="warn">due in {magnitude}{unit}</Badge>;
  return <Badge tone="ok">due in {magnitude}{unit}</Badge>;
}

function RuleRow({ vehicleId, entry }: { vehicleId: Id<"vehicles">; entry: { rule: any; due: any } }) {
  const { token } = useAuth();
  const { rule, due } = entry;
  const updateRule = useMutation(api.dashboard.updateRule);
  const [km, setKm] = useState(rule.intervalKm?.toString() ?? "");
  const [months, setMonths] = useState(rule.intervalMonths?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!token) return;
    setSaving(true);
    try {
      await updateRule({
        token,
        ruleId: rule._id,
        intervalKm: rule.intervalKm !== undefined ? Number(km) : undefined,
        intervalMonths: rule.intervalMonths !== undefined ? Number(months) : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!token) return;
    await updateRule({ token, ruleId: rule._id, active: !rule.active });
  }

  return (
    <tr className={`hover:bg-neutral-800 ${!rule.active ? "opacity-50" : ""}`}>
      <td className="px-4 py-3 capitalize text-neutral-200">{rule.category.replace(/_/g, " ")}</td>
      <td className="px-4 py-3">{dueBadge(due)}</td>
      <td className="px-4 py-3">
        {rule.mode === "expiry" ? (
          <span className="text-neutral-400">expiry</span>
        ) : (
          <div className="flex items-center gap-2">
            {rule.intervalKm !== undefined && (
              <Input className="w-20" type="number" value={km} onChange={(e) => setKm(e.target.value)} />
            )}
            {rule.intervalKm !== undefined && <span className="text-xs text-neutral-400">km</span>}
            {rule.intervalMonths !== undefined && (
              <Input className="w-16" type="number" value={months} onChange={(e) => setMonths(e.target.value)} />
            )}
            {rule.intervalMonths !== undefined && <span className="text-xs text-neutral-400">mo</span>}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-3">
          {rule.mode === "interval" && (
            <Button variant="secondary" onClick={save} disabled={saving}>
              Save
            </Button>
          )}
          <Button variant="secondary" onClick={toggleActive}>
            {rule.active ? "Disable" : "Enable"}
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function RulesList({ vehicleId }: { vehicleId: string }) {
  const { token } = useAuth();
  const id = vehicleId as Id<"vehicles">;
  const rules = useQuery(api.dashboard.listRules, token ? { token, vehicleId: id } : "skip");

  return (
    <div>
      <VehicleNav vehicleId={vehicleId} />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="text-xl font-semibold text-neutral-100">Reminders</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Intervals reset automatically whenever you log a matching service on WhatsApp or here.
        </p>

        <Card className="mt-4 overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-neutral-800 text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Interval</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {rules === undefined && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-neutral-400">
                    Loading…
                  </td>
                </tr>
              )}
              {rules?.map((entry) => (
                <RuleRow key={entry.rule._id} vehicleId={id} entry={entry} />
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
