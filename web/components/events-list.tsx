"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAuth } from "@/lib/auth";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { VehicleNav } from "@/components/vehicle-nav";
import { EVENT_KINDS } from "@/lib/constants";
import { formatDate, formatOdo, formatPKR, fromDateInputValue, toDateInputValue } from "@/lib/format";

const PAGE_SIZE = 20;

export function EventsList({ vehicleId }: { vehicleId: string }) {
  const { token } = useAuth();
  const id = vehicleId as Id<"vehicles">;

  const [kind, setKind] = useState("");
  const [category, setCategory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const categories = useQuery(api.dashboard.listCategories, {});
  const result = useQuery(
    api.dashboard.listEvents,
    token
      ? {
          token,
          vehicleId: id,
          kind: kind || undefined,
          category: category || undefined,
          fromDate: fromDate ? fromDateInputValue(fromDate) : undefined,
          toDate: toDate ? fromDateInputValue(toDate) : undefined,
          search: search.trim() || undefined,
          limit: PAGE_SIZE,
          offset,
        }
      : "skip",
  );

  function resetAnd<T>(setter: (v: T) => void) {
    return (v: T) => {
      setOffset(0);
      setter(v);
    };
  }

  return (
    <div>
      <VehicleNav vehicleId={vehicleId} />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-neutral-100">History</h1>
          <Link
            href={`/dashboard/${vehicleId}/events/new`}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
          >
            + Add event
          </Link>
        </div>

        <Card className="mt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Field label="Kind">
              <Select value={kind} onChange={(e) => resetAnd(setKind)(e.target.value)}>
                <option value="">All</option>
                {EVENT_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={category} onChange={(e) => resetAnd(setCategory)(e.target.value)}>
                <option value="">All</option>
                {(categories ?? []).map((c) => (
                  <option key={c.category} value={c.category}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From">
              <Input type="date" value={fromDate} onChange={(e) => resetAnd(setFromDate)(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={toDate} onChange={(e) => resetAnd(setToDate)(e.target.value)} />
            </Field>
            <Field label="Search">
              <Input placeholder="notes…" value={search} onChange={(e) => resetAnd(setSearch)(e.target.value)} />
            </Field>
          </div>
        </Card>

        <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-neutral-800 text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Kind</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Odometer</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Notes</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {result === undefined && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                    Loading…
                  </td>
                </tr>
              )}
              {result?.events.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                    No events match these filters.
                  </td>
                </tr>
              )}
              {result?.events.map((e) => (
                <tr key={e._id} className="hover:bg-neutral-800">
                  <td className="px-4 py-3 whitespace-nowrap text-neutral-400">{formatDate(e.createdAt)}</td>
                  <td className="px-4 py-3 capitalize text-neutral-200">{e.kind}</td>
                  <td className="px-4 py-3 capitalize text-neutral-400">{e.category?.replace(/_/g, " ") ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-400">{e.odo ? formatOdo(e.odo) : "—"}</td>
                  <td className="px-4 py-3 text-neutral-400">{e.amount ? formatPKR(e.amount) : "—"}</td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-neutral-500">{e.notes ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/${vehicleId}/events/${e._id}/edit`} className="text-neutral-500 underline">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {result && result.total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
            <span>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, result.total)} of {result.total}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={offset + PAGE_SIZE >= result.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
