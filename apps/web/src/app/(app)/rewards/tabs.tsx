"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/rewards", label: "Overview" },
  { href: "/rewards/wallet", label: "Wallet" },
  { href: "/rewards/explore", label: "Explore cards" },
  { href: "/rewards/settings", label: "Settings" },
];

export function RewardsTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Rewards sections" className="mb-4 flex gap-1 overflow-x-auto border-b">
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
