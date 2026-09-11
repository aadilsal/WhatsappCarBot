"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui";

export default function MagicLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const redeem = useMutation(api.auth.redeemMagicLink);
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    redeem({ token })
      .then((result) => {
        if (cancelled) return;
        if (result.status === "ok") {
          login(result.token);
          router.replace("/dashboard");
        } else {
          setError("This link has expired. Text the bot to get a fresh one, or log in with a code instead.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Something went wrong. Try logging in with a code instead.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm text-center">
        {error ? (
          <>
            <p className="text-sm text-red-400">{error}</p>
            <a href="/login" className="mt-4 inline-block text-sm text-neutral-300 underline">
              Go to login
            </a>
          </>
        ) : (
          <p className="text-sm text-neutral-400">Logging you in…</p>
        )}
      </Card>
    </div>
  );
}
