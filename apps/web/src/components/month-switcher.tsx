import { addMonths, monthLabel } from "@mm/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

/** Prev / current / next month navigation via ?month=YYYY-MM. */
export function MonthSwitcher({ month, basePath }: { month: string; basePath: string }) {
  const href = (m: string) => `${basePath}?month=${m.slice(0, 7)}`;
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-xs">
      <Link
        href={href(addMonths(month, -1))}
        aria-label="Previous month"
        className="rounded-md p-1.5 hover:bg-muted"
      >
        <ChevronLeft className="size-4" />
      </Link>
      <span className="min-w-32 text-center text-sm font-medium">{monthLabel(month)}</span>
      <Link
        href={href(addMonths(month, 1))}
        aria-label="Next month"
        className="rounded-md p-1.5 hover:bg-muted"
      >
        <ChevronRight className="size-4" />
      </Link>
    </div>
  );
}
