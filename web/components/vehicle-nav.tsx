"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/events", label: "History" },
  { href: "/rules", label: "Reminders" },
  { href: "/settings", label: "Settings" },
];

export function VehicleNav({ vehicleId }: { vehicleId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/${vehicleId}`;

  return (
    <div className="border-b border-neutral-800">
      <nav className="mx-auto flex max-w-5xl gap-1 px-4 sm:px-6">
        {TABS.map((tab) => {
          const href = `${base}${tab.href}`;
          const active = pathname === href;
          return (
            <Link
              key={tab.href}
              href={href}
              className={`border-b-2 px-3 py-3 text-sm font-medium ${
                active ? "border-neutral-100 text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
