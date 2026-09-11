"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function NavBar() {
  const { token, userId, logout } = useAuth();
  const loggedIn = Boolean(token && userId);

  return (
    <header className="border-b border-neutral-800 bg-neutral-900">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href={loggedIn ? "/dashboard" : "/"} className="text-base font-semibold tracking-tight text-neutral-100">
          🔧 Garage Bot
        </Link>
        {loggedIn && (
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="text-neutral-400 hover:text-neutral-100">
              Vehicles
            </Link>
            <button
              onClick={logout}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800"
            >
              Log out
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
