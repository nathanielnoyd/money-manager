"use client";

import { formatMoney, parseDecimalToMinor } from "@mm/core";
import { AlertCircle, CalendarSync, Copy, Repeat2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BudgetMonth } from "@/lib/planning";
import { cn } from "@/lib/utils";
import { fillBudget, setBudget, setRollover } from "./actions";

type Line = BudgetMonth["expense"][number];

export function BudgetEditor({ data, canEdit }: { data: BudgetMonth; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const zeroBased = data.budgetMode === "zero_based";
  const income =
    data.totals.plannedIncome > 0 ? data.totals.plannedIncome : data.totals.actualIncome;
  const left = income - data.totals.budgeted;
  const remaining = data.totals.budgeted - data.totals.spent;

  const groups = new Map<string, Line[]>();
  for (const l of data.expense) groups.set(l.group, [...(groups.get(l.group) ?? []), l]);
  const hasBudgets = data.totals.budgeted > 0;

  const fill = (source: "last_month" | "average") =>
    start(async () => {
      const r = await fillBudget(data.month, source);
      setNotice(
        r.ok
          ? r.data?.filled
            ? `Filled ${r.data.filled} categories.`
            : "Nothing to fill: every category with history already has a budget."
          : r.error,
      );
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {zeroBased ? (
          <Stat
            label="Left to budget"
            value={left}
            hint={`${formatMoney(income)} ${data.totals.plannedIncome > 0 ? "planned" : "received"} income − ${formatMoney(data.totals.budgeted)} assigned`}
            tone={left === 0 ? "good" : left < 0 ? "bad" : "warn"}
          />
        ) : (
          <Stat
            label="Budgeted"
            value={data.totals.budgeted}
            hint={`across ${data.expense.filter((l) => l.line.budgeted > 0).length} categories`}
          />
        )}
        <Stat
          label="Spent"
          value={data.totals.spent}
          hint={
            hasBudgets
              ? `${Math.round((data.totals.spent / Math.max(1, data.totals.budgeted)) * 100)}% of budget`
              : "this month"
          }
        />
        <Stat
          label={remaining >= 0 ? "Remaining" : "Over budget"}
          value={Math.abs(remaining)}
          tone={remaining >= 0 ? "neutral" : "bad"}
          hint={`income so far: ${formatMoney(data.totals.actualIncome)}`}
        />
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={pending} onClick={() => fill("last_month")}>
            <Copy /> Copy last month
          </Button>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => fill("average")}>
            <Sparkles /> Fill from 3-month average
          </Button>
          {notice && <span className="text-sm text-muted-foreground">{notice}</span>}
        </div>
      )}

      {data.uncategorized.count > 0 && (
        <Link
          href={`/transactions?category=none&from=${data.month}`}
          className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm hover:bg-warning/15"
        >
          <AlertCircle className="size-4 text-warning" />
          {data.uncategorized.count} uncategorized transactions (
          {formatMoney(data.uncategorized.spent)}) aren't counted in any budget. Categorize them →
        </Link>
      )}

      {[...groups].map(([group, lines]) => {
        const g = lines.reduce((t, l) => ({ b: t.b + l.line.budgeted, s: t.s + l.line.spent }), {
          b: 0,
          s: 0,
        });
        return (
          <Card key={group}>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-foreground">{group}</CardTitle>
              <span className="text-xs text-muted-foreground tabular">
                {formatMoney(g.s)} of {formatMoney(g.b)}
              </span>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <div className="hidden grid-cols-[1fr_8rem_7rem_7rem] gap-4 px-5 pb-1 text-xs text-muted-foreground sm:grid">
                <span>Category</span>
                <span className="text-right">Budget</span>
                <span className="text-right">Spent</span>
                <span className="text-right">Remaining</span>
              </div>
              <ul>
                {lines.map((l) => (
                  <BudgetRow
                    key={`${l.id}:${l.line.budgeted}`}
                    line={l}
                    month={data.month}
                    canEdit={canEdit}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}

      {data.income.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-foreground">Income</CardTitle>
            {zeroBased && (
              <p className="text-xs text-muted-foreground">
                Set expected income to plan the month before it arrives.
              </p>
            )}
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ul>
              {data.income.map((l) => (
                <BudgetRow
                  key={`${l.id}:${l.line.budgeted}`}
                  line={l}
                  month={data.month}
                  canEdit={canEdit}
                  income
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm text-muted-foreground">{label}</div>
        <Money
          value={value}
          className={cn(
            "text-2xl font-semibold tracking-tight",
            tone === "bad" && "text-negative",
            tone === "good" && "text-positive",
            tone === "warn" && "text-warning",
          )}
        />
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function BudgetRow({
  line: l,
  month,
  canEdit,
  income = false,
}: {
  line: Line;
  month: string;
  canEdit: boolean;
  income?: boolean;
}) {
  const [value, setValue] = useState(l.line.budgeted ? (l.line.budgeted / 100).toFixed(2) : "");
  const [saving, start] = useTransition();
  const [error, setError] = useState(false);
  const pct = Math.min(1, Number.isFinite(l.line.progress) ? l.line.progress : 1);
  const over = l.line.status === "over";

  const save = () => {
    const minor = value.trim() === "" ? 0 : parseDecimalToMinor(value);
    if (minor === null || minor < 0) return setError(true);
    setError(false);
    if (minor === l.line.budgeted) return;
    start(async () => {
      const r = await setBudget(l.id, month, minor);
      if (!r.ok) setError(true);
      else setValue(minor ? (minor / 100).toFixed(2) : "");
    });
  };

  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-2 sm:grid-cols-[1fr_8rem_7rem_7rem]">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm">{l.name}</span>
        {!income && canEdit && (
          <button
            type="button"
            aria-label={l.rollover ? `Stop rolling over ${l.name}` : `Roll over unspent ${l.name}`}
            title={
              l.rollover ? "Rollover on: unspent money carries to next month" : "Turn on rollover"
            }
            onClick={() => start(async () => void (await setRollover(l.id, !l.rollover)))}
            className={cn(
              "rounded p-0.5",
              l.rollover ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground",
            )}
          >
            {l.rollover ? <Repeat2 className="size-3.5" /> : <CalendarSync className="size-3.5" />}
          </button>
        )}
        {l.line.carry !== 0 && (
          <span
            className={cn("text-xs tabular", l.line.carry > 0 ? "text-positive" : "text-negative")}
          >
            {formatMoney(l.line.carry, "USD", { signed: true })} rolled over
          </span>
        )}
      </div>
      <div className="flex justify-end">
        {canEdit ? (
          <input
            aria-label={`Budget for ${l.name}`}
            inputMode="decimal"
            value={value}
            placeholder={l.suggested ? (l.suggested / 100).toFixed(0) : "0"}
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className={cn(
              "h-8 w-28 rounded-md border border-transparent bg-muted/50 px-2 text-right text-sm tabular transition-colors hover:border-border focus:border-primary focus:bg-card",
              error && "border-negative",
              saving && "opacity-60",
            )}
          />
        ) : (
          <Money value={l.line.budgeted} className="text-sm" />
        )}
      </div>
      <Money
        value={l.line.spent}
        className="hidden text-right text-sm text-muted-foreground sm:block"
      />
      <Money
        value={income ? l.line.spent - l.line.budgeted : l.line.remaining}
        signed={income}
        className={cn(
          "hidden text-right text-sm font-medium sm:block",
          !income && over && "text-negative",
        )}
      />
      {!income && (l.line.budgeted > 0 || l.line.carry !== 0) && (
        <div
          className="col-span-full h-1.5 overflow-hidden rounded-full bg-muted"
          role="presentation"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              over ? "bg-negative" : l.line.status === "near" ? "bg-warning" : "bg-primary",
            )}
            style={{ width: `${Math.max(2, pct * 100)}%` }}
          />
        </div>
      )}
      <div className="col-span-full flex justify-between text-xs text-muted-foreground sm:hidden">
        <span>Spent {formatMoney(l.line.spent)}</span>
        <span className={cn(over && "text-negative")}>
          {over
            ? `${formatMoney(-l.line.remaining)} over`
            : `${formatMoney(l.line.remaining)} left`}
        </span>
      </div>
    </li>
  );
}
