"use client";

import { formatMoney, parseDecimalToMinor } from "@mm/core";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import type { InvestmentsData } from "@/lib/investments";
import { cn } from "@/lib/utils";
import { removeManualHolding, saveManualHolding } from "./actions";

type Holding = InvestmentsData["holdings"][number];

const qty = (q: string) => {
  const n = Number(q);
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 });
};

export function HoldingsTable({
  holdings,
  manualAccounts,
  manualAccountIds,
}: {
  holdings: Holding[];
  manualAccounts: { id: string; name: string }[];
  manualAccountIds: string[];
}) {
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const manual = new Set(manualAccountIds);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Holdings</CardTitle>
        {manualAccounts.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Add holding
          </Button>
        )}
      </CardHeader>
      <div className="overflow-x-auto px-5 pb-4">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Security</th>
              <th className="py-2 font-medium">Account</th>
              <th className="py-2 text-right font-medium">Shares</th>
              <th className="py-2 text-right font-medium">Price</th>
              <th className="py-2 text-right font-medium">Value</th>
              <th className="py-2 text-right font-medium">Gain</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {holdings.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted-foreground">
                  No holdings yet.
                </td>
              </tr>
            )}
            {holdings.map((h) => {
              const gain = h.costBasis === null ? null : h.value - h.costBasis;
              return (
                <tr key={h.id}>
                  <td className="py-2.5">
                    <div className="font-medium">{h.symbol ?? "—"}</div>
                    <div className="max-w-56 truncate text-xs text-muted-foreground">{h.name}</div>
                  </td>
                  <td className="py-2.5 text-muted-foreground">{h.account}</td>
                  <td className="py-2.5 text-right tabular">{qty(h.quantity)}</td>
                  <td className="py-2.5 text-right tabular text-muted-foreground">
                    {h.price ? formatMoney(Math.round(Number(h.price) * 100)) : "—"}
                  </td>
                  <td className="py-2.5 text-right">
                    <Money value={h.value} className="font-medium" />
                  </td>
                  <td
                    className={cn(
                      "py-2.5 text-right tabular",
                      gain !== null && gain > 0 && "text-positive",
                      gain !== null && gain < 0 && "text-negative",
                    )}
                  >
                    {gain === null ? (
                      "—"
                    ) : (
                      <>
                        {formatMoney(gain, "USD", { signed: true })}
                        {h.costBasis ? (
                          <div className="text-xs">{((gain / h.costBasis) * 100).toFixed(1)}%</div>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    {manual.has(h.accountId) && manualAccounts.length > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${h.symbol ?? h.name}`}
                        disabled={pending}
                        onClick={() =>
                          window.confirm(`Remove ${h.symbol ?? h.name}?`) &&
                          start(async () => void (await removeManualHolding(h.id)))
                        }
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding && <AddHolding accounts={manualAccounts} onDone={() => setAdding(false)} />}
      </Dialog>
    </Card>
  );
}

function AddHolding({
  accounts,
  onDone,
}: {
  accounts: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("etf");
  const [quantity, setQuantity] = useState("");
  const [value, setValue] = useState("");
  const [basis, setBasis] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <DialogContent
      title="Add a holding"
      description="Adding the same symbol again updates it. The account's balance becomes the total of its holdings."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const v = parseDecimalToMinor(value);
          const b = basis.trim() ? parseDecimalToMinor(basis) : null;
          if (v === null || v < 0 || (basis.trim() && (b === null || b < 0)))
            return setError("Enter valid amounts.");
          start(async () => {
            const r = await saveManualHolding({
              accountId,
              symbol,
              name: name || symbol,
              type: type as never,
              quantity: quantity.replace(/,/g, ""),
              value: v,
              costBasis: b,
            });
            if (!r.ok) return setError(r.error);
            onDone();
          });
        }}
      >
        <Field label="Account" htmlFor="h-acct">
          <Select id="h-acct" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field label="Symbol" htmlFor="h-sym">
            <Input
              id="h-sym"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              required
              maxLength={12}
              placeholder="VTI"
            />
          </Field>
          <Field label="Name" htmlFor="h-name">
            <Input
              id="h-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Vanguard Total Stock Market ETF"
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="h-type">
            <Select id="h-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="etf">ETF</option>
              <option value="equity">Stock</option>
              <option value="mutual fund">Mutual fund</option>
              <option value="fixed income">Bond</option>
              <option value="cash">Cash</option>
              <option value="cryptocurrency">Crypto</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Shares" htmlFor="h-qty">
            <Input
              id="h-qty"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
              className="tabular"
              placeholder="12.5"
            />
          </Field>
          <Field label="Current value" htmlFor="h-val">
            <Input
              id="h-val"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              className="tabular"
              placeholder="5,000"
            />
          </Field>
          <Field label="Cost basis (optional)" htmlFor="h-basis">
            <Input
              id="h-basis"
              inputMode="decimal"
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
              className="tabular"
              placeholder="4,200"
            />
          </Field>
        </div>
        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending || !symbol || !quantity || !value}>
          {pending && <Loader2 className="animate-spin" />} Save holding
        </Button>
      </form>
    </DialogContent>
  );
}
