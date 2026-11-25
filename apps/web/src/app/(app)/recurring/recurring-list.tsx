"use client";

import { formatMoney } from "@mm/core";
import { RotateCcw, TrendingUp, X } from "lucide-react";
import { useTransition } from "react";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { setRecurringStatus } from "./actions";

interface Row {
  id: string;
  merchant: string;
  direction: string;
  cadence: string;
  expectedAmount: number;
  lastAmount: number;
  lastDate: string;
  nextDate: string;
  occurrences: number;
  priceChange: number | null;
  status: string;
  category: string | null;
  monthly: number;
}

const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export function RecurringList({ rows, canEdit }: { rows: Row[]; canEdit: boolean }) {
  const active = rows.filter((r) => r.status === "active");
  const sections = [
    { title: "Bills & subscriptions", rows: active.filter((r) => r.direction === "out") },
    { title: "Income", rows: active.filter((r) => r.direction === "in") },
  ];
  const dismissed = rows.filter((r) => r.status === "dismissed");
  return (
    <>
      {sections.map((s) =>
        s.rows.length === 0 ? null : (
          <Card key={s.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-foreground">{s.title}</CardTitle>
            </CardHeader>
            <ul className="divide-y">
              {s.rows.map((r) => (
                <Item key={r.id} r={r} canEdit={canEdit} />
              ))}
            </ul>
          </Card>
        ),
      )}
      {dismissed.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {dismissed.length} marked as not recurring
          </summary>
          <Card className="mt-2">
            <ul className="divide-y">
              {dismissed.map((r) => (
                <Item key={r.id} r={r} canEdit={canEdit} />
              ))}
            </ul>
          </Card>
        </details>
      )}
    </>
  );
}

function Item({ r, canEdit }: { r: Row; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const increased = r.direction === "out" && (r.priceChange ?? 0) < 0;
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {r.merchant}
          <Badge>{r.cadence}</Badge>
          {increased && (
            <Badge tone="warning">
              <TrendingUp className="mr-1 size-3" /> up {formatMoney(Math.abs(r.priceChange ?? 0))}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {r.category ?? "Uncategorized"} · last {day(r.lastDate)} · {r.occurrences} payments
          {r.cadence !== "monthly" && ` · ≈${formatMoney(r.monthly)}/mo`}
        </div>
      </div>
      <div className="text-right">
        <Money
          value={r.status === "active" ? r.expectedAmount : r.lastAmount}
          signed
          colored
          className="text-sm font-medium"
        />
        {r.status === "active" && (
          <div className="text-xs text-muted-foreground">next {day(r.nextDate)}</div>
        )}
      </div>
      {canEdit &&
        (r.status === "active" ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`${r.merchant} isn't recurring`}
            title="Not recurring"
            disabled={pending}
            onClick={() => start(async () => void (await setRecurringStatus(r.id, "dismissed")))}
          >
            <X />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Restore ${r.merchant}`}
            title="Restore"
            disabled={pending}
            onClick={() => start(async () => void (await setRecurringStatus(r.id, "active")))}
          >
            <RotateCcw />
          </Button>
        ))}
    </li>
  );
}
