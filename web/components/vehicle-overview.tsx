"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAuth } from "@/lib/auth";
import { Badge, Card } from "@/components/ui";
import { VehicleNav } from "@/components/vehicle-nav";
import { formatDate, formatOdo, formatPKR } from "@/lib/format";

function dueBadge(due: { metric: string; remaining: number } | null) {
  if (!due) return null;
  const unit = due.metric === "km" ? "km" : "days";
  const magnitude = Math.round(Math.abs(due.remaining));
  if (due.remaining <= 0) return <Badge tone="danger">overdue {magnitude}{unit}</Badge>;
  if (due.remaining < (due.metric === "km" ? 500 : 7)) return <Badge tone="warn">due in {magnitude}{unit}</Badge>;
  return <Badge tone="ok">due in {magnitude}{unit}</Badge>;
}

export function VehicleOverview({ vehicleId }: { vehicleId: string }) {
  const { token } = useAuth();
  const id = vehicleId as Id<"vehicles">;
  const data = useQuery(api.dashboard.getVehicle, token ? { token, vehicleId: id } : "skip");
  const recent = useQuery(api.dashboard.listEvents, token ? { token, vehicleId: id, limit: 5 } : "skip");

  if (data === undefined) {
    return <p className="px-4 py-10 text-sm text-neutral-400 sm:px-6">Loading…</p>;
  }
  if (data === null) {
    return <p className="px-4 py-10 text-sm text-neutral-400 sm:px-6">Vehicle not found.</p>;
  }

  const { vehicle, dueSoon } = data;

  return (
    <div>
      <VehicleNav vehicleId={vehicleId} />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-neutral-100">{vehicle.nickname}</h1>
            <p className="text-sm text-neutral-500">
              {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "No make/model set"}
              {vehicle.plate ? ` · ${vehicle.plate}` : ""}
            </p>
          </div>
          <Link
            href={`/dashboard/${vehicleId}/events/new`}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
          >
            + Log something
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Odometer</p>
            <p className="mt-1 text-lg font-semibold text-neutral-100">{formatOdo(vehicle.currentOdo)}</p>
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Fuel type</p>
            <p className="mt-1 text-lg font-semibold capitalize text-neutral-100">{vehicle.fuelType ?? "—"}</p>
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Due soon</p>
            <p className="mt-1 text-lg font-semibold text-neutral-100">{dueSoon.length}</p>
          </Card>
        </div>

        <div className="mt-8">
          <h2 className="text-sm font-semibold text-neutral-300">Due soon</h2>
          {dueSoon.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">Nothing due soon. 👍</p>
          ) : (
            <div className="mt-3 divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
              {dueSoon.map(({ rule, due }) => (
                <div key={rule._id} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-neutral-200 capitalize">{rule.category.replace(/_/g, " ")}</span>
                  {dueBadge(due)}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-300">Recent activity</h2>
            <Link href={`/dashboard/${vehicleId}/events`} className="text-sm text-neutral-500 underline">
              View all
            </Link>
          </div>
          {recent === undefined ? (
            <p className="mt-2 text-sm text-neutral-400">Loading…</p>
          ) : recent.events.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">Nothing logged yet.</p>
          ) : (
            <div className="mt-3 divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
              {recent.events.map((e) => (
                <div key={e._id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <span className="font-medium capitalize text-neutral-200">{e.kind}</span>
                    {e.category && <span className="text-neutral-500 capitalize"> · {e.category.replace(/_/g, " ")}</span>}
                    <span className="text-neutral-400"> · {formatDate(e.createdAt)}</span>
                  </div>
                  <span className="text-neutral-400">{e.amount ? formatPKR(e.amount) : e.odo ? formatOdo(e.odo) : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
