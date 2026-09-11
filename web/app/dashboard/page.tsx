"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { AuthGuard, useAuth } from "@/lib/auth";
import { Badge, Card } from "@/components/ui";
import { formatOdo } from "@/lib/format";

function VehicleList() {
  const { token } = useAuth();
  const vehicles = useQuery(api.dashboard.listVehicles, token ? { token } : "skip");

  if (vehicles === undefined) {
    return <p className="px-4 py-10 text-sm text-neutral-400 sm:px-6">Loading…</p>;
  }

  const active = vehicles.filter((v) => v.active);
  const inactive = vehicles.filter((v) => !v.active);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-100">Your vehicles</h1>
        <Link href="/dashboard/vehicles/new" className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white">
          + Add vehicle
        </Link>
      </div>

      {active.length === 0 && (
        <Card className="mt-6">
          <p className="text-sm text-neutral-400">
            No vehicles yet. Add one here, or text the bot on WhatsApp to get set up.
          </p>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {active.map((v) => (
          <Link key={v._id} href={`/dashboard/${v._id}`}>
            <Card className="transition-shadow hover:shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-neutral-100">{v.nickname}</p>
                  <p className="text-sm text-neutral-500">
                    {[v.make, v.model, v.year].filter(Boolean).join(" ") || "No make/model set"}
                  </p>
                </div>
                {v.plate && <Badge tone="neutral">{v.plate}</Badge>}
              </div>
              <p className="mt-3 text-sm text-neutral-400">{formatOdo(v.currentOdo)}</p>
            </Card>
          </Link>
        ))}
      </div>

      {inactive.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-medium text-neutral-500">Archived</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {inactive.map((v) => (
              <Link key={v._id} href={`/dashboard/${v._id}`}>
                <Card className="opacity-60 transition-opacity hover:opacity-100">
                  <p className="font-medium text-neutral-100">{v.nickname}</p>
                  <p className="text-sm text-neutral-500">{[v.make, v.model].filter(Boolean).join(" ")}</p>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <VehicleList />
    </AuthGuard>
  );
}
