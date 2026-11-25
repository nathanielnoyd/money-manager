"use client";

import { parseDecimalToMinor } from "@mm/core";
import { Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type CategoryOption, CategorySelectOptions } from "@/components/category-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox, Field, Select } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { addTransaction } from "./actions";

/** Add a transaction by hand. Only accounts that aren't synced from a bank are offered. */
export function AddTransaction({
  accounts,
  categories,
  today,
}: {
  accounts: { id: string; name: string }[];
  categories: CategoryOption[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [adjustBalance, setAdjustBalance] = useState(true);

  const save = () =>
    start(async () => {
      setError(null);
      const minor = parseDecimalToMinor(amount);
      if (minor === null || minor === 0) return setError("Enter an amount, such as 12.50.");
      const r = await addTransaction({
        accountId,
        date,
        amount: direction === "out" ? -Math.abs(minor) : Math.abs(minor),
        description,
        categoryId: categoryId || null,
        adjustBalance,
      });
      if (!r.ok) return setError(r.error);
      setAmount("");
      setDescription("");
      setCategoryId("");
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus /> Add
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add a transaction"
        description="For accounts you keep by hand, such as cash."
      >
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Transactions can be added by hand only to accounts that aren't synced from a bank.{" "}
            <Link href="/accounts" className="text-primary hover:underline">
              Add a manual account
            </Link>{" "}
            first.
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Field label="Account" htmlFor="add-account">
              <Select
                id="add-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" htmlFor="add-date">
                <Input
                  id="add-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </Field>
              <Field label="Amount" htmlFor="add-amount">
                <Input
                  id="add-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </Field>
            </div>
            <Field label="Direction" htmlFor="add-direction">
              <Select
                id="add-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value === "in" ? "in" : "out")}
              >
                <option value="out">Money out</option>
                <option value="in">Money in</option>
              </Select>
            </Field>
            <Field label="Description" htmlFor="add-description">
              <Input
                id="add-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
                placeholder="Farmers market"
                required
              />
            </Field>
            <Field label="Category" htmlFor="add-category">
              <Select
                id="add-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Decide from my rules</option>
                <CategorySelectOptions categories={categories} />
              </Select>
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={adjustBalance}
                onChange={(e) => setAdjustBalance(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Also update the account balance
                <span className="block text-xs text-muted-foreground">
                  Turn this off if the balance you entered already includes it.
                </span>
              </span>
            </label>
            {error && (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            )}
            <div className="flex gap-2 border-t pt-4">
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />} Add transaction
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
