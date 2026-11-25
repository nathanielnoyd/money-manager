"use client";

import { formatMoney, parseDecimalToMinor } from "@mm/core";
import { Check, EyeOff, Loader2, Plus, Split, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type CategoryOption, CategorySelectOptions } from "@/components/category-select";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  bulkUpdate,
  deleteTransaction,
  splitTransaction,
  unsplitTransaction,
  updateTransaction,
} from "./actions";

export interface Row {
  id: string;
  date: string;
  amount: number;
  pending: boolean;
  raw: string;
  notes: string | null;
  excluded: boolean;
  reviewed: boolean;
  isSplit: boolean;
  categoryId: string | null;
  categorySource: string | null;
  accountId: string;
  /** Added by hand, imported from a file, or synced from a bank. */
  origin: "manual" | "file" | "bank";
  merchant: string | null;
  category: string | null;
  account: string;
}

interface SplitChild {
  id: string;
  parentId: string | null;
  amount: number;
  categoryId: string | null;
  notes: string | null;
}

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** What a purchase earned on its card (see @mm/services rewards). */
export interface RewardChip {
  rate: string;
  points: number;
  valueCents: number;
  better?: string;
  betterValueCents?: number;
}

const fmtCents = (c: number) => (Math.abs(c) < 100 ? `${c}¢` : `$${(c / 100).toFixed(2)}`);

export function TransactionsTable({
  rows,
  splits,
  categories,
  rewards = {},
}: {
  rows: Row[];
  splits: SplitChild[];
  categories: CategoryOption[];
  rewards?: Record<string, RewardChip>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Row | null>(null);
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  // Clear the selection whenever a new page of rows arrives.
  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setSelected(new Set());
  }
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Group rows under date headers, Monarch-style.
  const groups: { date: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.date === r.date) g.rows.push(r);
    else groups.push({ date: r.date, rows: [r] });
  }

  return (
    <>
      {selected.size > 0 && (
        <BulkBar
          ids={[...selected]}
          categories={categories}
          onDone={() => setSelected(new Set())}
        />
      )}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
          <Checkbox
            aria-label="Select all"
            checked={allSelected}
            onChange={() =>
              setSelected(
                allSelected ? new Set() : new Set(rows.filter((r) => !r.isSplit).map((r) => r.id)),
              )
            }
          />
          <span className="flex-1">Transaction</span>
          <span className="hidden w-40 md:block">Category</span>
          <span className="hidden w-40 lg:block">Account</span>
          <span className="w-28 text-right">Amount</span>
        </div>
        {groups.map((g) => (
          <div key={g.date}>
            <div className="border-b bg-muted/20 px-4 py-1.5 text-xs font-medium text-muted-foreground">
              {fmtDate(g.date)}
            </div>
            <ul className="divide-y">
              {g.rows.map((r) => {
                const children = splits.filter((s) => s.parentId === r.id);
                return (
                  <li
                    key={r.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40",
                      r.excluded && "opacity-55",
                    )}
                  >
                    <Checkbox
                      aria-label={`Select ${r.merchant ?? r.raw}`}
                      checked={selected.has(r.id)}
                      disabled={r.isSplit}
                      onChange={() => toggle(r.id)}
                    />
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => setEditing(r)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {r.merchant ?? r.raw}
                          </span>
                          {!r.reviewed && (
                            <span
                              className="size-1.5 shrink-0 rounded-full bg-primary"
                              title="Needs review"
                            />
                          )}
                          {r.pending && <Badge tone="warning">Pending</Badge>}
                          {r.excluded && <Badge>Excluded</Badge>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {r.raw}
                          {r.notes && ` · ${r.notes}`}
                        </div>
                      </div>
                      <span className="hidden w-40 truncate text-sm md:block">
                        {r.isSplit ? (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Split className="size-3.5" />{" "}
                            {children
                              .map(
                                (c) =>
                                  (c.categoryId && catName.get(c.categoryId)) || "Uncategorized",
                              )
                              .join(", ")}
                          </span>
                        ) : (
                          <span className={cn(!r.category && "text-warning")}>
                            {r.category ?? "Uncategorized"}
                            {r.categorySource === "ai" && !r.reviewed && (
                              <span
                                className="ml-1.5 rounded bg-accent px-1 text-[10px] font-medium text-accent-foreground"
                                title="Suggested by AI. Open to confirm or change."
                              >
                                AI
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                      <span className="hidden w-40 truncate text-sm text-muted-foreground lg:block">
                        {r.account}
                      </span>
                      <span className="flex w-28 flex-col items-end">
                        <Money
                          value={r.amount}
                          signed
                          colored
                          className="text-right text-sm font-medium"
                        />
                        {rewards[r.id] && <Chip chip={rewards[r.id] as RewardChip} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Card>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <EditDrawer
            key={editing.id}
            row={editing}
            categories={categories}
            existingSplits={splits.filter((s) => s.parentId === editing.id)}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>
    </>
  );
}

function BulkBar({
  ids,
  categories,
  onDone,
}: {
  ids: string[];
  categories: CategoryOption[];
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (change: Omit<Parameters<typeof bulkUpdate>[0], "ids">) =>
    start(async () => {
      await bulkUpdate({ ids, ...change });
      onDone();
      router.refresh();
    });
  return (
    <div className="sticky top-14 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 pl-4 shadow-md lg:top-2">
      <span className="text-sm font-medium">{ids.length} selected</span>
      <Select
        aria-label="Set category"
        className="h-8 w-auto text-xs"
        defaultValue=""
        disabled={pending}
        onChange={(e) =>
          e.target.value && run({ categoryId: e.target.value === "none" ? null : e.target.value })
        }
      >
        <option value="" disabled>
          Set category…
        </option>
        <option value="none">Uncategorized</option>
        <CategorySelectOptions categories={categories} />
      </Select>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run({ reviewed: true })}
      >
        <Check /> Mark reviewed
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run({ excluded: true })}
      >
        <EyeOff /> Exclude
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run({ excluded: false })}>
        Include
      </Button>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      <button
        type="button"
        className="ml-auto px-2 text-sm text-muted-foreground hover:text-foreground"
        onClick={onDone}
      >
        Cancel
      </button>
    </div>
  );
}

function EditDrawer({
  row,
  categories,
  existingSplits,
  onClose,
}: {
  row: Row;
  categories: CategoryOption[];
  existingSplits: SplitChild[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [merchant, setMerchant] = useState(row.merchant ?? "");
  const [categoryId, setCategoryId] = useState(row.categoryId ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const [excluded, setExcluded] = useState(row.excluded);
  const [remember, setRemember] = useState(false);
  const [splitting, setSplitting] = useState(row.isSplit);
  const [deleting, setDeleting] = useState(false);
  const [adjustBalance, setAdjustBalance] = useState(true);

  const remove = () =>
    start(async () => {
      setError(null);
      const r = await deleteTransaction(row.id, adjustBalance);
      if (!r.ok) return setError(r.error);
      router.refresh();
      onClose();
    });

  const save = () =>
    start(async () => {
      setError(null);
      const r = await updateTransaction(row.id, {
        merchantName:
          merchant.trim() && merchant.trim() !== row.merchant ? merchant.trim() : undefined,
        categoryId: row.isSplit ? undefined : categoryId || null,
        notes,
        excluded,
        reviewed: true,
        rememberForMerchant: remember && !!categoryId,
      });
      if (!r.ok) return setError(r.error);
      router.refresh();
      onClose();
    });

  return (
    <DialogContent
      side="right"
      title={row.merchant ?? row.raw}
      description={`${fmtDate(row.date)} · ${row.account}`}
    >
      <div className="flex flex-col gap-5">
        <div className="rounded-xl bg-muted/50 p-4 text-center">
          <Money
            value={row.amount}
            signed
            colored
            className="text-3xl font-semibold tracking-tight"
          />
          <div className="mt-1 text-xs text-muted-foreground">{row.raw}</div>
          {row.pending && (
            <Badge tone="warning" className="mt-2">
              Pending
            </Badge>
          )}
        </div>

        <Field label="Merchant" htmlFor="tx-merchant">
          <Input
            id="tx-merchant"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            maxLength={120}
          />
        </Field>

        {!splitting && (
          <>
            <Field label="Category" htmlFor="tx-category">
              <Select
                id="tx-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Uncategorized</option>
                <CategorySelectOptions categories={categories} includeHiddenId={row.categoryId} />
              </Select>
            </Field>
            {categoryId && (merchant || row.merchant) && (
              <label className="-mt-2 flex items-start gap-2 text-sm">
                <Checkbox
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Always categorize <strong>{merchant || row.merchant}</strong> this way
                  <span className="block text-xs text-muted-foreground">
                    Creates a rule and updates past transactions.
                  </span>
                </span>
              </label>
            )}
          </>
        )}

        {splitting ? (
          <SplitEditor
            row={row}
            categories={categories}
            existing={existingSplits}
            onCancel={() => setSplitting(row.isSplit)}
            onDone={() => {
              router.refresh();
              onClose();
            }}
          />
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setSplitting(true)}
          >
            <Split /> Split transaction
          </Button>
        )}

        <Field label="Notes" htmlFor="tx-notes">
          <Textarea
            id="tx-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            rows={3}
          />
        </Field>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={excluded}
            onChange={(e) => setExcluded(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Exclude from budgets and reports
            <span className="block text-xs text-muted-foreground">
              For reimbursed expenses, transfers you track elsewhere, etc.
            </span>
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        <div className="flex gap-2 border-t pt-4">
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Save
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {row.origin !== "bank" && !deleting && (
            <Button
              variant="ghost"
              className="ml-auto text-negative"
              onClick={() => setDeleting(true)}
            >
              <Trash2 /> Delete
            </Button>
          )}
        </div>
        {deleting && (
          <div className="flex flex-col gap-3 rounded-xl border border-negative/30 p-4 text-sm">
            <p>
              Delete this transaction{row.isSplit ? " and its split" : ""}? This can't be undone.
            </p>
            {row.origin === "manual" && (
              <label className="flex items-start gap-2">
                <Checkbox
                  checked={adjustBalance}
                  onChange={(e) => setAdjustBalance(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Also move the account balance back</span>
              </label>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="text-negative"
                onClick={remove}
                disabled={pending}
              >
                {pending && <Loader2 className="animate-spin" />} Delete transaction
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                Keep it
              </Button>
            </div>
          </div>
        )}
      </div>
    </DialogContent>
  );
}

function SplitEditor({
  row,
  categories,
  existing,
  onCancel,
  onDone,
}: {
  row: Row;
  categories: CategoryOption[];
  existing: SplitChild[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const sign = row.amount < 0 ? -1 : 1;
  const toText = (minor: number) => (Math.abs(minor) / 100).toFixed(2);
  const [parts, setParts] = useState(
    existing.length >= 2
      ? existing.map((c) => ({ amount: toText(c.amount), categoryId: c.categoryId ?? "" }))
      : [
          { amount: toText(Math.trunc(row.amount / 2)), categoryId: row.categoryId ?? "" },
          { amount: toText(row.amount - Math.trunc(row.amount / 2)), categoryId: "" },
        ],
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const minor = parts.map((p) => (parseDecimalToMinor(p.amount) ?? 0) * sign);
  const remaining = row.amount - minor.reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between text-sm font-medium">
        Split
        <span
          className={cn("text-xs", remaining === 0 ? "text-muted-foreground" : "text-negative")}
        >
          {remaining === 0
            ? "Balanced"
            : `${formatMoney(Math.abs(remaining))} ${Math.abs(remaining) > 0 && Math.sign(remaining) === sign ? "left" : "over"}`}
        </span>
      </div>
      {parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: split rows have no identity until saved
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`Part ${i + 1} amount`}
            inputMode="decimal"
            value={p.amount}
            onChange={(e) =>
              setParts(parts.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
            }
            className="w-28 tabular"
          />
          <Select
            aria-label={`Part ${i + 1} category`}
            value={p.categoryId}
            onChange={(e) =>
              setParts(parts.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))
            }
          >
            <option value="">Uncategorized</option>
            <CategorySelectOptions categories={categories} />
          </Select>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove part"
            disabled={parts.length <= 2}
            onClick={() => setParts(parts.filter((_, j) => j !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => setParts([...parts, { amount: toText(remaining), categoryId: "" }])}
      >
        <Plus /> Add part
      </Button>
      {error && <p className="text-sm text-negative">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || remaining !== 0}
          onClick={() =>
            start(async () => {
              const r = await splitTransaction(row.id, {
                parts: minor.map((amount, i) => ({
                  amount,
                  categoryId: parts[i]?.categoryId || null,
                })),
              });
              if (!r.ok) setError(r.error);
              else onDone();
            })
          }
        >
          Save split
        </Button>
        {row.isSplit ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await unsplitTransaction(row.id);
                onDone();
              })
            }
          >
            Remove split
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function Chip({ chip }: { chip: RewardChip }) {
  const title = `${chip.points.toLocaleString()} points at ${chip.rate}, worth ${fmtCents(chip.valueCents)}${
    chip.better ? `. ${chip.better} would have earned ${fmtCents(chip.betterValueCents ?? 0)}.` : ""
  }`;
  return (
    <span
      title={title}
      data-testid="reward-chip"
      className={cn(
        "tabular text-[11px] leading-tight",
        chip.better ? "text-warning" : "text-muted-foreground",
      )}
    >
      {chip.points < 0 ? "-" : "+"}
      {chip.rate} · {fmtCents(Math.abs(chip.valueCents))}
    </span>
  );
}
