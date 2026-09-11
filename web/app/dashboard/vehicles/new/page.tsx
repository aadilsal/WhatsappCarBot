"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { AuthGuard, useAuth } from "@/lib/auth";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { FUEL_TYPES } from "@/lib/constants";
import { fromDateInputValue } from "@/lib/format";

type CalibrationEntry = { category: string; odo: string; at: string };

function AddVehicleForm() {
  const { token } = useAuth();
  const router = useRouter();
  const categories = useQuery(api.dashboard.listCategories, {});
  const addVehicle = useMutation(api.dashboard.addVehicle);

  const [nickname, setNickname] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [plate, setPlate] = useState("");
  const [fuelType, setFuelType] = useState("");
  const [currentOdo, setCurrentOdo] = useState("");
  const [vin, setVin] = useState("");
  const [engine, setEngine] = useState("");
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibration, setCalibration] = useState<Record<string, CalibrationEntry>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setCal(category: string, patch: Partial<Omit<CalibrationEntry, "category">>) {
    setCalibration((prev) => ({
      ...prev,
      [category]: {
        category,
        odo: prev[category]?.odo ?? "",
        at: prev[category]?.at ?? "",
        ...patch,
      },
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!nickname.trim()) {
      setError("Give the vehicle a nickname.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const calibrationRows = Object.values(calibration)
        .filter((c) => c.odo || c.at)
        .map((c) => ({
          category: c.category,
          odo: c.odo ? Number(c.odo) : undefined,
          at: c.at ? fromDateInputValue(c.at) : undefined,
        }));

      const vehicleId = await addVehicle({
        token,
        nickname: nickname.trim(),
        make: make.trim() || undefined,
        model: model.trim() || undefined,
        year: year ? Number(year) : undefined,
        plate: plate.trim() || undefined,
        fuelType: (fuelType || undefined) as any,
        currentOdo: currentOdo ? Number(currentOdo) : undefined,
        vin: vin.trim() || undefined,
        engine: engine.trim() || undefined,
        calibration: calibrationRows.length > 0 ? calibrationRows : undefined,
      }).then((r) => r.vehicleId);

      router.replace(`/dashboard/${vehicleId}`);
    } catch {
      setError("Couldn't add the vehicle — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold text-neutral-100">Add a vehicle</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Same setup as the WhatsApp wizard — anything you skip here can be logged later, on the dashboard or by
        texting the bot.
      </p>

      <Card className="mt-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Nickname *" hint="What you'll call it — doesn't have to differ from make/model">
            <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Honda City" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Make">
              <Input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Honda" />
            </Field>
            <Field label="Model">
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="City" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Year">
              <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2020" />
            </Field>
            <Field label="Plate">
              <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="ABC-123" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Fuel type">
              <Select value={fuelType} onChange={(e) => setFuelType(e.target.value)}>
                <option value="">—</option>
                {FUEL_TYPES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Current odometer (km)">
              <Input type="number" value={currentOdo} onChange={(e) => setCurrentOdo(e.target.value)} placeholder="55000" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="VIN">
              <Input value={vin} onChange={(e) => setVin(e.target.value)} />
            </Field>
            <Field label="Engine">
              <Input value={engine} onChange={(e) => setEngine(e.target.value)} />
            </Field>
          </div>

          <button
            type="button"
            onClick={() => setShowCalibration((s) => !s)}
            className="text-left text-sm font-medium text-neutral-300 underline"
          >
            {showCalibration ? "Hide" : "Add known service history (optional)"}
          </button>

          {showCalibration && (
            <div className="flex flex-col gap-3 rounded-md border border-neutral-800 p-3">
              <p className="text-xs text-neutral-500">
                For anything you leave blank, the reminder just starts counting from today.
              </p>
              {(categories ?? []).map((c) => {
                const entry = calibration[c.category];
                return (
                  <div key={c.category} className="grid grid-cols-3 items-center gap-2 text-sm">
                    <span className="text-neutral-300">{c.label}</span>
                    {c.mode === "interval" ? (
                      <Input
                        type="number"
                        placeholder="odo at last done"
                        value={entry?.odo ?? ""}
                        onChange={(e) => setCal(c.category, { odo: e.target.value })}
                      />
                    ) : (
                      <span />
                    )}
                    <Input
                      type="date"
                      value={entry?.at ?? ""}
                      onChange={(e) => setCal(c.category, { at: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add vehicle"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default function NewVehiclePage() {
  return (
    <AuthGuard>
      <AddVehicleForm />
    </AuthGuard>
  );
}
