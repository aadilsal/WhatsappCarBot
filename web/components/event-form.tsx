"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id, Doc } from "@convex/_generated/dataModel";
import { useAuth } from "@/lib/auth";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { VehicleNav } from "@/components/vehicle-nav";
import { EVENT_KINDS, EventKind } from "@/lib/constants";
import { fromDateInputValue, toDateInputValue } from "@/lib/format";

type Props =
  | { mode: "new"; vehicleId: string }
  | { mode: "edit"; vehicleId: string; eventId: string };

export function EventForm(props: Props) {
  const { token } = useAuth();
  const router = useRouter();
  const vehicleIdT = props.vehicleId as Id<"vehicles">;
  const eventIdT = props.mode === "edit" ? (props.eventId as Id<"events">) : undefined;

  const existing = useQuery(
    api.dashboard.getEvent,
    props.mode === "edit" && token ? { token, eventId: eventIdT! } : "skip",
  );
  const categories = useQuery(api.dashboard.listCategories, {});
  const createEvent = useMutation(api.dashboard.createEvent);
  const updateEvent = useMutation(api.dashboard.updateEvent);

  return props.mode === "edit" && existing === undefined ? (
    <div>
      <VehicleNav vehicleId={props.vehicleId} />
      <p className="px-4 py-10 text-sm text-neutral-400 sm:px-6">Loading…</p>
    </div>
  ) : (
    <FormBody
      mode={props.mode}
      vehicleId={props.vehicleId}
      vehicleIdT={vehicleIdT}
      eventIdT={eventIdT}
      existing={existing ?? null}
      categories={categories ?? []}
      onCreate={createEvent}
      onUpdate={updateEvent}
      onDone={() => router.replace(props.mode === "edit" ? `/dashboard/${props.vehicleId}/events` : `/dashboard/${props.vehicleId}`)}
    />
  );
}

function FormBody({
  mode,
  vehicleId,
  vehicleIdT,
  eventIdT,
  existing,
  categories,
  onCreate,
  onUpdate,
  onDone,
}: {
  mode: "new" | "edit";
  vehicleId: string;
  vehicleIdT: Id<"vehicles">;
  eventIdT: Id<"events"> | undefined;
  existing: Doc<"events"> | null;
  categories: Array<{ category: string; label: string; mode: string }>;
  onCreate: (args: any) => Promise<any>;
  onUpdate: (args: any) => Promise<any>;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const isEdit = mode === "edit";

  const [kind, setKind] = useState<EventKind>((existing?.kind as EventKind) ?? "fuel");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [odo, setOdo] = useState(existing?.odo?.toString() ?? "");
  const [amount, setAmount] = useState(existing?.amount?.toString() ?? "");
  const [liters, setLiters] = useState(existing?.liters?.toString() ?? "");
  const [fullTank, setFullTank] = useState(existing?.fullTank ?? false);
  const [expiresAt, setExpiresAt] = useState(toDateInputValue(existing?.expiresAt));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const relevantCategories = categories.filter((c) =>
    kind === "service" ? c.mode === "interval" : kind === "document" ? c.mode === "expiry" : true,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      if (isEdit) {
        await onUpdate({
          token,
          eventId: eventIdT!,
          patch: {
            amount: amount ? Number(amount) : undefined,
            liters: liters ? Number(liters) : undefined,
            fullTank: (kind === "fuel" ? fullTank : undefined) as any,
            notes: notes || undefined,
            odo: odo ? Number(odo) : undefined,
            expiresAt: expiresAt ? fromDateInputValue(expiresAt) : undefined,
          },
        });
      } else {
        await onCreate({
          token,
          vehicleId: vehicleIdT,
          kind,
          category: category || undefined,
          odo: odo ? Number(odo) : undefined,
          amount: amount ? Number(amount) : undefined,
          liters: kind === "fuel" && liters ? Number(liters) : undefined,
          fullTank: kind === "fuel" ? fullTank : undefined,
          expiresAt: kind === "document" && expiresAt ? fromDateInputValue(expiresAt) : undefined,
          notes: notes || undefined,
        });
      }
      onDone();
    } catch {
      setError("Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <VehicleNav vehicleId={vehicleId} />
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
        <h1 className="text-xl font-semibold text-neutral-100">{isEdit ? "Edit entry" : "Log something"}</h1>
        {isEdit && (
          <p className="mt-1 text-sm text-neutral-500">
            Kind, category, and date can&rsquo;t be changed here — they&rsquo;re part of the vehicle&rsquo;s history.
            Log a new entry instead if this was misclassified.
          </p>
        )}

        <Card className="mt-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Kind">
                <Select value={kind} disabled={isEdit} onChange={(e) => setKind(e.target.value as EventKind)}>
                  {EVENT_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {(kind === "service" || kind === "document") && (
                <Field label="Category">
                  <Select value={category} disabled={isEdit} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">—</option>
                    {relevantCategories.map((c) => (
                      <option key={c.category} value={c.category}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Odometer (km)">
                <Input type="number" value={odo} onChange={(e) => setOdo(e.target.value)} />
              </Field>
              <Field label="Amount (Rs)">
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            </div>

            {kind === "fuel" && (
              <div className="grid grid-cols-2 items-end gap-4">
                <Field label="Litres">
                  <Input type="number" value={liters} onChange={(e) => setLiters(e.target.value)} />
                </Field>
                <label className="flex items-center gap-2 pb-2 text-sm text-neutral-300">
                  <input type="checkbox" checked={fullTank} onChange={(e) => setFullTank(e.target.checked)} />
                  Full tank
                </label>
              </div>
            )}

            {kind === "document" && (
              <Field label="Expires on">
                <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </Field>
            )}

            <Field label="Notes">
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>

            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : isEdit ? "Save changes" : "Log it"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
