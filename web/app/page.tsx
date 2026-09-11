"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const { ready, token, userId } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(token && userId ? "/dashboard" : "/login");
  }, [ready, token, userId, router]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <p className="text-sm text-neutral-400">Loading…</p>
    </div>
  );
}
