"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button, Card, Field, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";

function normalizeWaId(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

export default function LoginPage() {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [waId, setWaId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestOtp = useAction(api.auth.requestOtp);
  const verifyOtp = useMutation(api.auth.verifyOtp);
  const { login } = useAuth();
  const router = useRouter();

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = normalizeWaId(waId);
    if (normalized.length < 8) {
      setError("Enter your full WhatsApp number, country code included.");
      return;
    }
    setBusy(true);
    try {
      await requestOtp({ waId: normalized });
      setWaId(normalized);
      setStep("otp");
    } catch {
      setError("Something went wrong sending the code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await verifyOtp({ waId, code: code.trim() });
      if (result.status === "ok") {
        login(result.token);
        router.replace("/dashboard");
      } else if (result.status === "invalid") {
        setError("That code isn't right. Check WhatsApp and try again.");
      } else {
        setError("That code expired. Request a new one.");
        setStep("phone");
      }
    } catch {
      setError("Something went wrong verifying the code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-neutral-100">Log in to Garage Bot</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {step === "phone"
            ? "We'll send a login code to your WhatsApp."
            : `Enter the 6-digit code we sent to WhatsApp (${waId}).`}
        </p>

        {step === "phone" ? (
          <form onSubmit={handleRequestOtp} className="mt-6 flex flex-col gap-4">
            <Field label="WhatsApp number" hint="Include country code, digits only — e.g. 923001234567">
              <Input
                type="tel"
                inputMode="numeric"
                autoFocus
                placeholder="923001234567"
                value={waId}
                onChange={(e) => setWaId(e.target.value)}
              />
            </Field>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send code"}
            </Button>
            <p className="text-xs text-neutral-400">
              Only numbers that have already messaged the bot can log in. Not set up yet? Text the bot on WhatsApp
              first.
            </p>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="mt-6 flex flex-col gap-4">
            <Field label="6-digit code">
              <Input
                type="text"
                inputMode="numeric"
                autoFocus
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" disabled={busy || code.trim().length !== 6}>
              {busy ? "Verifying…" : "Verify & log in"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setError(null);
              }}
              className="text-xs text-neutral-500 underline"
            >
              Use a different number
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
