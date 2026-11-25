"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useRef } from "react";
import { type CategoryOption, CategorySelectOptions } from "@/components/category-select";
import { Select } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import type { TxnFilters } from "@/lib/transactions";

export function Filters({
  filters,
  categories,
  accounts,
}: {
  filters: TxnFilters;
  categories: CategoryOption[];
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const form = useRef<HTMLFormElement>(null);

  const apply = () => {
    if (!form.current) return;
    const data = new FormData(form.current);
    const qs = new URLSearchParams();
    for (const [k, v] of data) if (typeof v === "string" && v) qs.set(k, v);
    router.push(`${pathname}${qs.size ? `?${qs}` : ""}`);
  };
  const active = Object.entries(filters).some(([k, v]) => k !== "page" && v);

  return (
    <form
      ref={form}
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      className="mb-4 flex flex-wrap items-center gap-2"
    >
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="q"
          defaultValue={filters.q}
          placeholder="Search merchant, description, notes"
          className="pl-9"
          aria-label="Search transactions"
        />
      </div>
      <Select
        name="account"
        defaultValue={filters.account ?? ""}
        onChange={apply}
        className="w-auto min-w-36"
        aria-label="Account"
      >
        <option value="">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <Select
        name="category"
        defaultValue={filters.category ?? ""}
        onChange={apply}
        className="w-auto min-w-36"
        aria-label="Category"
      >
        <option value="">All categories</option>
        <option value="none">Uncategorized</option>
        <CategorySelectOptions categories={categories} />
      </Select>
      <Input
        type="date"
        name="from"
        defaultValue={filters.from}
        onChange={apply}
        className="w-auto"
        aria-label="From date"
      />
      <Input
        type="date"
        name="to"
        defaultValue={filters.to}
        onChange={apply}
        className="w-auto"
        aria-label="To date"
      />
      <Select
        name="reviewed"
        defaultValue={filters.reviewed ?? ""}
        onChange={apply}
        className="w-auto"
        aria-label="Review status"
      >
        <option value="">All</option>
        <option value="no">Needs review</option>
      </Select>
      {active && (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" /> Clear
        </button>
      )}
    </form>
  );
}
