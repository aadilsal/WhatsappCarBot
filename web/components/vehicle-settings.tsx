"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAuth } from "@/lib/auth";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { VehicleNav } from "@/components/vehicle-nav";
import { FUEL_TYPES } from "@/lib/constants";

export function VehicleSettings({ vehicleId }: { vehicleId: string }) {
  const { token } = useAuth();
  const id = vehicleId as Id<"vehicles">;
  const data = useQuery(api.dashboard.getVehicle, token ? { token, vehicleId: id } : "skip");
  const updateVehicle = useMutation(api.dashboard.updateVehicle);
  const setVehicleActive = useMutation(api.dashboard.setVehicleActive);

  const [form, setForm] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data?.vehicle) {
      const v = data.vehicle;
      setForm({
        nickname: v.nickname,
        make: v.make ?? "",
        model: v.model ?? "",
        year: v.year?.toString() ?? "",
        plate: v.plate ?? "",
        fuelType: v.fuelType ?? "",
        vin: v.vin ?? "",
        engine: v.engine ?? "",
      });
    }
  }, [data?.vehicle]);

  if (data === undefined) {
    return (
      <div>
        <VehicleNav vehicleId={vehicleId} />
        <p className="px-4 py-10 text-sm text-neutral-400 sm:px-6">Loading…</p>
      </div>
    );
  }
  if (data === null) return null;
  const { vehicle } = data;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setSaved(false);
    try {
      await updateVehicle({
        token,
        vehicleId: id,
        patch: {
          nickname: form.nickname || undefined,
          make: form.make || undefined,
          model: form.model || undefined,
          year: form.year ? Number(form.year) : undefined,
          plate: form.plate || undefined,
          fuelType: (form.fuelType || undefined) as any,
          vin: form.vin || undefined,
          engine: form.engine || undefined,
        },
      });
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <VehicleNav vehicleId={vehicleId} />
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="text-xl font-semibold text-neutral-100">Settings</h1>

        <Card className="mt-6">
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <Field label="Nickname">
              <Input value={form.nickname ?? ""} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Make">
                <Input value={form.make ?? ""} onChange={(e) => setForm({ ...form, make: e.target.value })} />
              </Field>
              <Field label="Model">
                <Input value={form.model ?? ""} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Year">
                <Input type="number" value={form.year ?? ""} onChange={(e) => setForm({ ...form, year: e.target.value })} />
              </Field>
              <Field label="Plate">
                <Input value={form.plate ?? ""} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
              </Field>
            </div>
            <Field label="Fuel type">
              <Select value={form.fuelType ?? ""} onChange={(e) => setForm({ ...form, fuelType: e.target.value })}>
                <option value="">—</option>
                {FUEL_TYPES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="VIN">
                <Input value={form.vin ?? ""} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
              </Field>
              <Field label="Engine">
                <Input value={form.engine ?? ""} onChange={(e) => setForm({ ...form, engine: e.target.value })} />
              </Field>
            </div>
            {saved && <p className="text-sm text-emerald-400">Saved.</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="mt-6">
          <p className="text-sm font-medium text-neutral-200">
            {vehicle.active ? "Archive this vehicle" : "This vehicle is archived"}
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            {vehicle.active
              ? "Hides it from your active vehicle list. History is kept — nothing is deleted, and you can reactivate any time."
              : "It's hidden from your active list but every record is still here."}
          </p>
          <div className="mt-3">
            <Button
              variant="secondary"
              onClick={() => token && setVehicleActive({ token, vehicleId: id, active: !vehicle.active })}
            >
              {vehicle.active ? "Archive vehicle" : "Reactivate vehicle"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
